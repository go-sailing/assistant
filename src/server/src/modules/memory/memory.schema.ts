import { z } from 'zod';

/**
 * v0.5.0 长期记忆的结构约束（系统设计文档 5.1 / 5.2）。
 *
 * LLM 输出统一走「本地解析 + zod 校验」：不依赖 JSON 模式参数，
 * 解析容错（剥离 ```json 围栏、截取首末大括号）在此文件完成，
 * 失败按「归档失败」同等处理（不清空消息，见 memory.service）。
 */

export const MEMORY_CATEGORIES = [
  'profile',
  'preference',
  'routine',
  'objects',
  'context',
  'other',
] as const;

export type MemoryCategory = (typeof MEMORY_CATEGORIES)[number];

/** 类别中文名（记忆页与提示词共用同一映射） */
export const CATEGORY_LABELS: Record<MemoryCategory, string> = {
  profile: '个人情况',
  preference: '时间偏好',
  routine: '固定作息',
  objects: '常用对象',
  context: '长期事项',
  other: '其他',
};

export const categoryEnum = z.enum(MEMORY_CATEGORIES);

/** 单条记忆：自包含陈述句，4~500 字（与迁移 010 的 CHECK 一致） */
export const memoryContent = z.string().min(4).max(500);

export const extractedItem = z.object({
  content: memoryContent,
  category: categoryEnum,
});

export type ExtractedItem = z.infer<typeof extractedItem>;

/** 合并器的 update 行（必须带存量记忆 id） */
export const extractedUpdate = z.object({
  id: z.number().int().positive(),
  content: memoryContent,
  category: categoryEnum,
});

export type ExtractedUpdate = z.infer<typeof extractedUpdate>;

/**
 * 阶段 A：提取结果**信封**（TC-MEM-038/040 修复）。
 *
 * 只校验「memories 是数组」这一层，单条合法性由 memory.merge 逐条 safeParse 过滤：
 * 模型多返回（>30 条）或个别条目越界（不足 4 字、非法类别）时，只丢弃越界条目并
 * 按批次上限截断，不再因数组级校验失败导致整次归档失败。
 */
export const extractEnvelope = z.object({
  memories: z.array(z.unknown()),
});

/**
 * 阶段 B：去重合并结果**信封**（同理由：create/update/drop 逐条过滤，
 * 单条幻觉 id 或非法类别不拖垮整批）。
 */
export const mergeEnvelope = z.object({
  create: z.array(z.unknown()),
  update: z.array(z.unknown()),
  drop_duplicate_ids: z.array(z.unknown()),
});

/** 去重合并结果（逐条过滤后的强类型） */
export interface MergeResult {
  create: ExtractedItem[];
  update: ExtractedUpdate[];
  drop_duplicate_ids: number[];
}

/** 记忆行（long_term_memories） */
export interface MemoryRow {
  id: number;
  user_id: number;
  content: string;
  category: string;
  created_at: Date;
  updated_at: Date;
  last_used_at: Date | null;
}

/** 对外的记忆 DTO（不下发 user_id / last_used_at） */
export interface MemoryDTO {
  id: number;
  content: string;
  category: string;
  created_at: string;
  updated_at: string;
}

export function toMemoryDTO(row: MemoryRow): MemoryDTO {
  return {
    id: Number(row.id),
    content: row.content,
    category: row.category,
    created_at: row.created_at.toISOString(),
    updated_at: row.updated_at.toISOString(),
  };
}

/**
 * 解析 LLM 的 JSON 输出：
 * 1）剥离 ```json / ``` 代码围栏；2）截取首个 `{` 到末个 `}`；
 * 3）JSON.parse 后用 zod 校验，任一步失败返回 null（由调用方按归档失败处理）。
 */
export function parseLlmJson<T extends z.ZodTypeAny>(raw: string, schema: T): z.infer<T> | null {
  if (!raw) return null;
  let text = raw.trim();
  const fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  if (fence && fence[1]) text = fence[1].trim();
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
  const result = schema.safeParse(parsed);
  return result.success ? (result.data as z.infer<T>) : null;
}