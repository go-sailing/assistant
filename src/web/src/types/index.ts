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
}

/* ---------------- 日程（v0.1.0） ---------------- */

/** 日程类型：normal 普通日程 / task 任务日程（链接一个任务作为执行时段载体） */
export type EventType = 'normal' | 'task'
export type EventSource = 'manual' | 'chat'
export type ConflictLevel = 'none' | 'overlap' | 'all_day'

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
  conflicts?: EventConflictBrief[]
  conflict_level?: ConflictLevel
  /** 历史卡片刷新时标记：该日程已被删除，应渲染占位而非陈旧快照 */
  missing?: boolean
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
}

/** 月视图聚合项 */
export interface MonthDayCount {
  date: string
  normal: number
  task: number
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
}

/** 确认条动作类型 */
export type ConfirmAction =
  | 'delete_task'
  | 'delete_list'
  | 'batch_update_tasks'
  | 'delete_event'
  | 'batch_update_events'
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