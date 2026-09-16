import type { PoolClient } from 'pg';
import { query, withTransaction } from '../../db/pool';
import { AppError } from '../../common/errors';
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
  type UpdateTaskInput,
} from './types';

const TITLE_MAX = 200;
const NOTE_MAX = 2000;

const TASK_SELECT = `
  SELECT t.*, l.name AS list_name
  FROM tasks t
  JOIN task_lists l ON l.id = t.list_id
`;

interface Condition {
  clause: string;
  params: unknown[];
}

/** 构造筛选条件，参数编号从 startIndex 开始（始终以 user_id 为第 1 个参数） */
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

/**
 * 任务领域服务：REST 控制器与 LLM 工具执行器共用此服务，
 * 保证「能力对等」与业务规则只实现一次（系统设计文档 10.3）。
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

  async create(
    userId: number,
    input: CreateTaskInput,
    source: 'manual' | 'chat' = 'manual'
  ): Promise<TaskDTO> {
    const title = normalizeTitle(input.title);
    const note = normalizeNote(input.note);
    const dueAt = normalizeDueAt(input.due_at);
    const listId = await this.resolveListId(userId, input.list_id);

    const res = await query<TaskRow>(
      `INSERT INTO tasks(user_id, list_id, title, note, priority, due_at, source)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [userId, listId, title, note, input.priority ?? 'none', dueAt, source]
    );
    return this.get(userId, res.rows[0].id);
  },

  async update(userId: number, taskId: number, patch: UpdateTaskInput): Promise<TaskDTO> {
    const existing = await this.getOwned(userId, taskId);
    const sets: string[] = [];
    const params: unknown[] = [];
    let index = 1;

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
      sets.push(`list_id = $${index++}`);
      params.push(listId);
    }

    if (sets.length === 0) {
      return toTaskDTO(existing);
    }

    sets.push('updated_at = now()');
    params.push(taskId, userId);
    await query(
      `UPDATE tasks SET ${sets.join(', ')} WHERE id = $${index++} AND user_id = $${index}`,
      params
    );
    return this.get(userId, taskId);
  },

  /** 完成 / 取消完成，维护 completed_at */
  async setStatus(userId: number, taskId: number, status: TaskStatus): Promise<TaskDTO> {
    await this.getOwned(userId, taskId);
    if (status === 'completed') {
      await query(
        `UPDATE tasks SET status = 'completed', completed_at = now(), updated_at = now()
         WHERE id = $1 AND user_id = $2`,
        [taskId, userId]
      );
    } else {
      await query(
        `UPDATE tasks SET status = 'todo', completed_at = NULL, updated_at = now()
         WHERE id = $1 AND user_id = $2`,
        [taskId, userId]
      );
    }
    return this.get(userId, taskId);
  },

  async remove(userId: number, taskId: number): Promise<void> {
    const res = await query(`DELETE FROM tasks WHERE id = $1 AND user_id = $2`, [taskId, userId]);
    if (res.rowCount === 0) throw AppError.notFound('任务不存在');
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