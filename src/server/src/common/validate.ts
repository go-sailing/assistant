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

export const priorityEnum = z.enum(['none', 'low', 'medium', 'high']);
export const statusEnum = z.enum(['todo', 'completed']);
/** v0.6.0 任务类型：normal 普通任务 / project 项目任务 */
export const taskTypeEnum = z.enum(['normal', 'project']);

/* ---------------- v0.7.0 智能体代理 ---------------- */

/** 代理类型：预设工具 + 自定义 */
export const agentKindEnum = z.enum(['claude_code', 'opencode', 'pi_agent', 'custom']);
/** 代理执行状态（任务维度） */
export const agentStateEnum = z.enum(['none', 'pending', 'running', 'succeeded', 'failed']);

/**
 * v0.7.0：清单功能已下线，携带清单字段一律显式拒绝（PRD 8.2 / SDD 12.7）。
 * 采用"局部拒绝"而非整对象 strict，避免误伤未来的合法扩展字段。
 */
const LEGACY_LIST_KEYS = ['list_id', 'list_name', 'listId', 'listName'] as const;

export function rejectListParams(input: unknown, label = '参数'): void {
  if (!input || typeof input !== 'object') return;
  for (const key of LEGACY_LIST_KEYS) {
    if (Object.prototype.hasOwnProperty.call(input, key)) {
      throw new AppError(
        1001,
        `${label}校验失败：不支持 ${key}（清单功能已下线）`,
        [{ field: key, message: '不支持的参数' }]
      );
    }
  }
}