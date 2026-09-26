/**
 * OccurrenceService：循环实例的展开、合并与作用域写操作（系统设计文档 4.2 / 4.4 / 4.5 / 4.6）。
 *
 * 实例**虚拟展开、绝不物化**：DB 只有系列主记录 + event_overrides 例外行，
 * 本服务负责把两者合并成 OccurrenceDTO，并承载 this / following 两个作用域的写路径。
 */
import type { PoolClient } from 'pg';
import { query, withTransaction } from '../../db/pool';
import { AppError } from '../../common/errors';
import { config } from '../../config';
import { logger } from '../../common/logger';
import { EVENT_SELECT, findSingleConflicts } from './sql';
import {
  expand,
  localDateString,
  toZonedNaive,
  validateRule,
} from './recurrence/engine';
import { summarizeRecurrence } from './recurrence/summary';
import { ensureWorkCalendarLoaded } from './workday/workday.service';
import { solarToLunar } from './lunar/lunar.service';
import {
  OVERRIDE_PATCH_FIELDS,
  type ConflictDateGroup,
  type EventOverrideRow,
  type OccurrenceSeed,
  type OverridePatch,
  type OverrideState,
  type RecurrenceRule,
  type SeriesConflictResult,
} from './recurrence/types';
import {
  eventDurationMs,
  toConflictBrief,
  toEventDTO,
  toSeriesDTO,
  type ConflictLevel,
  type EventConflictBrief,
  type EventRow,
  type OccurrenceDTO,
  type SeriesDTO,
  type UpdateEventInput,
  type WriteEventResult,
} from './types';

const MS_PER_DAY = 86_400_000;

/**
 * 归一化规则：丢弃与频率无关的字段，补齐 interval。
 * 注意：本函数会**静默裁剪**与频率无关的字段（如 weekly 下的 month_rule），
 * 因此只能在 validateRule 校验通过之后调用，否则非法组合会被悄悄放行。
 */
export function normalizeRule(input: RecurrenceRule): RecurrenceRule {
  const rule: RecurrenceRule = {
    freq: input.freq,
    interval: input.interval ?? 1,
    end_type: input.end_type,
  };
  if (input.freq === 'weekly' && input.by_week_days?.length) {
    rule.by_week_days = [...new Set(input.by_week_days)].sort((a, b) => a - b);
  }
  // v0.4.0：weekly 的法定工作日模式（与 by_week_days 互斥，校验已在 validateRule 完成）
  if (input.freq === 'weekly' && input.week_mode === 'workdays_cn') {
    rule.week_mode = 'workdays_cn';
  }
  if (input.freq === 'monthly' && input.month_rule) {
    const mr = input.month_rule;
    rule.month_rule =
      mr.type === 'day_of_month'
        ? { type: 'day_of_month', day: mr.day }
        : { type: 'day_of_week', ord: mr.ord ?? 1, weekday: mr.weekday };
  }
  // v0.3.0：yearly 指定月日（仅保留 month/day 两个字段）
  if (input.freq === 'yearly' && input.by_month_day) {
    rule.by_month_day = { month: input.by_month_day.month, day: input.by_month_day.day };
  }
  // v0.4.0：yearly 指定农历月日（与 by_month_day 互斥，校验已在 validateRule 完成）
  if (input.freq === 'yearly' && input.by_lunar_month_day) {
    rule.by_lunar_month_day = {
      month: input.by_lunar_month_day.month,
      day: input.by_lunar_month_day.day,
    };
  }
  if (rule.end_type === 'count') rule.count = input.count;
  if (rule.end_type === 'until') rule.until = input.until;
  return rule;
}

/**
 * 校验并归一化规则（非法组合抛 4011）：
 * 先对「保留全部入参字段」的规则做语义校验，再裁剪无关字段，
 * 保证 weekly+month_rule 这类非法组合不会被静默丢弃（TC-SERIES-015）。
 */
export function buildRule(input: RecurrenceRule, firstStart: Date, tz: string): RecurrenceRule {
  const kept: RecurrenceRule = {
    ...input,
    interval: input.interval ?? 1,
  };
  if (input.by_week_days) {
    kept.by_week_days = [...new Set(input.by_week_days)].sort((a, b) => a - b);
  }
  validateRule(kept, firstStart, tz);
  return normalizeRule(kept);
}

/* ------------------------- 合并物化 ------------------------- */

function buildOccurrence(
  row: EventRow,
  seed: OccurrenceSeed,
  state: OverrideState,
  patch: Record<string, unknown>,
  summary: string,
  startAt: Date,
  endAt: Date,
  tz: string
): OccurrenceDTO {
  const base = toEventDTO(row, tz);
  const pickString = (key: string, fallback: string | null): string | null =>
    patch[key] === undefined ? fallback : (patch[key] as string | null);
  return {
    ...base,
    id: row.id,
    series_id: row.id,
    occurrence_key: seed.occurrence_key,
    override_state: state,
    recurrence_summary: summary,
    event_type: 'normal',
    title: pickString('title', row.title) ?? '',
    location: pickString('location', row.location),
    note: pickString('note', row.note),
    all_day: patch.all_day === undefined ? row.all_day : patch.all_day === true,
    start_at: startAt.toISOString(),
    end_at: endAt.toISOString(),
    status: state === 'cancelled' ? 'cancelled' : 'scheduled',
    // v0.4.0：农历必须按**实例自身**的开始日计算——
    // toEventDTO 取的是系列主记录（anchor）的日期，跨年实例会显示错误的农历
    lunar: solarToLunar(localDateString(startAt, tz)),
    conflicts: [],
    conflict_level: 'none',
  };
}

export interface MaterializeOptions {
  windowStart: Date;
  windowEnd: Date;
  tz: string;
  /** 是否包含「仅本次已取消」的实例 */
  includeCancelled?: boolean;
}

/** 系列主记录 + overrides → 窗口内实例列表（系统设计文档 4.2 物化合并） */
export function materialize(
  row: EventRow,
  overrides: Map<string, EventOverrideRow>,
  opts: MaterializeOptions
): OccurrenceDTO[] {
  const rule = row.recurrence as RecurrenceRule | null;
  if (!rule) return [];
  const durationMs = eventDurationMs(row);
  const summary = summarizeRecurrence(rule, row.start_at, row.all_day, opts.tz);

  /**
   * 单次改期会把实例移入/移出查询窗口，而 expand 只能按 seed 的原始时间裁剪。
   * 因此先按「查询窗口 ∪ 全部例外改期时间」展开，物化后再按真实窗口裁剪，
   * 保证「改到本窗口内的那一次」也能被查到（TC-SERIES-033/050/054）。
   */
  const patchedTimes: number[] = [];
  for (const ov of overrides.values()) {
    if (ov.action !== 'modified') continue;
    for (const key of ['start_at', 'end_at'] as const) {
      const raw = ov.patch?.[key];
      if (!raw) continue;
      const ms = new Date(String(raw)).getTime();
      if (!Number.isNaN(ms)) patchedTimes.push(ms);
    }
  }
  const expandStart = patchedTimes.length
    ? new Date(Math.min(opts.windowStart.getTime(), ...patchedTimes) - MS_PER_DAY)
    : opts.windowStart;
  const expandEnd = patchedTimes.length
    ? new Date(Math.max(opts.windowEnd.getTime(), ...patchedTimes) + MS_PER_DAY)
    : opts.windowEnd;

  const seeds = expand(rule, row.start_at, durationMs, expandStart, expandEnd, opts.tz);
  const out: OccurrenceDTO[] = [];

  for (const seed of seeds) {
    const ov = overrides.get(seed.occurrence_key);
    let state: OverrideState = 'normal';
    let startAt = seed.start_at;
    let endAt = seed.end_at;
    let patch: Record<string, unknown> = {};

    if (ov?.action === 'cancelled') {
      state = 'cancelled';
      if (!opts.includeCancelled) continue;
    } else if (ov?.action === 'modified') {
      state = 'modified';
      patch = ov.patch ?? {};
      if (patch.start_at) startAt = new Date(String(patch.start_at));
      if (patch.end_at) endAt = new Date(String(patch.end_at));
    }

    // 统一按真实查询窗口裁剪（改期后按 patch 时间，其余按原始时间）
    if (
      !(startAt.getTime() < opts.windowEnd.getTime() && endAt.getTime() > opts.windowStart.getTime())
    ) {
      continue;
    }

    out.push(buildOccurrence(row, seed, state, patch, summary, startAt, endAt, opts.tz));
  }
  return out;
}

/** override 行 → Map<series_id, Map<occurrence_key, row>> */
async function loadOverrides(
  userId: number,
  seriesIds: number[],
  conn: { query: typeof query } = { query }
): Promise<Map<number, Map<string, EventOverrideRow>>> {
  const result = new Map<number, Map<string, EventOverrideRow>>();
  if (seriesIds.length === 0) return result;
  const res = await conn.query<EventOverrideRow>(
    `SELECT * FROM event_overrides WHERE user_id = $1 AND event_id = ANY($2::int[])`,
    [userId, seriesIds]
  );
  for (const row of res.rows) {
    const key = row.occurrence_start.toISOString();
    const bucket = result.get(row.event_id) ?? new Map<string, EventOverrideRow>();
    bucket.set(key, row);
    result.set(row.event_id, bucket);
  }
  return result;
}

/** 窗口相关的系列主记录（部分索引 idx_events_recurring_active） */
async function loadSeriesRowsForWindow(
  userId: number,
  windowStart: Date,
  windowEnd: Date,
  tz: string,
  excludeSeriesId?: number
): Promise<EventRow[]> {
  const res = await query<EventRow>(
    `${EVENT_SELECT}
     WHERE e.user_id = $1
       AND e.recurrence IS NOT NULL
       AND e.start_at < $2::timestamptz
       AND COALESCE(e.recurrence->>'until', '9999-12-31')::date >= $3::date
       AND ($4::int IS NULL OR e.id <> $4::int)
     ORDER BY e.start_at ASC
     LIMIT $5`,
    [userId, windowEnd, localDateString(windowStart, tz), excludeSeriesId ?? null, config.event.listMaxLimit]
  );
  return res.rows;
}

/** 窗口内的循环实例（列表/月聚合用）：取系列 + overrides 后合并物化 */
export async function listSeriesInstances(
  userId: number,
  windowStart: Date,
  windowEnd: Date,
  tz: string,
  opts: { includeCancelled?: boolean; seriesId?: number } = {}
): Promise<OccurrenceDTO[]> {
  // v0.4.0：法定工作日模式依赖进程内已载入的法定日历表（幂等，首次调用载入）
  await ensureWorkCalendarLoaded();
  let rows = await loadSeriesRowsForWindow(userId, windowStart, windowEnd, tz);
  if (opts.seriesId) rows = rows.filter((r) => r.id === opts.seriesId);
  if (rows.length === 0) return [];
  const overrides = await loadOverrides(
    userId,
    rows.map((r) => r.id)
  );
  const out: OccurrenceDTO[] = [];
  for (const row of rows) {
    out.push(
      ...materialize(row, overrides.get(row.id) ?? new Map(), {
        windowStart,
        windowEnd,
        tz,
        includeCancelled: opts.includeCancelled,
      })
    );
  }
  return out;
}

/* ------------------------- 冲突扫描 ------------------------- */

interface CandidateItem {
  brief: EventConflictBrief;
  startMs: number;
  endMs: number;
  allDay: boolean;
}

function occurrenceBrief(o: OccurrenceDTO): EventConflictBrief {
  return {
    id: o.series_id,
    event_type: 'normal',
    title: o.title,
    start_at: o.start_at,
    end_at: o.end_at,
    all_day: o.all_day,
    location: o.location,
    series_id: o.series_id,
    occurrence_key: o.occurrence_key,
  };
}

/**
 * v0.5.0 埋点（SDD 9.2）：全天抑制计数，一次扫描一行，不带标题。
 * 抽样口径 = 按扫描聚合（而非逐条），避免高频日程下日志放大。
 */
function logAlldaySuppressed(userId: number, scene: string, count: number): void {
  if (count <= 0) return;
  logger.info('conflict_allday_suppressed', { user_id: userId, scene, count });
}

/**
 * 收集某窗口内的候选（单次日程 + 其他系列实例，已取消的不参与）。
 * v0.5.0（EVT-01）：全天日程/全天系列实例不参与冲突比对（候选层剔除，
 * SQL 层已排除全天单日，此处对循环实例再显式过滤）。
 */
async function collectCandidates(
  userId: number,
  windowStart: Date,
  windowEnd: Date,
  tz: string,
  excludeSeriesId?: number
): Promise<CandidateItem[]> {
  const items: CandidateItem[] = [];
  let suppressed = 0;
  const single = await findSingleConflicts(userId, windowStart, windowEnd, false, excludeSeriesId);
  for (const row of single.conflicts) {
    if (row.all_day) {
      suppressed += 1;
      continue;
    }
    items.push({
      brief: toConflictBrief(row),
      startMs: row.start_at.getTime(),
      endMs: row.end_at.getTime(),
      allDay: row.all_day,
    });
  }
  const instances = await listSeriesInstances(userId, windowStart, windowEnd, tz, { seriesId: undefined });
  for (const inst of instances) {
    if (excludeSeriesId && inst.series_id === excludeSeriesId) continue;
    if (inst.all_day) {
      suppressed += 1;
      continue;
    }
    items.push({
      brief: occurrenceBrief(inst),
      startMs: new Date(inst.start_at).getTime(),
      endMs: new Date(inst.end_at).getTime(),
      allDay: inst.all_day,
    });
  }
  logAlldaySuppressed(userId, 'candidate_all_day', suppressed);
  return items;
}

/**
 * 创建 / 整条改期的 90 天循环冲突扫描（系统设计文档 4.6）：
 * 目标实例与候选集合在内存中两两相交，按日期分组汇总，不阻断保存。
 *
 * v0.5.0（EVT-01）：目标为全天系列直接返回空——全天安排不产生冲突提示；
 * 冲突等级不再有 all_day 分级（候选已全部为定时）。
 */
export async function scanSeriesConflicts(
  userId: number,
  rule: RecurrenceRule,
  firstStart: Date,
  durationMs: number,
  allDay: boolean,
  tz: string,
  excludeSeriesId?: number
): Promise<SeriesConflictResult> {
  const empty: SeriesConflictResult = {
    conflict_level: 'none',
    conflict_dates: [],
    conflict_dates_total: 0,
    conflict_total: 0,
  };
  // 全天系列：不扫描、不提示
  if (allDay) {
    logAlldaySuppressed(userId, 'target_all_day', 1);
    return empty;
  }

  // v0.4.0：法定工作日模式依赖进程内已载入的法定日历表（幂等，首次调用载入）
  await ensureWorkCalendarLoaded();
  const windowStart = firstStart;
  const windowEnd = new Date(
    firstStart.getTime() + config.event.recurrenceConflictWindowDays * MS_PER_DAY
  );
  const seeds = expand(rule, firstStart, durationMs, windowStart, windowEnd, tz);
  if (seeds.length === 0) return empty;

  const candidates = await collectCandidates(userId, windowStart, windowEnd, tz, excludeSeriesId);
  if (candidates.length === 0) return empty;

  let total = 0;
  const groups: ConflictDateGroup[] = [];

  for (const seed of seeds) {
    const hits = candidates.filter(
      (c) => !c.allDay && seed.start_at.getTime() < c.endMs && seed.end_at.getTime() > c.startMs
    );
    if (hits.length === 0) continue;
    total += hits.length;
    groups.push({
      date: seed.local_date,
      target_start: seed.start_at.toISOString(),
      target_end: seed.end_at.toISOString(),
      conflicts: hits.map((h) => h.brief),
    });
  }

  if (groups.length === 0) return empty;
  logger.info('series_conflict_shown', {
    user_id: userId,
    dates_count: groups.length,
    total,
  });
  return {
    conflict_level: 'overlap',
    // 只回传前 5 个日期分组，其余以计数呈现（UX 6.7）
    conflict_dates: groups.slice(0, 5),
    conflict_dates_total: groups.length,
    conflict_total: total,
  };
}

/**
 * 单次实例改期（scope=this）的冲突检测：排除本系列自身实例。
 * v0.5.0（EVT-01）：目标为全天直接返回空；候选中的全天实例不参与比对。
 */
export async function scanOccurrenceConflicts(
  userId: number,
  startAt: Date,
  endAt: Date,
  allDay: boolean,
  excludeSeriesId: number,
  tz: string
): Promise<{ conflicts: EventConflictBrief[]; conflict_level: ConflictLevel }> {
  // 全天实例改期：不提示冲突
  if (allDay) {
    logAlldaySuppressed(userId, 'target_all_day', 1);
    return { conflicts: [], conflict_level: 'none' };
  }

  const single = await findSingleConflicts(userId, startAt, endAt, allDay, excludeSeriesId);
  let suppressed = 0;
  const candidates: CandidateItem[] = [];
  for (const row of single.conflicts) {
    if (row.all_day) {
      suppressed += 1;
      continue;
    }
    candidates.push({
      brief: toConflictBrief(row),
      startMs: row.start_at.getTime(),
      endMs: row.end_at.getTime(),
      allDay: row.all_day,
    });
  }

  const windowStart = new Date(startAt.getTime() - MS_PER_DAY);
  const windowEnd = new Date(endAt.getTime() + MS_PER_DAY);
  const instances = await listSeriesInstances(userId, windowStart, windowEnd, tz);
  for (const inst of instances) {
    if (inst.series_id === excludeSeriesId) continue;
    if (inst.all_day) {
      suppressed += 1;
      continue;
    }
    candidates.push({
      brief: occurrenceBrief(inst),
      startMs: new Date(inst.start_at).getTime(),
      endMs: new Date(inst.end_at).getTime(),
      allDay: inst.all_day,
    });
  }
  logAlldaySuppressed(userId, 'candidate_all_day', suppressed);

  const hits = candidates.filter((c) => startAt.getTime() < c.endMs && endAt.getTime() > c.startMs);
  if (hits.length === 0) return { conflicts: [], conflict_level: 'none' };
  return {
    conflicts: hits.slice(0, config.event.conflictScanLimit).map((h) => h.brief),
    conflict_level: 'overlap',
  };
}

/* ------------------------- override 读写 ------------------------- */

async function findSeed(
  row: EventRow,
  occurrenceKey: string,
  tz: string
): Promise<OccurrenceSeed | null> {
  const rule = row.recurrence as RecurrenceRule | null;
  if (!rule) return null;
  const keyMs = new Date(occurrenceKey).getTime();
  if (Number.isNaN(keyMs)) throw AppError.occurrenceNotFound();
  const seeds = expand(
    rule,
    row.start_at,
    eventDurationMs(row),
    new Date(keyMs - 1),
    new Date(keyMs + 1),
    tz
  );
  return seeds.find((s) => s.occurrence_key === new Date(keyMs).toISOString()) ?? null;
}

function requireSeries(rule: RecurrenceRule | null, row: EventRow): RecurrenceRule {
  if (!rule) {
    throw AppError.paramInvalid(`日程「${row.title ?? row.id}」不是循环日程，不支持按次操作`);
  }
  return rule;
}

/**
 * 从 patch 中按白名单抽取可覆盖字段，未知键直接拒绝。
 * 与既有 override 做**字段级合并**：本次未涉及的字段沿用既有覆盖，
 * 否则「仅本次改地点」会把此前的改期覆盖冲回原始时间（TC-SERIES-051）。
 */
function pickOverridePatch(
  patch: UpdateEventInput,
  seed: OccurrenceSeed,
  existing?: EventOverrideRow
): OverridePatch {
  const previous = existing?.action === 'modified' ? (existing.patch ?? {}) : {};
  const prevStart = previous.start_at ? new Date(String(previous.start_at)) : null;
  const prevEnd = previous.end_at ? new Date(String(previous.end_at)) : null;
  const baseStart = prevStart ?? seed.start_at;
  const baseEnd = prevEnd ?? seed.end_at;

  let startAt = baseStart;
  let endAt = baseEnd;
  if (patch.start_at !== undefined) {
    startAt = new Date(patch.start_at);
    endAt =
      patch.end_at !== undefined
        ? new Date(patch.end_at)
        : new Date(startAt.getTime() + (baseEnd.getTime() - baseStart.getTime()));
  } else if (patch.end_at !== undefined) {
    endAt = new Date(patch.end_at);
  }
  if (endAt.getTime() < startAt.getTime()) {
    throw AppError.eventTimeInvalid('结束时间需晚于开始时间');
  }

  const out: OverridePatch = { start_at: startAt.toISOString(), end_at: endAt.toISOString() };
  const target = out as unknown as Record<string, unknown>;
  const pick = (key: keyof OverridePatch, next: unknown): void => {
    if (next !== undefined) target[key] = next;
    else if (previous[key] !== undefined) target[key] = previous[key];
  };
  pick('all_day', patch.all_day === undefined ? undefined : patch.all_day === true);
  pick('title', patch.title === undefined || patch.title === null ? undefined : patch.title);
  pick('location', patch.location === undefined ? undefined : patch.location);
  pick('note', patch.note === undefined ? undefined : patch.note);

  // 未知键（如 recurrence/event_type）不允许出现在单次覆盖里；
  // 注意工具路径会显式带上值为 undefined 的可选字段，这类键不算"用户想改的字段"
  for (const key of Object.keys(patch)) {
    if ((patch as Record<string, unknown>)[key] === undefined) continue;
    if (!OVERRIDE_PATCH_FIELDS.includes(key as never) && key !== 'scope' && key !== 'occurrence_key' && key !== 'confirm_conflict') {
      throw AppError.paramInvalid(`「仅本次」不支持修改字段：${key}`);
    }
  }
  return out;
}

async function upsertModified(
  conn: { query: typeof query },
  userId: number,
  seriesId: number,
  occurrenceStart: Date,
  patch: OverridePatch
): Promise<void> {
  await conn.query(
    `INSERT INTO event_overrides(user_id, event_id, occurrence_start, action, patch)
     VALUES ($1, $2, $3::timestamptz, 'modified', $4::jsonb)
     ON CONFLICT (event_id, occurrence_start)
     DO UPDATE SET user_id = EXCLUDED.user_id, action = 'modified',
                   patch = EXCLUDED.patch, updated_at = now()`,
    [userId, seriesId, occurrenceStart.toISOString(), JSON.stringify(patch)]
  );
}

async function upsertCancelled(
  conn: { query: typeof query },
  userId: number,
  seriesId: number,
  occurrenceStart: Date
): Promise<void> {
  await conn.query(
    `INSERT INTO event_overrides(user_id, event_id, occurrence_start, action, patch)
     VALUES ($1, $2, $3::timestamptz, 'cancelled', '{}'::jsonb)
     ON CONFLICT (event_id, occurrence_start)
     DO UPDATE SET user_id = EXCLUDED.user_id, action = 'cancelled',
                   patch = '{}'::jsonb, updated_at = now()`,
    [userId, seriesId, occurrenceStart.toISOString()]
  );
}

async function getSeriesRow(userId: number, seriesId: number): Promise<EventRow> {
  const res = await query<EventRow>(`${EVENT_SELECT} WHERE e.id = $1 AND e.user_id = $2`, [
    seriesId,
    userId,
  ]);
  if (res.rowCount === 0) throw AppError.notFound('日程不存在');
  return res.rows[0];
}

/** 供 EventService 复用：校验归属并取系列主记录 */
export { getSeriesRow };

/** 取「窗口内该系列的一批实例」，用于写操作后回读单个实例 DTO */
async function readOccurrence(
  userId: number,
  row: EventRow,
  occurrenceKey: string,
  tz: string
): Promise<OccurrenceDTO | null> {
  return getInstance(userId, row, occurrenceKey, tz);
}

/* ------------------------- 作用域写操作 ------------------------- */

/** 仅本次编辑：upsert modified override（系统设计文档 8.2） */
async function updateThis(
  userId: number,
  seriesRow: EventRow,
  occurrenceKey: string,
  patch: UpdateEventInput,
  tz: string,
  opts: { confirmConflict?: boolean } = {}
): Promise<WriteEventResult> {
  requireSeries(seriesRow.recurrence as RecurrenceRule | null, seriesRow);
  if (patch.recurrence !== undefined && patch.recurrence !== null) {
    throw AppError.paramInvalid('「仅本次」不能修改重复规则，请选择「整条」');
  }
  const seed = await findSeed(seriesRow, occurrenceKey, tz);
  if (!seed) throw AppError.occurrenceNotFound('未找到该次安排，请刷新后重试');

  // 与该次已有的覆盖做字段级合并，保留此前对时间/标题/地点等的修改
  const existingOverride = (
    await query<EventOverrideRow>(
      `SELECT * FROM event_overrides
       WHERE user_id = $1 AND event_id = $2 AND occurrence_start = $3::timestamptz`,
      [userId, seriesRow.id, seed.start_at.toISOString()]
    )
  ).rows[0];
  const override = pickOverridePatch(patch, seed, existingOverride);
  const startAt = new Date(override.start_at);
  const endAt = new Date(override.end_at ?? override.start_at);
  const allDay = override.all_day === undefined ? seriesRow.all_day : override.all_day;

  const { conflicts, conflict_level } = await scanOccurrenceConflicts(
    userId,
    startAt,
    endAt,
    allDay,
    seriesRow.id,
    tz
  );
  if (conflicts.length > 0 && !opts.confirmConflict) {
    return {
      saved: false,
      event: null,
      conflicts,
      conflict_level,
      need_conflict_confirmation: true,
      conflict_scope: 'occurrence',
    };
  }

  await upsertModified({ query }, userId, seriesRow.id, seed.start_at, override);
  logger.info('override_written', {
    user_id: userId,
    series_id: seriesRow.id,
    action: 'modified',
  });
  const occurrence = await readOccurrence(userId, seriesRow, occurrenceKey, tz);
  return {
    saved: true,
    event: occurrence,
    conflicts,
    conflict_level,
    need_conflict_confirmation: false,
    conflict_scope: 'occurrence',
  };
}

/** 仅取消本次：upsert cancelled override（可恢复，不经 pending 门控） */
async function cancelThis(
  userId: number,
  seriesRow: EventRow,
  occurrenceKey: string,
  tz: string
): Promise<OccurrenceDTO> {
  requireSeries(seriesRow.recurrence as RecurrenceRule | null, seriesRow);
  const seed = await findSeed(seriesRow, occurrenceKey, tz);
  if (!seed) throw AppError.occurrenceNotFound('未找到该次安排，请刷新后重试');
  await upsertCancelled({ query }, userId, seriesRow.id, seed.start_at);
  logger.info('override_written', { user_id: userId, series_id: seriesRow.id, action: 'cancelled' });
  const occurrence = await readOccurrence(userId, seriesRow, occurrenceKey, tz);
  if (!occurrence) throw AppError.occurrenceNotFound();
  return occurrence;
}

/** 恢复本次：删除 override 行 */
async function restoreOccurrence(
  userId: number,
  seriesRow: EventRow,
  occurrenceKey: string,
  tz: string
): Promise<OccurrenceDTO | null> {
  requireSeries(seriesRow.recurrence as RecurrenceRule | null, seriesRow);
  const keyMs = new Date(occurrenceKey).getTime();
  if (Number.isNaN(keyMs)) throw AppError.occurrenceNotFound();
  await query(
    `DELETE FROM event_overrides WHERE user_id = $1 AND event_id = $2 AND occurrence_start = $3::timestamptz`,
    [userId, seriesRow.id, new Date(keyMs).toISOString()]
  );
  // 删除可能返回 0 行（本来就无覆盖），此时实例已是原始态，仍然回读
  logger.info('override_restored', { user_id: userId, series_id: seriesRow.id });
  return readOccurrence(userId, seriesRow, new Date(keyMs).toISOString(), tz);
}

/** 本次及以后：截断原系列 + 派生新系列 + 迁移 override（系统设计文档 4.5） */
async function updateFromFollowing(
  userId: number,
  seriesRow: EventRow,
  occurrenceKey: string,
  patch: UpdateEventInput,
  tz: string,
  opts: { confirmConflict?: boolean } = {}
): Promise<WriteEventResult> {
  const rule = requireSeries(seriesRow.recurrence as RecurrenceRule | null, seriesRow);
  const seed = await findSeed(seriesRow, occurrenceKey, tz);
  if (!seed) throw AppError.occurrenceNotFound('未找到该次安排，请刷新后重试');

  const durationMs = eventDurationMs(seriesRow);
  const newStartAt = patch.start_at !== undefined ? new Date(patch.start_at) : seed.start_at;
  const newEndAt =
    patch.end_at !== undefined
      ? new Date(patch.end_at)
      : new Date(newStartAt.getTime() + durationMs);
  if (newEndAt.getTime() < newStartAt.getTime()) {
    throw AppError.eventTimeInvalid('结束时间需晚于开始时间');
  }

  /**
   * 派生规则：默认继承原规则（保留星期/月内规则），结束条件按原系列在本次之后的剩余量设置；
   * 若本次同时改了规则（如「从下次开始改成周二」），则以新规则为派生规则基底（TC-CHAT-089/094）。
   */
  const ruleOverridden = patch.recurrence !== undefined && patch.recurrence !== null;
  const derivedRule: RecurrenceRule = ruleOverridden
    ? { ...buildRule(patch.recurrence as RecurrenceRule, newStartAt, tz) }
    : { ...rule };
  const beforeCount = Math.max(0, seed.index); // 本次之前的实例数
  if (ruleOverridden) {
    // 新规则自带结束条件，直接采用（已按新锚点校验）
  } else if (rule.end_type === 'count') {
    const remaining = (rule.count ?? 0) - beforeCount;
    if (remaining <= 1) {
      // 本次之后没有更多实例，等价于只改本次
      return updateThis(userId, seriesRow, occurrenceKey, patch, tz, opts);
    }
    derivedRule.end_type = 'count';
    derivedRule.count = remaining;
  } else {
    derivedRule.end_type = rule.end_type;
  }

  // 截断原系列：until 提前到本次的前一天
  const d0 = new Date(seed.local_date + 'T00:00:00Z');
  const prevUntil = new Date(d0.getTime() - MS_PER_DAY);
  const truncatedRule: RecurrenceRule = { ...rule };
  let deleteOriginal = false;
  if (rule.end_type === 'never' || rule.end_type === 'until') {
    truncatedRule.end_type = 'until';
    truncatedRule.until = prevUntil.toISOString().slice(0, 10);
    delete truncatedRule.count;
    const firstLocal = new Date(toZonedNaive(seriesRow.start_at, tz));
    if (new Date(truncatedRule.until + 'T00:00:00Z').getTime() < firstLocal.getTime()) {
      deleteOriginal = true;
    }
  } else {
    const kept = Math.max(0, beforeCount);
    if (kept === 0) deleteOriginal = true;
    else {
      truncatedRule.end_type = 'count';
      truncatedRule.count = kept;
    }
  }

  const newRule = buildRule(derivedRule, newStartAt, tz);
  const truncated = deleteOriginal ? null : buildRule(truncatedRule, seriesRow.start_at, tz);

  if (!opts.confirmConflict) {
    const scan = await scanSeriesConflicts(
      userId,
      newRule,
      newStartAt,
      durationMs,
      seriesRow.all_day,
      tz,
      seriesRow.id
    );
    if (scan.conflict_total > 0) {
      return {
        saved: false,
        event: null,
        conflicts: scan.conflict_dates.flatMap((g) => g.conflicts),
        conflict_level: scan.conflict_level,
        need_conflict_confirmation: true,
        conflict_dates: scan.conflict_dates,
        conflict_dates_total: scan.conflict_dates_total,
        conflict_total: scan.conflict_total,
        conflict_scope: 'series',
      };
    }
  }

  const result = await withTransaction(async (client: PoolClient) => {
    const update: string[] = [];
    const params: unknown[] = [];
    let index = 1;
    if (truncated) {
      update.push(`recurrence = $${index++}::jsonb`);
      params.push(JSON.stringify(truncated));
    }
    update.push(`start_at = $${index++}::timestamptz`, `end_at = $${index++}::timestamptz`);
    params.push(newStartAt.toISOString(), newEndAt.toISOString());
    if (patch.all_day !== undefined) {
      update.push(`all_day = $${index++}`);
      params.push(patch.all_day === true);
    }
    if (patch.title !== undefined && patch.title !== null) {
      update.push(`title = $${index++}`);
      params.push(patch.title);
    }
    if (patch.location !== undefined) {
      update.push(`location = $${index++}`);
      params.push(patch.location);
    }
    if (patch.note !== undefined) {
      update.push(`note = $${index++}`);
      params.push(patch.note);
    }
    update.push('updated_at = now()');

    let newSeriesId: number;
    if (deleteOriginal) {
      // 原系列无保留实例：直接改主记录（不新建）
      params.push(seriesRow.id, userId);
      await client.query(
        `UPDATE events SET ${update.join(', ')} WHERE id = $${index++} AND user_id = $${index}`,
        params
      );
      newSeriesId = seriesRow.id;
    } else {
      await client.query(
        `UPDATE events SET recurrence = $1::jsonb, updated_at = now() WHERE id = $2 AND user_id = $3`,
        [JSON.stringify(truncated), seriesRow.id, userId]
      );

      const insertCols = [
        'user_id',
        'event_type',
        'title',
        'note',
        'location',
        'all_day',
        'start_at',
        'end_at',
        'source',
        'recurrence',
        'derived_from_event_id',
      ];
      const insertVals = [
        userId,
        'normal',
        seriesRow.title,
        patch.note !== undefined ? patch.note : seriesRow.note,
        patch.location !== undefined ? patch.location : seriesRow.location,
        patch.all_day !== undefined ? patch.all_day === true : seriesRow.all_day,
        newStartAt.toISOString(),
        newEndAt.toISOString(),
        seriesRow.source,
        JSON.stringify(newRule),
        seriesRow.id,
      ];
      const placeholders = insertVals.map((_, i) => `$${i + 1}`);
      const inserted = await client.query<{ id: number }>(
        `INSERT INTO events(${insertCols.join(', ')}) VALUES (${placeholders.join(', ')}) RETURNING id`,
        insertVals
      );
      newSeriesId = inserted.rows[0].id;

      // 迁移本次及以后的 override 到派生系列（key 不变）
      await client.query(
        `UPDATE event_overrides SET event_id = $1, updated_at = now()
         WHERE user_id = $2 AND event_id = $3 AND occurrence_start >= $4::timestamptz`,
        [newSeriesId, userId, seriesRow.id, seed.start_at.toISOString()]
      );
    }
    return newSeriesId;
  });

  logger.info('series_truncated_derived', {
    user_id: userId,
    old_series_id: seriesRow.id,
    new_series_id: result,
  });

  const [oldRow, newRow] = await Promise.all([
    getSeriesRow(userId, seriesRow.id),
    getSeriesRow(userId, result),
  ]);
  return {
    saved: true,
    event: toSeriesDTO(newRow, tz),
    conflicts: [],
    conflict_level: 'none',
    need_conflict_confirmation: false,
    derived: {
      old_series: toSeriesDTO(oldRow, tz),
      new_series: toSeriesDTO(newRow, tz),
    },
  };
}

/* ------------------------- 系列详情 ------------------------- */

const PAGE_WINDOWS = [1, 3, 5]; // 年，逐级放宽以覆盖年频率

/** 系列详情的实例分页：未来正序 / 历史倒序（系统设计文档 7.2） */
async function listOccurrences(
  userId: number,
  seriesRow: EventRow,
  section: 'upcoming' | 'past',
  cursor: string | undefined,
  tz: string,
  now = new Date()
): Promise<{ list: OccurrenceDTO[]; next_cursor: string | null }> {
  requireSeries(seriesRow.recurrence as RecurrenceRule | null, seriesRow);
  const pageSize = config.event.occurrencePageSize;
  const overrides = (await loadOverrides(userId, [seriesRow.id])).get(seriesRow.id) ?? new Map();

  const collected: OccurrenceDTO[] = [];
  const cursorMs = cursor ? new Date(cursor).getTime() : null;

  if (section === 'upcoming') {
    const startMs = Math.max(now.getTime(), cursorMs ?? 0, seriesRow.start_at.getTime());
    for (const years of PAGE_WINDOWS) {
      const windowStart = new Date(startMs - MS_PER_DAY);
      const windowEnd = new Date(startMs + years * 365 * MS_PER_DAY);
      const list = materialize(seriesRow, overrides, { windowStart, windowEnd, tz });
      collected.length = 0;
      collected.push(...list);
      if (collected.length >= pageSize) break;
    }
    // 游标为「上一页最后一条」，本页必须严格晚于它，避免重复项（TC-SERIES-038）
    const after = cursorMs
      ? collected.filter((o) => new Date(o.start_at).getTime() > cursorMs)
      : collected;
    const list = after.slice(0, pageSize);
    const next = after.length > pageSize ? list[list.length - 1].occurrence_key : null;
    return { list, next_cursor: next };
  }

  // past：取到 now 为止的实例再倒序
  const windowStart = new Date(seriesRow.start_at.getTime() - MS_PER_DAY);
  const windowEnd = new Date((cursorMs ?? now.getTime()) + 1);
  const all = materialize(seriesRow, overrides, { windowStart, windowEnd, tz, includeCancelled: true })
    .filter((o) => new Date(o.start_at).getTime() < (cursorMs ?? now.getTime()))
    .sort((a, b) => new Date(b.start_at).getTime() - new Date(a.start_at).getTime());
  const list = all.slice(0, pageSize);
  const next = all.length > pageSize ? list[list.length - 1].occurrence_key : null;
  return { list, next_cursor: next };
}

/** 系列详情（规则 + 摘要 + 下一次 + 总次数） */
async function getSeriesDetail(
  userId: number,
  seriesId: number,
  tz: string,
  now = new Date()
): Promise<SeriesDTO> {
  const row = await getSeriesRow(userId, seriesId);
  requireSeries(row.recurrence as RecurrenceRule | null, row);
  return toSeriesDTO(row, tz, now);
}

/** 历史卡片批量回查：取系列主记录与全部 override，按 key 重算实例态 */
async function getManySeriesByIds(
  userId: number,
  ids: number[]
): Promise<{
  rows: Map<number, EventRow>;
  overrides: Map<number, Map<string, EventOverrideRow>>;
}> {
  const unique = [...new Set(ids)].filter((id) => Number.isInteger(id) && id > 0);
  const rows = new Map<number, EventRow>();
  if (unique.length === 0) return { rows, overrides: new Map() };
  const res = await query<EventRow>(
    `${EVENT_SELECT} WHERE e.user_id = $1 AND e.id = ANY($2::int[]) AND e.recurrence IS NOT NULL`,
    [userId, unique]
  );
  const overrides = await loadOverrides(userId, res.rows.map((r) => r.id));
  for (const row of res.rows) rows.set(row.id, row);
  return { rows, overrides };
}

/**
 * 实例查询窗口：覆盖「原始时间 ∪ 该次覆盖的改期时间」各 ±1 天。
 * 只按原始 key 取窗口会导致「改期后按 key 查询」取不到实例（TC-SERIES-033/050）。
 */
function windowFor(keyMs: number, ov?: EventOverrideRow): { start: Date; end: Date } {
  const times = [keyMs];
  if (ov?.action === 'modified') {
    for (const k of ['start_at', 'end_at'] as const) {
      const raw = ov.patch?.[k];
      if (!raw) continue;
      const ms = new Date(String(raw)).getTime();
      if (!Number.isNaN(ms)) times.push(ms);
    }
  }
  return {
    start: new Date(Math.min(...times) - MS_PER_DAY),
    end: new Date(Math.max(...times) + MS_PER_DAY),
  };
}

/** 取单个实例视角 DTO（写操作回读、实例详情、历史卡片刷新共用） */
async function getInstance(
  userId: number,
  row: EventRow,
  occurrenceKey: string,
  tz: string
): Promise<OccurrenceDTO | null> {
  const keyMs = new Date(occurrenceKey).getTime();
  if (Number.isNaN(keyMs)) return null;
  const key = new Date(keyMs).toISOString();
  const overrides = (await loadOverrides(userId, [row.id])).get(row.id) ?? new Map();
  const window = windowFor(keyMs, overrides.get(key));
  return (
    materialize(row, overrides, {
      windowStart: window.start,
      windowEnd: window.end,
      tz,
      includeCancelled: true,
    }).find((o) => o.occurrence_key === key) ?? null
  );
}

/** 单实例视角 DTO（历史卡片刷新用，overrides 由调用方提供） */
export function materializeSingle(
  row: EventRow,
  overrides: Map<string, EventOverrideRow>,
  occurrenceKey: string,
  tz: string
): OccurrenceDTO | null {
  const keyMs = new Date(occurrenceKey).getTime();
  if (Number.isNaN(keyMs)) return null;
  const key = new Date(keyMs).toISOString();
  const window = windowFor(keyMs, overrides.get(key));
  return (
    materialize(row, overrides, {
      windowStart: window.start,
      windowEnd: window.end,
      tz,
      includeCancelled: true,
    }).find((o) => o.occurrence_key === key) ?? null
  );
}

export const occurrenceService = {
  materialize,
  materializeSingle,
  getInstance,
  listSeriesInstances,
  scanSeriesConflicts,
  scanOccurrenceConflicts,
  listOccurrences,
  getSeriesDetail,
  getManySeriesByIds,
  getSeriesRow,
  updateThis,
  updateFromFollowing,
  cancelThis,
  restoreOccurrence,
  /** 该实例是否在当前规则下仍然存在（超出 until/count 的实例视为已结束） */
  async existsInRule(seriesRow: EventRow, occurrenceKey: string, tz: string) {
    return (await findSeed(seriesRow, occurrenceKey, tz)) !== null;
  },
};

export type { OccurrenceDTO, SeriesDTO };
