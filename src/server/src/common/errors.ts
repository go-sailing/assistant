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
  // v0.1.0 日程领域
  EVENT_TIME_INVALID: 4001,
  EVENT_TASK_NOT_SCHEDULABLE: 4002,
  EVENT_TYPE_IMMUTABLE: 4003,
  EVENT_CONFLICT: 4009,
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
  [ErrorCode.EVENT_TIME_INVALID]: 400,
  [ErrorCode.EVENT_TASK_NOT_SCHEDULABLE]: 409,
  [ErrorCode.EVENT_TYPE_IMMUTABLE]: 409,
  [ErrorCode.EVENT_CONFLICT]: 409,
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
  /** 日程时间非法（结束早于开始、全天日期倒置） */
  static eventTimeInvalid(message = '日程时间不合法') {
    return new AppError(ErrorCode.EVENT_TIME_INVALID, message);
  }
  /** 关联任务不可排期（已完成任务） */
  static eventTaskNotSchedulable(message = '该任务已完成，请先恢复为未完成再安排日程') {
    return new AppError(ErrorCode.EVENT_TASK_NOT_SCHEDULABLE, message);
  }
  /** 日程类型与关联任务创建后不可变更 */
  static eventTypeImmutable(message = '日程类型与关联任务创建后不可更改，请删除后重建') {
    return new AppError(ErrorCode.EVENT_TYPE_IMMUTABLE, message);
  }
  /** 时间冲突待确认：details 携带冲突日程列表 */
  static eventConflict(conflicts: unknown, conflictLevel: string) {
    return new AppError(ErrorCode.EVENT_CONFLICT, '该时段与已有日程冲突', {
      conflicts,
      conflict_level: conflictLevel,
    });
  }
}