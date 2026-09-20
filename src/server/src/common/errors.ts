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
  /** @deprecated v0.8.0 失去触发面：项目已非任务，不存在「级联完成」流程（编号保留，工厂保留） */
  TASK_CASCADE_REQUIRED: 4010,
  RECURRENCE_INVALID: 4011,
  OCCURRENCE_NOT_FOUND: 4012,
  SUBTASK_DEPTH_EXCEEDED: 4013,
  SUBTASK_LIST_MISMATCH: 4014,
  SUBTASK_CYCLE: 4015,
  RECURRENCE_NOT_SUPPORTED: 4016,
  // v0.6.0 项目领域
  /** @deprecated v0.8.0 失去触发面：项目已独立建表，「项目任务须为顶层」不再可能出现（编号保留） */
  PROJECT_INVALID_STATE: 4017,
  /** @deprecated v0.8.0 失去触发面：无层级概念，「普通任务不支持子任务」不再可能出现（编号保留） */
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
  /** 关联任务不可排期（v0.8.0 双文案：已完成任务 / 指向项目 id） */
  static eventTaskNotSchedulable(message = '该任务已完成，请先恢复为未完成再安排日程') {
    return new AppError(ErrorCode.EVENT_TASK_NOT_SCHEDULABLE, message);
  }
  /** 日程类型与关联任务创建后不可变更 */
  static eventTypeImmutable(message = '日程类型与关联任务创建后不可更改，请删除后重建') {
    return new AppError(ErrorCode.EVENT_TYPE_IMMUTABLE, message);
  }
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
  /**
   * @deprecated v0.8.0 失去触发面：项目状态由成员完成度派生（ProjectService.recalcStatus），
   * 不存在「完成项目需级联确认」的交互；工厂保留仅为编号与历史调用兼容。
   */
  static taskCascadeRequired(incompleteMemberCount: number) {
    return new AppError(ErrorCode.TASK_CASCADE_REQUIRED, '还有未完成的项目成员', {
      incomplete_member_count: incompleteMemberCount,
      // 兼容别名：保留一个大版本
      incomplete_descendant_count: incompleteMemberCount,
      cascade_required: true,
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
  /** 子任务层级超过上限 */
  static subtaskDepthExceeded(maxDepth: number) {
    return new AppError(
      ErrorCode.SUBTASK_DEPTH_EXCEEDED,
      `子任务最多支持 ${maxDepth} 级`,
      { max_depth: maxDepth }
    );
  }
  /** 子任务必须与根任务在同一清单 */
  static subtaskListMismatch() {
    return new AppError(ErrorCode.SUBTASK_LIST_MISMATCH, '成员任务必须与项目在同一清单');
  }
  /** 不能移动到自身或自己的子任务下 */
  static subtaskCycle() {
    return new AppError(ErrorCode.SUBTASK_CYCLE, '不能把任务移动到它自己或它的子任务下');
  }
  /** 任务日程不支持循环 */
  static recurrenceNotSupported() {
    return new AppError(
      ErrorCode.RECURRENCE_NOT_SUPPORTED,
      '任务日程不支持重复，只能创建单次安排'
    );
  }
  /** @deprecated v0.8.0 失去触发面：项目已独立建表，不接受挂载操作（编号保留） */
  static projectInvalidState(message = '项目任务不能挂到其他任务下，项目须为顶层任务') {
    return new AppError(ErrorCode.PROJECT_INVALID_STATE, message);
  }
  /** @deprecated v0.8.0 失去触发面：模型上无任务层级概念（编号保留） */
  static subtaskNotSupported(message = '普通任务不支持子任务，仅项目可包含任务') {
    return new AppError(ErrorCode.SUBTASK_NOT_SUPPORTED, message);
  }
  /** v0.7.0：代理凭据无效/已重置/代理已停用或已删除 */
  static agentUnauthorized(message = '代理凭据无效或已失效') {
    return new AppError(ErrorCode.AGENT_UNAUTHORIZED, message);
  }
  /** v0.7.0：领取冲突（已被领取、重复领取、并发未抢到） */
  static agentTaskConflict(message = '该任务已被其他代理领取') {
    return new AppError(ErrorCode.AGENT_TASK_CONFLICT, message);
  }
  /** v0.7.0：当前状态不允许该代理操作 */
  static agentTaskInvalidState(message: string, details?: unknown) {
    return new AppError(ErrorCode.AGENT_TASK_INVALID_STATE, message, details);
  }
  /** v0.7.0：代理数或待执行队列超出上限 */
  static agentLimitExceeded(message: string) {
    return new AppError(ErrorCode.AGENT_LIMIT_EXCEEDED, message);
  }
}