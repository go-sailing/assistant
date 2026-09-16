import type { Priority, TaskStatus } from '../task/types';

export type EventType = 'normal' | 'task';
export type EventSource = 'manual' | 'chat';
export type EventStatus = 'scheduled' | 'cancelled';
/** 冲突等级：none 无冲突 / overlap 时段重叠 / all_day 全天安排（弱化提示） */
export type ConflictLevel = 'none' | 'overlap' | 'all_day';

/**
 * events 表行 + JOIN tasks/task_lists 的展示字段。
 * 任务日程的标题等展示信息一律取关联任务实时数据，不存冗余副本。
 */
export interface EventRow {
  id: number;
  user_id: number;
  event_type: string;
  task_id: number | null;
  title: string | null;
  note: string | null;
  location: string | null;
  all_day: boolean;
  start_at: Date;
  end_at: Date;
  status: string;
  source: string;
  created_at: Date;
  updated_at: Date;
  /** 关联任务展示字段（仅任务日程有值） */
  task_title: string | null;
  task_status: string | null;
  task_priority: string | null;
  task_due_at: Date | null;
  task_completed_at: Date | null;
  task_list_id: number | null;
  task_list_name: string | null;
}

/** 任务日程内嵌的任务摘要（供卡片与详情展示，实时数据） */
export interface EventTaskBrief {
  id: number;
  title: string;
  status: TaskStatus;
  priority: Priority;
  due_at: string | null;
  completed_at: string | null;
  list_id: number;
  list_name: string;
}

export interface EventDTO {
  id: number;
  event_type: EventType;
  task_id: number | null;
  /** 普通日程为自填标题；任务日程实时取关联任务标题 */
  title: string;
  note: string | null;
  location: string | null;
  all_day: boolean;
  start_at: string;
  end_at: string;
  status: EventStatus;
  source: EventSource;
  created_at: string;
  updated_at: string;
  /** 任务日程内嵌的任务对象；普通日程为 null */
  task: EventTaskBrief | null;
  /** 写操作响应/详情中附带：与当前日程时间相交的其他日程 */
  conflicts?: EventConflictBrief[];
  conflict_level?: ConflictLevel;
  /**
   * 仅历史卡片刷新时置位：该日程已被删除，客户端应渲染"该日程已删除"占位，
   * 避免把陈旧快照当成最新状态展示。
   */
  missing?: boolean;
}

/** 冲突提示用的精简结构（避免嵌套 conflicts 递归） */
export interface EventConflictBrief {
  id: number;
  event_type: EventType;
  title: string;
  start_at: string;
  end_at: string;
  all_day: boolean;
  location: string | null;
}

export interface EventFilter {
  /** 单日（用户时区下的自然日） */
  date?: string;
  /** 日期范围，左闭右开：[date_from, date_to) */
  date_from?: string;
  date_to?: string;
  /** 用户时区（IANA），影响日期边界换算 */
  tz?: string;
  task_id?: number;
  event_type?: EventType;
  keyword?: string;
  sort?: string;
  limit?: number;
}

export interface CreateEventInput {
  event_type?: EventType;
  task_id?: number | null;
  title?: string | null;
  note?: string | null;
  location?: string | null;
  all_day?: boolean;
  start_at: string;
  end_at: string;
}

export interface UpdateEventInput {
  /** 仅任务日程可改（任务日程该字段被忽略，标题以任务为准） */
  title?: string | null;
  note?: string | null;
  location?: string | null;
  all_day?: boolean;
  start_at?: string;
  end_at?: string;
  /** 出现即拒绝（类型与关联创建后不可变更） */
  event_type?: EventType;
  task_id?: number | null;
}

/** 写操作结果：冲突未确认时不落库，由调用方决定是否二次提交 */
export interface WriteEventResult {
  saved: boolean;
  event: EventDTO | null;
  conflicts: EventConflictBrief[];
  conflict_level: ConflictLevel;
  need_conflict_confirmation: boolean;
}

/** 月视图聚合项 */
export interface MonthDayCount {
  date: string;
  normal: number;
  task: number;
}

const TITLE_MAX = 100;
const NOTE_MAX = 2000;
const LOCATION_MAX = 200;

export function toEventDTO(row: EventRow): EventDTO {
  const isTask = row.event_type === 'task';
  return {
    id: row.id,
    event_type: isTask ? 'task' : 'normal',
    task_id: row.task_id,
    // 任务日程标题实时取任务，任务已被删除时兜底为"已删除的任务"
    title: isTask ? row.task_title ?? '已删除的任务' : row.title ?? '',
    note: row.note,
    location: row.location,
    all_day: row.all_day,
    start_at: row.start_at.toISOString(),
    end_at: row.end_at.toISOString(),
    status: row.status === 'cancelled' ? 'cancelled' : 'scheduled',
    source: row.source === 'chat' ? 'chat' : 'manual',
    created_at: row.created_at.toISOString(),
    updated_at: row.updated_at.toISOString(),
    task:
      isTask && row.task_id !== null && row.task_title !== null
        ? {
            id: row.task_id,
            title: row.task_title,
            status: (row.task_status as TaskStatus) ?? 'todo',
            priority: (row.task_priority as Priority) ?? 'none',
            due_at: row.task_due_at ? row.task_due_at.toISOString() : null,
            completed_at: row.task_completed_at ? row.task_completed_at.toISOString() : null,
            list_id: row.task_list_id ?? 0,
            list_name: row.task_list_name ?? '默认清单',
          }
        : null,
  };
}

export function toConflictBrief(row: EventRow): EventConflictBrief {
  const isTask = row.event_type === 'task';
  return {
    id: row.id,
    event_type: isTask ? 'task' : 'normal',
    title: isTask ? row.task_title ?? '已删除的任务' : row.title ?? '',
    start_at: row.start_at.toISOString(),
    end_at: row.end_at.toISOString(),
    all_day: row.all_day,
    location: row.location,
  };
}

export function normalizeEventSort(sort?: string): string {
  const raw = (sort || '').toLowerCase();
  if (raw.includes('desc')) return 'start_desc';
  return 'start_asc';
}

export const EVENT_LIMITS = { TITLE_MAX, NOTE_MAX, LOCATION_MAX };