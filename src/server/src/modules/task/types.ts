import { deriveConnection, type AgentConnection, type AgentState } from '../agent/types';

export type Priority = 'none' | 'low' | 'medium' | 'high';
export type TaskStatus = 'todo' | 'completed';
export type SortKey = 'due_at_asc' | 'due_at_desc' | 'created_at_asc' | 'created_at_desc';

/** v0.8.0：任务随列表带出的所属项目摘要（无项目时为 null） */
export interface TaskProjectBrief {
  id: number;
  name: string;
}

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
  /** v0.8.0：所属项目 id（NULL = 未归属项目）；项目不可再作为任务容器，无层级概念 */
  project_id: number | null;
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
  /** 聚合字段：所属项目名（LEFT JOIN projects，未归属时为 NULL） */
  project_name?: string | null;
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
  /** v0.8.0：所属项目摘要（进度与状态归项目 DTO） */
  project: TaskProjectBrief | null;
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

export interface TaskFilter {
  status?: TaskStatus;
  priority?: Priority;
  due_from?: string;
  due_to?: string;
  keyword?: string;
  sort?: string;
  page?: number;
  page_size?: number;
  /**
   * v0.8.0：按所属项目筛选。
   * 数字 = 该项目成员；字符串 'none' = 未归属项目的任务（决策 T4 的哨兵值）。
   */
  project_id?: number | 'none';
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
  /** v0.8.0：加入某个项目成为成员；缺省/null 为未归属项目 */
  project_id?: number | null;
}

export interface UpdateTaskInput {
  title?: string;
  note?: string | null;
  priority?: Priority;
  due_at?: string | null;
  /** v0.8.0：移入项目传项目 ID；显式 null/0 = 移出成为未归属项目的任务 */
  project_id?: number | null;
}

/**
 * 对话卡片中的项目/任务组（根 id + 扁平节点）。
 * v0.8.0 由编排层改为「项目 id 集合」组装，本类型仅保留结构供卡片渲染；
 * 具体字段名（project_groups）的切换由对话编排改造承担。
 */
export interface SubtaskGroup {
  root_task_id: number;
  nodes: TaskDTO[];
  /** 历史卡片刷新时置位：根任务已删除，整组应渲染「该任务已删除」占位 */
  missing?: boolean;
  missing_reason?: 'deleted';
}

export function toTaskDTO(row: TaskRow): TaskDTO {
  const agentId = row.agent_id ?? null;
  const projectId = row.project_id ?? null;
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
    // 未带出 project_name（如仅按 id 回读）时按未归属处理，避免出现只有 id 的半个摘要
    project:
      projectId !== null && row.project_name != null
        ? { id: projectId, name: row.project_name }
        : null,
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
