import type { PoolClient } from 'pg';
import { query, withTransaction } from '../../db/pool';
import { AppError } from '../../common/errors';
import { config } from '../../config';
import { logger } from '../../common/logger';
import { TASK_SELECT, orderByTask } from '../task/sql';
import { toTaskDTO, type TaskDTO, type TaskRow } from '../task/types';
import {
  toProjectDTO,
  type CreateProjectInput,
  type ProjectBrief,
  type ProjectDTO,
  type ProjectFilter,
  type ProjectMemberFilter,
  type ProjectRemoveResult,
  type ProjectRow,
  type UpdateProjectInput,
} from './types';

const NAME_MAX = 200;
const NOTE_MAX = 2000;
const LIST_DEFAULT = 50;
const LIST_MAX = 100;

/**
 * 项目查询公共 SELECT：成员计数用一条聚合 JOIN 带出（无 N+1）。
 * 用 LATERAL 而非全局 GROUP BY 子查询，是为了让计数命中
 * idx_tasks_user_project_id，避免每次列表都全表聚合其他用户的成员。
 */
const PROJECT_SELECT = `
  SELECT p.*,
         COALESCE(m.total, 0)::int AS member_total,
         COALESCE(m.done, 0)::int  AS member_completed
  FROM projects p
  LEFT JOIN LATERAL (
    SELECT count(*)::int AS total,
           count(*) FILTER (WHERE t.status = 'completed')::int AS done
    FROM tasks t
    WHERE t.user_id = p.user_id AND t.project_id = p.id
  ) m ON TRUE
`;

/** 状态派生 UPDATE（唯一写入口）：单条原子 SQL，见系统设计文档 4.3 */
const RECALC_STATUS_SQL = `
  UPDATE projects p
     SET status = CASE WHEN m.total > 0 AND m.todo = 0 THEN 'completed' ELSE 'todo' END,
         completed_at = CASE
           WHEN m.total > 0 AND m.todo = 0 THEN COALESCE(p.completed_at, now())
           ELSE NULL
         END,
         updated_at = now()
    FROM (
      SELECT count(*) AS total,
             count(*) FILTER (WHERE status = 'todo') AS todo
        FROM tasks
       WHERE user_id = $1 AND project_id = $2
    ) m
   WHERE p.id = $2
     AND p.user_id = $1
     AND (p.status, p.completed_at) IS DISTINCT FROM (
           CASE WHEN m.total > 0 AND m.todo = 0 THEN 'completed' ELSE 'todo' END,
           CASE WHEN m.total > 0 AND m.todo = 0 THEN COALESCE(p.completed_at, now()) ELSE NULL END
         )
  RETURNING p.*, m.total AS member_total, m.todo AS member_todo
`;

function normalizeName(name: string): string {
  const trimmed = (name ?? '').trim();
  if (!trimmed) throw AppError.paramInvalid('请输入项目名称');
  if (trimmed.length > NAME_MAX) {
    throw AppError.paramInvalid(`项目名称不能超过 ${NAME_MAX} 个字符`);
  }
  return trimmed;
}

function normalizeNote(note: string | null | undefined): string | null {
  if (note === undefined || note === null) return null;
  const raw = String(note);
  if (raw.length > NOTE_MAX) {
    throw AppError.paramInvalid(`备注不能超过 ${NOTE_MAX} 个字符`);
  }
  return raw.length ? raw : null;
}

/**
 * 项目领域服务（v0.8.0 项目域唯一入口）：
 * REST 路由与 LLM 工具执行器共用；任务域通过 recalcStatus/assertOwned 与之协作。
 *
 * 依赖方向：本文件只依赖 task/sql 与 task/types 的纯 SQL/类型，
 * 不 import task.service，避免与 TaskService 形成循环依赖。
 */
export const projectService = {
  async list(
    userId: number,
    filter: ProjectFilter
  ): Promise<{ list: ProjectDTO[]; total: number; page: number; page_size: number }> {
    const page = filter.page && filter.page > 0 ? filter.page : 1;
    const pageSize =
      filter.page_size && filter.page_size > 0 ? Math.min(filter.page_size, LIST_MAX) : LIST_DEFAULT;

    const clauses: string[] = ['p.user_id = $1'];
    const params: unknown[] = [userId];
    let index = 2;
    if (filter.status) {
      clauses.push(`p.status = $${index++}`);
      params.push(filter.status);
    }
    if (filter.keyword && filter.keyword.trim()) {
      const escaped = filter.keyword.trim().replace(/[%_\\]/g, (m) => `\\${m}`);
      clauses.push(`p.name ILIKE $${index++}`);
      params.push(`%${escaped}%`);
    }
    const clause = clauses.join(' AND ');

    const countRes = await query<{ total: string }>(
      `SELECT COUNT(*)::int AS total FROM projects p WHERE ${clause}`,
      params
    );
    const total = Number(countRes.rows[0]?.total ?? 0);

    const offset = (page - 1) * pageSize;
    const listRes = await query<ProjectRow>(
      `${PROJECT_SELECT} WHERE ${clause}
       ORDER BY p.created_at DESC, p.id DESC
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, pageSize, offset]
    );

    return { list: listRes.rows.map(toProjectDTO), total, page, page_size: pageSize };
  },

  /** 供助手与端上筛选器候选使用（不分页） */
  async listAll(userId: number, limit = 200): Promise<ProjectDTO[]> {
    const res = await query<ProjectRow>(
      `${PROJECT_SELECT} WHERE p.user_id = $1
       ORDER BY p.created_at DESC, p.id DESC
       LIMIT $2`,
      [userId, limit]
    );
    return res.rows.map(toProjectDTO);
  },

  async get(userId: number, projectId: number): Promise<ProjectDTO> {
    const res = await query<ProjectRow>(`${PROJECT_SELECT} WHERE p.id = $1 AND p.user_id = $2`, [
      projectId,
      userId,
    ]);
    if (res.rowCount === 0) throw AppError.notFound('项目不存在');
    return toProjectDTO(res.rows[0]);
  },

  /** 批量取项目名（任务列表带出项目摘要，避免 N+1） */
  async getManyByIds(userId: number, ids: number[]): Promise<Map<number, ProjectBrief>> {
    const unique = [...new Set(ids)].filter((id) => Number.isInteger(id) && id > 0);
    if (unique.length === 0) return new Map();
    const res = await query<ProjectBrief>(
      `SELECT id, name FROM projects WHERE user_id = $1 AND id = ANY($2::int[])`,
      [userId, unique]
    );
    return new Map(res.rows.map((row) => [row.id, row]));
  },

  async create(
    userId: number,
    input: CreateProjectInput,
    source: 'manual' | 'chat' = 'manual'
  ): Promise<ProjectDTO> {
    const name = normalizeName(input.name);
    const note = normalizeNote(input.note);
    const res = await query<ProjectRow>(
      `INSERT INTO projects(user_id, name, note, source)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [userId, name, note, source]
    );
    // 埋点（SDD 16.2）：只记 id 与来源，不记项目正文
    logger.info('project_created', { user_id: userId, project_id: res.rows[0].id, source });
    return toProjectDTO(res.rows[0]);
  },

  /** 仅 name/note；status 为派生只读，携带即由路由层拒绝（1001） */
  async update(userId: number, projectId: number, input: UpdateProjectInput): Promise<ProjectDTO> {
    await this.assertOwned(userId, projectId);

    const sets: string[] = [];
    const params: unknown[] = [];
    let index = 1;
    if (input.name !== undefined) {
      sets.push(`name = $${index++}`);
      params.push(normalizeName(input.name));
    }
    if (input.note !== undefined) {
      sets.push(`note = $${index++}`);
      params.push(normalizeNote(input.note));
    }
    if (sets.length === 0) return this.get(userId, projectId);

    sets.push('updated_at = now()');
    params.push(projectId, userId);
    await query(
      `UPDATE projects SET ${sets.join(', ')} WHERE id = $${index++} AND user_id = $${index}`,
      params
    );
    logger.info('project_updated', { user_id: userId, project_id: projectId });
    return this.get(userId, projectId);
  },

  /** 删除前预取：成员任务数与这些任务的任务日程数（供二次确认，不写库） */
  async previewRemove(userId: number, projectId: number): Promise<ProjectRemoveResult> {
    await this.assertOwned(userId, projectId);
    const taskRes = await query<{ n: number }>(
      `SELECT count(*)::int AS n FROM tasks WHERE user_id = $1 AND project_id = $2`,
      [userId, projectId]
    );
    const eventRes = await query<{ n: number }>(
      `SELECT count(*)::int AS n FROM events
       WHERE user_id = $1 AND task_id IN (
         SELECT id FROM tasks WHERE user_id = $1 AND project_id = $2
       )`,
      [userId, projectId]
    );
    return {
      deleted_task_count: Number(taskRes.rows[0]?.n ?? 0),
      deleted_event_count: Number(eventRes.rows[0]?.n ?? 0),
    };
  },

  /**
   * 删除项目（I6）：单事务内四步——取成员 id 集 → 删成员的任务日程 → 删成员任务 → 删项目。
   * 先删 events 再删 tasks，便于返回真实计数与审计（FK CASCADE 仅作兜底）。
   */
  async remove(userId: number, projectId: number): Promise<ProjectRemoveResult> {
    return withTransaction(async (client) => {
      await this.assertOwned(userId, projectId, client);

      const idsRes = await client.query<{ id: number }>(
        `SELECT id FROM tasks WHERE user_id = $1 AND project_id = $2`,
        [userId, projectId]
      );
      const ids = idsRes.rows.map((r) => r.id);

      const deletedEvents = ids.length
        ? await client.query(`DELETE FROM events WHERE user_id = $1 AND task_id = ANY($2::int[])`, [
            userId,
            ids,
          ])
        : { rowCount: 0 };

      const deletedTasks = await client.query(
        `DELETE FROM tasks WHERE user_id = $1 AND project_id = $2`,
        [userId, projectId]
      );
      await client.query(`DELETE FROM projects WHERE id = $1 AND user_id = $2`, [
        projectId,
        userId,
      ]);

      const counts: ProjectRemoveResult = {
        deleted_task_count: deletedTasks.rowCount ?? 0,
        deleted_event_count: deletedEvents.rowCount ?? 0,
      };
      // 埋点（SDD 16.2）：删除项目记录级联计数
      logger.info('project_deleted', {
        user_id: userId,
        project_id: projectId,
        ...counts,
      });
      return counts;
    });
  },

  /**
   * 项目成员列表：自己的 WHERE（user_id + project_id [+ status/keyword]），
   * 但复用任务域的 TASK_SELECT 与 toTaskDTO，保证与任务列表 DTO 完全一致。
   */
  async listMembers(
    userId: number,
    projectId: number,
    filter: ProjectMemberFilter
  ): Promise<{ list: TaskDTO[]; total: number }> {
    await this.assertOwned(userId, projectId);

    const page = filter.page && filter.page > 0 ? filter.page : 1;
    // 成员列表单次上限 = 项目成员上限（端上一次性展示全部成员）
    const pageSize =
      filter.page_size && filter.page_size > 0
        ? Math.min(filter.page_size, config.project.maxMembers)
        : LIST_DEFAULT;

    const clauses: string[] = ['t.user_id = $1', 't.project_id = $2'];
    const params: unknown[] = [userId, projectId];
    let index = 3;
    if (filter.status) {
      clauses.push(`t.status = $${index++}`);
      params.push(filter.status);
    }
    if (filter.keyword && filter.keyword.trim()) {
      const escaped = filter.keyword.trim().replace(/[%_\\]/g, (m) => `\\${m}`);
      clauses.push(`(t.title ILIKE $${index} OR t.note ILIKE $${index})`);
      params.push(`%${escaped}%`);
      index += 1;
    }
    const clause = clauses.join(' AND ');

    const countRes = await query<{ total: string }>(
      `SELECT COUNT(*)::int AS total FROM tasks t WHERE ${clause}`,
      params
    );
    const total = Number(countRes.rows[0]?.total ?? 0);

    const listRes = await query<TaskRow>(
      `${TASK_SELECT} WHERE ${clause} ${orderByTask(filter.sort)} LIMIT $${params.length + 1} OFFSET $${
        params.length + 2
      }`,
      [...params, pageSize, (page - 1) * pageSize]
    );

    return { list: listRes.rows.map(toTaskDTO), total };
  },

  /** 归属校验：不存在/越权统一按「不存在」处理（404 1004） */
  async assertOwned(
    userId: number,
    projectId: number,
    client?: PoolClient
  ): Promise<ProjectBrief> {
    const sql = `SELECT id, name FROM projects WHERE id = $1 AND user_id = $2`;
    const res = client
      ? await client.query<ProjectBrief>(sql, [projectId, userId])
      : await query<ProjectBrief>(sql, [projectId, userId]);
    if (res.rowCount === 0) throw AppError.notFound('项目不存在');
    return res.rows[0];
  },

  /** 成员上限（I3）：成员数 ≥ config.project.maxMembers → 1001 */
  async assertMemberCapacity(
    userId: number,
    projectId: number,
    excludeTaskId?: number
  ): Promise<void> {
    const res = await query<{ n: number }>(
      `SELECT count(*)::int AS n FROM tasks
       WHERE user_id = $2 AND project_id = $1
         AND ($3::int IS NULL OR id <> $3::int)`,
      [projectId, userId, excludeTaskId ?? null]
    );
    if (Number(res.rows[0]?.n ?? 0) >= config.project.maxMembers) {
      throw AppError.paramInvalid(`项目成员已达上限（最多 ${config.project.maxMembers} 个）`);
    }
  },

  /**
   * 项目状态唯一写入口（I4 / 决策 T3）：按成员完成度派生。
   * 单条原子 UPDATE + IS DISTINCT FROM：状态未变化时不命中，不写 updated_at（幂等）；
   * 空项目恒 todo。调用方必须保证与成员写操作在同一事务内。
   * 返回 null 表示项目不存在或状态未变化。
   */
  async recalcStatus(
    client: PoolClient,
    userId: number,
    projectId: number
  ): Promise<ProjectDTO | null> {
    const res = await client.query<ProjectRow & { member_todo: number }>(RECALC_STATUS_SQL, [
      userId,
      projectId,
    ]);
    const row = res.rows[0];
    if (!row) return null;

    const dto = toProjectDTO({
      ...row,
      member_completed: Number(row.member_total ?? 0) - Number(row.member_todo ?? 0),
    });
    // 埋点（SDD 16.2）：仅在状态实际变化时命中；status 只有两值，故前值必为另一值
    logger.info('project_status_derived', {
      user_id: userId,
      project_id: projectId,
      from: dto.status === 'completed' ? 'todo' : 'completed',
      to: dto.status,
      member_total: dto.member_total,
      member_completed: dto.member_completed,
    });
    return dto;
  },
};
