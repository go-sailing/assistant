/**
 * 规则人话摘要（系统设计文档 4.7）：
 * 服务端单点产出，表单、详情、卡片、对话回复六处共用同一文案，模型禁止自拼。
 */
import { toZonedNaive, zonedParts } from './engine';
import { AppError } from '../../../common/errors';
import { hasYearData } from '../workday/workday.service';
import type { RecurrenceRule } from './types';

const WEEKDAY_LABELS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
const ORD_LABELS: Record<number, string> = { 1: '第一个', 2: '第二个', 3: '第三个', 4: '第四个', '-1': '最后一个' };

/** v0.4.0：农历月名（正常月，1=正月 … 12=腊月） */
const LUNAR_MONTH_LABELS = [
  '正月', '二月', '三月', '四月', '五月', '六月',
  '七月', '八月', '九月', '十月', '冬月', '腊月',
];
/** v0.4.0：农历日名（1..30） */
const LUNAR_DAY_LABELS = [
  '初一', '初二', '初三', '初四', '初五', '初六', '初七', '初八', '初九', '初十',
  '十一', '十二', '十三', '十四', '十五', '十六', '十七', '十八', '十九', '二十',
  '廿一', '廿二', '廿三', '廿四', '廿五', '廿六', '廿七', '廿八', '廿九', '三十',
];

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function everyPrefix(interval: number, unit: string): string {
  // 每 3 天 / 每周（interval=1 省略数字）
  return interval === 1 ? `每${unit}` : `每 ${interval} ${unit}`;
}

/**
 * 频率部分，例如「每周一、周四」「工作日」「每月最后一个周五」「每 2 周周五」
 * v0.4.0 新增：「每个工作日」（法定）与「每年农历八月十五」。
 */
function freqPart(rule: RecurrenceRule, firstStart: Date, tz: string): string {
  const anchor = zonedParts(firstStart, tz);
  switch (rule.freq) {
    case 'daily':
      return everyPrefix(rule.interval, '天');
    case 'weekly': {
      // v0.4.0：法定工作日模式（避开放假、含调休补班），文案与字面周一~周五区分
      if (rule.week_mode === 'workdays_cn') return '每个工作日';
      const days = [...(rule.by_week_days?.length ? rule.by_week_days : [anchorWeekday(firstStart, tz)])].sort(
        (a, b) => a - b
      );
      const isWorkday =
        rule.interval === 1 && days.length === 5 && days.every((d, i) => d === i + 1);
      if (isWorkday) return '工作日';
      const labels = days.map((d) => WEEKDAY_LABELS[d]).join('、');
      // interval=1 时「每周一、周四」；interval>1 时「每 2 周周五」
      return rule.interval === 1
        ? `每${labels}`
        : `${everyPrefix(rule.interval, '周')}${labels}`;
    }
    case 'monthly': {
      const mr = rule.month_rule;
      if (mr && mr.type === 'day_of_week') {
        const ord = mr.ord === -1 ? -1 : (mr.ord as number);
        return `${everyPrefix(rule.interval, '月')}${ORD_LABELS[ord]}${WEEKDAY_LABELS[mr.weekday as number]}`;
      }
      const day = mr && mr.type === 'day_of_month' ? (mr.day as number) : anchor.d;
      return `${everyPrefix(rule.interval, '月')} ${day} 日`;
    }
    default: {
      // v0.4.0：农历月日（正常月，公历日期逐年浮动）
      if (rule.by_lunar_month_day) {
        const { month, day } = rule.by_lunar_month_day;
        const prefix = everyPrefix(rule.interval, '年');
        const isLastDayOfYear = month === 12 && day === 30;
        const label = `${prefix}农历${LUNAR_MONTH_LABELS[month - 1]}${LUNAR_DAY_LABELS[day - 1]}`;
        // 腊月三十即除夕（小月年由引擎自动落廿九）；其他月三十遇小月同样回落
        if (isLastDayOfYear) return `${label}（除夕，遇小月按廿九）`;
        if (day === 30) return `${label}（遇小月按廿九）`;
        return label;
      }
      // v0.3.0：年度月日取显式 by_month_day，缺省回退首次实例月日（与 v0.2.0 等价）
      return `${everyPrefix(rule.interval, '年')} ${rule.by_month_day?.month ?? anchor.m} 月 ${
        rule.by_month_day?.day ?? anchor.d
      } 日`;
    }
  }
}

function anchorWeekday(firstStart: Date, tz: string): number {
  return new Date(toZonedNaive(firstStart, tz)).getUTCDay();
}

/** 小月回落注释（monthly，沿用 v0.2.0 文案与位置） */
function fallbackNote(rule: RecurrenceRule, firstStart: Date, tz: string): string {
  const anchor = zonedParts(firstStart, tz);
  if (rule.freq === 'monthly') {
    const mr = rule.month_rule;
    const day = mr && mr.type === 'day_of_month' ? (mr.day as number) : anchor.d;
    if (!mr || mr.type === 'day_of_month') {
      if (day > 28) return '，遇到小月落到当月最后一天';
    }
  }
  return '';
}

/**
 * 年度月日的月末/闰年括注（v0.3.0，PRD 5.4）：
 * 以「实际生效的月日」（by_month_day ?? 首次实例月日）为准；只输出适用的一条。
 */
function yearlyFallbackNote(rule: RecurrenceRule, firstStart: Date, tz: string): string {
  if (rule.freq !== 'yearly') return '';
  const anchor = zonedParts(firstStart, tz);
  const month = rule.by_month_day?.month ?? anchor.m;
  const day = rule.by_month_day?.day ?? anchor.d;
  if (month === 2 && day === 29) return '（平年安排在 2 月 28 日）';
  if (day >= 29) return '（遇到小月落到当月最后一天）';
  return '';
}

function timePart(allDay: boolean, firstStart: Date, tz: string): string {
  if (allDay) return '，全天';
  const p = zonedParts(firstStart, tz);
  return ` ${pad2(p.hh)}:${pad2(p.mi)}`;
}

function endPart(rule: RecurrenceRule): string {
  if (rule.end_type === 'count') return `，共 ${rule.count ?? 0} 次`;
  if (rule.end_type === 'until' && rule.until) return `，至 ${rule.until} 止`;
  return '，长期重复';
}

/** 生成人类可读的重复规则摘要（中文） */
export function summarizeRecurrence(
  rule: RecurrenceRule,
  firstStart: Date,
  allDay: boolean,
  tz: string
): string {
  if (!rule || !rule.freq) throw AppError.recurrenceInvalid('缺少重复频率');
  const yearlyNote = yearlyFallbackNote(rule, firstStart, tz);
  if (yearlyNote) {
    // 年度括注缀于末尾（PRD 5.3/5.4 示例：每年 2 月 29 日，全天，共 3 次（平年安排在 2 月 28 日））
    return [
      freqPart(rule, firstStart, tz),
      timePart(allDay, firstStart, tz),
      endPart(rule),
      yearlyNote,
    ].join('');
  }
  return [
    freqPart(rule, firstStart, tz),
    timePart(allDay, firstStart, tz),
    fallbackNote(rule, firstStart, tz),
    endPart(rule),
  ].join('');
}

/**
 * 估算"系列最后一次实例所在年份"，用于判断展开范围是否跨入未公布法定安排的年份。
 * - until：即截止年份（精确）；
 * - count：按频率估算时间跨度（信息性提示，允许边界误差）；
 * - never：只看次年（未结束的系列必然跨年，取一年即可覆盖"公布前"的场景）。
 */
function lastRelevantYear(rule: RecurrenceRule, anchor: { y: number; d: number }): number {
  if (rule.end_type === 'until' && rule.until) return Number(rule.until.slice(0, 4));
  const count = rule.end_type === 'count' ? rule.count : null;
  if (count === null || count === undefined) return anchor.y + 1;
  const perOccurrenceDays = (() => {
    switch (rule.freq) {
      case 'daily':
        return rule.interval;
      case 'weekly': {
        const picks =
          rule.week_mode === 'workdays_cn' ? 5 : Math.max(1, rule.by_week_days?.length ?? 1);
        return (rule.interval * 7) / picks;
      }
      case 'monthly':
        return rule.interval * 30.4;
      default:
        return rule.interval * 365;
    }
  })();
  const spanDays = count * perOccurrenceDays;
  return anchor.y + Math.max(1, Math.ceil(spanDays / 365));
}

/**
 * v0.4.0：系列的补充说明行（PRD 4.1/4.4 / 5.6.5，独立字段 recurrence_note，不塞进摘要正文）。
 *
 * - 法定工作日：展开范围跨入尚未录入法定安排的年份时，提示"公布前按周一至周五计算"；
 * - 农历年度：说明公历日期逐年浮动；
 * - 其余规则返回 null。
 */
export function recurrenceNote(
  rule: RecurrenceRule,
  firstStart: Date,
  tz: string
): string | null {
  if (rule.freq === 'weekly' && rule.week_mode === 'workdays_cn') {
    const anchor = zonedParts(firstStart, tz);
    // PRD 4.1：跨入未公布年份即需注明；数据补齐后该提示自动消失
    const lastYear = lastRelevantYear(rule, anchor);
    for (let y = anchor.y; y <= lastYear; y += 1) {
      if (!hasYearData(y)) {
        return '未来年份按官方安排公布后自动更新；公布前按周一至周五计算';
      }
    }
    return null;
  }
  if (rule.freq === 'yearly' && rule.by_lunar_month_day) {
    return '按农历每年重复，公历日期逐年不同';
  }
  return null;
}
