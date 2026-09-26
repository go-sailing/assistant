import { config } from '../../config';
import { summarizeRecurrence, recurrenceNote } from './recurrence/summary';
import { firstOccurrenceAfter, firstOccurrenceAt, countOccurrences, localDateString } from './recurrence/engine';
import { solarToLunar } from './lunar/lunar.service';
import type { LunarDayInfo } from './lunar/lunar.service';
import type { SpecialDay } from './workday/workday.service';
import type { OverrideState, RecurrenceRule } from './recurrence/types';

/**
 * v0.8.0：产品里只剩一个时间事务载体——日程（events）。
 * `event_type` 恒为 'normal'、`task_id` 恒为 NULL（DB CHECK 兜底），
 * 类型与关联列保留在库以兼容代码回滚，应用不再读写。
 */
export type EventType = 'normal';
export type EventSource = 'manual' | 'chat';
export type EventStatus = 'scheduled' | 'cancelled';
/**
 * 冲突等级：none 无冲突 / overlap 时段重叠。
 *
 * v0.5.0（EVT-01）：全天日程退出冲突判定，'all_day' 不再被产出；
 * 该枚举值为兼容旧客户端解析而保留，新代码不应依赖它（SDD 12.2）。
 */
export type ConflictLevel = 'none' | 'overlap' | 'all_day';

/** events 表行（v0.8.0：不再 JOIN tasks） */
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
  /** v0.2.0：循环规则（null = 单次日程） */
  recurrence: RecurrenceRule | null;
  /** v0.2.0：「本次及以后」派生新系列的溯源 */
  derived_from_event_id: number | null;
}

export interface EventDTO {
  id: number;
  /** v0.8.0：恒 'normal' */
  event_type: EventType;
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
  /** v0.2.0：循环规则；单次日程为 null */
  recurrence?: RecurrenceRule | null;
  /** v0.2.0：规则人话摘要（服务端单点产出）；单次日程为 null */
  recurrence_summary?: string | null;
  /** v0.2.0：下一次实例时间；单次日程为 null */
  next_occurrence?: string | null;
  /** v0.2.0：「本次及以后」派生系列的溯源 */
  derived_from_event_id?: number | null;
  /** 写操作响应/详情中附带：与当前日程时间相交的其他日程 */
  conflicts?: EventConflictBrief[];
  conflict_level?: ConflictLevel;
  /**
   * 仅历史卡片刷新时置位：该日程已被删除，客户端应渲染"该日程已删除"占位，
   * 避免把陈旧快照当成最新状态展示。
   */
  missing?: boolean;
  /** v0.2.0：占位原因（deleted 已删除 / not_occurring 该次安排已不再发生） */
  missing_reason?: 'deleted' | 'not_occurring';
  /**
   * v0.4.0：开始日所在公历日的农历信息（PRD 5.1：详情/表单/卡片展示）。
   * 仅按需填充（列表与详情填，冲突简报不填）。
   */
  lunar?: LunarDayInfo | null;
}

/** 展开实例读模型（系统设计文档 5.4）：复用 EventDTO 形状 + 实例身份 */
export interface OccurrenceDTO extends EventDTO {
  series_id: number;
  /** 实例身份键：原始开始时间（UTC ISO），不随改期漂移 */
  occurrence_key: string;
  override_state: OverrideState;
}

/** 系列详情对象 */
export interface SeriesDTO extends EventDTO {
  recurrence: RecurrenceRule;
  recurrence_summary: string;
  next_occurrence: string | null;
  /**
   * v0.3.0：首次实例时间（UTC ISO）。
   * yearly 指定月日时可能晚于系列开始时间（本年已过则落到次年）；规则已耗尽为 null。
   */
  first_occurrence_at: string | null;
  /** 规则推算的实例总数（count 精确，其余为上限内估算） */
  total_count: number;
  /**
   * v0.4.0：规则补充说明行（PRD 4.4/5.6.5），如法定工作日"公布前按周一至周五计算"、
   * 农历"公历日期逐年不同"；无补充说明时为 null。
   */
  recurrence_note: string | null;
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
  /** v0.2.0：冲突对象是循环实例时附带系列与实例身份，便于前端跳转实例详情 */
  series_id?: number | null;
  occurrence_key?: string | null;
}

export interface EventFilter {
  /** 单日（用户时区下的自然日） */
  date?: string;
  /** 日期范围，左闭右开：[date_from, date_to) */
  date_from?: string;
  date_to?: string;
  /** 用户时区（IANA），影响日期边界换算 */
  tz?: string;
  keyword?: string;
  sort?: string;
  limit?: number;
  /** v0.2.0：只看某个系列的实例 */
  series_id?: number;
  /** v0.2.0：只看循环实例（含已调整，不含已取消） */
  recurring_only?: boolean;
  /** v0.2.0：列表是否包含「仅本次已取消」的实例 */
  include_cancelled?: boolean;
}

export interface CreateEventInput {
  title?: string | null;
  note?: string | null;
  location?: string | null;
  all_day?: boolean;
  start_at: string;
  end_at: string;
  /** v0.2.0：重复规则 */
  recurrence?: RecurrenceRule | null;
}

export interface UpdateEventInput {
  title?: string | null;
  note?: string | null;
  location?: string | null;
  all_day?: boolean;
  start_at?: string;
  end_at?: string;
  /** v0.2.0：整条系列改规则（仅 scope=series/following 允许） */
  recurrence?: RecurrenceRule | null;
}

/** 写操作结果：冲突未确认时不落库，由调用方决定是否二次提交 */
export interface WriteEventResult {
  saved: boolean;
  event: EventDTO | null;
  conflicts: EventConflictBrief[];
  conflict_level: ConflictLevel;
  need_conflict_confirmation: boolean;
  /** 循环冲突：按日期分组（scope=series） */
  conflict_dates?: import('./recurrence/types').ConflictDateGroup[];
  conflict_dates_total?: number;
  conflict_total?: number;
  /** 循环冲突的作用域：series（按日期分组）/ occurrence（单次） */
  conflict_scope?: 'series' | 'occurrence';
  /** 「本次及以后」派生结果 */
  derived?: { old_series: SeriesDTO; new_series: SeriesDTO } | null;
}

/** 月视图聚合项（v0.8.0：去掉 task 计数） */
export interface MonthDayCount {
  date: string;
  normal: number;
  /** v0.2.0：其中循环实例数（含已调整，不含已取消） */
  recurring: number;
  /**
   * v0.4.0：当日农历信息（月历副字、标题条、详情与对话卡片共用同一份）。
   * 农历超出支持范围（1900-01-31~2100-12-31）时为 null。
   */
  lunar: LunarDayInfo | null;
  /** v0.4.0：当日法定状态（holiday 放假 / makeup 补班 / null 非特殊日） */
  calendar_day: SpecialDay | null;
}

const TITLE_MAX = 100;
const NOTE_MAX = 2000;
const LOCATION_MAX = 200;

/** 单次时长（毫秒），用于引擎展开：全天系列按整天数 × 24h 的墙钟口径 */
export function eventDurationMs(row: { start_at: Date; end_at: Date }): number {
  return Math.max(0, row.end_at.getTime() - row.start_at.getTime());
}

/**
 * 行 → DTO。
 * 循环系列会附带 recurrence 与 recurrence_summary（服务端单点产出）；
 * next_occurrence 单独按需计算（避免列表批量展开的额外开销）。
 */
export function toEventDTO(row: EventRow, tz: string = config.event.defaultTz): EventDTO {
  const recurrence = (row.recurrence ?? null) as RecurrenceRule | null;
  // v0.4.0：开始日所在公历日的农历信息（超出支持范围时为 null，界面按"无副字"处理）
  const lunar = solarToLunar(localDateString(row.start_at, tz));
  return {
    id: row.id,
    event_type: 'normal',
    title: row.title ?? '',
    note: row.note,
    location: row.location,
    all_day: row.all_day,
    start_at: row.start_at.toISOString(),
    end_at: row.end_at.toISOString(),
    status: row.status === 'cancelled' ? 'cancelled' : 'scheduled',
    source: row.source === 'chat' ? 'chat' : 'manual',
    created_at: row.created_at.toISOString(),
    updated_at: row.updated_at.toISOString(),
    recurrence,
    recurrence_summary: recurrence
      ? summarizeRecurrence(recurrence, row.start_at, row.all_day, tz)
      : null,
    derived_from_event_id: row.derived_from_event_id ?? null,
    lunar,
  };
}

/** 系列 DTO：附带首次/下一次实例时间与总次数（引擎按需小窗口展开） */
export function toSeriesDTO(row: EventRow, tz: string, now = new Date()): SeriesDTO {
  const dto = toEventDTO(row, tz);
  const rule = row.recurrence as RecurrenceRule;
  const durationMs = eventDurationMs(row);
  const next = firstOccurrenceAfter(rule, row.start_at, durationMs, now, tz);
  const first = firstOccurrenceAt(rule, row.start_at, durationMs, tz);
  return {
    ...dto,
    recurrence: rule,
    recurrence_summary: dto.recurrence_summary ?? '',
    next_occurrence: next ? next.start_at.toISOString() : null,
    first_occurrence_at: first ? first.start_at.toISOString() : null,
    total_count: countOccurrences(rule, row.start_at, durationMs, tz),
    recurrence_note: recurrenceNote(rule, row.start_at, tz),
  };
}

export function toConflictBrief(row: EventRow): EventConflictBrief {
  return {
    id: row.id,
    event_type: 'normal',
    title: row.title ?? '',
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
