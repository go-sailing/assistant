/**
 * 业务错误码，与系统设计文档 9.1 节保持一致。
 */
export const ErrorCode = {
  OK: 0,
  PARAM_INVALID: 1001,
  UNAUTHORIZED: 1002,
  FORBIDDEN: 1003,
  NOT_FOUND: 1004,
  CONFLICT: 1005,
  TOO_MANY_REQUESTS: 1006,
  BAD_CREDENTIALS: 2001,
  LLM_UNAVAILABLE: 3001,
  TOOL_EXEC_FAILED: 3002,
  PENDING_ACTION_INVALID: 3003,
} as const;

export type ErrorCodeValue = (typeof ErrorCode)[keyof typeof ErrorCode];

const HTTP_STATUS: Record<number, number> = {
  [ErrorCode.PARAM_INVALID]: 400,
  [ErrorCode.UNAUTHORIZED]: 401,
  [ErrorCode.FORBIDDEN]: 403,
  [ErrorCode.NOT_FOUND]: 404,
  [ErrorCode.CONFLICT]: 409,
  [ErrorCode.TOO_MANY_REQUESTS]: 429,
  [ErrorCode.BAD_CREDENTIALS]: 401,
  [ErrorCode.LLM_UNAVAILABLE]: 502,
  [ErrorCode.TOOL_EXEC_FAILED]: 500,
  [ErrorCode.PENDING_ACTION_INVALID]: 409,
};

export class AppError extends Error {
  readonly code: number;
  readonly httpStatus: number;
  readonly details?: unknown;

  constructor(code: number, message: string, details?: unknown) {
    super(message);
    this.code = code;
    this.httpStatus = HTTP_STATUS[code] ?? 500;
    this.details = details;
  }

  static paramInvalid(message: string, details?: unknown) {
    return new AppError(ErrorCode.PARAM_INVALID, message, details);
  }
  static unauthorized(message = '未登录或登录已失效') {
    return new AppError(ErrorCode.UNAUTHORIZED, message);
  }
  static forbidden(message = '无权访问该资源') {
    return new AppError(ErrorCode.FORBIDDEN, message);
  }
  static notFound(message = '资源不存在') {
    return new AppError(ErrorCode.NOT_FOUND, message);
  }
  static conflict(message: string) {
    return new AppError(ErrorCode.CONFLICT, message);
  }
  static badCredentials() {
    // 统一文案，避免账号枚举
    return new AppError(ErrorCode.BAD_CREDENTIALS, '邮箱或密码错误');
  }
  static llmUnavailable(message = '助手暂时不可用，请稍后重试') {
    return new AppError(ErrorCode.LLM_UNAVAILABLE, message);
  }
  static toolExecFailed(message = '操作执行失败，请重试') {
    return new AppError(ErrorCode.TOOL_EXEC_FAILED, message);
  }
  static pendingActionInvalid(message = '该操作已失效，请重新发起') {
    return new AppError(ErrorCode.PENDING_ACTION_INVALID, message);
  }
}