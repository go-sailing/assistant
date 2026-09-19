/**
 * 日程领域的公共 SQL 片段与冲突判定（系统设计文档 4.6 / 7.1）。
 *
 * 独立成文件是为了让 EventService 与 OccurrenceService 共用同一份查询与冲突语义，
 * 同时避免二者相互 import 形成循环依赖。
 */
import { query } from '../../db/pool';
import { config } from '../../config';
import { logger } from '../../common/logger';
import type { ConflictLevel, EventRow } from './types';

/**
 * 日程查询公共 SELECT：
 * 任务日程的标题/优先级/完成态实时取自 tasks，events 不存冗余副本。
 * v0.7.0：清单维度已下线，不再 JOIN task_lists。
 */
export const EVENT_SELECT = `
  SELECT e.*,
         t.title        AS task_title,
         t.status       AS task_status,
         t.priority     AS task_priority,
         t.due_at       AS task_due_at,
         t.completed_at AS task_completed_at
  FROM events e
  LEFT JOIN tasks t ON t.id = e.task_id
`;

/** 时间段左闭右开相交判定 */
export function intersect(a: { start_at: Date; end_at: Date }, b: { start_at: Date; end_at: Date }): boolean {
  return a.start_at.getTime() < b.end_at.getTime() && a.end_at.getTime() > b.start_at.getTime();
}

/**
 * 单次日程（recurrence IS NULL）与目标时段相交的冲突查询。
 * 循环实例是虚拟展开的，不参与此查询（由 OccurrenceService 展开比对）。
 *
 * v0.5.0（EVT-01）：全天日程退出冲突判定——目标为全天直接短路；
 * 目标为定时时时，冲突列表中不再包含全天日程（SQL 谓词 e.all_day = false）。
 */
export async function findSingleConflicts(
  userId: number,
  startAt: Date,
  endAt: Date,
  targetAllDay: boolean,
  excludeId?: number
): Promise<{ conflicts: EventRow[]; conflict_level: ConflictLevel }> {
  // 目标为全天：不与任何日程做时间冲突提醒
  if (targetAllDay) {
    // v0.5.0 埋点（SDD 9.2）：全天短路计数，一次扫描一行，不带标题
    logger.info('conflict_allday_suppressed', {
      user_id: userId,
      scene: 'target_all_day',
      count: 1,
    });
    return { conflicts: [], conflict_level: 'none' };
  }

  const res = await query<EventRow>(
    `${EVENT_SELECT}
     WHERE e.user_id = $1
       AND e.recurrence IS NULL
       AND e.all_day = false
       AND e.start_at < $2::timestamptz
       AND e.end_at   > $3::timestamptz
       AND ($4::int IS NULL OR e.id <> $4::int)
     ORDER BY e.start_at ASC
     LIMIT $5`,
    [userId, endAt, startAt, excludeId ?? null, config.event.conflictScanLimit]
  );
  if (res.rowCount === 0) return { conflicts: [], conflict_level: 'none' };
  // 只可能是定时 × 定时：all_day 等级不再产出（枚举保留以兼容旧客户端）
  return { conflicts: res.rows, conflict_level: 'overlap' };
}

/**
 * 冲突等级合并。
 * v0.5.0：全天已退出判定，'all_day' 不再被产出；枚举保留仅为类型兼容。
 */
export function mergeLevel(a: ConflictLevel, b: ConflictLevel): ConflictLevel {
  if (a === 'none') return b;
  if (b === 'none') return a;
  return 'overlap';
}
