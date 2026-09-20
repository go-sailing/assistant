import { query, withTransaction } from '../../db/pool';
import { AppError } from '../../common/errors';
import { logger } from '../../common/logger';
import { listService } from '../list/list.service';
import { projectService } from '../project/project.service';
import type { AgentState } from '../agent/types';
import { TASK_SELECT, orderByTask } from './sql';
import {
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
  // v0.8.0：按所属项目筛选；'none' 为「未归属任何项目」的哨兵（决策 T4）
  if (filter.project_id !== undefined) {
    if (filter.project_id === 'none') {
      clauses.push('t.project_id IS NULL');
    } else {
      clauses.push(`t.project_id = $${index++}`);
      params.push(filter.project_id);
    }
  }

  return { clause: clauses.join(' AND '), params };
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

/** v0.8.0：移入项目传项目 ID；null/0 = 移出成为未归属项目的任务 */
function normalizeProjectId(raw: number | null): number | null {
  return raw === null || Number(raw) === 0 ? null : Number(raw);
}

/**
 * 任务领域服务：REST 控制器与 LLM 工具执行器共用此服务，
 * 保证「能力对等」与业务规则只实现一次（系统设计文档 6.1）。
 * v0.8.0：模型上只有一种任务，项目归属由 project_id 表达，状态与进度归 ProjectService。
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
    const res = await query<TaskRow>(`${TASK_SELECT} WHERE t.user_id = $1 AND t.id = ANY($2::int[])`, [
      userId,
      unique,
    ]);
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
      `${TASK_SELECT} WHERE ${clause} ${orderByTask(filter.sort)} LIMIT $${params.length + 1} OFFSET $${
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
      `${TASK_SELECT} WHERE ${clause} ${orderByTask(filter.sort)} LIMIT $${params.length + 1}`,
      [...params, limit]
    );
    return res.rows.map(toTaskDTO);
  },

  async search(userId: number, keyword: string, limit = 50): Promise<TaskDTO[]> {
    if (!keyword || !keyword.trim()) {
      throw AppError.paramInvalid('请输入搜索关键词');
    }
    // 只搜任务；项目搜索由 GET /projects?keyword= 承担（决策 T5）
    return this.listAll(userId, { keyword, sort: 'created_at_desc' }, limit);
  },

  /* ------------------- 写操作 ------------------- */

  async create(
    userId: number,
    input: CreateTaskInput,
    source: 'manual' | 'chat' = 'manual'
  ): Promise<TaskDTO> {
    const title = normalizeTitle(input.title);
    const note = normalizeNote(input.note);
    const dueAt = normalizeDueAt(input.due_at);
    const listId = await getDefaultListId(userId);

    const projectId = input.project_id ? Number(input.project_id) : null;
    if (projectId !== null) {
      // 404（不存在/越权）+ 1001（成员已达上限）
      await projectService.assertOwned(userId, projectId);
      await projectService.assertMemberCapacity(userId, projectId);
    }

    // 成员写入与其项目状态回算必须同事务，避免出现「成员已全完成但项目仍 todo」的中间可见态
    const taskId = await withTransaction(async (client) => {
      const res = await client.query<{ id: number }>(
        `INSERT INTO tasks(user_id, list_id, title, note, priority, due_at, source, project_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
        [userId, listId, title, note, input.priority ?? 'none', dueAt, source, projectId]
      );
      const id = res.rows[0].id;
      if (projectId !== null) {
        await projectService.recalcStatus(client, userId, projectId);
        // 埋点（SDD 16.2）：只记 ID 与来源，不记任务正文
        logger.info('project_member_add', {
          user_id: userId,
          task_id: id,
          project_id: projectId,
          source,
        });
      }
      return id;
    });

    return this.get(userId, taskId);
  },

  async update(userId: number, taskId: number, patch: UpdateTaskInput): Promise<TaskDTO> {
    const existing = await this.getOwned(userId, taskId);
    const currentProjectId = existing.project_id ?? null;

    const sets: string[] = [];
    const params: unknown[] = [];
    let index = 1;

    // 移动项目：显式 null / 0 = 移出成为未归属项目的任务
    let nextProjectId: number | null | undefined;
    if (patch.project_id !== undefined) {
      nextProjectId = normalizeProjectId(patch.project_id);
      if (nextProjectId !== currentProjectId) {
        if (nextProjectId !== null) {
          // 404（目标项目不存在/越权）+ 1001（成员已达上限）
          await projectService.assertOwned(userId, nextProjectId);
          await projectService.assertMemberCapacity(userId, nextProjectId, taskId);
        }
        sets.push(`project_id = $${index++}`);
        params.push(nextProjectId);
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
      return toTaskDTO(existing);
    }

    const moved = nextProjectId !== undefined && nextProjectId !== currentProjectId;
    // 移入后的目标项目（moved 为真时才有意义）；单独取 const 便于事务闭包内安全使用
    const targetProjectId = moved ? nextProjectId ?? null : currentProjectId;
    sets.push('updated_at = now()');
    params.push(taskId, userId);
    await withTransaction(async (client) => {
      await client.query(
        `UPDATE tasks SET ${sets.join(', ')} WHERE id = $${index++} AND user_id = $${index}`,
        params
      );
      // 移入/移出：旧项目与新项目各回算一次（同一事务，SDD 4.3 调用点）
      if (moved) {
        if (currentProjectId !== null) {
          await projectService.recalcStatus(client, userId, currentProjectId);
        }
        if (targetProjectId !== null) {
          await projectService.recalcStatus(client, userId, targetProjectId);
        }
      }
    });

    if (moved) {
      if (targetProjectId !== null) {
        logger.info('project_member_move_in', {
          user_id: userId,
          task_id: taskId,
          project_id: targetProjectId,
        });
      } else {
        logger.info('project_member_move_out', {
          user_id: userId,
          task_id: taskId,
          project_id: currentProjectId,
        });
      }
    }
    return this.get(userId, taskId);
  },

  /**
   * 完成 / 取消完成（v0.8.0）：
   * - 去级联（项目已非任务，4010 无触发面），只切换任务自身状态；
   * - 完成后所属项目状态由 recalcStatus 派生；
   * - 完成分支同一事务内取消在途「待领取」指派（仅 pending，running 不动，SDD 8.2）。
   */
  async setStatus(userId: number, taskId: number, status: TaskStatus): Promise<TaskDTO> {
    const existing = await this.getOwned(userId, taskId);
    const projectId = existing.project_id ?? null;

    if (status === 'completed') {
      if (existing.status === 'completed') return toTaskDTO(existing);
      await withTransaction(async (client) => {
        await client.query(
          `UPDATE tasks SET status = 'completed', completed_at = now(), updated_at = now()
           WHERE id = $1 AND user_id = $2`,
          [taskId, userId]
        );

        // 取消在途 pending 指派：先取代理快照（写日志需要代理名），再清空
        const pending = await client.query<{ agent_id: number | null; agent_name: string | null }>(
          `SELECT t.agent_id, a.name AS agent_name
           FROM tasks t LEFT JOIN agents a ON a.id = t.agent_id
           WHERE t.id = $1 AND t.user_id = $2 AND t.agent_state = 'pending'`,
          [taskId, userId]
        );
        if ((pending.rowCount ?? 0) > 0) {
          const snapshot = pending.rows[0];
          await client.query(
            `UPDATE tasks
             SET agent_id = NULL, agent_state = 'none', agent_queued_at = NULL, updated_at = now()
             WHERE id = $1 AND user_id = $2 AND agent_state = 'pending'`,
            [taskId, userId]
          );
          // 固定文案（不含用户正文），动作命中 ck_agent_logs_action 白名单
          await client.query(
            `INSERT INTO agent_task_logs(user_id, task_id, agent_id, agent_name, action, content)
             VALUES ($1, $2, $3, $4, 'unassigned', $5)`,
            [
              userId,
              taskId,
              snapshot.agent_id,
              snapshot.agent_name,
              '任务已完成，待领取的指派已自动取消',
            ]
          );
        }

        if (projectId !== null) {
          await projectService.recalcStatus(client, userId, projectId);
        }
      });
    } else {
      await withTransaction(async (client) => {
        await client.query(
          `UPDATE tasks SET status = 'todo', completed_at = NULL, updated_at = now()
           WHERE id = $1 AND user_id = $2`,
          [taskId, userId]
        );
        if (projectId !== null) {
          await projectService.recalcStatus(client, userId, projectId);
        }
      });
    }
    return this.get(userId, taskId);
  },

  /** 删除前预取：任务自身 + 其任务日程数（对话确认文案用，不写库） */
  async previewRemove(
    userId: number,
    taskId: number
  ): Promise<{ deleted_task_count: number; deleted_event_count: number }> {
    await this.getOwned(userId, taskId);
    const res = await query<{ total: string }>(
      `SELECT COUNT(*)::int AS total FROM events WHERE user_id = $1 AND task_id = $2`,
      [userId, taskId]
    );
    return {
      deleted_task_count: 1,
      deleted_event_count: Number(res.rows[0]?.total ?? 0),
    };
  },

  /**
   * 删除任务：单事务内删除自身与其全部任务日程，并对所属项目回算状态。
   * 无层级概念（v0.8.0）；DB 层 ON DELETE CASCADE 仅作兜底，
   * 正常路径以本事务为准，便于返回计数与审计。
   */
  async remove(
    userId: number,
    taskId: number
  ): Promise<{ deleted_task_count: number; deleted_event_count: number }> {
    return withTransaction(async (client) => {
      const own = await client.query<{ project_id: number | null }>(
        `SELECT project_id FROM tasks WHERE id = $1 AND user_id = $2`,
        [taskId, userId]
      );
      if (own.rowCount === 0) throw AppError.notFound('任务不存在');
      const projectId = own.rows[0].project_id;

      const deletedEvents = await client.query(
        `DELETE FROM events WHERE user_id = $1 AND task_id = $2`,
        [userId, taskId]
      );
      await client.query(`DELETE FROM tasks WHERE user_id = $1 AND id = $2`, [userId, taskId]);
      if (projectId !== null) {
        await projectService.recalcStatus(client, userId, projectId);
      }

      const counts = {
        deleted_task_count: 1,
        deleted_event_count: deletedEvents.rowCount ?? 0,
      };
      logger.info('task_deleted', { user_id: userId, task_id: taskId, ...counts });
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
    const updatedIds = await withTransaction(async (client) => {
      const res = await client.query<{ id: number }>(
        `UPDATE tasks SET ${sets.join(', ')}
         WHERE user_id = $${index++} AND id = ANY($${index}::int[])
         RETURNING id`,
        params
      );
      const updated = res.rows.map((r) => r.id);
      // 批量改完成状态同样影响所属项目的派生状态（I4）：逐个受影响项目回算（同一事务）
      if (updated.length > 0 && patch.status !== undefined) {
        const projRes = await client.query<{ project_id: number }>(
          `SELECT DISTINCT project_id FROM tasks
           WHERE user_id = $1 AND id = ANY($2::int[]) AND project_id IS NOT NULL`,
          [userId, updated]
        );
        for (const row of projRes.rows) {
          await projectService.recalcStatus(client, userId, row.project_id);
        }
      }
      return updated;
    });
    if (updatedIds.length === 0) return [];

    const refreshed = await query<TaskRow>(
      `${TASK_SELECT} WHERE t.user_id = $1 AND t.id = ANY($2::int[]) ${orderByTask('due_at_asc')}`,
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
