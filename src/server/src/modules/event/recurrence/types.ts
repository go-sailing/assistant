/**
 * 循环日程的核心类型（对应系统设计文档 4.1 / 5.4）。
 *
 * 设计要点：
 * - 规则在「用户时区下的本地日期时间」里解释，输出统一转为 UTC 瞬时；
 * - 实例身份键 occurrence_key = 按规则推算的**原始**开始时间（UTC ISO），不随 modified 漂移；
 * - 实例虚拟展开、绝不物化：DB 只存系列主记录 + event_overrides 例外行。
 */
import type { ConflictLevel, EventType } from '../types';

export type RecurFreq = 'daily' | 'weekly' | 'monthly' | 'yearly';
export type RecurEndType = 'never' | 'count' | 'until';
export type MonthRuleType = 'day_of_month' | 'day_of_week';
/** 作用域：整条系列 / 仅本次 / 本次及以后 */
export type EventScope = 'series' | 'this' | 'following';
/** 实例的覆盖状态 */
export type OverrideState = 'normal' | 'modified' | 'cancelled';

export interface MonthRule {
  type: MonthRuleType;
  /** day_of_month：1..31（超月落到月末） */
  day?: number;
  /** day_of_week：第 N 个（-1 表示最后一个） */
  ord?: -1 | 1 | 2 | 3 | 4;
  /** day_of_week：0..6（0=周日） */
  weekday?: number;
}

/** v0.3.0：yearly 指定的每年重复月日 */
export interface ByMonthDay {
  /** 1..12 */
  month: number;
  /** 1..31；目标月无该日时落到当月最后一天 */
  day: number;
}

/** v0.4.0：yearly 指定的每年农历月日（正常月，不含闰月） */
export interface ByLunarMonthDay {
  /** 农历月 1..12（1=正月 … 12=腊月） */
  month: number;
  /** 农历日 1..30；该农历月为小月（29 天）时落到当月最后一天 */
  day: number;
}

/** v0.4.0：weekly 的星期模式 */
export type WeekMode = 'workdays_cn';

export interface RecurrenceRule {
  freq: RecurFreq;
  /** 1..EVENT_RECUR_INTERVAL_MAX，默认 1 */
  interval: number;
  /** 仅 weekly：0..6（0=周日），缺省=首次所在星期 */
  by_week_days?: number[];
  /**
   * v0.4.0 仅 weekly：'workdays_cn' = 法定工作日（避开放假、含调休补班）。
   * 与 by_week_days 互斥；缺省时按 by_week_days 解释，存量规则语义不变。
   */
  week_mode?: WeekMode;
  /** 仅 monthly */
  month_rule?: MonthRule;
  /** v0.3.0 仅 yearly：指定每年的月日；缺省=取首次实例（anchor）的月日 */
  by_month_day?: ByMonthDay;
  /**
   * v0.4.0 仅 yearly：指定每年农历月日，公历日期逐年浮动；
   * 与 by_month_day 互斥（同时出现由 validateRule 抛 4011）。
   */
  by_lunar_month_day?: ByLunarMonthDay;
  end_type: RecurEndType;
  /** end_type=count：1..EVENT_SERIES_MAX_COUNT */
  count?: number;
  /** end_type=until：YYYY-MM-DD（用户时区日期，含当天） */
  until?: string;
}

/** 展开产出的原始实例（未应用 override） */
export interface OccurrenceSeed {
  /** 在该系列内的序号（从 0 起，仅用于展示，不参与身份） */
  index: number;
  /** 实例身份键：原始开始时间（UTC ISO） */
  occurrence_key: string;
  start_at: Date;
  end_at: Date;
  all_day: boolean;
  /** 用户时区下的本地日期 YYYY-MM-DD */
  local_date: string;
}

/** overrides 表行 */
export interface EventOverrideRow {
  id: number;
  user_id: number;
  event_id: number;
  occurrence_start: Date;
  action: string;
  patch: Record<string, unknown>;
  created_at: Date;
  updated_at: Date;
}

/** modified 覆盖允许的字段白名单（系统设计文档 10 输入校验） */
export const OVERRIDE_PATCH_FIELDS = [
  'start_at',
  'end_at',
  'all_day',
  'title',
  'location',
  'note',
] as const;

export interface OverridePatch {
  start_at: string;
  end_at?: string;
  all_day?: boolean;
  title?: string | null;
  location?: string | null;
  note?: string | null;
}

/** 循环冲突按日期分组（4009 body） */
export interface ConflictDateGroup {
  date: string;
  target_start: string;
  target_end: string;
  conflicts: Array<{
    id: number;
    event_type: EventType;
    title: string;
    start_at: string;
    end_at: string;
    all_day: boolean;
    location: string | null;
  }>;
}

export interface SeriesConflictResult {
  conflict_level: ConflictLevel;
  conflict_dates: ConflictDateGroup[];
  conflict_dates_total: number;
  conflict_total: number;
}
