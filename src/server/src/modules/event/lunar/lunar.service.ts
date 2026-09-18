/**
 * LunarService：公历 ↔ 农历换算、传统节日、二十四节气（对应系统设计文档 4.1 节）。
 *
 * 设计要点：
 * - **隔离层**：第三方历法库只在本文件 import，其余后端代码只依赖下面的接口，
 *   便于日后替换实现或修正数据；
 * - **纯函数**：无 IO；年度结果不可变，进程内按年缓存；
 * - **范围收口**：仅支持 1900-01-31 ~ 2100-12-31（PRD 5.2），越界明确报错而不静默兜底；
 * - **白名单节日**：不直接透出库的全部节日，只输出 PRD 约定的 11 个，避免
 *   「植树节」这类非约定名称进入界面。
 */
import { Solar, Lunar, LunarMonth } from 'lunar-javascript';
import { AppError } from '../../../common/errors';

const DAY_MS = 86_400_000;

/** 支持的公历范围（含两端） */
export const LUNAR_RANGE = { min: '1900-01-31', max: '2100-12-31' } as const;

export interface LunarDayInfo {
  /** 农历月名：正月…腊月 */
  month_label: string;
  /** 农历日名：初一…三十 */
  day_label: string;
  /** 传统节日名（白名单内），无则 null */
  festival: string | null;
  /** 二十四节气名，无则 null */
  term: string | null;
}

export interface ResolvedLunar {
  /** 对应公历日期 YYYY-MM-DD */
  gregorian_date: string;
  /** 0=周日 … 6=周六 */
  weekday: number;
  /** 该农历月在当年为小月（29 天）而请求了三十，已回落到当月最后一天 */
  clamped: boolean;
  month_label: string;
  day_label: string;
  festival: string | null;
  term: string | null;
}

const MONTH_NAMES = ['正', '二', '三', '四', '五', '六', '七', '八', '九', '十', '冬', '腊'] as const;

/**
 * 农历传统节日白名单（key = 月-日）。
 * 除夕（腊月最后一天）随年份浮动，单独判定，见 resolveFestival。
 */
const FESTIVALS: Record<string, string> = {
  '1-1': '春节',
  '1-15': '元宵节',
  '2-2': '二月二',
  '5-5': '端午节',
  '7-7': '七夕',
  '7-15': '中元节',
  '8-15': '中秋节',
  '9-9': '重阳节',
  '12-8': '腊八节',
  '12-23': '小年',
};

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function toDateString(solar: { getYear(): number; getMonth(): number; getDay(): number }): string {
  return `${solar.getYear()}-${pad2(solar.getMonth())}-${pad2(solar.getDay())}`;
}

/** 公历日期是否在支持范围内 */
export function isLunarSupported(dateStr: string): boolean {
  return dateStr >= LUNAR_RANGE.min && dateStr <= LUNAR_RANGE.max;
}

/** 农历月名（1=正月 … 12=腊月） */
export function lunarMonthLabel(month: number): string {
  return `${MONTH_NAMES[month - 1] ?? '?'}月`;
}

/** 某农历年某正常月的天数（29/30） */
export function lunarMonthDayCount(lunarYear: number, lunarMonth: number): number {
  const m = LunarMonth.fromYm(lunarYear, lunarMonth);
  if (!m) throw AppError.paramInvalid('该农历月份不存在');
  return m.getDayCount();
}

/**
 * 传统节日判定。
 * 除夕 = 该农历年腊月的最后一天（大小月浮动，故动态判定）。
 */
function resolveFestival(lunarYear: number, month: number, day: number): string | null {
  if (month === 12) {
    const last = lunarMonthDayCount(lunarYear, 12);
    if (day === last) return '除夕';
  }
  return FESTIVALS[`${month}-${day}`] ?? null;
}

/** 节气缓存：年份 → { 'YYYY-MM-DD': 节气名 } */
const termCache = new Map<number, Map<string, string>>();

function termsOfYear(year: number): Map<string, string> {
  const cached = termCache.get(year);
  if (cached) return cached;
  const map = new Map<string, string>();
  const cursor = new Date(Date.UTC(year, 0, 1));
  // 节气落点只会出现在当年（少数落在 1/5、12/22 等），按年逐日扫描 365~366 天
  const daysInYear = new Date(Date.UTC(year, 11, 31)).getTime() - cursor.getTime();
  const total = Math.round(daysInYear / DAY_MS) + 1;
  for (let i = 0; i < total; i += 1) {
    const d = new Date(cursor.getTime() + i * DAY_MS);
    const y = d.getUTCFullYear();
    const m = d.getUTCMonth() + 1;
    const day = d.getUTCDate();
    const name = Solar.fromYmd(y, m, day).getLunar().getJieQi();
    if (name) map.set(`${y}-${pad2(m)}-${pad2(day)}`, name);
  }
  termCache.set(year, map);
  return map;
}

/** 公历 → 农历展示信息；超出支持范围返回 null（不抛错，界面按"无副字"处理） */
export function solarToLunar(dateStr: string): LunarDayInfo | null {
  if (!isLunarSupported(dateStr)) return null;
  const [y, m, d] = dateStr.split('-').map(Number);
  const lunar = Solar.fromYmd(y, m, d).getLunar();
  const month = Math.abs(lunar.getMonth());
  const day = lunar.getDay();
  return {
    month_label: lunarMonthLabel(month),
    day_label: lunar.getDayInChinese(),
    festival: resolveFestival(lunar.getYear(), month, day),
    term: termsOfYear(y).get(dateStr) ?? null,
  };
}

/**
 * 农历 → 公历（单次日程表单与循环引擎共用）。
 *
 * - month 为正常月 1..12（不含闰月语义：传闰月概念由调用方拒绝）；
 * - day 1..30；该月为小月且请求 30 时回落到 29，并置 clamped=true；
 * - 换算结果超出支持范围时抛 4011（PRD 5.6.6）。
 */
export function lunarToSolar(
  lunarYear: number,
  lunarMonth: number,
  lunarDay: number,
  opts: { allowClamp?: boolean } = {}
): ResolvedLunar {
  if (!Number.isInteger(lunarYear) || lunarYear < 1900 || lunarYear > 2100) {
    throw AppError.paramInvalid(`农历年份需在 1900~2100 之间`);
  }
  if (!Number.isInteger(lunarMonth) || lunarMonth < 1 || lunarMonth > 12) {
    throw AppError.paramInvalid('农历月份需在 1~12 之间（不支持闰月）');
  }
  if (!Number.isInteger(lunarDay) || lunarDay < 1 || lunarDay > 30) {
    throw AppError.paramInvalid('农历日期需在 1~30 之间');
  }

  const dayCount = lunarMonthDayCount(lunarYear, lunarMonth);
  const clamped = lunarDay > dayCount;
  if (clamped && opts.allowClamp === false) {
    throw AppError.paramInvalid('该农历月没有这一天');
  }
  const effectiveDay = Math.min(lunarDay, dayCount);

  const solar = Lunar.fromYmd(lunarYear, lunarMonth, effectiveDay).getSolar();
  const gregorian = toDateString(solar);

  if (!isLunarSupported(gregorian)) {
    throw AppError.recurrenceInvalid(`农历日期超出支持范围（1900~2100 年）`);
  }

  const info = solarToLunar(gregorian);
  return {
    gregorian_date: gregorian,
    weekday: solar.getWeek(),
    clamped,
    month_label: lunarMonthLabel(lunarMonth),
    day_label: info?.day_label ?? '',
    festival: resolveFestival(lunarYear, lunarMonth, effectiveDay),
    term: info?.term ?? null,
  };
}

/**
 * 某农历年指定月日对应的公历日期（循环引擎用，失败返回 null 而不抛错，
 * 由引擎在候选生成时跳过——例如候选年超出支持范围）。
 */
export function tryLunarToSolar(
  lunarYear: number,
  lunarMonth: number,
  lunarDay: number
): { date: string; clamped: boolean } | null {
  try {
    const r = lunarToSolar(lunarYear, lunarMonth, lunarDay);
    return { date: r.gregorian_date, clamped: r.clamped };
  } catch {
    return null;
  }
}

/** 供测试与调试：清空年度缓存 */
export function clearLunarCache(): void {
  termCache.clear();
}