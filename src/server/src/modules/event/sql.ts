/**
 * 日程领域的公共 SQL 片段与冲突判定（系统设计文档 4.6 / 7.1）。
 *
 * 独立成文件是为了让 EventService 与 OccurrenceService 共用同一份查询与冲突语义，
 * 同时避免二者相互 import 形成循环依赖。
 */
import { query } from '../../db/pool';
import { config } from '../../config';
import type { ConflictLevel, EventRow } from './types';

/**
 * 日程查询公共 SELECT：
 * 任务日程的标题/优先级/完成态/清单均实时取自 tasks 与 task_lists，events 不存冗余副本。
 */
export const EVENT_SELECT = `
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

/** 时间段左闭右开相交判定 */
export function intersect(a: { start_at: Date; end_at: Date }, b: { start_at: Date; end_at: Date }): boolean {
  return a.start_at.getTime() < b.end_at.getTime() && a.end_at.getTime() > b.start_at.getTime();
}

/**
 * 单次日程（recurrence IS NULL）与目标时段相交的冲突查询。
 * 循环实例是虚拟展开的，不参与此查询（由 OccurrenceService 展开比对）。
 */
export async function findSingleConflicts(
  userId: number,
  startAt: Date,
  endAt: Date,
  targetAllDay: boolean,
  excludeId?: number
): Promise<{ conflicts: EventRow[]; conflict_level: ConflictLevel }> {
  const res = await query<EventRow>(
    `${EVENT_SELECT}
     WHERE e.user_id = $1
       AND e.recurrence IS NULL
       AND e.start_at < $2::timestamptz
       AND e.end_at   > $3::timestamptz
       AND ($4::int IS NULL OR e.id <> $4::int)
     ORDER BY e.start_at ASC
     LIMIT $5`,
    [userId, endAt, startAt, excludeId ?? null, config.event.conflictScanLimit]
  );
  if (res.rowCount === 0) return { conflicts: [], conflict_level: 'none' };
  const hasAllDay = targetAllDay || res.rows.some((r) => r.all_day);
  return { conflicts: res.rows, conflict_level: hasAllDay ? 'all_day' : 'overlap' };
}

/** 冲突等级：任一全天即为 all_day（弱化提示） */
export function mergeLevel(a: ConflictLevel, b: ConflictLevel): ConflictLevel {
  if (a === 'all_day' || b === 'all_day') return 'all_day';
  if (a === 'overlap' || b === 'overlap') return 'overlap';
  return 'none';
}
