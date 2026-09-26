import { z } from 'zod';
import { config } from '../../config';

/**
 * 日程参数校验：REST 路由与 LLM 工具执行器共用同一套 schema，
 * 保证「能力对等」下两条路径的校验行为完全一致。
 *
 * v0.8.0：任务日程已下线，创建/编辑不再接受 event_type / task_id；
 * 携带旧字段的请求显式拒绝 1001（比静默剥离更早暴露旧客户端，SDD 8.2 / T5）。
 */

/** v0.2.0：写操作作用域 */
export const eventScopeEnum = z.enum(['series', 'this', 'following']);

/** 宽容布尔：兼容模型传 "true"/"false" 字符串的情况 */
const boolish = z.preprocess((v) => {
  if (typeof v === 'string') {
    if (v.toLowerCase() === 'true') return true;
    if (v.toLowerCase() === 'false') return false;
  }
  return v;
}, z.boolean());

/** ISO8601 时间（允许带时区偏移） */
const isoTime = z
  .string()
  .min(1, '时间不能为空')
  .refine((v) => !Number.isNaN(new Date(v).getTime()), '时间格式不正确');

/** v0.2.0：循环实例身份键，必须是 ISO 时间串 */
export const occurrenceKeyField = isoTime;

export const tzField = z.string().min(1).max(64).optional();
export const dateField = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, '日期格式应为 YYYY-MM-DD')
  .optional();

const idsField = z.coerce.number().int().positive();

/* ------------------- v0.2.0 循环规则 ------------------- */

const weekdayArray = z
  // 严格数字：不接受 "1" 这类字符串混淆（TC-SEC-025）
  .array(z.number().int().min(0).max(6))
  .min(1, '请至少选择一天')
  .max(7)
  .transform((arr) => [...new Set(arr)].sort((a, b) => a - b));

const monthRuleSchema = z.object({
  type: z.enum(['day_of_month', 'day_of_week']),
  day: z.number().int().min(1).max(31).optional(),
  ord: z.union([z.literal(-1), z.literal(1), z.literal(2), z.literal(3), z.literal(4)]).optional(),
  weekday: z.number().int().min(0).max(6).optional(),
});

/**
 * v0.3.0：yearly 指定的月日。结构边界在此拦截；「仅 yearly 可携带」的语义约束
 * 由 Service 的 validateRule 抛 4011（保持 zod 与业务校验的分工一致）。
 */
const byMonthDaySchema = z.object({
  month: z.number().int().min(1).max(12),
  day: z.number().int().min(1).max(31),
});

/**
 * v0.4.0：yearly 指定的每年农历月日。
 * 只支持正常月（1..12，无闰月语义）；日 1..30，遇农历小月由换算层回落到廿九。
 */
const byLunarMonthDaySchema = z.object({
  month: z.number().int().min(1).max(12),
  day: z.number().int().min(1).max(30),
});

/**
 * v0.4.0：weekly 的星期模式。
 * workdays_cn = 法定工作日（避开放假、含调休补班），与 by_week_days 互斥
 * （互斥与 interval=1 的语义约束由 Service validateRule 抛 4011）。
 */
const weekModeSchema = z.enum(['workdays_cn']);

/**
 * 结束条件字段在所有分支均可出现，交由 Service 的 validateRule 做「矛盾组合」校验
 * （如 end_type=never 却带 until/count），避免被 zod 静默剥离（TC-SEC-025c）。
 */
const endFields = {
  count: z.coerce.number().int().min(1).max(config.event.seriesMaxCount).optional(),
  until: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, '日期格式应为 YYYY-MM-DD').optional(),
};

const recurrenceBase = {
  freq: z.enum(['daily', 'weekly', 'monthly', 'yearly']),
  interval: z.coerce.number().int().min(1).max(config.event.recurIntervalMax).default(1),
  by_week_days: weekdayArray.optional(),
  week_mode: weekModeSchema.optional(),
  month_rule: monthRuleSchema.optional(),
  by_month_day: byMonthDaySchema.optional(),
  by_lunar_month_day: byLunarMonthDaySchema.optional(),
  ...endFields,
};

/**
 * 结构化校验（freq 枚举 / interval 边界 / 星期去重 / end_type 判别联合）；
 * until、count 的语义边界（截止早于首次、超 5 年等）由 Service validateRule 抛 4011。
 */
export const recurrenceSchema = z.discriminatedUnion('end_type', [
  z.object({ ...recurrenceBase, end_type: z.literal('never') }),
  z.object({
    ...recurrenceBase,
    end_type: z.literal('count'),
    count: z.coerce.number().int().min(1).max(config.event.seriesMaxCount),
  }),
  z.object({
    ...recurrenceBase,
    end_type: z.literal('until'),
    until: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, '日期格式应为 YYYY-MM-DD'),
  }),
]);

/**
 * 创建日程（v0.8.0：普通日程为唯一类型）。
 */
const createEventBase = z.object({
  title: z.string().nullish(),
  note: z.string().nullish(),
  location: z.string().nullish(),
  all_day: boolish.optional(),
  start_at: isoTime,
  end_at: isoTime,
  /** v0.2.0：重复规则 */
  recurrence: recurrenceSchema.nullish(),
  confirm_conflict: boolish.optional(),
});

export const createEventSchema = createEventBase;

/**
 * 编辑日程。
 * v0.8.0：不再接受 event_type / task_id（携带即在路由/执行器层拒绝 1001）。
 * v0.2.0：新增 scope（series 默认 / this / following）、occurrence_key、recurrence。
 */
export const updateEventSchema = z.object({
  title: z.string().nullish(),
  note: z.string().nullish(),
  location: z.string().nullish(),
  all_day: boolish.optional(),
  start_at: isoTime.optional(),
  end_at: isoTime.optional(),
  recurrence: recurrenceSchema.nullish(),
  scope: eventScopeEnum.optional(),
  occurrence_key: occurrenceKeyField.optional(),
  confirm_conflict: boolish.optional(),
});

export const deleteEventSchema = z.object({
  scope: z.enum(['series', 'this']).optional(),
  occurrence_key: occurrenceKeyField.optional(),
});

export const listEventsSchema = z.object({
  date: dateField,
  date_from: dateField,
  date_to: dateField,
  tz: tzField,
  sort: z.string().optional(),
  limit: z.coerce.number().int().positive().max(200).optional(),
  /** v0.2.0：只看某个系列的实例 / 只看循环 / 含已取消 */
  series_id: idsField.optional(),
  recurring_only: boolish.optional(),
  include_cancelled: boolish.optional(),
});

export const seriesDetailQuerySchema = z.object({
  tz: tzField,
  section: z.enum(['upcoming', 'past']).optional(),
  cursor: z.string().optional(),
});

export const restoreOccurrenceSchema = z.object({
  occurrence_key: occurrenceKeyField,
});

export const searchEventsSchema = z.object({
  keyword: z.string().min(1, '请输入搜索关键词'),
});

/** 批量改期/删除的筛选条件与更新字段（至少各一项） */
export const batchEventFilterSchema = z.object({
  date: dateField,
  date_from: dateField,
  date_to: dateField,
  tz: tzField,
  keyword: z.string().nullish(),
});

export const batchEventsSchema = z.object({
  filter: batchEventFilterSchema,
  update: z
    .object({
      start_at: isoTime.optional(),
      end_at: isoTime.optional(),
      all_day: boolish.optional(),
      note: z.string().nullish(),
      location: z.string().nullish(),
    })
    .optional(),
  /** update 缺省时表示批量删除 */
  delete: boolish.optional(),
  confirm_conflict: boolish.optional(),
});

export const clarifyEventSchema = z.object({
  question: z.string().min(1),
  candidate_event_ids: z.array(idsField).optional(),
  pending_intent: z.string().optional(),
});