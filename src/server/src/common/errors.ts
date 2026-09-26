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
  // v0.2.0 循环日程 / 子任务领域
  TASK_CASCADE_REQUIRED: 4010,
  RECURRENCE_INVALID: 4011,
  OCCURRENCE_NOT_FOUND: 4012,
  SUBTASK_DEPTH_EXCEEDED: 4013,
  SUBTASK_LIST_MISMATCH: 4014,
  SUBTASK_CYCLE: 4015,
  RECURRENCE_NOT_SUPPORTED: 4016,
  // v0.6.0 项目领域
  PROJECT_INVALID_STATE: 4017,
  SUBTASK_NOT_SUPPORTED: 4018,
  // v0.7.0 智能体代理领域
  AGENT_UNAUTHORIZED: 4019,
  AGENT_TASK_CONFLICT: 4020,
  AGENT_TASK_INVALID_STATE: 4021,
  AGENT_LIMIT_EXCEEDED: 4022,
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
  [ErrorCode.TASK_CASCADE_REQUIRED]: 409,
  [ErrorCode.RECURRENCE_INVALID]: 400,
  [ErrorCode.OCCURRENCE_NOT_FOUND]: 404,
  [ErrorCode.SUBTASK_DEPTH_EXCEEDED]: 409,
  [ErrorCode.SUBTASK_LIST_MISMATCH]: 409,
  [ErrorCode.SUBTASK_CYCLE]: 409,
  [ErrorCode.RECURRENCE_NOT_SUPPORTED]: 409,
  [ErrorCode.PROJECT_INVALID_STATE]: 409,
  [ErrorCode.SUBTASK_NOT_SUPPORTED]: 409,
  // v0.7.0：代理凭据失败为 401（协议层鉴权），其余为业务冲突
  [ErrorCode.AGENT_UNAUTHORIZED]: 401,
  [ErrorCode.AGENT_TASK_CONFLICT]: 409,
  [ErrorCode.AGENT_TASK_INVALID_STATE]: 409,
  [ErrorCode.AGENT_LIMIT_EXCEEDED]: 409,
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
  /**
   * v0.8.0：任务 / 项目 / 智能体能力已下线，下列错误码保留编号与 HTTP 映射
   * （兼容旧客户端解析），但失去触发面，对应 AppError 工厂已删除：
   * 4002 / 4003 / 4010 / 4013 / 4014 / 4015 / 4016 / 4017 / 4018 / 4019 / 4020 / 4021 / 4022。
   */
  /** 时间冲突待确认：details 携带冲突日程列表 */
  static eventConflict(conflicts: unknown, conflictLevel: string, extra?: Record<string, unknown>) {
    return new AppError(ErrorCode.EVENT_CONFLICT, '该时段与已有日程冲突', {
      conflicts,
      conflict_level: conflictLevel,
      ...extra,
    });
  }
  /** 循环冲突待确认：details 携带按日期分组的冲突 */
  static seriesConflict(details: {
    conflict_level: string;
    conflict_dates: unknown;
    conflict_dates_total: number;
    conflict_total: number;
  }) {
    return new AppError(ErrorCode.EVENT_CONFLICT, '该循环在多个日期与已有日程冲突', {
      scope: 'series',
      ...details,
    });
  }
  /** 循环规则非法 */
  static recurrenceInvalid(reason: string) {
    return new AppError(ErrorCode.RECURRENCE_INVALID, `重复规则不合法：${reason}`, {
      reason,
    });
  }
  /** 循环实例不存在（occurrence_key 在规则下无对应实例） */
  static occurrenceNotFound(message = '未找到该次安排') {
    return new AppError(ErrorCode.OCCURRENCE_NOT_FOUND, message);
  }
}