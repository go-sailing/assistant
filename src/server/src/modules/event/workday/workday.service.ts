/**
 * WorkdayService：中国大陆法定工作日判定（对应系统设计文档 4.2 节）。
 *
 * 语义：以「默认周历（周一~周五工作、周六日休息）」为底，叠加 work_calendar_days
 * 中的两类特殊日：
 *   - holiday（法定放假）→ 非工作日
 *   - makeup （调休补班）→ 工作日
 * 未录入的年份回退为默认周历（PRD 4.1：安排公布前按周一~周五计算），不报错。
 *
 * 实现：整表数据量极小（每年 20~30 行，只记录偏离默认周历的特殊日），
 * 首次使用一次性载入进程内存，之后判定为**同步纯内存**操作——循环引擎在展开
 * 窗口内逐日判定时不再有 IO 开销。数据只通过迁移更新，进程重启即刷新，无需 TTL。
 */
import { query } from '../../../db/pool';
import { config } from '../../../config';

export type DayType = 'holiday' | 'makeup';

export interface SpecialDay {
  type: DayType;
  name: string | null;
}

/** 'YYYY-MM-DD' → SpecialDay（全量） */
let allDays = new Map<string, SpecialDay>();
/** 已录入法定安排的年份（用于"未公布年份回退"提示） */
let loadedYears = new Set<number>();
let loaded = false;
let loading: Promise<void> | null = null;

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function toDateString(raw: Date | string): string {
  if (typeof raw === 'string') return raw.slice(0, 10);
  // pg 默认把 DATE 解析为**本地时区午夜**的 Date（如东八区下 2026-09-25 → 2026-09-24T16:00Z），
  // 因此必须取本地分量而不是 UTC 分量，否则整体错位一天。
  return `${raw.getFullYear()}-${pad2(raw.getMonth() + 1)}-${pad2(raw.getDate())}`;
}

/** 公历日期字符串的星期（0=周日） */
export function weekdayOfDate(dateStr: string): number {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/** 载入整张法定日历表（幂等；并发调用共用同一个 Promise） */
export async function ensureWorkCalendarLoaded(): Promise<void> {
  if (loaded) return;
  if (loading) return loading;
  loading = (async () => {
    const res = await query<{ day_date: Date | string; day_type: DayType; holiday_name: string | null }>(
      `SELECT day_date, day_type, holiday_name FROM work_calendar_days WHERE country = $1`,
      [config.workCalendar.country]
    );
    const days = new Map<string, SpecialDay>();
    const years = new Set<number>();
    for (const row of res.rows) {
      const dateStr = toDateString(row.day_date);
      days.set(dateStr, { type: row.day_type, name: row.holiday_name });
      years.add(Number(dateStr.slice(0, 4)));
    }
    allDays = days;
    loadedYears = years;
    loaded = true;
  })().finally(() => {
    loading = null;
  });
  return loading;
}

/** 该年份是否有已录入的法定安排数据 */
export function hasYearData(year: number): boolean {
  return loadedYears.has(year);
}

/** 特殊日信息（holiday/makeup），非特殊日返回 null */
export function getCalendarDay(date: string): SpecialDay | null {
  return allDays.get(date) ?? null;
}

/** 是否工作日（调用前需已 ensureWorkCalendarLoaded） */
export function isWorkdayCN(date: string): boolean {
  const special = allDays.get(date);
  if (special) return special.type === 'makeup';
  const wd = weekdayOfDate(date);
  return wd !== 0 && wd !== 6;
}

/** 供测试与调试：清空缓存（下次使用重新载入） */
export function clearWorkdayCache(): void {
  allDays = new Map();
  loadedYears = new Set();
  loaded = false;
}