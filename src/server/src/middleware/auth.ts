import type { Request, Response, NextFunction, RequestHandler } from 'express';
import jwt from 'jsonwebtoken';
import { randomUUID } from 'crypto';
import { config } from '../config';
import { AppError, ErrorCode } from '../common/errors';
import { logger } from '../common/logger';

export interface AuthUser {
  id: number;
  email: string;
  jti: string;
  exp: number;
}

export interface AuthedRequest extends Request {
  user?: AuthUser;
  traceId?: string;
}

/**
 * 已失效令牌（登出）黑名单。
 * MVP 单实例部署使用内存实现，重启即清空；多实例需替换为 Redis。
 */
const revokedTokens = new Map<string, number>();

export function revokeToken(jti: string, expiresAtSeconds: number): void {
  revokedTokens.set(jti, expiresAtSeconds * 1000);
}

export function issueToken(userId: number, email: string): string {
  return jwt.sign({ sub: String(userId), email }, config.jwt.secret, {
    expiresIn: config.jwt.expiresIn,
    jwtid: randomUUID(),
  } as jwt.SignOptions);
}

// 定期清理过期黑名单记录
setInterval(() => {
  const now = Date.now();
  for (const [jti, expireAt] of revokedTokens) {
    if (expireAt <= now) revokedTokens.delete(jti);
  }
}, 60_000).unref();

export const traceMiddleware: RequestHandler = (req: Request, res: Response, next: NextFunction) => {
  const traceId = randomUUID();
  (req as AuthedRequest).traceId = traceId;
  res.setHeader('X-Trace-Id', traceId);
  next();
};

export const authMiddleware: RequestHandler = (req: Request, _res: Response, next: NextFunction) => {
  const authed = req as AuthedRequest;
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';

  if (!token) {
    return next(AppError.unauthorized());
  }

  try {
    const payload = jwt.verify(token, config.jwt.secret) as jwt.JwtPayload;
    const jti = payload.jti as string;
    if (jti && revokedTokens.has(jti)) {
      return next(AppError.unauthorized('登录已失效，请重新登录'));
    }
    authed.user = {
      id: Number(payload.sub),
      email: String(payload.email),
      jti,
      exp: Number(payload.exp),
    };
    next();
  } catch {
    next(AppError.unauthorized('登录已失效，请重新登录'));
  }
};

export function getUser(req: Request): AuthUser {
  const user = (req as AuthedRequest).user;
  if (!user) throw AppError.unauthorized();
  return user;
}

/** 统一错误处理中间件：输出 { code, message, details } */
export const errorHandler = (
  err: unknown,
  req: Request,
  res: Response,
  _next: NextFunction
): void => {
  const authed = req as AuthedRequest;

  if (err instanceof AppError) {
    if (err.httpStatus >= 500) {
      logger.error('请求处理失败', {
        trace_id: authed.traceId,
        route: req.originalUrl,
        error_code: err.code,
        error: err.message,
      });
    } else {
      logger.warn('请求被拒绝', {
        trace_id: authed.traceId,
        route: req.originalUrl,
        error_code: err.code,
        error: err.message,
      });
    }
    res.status(err.httpStatus).json({
      code: err.code,
      message: err.message,
      details: err.details ?? null,
    });
    return;
  }

  const message = err instanceof Error ? err.message : String(err);
  logger.error('未预期异常', {
    trace_id: authed.traceId,
    route: req.originalUrl,
    error: message,
    stack: err instanceof Error ? err.stack : undefined,
  });
  res.status(500).json({ code: ErrorCode.TOOL_EXEC_FAILED, message: '服务器内部错误', details: null });
};