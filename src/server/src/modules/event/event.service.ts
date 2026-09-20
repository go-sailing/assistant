import { query } from '../../db/pool';
import { AppError } from '../../common/errors';
import { config } from '../../config';
import { logger } from '../../common/logger';
import { EVENT_LIMITS } from './types';
import { EVENT_SELECT, findSingleConflicts } from './sql';
import { fromZonedNaive, naiveOfDate, localDateString } from './recurrence/engine';
import { occurrenceService, buildRule } from './occurrence.service';
import { solarToLunar, lunarToSolar } from './lunar/lunar.service';
import { ensureWorkCalendarLoaded, getCalendarDay } from './workday/workday.service';
import {
  eventDurationMs,
  normalizeEventSort,
  toEventDTO,
  toSeriesDTO,
  type ConflictLevel,
  type CreateEventInput,
  type EventConflictBrief,
  type EventDTO,
  type EventFilter,
  type EventRow,
  type EventType,
  type MonthDayCount,
  type OccurrenceDTO,
  type SeriesDTO,
  type UpdateEventInput,
  type WriteEventResult,
} from './types';
import type { EventScope, RecurrenceRule } from './recurrence/types';

const MS_PER_DAY = 86_400_000;

/** 任务排期前置校验所需的最小任务信息 */
interface ScheduleTaskRow {
  id: number;
  title: string;
  status: string;
}

function normalizeDateOnly(value: string | null | undefined, label: string): string | null {
  if (!value) return null;
  const trimmed = String(value).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    throw AppError.paramInvalid(`${label}格式应为 YYYY-MM-DD`);
  }
  return trimmed;
}

function parseTime(value: string | null | undefined, label: string): Date {
  if (!value) throw AppError.eventTimeInvalid(`请填写${label}`);
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw AppError.eventTimeInvalid(`${label}格式不正确`);
  }
  return date;
}

function normalizeTitle(title: string | null | undefined): string {
  const trimmed = (title ?? '').trim();
  if (!trimmed) throw AppError.paramInvalid('请输入日程标题');
  if (trimmed.length > EVENT_LIMITS.TITLE_MAX) {
    throw AppError.paramInvalid(`日程标题不能超过 ${EVENT_LIMITS.TITLE_MAX} 个字符`);
  }
  return trimmed;
}

function normalizeNote(note: string | null | undefined): string | null {
  if (note === undefined || note === null) return null;
  const trimmed = String(note);
  if (trimmed.length > EVENT_LIMITS.NOTE_MAX) {
    throw AppError.paramInvalid(`备注不能超过 ${EVENT_LIMITS.NOTE_MAX} 个字符`);
  }
  return trimmed.length ? trimmed : null;
}

function normalizeLocation(location: string | null | undefined): string | null {
  if (location === undefined || location === null) return null;
  const trimmed = String(location).trim();
  if (trimmed.length > EVENT_LIMITS.LOCATION_MAX) {
    throw AppError.paramInvalid(`地点不能超过 ${EVENT_LIMITS.LOCATION_MAX} 个字符`);
  }
  return trimmed.length ? trimmed : null;
}

/** 合法时区名缓存（首次使用时从数据库读取，避免每次查询） */
let tzNameCache: Set<string> | null = null;

/**
 * 校验并归一化时区：
 * 非法值（含路径穿越、SQL 注入片段、不存在的时区名）一律回退默认时区，
 * 不能让拼写错误导致 500（否则会暴露数据库错误信息）。
 */
async function resolveTz(input?: string | null): Promise<string> {
  const fallback = config.event.defaultTz;
  const tz = (input ?? '').trim();
  if (!tz) return fallback;
  // 先做字符白名单，挡掉明显非法输入，避免无谓查询
  if (!/^[A-Za-z][A-Za-z0-9_+/\-]{0,63}$/.test(tz)) return fallback;
  try {
    if (!tzNameCache) {
      const res = await query<{ name: string }>('SELECT name FROM pg_timezone_names');
      tzNameCache = new Set(res.rows.map((r) => r.name));
    }
    return tzNameCache.has(tz) ? tz : fallback;
  } catch {
    // 时区字典查询失败时不影响主流程
    return fallback;
  }
}

/** 时间段左闭右开相交判定 */
function intersect(a: { start_at: string; end_at: string }, b: { start_at: string; end_at: string }): boolean {
  return new Date(a.start_at).getTime() < new Date(b.end_at).getTime() &&
    new Date(a.end_at).getTime() > new Date(b.start_at).getTime();
}

/**
 * 列表场景的冲突标注：直接在已取回的结果集内两两比对，避免 N+1 查询。
 * 合并集（单次日程 + 循环实例）在内存中统一比对，跨类型冲突也能命中。
 *
 * v0.5.0（EVT-01）：任一方为全天日程即跳过标注（全天安排不排斥当天再排定时日程）；
 * 只保留定时 × 定时的重叠标注，等级不再有 all_day 分级。
 */
function attachConflicts(dtos: EventDTO[]): void {
  for (let i = 0; i < dtos.length; i += 1) {
    const self = dtos[i];
    const hits: EventConflictBrief[] = [];
    if (!self.all_day) {
      for (let j = 0; j < dtos.length; j += 1) {
        if (i === j) continue;
        const other = dtos[j];
        if (other.all_day) continue;
        if (!intersect(self, other)) continue;
        hits.push({
          id: Number(other.id),
          event_type: other.event_type,
          title: other.title,
          start_at: other.start_at,
          end_at: other.end_at,
          all_day: other.all_day,
          location: other.location,
          series_id:
            'series_id' in other ? ((other as OccurrenceDTO).series_id as number) : (other.id as number),
          occurrence_key:
            'occurrence_key' in other ? ((other as OccurrenceDTO).occurrence_key as string) : null,
        });
      }
    }
    dtos[i].conflicts = hits;
    dtos[i].conflict_level = hits.length === 0 ? 'none' : 'overlap';
  }
}

/** 排期形状是否变化（决定整条改规则时是否需要重扫冲突） */
function scheduleShapeChanged(before: RecurrenceRule, after: RecurrenceRule): boolean {
  return (
    before.freq !== after.freq ||
    before.interval !== after.interval ||
    JSON.stringify(before.by_week_days ?? null) !== JSON.stringify(after.by_week_days ?? null) ||
    JSON.stringify(before.month_rule ?? null) !== JSON.stringify(after.month_rule ?? null)
  );
}

/** 把筛选条件换算成用户时区下的绝对时间窗口（左闭右开） */
function resolveWindow(
  filter: EventFilter,
  tz: string
): { start: Date; end: Date } | null {
  const date = normalizeDateOnly(filter.date, 'date');
  const from = normalizeDateOnly(filter.date_from, 'date_from');
  const to = normalizeDateOnly(filter.date_to, 'date_to');
  if (date) {
    const startNaive = naiveOfDate(date);
    return {
      start: fromZonedNaive(startNaive, tz),
      end: fromZonedNaive(startNaive + MS_PER_DAY, tz),
    };
  }
  if (from || to) {
    const startNaive = from ? naiveOfDate(from) : naiveOfDate('1970-01-01');
    const endNaive = to ? naiveOfDate(to) : naiveOfDate('9999-12-31');
    return { start: fromZonedNaive(startNaive, tz), end: fromZonedNaive(endNaive, tz) };
  }
  // 只给系列/循环/任务标识（对话工具常见问法：「这个系列/这个任务接下来有哪些」）时默认取今天起未来一年
  if (filter.series_id || filter.recurring_only || filter.task_id) {
    const now = Date.now();
    return { start: new Date(now - MS_PER_DAY), end: new Date(now + 365 * MS_PER_DAY) };
  }
  return null;
}

/** 实例的关键词匹配（在内存中进行，避免为实例再建索引） */
function instanceMatchesKeyword(inst: OccurrenceDTO, keyword?: string): boolean {
  if (!keyword || !keyword.trim()) return true;
  const kw = keyword.trim().toLowerCase();
  return [inst.title, inst.note, inst.location]
    .filter((v): v is string => !!v)
    .some((v) => v.toLowerCase().includes(kw));
}

function applyInstanceFilters(list: OccurrenceDTO[], filter: EventFilter): OccurrenceDTO[] {
  let out = list;
  if (filter.series_id) out = out.filter((o) => o.series_id === filter.series_id);
  if (filter.event_type === 'task') return [];
  if (filter.task_id) return [];
  if (filter.keyword) out = out.filter((o) => instanceMatchesKeyword(o, filter.keyword));
  return out;
}

/**
 * 日程领域服务：REST 控制器与 LLM 工具执行器共用此服务，
 * 保证「能力对等」与业务规则只实现一次（系统设计文档 2.1 / 4.3）。
 */
export const eventService = {
  defaultTz(): string {
    return config.event.defaultTz;
  },

  async resolveTz(input?: string | null): Promise<string> {
    return resolveTz(input);
  },

  async getOwnedRow(userId: number, eventId: number): Promise<EventRow> {
    const res = await query<EventRow>(`${EVENT_SELECT} WHERE e.id = $1 AND e.user_id = $2`, [
      eventId,
      userId,
    ]);
    if (res.rowCount === 0) throw AppError.notFound('日程不存在');
    return res.rows[0];
  },

  /**
   * 取日程：
   * - 系列主记录（recurrence 非空）→ 系列 DTO（带规则与摘要）；
   * - 带 occurrenceKey → 实例视角 DTO；
   * - 否则 → 单次日程 DTO（含冲突标注）。
   */
  async get(
    userId: number,
    eventId: number,
    opts: { occurrenceKey?: string | null; tz?: string | null } = {}
  ): Promise<EventDTO> {
    const tz = await resolveTz(opts.tz);
    const row = await this.getOwnedRow(userId, eventId);

    if (opts.occurrenceKey && row.recurrence) {
      // 实例查询窗口需覆盖该次改期后的时间，否则改期过的实例按 key 取不到（TC-SERIES-033）
      const inst = await occurrenceService.getInstance(userId, row, opts.occurrenceKey, tz);
      if (!inst) throw AppError.occurrenceNotFound('该次安排已不存在');
      const { conflicts, conflict_level } = await this.findConflicts(
        userId,
        new Date(inst.start_at),
        new Date(inst.end_at),
        inst.all_day,
        row.id,
        tz
      );
      inst.conflicts = conflicts;
      inst.conflict_level = conflict_level;
      return inst;
    }

    if (row.recurrence) {
      const dto = toSeriesDTO(row, tz);
      dto.conflicts = [];
      dto.conflict_level = 'none';
      return dto;
    }

    const dto = toEventDTO(row, tz);
    const { conflicts, conflict_level } = await this.findConflicts(
      userId,
      row.start_at,
      row.end_at,
      row.all_day,
      row.id,
      tz
    );
    dto.conflicts = conflicts;
    dto.conflict_level = conflict_level;
    return dto;
  },

  /** 批量按 ID 取日程（用于刷新历史消息中的日程卡片快照） */
  async getManyByIds(userId: number, ids: number[]): Promise<Map<number, EventDTO>> {
    const unique = [...new Set(ids)].filter((id) => Number.isInteger(id) && id > 0);
    if (unique.length === 0) return new Map();
    const res = await query<EventRow>(
      `${EVENT_SELECT} WHERE e.user_id = $1 AND e.id = ANY($2::int[])`,
      [userId, unique]
    );
    return new Map(
      res.rows.map((row) => [
        row.id,
        row.recurrence ? toSeriesDTO(row, config.event.defaultTz) : toEventDTO(row),
      ])
    );
  },

  /** 批量取系列（历史卡片刷新，附带 overrides 供实例重算） */
  async getManySeriesByIds(userId: number, ids: number[]) {
    return occurrenceService.getManySeriesByIds(userId, ids);
  },

  /**
   * 冲突检测：同一用户的时间段左闭右开相交即为冲突。
   * 候选包含单次日程与「其他系列」展开出的实例（排除自身系列）。
   */
  async findConflicts(
    userId: number,
    startAt: Date,
    endAt: Date,
    targetAllDay: boolean,
    excludeId?: number,
    tz?: string
  ): Promise<{ conflicts: EventConflictBrief[]; conflict_level: ConflictLevel }> {
    const resolved = tz ?? config.event.defaultTz;
    return occurrenceService.scanOccurrenceConflicts(
      userId,
      startAt,
      endAt,
      targetAllDay,
      excludeId ?? 0,
      resolved
    );
  },

  /** 任务排期前置校验：任务必须存在、属于当前用户且未完成 */
  async requireSchedulableTask(userId: number, taskId: number): Promise<ScheduleTaskRow> {
    const res = await query<ScheduleTaskRow>(
      `SELECT t.id, t.title, t.status
       FROM tasks t
       WHERE t.id = $1 AND t.user_id = $2`,
      [taskId, userId]
    );
    if (res.rowCount === 0) {
      // v0.8.0：项目已不在 tasks 表 —— 命中项目时给出明确文案（I7：项目不可排期）
      const project = await query<{ id: number }>(
        `SELECT id FROM projects WHERE id = $1 AND user_id = $2`,
        [taskId, userId]
      );
      if ((project.rowCount ?? 0) > 0) {
        throw AppError.eventTaskNotSchedulable('项目不支持安排日程');
      }
      throw AppError.notFound('任务不存在');
    }
    const task = res.rows[0];
    if (task.status === 'completed') throw AppError.eventTaskNotSchedulable();
    return task;
  },

  /**
   * 创建日程（v0.2.0 支持 recurrence）。
   * 命中冲突且未带确认标记时**不落库**，返回 need_conflict_confirmation 交给调用方询问用户。
   */
  async create(
    userId: number,
    input: CreateEventInput,
    source: 'manual' | 'chat' = 'manual',
    opts: { confirmConflict?: boolean; tz?: string | null } = {}
  ): Promise<WriteEventResult> {
    const tz = await resolveTz(opts.tz);
    const eventType: EventType = input.event_type === 'task' ? 'task' : 'normal';
    const allDay = input.all_day === true;
    const startAt = parseTime(input.start_at, '开始时间');
    const endAt = parseTime(input.end_at, '结束时间');
    if (endAt.getTime() < startAt.getTime()) {
      throw AppError.eventTimeInvalid('结束时间需晚于开始时间');
    }

    let title: string | null = null;
    let taskId: number | null = null;
    if (eventType === 'task') {
      // 任务日程不支持循环（DB CHECK + Service + zod 三处拦截）
      if (input.recurrence) throw AppError.recurrenceNotSupported();
      if (!input.task_id) throw AppError.paramInvalid('任务日程必须指定关联任务');
      const task = await this.requireSchedulableTask(userId, Number(input.task_id));
      taskId = task.id;
      // 任务日程不存标题副本（由 DB CHECK 兜底）
      title = null;
    } else {
      title = normalizeTitle(input.title);
    }

    const note = normalizeNote(input.note);
    const location = normalizeLocation(input.location);
    const durationMs = eventDurationMs({ start_at: startAt, end_at: endAt });

    // 循环：90 天展开扫描并按日期分组；单次：单实例相交检测
    if (input.recurrence) {
      const rule = buildRule(input.recurrence, startAt, tz);
      const scan = await occurrenceService.scanSeriesConflicts(
        userId,
        rule,
        startAt,
        durationMs,
        allDay,
        tz
      );
      if (scan.conflict_total > 0 && !opts.confirmConflict) {
        logger.info('series_created_blocked_by_conflict', {
          user_id: userId,
          freq: rule.freq,
          dates: scan.conflict_dates_total,
        });
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
      if (scan.conflict_total > 0) {
        logger.info('series_conflict_forced', { user_id: userId, dates: scan.conflict_dates_total });
      }

      const res = await query<{ id: number }>(
        `INSERT INTO events(user_id, event_type, task_id, title, note, location, all_day, start_at, end_at, source, recurrence)
         VALUES ($1, 'normal', NULL, $2, $3, $4, $5, $6, $7, $8, $9::jsonb) RETURNING id`,
        [userId, title, note, location, allDay, startAt, endAt, source, JSON.stringify(rule)]
      );
      logger.info('series_created', {
        user_id: userId,
        freq: rule.freq,
        end_type: rule.end_type,
        source,
      });
      const row = await this.getOwnedRow(userId, res.rows[0].id);
      return {
        saved: true,
        event: toSeriesDTO(row, tz),
        conflicts: [],
        conflict_level: 'none',
        need_conflict_confirmation: false,
        conflict_scope: 'series',
      };
    }

    const { conflicts, conflict_level } = await this.findConflicts(
      userId,
      startAt,
      endAt,
      allDay,
      undefined,
      tz
    );
    if (conflicts.length > 0 && !opts.confirmConflict) {
      // 埋点：冲突提示发生率（对应系统设计文档 10.2 / PRD 6.5）
      logger.info('event_conflict_shown', {
        user_id: userId,
        level: conflict_level,
        count: conflicts.length,
        event_type: eventType,
      });
      return { saved: false, event: null, conflicts, conflict_level, need_conflict_confirmation: true };
    }
    if (conflicts.length > 0 && opts.confirmConflict) {
      // 埋点：用户坚持保存（可据此计算冲突后改约率）
      logger.info('event_conflict_forced', {
        user_id: userId,
        level: conflict_level,
        count: conflicts.length,
        event_type: eventType,
      });
    }

    const res = await query<{ id: number }>(
      `INSERT INTO events(user_id, event_type, task_id, title, note, location, all_day, start_at, end_at, source)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id`,
      [userId, eventType, taskId, title, note, location, allDay, startAt, endAt, source]
    );

    // 埋点：日程创建来源与类型分布；任务日程额外上报排期事件
    logger.info('event_created', { user_id: userId, event_type: eventType, source, all_day: allDay });
    if (eventType === 'task' && taskId) {
      logger.info('task_scheduled', { user_id: userId, task_id: taskId, event_id: res.rows[0].id });
    }

    const dto = await this.get(userId, res.rows[0].id, { tz });
    return { saved: true, event: dto, conflicts, conflict_level, need_conflict_confirmation: false };
  },

  /**
   * 编辑日程：按 scope 分流（series 整条 / this 仅本次 / following 本次及以后）。
   * 禁止修改类型与关联任务；任务日程的 title 入参被忽略（标题随任务）。
   */
  async update(
    userId: number,
    eventId: number,
    patch: UpdateEventInput,
    opts: { confirmConflict?: boolean; scope?: EventScope; occurrenceKey?: string; tz?: string | null } = {}
  ): Promise<WriteEventResult> {
    const tz = await resolveTz(opts.tz);
    const scope: EventScope = opts.scope ?? 'series';
    const existing = await this.getOwnedRow(userId, eventId);

    if (scope === 'this' || scope === 'following') {
      if (!opts.occurrenceKey) {
        throw AppError.paramInvalid('按次操作必须提供 occurrence_key（请从实例列表获取）');
      }
      if (scope === 'this') {
        return occurrenceService.updateThis(userId, existing, opts.occurrenceKey, patch, tz, opts);
      }
      return occurrenceService.updateFromFollowing(userId, existing, opts.occurrenceKey, patch, tz, opts);
    }

    // 类型与关联创建后不可变更；但「原样回传当前值」（前端表单整表提交的常见形态）不算变更，
    // 只有真正试图改成别的类型/换绑任务才拒绝，否则会让正常的编辑保存被误伤。
    const typeChanged =
      (patch.event_type !== undefined && patch.event_type !== existing.event_type) ||
      (patch.task_id !== undefined && patch.task_id !== null && Number(patch.task_id) !== existing.task_id);
    if (typeChanged) {
      throw AppError.eventTypeImmutable();
    }

    const isTask = existing.event_type === 'task';
    if (isTask && patch.recurrence) throw AppError.recurrenceNotSupported();

    const allDay = patch.all_day === undefined ? existing.all_day : patch.all_day === true;
    const startAt = patch.start_at === undefined ? existing.start_at : parseTime(patch.start_at, '开始时间');
    const endAt = patch.end_at === undefined ? existing.end_at : parseTime(patch.end_at, '结束时间');
    if (endAt.getTime() < startAt.getTime()) {
      throw AppError.eventTimeInvalid('结束时间需晚于开始时间');
    }

    const sets: string[] = [];
    const params: unknown[] = [];
    let index = 1;

    if (patch.all_day !== undefined) {
      sets.push(`all_day = $${index++}`);
      params.push(allDay);
    }
    if (patch.start_at !== undefined) {
      sets.push(`start_at = $${index++}`);
      params.push(startAt);
    }
    if (patch.end_at !== undefined) {
      sets.push(`end_at = $${index++}`);
      params.push(endAt);
    }
    if (patch.note !== undefined) {
      sets.push(`note = $${index++}`);
      params.push(normalizeNote(patch.note));
    }
    if (patch.location !== undefined) {
      sets.push(`location = $${index++}`);
      params.push(normalizeLocation(patch.location));
    }
    // 任务日程不接受自拟标题，静默忽略以保持"标题属于任务"的语义
    if (patch.title !== undefined && !isTask) {
      sets.push(`title = $${index++}`);
      params.push(normalizeTitle(patch.title));
    }

    const timeChanged =
      patch.start_at !== undefined ||
      patch.end_at !== undefined ||
      patch.all_day !== undefined;
    const ruleChanged = patch.recurrence !== undefined;

    /**
     * v0.4.0（B-01 修复）：单次日程补挂重复规则。
     *
     * 原实现只处理「已有规则 → 改规则」，普通日程（recurrence 为 NULL）提交规则时
     * 不命中任何写入分支，导致"保存成功但重复无效"。这里补齐该分支：
     * 规则入库后该事件即成为系列主记录，并按新建系列的同一口径做 90 天冲突扫描。
     */
    const becomingSeries =
      !existing.recurrence && ruleChanged && patch.recurrence !== null && patch.recurrence !== undefined;
    let becomingRule: RecurrenceRule | null = null;
    if (becomingSeries) {
      becomingRule = buildRule(patch.recurrence as RecurrenceRule, startAt, tz);
      sets.push(`recurrence = $${index++}::jsonb`);
      params.push(JSON.stringify(becomingRule));
    }

    // 整条系列：规则变更需重新校验并重新扫描 90 天
    if (existing.recurrence && ruleChanged) {
      if (!patch.recurrence) {
        throw AppError.paramInvalid('请使用删除操作移除重复规则');
      }
      const rule = buildRule(patch.recurrence, startAt, tz);
      sets.push(`recurrence = $${index++}::jsonb`);
      params.push(JSON.stringify(rule));
      // 只有「时间或排期形状」变化才重扫 90 天冲突；仅改结束条件不重扫（TC-SERIES-047）
      const shapeChanged = scheduleShapeChanged(existing.recurrence as RecurrenceRule, rule);
      if (!opts.confirmConflict && (shapeChanged || timeChanged)) {
        const scan = await occurrenceService.scanSeriesConflicts(
          userId,
          rule,
          startAt,
          eventDurationMs({ start_at: startAt, end_at: endAt }),
          allDay,
          tz,
          eventId
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
    } else if (existing.recurrence && timeChanged && !opts.confirmConflict) {
      // 整条改时间：全部实例平移，重新做 90 天扫描
      const rule = existing.recurrence as RecurrenceRule;
      const scan = await occurrenceService.scanSeriesConflicts(
        userId,
        rule,
        startAt,
        eventDurationMs({ start_at: startAt, end_at: endAt }),
        allDay,
        tz,
        eventId
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
    } else if (becomingSeries && becomingRule && !opts.confirmConflict) {
      // v0.4.0：单次 → 系列，按新建系列的口径扫描未来 90 天（命中则要求二次确认）
      const rule = becomingRule;
      const scan = await occurrenceService.scanSeriesConflicts(
        userId,
        rule,
        startAt,
        eventDurationMs({ start_at: startAt, end_at: endAt }),
        allDay,
        tz,
        eventId
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
    } else if (!existing.recurrence && timeChanged) {
      const { conflicts, conflict_level } = await this.findConflicts(
        userId,
        startAt,
        endAt,
        allDay,
        eventId,
        tz
      );
      if (conflicts.length > 0 && !opts.confirmConflict) {
        return {
          saved: false,
          event: null,
          conflicts,
          conflict_level,
          need_conflict_confirmation: true,
        };
      }
    }

    if (sets.length > 0) {
      sets.push('updated_at = now()');
      params.push(eventId, userId);
      await query(
        `UPDATE events SET ${sets.join(', ')} WHERE id = $${index++} AND user_id = $${index}`,
        params
      );
    }

    // 整条改时间：override 的身份键是「原始开始时间」，必须随系列整体平移，
    // 否则全部单次例外都会因 key 漂移而失联（TC-SERIES-045）
    if (existing.recurrence && patch.start_at !== undefined) {
      const deltaMs = startAt.getTime() - existing.start_at.getTime();
      if (deltaMs !== 0) {
        await query(
          `UPDATE event_overrides
             SET occurrence_start = occurrence_start + ($3::bigint * interval '1 millisecond'),
                 updated_at = now()
           WHERE user_id = $1 AND event_id = $2`,
          [userId, eventId, deltaMs]
        );
        logger.info('series_overrides_shifted', {
          user_id: userId,
          series_id: eventId,
          delta_ms: deltaMs,
        });
      }
    }

    const dto = await this.get(userId, eventId, { tz });
    return {
      saved: true,
      event: dto,
      conflicts: [],
      conflict_level: 'none',
      need_conflict_confirmation: false,
      conflict_scope: 'series',
    };
  },

  /** 删除日程：scope=series 删整条（含 override 级联）；scope=this 仅取消本次 */
  async remove(
    userId: number,
    eventId: number,
    opts: { scope?: EventScope; occurrenceKey?: string; tz?: string | null } = {}
  ): Promise<{ event: EventDTO; occurrence: OccurrenceDTO | null }> {
    const tz = await resolveTz(opts.tz);
    const row = await this.getOwnedRow(userId, eventId);
    if (opts.scope === 'this') {
      if (!opts.occurrenceKey) {
        throw AppError.paramInvalid('按次操作必须提供 occurrence_key');
      }
      const occurrence = await occurrenceService.cancelThis(userId, row, opts.occurrenceKey, tz);
      return { event: toEventDTO(row, tz), occurrence };
    }
    await query(`DELETE FROM events WHERE id = $1 AND user_id = $2`, [eventId, userId]);
    return { event: toEventDTO(row, tz), occurrence: null };
  },

  /** 恢复某次已取消的实例 */
  async restoreOccurrence(
    userId: number,
    eventId: number,
    occurrenceKey: string,
    tzInput?: string | null
  ): Promise<OccurrenceDTO | null> {
    const tz = await resolveTz(tzInput);
    const row = await this.getOwnedRow(userId, eventId);
    return occurrenceService.restoreOccurrence(userId, row, occurrenceKey, tz);
  },

  /**
   * 批量删除（对话确认后按已确认的 ID 精确执行）。
   * 循环系列主记录不在批量范围内（批量仅承载单次日程，避免误删整条系列）。
   */
  async removeByIds(userId: number, ids: number[]): Promise<EventDTO[]> {
    if (ids.length === 0) return [];
    const before = await this.getManyByIds(userId, ids);
    const res = await query(
      `DELETE FROM events WHERE user_id = $1 AND id = ANY($2::int[]) AND recurrence IS NULL`,
      [userId, ids]
    );
    if (res.rowCount === 0) return [];
    // 系列主记录不参与批量删除，不作为已删除对象回执
    return [...before.values()].filter((e) => !e.recurrence);
  },

  /**
   * 按 ID 集合批量更新（对话确认后按已确认的 ID 精确执行，不再重新扫描筛选条件）。
   * 批量操作只允许时间、全天、地点、备注四类字段，类型与关联不可变更；
   * 循环系列主记录不参与（避免把整条系列静默平移）。
   */
  async batchUpdateByIds(
    userId: number,
    ids: number[],
    patch: Record<string, unknown>
  ): Promise<EventDTO[]> {
    if (ids.length === 0) return [];

    const sets: string[] = [];
    const params: unknown[] = [];
    let index = 1;

    if (patch.all_day !== undefined) {
      sets.push(`all_day = $${index++}`);
      params.push(patch.all_day === true);
    }
    if (patch.start_at !== undefined && patch.start_at !== null) {
      sets.push(`start_at = $${index++}::timestamptz`);
      params.push(parseTime(String(patch.start_at), '开始时间').toISOString());
    }
    if (patch.end_at !== undefined && patch.end_at !== null) {
      sets.push(`end_at = $${index++}::timestamptz`);
      params.push(parseTime(String(patch.end_at), '结束时间').toISOString());
    }
    if (patch.location !== undefined) {
      sets.push(`location = $${index++}`);
      params.push(normalizeLocation(patch.location as string | null));
    }
    if (patch.note !== undefined) {
      sets.push(`note = $${index++}`);
      params.push(normalizeNote(patch.note as string | null));
    }

    if (sets.length === 0) throw AppError.paramInvalid('没有需要更新的字段');

    sets.push('updated_at = now()');
    params.push(userId, ids);
    const res = await query<{ id: number }>(
      `UPDATE events SET ${sets.join(', ')}
       WHERE user_id = $${index++} AND id = ANY($${index}::int[]) AND recurrence IS NULL
       RETURNING id`,
      params
    );
    const updatedIds = res.rows.map((r) => r.id);
    if (updatedIds.length === 0) return [];

    const refreshed = await this.getManyByIds(userId, updatedIds);
    return updatedIds.map((id) => refreshed.get(id)).filter((e): e is EventDTO => !!e);
  },

  async buildCondition(
    userId: number,
    filter: EventFilter
  ): Promise<{ clause: string; params: unknown[] }> {
    const tz = await resolveTz(filter.tz);
    // 循环实例是虚拟展开的：SQL 层只负责单次日程，系列走 OccurrenceService 展开
    const clauses: string[] = ['e.user_id = $1', 'e.recurrence IS NULL'];
    const params: unknown[] = [userId];
    let index = 2;

    const date = normalizeDateOnly(filter.date, 'date');
    const from = normalizeDateOnly(filter.date_from, 'date_from');
    const to = normalizeDateOnly(filter.date_to, 'date_to');

    // 日期边界按用户时区换算为绝对时间，再按「时间段相交」筛选，
    // 使跨日日程在两端日期视图都能出现（左闭右开：[dayStart, dayEnd)）。
    if (date) {
      const di = index++;
      const ti = index++;
      params.push(date, tz);
      clauses.push(`e.start_at < (($${di}::date + 1)::timestamp AT TIME ZONE $${ti})`);
      clauses.push(`e.end_at > ($${di}::date::timestamp AT TIME ZONE $${ti})`);
    } else if (from || to) {
      if (from) {
        const fi = index++;
        const ftz = index++;
        params.push(from, tz);
        clauses.push(`e.end_at > ($${fi}::date::timestamp AT TIME ZONE $${ftz})`);
      }
      if (to) {
        const ti2 = index++;
        const ttz = index++;
        params.push(to, ttz);
        clauses.push(`e.start_at < ($${ti2}::date::timestamp AT TIME ZONE $${ttz})`);
      }
    }

    if (filter.task_id) {
      clauses.push(`e.task_id = $${index++}`);
      params.push(filter.task_id);
    }
    if (filter.event_type) {
      clauses.push(`e.event_type = $${index++}`);
      params.push(filter.event_type);
    }
    if (filter.keyword && filter.keyword.trim()) {
      const escaped = filter.keyword.trim().replace(/[%_\\]/g, (m) => `\\${m}`);
      // 任务日程同时匹配关联任务标题（TC-EVENT-065）
      clauses.push(
        `(e.title ILIKE $${index} OR e.note ILIKE $${index} OR e.location ILIKE $${index} OR t.title ILIKE $${index})`
      );
      params.push(`%${escaped}%`);
      index += 1;
    }

    return { clause: clauses.join(' AND '), params };
  },

  /**
   * 按日/日期范围/任务/类型查询（左闭右开）。
   * 合并两个来源：窗口内单次行 + 循环系列展开物化结果。
   */
  async list(userId: number, filter: EventFilter): Promise<EventDTO[]> {
    if (
      !filter.date &&
      !filter.date_from &&
      !filter.date_to &&
      !filter.series_id &&
      !filter.recurring_only &&
      !filter.task_id
    ) {
      throw AppError.paramInvalid('请指定日期或日期范围');
    }
    const tz = await resolveTz(filter.tz);
    const window = resolveWindow(filter, tz);
    const limit = Math.min(filter.limit ?? 100, config.event.listMaxLimit);
    const order = normalizeEventSort(filter.sort) === 'start_desc' ? -1 : 1;

    const { clause, params } = await this.buildCondition(userId, { ...filter, tz });
    const res = await query<EventRow>(
      `${EVENT_SELECT} WHERE ${clause} ORDER BY e.start_at ${
        order === -1 ? 'DESC' : 'ASC'
      }, e.id ASC LIMIT $${params.length + 1}`,
      [...params, limit]
    );
    const singles = filter.series_id ? [] : res.rows.map((row) => toEventDTO(row, tz));

    let merged: EventDTO[] = singles;
    if (window && !filter.recurring_only) {
      const instances = applyInstanceFilters(
        await occurrenceService.listSeriesInstances(userId, window.start, window.end, tz, {
          includeCancelled: filter.include_cancelled,
        }),
        filter
      );
      merged = [...singles, ...instances];
    } else if (window) {
      merged = applyInstanceFilters(
        await occurrenceService.listSeriesInstances(userId, window.start, window.end, tz, {
          includeCancelled: filter.include_cancelled,
        }),
        filter
      );
    }

    merged.sort((a, b) => {
      const diff = new Date(a.start_at).getTime() - new Date(b.start_at).getTime();
      if (diff !== 0) return diff * order;
      return a.id === b.id ? 0 : 1;
    });

    const limited = merged.slice(0, limit);
    attachConflicts(limited);
    return limited;
  },

  /** 全量取（批量操作预览用，只含单次日程与任务日程，与批量执行口径一致） */
  async listAll(userId: number, filter: EventFilter, limit = config.event.listMaxLimit): Promise<EventDTO[]> {
    const tz = await resolveTz(filter.tz);
    const { clause, params } = await this.buildCondition(userId, { ...filter, tz });
    const res = await query<EventRow>(
      `${EVENT_SELECT} WHERE ${clause} ORDER BY e.start_at ASC, e.id ASC LIMIT $${params.length + 1}`,
      [...params, Math.min(limit, config.event.listMaxLimit)]
    );
    return res.rows.map((row) => toEventDTO(row, tz));
  },

  /**
   * 关键词搜索：循环系列命中返回**系列主记录 DTO**（每个系列一条，不按实例重复）。
   */
  async search(userId: number, keyword: string, limit = 50): Promise<EventDTO[]> {
    if (!keyword || !keyword.trim()) throw AppError.paramInvalid('请输入搜索关键词');
    const tz = config.event.defaultTz;
    const escaped = keyword.trim().replace(/[%_\\]/g, (m) => `\\${m}`);
    const res = await query<EventRow>(
      `${EVENT_SELECT}
       WHERE e.user_id = $1
         AND (e.title ILIKE $2 OR e.note ILIKE $2 OR e.location ILIKE $2 OR t.title ILIKE $2)
       ORDER BY e.start_at DESC, e.id DESC
       LIMIT $3`,
      [userId, `%${escaped}%`, Math.min(limit, config.event.listMaxLimit)]
    );
    return res.rows.map((row) =>
      row.recurrence ? toSeriesDTO(row, tz) : toEventDTO(row, tz)
    );
  },

  /** 系列详情：规则、摘要、下一次、总次数 + 未来/历史实例分页 */
  async getSeriesDetail(
    userId: number,
    seriesId: number,
    opts: { section?: 'upcoming' | 'past'; cursor?: string; tz?: string | null } = {}
  ): Promise<SeriesDTO & { occurrences: { upcoming: OccurrenceDTO[]; past: OccurrenceDTO[] }; next_cursor: string | null }> {
    const tz = await resolveTz(opts.tz);
    const detail = await occurrenceService.getSeriesDetail(userId, seriesId, tz);
    const row = await occurrenceService.getSeriesRow(userId, seriesId);
    const section = opts.section ?? 'upcoming';
    const page = await occurrenceService.listOccurrences(userId, row, section, opts.cursor, tz);
    return {
      ...detail,
      occurrences: {
        upcoming: section === 'upcoming' ? page.list : [],
        past: section === 'past' ? page.list : [],
      },
      next_cursor: page.next_cursor,
    };
  },

  /** 某任务的全部任务日程（任务详情排期分区） */
  async listByTask(userId: number, taskId: number): Promise<EventDTO[]> {
    const res = await query<EventRow>(
      `${EVENT_SELECT} WHERE e.user_id = $1 AND e.task_id = $2 ORDER BY e.start_at ASC, e.id ASC`,
      [userId, taskId]
    );
    return res.rows.map((row) => toEventDTO(row));
  },

  /** 某任务关联的日程条数（删除任务前的级联告知） */
  async countByTask(userId: number, taskId: number): Promise<number> {
    const res = await query<{ total: string }>(
      `SELECT COUNT(*)::int AS total FROM events WHERE user_id = $1 AND task_id = $2`,
      [userId, taskId]
    );
    return Number(res.rows[0]?.total ?? 0);
  },

  /** 某任务集合关联的日程条数（子任务子树删除前的级联告知） */
  async countByTaskIds(userId: number, taskIds: number[]): Promise<number> {
    if (taskIds.length === 0) return 0;
    const res = await query<{ total: string }>(
      `SELECT COUNT(*)::int AS total FROM events WHERE user_id = $1 AND task_id = ANY($2::int[])`,
      [userId, taskIds]
    );
    return Number(res.rows[0]?.total ?? 0);
  },

  /**
   * 删除任务及其全部任务日程（单事务，返回级联删除条数）。
   * DB 层 ON DELETE CASCADE 仅作兜底，正常路径以本事务为准（计数可返回、可审计）。
   */
  async removeTaskWithEvents(userId: number, taskId: number): Promise<{ deleted_event_count: number }> {
    const result = await this.removeTaskIdsWithEvents(userId, [taskId]);
    return { deleted_event_count: result.deleted_event_count };
  },

  /** 按任务 id 集合批量清理任务日程（子任务子树删除用，需在调用方事务内复用） */
  async removeTaskIdsWithEvents(
    userId: number,
    taskIds: number[]
  ): Promise<{ deleted_event_count: number }> {
    if (taskIds.length === 0) return { deleted_event_count: 0 };
    const res = await query(
      `DELETE FROM events WHERE user_id = $1 AND task_id = ANY($2::int[])`,
      [userId, taskIds]
    );
    return { deleted_event_count: res.rowCount ?? 0 };
  },

  /** 月视图聚合：按日返回「计数 + 农历 + 法定状态」，不拉明细（含循环实例归属日期） */
  async monthly(userId: number, year: number, month: number, tzInput?: string): Promise<MonthDayCount[]> {
    if (!Number.isInteger(year) || year < 1970 || year > 9999) {
      throw AppError.paramInvalid('年份不合法');
    }
    if (!Number.isInteger(month) || month < 1 || month > 12) {
      throw AppError.paramInvalid('月份不合法');
    }
    const tz = await resolveTz(tzInput);
    // v0.4.0：法定工作日整表需已载入（幂等，首次调用载入）
    await ensureWorkCalendarLoaded();
    const monthStart = `${year}-${String(month).padStart(2, '0')}-01`;
    const next = month === 12 ? { y: year + 1, m: 1 } : { y: year, m: month + 1 };
    const monthEnd = `${next.y}-${String(next.m).padStart(2, '0')}-01`;

    const res = await query<{ day: string; event_type: string; cnt: string }>(
      `SELECT to_char((e.start_at AT TIME ZONE $1)::date, 'YYYY-MM-DD') AS day,
              e.event_type,
              COUNT(*)::int AS cnt
       FROM events e
       WHERE e.user_id = $2
         AND e.recurrence IS NULL
         AND e.start_at >= ($3::date::timestamp AT TIME ZONE $1)
         AND e.start_at <  ($4::date::timestamp AT TIME ZONE $1)
       GROUP BY 1, 2
       ORDER BY 1`,
      [tz, userId, monthStart, monthEnd]
    );

    const daysInMonth = new Date(Date.UTC(next.y, next.m - 1, 0)).getUTCDate();
    const map = new Map<string, MonthDayCount>();
    // v0.4.0：先按该月自然日铺满（dense），保证「无日程的日期也带农历与角标」——
    // 农历/法定信息是不可变的历法数据，与用户是否有日程无关。
    for (let d = 1; d <= daysInMonth; d += 1) {
      const date = `${monthStart.slice(0, 8)}${String(d).padStart(2, '0')}`;
      map.set(date, {
        date,
        normal: 0,
        task: 0,
        recurring: 0,
        lunar: solarToLunar(date),
        calendar_day: getCalendarDay(date),
      });
    }

    for (const row of res.rows) {
      const item = map.get(row.day);
      if (!item) continue;
      if (row.event_type === 'task') item.task += Number(row.cnt);
      else item.normal += Number(row.cnt);
    }

    // 循环实例：按 patch 后的日期计入；已取消的不计
    const windowStart = fromZonedNaive(naiveOfDate(monthStart), tz);
    const windowEnd = fromZonedNaive(naiveOfDate(monthEnd), tz);
    const instances = await occurrenceService.listSeriesInstances(userId, windowStart, windowEnd, tz);
    for (const inst of instances) {
      const day = localDateString(new Date(inst.start_at), tz);
      const item = map.get(day);
      if (!item) continue;
      item.normal += 1;
      item.recurring += 1;
    }

    return [...map.values()].sort((a, b) => (a.date < b.date ? -1 : 1));
  },

  /**
   * v0.4.0：农历 → 公历换算（PRD 5.3/5.6）。
   *
   * n=1：单次日程表单用，返回单个换算结果（含 weekday/festival/clamped）；
   * n>1：年度循环表单预览用，从 lunar_year 起逐年换算并跳过早于 anchor 的候选，
   *      返回最多 n 个未来候选（公历日期 + 周几 + 节日名）。
   */
  async resolveLunar(params: {
    lunarYear: number;
    month: number;
    day: number;
    n?: number;
    anchor?: string;
  }): Promise<{
    results: Array<{
      lunar_year: number;
      gregorian_date: string;
      weekday: number;
      clamped: boolean;
      month_label: string;
      day_label: string;
      festival: string | null;
      term: string | null;
    }>;
  }> {
    const n = Math.min(Math.max(params.n ?? 1, 1), 5);
    const results: Array<{
      lunar_year: number;
      gregorian_date: string;
      weekday: number;
      clamped: boolean;
      month_label: string;
      day_label: string;
      festival: string | null;
      term: string | null;
    }> = [];

    // 从起始农历年起逐年候选；anchor 之后的最多 n 个（anchor 缺省时不过滤）
    for (let k = 0; k < 12 && results.length < n; k += 1) {
      const lunarYear = params.lunarYear + k;
      if (lunarYear > 2100) break;
      let resolved;
      try {
        resolved = lunarToSolar(lunarYear, params.month, params.day);
      } catch {
        // 候选年超出农历表支持范围时跳过（不阻断其余候选）
        continue;
      }
      if (params.anchor && resolved.gregorian_date < params.anchor) continue;
      results.push({ lunar_year: lunarYear, ...resolved });
    }

    if (results.length === 0) {
      throw AppError.paramInvalid('该农历日期超出支持范围（1900~2100 年）');
    }
    return { results };
  },
};

export { findSingleConflicts };
export type { EventDTO, EventRow };