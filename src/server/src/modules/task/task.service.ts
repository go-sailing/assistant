import type { PoolClient } from 'pg';
import { query, withTransaction } from '../../db/pool';
import { AppError } from '../../common/errors';
import { config } from '../../config';
import { logger } from '../../common/logger';
import { listService } from '../list/list.service';
import type { AgentState } from '../agent/types';
import {
  normalizeSort,
  toTaskDTO,
  type CreateTaskInput,
  type Priority,
  type TaskDTO,
  type TaskFilter,
  type TaskRow,
  type TaskStatus,
  type TaskType,
  type TaskWriteResult,
  type UpdateTaskInput,
} from './types';

const TITLE_MAX = 200;
const NOTE_MAX = 2000;

/**
 * 项目成员进度聚合（v0.6.0）：单次 GROUP BY 扫描后 LEFT JOIN 回主查询，
 * 列表/详情共用，避免 N+1。新模型保证 parent_id 仅指向 project。
 */
const MEMBER_PROGRESS_JOIN = `
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
  SELECT t.*,
         a.name AS agent_name,
         a.last_seen_at AS agent_last_seen_at,
         COALESCE(c.total, 0)::int AS member_total,
         COALESCE(c.done, 0)::int AS member_completed,
         COALESCE(c.total, 0)::int AS subtask_total,
         COALESCE(c.done, 0)::int AS subtask_completed
  FROM tasks t
  LEFT JOIN agents a ON a.id = t.agent_id
  ${MEMBER_PROGRESS_JOIN}
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

  if (filter.status) {
    clauses.push(`t.status = $${index++}`);
    params.push(filter.status);
  }
  if (filter.priority) {
    clauses.push(`t.priority = $${index++}`);
    params.push(filter.priority);
  }
  if (filter.task_type) {
    clauses.push(`t.task_type = $${index++}`);
    params.push(filter.task_type);
  }
  // v0.7.0：代理维度筛选（代理详情「绑定任务」）
  if (filter.agent_id) {
    clauses.push(`t.agent_id = $${index++}`);
    params.push(filter.agent_id);
  }
  if (filter.agent_state) {
    clauses.push(`t.agent_state = $${index++}`);
    params.push(filter.agent_state);
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
  // v0.2.0：根任务列表（任务首页）/ 直接子任务（v0.6.0 起即项目成员）
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

/** v0.6.0：任务类型归一化的独立导出，供编排层与路由侧复用 */
export function normalizeTaskType(raw: unknown): TaskType {
  if (raw === undefined || raw === null) return 'normal';
  if (raw !== 'normal' && raw !== 'project') {
    throw AppError.paramInvalid('任务类型不合法，仅支持 normal 或 project');
  }
  return raw;
}

/**
 * 任务领域服务：REST 控制器与 LLM 工具执行器共用此服务，
 * 保证「能力对等」与业务规则只实现一次（系统设计文档 6.1）。
 */
/** 默认清单解析缓存（v0.7.0：清单对外下线，任务统一落默认清单） */
const defaultListCache = new Map<number, { id: number; at: number }>();
const DEFAULT_LIST_TTL_MS = 60_000;

async function getDefaultListId(userId: number): Promise<number> {
  const cached = defaultListCache.get(userId);
  if (cached && Date.now() - cached.at < DEFAULT_LIST_TTL_MS) return cached.id;
  const id = await listService.getDefaultId(userId);
  defaultListCache.set(userId, { id, at: Date.now() });
  return id;
}

export const taskService = {
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

  /* ------------------- v0.6.0 任务类型与项目能力 ------------------- */

  /** 4017：项目任务必须为根任务（parent_id 为空） */
  assertProjectRoot(taskType: TaskType, parentId: number | null): void {
    if (taskType === 'project' && parentId !== null) {
      throw AppError.projectInvalidState();
    }
  },

  /**
   * 4018：普通任务的父任务只能指向项目任务。
   * 父任务不存在/越权由 getOwned 统一 404；成员仅一层由此天然保证
   * （成员是 normal，挂到成员下即父非 project → 4018）。
   */
  async assertParentIsProject(userId: number, parentId: number): Promise<TaskRow> {
    const parent = await this.getOwned(userId, parentId);
    if (parent.task_type !== 'project') throw AppError.subtaskNotSupported();
    return parent;
  },

  /** 项目成员规模上限：直接成员数 < TASK_TREE_MAX_NODES（默认 200） */
  async assertMemberCapacity(
    userId: number,
    projectId: number,
    excludeTaskId?: number
  ): Promise<void> {
    const res = await query<{ n: number }>(
      `SELECT count(*)::int AS n FROM tasks
       WHERE user_id = $2 AND parent_id = $1
         AND ($3::int IS NULL OR id <> $3::int)`,
      [projectId, userId, excludeTaskId ?? null]
    );
    if (Number(res.rows[0]?.n ?? 0) >= config.task.treeMaxNodes) {
      throw AppError.paramInvalid(`项目成员最多 ${config.task.treeMaxNodes} 个`);
    }
  },

  /**
   * 子节点 id 集合（v0.6.0 非递归）：项目 = 自身 + 直接成员；普通任务 = 仅自身。
   * 用于删除级联计数。
   */
  async listSubtreeIds(userId: number, taskId: number, client?: PoolClient): Promise<number[]> {
    const sql = `SELECT id FROM tasks WHERE user_id = $2 AND (id = $1 OR parent_id = $1)`;
    const res = client
      ? await client.query<{ id: number }>(sql, [taskId, userId])
      : await query<{ id: number }>(sql, [taskId, userId]);
    return res.rows.map((r) => r.id);
  },

  /** 未完成直接成员数（项目级联完成的两阶段判定） */
  async countIncompleteMembers(userId: number, projectId: number): Promise<number> {
    const res = await query<{ n: number }>(
      `SELECT count(*)::int AS n FROM tasks
       WHERE user_id = $2 AND parent_id = $1 AND status = 'todo'`,
      [projectId, userId]
    );
    return Number(res.rows[0]?.n ?? 0);
  },

  /** 项目已完成后新增/移入未完成成员 → 仅恢复直接父（项目） */
  async maybeReviveParent(
    userId: number,
    parentId: number,
    childStatus: TaskStatus
  ): Promise<{ id: number; title: string } | null> {
    if (childStatus !== 'todo') return null;
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
    logger.info('project_auto_revived', { user_id: userId, project_id: parentId });
    return { id: parent.id, title: parent.title };
  },

  /**
   * 子树（v0.6.0 语义收窄）：项目返回 [项目, ...直接成员]（depth 1/2）；
   * 普通任务没有成员，仅返回自身。
   */
  async getSubtree(userId: number, rootId: number, depth?: number | null): Promise<TaskDTO[]> {
    const root = await this.getOwned(userId, rootId);
    if (root.task_type !== 'project') {
      return [toTaskDTO(root)];
    }
    const maxLevels = depth && depth > 0 ? depth : null;
    const res = await query<TaskRow>(
      `${TASK_SELECT}
       WHERE t.user_id = $1
         AND (t.id = $2
              OR (t.parent_id = $2 AND ($3::int IS NULL OR $3::int >= 1)))
       ORDER BY (t.id = $2) DESC, (t.due_at IS NULL), t.due_at, t.id`,
      [userId, rootId, maxLevels]
    );
    if ((res.rowCount ?? 0) - 1 > config.task.treeMaxNodes) {
      throw AppError.paramInvalid(`项目成员超过 ${config.task.treeMaxNodes} 个，请收窄范围`);
    }
    return res.rows.map((row, i) => toTaskDTO({ ...row, depth: i === 0 ? 1 : 2 }));
  },

  /** 面包屑（v0.6.0 起为「项目 → 成员」至多两层） */
  async getAncestorPath(userId: number, taskId: number): Promise<TaskDTO[]> {
    const self = await this.getOwned(userId, taskId);
    const ids = self.parent_id ? [Number(self.parent_id), self.id] : [self.id];
    const res = await query<TaskRow>(
      `${TASK_SELECT} WHERE t.user_id = $1 AND t.id = ANY($2::int[])`,
      [userId, ids]
    );
    const map = new Map(res.rows.map((row) => [row.id, toTaskDTO(row)]));
    return ids.map((id) => map.get(id)).filter((t): t is TaskDTO => !!t);
  },

  /** 可挂载的父任务候选（v0.7.0）：全部项目，排除自身（清单维度已下线） */
  async listParentCandidates(userId: number, taskId: number): Promise<TaskDTO[]> {
    await this.getOwned(userId, taskId);
    const res = await query<TaskRow>(
      `${TASK_SELECT}
       WHERE t.user_id = $1
         AND t.task_type = 'project'
         AND t.id <> $2
       ORDER BY (t.due_at IS NULL), t.due_at, t.id
       LIMIT 200`,
      [userId, taskId]
    );
    return res.rows.map(toTaskDTO);
  },

  /* ------------------- 写操作 ------------------- */

  async create(
    userId: number,
    input: CreateTaskInput,
    source: 'manual' | 'chat' = 'manual'
  ): Promise<TaskWriteResult> {
    const taskType = normalizeTaskType(input.task_type);
    const title = normalizeTitle(input.title);
    const note = normalizeNote(input.note);
    const dueAt = normalizeDueAt(input.due_at);
    const listId = await getDefaultListId(userId);

    const parentId = input.parent_id ? Number(input.parent_id) : null;
    // 4017：项目必须为顶层任务
    this.assertProjectRoot(taskType, parentId);
    if (parentId !== null) {
      // 404 / 4018：父任务必须是项目（v0.7.0 起不再有同清单约束）
      await this.assertParentIsProject(userId, parentId);
      await this.assertMemberCapacity(userId, parentId);
    }

    const res = await query<TaskRow>(
      `INSERT INTO tasks(user_id, list_id, title, note, priority, due_at, source, parent_id, task_type)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
      [userId, listId, title, note, input.priority ?? 'none', dueAt, source, parentId, taskType]
    );

    // 新建任务恒 todo；挂到已完成项目 → 唤醒项目
    const revived =
      parentId !== null ? await this.maybeReviveParent(userId, parentId, 'todo') : null;
    const dto = await this.get(userId, res.rows[0].id);
    if (taskType === 'project') {
      // 埋点（SDD 11.2）：仅记 ID 与来源，不记项目正文
      logger.info('project_create', { user_id: userId, task_id: dto.id, source });
    } else if (parentId !== null) {
      logger.info('project_member_add', {
        user_id: userId,
        task_id: dto.id,
        project_id: parentId,
        source,
      });
    }
    return { ...dto, revived_parent: revived };
  },

  async update(userId: number, taskId: number, patch: UpdateTaskInput): Promise<TaskWriteResult> {
    const existing = await this.getOwned(userId, taskId);
    // v0.6.0：task_type 创建后不可变更，携带即参数校验错误
    if (patch.task_type !== undefined) {
      throw AppError.paramInvalid('任务类型创建后不可变更');
    }
    const sets: string[] = [];
    const params: unknown[] = [];
    let index = 1;
    let revived: { id: number; title: string } | null = null;

    // 移动层级：显式 null / 0 = 移出成为独立任务
    if (patch.parent_id !== undefined) {
      const newParentId =
        patch.parent_id === null || Number(patch.parent_id) === 0 ? null : Number(patch.parent_id);
      if (newParentId !== (existing.parent_id ?? null)) {
        if (existing.task_type === 'project' && newParentId !== null) {
          throw AppError.projectInvalidState(); // 4017
        }
        if (newParentId !== null) {
          // 404 / 4018：目标父必须是项目（v0.7.0 起不再有同清单约束）
          await this.assertParentIsProject(userId, newParentId);
          await this.assertMemberCapacity(userId, newParentId, taskId);
        }
        sets.push(`parent_id = $${index++}`);
        params.push(newParentId);
        if (newParentId !== null) {
          // 已完成成员移入不唤醒项目
          revived = await this.maybeReviveParent(userId, newParentId, existing.status as TaskStatus);
          logger.info('project_member_move_in', {
            user_id: userId,
            task_id: taskId,
            project_id: newParentId,
          });
        } else {
          logger.info('project_member_move_out', { user_id: userId, task_id: taskId });
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
   * 完成项目且存在未完成成员时，未带 cascade 抛 4010（两阶段）；
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
      const incomplete =
        existing.task_type === 'project' ? await this.countIncompleteMembers(userId, taskId) : 0;
      if (incomplete > 0 && !opts.cascade) {
        throw AppError.taskCascadeRequired(incomplete);
      }
      await withTransaction(async (client: PoolClient) => {
        // 一条 UPDATE 完成项目自身及其未完成直接成员（普通任务无成员，仅自身）
        await client.query(
          `UPDATE tasks SET status = 'completed', completed_at = now(), updated_at = now()
           WHERE user_id = $2 AND status = 'todo' AND (id = $1 OR parent_id = $1)`,
          [taskId, userId]
        );
      });
      if (existing.task_type === 'project') {
        // 埋点（SDD 11.2）：是否级联 + 级联成员数
        logger.info('project_complete', {
          user_id: userId,
          project_id: taskId,
          cascade: incomplete > 0 && opts.cascade === true,
          member_count: incomplete,
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
      const kindRow = await client.query<{ task_type: string }>(
        `SELECT task_type FROM tasks WHERE id = $1 AND user_id = $2`,
        [taskId, userId]
      );
      const isProject = kindRow.rows[0]?.task_type === 'project';

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
      // 埋点（SDD 11.2）：项目删除记录级联计数；普通任务删除沿用原事件名
      logger.info(isProject ? 'project_delete' : 'task_subtree_deleted', {
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
    patch: { priority?: Priority; due_at?: string | null; status?: TaskStatus }
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
    patch: { priority?: Priority; due_at?: string | null; status?: TaskStatus }
  ): Promise<TaskDTO[]> {
    const targets = await this.listAll(userId, filter);
    if (targets.length === 0) return [];
    return this.batchUpdateByIds(
      userId,
      targets.map((t) => t.id),
      patch
    );
  },

  /** v0.7.0：代理详情「绑定任务」列表（按执行状态筛选，缺省返回全部非未指派态） */
  async listByAgent(
    userId: number,
    agentId: number,
    filter: { agent_state?: AgentState; page?: number; page_size?: number } = {}
  ): Promise<{ list: TaskDTO[]; total: number; page: number; page_size: number }> {
    return this.list(userId, {
      agent_id: agentId,
      agent_state: filter.agent_state,
      page: filter.page,
      page_size: filter.page_size ?? 20,
      sort: 'due_at_asc',
    });
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
