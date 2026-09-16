/** 后端统一响应包裹：{ code, message, data } */
export interface ApiResponse<T> {
  code: number
  message: string
  data: T
  /** 业务错误的补充数据（如日程冲突列表） */
  details?: unknown
}

export interface Paged<T> {
  list: T[]
  total: number
  page: number
  page_size: number
}

/** 用户对象（登录/注册返回） */
export interface User {
  id: number | string
  email: string
}

export interface AuthResult {
  token: string
  user: User
}

/** 清单 */
export interface TaskList {
  id: number | string
  name: string
  is_default: boolean
  created_at: string
  updated_at: string
}

export type TaskStatus = 'todo' | 'completed'
export type TaskPriority = 'none' | 'low' | 'medium' | 'high'

/** 任务对象 */
export interface Task {
  id: number | string
  title: string
  note: string | null
  status: TaskStatus
  priority: TaskPriority
  due_at: string | null
  list_id: number | string
  list_name: string
  created_at: string
  updated_at: string
  completed_at: string | null
  /** 该任务关联的任务日程数量（详情接口返回，v0.1.0） */
  event_count?: number
  /* ----- v0.2.0 子任务 ----- */
  /** 父任务 ID（null = 根任务） */
  parent_id: number | null
  /** 相对本次子树查询根的深度（根 = 1） */
  depth: number
  /** 直接子任务总数 */
  subtask_total: number
  /** 直接子任务已完成数 */
  subtask_completed: number
  /** 写操作响应：被自动恢复为未完成的父任务 */
  revived_parent?: { id: number; title: string } | null
}

/** v0.2.0：对话卡片中的子任务组（根任务 + 扁平节点） */
export interface SubtaskGroup {
  root_task_id: number
  nodes: Task[]
  /** 历史卡片刷新时置位：根任务已删除，整组渲染「该任务已删除」占位 */
  missing?: boolean
  missing_reason?: 'deleted'
}

/* ---------------- 日程（v0.1.0） ---------------- */

/** 日程类型：normal 普通日程 / task 任务日程（链接一个任务作为执行时段载体） */
export type EventType = 'normal' | 'task'
export type EventSource = 'manual' | 'chat'
export type ConflictLevel = 'none' | 'overlap' | 'all_day'

/* ---------------- 循环日程（v0.2.0） ---------------- */

export type RecurFreq = 'daily' | 'weekly' | 'monthly' | 'yearly'
export type RecurEndType = 'never' | 'count' | 'until'
export type MonthRuleType = 'day_of_month' | 'day_of_week'
/** 写操作作用域：整条系列 / 仅本次 / 本次及以后 */
export type EventScope = 'series' | 'this' | 'following'
/** 实例覆盖状态 */
export type OverrideState = 'normal' | 'modified' | 'cancelled'

export interface MonthRule {
  type: MonthRuleType
  /** day_of_month：1..31（超月落到月末） */
  day?: number
  /** day_of_week：第 N 个（-1 = 最后一个） */
  ord?: -1 | 1 | 2 | 3 | 4
  /** day_of_week：0=周日 .. 6=周六 */
  weekday?: number
}

export interface RecurrenceRule {
  freq: RecurFreq
  /** 1..99，默认 1 */
  interval: number
  /** 仅 weekly：0..6（0=周日） */
  by_week_days?: number[]
  /** 仅 monthly */
  month_rule?: MonthRule
  end_type: RecurEndType
  /** end_type=count：1..730 */
  count?: number
  /** end_type=until：YYYY-MM-DD（用户时区日期，含当天） */
  until?: string
}

/** 循环冲突按日期分组（4009 body） */
export interface ConflictDateGroup {
  date: string
  target_start: string
  target_end: string
  conflicts: EventConflictBrief[]
}

/** 任务日程内嵌的任务摘要（实时数据） */
export interface EventTaskBrief {
  id: number | string
  title: string
  status: TaskStatus
  priority: TaskPriority
  due_at: string | null
  completed_at: string | null
  list_id: number | string
  list_name: string
}

export interface CalendarEvent {
  id: number | string
  event_type: EventType
  task_id: number | string | null
  title: string
  note: string | null
  location: string | null
  all_day: boolean
  start_at: string
  end_at: string
  status: 'scheduled' | 'cancelled'
  source: EventSource
  created_at: string
  updated_at: string
  /** 任务日程内嵌任务对象；普通日程为 null */
  task: EventTaskBrief | null
  /* ----- v0.2.0 循环 ----- */
  /** 重复规则；单次日程为 null */
  recurrence?: RecurrenceRule | null
  /** 规则人话摘要（服务端下发，端上不自行拼装） */
  recurrence_summary?: string | null
  /** 下一次实例时间 */
  next_occurrence?: string | null
  /** 「本次及以后」派生系列的溯源 */
  derived_from_event_id?: number | null
  conflicts?: EventConflictBrief[]
  conflict_level?: ConflictLevel
  /** 历史卡片刷新时标记：该日程已被删除，应渲染占位而非陈旧快照 */
  missing?: boolean
  /** 占位原因（deleted 已删除 / not_occurring 该次安排已不再发生） */
  missing_reason?: 'deleted' | 'not_occurring'
}

/** 展开实例读模型：id = 系列 id，occurrence_key 为实例身份键（原始开始时间 UTC） */
export interface Occurrence extends CalendarEvent {
  series_id: number
  occurrence_key: string
  override_state: OverrideState
}

/** 系列详情（含实例分页） */
export interface SeriesDetail extends CalendarEvent {
  recurrence: RecurrenceRule
  recurrence_summary: string
  next_occurrence: string | null
  total_count: number
  occurrences: { upcoming: Occurrence[]; past: Occurrence[] }
  next_cursor: string | null
}

/** 冲突提示用的精简结构 */
export interface EventConflictBrief {
  id: number | string
  event_type: EventType
  title: string
  start_at: string
  end_at: string
  all_day: boolean
  location: string | null
  /** 冲突对象是循环实例时附带系列与实例身份 */
  series_id?: number | null
  occurrence_key?: string | null
}

/** 月视图聚合项 */
export interface MonthDayCount {
  date: string
  normal: number
  task: number
  /** v0.2.0：其中循环实例数（含已调整，不含已取消） */
  recurring: number
}

export interface EventPayload {
  /** 仅创建时必填；编辑时不下发（类型创建后不可变更） */
  event_type?: EventType
  task_id?: number | string | null
  title?: string | null
  note?: string | null
  location?: string | null
  all_day?: boolean
  start_at: string
  end_at: string
  /** v0.2.0：重复规则（仅普通日程） */
  recurrence?: RecurrenceRule | null
  /** v0.2.0：写操作作用域（默认 series） */
  scope?: EventScope
  /** v0.2.0：实例身份键（scope=this/following 必填） */
  occurrence_key?: string
  /** 冲突二次提交标记 */
  confirm_conflict?: boolean
}

export interface EventQuery {
  date?: string
  date_from?: string
  date_to?: string
  tz?: string
  task_id?: string | number
  event_type?: EventType
  sort?: 'start_asc' | 'start_desc'
  limit?: number
  /** v0.2.0：只看某个系列 / 只看循环 / 含已取消 */
  series_id?: string | number
  recurring_only?: boolean
  include_cancelled?: boolean
}

/** 冲突二次提交所需的原始参数（用于「仍要保存」） */
export interface ConflictDetail {
  conflicts: EventConflictBrief[]
  conflict_level: ConflictLevel
}

export interface TaskQuery {
  list_id?: string | number
  status?: TaskStatus
  priority?: TaskPriority
  due_from?: string
  due_to?: string
  sort?: TaskSort
  page?: number
  page_size?: number
}

/** 排序：按截止时间 / 按创建时间，可升序或降序 */
export type TaskSort = 'due_at_asc' | 'due_at_desc' | 'created_at_desc' | 'created_at_asc'

export interface TaskPayload {
  title: string
  note?: string | null
  priority?: TaskPriority
  due_at?: string | null
  list_id?: string | number | null
  status?: TaskStatus
}

export interface Conversation {
  id: number | string
  title: string
  created_at: string
  updated_at: string
}

/* ---------------- 消息与 blocks ---------------- */

export interface TextBlock {
  type: 'text'
  text: string
}

export interface CardsBlock {
  type: 'cards'
  tasks: Task[]
  /** 日程卡片（v0.1.0） */
  events?: CalendarEvent[]
  /** v0.2.0：循环系列卡片（每系列一条） */
  series?: SeriesDetail[]
  /** v0.2.0：循环实例卡片 */
  occurrences?: Occurrence[]
  /** v0.2.0：子任务组卡片 */
  subtask_groups?: SubtaskGroup[]
}

export interface ClarifyBlock {
  type: 'clarify'
  question: string
  /** task 候选任务；event 候选日程 */
  kind?: 'task' | 'event'
  candidates: Task[]
  events?: CalendarEvent[]
}

/** 时间冲突提示块（v0.1.0）：未保存，等待用户决定 */
export interface ConflictBlock {
  type: 'conflict'
  tool: string
  conflicts: EventConflictBrief[]
  conflict_level: ConflictLevel
  /** 是否为全天安排导致的弱化提示 */
  message?: string
  /* ----- v0.2.0 循环冲突按日期分组 ----- */
  conflict_dates?: ConflictDateGroup[]
  conflict_dates_total?: number
  conflict_total?: number
}

/** v0.2.0：循环作用域澄清块（点选后作为结构化消息回传） */
export interface ScopeBlock {
  type: 'scope'
  tool: 'update_event' | 'delete_event'
  question: string
  options: EventScope[]
  ref: { series_id: number; occurrence_key?: string | null }
  recommended: EventScope
}

/** 确认条动作类型 */
export type ConfirmAction =
  | 'delete_task'
  | 'delete_list'
  | 'batch_update_tasks'
  | 'delete_event'
  | 'batch_update_events'
  /** v0.2.0：删除整条循环系列 */
  | 'delete_event_series'
  /** v0.2.0：级联完成父任务及其未完成子任务 */
  | 'complete_task_cascade'
  | string

export interface ConfirmBlock {
  type: 'confirm'
  pending_action_id: string
  action: ConfirmAction
  affected: Task[]
  /** 日程类危险操作的影响对象 */
  affected_events?: CalendarEvent[]
  count: number
  description?: string
}

export interface ErrorBlock {
  type: 'error'
  message: string
  retryable: boolean
}

export type MessageBlock =
  | TextBlock
  | CardsBlock
  | ClarifyBlock
  | ConflictBlock
  | ScopeBlock
  | ConfirmBlock
  | ErrorBlock

export interface MessagePayload {
  blocks: MessageBlock[]
}

/** 云端返回的原始消息对象 */
export interface RawMessage {
  id: number | string
  role: 'user' | 'assistant' | 'system' | 'tool'
  content: string | null
  payload: MessagePayload | null
  created_at: string
}

/** 前端渲染用消息（在原始消息上叠加本地交互态） */
export interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  blocks: MessageBlock[]
  created_at: string
  /** 用户消息本地发送态 */
  sendStatus?: 'sending' | 'sent' | 'failed'
  /** 助手消息是否处于流式输出中 */
  streaming?: boolean
  /** 是否显示「正在处理…」三点动画（工具调用期间为 true） */
  thinking?: boolean
  /** 该消息对应的幂等键（用于失败重试） */
  clientMsgId?: string
  /** 确认条本地状态：pending_action_id -> 状态 */
  pendingState?: Record<string, 'pending' | 'loading' | 'confirmed' | 'canceled' | 'stale'>
  /** 候选选择结果：候选块下标 -> 已选对象标题 */
  clarifyPicked?: Record<number, string>
}