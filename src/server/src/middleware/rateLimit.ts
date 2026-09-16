import type { RequestHandler } from 'express';
import { AppError, ErrorCode } from '../common/errors';
import type { AuthedRequest } from './auth';

interface Bucket {
  count: number;
  resetAt: number;
}

/**
 * 内存滑动窗口限流。MVP 单实例够用；多实例需替换为 Redis 实现。
 */
export function rateLimit(options: {
  windowMs: number;
  max: number;
  keyOf: (req: AuthedRequest) => string;
  message?: string;
}): RequestHandler {
  const buckets = new Map<string, Bucket>();

  setInterval(() => {
    const now = Date.now();
    for (const [key, bucket] of buckets) {
      if (bucket.resetAt <= now) buckets.delete(key);
    }
  }, 60_000).unref();

  return (req, res, next) => {
    const key = options.keyOf(req as AuthedRequest);
    const now = Date.now();
    const bucket = buckets.get(key);

    if (!bucket || bucket.resetAt <= now) {
      buckets.set(key, { count: 1, resetAt: now + options.windowMs });
      return next();
    }

    bucket.count += 1;
    if (bucket.count > options.max) {
      const retryAfter = Math.ceil((bucket.resetAt - now) / 1000);
      res.setHeader('Retry-After', String(retryAfter));
      return next(
        new AppError(
          ErrorCode.TOO_MANY_REQUESTS,
          options.message || '请求过于频繁，请稍后再试'
        )
      );
    }
    next();
  };
}

export function clientIp(req: AuthedRequest): string {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.length > 0) {
    return forwarded.split(',')[0].trim();
  }
  return req.ip || 'unknown';
}