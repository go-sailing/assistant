import { query, withTransaction } from '../../db/pool';
import { AppError } from '../../common/errors';
import { config } from '../../config';
import { logger } from '../../common/logger';
import { EVENT_LIMITS } from './types';
import {
  normalizeEventSort,
  toConflictBrief,
  toEventDTO,
  type ConflictLevel,
  type CreateEventInput,
  type EventConflictBrief,
  type EventDTO,
  type EventFilter,
  type EventRow,
  type EventType,
  type MonthDayCount,
  type UpdateEventInput,
  type WriteEventResult,
} from './types';

/**
 * 日程查询公共 SELECT：
 * 任务日程的标题/优先级/完成态/清单均实时取自 tasks 与 task_lists，events 不存冗余副本。
 */
const EVENT_SELECT = `
  SELECT e.*,
         t.title        AS task_title,
         t.status       AS task_status,
         t.priority     AS task_priority,
         t.due_at       AS task_due_at,
         t.completed_at AS task_completed_at,
         t.list_id      AS task_list_id,
         l.name         AS task_list_name
  FROM events e
  LEFT JOIN tasks t       ON t.id = e.task_id
  LEFT JOIN task_lists l  ON l.id = t.list_id
`;

/** 任务排期前置校验所需的最小任务信息 */
interface ScheduleTaskRow {
  id: number;
  title: string;
  status: string;
  list_id: number;
  list_name: string;
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
function intersect(a: { start_at: Date; end_at: Date }, b: { start_at: Date; end_at: Date }): boolean {
  return a.start_at.getTime() < b.end_at.getTime() && a.end_at.getTime() > b.start_at.getTime();
}

/**
 * 列表场景的冲突标注：直接在已取回的结果集内两两比对，避免 N+1 查询。
 * 单日查询时结果集恰好覆盖该日全部日程，判定完整；
 * 跨范围查询可能漏掉范围外与本范围日程重叠的对象，此时以详情页/写操作为准。
 */
function attachConflicts(dtos: EventDTO[], rows: EventRow[]): void {
  for (let i = 0; i < dtos.length; i += 1) {
    const self = rows[i];
    const hits: EventConflictBrief[] = [];
    for (let j = 0; j < rows.length; j += 1) {
      if (i === j) continue;
      if (intersect(self, rows[j])) hits.push(toConflictBrief(rows[j]));
    }
    dtos[i].conflicts = hits;
    dtos[i].conflict_level =
      hits.length === 0 ? 'none' : self.all_day || hits.some((h) => h.all_day) ? 'all_day' : 'overlap';
  }
}

/**
 * 日程领域服务：REST 控制器与 LLM 工具执行器共用此服务，
 * 保证「能力对等」与业务规则只实现一次（系统设计文档 2.1 / 4.1）。
 */
export const eventService = {
  defaultTz(): string {
    return config.event.defaultTz;
  },

  async getOwnedRow(userId: number, eventId: number): Promise<EventRow> {
    const res = await query<EventRow>(`${EVENT_SELECT} WHERE e.id = $1 AND e.user_id = $2`, [
      eventId,
      userId,
    ]);
    if (res.rowCount === 0) throw AppError.notFound('日程不存在');
    return res.rows[0];
  },

  async get(userId: number, eventId: number): Promise<EventDTO> {
    const row = await this.getOwnedRow(userId, eventId);
    const dto = toEventDTO(row);
    const { conflicts, conflict_level } = await this.findConflicts(
      userId,
      row.start_at,
      row.end_at,
      row.all_day,
      row.id
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
    return new Map(res.rows.map((row) => [row.id, toEventDTO(row)]));
  },

  /**
   * 冲突检测：同一用户的两条日程时间段左闭右开相交即为冲突
   * （端点相接 A.end = B.start 严格不等号天然不判冲突）。
   */
  async findConflicts(
    userId: number,
    startAt: Date,
    endAt: Date,
    targetAllDay: boolean,
    excludeId?: number
  ): Promise<{ conflicts: EventConflictBrief[]; conflict_level: ConflictLevel }> {
    const res = await query<EventRow>(
      `${EVENT_SELECT}
       WHERE e.user_id = $1
         AND e.start_at < $2::timestamptz
         AND e.end_at   > $3::timestamptz
         AND ($4::int IS NULL OR e.id <> $4::int)
       ORDER BY e.start_at ASC
       LIMIT $5`,
      [userId, endAt, startAt, excludeId ?? null, config.event.conflictScanLimit]
    );
    if (res.rowCount === 0) return { conflicts: [], conflict_level: 'none' };
    const conflicts = res.rows.map(toConflictBrief);
    const hasAllDay = targetAllDay || res.rows.some((r) => r.all_day);
    return { conflicts, conflict_level: hasAllDay ? 'all_day' : 'overlap' };
  },

  /** 任务排期前置校验：任务必须存在、属于当前用户且未完成 */
  async requireSchedulableTask(userId: number, taskId: number): Promise<ScheduleTaskRow> {
    const res = await query<ScheduleTaskRow>(
      `SELECT t.id, t.title, t.status, t.list_id, l.name AS list_name
       FROM tasks t JOIN task_lists l ON l.id = t.list_id
       WHERE t.id = $1 AND t.user_id = $2`,
      [taskId, userId]
    );
    if (res.rowCount === 0) throw AppError.notFound('任务不存在');
    const task = res.rows[0];
    if (task.status === 'completed') throw AppError.eventTaskNotSchedulable();
    return task;
  },

  /**
   * 创建日程。
   * 命中冲突且未带确认标记时**不落库**，返回 need_conflict_confirmation 交给调用方询问用户。
   */
  async create(
    userId: number,
    input: CreateEventInput,
    source: 'manual' | 'chat' = 'manual',
    opts: { confirmConflict?: boolean } = {}
  ): Promise<WriteEventResult> {
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

    const { conflicts, conflict_level } = await this.findConflicts(userId, startAt, endAt, allDay);
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

    const dto = await this.get(userId, res.rows[0].id);
    return { saved: true, event: dto, conflicts, conflict_level, need_conflict_confirmation: false };
  },

  /**
   * 编辑日程：禁止修改类型与关联任务；任务日程的 title 入参被忽略（标题随任务）。
   * 命中冲突且未确认时不落库。
   */
  async update(
    userId: number,
    eventId: number,
    patch: UpdateEventInput,
    opts: { confirmConflict?: boolean } = {}
  ): Promise<WriteEventResult> {
    const existing = await this.getOwnedRow(userId, eventId);

    // 类型与关联创建后不可变更；但「原样回传当前值」（前端表单整表提交的常见形态）不算变更，
    // 只有真正试图改成别的类型/换绑任务才拒绝，否则会让正常的编辑保存被误伤。
    const typeChanged =
      (patch.event_type !== undefined && patch.event_type !== existing.event_type) ||
      (patch.task_id !== undefined && patch.task_id !== null && Number(patch.task_id) !== existing.task_id);
    if (typeChanged) {
      throw AppError.eventTypeImmutable();
    }

    const isTask = existing.event_type === 'task';
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

    if (timeChanged) {
      const { conflicts, conflict_level } = await this.findConflicts(
        userId,
        startAt,
        endAt,
        allDay,
        eventId
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

    const dto = await this.get(userId, eventId);
    return {
      saved: true,
      event: dto,
      conflicts: [],
      conflict_level: 'none',
      need_conflict_confirmation: false,
    };
  },

  /** 删除单条日程：任务日程只删除安排，不影响关联任务 */
  async remove(userId: number, eventId: number): Promise<EventDTO> {
    const row = await this.getOwnedRow(userId, eventId);
    await query(`DELETE FROM events WHERE id = $1 AND user_id = $2`, [eventId, userId]);
    return toEventDTO(row);
  },

  /** 按 ID 集合批量删除（对话确认后按已确认的 ID 精确执行） */
  async removeByIds(userId: number, ids: number[]): Promise<EventDTO[]> {
    if (ids.length === 0) return [];
    const before = await this.getManyByIds(userId, ids);
    const res = await query(`DELETE FROM events WHERE user_id = $1 AND id = ANY($2::int[])`, [
      userId,
      ids,
    ]);
    if (res.rowCount === 0) return [];
    return [...before.values()];
  },

  /**
   * 按 ID 集合批量更新（对话确认后按已确认的 ID 精确执行，不再重新扫描筛选条件）。
   * 批量操作只允许时间、全天、地点、备注四类字段，类型与关联不可变更。
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
       WHERE user_id = $${index++} AND id = ANY($${index}::int[])
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
    const clauses: string[] = ['e.user_id = $1'];
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
        params.push(to, tz);
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

  /** 按日/日期范围/任务/类型查询（左闭右开） */
  async list(userId: number, filter: EventFilter): Promise<EventDTO[]> {
    if (!filter.date && !filter.date_from && !filter.date_to) {
      throw AppError.paramInvalid('请指定日期或日期范围');
    }
    const { clause, params } = await this.buildCondition(userId, filter);
    const limit = Math.min(filter.limit ?? 100, config.event.listMaxLimit);
    const order = normalizeEventSort(filter.sort) === 'start_desc' ? 'DESC' : 'ASC';
    const res = await query<EventRow>(
      `${EVENT_SELECT} WHERE ${clause} ORDER BY e.start_at ${order}, e.id ASC LIMIT $${
        params.length + 1
      }`,
      [...params, limit]
    );
    const dtos = res.rows.map(toEventDTO);
    attachConflicts(dtos, res.rows);
    return dtos;
  },

  /** 全量取（批量操作预览用） */
  async listAll(userId: number, filter: EventFilter, limit = config.event.listMaxLimit): Promise<EventDTO[]> {
    const { clause, params } = await this.buildCondition(userId, filter);
    const res = await query<EventRow>(
      `${EVENT_SELECT} WHERE ${clause} ORDER BY e.start_at ASC, e.id ASC LIMIT $${params.length + 1}`,
      [...params, Math.min(limit, config.event.listMaxLimit)]
    );
    return res.rows.map(toEventDTO);
  },

  async search(userId: number, keyword: string, limit = 50): Promise<EventDTO[]> {
    if (!keyword || !keyword.trim()) throw AppError.paramInvalid('请输入搜索关键词');
    const escaped = keyword.trim().replace(/[%_\\]/g, (m) => `\\${m}`);
    const res = await query<EventRow>(
      `${EVENT_SELECT}
       WHERE e.user_id = $1
         AND (e.title ILIKE $2 OR e.note ILIKE $2 OR e.location ILIKE $2 OR t.title ILIKE $2)
       ORDER BY e.start_at DESC, e.id DESC
       LIMIT $3`,
      [userId, `%${escaped}%`, Math.min(limit, config.event.listMaxLimit)]
    );
    return res.rows.map(toEventDTO);
  },

  /** 某任务的全部任务日程（任务详情排期分区） */
  async listByTask(userId: number, taskId: number): Promise<EventDTO[]> {
    const res = await query<EventRow>(
      `${EVENT_SELECT} WHERE e.user_id = $1 AND e.task_id = $2 ORDER BY e.start_at ASC, e.id ASC`,
      [userId, taskId]
    );
    return res.rows.map(toEventDTO);
  },

  /** 某任务关联的日程条数（删除任务前的级联告知） */
  async countByTask(userId: number, taskId: number): Promise<number> {
    const res = await query<{ total: string }>(
      `SELECT COUNT(*)::int AS total FROM events WHERE user_id = $1 AND task_id = $2`,
      [userId, taskId]
    );
    return Number(res.rows[0]?.total ?? 0);
  },

  /**
   * 删除任务及其全部任务日程（单事务，返回级联删除条数）。
   * DB 层 ON DELETE CASCADE 仅作兜底，正常路径以本事务为准（计数可返回、可审计）。
   */
  async removeTaskWithEvents(userId: number, taskId: number): Promise<{ deleted_event_count: number }> {
    return withTransaction(async (client) => {
      const owned = await client.query(`SELECT id FROM tasks WHERE id = $1 AND user_id = $2`, [
        taskId,
        userId,
      ]);
      if (owned.rowCount === 0) throw AppError.notFound('任务不存在');
      const deleted = await client.query(
        `DELETE FROM events WHERE user_id = $1 AND task_id = $2`,
        [userId, taskId]
      );
      await client.query(`DELETE FROM tasks WHERE id = $1 AND user_id = $2`, [taskId, userId]);
      return { deleted_event_count: deleted.rowCount ?? 0 };
    });
  },

  /** 月视图聚合：只返回「日期 → 计数」，不拉明细 */
  async monthly(userId: number, year: number, month: number, tzInput?: string): Promise<MonthDayCount[]> {
    if (!Number.isInteger(year) || year < 1970 || year > 9999) {
      throw AppError.paramInvalid('年份不合法');
    }
    if (!Number.isInteger(month) || month < 1 || month > 12) {
      throw AppError.paramInvalid('月份不合法');
    }
    const tz = await resolveTz(tzInput);
    const monthStart = `${year}-${String(month).padStart(2, '0')}-01`;
    const next = month === 12 ? { y: year + 1, m: 1 } : { y: year, m: month + 1 };
    const monthEnd = `${next.y}-${String(next.m).padStart(2, '0')}-01`;

    const res = await query<{ day: string; event_type: string; cnt: string }>(
      `SELECT to_char((e.start_at AT TIME ZONE $1)::date, 'YYYY-MM-DD') AS day,
              e.event_type,
              COUNT(*)::int AS cnt
       FROM events e
       WHERE e.user_id = $2
         AND e.start_at >= ($3::date::timestamp AT TIME ZONE $1)
         AND e.start_at <  ($4::date::timestamp AT TIME ZONE $1)
       GROUP BY 1, 2
       ORDER BY 1`,
      [tz, userId, monthStart, monthEnd]
    );

    const map = new Map<string, MonthDayCount>();
    for (const row of res.rows) {
      const item = map.get(row.day) ?? { date: row.day, normal: 0, task: 0 };
      if (row.event_type === 'task') item.task += Number(row.cnt);
      else item.normal += Number(row.cnt);
      map.set(row.day, item);
    }
    return [...map.values()];
  },
};

export type { EventDTO, EventRow };