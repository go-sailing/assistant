import type { PoolClient } from 'pg';
import { query, withTransaction } from '../../db/pool';
import { AppError } from '../../common/errors';
import { config } from '../../config';
import { logger } from '../../common/logger';
import {
  toAgentLogDTO,
  toAgentTaskBrief,
  type AgentLogDTO,
  type AgentLogRow,
  type AgentState,
  type AgentTaskBrief,
  type AgentTaskBriefRow,
} from './types';

/** 代理可见任务字段（最小化；项目名由父任务带出，避免代理侧二次查询） */
const BRIEF_SELECT = `
  SELECT t.id, t.title, t.note, t.priority, t.due_at,
         t.agent_state, t.agent_queued_at, t.agent_claimed_at,
         p.title AS project_title
  FROM tasks t
  LEFT JOIN tasks p ON p.id = t.parent_id
`;

const NOT_ASSIGNED = '任务不存在或未指派给你';

/**
 * 状态写入后追加执行记录，并在同一事务内裁剪到最近 N 条（AGENT_LOG_KEEP）。
 * 裁剪按 task_id 维度，行数有限，避免长跑任务的日志无限增长（SDD 4.5）。
 */
async function appendLog(
  client: PoolClient,
  row: {
    userId: number;
    taskId: number;
    agentId: number | null;
    agentName: string | null;
    action: string;
    content?: string | null;
  }
): Promise<void> {
  await client.query(
    `INSERT INTO agent_task_logs(user_id, task_id, agent_id, agent_name, action, content)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [row.userId, row.taskId, row.agentId, row.agentName, row.action, row.content ?? null]
  );
  await client.query(
    `DELETE FROM agent_task_logs
     WHERE task_id = $1
       AND id NOT IN (
         SELECT id FROM agent_task_logs
         WHERE task_id = $1
         ORDER BY created_at DESC, id DESC
         LIMIT $2
       )`,
    [row.taskId, config.agent.logKeep]
  );
}

/** 代理归属与启用校验（写路径专用；读路径由 agentAuth 中间件已校验） */
async function assertAgentEnabled(client: PoolClient, agentId: number): Promise<number> {
  const res = await client.query<{ user_id: number; status: string; name: string }>(
    `SELECT user_id, status, name FROM agents WHERE id = $1`,
    [agentId]
  );
  const row = res.rows[0];
  if (!row || row.status !== 'enabled') throw AppError.agentUnauthorized();
  return row.user_id;
}

async function agentNameOf(client: PoolClient, agentId: number): Promise<string | null> {
  const res = await client.query<{ name: string }>(`SELECT name FROM agents WHERE id = $1`, [
    agentId,
  ]);
  return res.rows[0]?.name ?? null;
}

/** 队列中最早入队的可领取任务（长轮询命中判定与立即返回用，只读） */
export async function claimableHead(agentId: number): Promise<AgentTaskBrief | null> {
  const res = await query<AgentTaskBriefRow>(
    `${BRIEF_SELECT}
     WHERE t.agent_id = $1 AND t.agent_state = 'pending'
     ORDER BY t.agent_queued_at ASC, t.id ASC
     LIMIT 1`,
    [agentId]
  );
  return res.rows[0] ? toAgentTaskBrief(res.rows[0]) : null;
}

export const agentExecution = {
  claimableHead,

  /** 待执行队列计数（指派/重试前的上限校验） */
  async countPending(agentId: number): Promise<number> {
    const res = await query<{ n: number }>(
      `SELECT count(*)::int AS n FROM tasks WHERE agent_id = $1 AND agent_state = 'pending'`,
      [agentId]
    );
    return Number(res.rows[0]?.n ?? 0);
  },

  /** 代理的任务列表：缺省返回未终结任务（pending + running） */
  async listTasksForAgent(
    agentId: number,
    state: AgentState | undefined,
    limit: number
  ): Promise<AgentTaskBrief[]> {
    const capped = Math.min(Math.max(1, limit), 50);
    const params: unknown[] = [agentId];
    let clause = `t.agent_id = $1`;
    if (state) {
      params.push(state);
      clause += ` AND t.agent_state = $2`;
    } else {
      clause += ` AND t.agent_state IN ('pending', 'running')`;
    }
    const res = await query<AgentTaskBriefRow>(
      `${BRIEF_SELECT}
       WHERE ${clause}
       ORDER BY COALESCE(t.agent_queued_at, t.agent_claimed_at, t.created_at) ASC, t.id ASC
       LIMIT $${params.length + 1}`,
      [...params, capped]
    );
    return res.rows.map(toAgentTaskBrief);
  },

  /** 单任务详情（仅限本代理任务） */
  async getTaskForAgent(agentId: number, taskId: number): Promise<AgentTaskBrief> {
    const res = await query<AgentTaskBriefRow>(
      `${BRIEF_SELECT} WHERE t.agent_id = $1 AND t.id = $2`,
      [agentId, taskId]
    );
    if (!res.rows[0]) throw AppError.notFound(NOT_ASSIGNED);
    return toAgentTaskBrief(res.rows[0]);
  },

  /**
   * 原子领取：pending → running。
   * 不给 task_id 时领取队列中最早入队的任务（FIFO，行锁 SKIP LOCKED 避免互相等待）。
   */
  async claim(agentId: number, taskId?: number): Promise<AgentTaskBrief> {
    const brief = await withTransaction(async (client) => {
      const userId = await assertAgentEnabled(client, agentId);
      const agentName = await agentNameOf(client, agentId);

      let targetId = taskId;
      if (targetId === undefined) {
        const head = await client.query<{ id: number }>(
          `SELECT id FROM tasks
           WHERE agent_id = $1 AND agent_state = 'pending'
           ORDER BY agent_queued_at ASC, id ASC
           LIMIT 1
           FOR UPDATE SKIP LOCKED`,
          [agentId]
        );
        targetId = head.rows[0]?.id;
        if (targetId === undefined) throw AppError.agentTaskConflict('当前没有可领取的任务');
      }

      const updated = await client.query<{
        id: number;
        agent_queued_at: Date | null;
        agent_claimed_at: Date;
      }>(
        `UPDATE tasks
         SET agent_state = 'running', agent_claimed_at = now(), updated_at = now()
         WHERE id = $1 AND agent_id = $2 AND agent_state = 'pending'
         RETURNING id, agent_queued_at, agent_claimed_at`,
        [targetId, agentId]
      );
      if (updated.rowCount === 0) {
        // 区分"已不存在/非本代理"与"已被领取或已取消指派"
        const exists = await client.query<{ agent_state: string }>(
          `SELECT agent_state FROM tasks WHERE id = $1 AND agent_id = $2`,
          [targetId, agentId]
        );
        if (exists.rowCount === 0) throw AppError.notFound(NOT_ASSIGNED);
        throw AppError.agentTaskConflict();
      }

      const row = updated.rows[0];
      await appendLog(client, {
        userId,
        taskId: row.id,
        agentId,
        agentName,
        action: 'claimed',
      });
      return {
        userId,
        taskId: row.id,
        waitMs: row.agent_queued_at
          ? row.agent_claimed_at.getTime() - row.agent_queued_at.getTime()
          : 0,
      };
    });

    logger.info('agent_task_claim', {
      agent_id: agentId,
      task_id: brief.taskId,
      wait_ms: brief.waitMs,
    });
    return this.getTaskForAgent(agentId, brief.taskId);
  },

  /** 进度留言（不改状态） */
  async reportProgress(agentId: number, taskId: number, message: string): Promise<void> {
    await withTransaction(async (client) => {
      const userId = await assertAgentEnabled(client, agentId);
      const agentName = await agentNameOf(client, agentId);
      const res = await client.query<{ id: number }>(
        `SELECT id FROM tasks WHERE id = $1 AND agent_id = $2 AND agent_state = 'running'`,
        [taskId, agentId]
      );
      if (res.rowCount === 0) throw AppError.agentTaskInvalidState('任务当前不在执行中，无法回报进度');
      await appendLog(client, {
        userId,
        taskId,
        agentId,
        agentName,
        action: 'progress',
        content: message,
      });
    });
    logger.info('agent_task_progress', { agent_id: agentId, task_id: taskId });
  },

  /** 回报完成：running → succeeded，并把任务标记为已完成（I6 许可的两处写入之一） */
  async complete(agentId: number, taskId: number, result: string): Promise<void> {
    const done = await withTransaction(async (client) => {
      const userId = await assertAgentEnabled(client, agentId);
      const agentName = await agentNameOf(client, agentId);
      const res = await client.query<{
        id: number;
        agent_queued_at: Date | null;
        agent_claimed_at: Date | null;
        agent_finished_at: Date;
      }>(
        `UPDATE tasks
         SET agent_state = 'succeeded', agent_finished_at = now(), agent_result = $3,
             status = 'completed', completed_at = now(), updated_at = now()
         WHERE id = $1 AND agent_id = $2 AND agent_state = 'running'
         RETURNING id, agent_queued_at, agent_claimed_at, agent_finished_at`,
        [taskId, agentId, result]
      );
      if (res.rowCount === 0) {
        const exists = await client.query<{ id: number }>(
          `SELECT id FROM tasks WHERE id = $1 AND agent_id = $2`,
          [taskId, agentId]
        );
        if (exists.rowCount === 0) throw AppError.notFound(NOT_ASSIGNED);
        throw AppError.agentTaskInvalidState('任务当前不在执行中，无法回报完成');
      }
      const row = res.rows[0];
      await appendLog(client, {
        userId,
        taskId: row.id,
        agentId,
        agentName,
        action: 'succeeded',
        content: result,
      });
      const start = row.agent_claimed_at ?? row.agent_queued_at;
      return { userId, taskId: row.id, totalMs: start ? row.agent_finished_at.getTime() - start.getTime() : 0 };
    });

    logger.info('agent_task_complete', {
      agent_id: agentId,
      task_id: done.taskId,
      total_ms: done.totalMs,
    });
  },

  /** 回报失败：running → failed，任务保持未完成，等待用户「重新执行」 */
  async fail(agentId: number, taskId: number, reason: string): Promise<void> {
    await withTransaction(async (client) => {
      const userId = await assertAgentEnabled(client, agentId);
      const agentName = await agentNameOf(client, agentId);
      const res = await client.query<{ id: number }>(
        `UPDATE tasks
         SET agent_state = 'failed', agent_finished_at = now(), agent_result = $3, updated_at = now()
         WHERE id = $1 AND agent_id = $2 AND agent_state = 'running'
         RETURNING id`,
        [taskId, agentId, reason]
      );
      if (res.rowCount === 0) {
        const exists = await client.query<{ id: number }>(
          `SELECT id FROM tasks WHERE id = $1 AND agent_id = $2`,
          [taskId, agentId]
        );
        if (exists.rowCount === 0) throw AppError.notFound(NOT_ASSIGNED);
        throw AppError.agentTaskInvalidState('任务当前不在执行中，无法回报失败');
      }
      await appendLog(client, {
        userId,
        taskId,
        agentId,
        agentName,
        action: 'failed',
        content: reason,
      });
    });
    logger.info('agent_task_fail', { agent_id: agentId, task_id: taskId });
  },

  /** 历史任务（终态） */
  async listHistory(agentId: number, limit: number): Promise<AgentTaskBrief[]> {
    const capped = Math.min(Math.max(1, limit), 50);
    const res = await query<AgentTaskBriefRow>(
      `${BRIEF_SELECT}
       WHERE t.agent_id = $1 AND t.agent_state IN ('succeeded', 'failed')
       ORDER BY t.agent_finished_at DESC NULLS LAST, t.id DESC
       LIMIT $2`,
      [agentId, capped]
    );
    return res.rows.map(toAgentTaskBrief);
  },

  /** 本代理在某任务上的最近执行记录（只读，用于代理侧了解上下文） */
  async recentLogs(agentId: number, taskId: number, limit = 10): Promise<AgentLogDTO[]> {
    const owned = await query<{ id: number }>(
      `SELECT id FROM tasks WHERE id = $1 AND agent_id = $2`,
      [taskId, agentId]
    );
    if (owned.rowCount === 0) throw AppError.notFound(NOT_ASSIGNED);
    const capped = Math.min(Math.max(1, limit), 50);
    const res = await query<AgentLogRow>(
      `SELECT * FROM agent_task_logs
       WHERE task_id = $1
       ORDER BY created_at DESC, id DESC
       LIMIT $2`,
      [taskId, capped]
    );
    return res.rows.map(toAgentLogDTO);
  },
};
