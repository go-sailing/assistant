import type { EventDTO, OccurrenceDTO, SeriesDTO } from '../event/types';
import type { LlmMessage } from '../../llm/types';
import type { MessageBlock, MessageRow } from './chat.types';

/**
 * v0.5.0 消息转录（系统设计文档 4.2）：压缩与归档共用的纯函数。
 *
 * 与 v0.4.0 buildHistory 的原则一致：**不回放历史工具调用与原始工具返回**
 * （避免与云端最新数据状态不一致），只把助手文本与「本轮涉及对象」的真实 ID 锚点
 * 拼成紧凑文本，使「把它改成下午多」这类指代能在多轮中解析到真实对象。
 *
 * 工具原始 JSON、cards 完整 DTO 不参与转录：防止陈旧快照污染摘要与长期记忆。
 *
 * v0.9.0：任务 / 项目对象锚点已删除，只保留日程 / 系列 / 实例 / 作用域 / 方案锚点。
 */

export interface TranscriptItem {
  id: number;
  role: 'user' | 'assistant';
  text: string;
}

/** 助手消息中的文本块拼接 + 对象锚点附录（hint 格式沿用 v0.4.0，真实 ID 必须保留） */
export function renderAssistantText(blocks: MessageBlock[]): string {
  const text = blocks
    .filter((b): b is Extract<MessageBlock, { type: 'text' }> => b.type === 'text')
    .map((b) => b.text)
    .join('\n')
    .trim();

  const referencedEvents: EventDTO[] = [];
  const referencedSeries: SeriesDTO[] = [];
  const referencedOccurrences: OccurrenceDTO[] = [];
  const referencedScopes: Array<{ tool: string; seriesId: number; occurrenceKey: string | null }> = [];
  const referencedProposals: Array<{ title: string; params: Array<{ label: string; value: string }> }> = [];
  for (const block of blocks) {
    if (block.type === 'cards') {
      referencedEvents.push(...(block.events ?? []));
      referencedSeries.push(...(block.series ?? []));
      referencedOccurrences.push(...(block.occurrences ?? []));
    } else if (block.type === 'clarify') {
      referencedEvents.push(...(block.events ?? []));
    } else if (block.type === 'confirm') {
      referencedEvents.push(...(block.affected_events ?? []));
    } else if (block.type === 'scope') {
      // 作用域澄清未选择时，下一轮必须还能定位到同一系列/实例（TC-CHAT-108）
      referencedScopes.push({
        tool: block.tool,
        seriesId: block.ref.series_id,
        occurrenceKey: block.ref.occurrence_key ?? null,
      });
    } else if (block.type === 'proposal') {
      // 方案卡参数不回放时，用户说「就这么办」后模型无法按原参数执行 → 必须转录
      referencedProposals.push({ title: block.title, params: block.params });
    }
  }

  // 把日程 ID 一并喂给模型，使「把它改到下午4点」这类指代能在多轮中解析到真实 event_id
  const eventHint = referencedEvents.length
    ? `\n[本轮涉及的日程] ${referencedEvents
        .map((e) => `#${e.id} ${e.title}（${e.start_at}~${e.end_at}）`)
        .join('；')}`
    : '';
  // v0.2.0：系列与实例身份必须回灌，否则模型无法正确传 occurrence_key
  const seriesHint = referencedSeries.length
    ? `\n[本轮涉及的循环日程] ${referencedSeries
        .map(
          (s) =>
            `series#${s.id} ${s.title}（${s.recurrence_summary}，下一次 ${s.next_occurrence ?? '已无'}，共 ${s.total_count} 次）`
        )
        .join('；')}`
    : '';
  const occurrenceHint = referencedOccurrences.length
    ? `\n[本轮涉及的循环实例] ${referencedOccurrences
        .map(
          (o) =>
            `series#${o.series_id} occurrence_key=${o.occurrence_key} ${o.title}（${o.start_at}~${o.end_at}${
              o.override_state === 'modified'
                ? '，已调整'
                : o.override_state === 'cancelled'
                  ? '，已取消'
                  : ''
            }）`
        )
        .join('；')}`
    : '';
  const scopeHint = referencedScopes.length
    ? `\n[待用户确认的作用域] ${referencedScopes
        .map(
          (s) =>
            `${s.tool} series#${s.seriesId}${s.occurrenceKey ? ` occurrence_key=${s.occurrenceKey}` : ''}（用户还没选作用域，继续沿用这条上下文，不要换成别的日程）`
        )
        .join('；')}`
    : '';
  // 方案卡：参数必须随转录回放，用户确认「就这么办」时按同一参数执行（服务端门控照旧）
  const proposalHint = referencedProposals.length
    ? `\n[助手给出的方案卡参数] ${referencedProposals
        .map((p) => `「${p.title}」${p.params.map((x) => `${x.label}：${x.value}`).join('；')}`)
        .join('；')}（用户确认后按这些参数执行）`
    : '';

  return `${text}${eventHint}${seriesHint}${occurrenceHint}${scopeHint}${proposalHint}`.trim();
}

/** 消息行 → 给 LLM 阅读的紧凑转录（保持传入顺序） */
export function toTranscript(rows: MessageRow[]): TranscriptItem[] {
  const items: TranscriptItem[] = [];
  for (const row of rows) {
    if (row.role === 'user') {
      items.push({ id: Number(row.id), role: 'user', text: row.content ?? '' });
      continue;
    }
    if (row.role !== 'assistant') continue;
    const text = renderAssistantText(row.payload?.blocks ?? []);
    if (text) items.push({ id: Number(row.id), role: 'assistant', text });
  }
  return items;
}

/** 转录 → 模型消息（压缩与归档共用） */
export function transcriptToLlm(items: TranscriptItem[]): LlmMessage[] {
  return items.map((item) => ({ role: item.role, content: item.text }));
}

/** 转录 → 纯文本（归档提取的输入） */
export function transcriptToText(items: TranscriptItem[]): string {
  return items
    .map((item) => `${item.role === 'user' ? '用户' : '助手'}：${item.text}`)
    .join('\n\n');
}

/**
 * 交互硬边界（系统设计文档 4.2）：返回必须留在原文窗的消息 id 下界。
 *
 * 从新到旧扫描，最近一条含 proposal / clarify / scope / confirm 块的助手消息即为地板：
 * 该消息及其后全部消息不得压入摘要。proposal 的"仍可确认"状态不可靠判定，
 * 因此采取保守策略——只要存在该类块消息即作为地板，宁可少压，绝不压掉未决交互。
 */
export function interactiveFloor(rows: MessageRow[]): number | null {
  const FLOOR_BLOCK_TYPES = new Set(['proposal', 'clarify', 'scope', 'confirm']);
  for (let i = rows.length - 1; i >= 0; i -= 1) {
    const row = rows[i];
    if (row.role !== 'assistant') continue;
    const blocks = row.payload?.blocks ?? [];
    if (blocks.some((b) => FLOOR_BLOCK_TYPES.has(b.type))) return Number(row.id);
  }
  return null;
}
