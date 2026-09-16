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
      return `${everyPrefix(rule.interval, '年')} ${anchor.m} 月 ${anchor.d} 日`;
  }
}

function anchorWeekday(firstStart: Date, tz: string): number {
  return new Date(toZonedNaive(firstStart, tz)).getUTCDay();
}

/** 小月 / 闰年回落注释 */
function fallbackNote(rule: RecurrenceRule, firstStart: Date, tz: string): string {
  const anchor = zonedParts(firstStart, tz);
  if (rule.freq === 'monthly') {
    const mr = rule.month_rule;
    const day = mr && mr.type === 'day_of_month' ? (mr.day as number) : anchor.d;
    if (!mr || mr.type === 'day_of_month') {
      if (day > 28) return '，遇到小月落到当月最后一天';
    }
  }
  if (rule.freq === 'yearly' && anchor.m === 2 && anchor.d === 29) {
    return '，遇到平年落到 2 月 28 日';
  }
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
  return [
    freqPart(rule, firstStart, tz),
    timePart(allDay, firstStart, tz),
    fallbackNote(rule, firstStart, tz),
    endPart(rule),
  ].join('');
}
