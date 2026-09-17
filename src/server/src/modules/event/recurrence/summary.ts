/**
 * 规则人话摘要（系统设计文档 4.7）：
 * 服务端单点产出，表单、详情、卡片、对话回复六处共用同一文案，模型禁止自拼。
 */
import { toZonedNaive, zonedParts } from './engine';
import { AppError } from '../../../common/errors';
import type { RecurrenceRule } from './types';

const WEEKDAY_LABELS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
const ORD_LABELS: Record<number, string> = { 1: '第一个', 2: '第二个', 3: '第三个', 4: '第四个', '-1': '最后一个' };

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function everyPrefix(interval: number, unit: string): string {
  // 每 3 天 / 每周（interval=1 省略数字）
  return interval === 1 ? `每${unit}` : `每 ${interval} ${unit}`;
}

/** 频率部分，例如「每周一、周四」「工作日」「每月最后一个周五」「每 2 周周五」 */
function freqPart(rule: RecurrenceRule, firstStart: Date, tz: string): string {
  const anchor = zonedParts(firstStart, tz);
  switch (rule.freq) {
    case 'daily':
      return everyPrefix(rule.interval, '天');
    case 'weekly': {
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
    default:
      // v0.3.0：年度月日取显式 by_month_day，缺省回退首次实例月日（与 v0.2.0 等价）
      return `${everyPrefix(rule.interval, '年')} ${rule.by_month_day?.month ?? anchor.m} 月 ${
        rule.by_month_day?.day ?? anchor.d
      } 日`;
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
