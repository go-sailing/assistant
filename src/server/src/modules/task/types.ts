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
}

export interface CreateTaskInput {
  title: string;
  note?: string | null;
  priority?: Priority;
  due_at?: string | null;
  list_id?: number | null;
}

export interface UpdateTaskInput {
  title?: string;
  note?: string | null;
  priority?: Priority;
  due_at?: string | null;
  list_id?: number | null;
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