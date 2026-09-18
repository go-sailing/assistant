import { query } from '../../db/pool';
import { config } from '../../config';
import { logger } from '../../common/logger';
import { llmProvider } from '../../llm/deepseek';
import { COMPACTION_PROMPT, SUMMARY_SECTION_HEADER } from '../../llm/prompt';
import { TOOL_DEFINITIONS } from '../../llm/tools';
import type { LlmMessage } from '../../llm/types';
import type { MessageRow } from './chat.types';
import { interactiveFloor, toTranscript, transcriptToLlm, transcriptToText } from './transcript';

/**
 * v0.5.0 上下文自动压缩（系统设计文档 4.3 / 8.1）。
 *
 * 压缩是主模型调用前的 best-effort 步骤：任何失败都吞掉并回退「无摘要 + 最近消息」，
 * 不向用户报错、不影响本轮对话；摘要与水位指针落 conversations 两列。
 */

/** 粗估 token：CJK 1 字≈1 token，其余 4 字符≈1 token，取整上浮 */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  const cjk = text.match(/[\u3000-\u303f\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uff00-\uffef]/g);
  const cjkCount = cjk ? cjk.length : 0;
  const otherCount = text.length - cjkCount;
  return Math.ceil(cjkCount + otherCount / 4);
}

/** toolsJson 长度恒定，token 数在进程内缓存一次（避免每轮重复计算） */
let cachedToolsTokens = 0;
function toolsJsonTokens(): number {
  if (cachedToolsTokens === 0) {
    cachedToolsTokens = estimateTokens(JSON.stringify(TOOL_DEFINITIONS));
  }
  return cachedToolsTokens;
}

/** 本轮用户消息的保守预算（token） */
const USER_MESSAGE_BUDGET_TOKENS = 2000;

/**
 * 压缩失败原因枚举（SDD 9.2：reason 为枚举）。
 * 不落原始错误正文——上游异常消息可能带响应体片段（TC-AUDIT-040e2）。
 */
const COMPACTION_FAIL_REASONS = ['llm_error', 'empty_result', 'db_error'] as const;
type CompactionFailReason = (typeof COMPACTION_FAIL_REASONS)[number];

function logCompactionFailed(
  userId: number,
  conversationId: number,
  reason: CompactionFailReason
): void {
  logger.warn('chat_compaction_failed', {
    user_id: userId,
    conversation_id: conversationId,
    reason,
  });
}

export interface CompactionParams {
  userId: number;
  conversationId: number;
  systemPrompt: string;
  /** 记忆注入分区文本（可能为空串） */
  memorySection: string;
  /** 压缩真正开始时回调（先判定再发，避免误报） */
  onStatus?: () => void;
}

interface SummaryState {
  contextSummary: string | null;
  compactedUntilId: number | null;
}

async function readSummaryState(conversationId: number): Promise<SummaryState> {
  const res = await query<{ context_summary: string | null; compacted_until_id: string | null }>(
    `SELECT context_summary, compacted_until_id FROM conversations WHERE id = $1`,
    [conversationId]
  );
  const row = res.rows[0];
  return {
    contextSummary: row?.context_summary ?? null,
    compactedUntilId: row?.compacted_until_id != null ? Number(row.compacted_until_id) : null,
  };
}

/** 取水位之后的最近消息（ASC 返回），limit 为条数 */
async function recentRows(conversationId: number, limit: number, afterId?: number): Promise<MessageRow[]> {
  if (afterId == null) {
    const res = await query<MessageRow>(
      `SELECT * FROM messages WHERE conversation_id = $1 ORDER BY id DESC LIMIT $2`,
      [conversationId, limit]
    );
    return res.rows.reverse();
  }
  const res = await query<MessageRow>(
    `SELECT * FROM messages WHERE conversation_id = $1 AND id > $2 ORDER BY id DESC LIMIT $3`,
    [conversationId, afterId, limit]
  );
  return res.rows.reverse();
}

/** 取水位与窗口起点之间的待压缩消息（ASC） */
async function candidateRows(
  conversationId: number,
  afterId: number | null,
  beforeId: number
): Promise<MessageRow[]> {
  const res = await query<MessageRow>(
    `SELECT * FROM messages
     WHERE conversation_id = $1
       AND ($2::bigint IS NULL OR id > $2::bigint)
       AND id < $3
     ORDER BY id ASC`,
    [conversationId, afterId, beforeId]
  );
  return res.rows;
}

/** 摘要长度护栏：超上限时按分节边界裁剪，保证落库摘要不超过预算 */
export function truncateSummary(text: string, maxTokens: number): string {
  if (estimateTokens(text) <= maxTokens) return text;
  const sections = text.split(/\n(?=## )/);
  const kept: string[] = [];
  let used = 0;
  for (const section of sections) {
    const cost = estimateTokens(section);
    if (kept.length > 0 && used + cost > maxTokens) break;
    if (kept.length === 0 && cost > maxTokens) {
      // 单节即超限：按字符硬截断（CJK 近似 1 字 1 token）
      return section.slice(0, Math.max(1, maxTokens)).trim();
    }
    kept.push(section);
    used += cost;
  }
  return kept.join('\n').trim();
}

export const compactionService = {
  estimateTokens,
  truncateSummary,

  /**
   * 判定并执行一次压缩。
   * 返回本轮实际使用的保留窗条数（供 composeContext 复用同一窗口）。
   */
  async maybeCompact(params: CompactionParams): Promise<void> {
    const { conversationId } = params;

    // 阶段 1：读取水位/窗口并判断是否超水位（纯 DB 读取 + 估算）
    let state: SummaryState;
    let toCompress: MessageRow[];
    let candidateText: string;
    let triggeredAt = 0;
    try {
      state = await readSummaryState(conversationId);
      const keep = Math.max(1, config.chat.recentKeep);

      // 1. 最近窗口（多探测 64 条以便定位交互地板）
      const window = await recentRows(conversationId, keep + 64, state.compactedUntilId ?? undefined);
      if (window.length === 0) return;
      const keepRows = window.slice(-keep);
      let recentStartId = Number(keepRows[0].id);

      // 2. 待压缩候选（水位之后、窗口之前）
      const candidates =
        recentStartId > 0
          ? await candidateRows(conversationId, state.compactedUntilId, recentStartId)
          : [];

      // 3. 交互地板：未决 proposal/clarify/scope/confirm 之后的全部消息保留原文
      const all = [...candidates, ...window];
      const floorId = interactiveFloor(all);
      if (floorId != null && floorId < recentStartId) {
        recentStartId = floorId;
      }
      toCompress = candidates.filter((row) => Number(row.id) < recentStartId);
      if (toCompress.length === 0) return;

      // 4. 水位估算：不足水位直接返回（零额外调用、零额外延迟）
      const transcriptText = transcriptToText(toTranscript(window));
      candidateText = transcriptToText(toTranscript(toCompress));
      const estimated =
        estimateTokens(params.systemPrompt) +
        toolsJsonTokens() +
        estimateTokens(params.memorySection) +
        estimateTokens(transcriptText) +
        estimateTokens(candidateText) +
        USER_MESSAGE_BUDGET_TOKENS;
      const threshold = config.chat.modelContextTokens * config.chat.compactThresholdRatio;
      if (estimated < threshold) return;

      triggeredAt = Date.now();
      logger.info('chat_compaction_triggered', {
        user_id: params.userId,
        conversation_id: conversationId,
        candidate_messages: toCompress.length,
        estimated_tokens: estimated,
      });

      // 5. 通知前端（瞬态，不持久化）
      params.onStatus?.();
    } catch {
      // 读取水位/窗口失败：静默降级，不改摘要、不阻断主模型调用（PRD 4.5）
      logCompactionFailed(params.userId, conversationId, 'db_error');
      return;
    }

    // 阶段 2：非流式压缩（上一版摘要 + 增量旧对话 → 合并为一版）
    const input = state.contextSummary
      ? `## 上一版摘要\n${state.contextSummary}\n\n## 新增的旧对话\n${candidateText}`
      : `## 新增的旧对话\n${candidateText}`;
    const startedAt = triggeredAt || Date.now();
    let completion: { content?: string | null };
    try {
      completion = await llmProvider.complete(
        [
          { role: 'system', content: COMPACTION_PROMPT },
          { role: 'user', content: input },
        ],
        [],
        // 摘要是纯转换任务：关闭思考以把 P95 从 4~8s 压到 <1s（PRD 435 / TC-NFR-081）
        { disableThinking: true }
      );
    } catch {
      // LLM 侧异常（超时/HTTP/重试耗尽）：降级为枚举原因，不落上游错误正文
      logCompactionFailed(params.userId, conversationId, 'llm_error');
      return;
    }

    const summary = truncateSummary((completion.content ?? '').trim(), config.chat.summaryMaxTokens);
    if (!summary) {
      logCompactionFailed(params.userId, conversationId, 'empty_result');
      return;
    }

    // 阶段 3：落库水位与摘要
    const maxId = Math.max(...toCompress.map((row) => Number(row.id)));
    try {
      await query(
        `UPDATE conversations SET context_summary = $2, compacted_until_id = $3 WHERE id = $1`,
        [conversationId, summary, maxId]
      );
    } catch {
      logCompactionFailed(params.userId, conversationId, 'db_error');
      return;
    }

    logger.info('chat_compaction_success', {
      user_id: params.userId,
      conversation_id: conversationId,
      summary_tokens: estimateTokens(summary),
      latency_ms: Date.now() - startedAt,
      compacted_until_id: maxId,
    });
  },

  /**
   * 最终上下文装配（系统设计文档 4.3）。
   * 顺序：[0] system prompt → [1] 记忆分区 → [2] 摘要分区 → [3..] 最近原文窗。
   *
   * v0.5.0 修复（TC-CMP-045/046）：
   * - 取窗下界为 `min(第 keep 条旧界, 交互地板)`：未决 proposal/clarify/scope/confirm
   *   所在消息及其后全部消息必须留在原文窗（floor 约束优先于 keep）；
   * - 已压缩会话若取窗后仍超水位，keep 由最近保留窗向下递减至 CHAT_COMPACT_MIN_KEEP；
   *   仍超（地板撑大窗口的极端情况）则按最小窗发送，不抛错、不重试（请求必须可发出）。
   */
  async composeContext(params: {
    conversationId: number;
    systemPrompt: string;
    memorySection: string;
  }): Promise<LlmMessage[]> {
    const state = await readSummaryState(params.conversationId);
    const hasSummary = Boolean(state.contextSummary);
    // 未压缩会话沿用 CHAT_HISTORY_LIMIT 作为取数上限；已压缩按保留窗
    const keepMax = hasSummary
      ? Math.max(1, config.chat.recentKeep)
      : Math.max(1, config.chat.historyLimit);
    const keepMin = Math.min(keepMax, Math.max(1, config.chat.compactMinKeep));

    // 多取 64 条用于定位交互地板（与 maybeCompact 同口径）
    const window = await recentRows(
      params.conversationId,
      keepMax + 64,
      state.compactedUntilId ?? undefined
    );
    const floorId = interactiveFloor(window);

    /** 取保留窗：尾部 keep 条，并向旧扩展至交互地板（含地板消息本身） */
    const rowsOf = (keep: number): MessageRow[] => {
      const tail = window.slice(-keep);
      const tailStart = tail.length > 0 ? Number(tail[0].id) : Number.POSITIVE_INFINITY;
      const from = floorId != null ? Math.min(tailStart, floorId) : tailStart;
      return Number.isFinite(from) ? window.filter((row) => Number(row.id) >= from) : tail;
    };

    const summarySection = state.contextSummary
      ? `${SUMMARY_SECTION_HEADER}\n${state.contextSummary}`
      : '';
    const overhead =
      estimateTokens(params.systemPrompt) +
      toolsJsonTokens() +
      estimateTokens(params.memorySection) +
      estimateTokens(summarySection) +
      USER_MESSAGE_BUDGET_TOKENS;
    const threshold = config.chat.modelContextTokens * config.chat.compactThresholdRatio;

    let rows = rowsOf(keepMax);
    if (hasSummary) {
      for (let keep = keepMax; keep >= keepMin; keep -= 1) {
        const candidate = rowsOf(keep);
        rows = candidate;
        if (overhead + estimateTokens(transcriptToText(toTranscript(candidate))) < threshold) {
          break;
        }
      }
    }

    const messages: LlmMessage[] = [{ role: 'system', content: params.systemPrompt }];
    if (params.memorySection) messages.push({ role: 'system', content: params.memorySection });
    if (summarySection) messages.push({ role: 'system', content: summarySection });
    messages.push(...transcriptToLlm(toTranscript(rows)));
    return messages;
  },
};