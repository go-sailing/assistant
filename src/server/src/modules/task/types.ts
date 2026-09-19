import { deriveConnection, type AgentConnection, type AgentState } from '../agent/types';

export type Priority = 'none' | 'low' | 'medium' | 'high';
export type TaskStatus = 'todo' | 'completed';
/** v0.6.0：普通任务（独立单任务）/ 项目任务（可拥有一层成员任务的容器） */
export type TaskType = 'normal' | 'project';
export type SortKey = 'due_at_asc' | 'due_at_desc' | 'created_at_asc' | 'created_at_desc';

export interface TaskRow {
  id: number;
  user_id: number;
  list_id: number;
  title: string;
  note: string | null;
  status: string;
  priority: string;
  due_at: Date | null;
  completed_at: Date | null;
  source: string;
  created_at: Date;
  updated_at: Date;
  /** v0.2.0：父任务 id（NULL = 根任务）；v0.6.0 起父任务只可能是项目 */
  parent_id: number | null;
  /** v0.6.0：任务类型 */
  task_type: string;
  /** v0.2.0：子树查询时的相对深度（根=1），普通查询缺省 1 */
  depth?: number;
  /** v0.6.0：项目直接成员数（聚合字段） */
  member_total?: number;
  /** v0.6.0：项目直接成员已完成数（聚合字段） */
  member_completed?: number;
  /** @deprecated v0.6.0：兼容别名，与 member_* 同值 */
  subtask_total?: number;
  /** @deprecated v0.6.0：兼容别名，与 member_* 同值 */
  subtask_completed?: number;
  /* ----- v0.7.0：代理执行维度（LEFT JOIN agents 带出代理名与最近活跃） ----- */
  agent_id: number | null;
  agent_state: string;
  agent_queued_at: Date | null;
  agent_claimed_at: Date | null;
  agent_finished_at: Date | null;
  agent_result: string | null;
  /** 聚合字段：代理名（代理删除后为 NULL） */
  agent_name?: string | null;
  /** 聚合字段：代理最近活跃时间（用于派生连接状态） */
  agent_last_seen_at?: Date | null;
}

export interface TaskDTO {
  id: number;
  title: string;
  note: string | null;
  status: TaskStatus;
  priority: Priority;
  due_at: string | null;
  /** 创建来源：manual（任务页）/ chat（对话） */
  source: 'manual' | 'chat';
  created_at: string;
  updated_at: string;
  completed_at: string | null;
  /** v0.2.0：父任务 id（null = 根任务）；v0.6.0 起父任务只可能是项目 */
  parent_id: number | null;
  /** v0.6.0：任务类型 */
  task_type: TaskType;
  /** v0.2.0：相对本次子树查询根的深度（根=1） */
  depth: number;
  /** v0.6.0：项目直接成员总数 / 已完成数（普通任务恒为 0） */
  member_total: number;
  member_completed: number;
  /** @deprecated v0.6.0 兼容别名：项目与 member_* 同值，普通任务恒 0 */
  subtask_total: number;
  /** @deprecated v0.6.0 兼容别名：项目与 member_* 同值，普通任务恒 0 */
  subtask_completed: number;
  /* ----- v0.7.0：代理执行维度（与任务完成状态正交） ----- */
  agent_id: number | null;
  agent_name: string | null;
  agent_state: AgentState;
  agent_queued_at: string | null;
  agent_claimed_at: string | null;
  agent_finished_at: string | null;
  agent_result: string | null;
  /** 派生：代理连接状态（agent_id 为空时为 null） */
  agent_connection: AgentConnection | null;
}

/** 写操作结果：可能顺带恢复了被自动唤醒的父任务（项目） */
export interface TaskWriteResult extends TaskDTO {
  revived_parent?: { id: number; title: string } | null;
}

export interface TaskFilter {
  status?: TaskStatus;
  priority?: Priority;
  due_from?: string;
  due_to?: string;
  keyword?: string;
  sort?: string;
  page?: number;
  page_size?: number;
  /** v0.2.0：只看根任务（任务首页默认） */
  root_only?: boolean;
  /** v0.2.0：只看某个任务的直接子任务（v0.6.0 起即项目成员） */
  parent_id?: number;
  /** v0.6.0：按任务类型筛选（normal / project） */
  task_type?: TaskType;
  /** v0.7.0：按指派代理筛选（代理详情「绑定任务」） */
  agent_id?: number;
  /** v0.7.0：按代理执行状态筛选 */
  agent_state?: AgentState;
}

export interface CreateTaskInput {
  title: string;
  note?: string | null;
  priority?: Priority;
  due_at?: string | null;
  /** v0.6.0：挂到项目任务下成为成员（父任务必须是 project） */
  parent_id?: number | null;
  /** v0.6.0：任务类型，缺省 normal */
  task_type?: TaskType;
}

export interface UpdateTaskInput {
  title?: string;
  note?: string | null;
  priority?: Priority;
  due_at?: string | null;
  /** v0.6.0：移入项目传项目 ID；显式 null = 移出成为独立任务 */
  parent_id?: number | null;
  /** v0.6.0：仅用于「携带即报错」判定，非合法更新字段 */
  task_type?: TaskType;
}

/** v0.2.0：子树查询节点（扁平数组，前端据此还原）；v0.6.0 起仅项目返回成员 */
export interface TaskSubtreeNode extends TaskDTO {
  depth: number;
}

/** 对话卡片中的项目/任务组（根任务 + 扁平节点；v0.6.0 起 root 为项目，nodes 为项目 + 成员） */
export interface SubtaskGroup {
  root_task_id: number;
  nodes: TaskDTO[];
  /** 历史卡片刷新时置位：根任务已删除，整组应渲染「该任务已删除」占位 */
  missing?: boolean;
  missing_reason?: 'deleted';
}

export function toTaskDTO(row: TaskRow): TaskDTO {
  const agentId = row.agent_id ?? null;
  return {
    id: row.id,
    title: row.title,
    note: row.note,
    status: row.status as TaskStatus,
    priority: row.priority as Priority,
    due_at: row.due_at ? row.due_at.toISOString() : null,
    source: row.source === 'chat' ? 'chat' : 'manual',
    created_at: row.created_at.toISOString(),
    updated_at: row.updated_at.toISOString(),
    completed_at: row.completed_at ? row.completed_at.toISOString() : null,
    parent_id: row.parent_id ?? null,
    task_type: row.task_type === 'project' ? 'project' : 'normal',
    depth: row.depth ?? 1,
    member_total: Number(row.member_total ?? row.subtask_total ?? 0),
    member_completed: Number(row.member_completed ?? row.subtask_completed ?? 0),
    subtask_total: Number(row.member_total ?? row.subtask_total ?? 0),
    subtask_completed: Number(row.member_completed ?? row.subtask_completed ?? 0),
    agent_id: agentId,
    agent_name: row.agent_name ?? null,
    agent_state: (row.agent_state as AgentState) ?? 'none',
    agent_queued_at: row.agent_queued_at ? row.agent_queued_at.toISOString() : null,
    agent_claimed_at: row.agent_claimed_at ? row.agent_claimed_at.toISOString() : null,
    agent_finished_at: row.agent_finished_at ? row.agent_finished_at.toISOString() : null,
    agent_result: row.agent_result ?? null,
    agent_connection: agentId ? deriveConnection(row.agent_last_seen_at ?? null) : null,
  };
}

/** 把前端/模型传入的排序值宽容地归一化，避免非法值导致查询失败 */
export function normalizeSort(sort?: string): SortKey {
  const raw = (sort || '').toLowerCase();
  if (raw.includes('created')) {
    return raw.includes('asc') ? 'created_at_asc' : 'created_at_desc';
  }
  if (raw.includes('desc')) return 'due_at_desc';
  return 'due_at_asc';
}
