import type { PoolClient } from 'pg';
import { query, withTransaction } from '../../db/pool';
import { AppError } from '../../common/errors';
import { config } from '../../config';
import { logger } from '../../common/logger';
import { listService } from '../list/list.service';
import {
  normalizeSort,
  toTaskDTO,
  type CreateTaskInput,
  type Priority,
  type TaskDTO,
  type TaskFilter,
  type TaskRow,
  type TaskStatus,
  type TaskWriteResult,
  type UpdateTaskInput,
} from './types';

const TITLE_MAX = 200;
const NOTE_MAX = 2000;

/** 递归深度硬上限：理论无环（写入保证），仅作脏数据防御 */
const MAX_CTE_DEPTH = 32;

/**
 * 直接子任务进度聚合（折叠态显示 "2/5"）：
 * 单次聚合扫描后 LEFT JOIN 回主查询，避免 N+1。
 */
const SUBTASK_PROGRESS_JOIN = `
  LEFT JOIN (
    SELECT parent_id,
           count(*)::int AS total,
           count(*) FILTER (WHERE status = 'completed')::int AS done
    FROM tasks
    WHERE parent_id IS NOT NULL
    GROUP BY parent_id
  ) c ON c.parent_id = t.id
`;

const TASK_SELECT = `
  SELECT t.*, l.name AS list_name,
         COALESCE(c.total, 0)::int AS subtask_total,
         COALESCE(c.done, 0)::int AS subtask_completed
  FROM tasks t
  JOIN task_lists l ON l.id = t.list_id
  ${SUBTASK_PROGRESS_JOIN}
`;

/** 子树递归 CTE（含自身），用于删除级联 / 后代校验 / 子树查询 */
const SUBTREE_CTE = `
  WITH RECURSIVE subtree AS (
    SELECT t.id, t.parent_id, 1 AS depth
    FROM tasks t WHERE t.id = $1 AND t.user_id = $2
    UNION ALL
    SELECT t.id, t.parent_id, s.depth + 1
    FROM tasks t JOIN subtree s ON t.parent_id = s.id
    WHERE t.user_id = $2 AND s.depth < ${MAX_CTE_DEPTH}
  )
`;

/** 祖先链递归 CTE（含自身，向上） */
const ANCESTORS_CTE = `
  WITH RECURSIVE ancestors AS (
    SELECT t.id, t.parent_id, t.list_id, 1 AS depth
    FROM tasks t WHERE t.id = $1 AND t.user_id = $2
    UNION ALL
    SELECT t.id, t.parent_id, t.list_id, a.depth + 1
    FROM tasks t JOIN ancestors a ON t.id = a.parent_id
    WHERE t.user_id = $2 AND a.depth < ${MAX_CTE_DEPTH}
  )
`;

interface Condition {
  clause: string;
  params: unknown[];
}

/** 构造筛选条件（始终以 user_id 为第 1 个参数） */
function buildConditions(userId: number, filter: TaskFilter): Condition {
  const clauses: string[] = ['t.user_id = $1'];
  const params: unknown[] = [userId];
  let index = 2;

  if (filter.list_id) {
    clauses.push(`t.list_id = $${index++}`);
    params.push(filter.list_id);
  }
  if (filter.status) {
    clauses.push(`t.status = $${index++}`);
    params.push(filter.status);
  }
  if (filter.priority) {
    clauses.push(`t.priority = $${index++}`);
    params.push(filter.priority);
  }
  if (filter.due_from) {
    clauses.push(`t.due_at >= $${index++}::timestamptz`);
    params.push(filter.due_from);
  }
  if (filter.due_to) {
    clauses.push(`t.due_at <= $${index++}::timestamptz`);
    params.push(filter.due_to);
  }
  if (filter.keyword && filter.keyword.trim()) {
    const escaped = filter.keyword.trim().replace(/[%_\\]/g, (m) => `\\${m}`);
    clauses.push(`(t.title ILIKE $${index} OR t.note ILIKE $${index})`);
    params.push(`%${escaped}%`);
    index += 1;
  }
  // v0.2.0：根任务列表（任务首页）/ 直接子任务
  if (filter.root_only) {
    clauses.push('t.parent_id IS NULL');
  } else if (filter.parent_id) {
    clauses.push(`t.parent_id = $${index++}`);
    params.push(filter.parent_id);
  }

  return { clause: clauses.join(' AND '), params };
}

function orderBy(sort: string | undefined): string {
  switch (normalizeSort(sort)) {
    case 'due_at_desc':
      return 'ORDER BY (t.due_at IS NULL) ASC, t.due_at DESC, t.id DESC';
    case 'created_at_asc':
      return 'ORDER BY t.created_at ASC, t.id ASC';
    case 'created_at_desc':
      return 'ORDER BY t.created_at DESC, t.id DESC';
    case 'due_at_asc':
    default:
      return 'ORDER BY (t.due_at IS NULL) ASC, t.due_at ASC, t.id DESC';
  }
}

function normalizeTitle(title: string): string {
  const trimmed = (title ?? '').trim();
  if (!trimmed) throw AppError.paramInvalid('请输入任务标题');
  if (trimmed.length > TITLE_MAX) {
    throw AppError.paramInvalid(`任务标题不能超过 ${TITLE_MAX} 个字符`);
  }
  return trimmed;
}

function normalizeNote(note: string | null | undefined): string | null {
  if (note === undefined || note === null) return null;
  const trimmed = String(note);
  if (trimmed.length > NOTE_MAX) {
    throw AppError.paramInvalid(`备注不能超过 ${NOTE_MAX} 个字符`);
  }
  return trimmed.length ? trimmed : null;
}

function normalizeDueAt(dueAt: string | null | undefined): Date | null {
  if (dueAt === undefined || dueAt === null || dueAt === '') return null;
  const date = new Date(dueAt);
  if (Number.isNaN(date.getTime())) {
    throw AppError.paramInvalid('截止时间格式不正确');
  }
  return date;
}

interface AncestorNode {
  id: number;
  list_id: number;
  depth: number;
}

/**
 * 任务领域服务：REST 控制器与 LLM 工具执行器共用此服务，
 * 保证「能力对等」与业务规则只实现一次（系统设计文档 6.1）。
 */
export const taskService = {
  /** 解析目标清单：优先显式 list_id，其次按名称匹配，都没有则落到默认清单 */
  async resolveListId(
    userId: number,
    listId?: number | null,
    listName?: string | null
  ): Promise<number> {
    if (listId) {
      const list = await listService.getOwned(userId, listId);
      return list.id;
    }
    if (listName && listName.trim()) {
      const found = await listService.findByName(userId, listName);
      if (found) return found.id;
    }
    const defaultList = await listService.getDefault(userId);
    return defaultList.id;
  },

  async getOwned(userId: number, taskId: number): Promise<TaskRow> {
    const res = await query<TaskRow>(`${TASK_SELECT} WHERE t.id = $1 AND t.user_id = $2`, [
      taskId,
      userId,
    ]);
    if (res.rowCount === 0) throw AppError.notFound('任务不存在');
    return res.rows[0];
  },

  async get(userId: number, taskId: number): Promise<TaskDTO> {
    return toTaskDTO(await this.getOwned(userId, taskId));
  },

  /** 批量按 ID 取任务，返回 Map（用于刷新历史消息中的任务卡片快照） */
  async getManyByIds(userId: number, ids: number[]): Promise<Map<number, TaskDTO>> {
    const unique = [...new Set(ids)].filter((id) => Number.isInteger(id) && id > 0);
    if (unique.length === 0) return new Map();
    const res = await query<TaskRow>(
      `${TASK_SELECT} WHERE t.user_id = $1 AND t.id = ANY($2::int[])`,
      [userId, unique]
    );
    return new Map(res.rows.map((row) => [row.id, toTaskDTO(row)]));
  },

  async list(
    userId: number,
    filter: TaskFilter
  ): Promise<{ list: TaskDTO[]; total: number; page: number; page_size: number }> {
    const page = filter.page && filter.page > 0 ? filter.page : 1;
    const pageSize = filter.page_size && filter.page_size > 0 ? Math.min(filter.page_size, 100) : 50;
    const { clause, params } = buildConditions(userId, filter);

    const countRes = await query<{ total: string }>(
      `SELECT COUNT(*)::int AS total FROM tasks t WHERE ${clause}`,
      params
    );
    const total = Number(countRes.rows[0]?.total ?? 0);

    const offset = (page - 1) * pageSize;
    const listRes = await query<TaskRow>(
      `${TASK_SELECT} WHERE ${clause} ${orderBy(filter.sort)} LIMIT $${params.length + 1} OFFSET $${
        params.length + 2
      }`,
      [...params, pageSize, offset]
    );

    return { list: listRes.rows.map(toTaskDTO), total, page, page_size: pageSize };
  },

  /** 按条件全量取任务（供对话批量操作预览，不分页） */
  async listAll(userId: number, filter: TaskFilter, limit = 200): Promise<TaskDTO[]> {
    const { clause, params } = buildConditions(userId, filter);
    const res = await query<TaskRow>(
      `${TASK_SELECT} WHERE ${clause} ${orderBy(filter.sort)} LIMIT $${params.length + 1}`,
      [...params, limit]
    );
    return res.rows.map(toTaskDTO);
  },

  async search(userId: number, keyword: string, limit = 50): Promise<TaskDTO[]> {
    if (!keyword || !keyword.trim()) {
      throw AppError.paramInvalid('请输入搜索关键词');
    }
    return this.listAll(userId, { keyword, sort: 'created_at_desc' }, limit);
  },

  /* ------------------- v0.2.0 子树能力 ------------------- */

  /** 整棵子树的 id 集合（含自身） */
  async listSubtreeIds(userId: number, taskId: number, client?: PoolClient): Promise<number[]> {
    const sql = `${SUBTREE_CTE} SELECT id FROM subtree`;
    const res = client
      ? await client.query<{ id: number }>(sql, [taskId, userId])
      : await query<{ id: number }>(sql, [taskId, userId]);
    return res.rows.map((r) => r.id);
  },

  /** 祖先链（根 → 父 → 当前），不存在返回空数组 */
  async listAncestorChain(userId: number, taskId: number): Promise<AncestorNode[]> {
    const res = await query<AncestorNode>(
      `${ANCESTORS_CTE} SELECT id, list_id, depth FROM ancestors ORDER BY depth DESC`,
      [taskId, userId]
    );
    return res.rows;
  },

  /** 子树高度（自身为 1） */
  async subtreeHeight(userId: number, taskId: number): Promise<number> {
    const res = await query<{ h: number }>(
      `WITH RECURSIVE s AS (
         SELECT t.id, 1 AS d FROM tasks t WHERE t.id = $1 AND t.user_id = $2
         UNION ALL
         SELECT t.id, s.d + 1 FROM tasks t JOIN s ON t.parent_id = s.id
         WHERE t.user_id = $2 AND s.d < ${MAX_CTE_DEPTH}
       )
       SELECT COALESCE(MAX(d), 0)::int AS h FROM s`,
      [taskId, userId]
    );
    return Number(res.rows[0]?.h ?? 0);
  },

  /** 未完成后代数（不含自身），用于级联完成的两阶段判定 */
  async countIncompleteDescendants(userId: number, taskId: number): Promise<number> {
    const res = await query<{ n: number }>(
      `WITH RECURSIVE s AS (
         SELECT t.id, 1 AS d FROM tasks t WHERE t.id = $1 AND t.user_id = $2
         UNION ALL
         SELECT t.id, s.d + 1 FROM tasks t JOIN s ON t.parent_id = s.id
         WHERE t.user_id = $2 AND s.d < ${MAX_CTE_DEPTH}
       )
       SELECT COUNT(*)::int AS n FROM tasks t
       WHERE t.user_id = $2 AND t.id IN (SELECT id FROM s WHERE d > 1) AND t.status = 'todo'`,
      [taskId, userId]
    );
    return Number(res.rows[0]?.n ?? 0);
  },

  /**
   * 挂载校验（系统设计文档 6.2）：存在/归属、同清单、无环、深度四类约束。
   * @param listId 被挂载任务（或子树根）所属清单
   * @param movingTaskId 移动场景传入被移动节点 id，用于无环与深度校验
   */
  async assertCanAttach(
    userId: number,
    parentId: number,
    listId: number,
    movingTaskId?: number
  ): Promise<void> {
    const chain = await this.listAncestorChain(userId, parentId);
    if (chain.length === 0) throw AppError.notFound('父任务不存在');
    const root = chain[0];
    if (Number(root.list_id) !== Number(listId)) throw AppError.subtaskListMismatch();

    if (movingTaskId) {
      if (movingTaskId === parentId || chain.some((a) => a.id === movingTaskId)) {
        throw AppError.subtaskCycle();
      }
    }

    const parentDepth = chain.length;
    const height = movingTaskId ? await this.subtreeHeight(userId, movingTaskId) : 1;
    if (parentDepth + height > config.task.maxDepth) {
      throw AppError.subtaskDepthExceeded(config.task.maxDepth);
    }
  },

  /** 父任务已完成后新增/移入未完成子任务 → 仅恢复**直接父**（系统设计文档 6.4） */
  async maybeReviveParent(
    userId: number,
    parentId: number
  ): Promise<{ id: number; title: string } | null> {
    const res = await query<{ id: number; title: string; status: string }>(
      `SELECT id, title, status FROM tasks WHERE id = $1 AND user_id = $2`,
      [parentId, userId]
    );
    const parent = res.rows[0];
    if (!parent || parent.status !== 'completed') return null;
    await query(
      `UPDATE tasks SET status = 'todo', completed_at = NULL, updated_at = now()
       WHERE id = $1 AND user_id = $2`,
      [parentId, userId]
    );
    logger.info('parent_auto_revived', { user_id: userId, task_id: parentId });
    return { id: parent.id, title: parent.title };
  },

  /** 子树查询：返回扁平节点数组（depth/进度），前端据此还原树 */
  async getSubtree(
    userId: number,
    rootId: number,
    depth?: number | null
  ): Promise<TaskDTO[]> {
    const maxLevels = depth && depth > 0 ? depth : null;
    const res = await query<TaskRow & { subtree_size: number }>(
      `WITH RECURSIVE subtree AS (
         SELECT t.*, 1 AS depth FROM tasks t WHERE t.id = $1 AND t.user_id = $2
         UNION ALL
         SELECT t.*, s.depth + 1 FROM tasks t JOIN subtree s ON t.parent_id = s.id
         WHERE t.user_id = $2 AND s.depth < ${MAX_CTE_DEPTH}
           AND ($3::int IS NULL OR s.depth <= $3::int)
       )
       SELECT s.*, l.name AS list_name,
              (SELECT count(*)::int FROM subtree) AS subtree_size,
              COALESCE(p.total, 0)::int AS subtask_total,
              COALESCE(p.done, 0)::int AS subtask_completed
       FROM subtree s
       JOIN task_lists l ON l.id = s.list_id
       LEFT JOIN (
         SELECT parent_id,
                count(*)::int AS total,
                count(*) FILTER (WHERE status = 'completed')::int AS done
         FROM tasks WHERE parent_id IS NOT NULL GROUP BY parent_id
       ) p ON p.parent_id = s.id
       ORDER BY s.depth, (s.due_at IS NULL), s.due_at, s.id`,
      [rootId, userId, maxLevels]
    );
    if (res.rowCount === 0) throw AppError.notFound('任务不存在');
    const size = Number(res.rows[0]?.subtree_size ?? 0);
    if (size > config.task.treeMaxNodes) {
      throw AppError.paramInvalid(
        `子树包含 ${size} 个任务，超过 ${config.task.treeMaxNodes} 个上限，请收窄范围`
      );
    }
    return res.rows.map(toTaskDTO);
  },

  /** 面包屑（根 → 当前） */
  async getAncestorPath(userId: number, taskId: number): Promise<TaskDTO[]> {
    const chain = await this.listAncestorChain(userId, taskId);
    if (chain.length === 0) throw AppError.notFound('任务不存在');
    const ids = chain.map((c) => c.id);
    const res = await query<TaskRow>(
      `${TASK_SELECT} WHERE t.user_id = $1 AND t.id = ANY($2::int[])`,
      [userId, ids]
    );
    const map = new Map(res.rows.map((row) => [row.id, toTaskDTO(row)]));
    return ids.map((id) => map.get(id)).filter((t): t is TaskDTO => !!t);
  },

  /** 可挂载的父任务候选：同清单，排除自身与全部后代 */
  async listParentCandidates(userId: number, taskId: number): Promise<TaskDTO[]> {
    const self = await this.getOwned(userId, taskId);
    // 子任务与根任务同清单：候选取该任务所在「根」的清单
    const chain = await this.listAncestorChain(userId, taskId);
    const rootListId = chain.length > 0 ? Number(chain[0].list_id) : self.list_id;
    const res = await query<TaskRow>(
      `${TASK_SELECT}
       WHERE t.user_id = $1
         AND t.list_id = $2
         AND t.id <> $3
         AND t.id NOT IN (
           WITH RECURSIVE s AS (
             SELECT t2.id, 1 AS d FROM tasks t2 WHERE t2.id = $3 AND t2.user_id = $1
             UNION ALL
             SELECT t2.id, s.d + 1 FROM tasks t2 JOIN s ON t2.parent_id = s.id
             WHERE t2.user_id = $1 AND s.d < ${MAX_CTE_DEPTH}
           )
           SELECT id FROM s
         )
       ORDER BY (t.due_at IS NULL), t.due_at, t.id
       LIMIT 200`,
      [userId, rootListId, taskId]
    );
    return res.rows.map(toTaskDTO);
  },

  /* ------------------- 写操作 ------------------- */

  async create(
    userId: number,
    input: CreateTaskInput,
    source: 'manual' | 'chat' = 'manual'
  ): Promise<TaskWriteResult> {
    const title = normalizeTitle(input.title);
    const note = normalizeNote(input.note);
    const dueAt = normalizeDueAt(input.due_at);
    const listId = await this.resolveListId(userId, input.list_id);

    let parentId: number | null = null;
    if (input.parent_id) {
      parentId = Number(input.parent_id);
      await this.assertCanAttach(userId, parentId, listId);
    }

    const res = await query<TaskRow>(
      `INSERT INTO tasks(user_id, list_id, title, note, priority, due_at, source, parent_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
      [userId, listId, title, note, input.priority ?? 'none', dueAt, source, parentId]
    );

    const revived = parentId ? await this.maybeReviveParent(userId, parentId) : null;
    const dto = await this.get(userId, res.rows[0].id);
    if (parentId) {
      logger.info('subtask_created', { user_id: userId, task_id: dto.id, parent_id: parentId });
    }
    return { ...dto, revived_parent: revived };
  },

  async update(userId: number, taskId: number, patch: UpdateTaskInput): Promise<TaskWriteResult> {
    const existing = await this.getOwned(userId, taskId);
    const sets: string[] = [];
    const params: unknown[] = [];
    let index = 1;
    let revived: { id: number; title: string } | null = null;

    // 移动层级：显式 null = 移出为根任务
    if (patch.parent_id !== undefined) {
      const newParentId = patch.parent_id === null ? null : Number(patch.parent_id);
      if (newParentId !== (existing.parent_id ?? null)) {
        if (newParentId !== null) {
          await this.assertCanAttach(userId, newParentId, existing.list_id, taskId);
        }
        sets.push(`parent_id = $${index++}`);
        params.push(newParentId);
        if (newParentId !== null) {
          revived = await this.maybeReviveParent(userId, newParentId);
          logger.info('subtask_moved', {
            user_id: userId,
            task_id: taskId,
            to_parent_id: newParentId,
          });
        }
      }
    }

    if (patch.title !== undefined) {
      sets.push(`title = $${index++}`);
      params.push(normalizeTitle(patch.title));
    }
    if (patch.note !== undefined) {
      sets.push(`note = $${index++}`);
      params.push(normalizeNote(patch.note));
    }
    if (patch.priority !== undefined) {
      sets.push(`priority = $${index++}`);
      params.push(patch.priority);
    }
    if (patch.due_at !== undefined) {
      sets.push(`due_at = $${index++}`);
      params.push(normalizeDueAt(patch.due_at));
    }
    if (patch.list_id !== undefined && patch.list_id !== null) {
      const listId = await this.resolveListId(userId, patch.list_id);
      if (existing.parent_id !== null) {
        // 子任务的清单必须与父任务一致：先移出为根任务再改清单
        throw AppError.subtaskListMismatch();
      }
      if (listId !== existing.list_id) {
        // 根任务改清单时整棵子树跟随
        await query(
          `WITH RECURSIVE s AS (
             SELECT t2.id, 1 AS d FROM tasks t2 WHERE t2.id = $1 AND t2.user_id = $2
             UNION ALL
             SELECT t2.id, s.d + 1 FROM tasks t2 JOIN s ON t2.parent_id = s.id
             WHERE t2.user_id = $2 AND s.d < ${MAX_CTE_DEPTH}
           )
           UPDATE tasks SET list_id = $3, updated_at = now()
           WHERE user_id = $2 AND id IN (SELECT id FROM s)`,
          [taskId, userId, listId]
        );
      }
    }

    if (sets.length === 0) {
      return { ...toTaskDTO(existing), revived_parent: revived };
    }

    sets.push('updated_at = now()');
    params.push(taskId, userId);
    await query(
      `UPDATE tasks SET ${sets.join(', ')} WHERE id = $${index++} AND user_id = $${index}`,
      params
    );
    const dto = await this.get(userId, taskId);
    return { ...dto, revived_parent: revived };
  },

  /**
   * 完成 / 取消完成。
   * 完成父任务且存在未完成后代时，未带 cascade 抛 4010（两阶段）；
   * 取消完成只作用于自身，不级联（非对称规则）。
   */
  async setStatus(
    userId: number,
    taskId: number,
    status: TaskStatus,
    opts: { cascade?: boolean } = {}
  ): Promise<TaskDTO> {
    const existing = await this.getOwned(userId, taskId);

    if (status === 'completed') {
      if (existing.status === 'completed') return toTaskDTO(existing);
      const incomplete = await this.countIncompleteDescendants(userId, taskId);
      if (incomplete > 0 && !opts.cascade) {
        throw AppError.taskCascadeRequired(incomplete);
      }
      await withTransaction(async (client: PoolClient) => {
        await client.query(
          `WITH RECURSIVE s AS (
             SELECT t.id, 1 AS d FROM tasks t WHERE t.id = $1 AND t.user_id = $2
             UNION ALL
             SELECT t.id, s.d + 1 FROM tasks t JOIN s ON t.parent_id = s.id
             WHERE t.user_id = $2 AND s.d < ${MAX_CTE_DEPTH}
           )
           UPDATE tasks SET status = 'completed', completed_at = now(), updated_at = now()
           WHERE user_id = $2 AND id IN (SELECT id FROM s) AND status = 'todo'`,
          [taskId, userId]
        );
      });
      if (incomplete > 0) {
        logger.info('task_cascade_completed', {
          user_id: userId,
          task_id: taskId,
          descendants: incomplete,
        });
      }
    } else {
      await query(
        `UPDATE tasks SET status = 'todo', completed_at = NULL, updated_at = now()
         WHERE id = $1 AND user_id = $2`,
        [taskId, userId]
      );
    }
    return this.get(userId, taskId);
  },

  /** 删除前预取：子树节点数与任务日程数（对话确认文案用，不写库） */
  async previewRemove(
    userId: number,
    taskId: number
  ): Promise<{ deleted_task_count: number; deleted_event_count: number }> {
    const ids = await this.listSubtreeIds(userId, taskId);
    if (ids.length === 0) throw AppError.notFound('任务不存在');
    const res = await query<{ total: string }>(
      `SELECT COUNT(*)::int AS total FROM events WHERE user_id = $1 AND task_id = ANY($2::int[])`,
      [userId, ids]
    );
    return {
      deleted_task_count: ids.length,
      deleted_event_count: Number(res.rows[0]?.total ?? 0),
    };
  },

  /**
   * 删除任务：单事务内级联删除整棵子树及其全部任务日程（v0.2.0 子树版）。
   * DB 层 ON DELETE CASCADE 仅作兜底，正常路径以本事务为准，便于返回计数与审计。
   */
  async remove(
    userId: number,
    taskId: number
  ): Promise<{ deleted_task_count: number; deleted_event_count: number }> {
    return withTransaction(async (client) => {
      const ids = await this.listSubtreeIds(userId, taskId, client);
      if (ids.length === 0) throw AppError.notFound('任务不存在');

      const deletedEvents = await client.query(
        `DELETE FROM events WHERE user_id = $1 AND task_id = ANY($2::int[])`,
        [userId, ids]
      );
      await client.query(`DELETE FROM tasks WHERE user_id = $1 AND id = ANY($2::int[])`, [
        userId,
        ids,
      ]);

      const counts = {
        deleted_task_count: ids.length,
        deleted_event_count: deletedEvents.rowCount ?? 0,
      };
      logger.info('task_subtree_deleted', {
        user_id: userId,
        task_id: taskId,
        ...counts,
      });
      return counts;
    });
  },

  /** 按 ID 集合批量更新（对话确认后按已确认的 ID 精确执行） */
  async batchUpdateByIds(
    userId: number,
    ids: number[],
    patch: { priority?: Priority; due_at?: string | null; status?: TaskStatus; list_id?: number | null }
  ): Promise<TaskDTO[]> {
    if (ids.length === 0) return [];

    const sets: string[] = [];
    const params: unknown[] = [];
    let index = 1;

    if (patch.priority !== undefined) {
      sets.push(`priority = $${index++}`);
      params.push(patch.priority);
    }
    if (patch.due_at !== undefined) {
      sets.push(`due_at = $${index++}`);
      params.push(normalizeDueAt(patch.due_at));
    }
    if (patch.list_id !== undefined && patch.list_id !== null) {
      sets.push(`list_id = $${index++}`);
      params.push(await this.resolveListId(userId, patch.list_id));
    }
    if (patch.status !== undefined) {
      if (patch.status === 'completed') {
        sets.push(`status = 'completed'`, `completed_at = now()`);
      } else {
        sets.push(`status = 'todo'`, `completed_at = NULL`);
      }
    }

    if (sets.length === 0) {
      throw AppError.paramInvalid('没有需要更新的字段');
    }

    sets.push('updated_at = now()');
    params.push(userId, ids);
    const res = await query<TaskRow>(
      `UPDATE tasks SET ${sets.join(', ')}
       WHERE user_id = $${index++} AND id = ANY($${index}::int[])
       RETURNING id`,
      params
    );
    const updatedIds = res.rows.map((r) => r.id);
    if (updatedIds.length === 0) return [];

    const refreshed = await query<TaskRow>(
      `${TASK_SELECT} WHERE t.user_id = $1 AND t.id = ANY($2::int[]) ${orderBy('due_at_asc')}`,
      [userId, updatedIds]
    );
    return refreshed.rows.map(toTaskDTO);
  },

  /** REST 批量更新：按筛选条件直接执行（用户主动点击，无二次确认） */
  async batchUpdateByFilter(
    userId: number,
    filter: TaskFilter,
    patch: { priority?: Priority; due_at?: string | null; status?: TaskStatus; list_id?: number | null }
  ): Promise<TaskDTO[]> {
    const targets = await this.listAll(userId, filter);
    if (targets.length === 0) return [];
    return this.batchUpdateByIds(
      userId,
      targets.map((t) => t.id),
      patch
    );
  },

  async countByUser(userId: number): Promise<number> {
    const res = await query<{ total: string }>(
      `SELECT COUNT(*)::int AS total FROM tasks WHERE user_id = $1`,
      [userId]
    );
    return Number(res.rows[0]?.total ?? 0);
  },
};

export { withTransaction };
export type { TaskDTO, TaskRow };
