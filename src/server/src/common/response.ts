import type { Response, Request, RequestHandler } from 'express';
import { AppError, ErrorCode } from './errors';

export function ok<T>(res: Response, data: T, message = 'ok'): void {
  res.json({ code: ErrorCode.OK, message, data: data ?? null });
}

export function fail(res: Response, code: number, message: string, details?: unknown): void {
  const status = code === ErrorCode.PARAM_INVALID ? 400 : 500;
  res.status(status).json({ code, message, details: details ?? null });
}

/** 包装异步路由处理器，把异常交给统一错误中间件 */
export function asyncHandler(
  fn: (req: Request, res: Response) => Promise<unknown> | unknown
): RequestHandler {
  return (req, res, next) => {
    Promise.resolve(fn(req, res)).catch(next);
  };
}

export { AppError };