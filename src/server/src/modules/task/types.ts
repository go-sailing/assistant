export type Priority = 'none' | 'low' | 'medium' | 'high';
export type TaskStatus = 'todo' | 'completed';
export type SortKey = 'due_at_asc' | 'due_at_desc' | 'created_at_asc' | 'created_at_desc';

export interface TaskRow {
  id: number;
  user_id: number;
  list_id: number;
  list_name: string;
  title: string;
  note: string | null;
  status: string;
  priority: string;
  due_at: Date | null;
  completed_at: Date | null;
  source: string;
  created_at: Date;
  updated_at: Date;
  /** v0.2.0：父任务 id（NULL = 根任务） */
  parent_id: number | null;
  /** v0.2.0：子树查询时的相对深度（根=1），普通查询缺省 1 */
  depth?: number;
  /** v0.2.0：直接子任务数（聚合字段） */
  subtask_total?: number;
  /** v0.2.0：直接子任务已完成数（聚合字段） */
  subtask_completed?: number;
}

export interface TaskDTO {
  id: number;
  title: string;
  note: string | null;
  status: TaskStatus;
  priority: Priority;
  due_at: string | null;
  list_id: number;
  list_name: string;
  /** 创建来源：manual（任务页）/ chat（对话） */
  source: 'manual' | 'chat';
  created_at: string;
  updated_at: string;
  completed_at: string | null;
  /** v0.2.0：父任务 id（null = 根任务） */
  parent_id: number | null;
  /** v0.2.0：相对本次子树查询根的深度（根=1） */
  depth: number;
  /** v0.2.0：直接子任务总数 / 已完成数 */
  subtask_total: number;
  subtask_completed: number;
}

/** 写操作结果：可能顺带恢复了被自动唤醒的父任务 */
export interface TaskWriteResult extends TaskDTO {
  revived_parent?: { id: number; title: string } | null;
}

export interface ListRow {
  id: number;
  user_id: number;
  name: string;
  is_default: boolean;
  created_at: Date;
  updated_at: Date;
}

export interface ListDTO {
  id: number;
  name: string;
  is_default: boolean;
  created_at: string;
  updated_at: string;
}

export interface TaskFilter {
  list_id?: number;
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
  /** v0.2.0：只看某个任务的直接子任务 */
  parent_id?: number;
}

export interface CreateTaskInput {
  title: string;
  note?: string | null;
  priority?: Priority;
  due_at?: string | null;
  list_id?: number | null;
  /** v0.2.0：挂到某个父任务下 */
  parent_id?: number | null;
}

export interface UpdateTaskInput {
  title?: string;
  note?: string | null;
  priority?: Priority;
  due_at?: string | null;
  list_id?: number | null;
  /** v0.2.0：移动层级（显式 null = 移出为根任务） */
  parent_id?: number | null;
}

/** v0.2.0：子树查询节点（扁平数组，前端据此还原树） */
export interface TaskSubtreeNode extends TaskDTO {
  depth: number;
}

/** v0.2.0：对话卡片中的子任务组（根任务 + 扁平节点） */
export interface SubtaskGroup {
  root_task_id: number;
  nodes: TaskDTO[];
  /** 历史卡片刷新时置位：根任务已删除，整组应渲染「该任务已删除」占位 */
  missing?: boolean;
  missing_reason?: 'deleted';
}

export function toTaskDTO(row: TaskRow): TaskDTO {
  return {
    id: row.id,
    title: row.title,
    note: row.note,
    status: row.status as TaskStatus,
    priority: row.priority as Priority,
    due_at: row.due_at ? row.due_at.toISOString() : null,
    list_id: row.list_id,
    list_name: row.list_name,
    source: row.source === 'chat' ? 'chat' : 'manual',
    created_at: row.created_at.toISOString(),
    updated_at: row.updated_at.toISOString(),
    completed_at: row.completed_at ? row.completed_at.toISOString() : null,
    parent_id: row.parent_id ?? null,
    depth: row.depth ?? 1,
    subtask_total: Number(row.subtask_total ?? 0),
    subtask_completed: Number(row.subtask_completed ?? 0),
  };
}

export function toListDTO(row: ListRow): ListDTO {
  return {
    id: row.id,
    name: row.name,
    is_default: row.is_default,
    created_at: row.created_at.toISOString(),
    updated_at: row.updated_at.toISOString(),
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