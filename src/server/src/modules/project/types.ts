/** v0.8.0 项目域类型与 DTO（系统设计文档 4.1） */

export type ProjectStatus = 'todo' | 'completed';
/** 项目来源：manual（项目页）/ chat（对话） */
export type ProjectSource = 'manual' | 'chat';

export interface ProjectRow {
  id: number;
  user_id: number;
  name: string;
  note: string | null;
  status: string;
  completed_at: Date | null;
  source: string;
  created_at: Date;
  updated_at: Date;
  /** 聚合字段：成员任务总数 */
  member_total?: number;
  /** 聚合字段：已完成成员任务数 */
  member_completed?: number;
}

export interface ProjectDTO {
  id: number;
  name: string;
  note: string | null;
  /** 派生只读：仅由 ProjectService.recalcStatus 写入 */
  status: ProjectStatus;
  completed_at: string | null;
  source: ProjectSource;
  created_at: string;
  updated_at: string;
  /** 成员任务数 */
  member_total: number;
  /** 已完成成员任务数 */
  member_completed: number;
}

export interface ProjectFilter {
  keyword?: string;
  /** 端上不传（列表无筛选）；保留给内部与助手使用 */
  status?: ProjectStatus;
  page?: number;
  /** 默认 50，上限 100 */
  page_size?: number;
}

/** 项目成员列表筛选（成员即任务，字段口径与任务列表对齐） */
export interface ProjectMemberFilter {
  status?: ProjectStatus;
  keyword?: string;
  sort?: string;
  page?: number;
  page_size?: number;
}

export interface CreateProjectInput {
  name: string;
  note?: string | null;
}

export interface UpdateProjectInput {
  name?: string;
  note?: string | null;
}

export interface ProjectRemoveResult {
  deleted_task_count: number;
  deleted_event_count: number;
}

/** 供任务列表批量带出项目名（避免 N+1） */
export interface ProjectBrief {
  id: number;
  name: string;
}

export function toProjectDTO(row: ProjectRow): ProjectDTO {
  return {
    id: row.id,
    name: row.name,
    note: row.note,
    status: row.status === 'completed' ? 'completed' : 'todo',
    completed_at: row.completed_at ? row.completed_at.toISOString() : null,
    source: row.source === 'chat' ? 'chat' : 'manual',
    created_at: row.created_at.toISOString(),
    updated_at: row.updated_at.toISOString(),
    member_total: Number(row.member_total ?? 0),
    member_completed: Number(row.member_completed ?? 0),
  };
}
