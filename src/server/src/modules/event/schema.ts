import { z } from 'zod';

/**
 * 日程参数校验：REST 路由与 LLM 工具执行器共用同一套 schema，
 * 保证「能力对等」下两条路径的校验行为完全一致。
 */

export const eventTypeEnum = z.enum(['normal', 'task']);

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

export const tzField = z.string().min(1).max(64).optional();
export const dateField = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, '日期格式应为 YYYY-MM-DD')
  .optional();

const idsField = z.coerce.number().int().positive();

/**
 * 创建日程。
 * 兼容「只给 task_id 未给 event_type」的模型输出：视为任务日程。
 */
const createEventBase = z.object({
  event_type: eventTypeEnum.optional(),
  task_id: idsField.nullish(),
  title: z.string().nullish(),
  note: z.string().nullish(),
  location: z.string().nullish(),
  all_day: boolish.optional(),
  start_at: isoTime,
  end_at: isoTime,
  confirm_conflict: boolish.optional(),
});

export const createEventSchema = z.preprocess((raw) => {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    const obj = raw as Record<string, unknown>;
    const hasTask = obj.task_id !== undefined && obj.task_id !== null && obj.task_id !== '';
    if (obj.event_type === undefined && hasTask) {
      return { ...obj, event_type: 'task' };
    }
  }
  return raw;
}, createEventBase).superRefine((v, ctx) => {
  const isTask = v.event_type === 'task';
  if (isTask && !v.task_id) {
    ctx.addIssue({ code: 'custom', path: ['task_id'], message: '任务日程必须指定关联任务' });
  }
  if (!isTask && v.task_id) {
    ctx.addIssue({ code: 'custom', path: ['task_id'], message: '普通日程不能关联任务' });
  }
  if (!isTask && !(v.title ?? '').trim()) {
    ctx.addIssue({ code: 'custom', path: ['title'], message: '请输入日程标题' });
  }
});

/**
 * 编辑日程。
 * 注意：这里**显式接受** event_type/task_id，由服务层统一拒绝（4003）并回灌模型，
 * 而不是静默剥离 —— 后者会让模型误以为改类型成功了。
 */
export const updateEventSchema = z.object({
  title: z.string().nullish(),
  note: z.string().nullish(),
  location: z.string().nullish(),
  all_day: boolish.optional(),
  start_at: isoTime.optional(),
  end_at: isoTime.optional(),
  event_type: eventTypeEnum.optional(),
  task_id: idsField.nullish(),
  confirm_conflict: boolish.optional(),
});

export const listEventsSchema = z.object({
  date: dateField,
  date_from: dateField,
  date_to: dateField,
  tz: tzField,
  task_id: idsField.optional(),
  event_type: eventTypeEnum.optional(),
  sort: z.string().optional(),
  limit: z.coerce.number().int().positive().max(200).optional(),
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
  event_type: eventTypeEnum.optional(),
  task_id: idsField.nullish(),
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