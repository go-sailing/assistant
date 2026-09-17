/**
 * RecurrenceEngine：RRULE 受控子集的纯函数展开（对应系统设计文档 4.1）。
 *
 * 无 DB / IO 依赖，输入规则 + 首次时间 + 窗口 + 时区，输出窗口内的原始实例。
 * 规则在用户时区（IANA）的「本地墙钟时间」上推进，最后再折算为 UTC 瞬时，
 * 避免夏令时切换导致实例时间漂移。
 */
import { config } from '../../../config';
import { AppError } from '../../../common/errors';
import { logger } from '../../../common/logger';
import type { OccurrenceSeed, RecurrenceRule } from './types';

const MS_PER_DAY = 86_400_000;
const MAX_MS = 8_640_000_000_000_000;

export interface ZonedParts {
  y: number;
  m: number;
  d: number;
  hh: number;
  mi: number;
  ss: number;
  ms: number;
}

const formatterCache = new Map<string, Intl.DateTimeFormat>();

function formatterFor(tz: string): Intl.DateTimeFormat {
  const cached = formatterCache.get(tz);
  if (cached) return cached;
  const created = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  formatterCache.set(tz, created);
  return created;
}

/** 把 UTC 瞬时拆成用户时区下的本地墙钟分量 */
export function zonedParts(instant: Date, tz: string): ZonedParts {
  const parts = formatterFor(tz).formatToParts(instant);
  const pick = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? '0');
  return {
    y: pick('year'),
    m: pick('month'),
    d: pick('day'),
    hh: pick('hour'),
    mi: pick('minute'),
    ss: pick('second'),
    ms: instant.getMilliseconds(),
  };
}

/** 某个瞬时在目标时区的偏移毫秒数（东八区为 +28800000） */
function zonedOffsetMs(instant: Date, tz: string): number {
  const p = zonedParts(instant, tz);
  const asUtc = Date.UTC(p.y, p.m - 1, p.d, p.hh, p.mi, p.ss, p.ms);
  return asUtc - instant.getTime();
}

/**
 * 本地墙钟（naive ms，用 Date.UTC 承载）→ UTC 瞬时。
 * 两轮迭代即可覆盖夏令时边界（不存在的时刻向前落到切换后）。
 */
export function fromZonedNaive(naiveMs: number, tz: string): Date {
  const guessOffset = zonedOffsetMs(new Date(naiveMs), tz);
  let candidate = new Date(naiveMs - guessOffset);
  const realOffset = zonedOffsetMs(candidate, tz);
  if (realOffset !== guessOffset) candidate = new Date(naiveMs - realOffset);
  return candidate;
}

/** UTC 瞬时 → 本地墙钟（naive ms） */
export function toZonedNaive(instant: Date, tz: string): number {
  const p = zonedParts(instant, tz);
  return Date.UTC(p.y, p.m - 1, p.d, p.hh, p.mi, p.ss, p.ms);
}

/** 本地日期字符串 YYYY-MM-DD */
export function localDateString(instant: Date, tz: string): string {
  const p = zonedParts(instant, tz);
  return `${p.y}-${pad2(p.m)}-${pad2(p.d)}`;
}

/** naive ms → 本地日期字符串 */
export function naiveDateString(naiveMs: number): string {
  const d = new Date(naiveMs);
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}

/** YYYY-MM-DD → 当日 00:00 的 naive ms */
export function naiveOfDate(dateStr: string): number {
  const [y, m, d] = dateStr.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}

/** YYYY-MM-DD → 当日 23:59:59.999 的 naive ms */
export function naiveEndOfDate(dateStr: string): number {
  return naiveOfDate(dateStr) + MS_PER_DAY - 1;
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function daysInMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/** naive ms 的星期（0=周日） */
function weekdayOfNaive(naiveMs: number): number {
  return new Date(naiveMs).getUTCDay();
}

/** 周一为一周起始的偏移量（周一=0 … 周日=6） */
function mondayOffset(weekday: number): number {
  return (weekday + 6) % 7;
}

function partsOfNaive(naiveMs: number): ZonedParts {
  const d = new Date(naiveMs);
  return {
    y: d.getUTCFullYear(),
    m: d.getUTCMonth() + 1,
    d: d.getUTCDate(),
    hh: d.getUTCHours(),
    mi: d.getUTCMinutes(),
    ss: d.getUTCSeconds(),
    ms: d.getUTCMilliseconds(),
  };
}

/**
 * 规则校验（REST zod 之后、Service 写库之前执行），非法抛 4011。
 * firstStart 为系列主记录的开始时间（UTC 瞬时）。
 */
export function validateRule(rule: RecurrenceRule, firstStart: Date, tz: string): void {
  const intervalMax = config.event.recurIntervalMax;
  if (!Number.isInteger(rule.interval) || rule.interval < 1 || rule.interval > intervalMax) {
    throw AppError.recurrenceInvalid(`重复间隔需在 1~${intervalMax} 之间`);
  }

  const first = partsOfNaive(toZonedNaive(firstStart, tz));

  if (rule.by_week_days !== undefined) {
    if (rule.freq !== 'weekly') {
      throw AppError.recurrenceInvalid('只有「每周」重复才能指定星期');
    }
    if (rule.by_week_days.length === 0) {
      throw AppError.recurrenceInvalid('请至少选择一个星期');
    }
    for (const wd of rule.by_week_days) {
      if (!Number.isInteger(wd) || wd < 0 || wd > 6) {
        throw AppError.recurrenceInvalid('星期取值需在 0~6 之间');
      }
    }
  }

  if (rule.month_rule !== undefined) {
    if (rule.freq !== 'monthly') {
      throw AppError.recurrenceInvalid('只有「每月」重复才能指定月内规则');
    }
    if (rule.month_rule.type === 'day_of_month') {
      const day = rule.month_rule.day;
      if (!Number.isInteger(day) || (day as number) < 1 || (day as number) > 31) {
        throw AppError.recurrenceInvalid('每月日期需在 1~31 之间');
      }
    } else if (rule.month_rule.type === 'day_of_week') {
      const { ord, weekday } = rule.month_rule;
      if (![1, 2, 3, 4, -1].includes(ord as number)) {
        throw AppError.recurrenceInvalid('「第几个周几」只支持第 1~4 个或最后一个');
      }
      if (!Number.isInteger(weekday) || (weekday as number) < 0 || (weekday as number) > 6) {
        throw AppError.recurrenceInvalid('星期取值需在 0~6 之间');
      }
    } else {
      throw AppError.recurrenceInvalid('月内规则类型不合法');
    }
  }

  if (rule.freq === 'yearly' && (rule.by_week_days || rule.month_rule)) {
    throw AppError.recurrenceInvalid('「每年」重复不支持星期或月内规则');
  }
  if (rule.freq === 'daily' && (rule.by_week_days || rule.month_rule)) {
    throw AppError.recurrenceInvalid('「每天」重复不支持星期或月内规则');
  }

  // v0.3.0：by_month_day 仅 yearly 可用（结构与范围已由 zod 拦截，此处做业务兜底）
  if (rule.by_month_day !== undefined) {
    if (rule.freq !== 'yearly') {
      throw AppError.recurrenceInvalid('只有「每年」重复才能指定月日');
    }
    const { month, day } = rule.by_month_day;
    if (!Number.isInteger(month) || month < 1 || month > 12) {
      throw AppError.recurrenceInvalid('月份取值需在 1~12 之间');
    }
    if (!Number.isInteger(day) || day < 1 || day > 31) {
      throw AppError.recurrenceInvalid('日期取值需在 1~31 之间');
    }
  }

  const firstDateMs = Date.UTC(first.y, first.m - 1, first.d);

  // 结束条件必须自洽：never 不接受 count/until，count 与 until 互斥（TC-SEC-025c）
  if (rule.end_type === 'never') {
    if (rule.count !== undefined || rule.until !== undefined) {
      throw AppError.recurrenceInvalid('「永不结束」不能同时指定重复次数或截止日期');
    }
  } else if (rule.end_type === 'count') {
    if (rule.until !== undefined) {
      throw AppError.recurrenceInvalid('重复次数与截止日期不能同时指定');
    }
  } else if (rule.end_type === 'until') {
    if (rule.count !== undefined) {
      throw AppError.recurrenceInvalid('截止日期与重复次数不能同时指定');
    }
  }

  if (rule.end_type === 'count') {
    const count = rule.count;
    if (!Number.isInteger(count) || (count as number) < 1) {
      throw AppError.recurrenceInvalid('重复次数需为不小于 1 的整数');
    }
    if ((count as number) > config.event.seriesMaxCount) {
      throw AppError.recurrenceInvalid(`重复次数不能超过 ${config.event.seriesMaxCount} 次`);
    }
  } else if (rule.end_type === 'until') {
    if (!rule.until || !/^\d{4}-\d{2}-\d{2}$/.test(rule.until)) {
      throw AppError.recurrenceInvalid('请选择重复截止日期');
    }
    const untilMs = naiveOfDate(rule.until);
    if (Number.isNaN(untilMs)) {
      throw AppError.recurrenceInvalid('重复截止日期格式不正确');
    }
    if (untilMs < firstDateMs) {
      throw AppError.recurrenceInvalid('重复截止日期不能早于首次时间');
    }
    const maxUntil = new Date(firstDateMs);
    maxUntil.setUTCFullYear(maxUntil.getUTCFullYear() + config.event.seriesMaxUntilYears);
    if (untilMs > maxUntil.getTime()) {
      throw AppError.recurrenceInvalid(
        `重复截止日期不能超过首次时间后 ${config.event.seriesMaxUntilYears} 年`
      );
    }
  } else if (rule.end_type !== 'never') {
    throw AppError.recurrenceInvalid('重复结束条件不合法');
  }
}

/** 生成第 k 个周期内的全部候选（naive ms，升序） */
function cycleCandidates(
  rule: RecurrenceRule,
  anchor: ZonedParts,
  anchorNaive: number,
  k: number
): number[] {
  const hh = anchor.hh;
  const mi = anchor.mi;
  const ss = anchor.ss;
  const ms = anchor.ms;
  const at = (y: number, m: number, d: number) =>
    Date.UTC(y, m - 1, d, hh, mi, ss, ms);

  switch (rule.freq) {
    case 'daily':
      return [anchorNaive + k * rule.interval * MS_PER_DAY];

    case 'weekly': {
      const weekdays = (rule.by_week_days?.length
        ? [...rule.by_week_days]
        : [weekdayOfNaive(anchorNaive)]
      ).slice();
      weekdays.sort((a, b) => a - b);
      // 周期锚点 = 首次所在 ISO 周（周一）的第 0 天
      const monday0 = anchorNaive - mondayOffset(weekdayOfNaive(anchorNaive)) * MS_PER_DAY;
      const weekStart = monday0 + k * rule.interval * 7 * MS_PER_DAY;
      return weekdays.map((wd) => weekStart + mondayOffset(wd) * MS_PER_DAY);
    }

    case 'monthly': {
      const monthIndex = anchor.y * 12 + (anchor.m - 1) + k * rule.interval;
      const y = Math.floor(monthIndex / 12);
      const m = (monthIndex % 12) + 1;
      const mr = rule.month_rule;
      if (mr && mr.type === 'day_of_week') {
        const target = mr.weekday as number;
        const dim = daysInMonth(y, m);
        const days: number[] = [];
        for (let d = 1; d <= dim; d += 1) {
          if (weekdayOfNaive(Date.UTC(y, m - 1, d)) === target) days.push(d);
        }
        if (days.length === 0) return [];
        const ord = mr.ord === -1 ? -1 : (mr.ord as number);
        const day = ord === -1 ? days[days.length - 1] : days[ord - 1];
        return day ? [at(y, m, day)] : [];
      }
      const wanted = mr && mr.type === 'day_of_month' ? (mr.day as number) : anchor.d;
      const dim = daysInMonth(y, m);
      // 31 日遇到小月落到当月最后一天
      return [at(y, m, Math.min(wanted, dim))];
    }

    case 'yearly': {
      const y = anchor.y + k * rule.interval;
      // v0.3.0：优先使用显式指定的月日，缺省回退首次实例的月日（与 v0.2.0 等价）
      const m = rule.by_month_day?.month ?? anchor.m;
      const d = rule.by_month_day?.day ?? anchor.d;
      const dim = daysInMonth(y, m);
      // 31 日遇到小月落到当月最后一天；2 月 29 日在平年落到 2 月 28 日
      return [at(y, m, Math.min(d, dim))];
    }

    default:
      return [];
  }
}

/** 估算窗口起点落在第几个周期，避免长历史系列从系列起点白跑 */
function cycleIndexForWindow(
  rule: RecurrenceRule,
  anchor: ZonedParts,
  anchorNaive: number,
  fromNaive: number
): number {
  const diff = fromNaive - anchorNaive;
  if (diff <= 0) return 0;
  let approx: number;
  switch (rule.freq) {
    case 'daily':
      approx = Math.floor(diff / (rule.interval * MS_PER_DAY));
      break;
    case 'weekly':
      approx = Math.floor(diff / (rule.interval * 7 * MS_PER_DAY));
      break;
    case 'monthly': {
      const from = partsOfNaive(fromNaive);
      const months = (from.y - anchor.y) * 12 + (from.m - anchor.m);
      approx = Math.floor(Math.max(0, months - 1) / rule.interval);
      break;
    }
    default: {
      const from = partsOfNaive(fromNaive);
      approx = Math.floor(Math.max(0, from.y - anchor.y - 1) / rule.interval);
      break;
    }
  }
  return Math.max(0, approx);
}

/**
 * 展开窗口内的原始实例（未应用 override），按开始时间升序。
 * 左闭右开：保留与 [windowStart, windowEnd) 相交的实例。
 *
 * @param durationMs 单次时长（墙钟口径，全天系列为整天数 × 24h）
 */
export function expand(
  rule: RecurrenceRule,
  firstStart: Date,
  durationMs: number,
  windowStart: Date,
  windowEnd: Date,
  tz: string
): OccurrenceSeed[] {
  const maxSeeds = config.event.seriesMaxCount;
  const anchorNaive = toZonedNaive(firstStart, tz);
  const anchor = partsOfNaive(anchorNaive);
  const delta = Math.max(0, durationMs);

  const windowStartNaive = toZonedNaive(windowStart, tz);
  const windowEndNaive = toZonedNaive(windowEnd, tz) + MS_PER_DAY;

  const untilBoundNaive =
    rule.end_type === 'until' && rule.until ? naiveEndOfDate(rule.until) : Number.POSITIVE_INFINITY;
  const countBound = rule.end_type === 'count' ? Math.min(rule.count ?? maxSeeds, maxSeeds) : maxSeeds;

  const results: OccurrenceSeed[] = [];
  // count 必须从系列起点累计，故从 0 开始；其余按窗口跳过历史周期
  const startCycle =
    rule.end_type === 'count'
      ? 0
      : cycleIndexForWindow(rule, anchor, anchorNaive, windowStartNaive - MS_PER_DAY);

  let produced = 0;
  let cycle = startCycle;

  // 上限保护：无论规则如何组合，单次展开产出不超过 maxSeeds 个种子
  while (produced < maxSeeds && results.length < maxSeeds) {
    const candidates = cycleCandidates(rule, anchor, anchorNaive, cycle);

    if (candidates.length === 0) {
      cycle += 1;
      if (cycle - startCycle > maxSeeds) break;
      continue;
    }

    // 窗口明显早于当前周期与更晚周期时可直接结束
    if (candidates[0] > untilBoundNaive || candidates[0] > windowEndNaive) break;

    for (const naive of candidates.sort((a, b) => a - b)) {
      if (naive < anchorNaive) continue; // 首次之前的候选不产生实例
      if (naive > untilBoundNaive) return results;
      if (naive > windowEndNaive) return results;
      if (produced >= countBound) return results;

      produced += 1;

      const startAt = fromZonedNaive(naive, tz);
      const endAt = fromZonedNaive(naive + delta, tz);
      if (startAt.getTime() < windowEnd.getTime() && endAt.getTime() > windowStart.getTime()) {
        results.push({
          index: produced - 1,
          occurrence_key: startAt.toISOString(),
          start_at: startAt,
          end_at: endAt,
          all_day: false,
          local_date: naiveDateString(naive),
        });
      }
      if (produced >= maxSeeds) return results;
    }

    cycle += 1;
  }

  if (produced >= maxSeeds) {
    // 埋点：规则组合导致展开被截断，便于发现异常规则
    logger.warn('occurrence_expand_truncated', { freq: rule.freq, max: maxSeeds });
  }
  return results;
}

/** 首次不早于 from 的下一次实例（系列详情「下一次」用） */
export function firstOccurrenceAfter(
  rule: RecurrenceRule,
  firstStart: Date,
  durationMs: number,
  from: Date,
  tz: string
): OccurrenceSeed | null {
  let windowStart = from;
  for (let i = 0; i < 6; i += 1) {
    const windowEnd = new Date(
      Math.min(from.getTime() + (i + 1) * 365 * MS_PER_DAY, MAX_MS)
    );
    const seeds = expand(rule, firstStart, durationMs, windowStart, windowEnd, tz);
    if (seeds.length > 0) return seeds[0];
    windowStart = windowEnd;
  }
  return null;
}

/**
 * 系列的首次实例（v0.3.0，读模型 first_occurrence_at）。
 * 语义 = 「不早于系列开始时间的第一个候选」：yearly 指定月日本年已过时自然落到次年
 * （按 interval 步进）；其余频率结果即开始时间当次。规则已耗尽时为 null。
 */
export function firstOccurrenceAt(
  rule: RecurrenceRule,
  firstStart: Date,
  durationMs: number,
  tz: string
): OccurrenceSeed | null {
  return firstOccurrenceAfter(rule, firstStart, durationMs, firstStart, tz);
}

/** 按规则推算的实例总数（count 精确；until/never 用窗口展开估算，上限 maxCount） */
export function countOccurrences(
  rule: RecurrenceRule,
  firstStart: Date,
  durationMs: number,
  tz: string
): number {
  if (rule.end_type === 'count') return Math.min(rule.count ?? 0, config.event.seriesMaxCount);
  const cap = config.event.seriesMaxCount;
  const seeds = expand(
    rule,
    firstStart,
    durationMs,
    firstStart,
    new Date(firstStart.getTime() + 40 * 365 * MS_PER_DAY),
    tz
  );
  return Math.min(seeds.length, cap);
}
