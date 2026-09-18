import { logger } from '../../common/logger';
import { config } from '../../config';
import { llmProvider } from '../../llm/deepseek';
import { EXTRACT_MEMORY_PROMPT, MERGE_MEMORY_PROMPT } from '../../llm/prompt';
import type { LlmMessage } from '../../llm/types';
import {
  CATEGORY_LABELS,
  extractEnvelope,
  extractedItem,
  extractedUpdate,
  mergeEnvelope,
  parseLlmJson,
  type ExtractedItem,
  type ExtractedUpdate,
  type MemoryCategory,
  type MemoryRow,
  type MergeResult,
} from './memory.schema';

/**
 * v0.5.0 记忆的敏感过滤与去重合并（系统设计文档 5.3）。
 *
 * 敏感过滤是「提示词 + 正则」双层中的正则层：任一层命中即不保存该候选。
 * 命中只记计数（info），不记正文与命中片段（9.3 日志卫生）。
 */
const SENSITIVE_PATTERNS: RegExp[] = [
  /密码|password|passwd|验证码|动态码/i, // 凭证语义
  /\b\d{17}[\dXx]\b/, // 身份证号
  /\b\d{12,19}\b/, // 银行卡类长数字（独立成串）
  /\b1[3-9]\d{9}\b/, // 手机号
  /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/, // 邮箱地址
];

/** 是否命中敏感模式（命中即丢弃该候选） */
export function isSensitive(text: string): boolean {
  return SENSITIVE_PATTERNS.some((re) => re.test(text));
}

/** 归一化：trim + 合并连续空白（用于去重比较与落库前清洗） */
function normalize(text: string): string {
  return text.trim().replace(/\s+/g, ' ');
}

/**
 * 候选清洗：归一化 → 长度复校 → 敏感过滤 → 内存归一化去重 → 批次上限。
 * 返回清洗后的候选与本次过滤计数（用于埋点 memory_sensitive_filtered）。
 */
export function sanitizeCandidates(items: ExtractedItem[]): {
  candidates: ExtractedItem[];
  filtered: number;
} {
  const seen = new Set<string>();
  const candidates: ExtractedItem[] = [];
  let filtered = 0;

  for (const item of items) {
    const content = normalize(item.content);
    if (content.length < 4 || content.length > 500) {
      filtered += 1;
      continue;
    }
    if (isSensitive(content)) {
      filtered += 1;
      continue;
    }
    const key = content.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    candidates.push({ content, category: item.category });
    if (candidates.length >= config.memory.archiveBatchLimit) break;
  }

  if (filtered > 0) {
    // 只记计数，不记正文与命中片段
    logger.info('memory_sensitive_filtered', { count: filtered });
  }
  return { candidates, filtered };
}

/**
 * 逐条过滤 create 候选：非法条目丢弃、按批次上限截断（保留前 N 条合法项，顺序不变）。
 * TC-MEM-038/040：数组级校验会让单条越界拖垮整批，这里改为按条过滤。
 */
function filterCreates(raw: unknown[]): ExtractedItem[] {
  const items: ExtractedItem[] = [];
  for (const one of raw) {
    const parsed = extractedItem.safeParse(one);
    if (!parsed.success) continue;
    items.push(parsed.data);
    if (items.length >= config.memory.archiveBatchLimit) break;
  }
  return items;
}

/** 逐条过滤 update 行（id 归属仍在 memory.service 用 ownedIds 二次校验） */
function filterUpdates(raw: unknown[]): ExtractedUpdate[] {
  const items: ExtractedUpdate[] = [];
  for (const one of raw) {
    const parsed = extractedUpdate.safeParse(one);
    if (!parsed.success) continue;
    items.push(parsed.data);
    if (items.length >= config.memory.archiveBatchLimit) break;
  }
  return items;
}

/** 逐条过滤 drop id：仅保留正整数，最多 100 条 */
function filterDrops(raw: unknown[]): number[] {
  const ids: number[] = [];
  for (const one of raw) {
    if (typeof one !== 'number' || !Number.isInteger(one) || one <= 0) continue;
    ids.push(one);
    if (ids.length >= 100) break;
  }
  return ids;
}

/** 阶段 A 输入：全量转录文本 → 候选记忆（信封解析失败返回 null） */
export async function extractMemories(transcript: string): Promise<ExtractedItem[] | null> {
  const messages: LlmMessage[] = [
    { role: 'system', content: EXTRACT_MEMORY_PROMPT },
    { role: 'user', content: transcript },
  ];
  const result = await llmProvider.complete(messages);
  const parsed = parseLlmJson(result.content ?? '', extractEnvelope);
  if (!parsed) return null;
  const before = parsed.memories.length;
  const items = filterCreates(parsed.memories);
  // 只记计数，不记正文/片段（日志卫生）
  if (items.length !== before) {
    logger.info('memory_extract_items_dropped', { dropped: before - items.length });
  }
  return items;
}

/**
 * 阶段 B：与存量记忆做语义去重合并（仅当用户已有记忆时调用）。
 * LLM 失败向上抛出（归档失败、不清空）；信封解析失败返回 null。
 */
export async function mergeMemories(
  existing: MemoryRow[],
  candidates: ExtractedItem[]
): Promise<MergeResult | null> {
  const existingText = existing
    .map((m) => `- id=${Number(m.id)}（${CATEGORY_LABELS[m.category as MemoryCategory] ?? m.category}）${m.content}`)
    .join('\n');
  const candidateText = candidates
    .map((c, i) => `${i + 1}. （${CATEGORY_LABELS[c.category] ?? c.category}）${c.content}`)
    .join('\n');

  const messages: LlmMessage[] = [
    { role: 'system', content: MERGE_MEMORY_PROMPT },
    {
      role: 'user',
      content: `## 已有记忆\n${existingText}\n\n## 本次新提取的候选\n${candidateText}`,
    },
  ];
  const result = await llmProvider.complete(messages);
  const parsed = parseLlmJson(result.content ?? '', mergeEnvelope);
  if (!parsed) return null;
  return {
    create: filterCreates(parsed.create),
    update: filterUpdates(parsed.update),
    drop_duplicate_ids: filterDrops(parsed.drop_duplicate_ids),
  };
}