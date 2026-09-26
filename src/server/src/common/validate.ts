import { z } from 'zod';
import { AppError } from './errors';

/** 用 zod 校验并转换请求参数，失败抛出字段级错误 */
export function parse<T extends z.ZodTypeAny>(schema: T, input: unknown, label = '参数'): z.infer<T> {
  const result = schema.safeParse(input);
  if (!result.success) {
    const details = result.error.issues.map((issue) => ({
      field: issue.path.join('.') || label,
      message: issue.message,
    }));
    throw new AppError(
      1001,
      `${label}校验失败：${details.map((d) => `${d.field} ${d.message}`).join('；')}`,
      details
    );
  }
  return result.data;
}

/** 路径参数中的自增 ID */
export const idParam = z.coerce.number().int().positive();

/**
 * 可选的 ID 字段：兼容前端可能传来的数字字符串（如选择器 value），
 * 空串/null 视为未指定。
 */
export const optionalId = z.preprocess(
  (v) => (v === null || v === undefined || v === '' ? null : Number(v)),
  z.union([z.number().int().positive(), z.null()])
);

/**
 * v0.9.0：任务 / 清单 / 项目 / 智能体领域字段已下线。
 * 携带下列字段的请求一律显式拒绝（1001），比静默忽略更早暴露旧客户端
 * （沿用 v0.7.0「显式拒绝优于静默忽略」口径，SDD 8.2 / T5）。
 */
const RETIRED_EVENT_KEYS = ['event_type', 'task_id', 'taskId'] as const;
const RETIRED_PARAM_KEYS = [
  'list_id',
  'list_name',
  'listId',
  'listName',
  'task_type',
  'taskType',
  'priority',
  'status',
  'parent_id',
  'due_at',
  'agent_id',
  'agent_name',
  'agent_state',
] as const;

export function rejectRetiredParams(input: unknown, label = '参数'): void {
  if (!input || typeof input !== 'object') return;
  for (const key of [...RETIRED_EVENT_KEYS, ...RETIRED_PARAM_KEYS]) {
    if (Object.prototype.hasOwnProperty.call(input, key)) {
      throw new AppError(1001, `${label}校验失败：不支持 ${key}（该能力已下线）`, [
        { field: key, message: '不支持的参数' },
      ]);
    }
  }
}