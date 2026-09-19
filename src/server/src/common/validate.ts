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