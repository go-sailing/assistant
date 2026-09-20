import { createHash, randomBytes } from 'crypto';
import type { PoolClient } from 'pg';
import { query, withTransaction } from '../../db/pool';
import { AppError } from '../../common/errors';
import { config } from '../../config';
import { logger } from '../../common/logger';
import { taskService } from '../task/task.service';
import type { TaskDTO } from '../task/types';
import { notifyAgent } from '../../mcp/waiter';
import { agentExecution } from './agent.execution';
import {
  AGENT_KIND_LABELS,
  toAgentDTO,
  toAgentLogDTO,
  type AgentCounts,
  type AgentDTO,
  type AgentKind,
  type AgentLogDTO,
  type AgentLogRow,
  type AgentRow,
  type AgentTaskBrief,
  type AgentState,
  type AgentWithToken,
  type CreateAgentInput,
  type UpdateAgentInput,
} from './types';

const NAME_MAX = 50;
const KIND_LABEL_MAX = 30;
const DESC_MAX = 200;
const TOKEN_PREFIX = 'ak_live_';
const TOKEN_BYTES = 32;
const PREFIX_SHOW_LEN = 12;
/** last_seen_at 写入节流（秒）：避免每次 MCP 调用都写库 */
const LAST_SEEN_THROTTLE_SEC = 60;

function normalizeName(name: string): string {
  const trimmed = (name ?? '').trim();
  if (!trimmed) throw AppError.paramInvalid('请输入代理名称');
  if (trimmed.length > NAME_MAX) {
    throw AppError.paramInvalid(`代理名称不能超过 ${NAME_MAX} 个字符`);
  }
  return trimmed;
}

function normalizeDescription(description: string | null | undefined): string | null {
  if (description === undefined || description === null) return null;
  const trimmed = String(description);
  if (trimmed.length > DESC_MAX) {
    throw AppError.paramInvalid(`代理描述不能超过 ${DESC_MAX} 个字符`);
  }
  return trimmed.length ? trimmed : null;
}

/** 类型与展示名归一：预设用固定 label，custom 必须自带名称 */
function normalizeKind(kind: AgentKind, kindLabel?: string | null): string {
  if (kind !== 'custom') return AGENT_KIND_LABELS[kind];
  const label = (kindLabel ?? '').trim();
  if (!label) throw AppError.paramInvalid('选择「其他」时需要填写自定义类型名');
  if (label.length > KIND_LABEL_MAX) {
    throw AppError.paramInvalid(`自定义类型名不能超过 ${KIND_LABEL_MAX} 个字符`);
  }
  return label;
}

function generateToken(): { plain: string; hash: string; prefix: string } {
  const plain = TOKEN_PREFIX + randomBytes(TOKEN_BYTES).toString('base64url');
  return {
    plain,
    hash: createHash('sha256').update(plain).digest('hex'),
    prefix: plain.slice(0, PREFIX_SHOW_LEN),
  };
}

function hashToken(plain: string): string {
  return createHash('sha256').update(plain).digest('hex');
}

function isUniqueViolation(err: unknown, constraint?: string): boolean {
  const e = err as { code?: string; constraint?: string };
  if (e?.code !== '23505') return false;
  return constraint ? e.constraint === constraint : true;
}

/** 代理维度任务计数（列表一次带出，避免 N+1） */
async function countsOf(userId: number, ids: number[]): Promise<Map<number, AgentCounts>> {
  const map = new Map<number, AgentCounts>();
  if (ids.length === 0) return map;
  const res = await query<{ agent_id: number; running: number; pending: number }>(
    `SELECT agent_id,
            count(*) FILTER (WHERE agent_state = 'running')::int AS running,
            count(*) FILTER (WHERE agent_state = 'pending')::int AS pending
     FROM tasks
     WHERE user_id = $1 AND agent_id = ANY($2::int[])
     GROUP BY agent_id`,
    [userId, ids]
  );
  for (const row of res.rows) {
    map.set(row.agent_id, { running: Number(row.running), pending: Number(row.pending) });
  }
  return map;
}

async function getOwnedRow(userId: number, agentId: number): Promise<AgentRow> {
  const res = await query<AgentRow>(`SELECT * FROM agents WHERE id = $1 AND user_id = $2`, [
    agentId,
    userId,
  ]);
  if (res.rowCount === 0) throw AppError.notFound('代理不存在');
  return res.rows[0];
}

/** 指派前的任务校验：返回当前代理维度快照 */
async function loadAssignTarget(
  userId: number,
  taskId: number
): Promise<{
  id: number;
  status: string;
  agent_id: number | null;
  agent_state: string;
}> {
  const res = await query<{
    id: number;
    status: string;
    agent_id: number | null;
    agent_state: string;
  }>(`SELECT id, status, agent_id, agent_state FROM tasks WHERE id = $1 AND user_id = $2`, [
    taskId,
    userId,
  ]);
  if (res.rowCount === 0) throw AppError.notFound('任务不存在');
  return res.rows[0];
}

async function ensureAgentAssignable(
  client: PoolClient,
  userId: number,
  agentId: number
): Promise<{ id: number; name: string }> {
  const res = await client.query<{ id: number; name: string; status: string }>(
    `SELECT id, name, status FROM agents WHERE id = $1 AND user_id = $2`,
    [agentId, userId]
  );
  const row = res.rows[0];
  if (!row) throw AppError.notFound('代理不存在');
  if (row.status !== 'enabled') {
    throw AppError.agentTaskInvalidState('代理已停用，无法指派');
  }
  return { id: row.id, name: row.name };
}

async function ensureQueueCapacity(client: PoolClient, agentId: number): Promise<void> {
  const res = await client.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM tasks WHERE agent_id = $1 AND agent_state = 'pending'`,
    [agentId]
  );
  if (Number(res.rows[0]?.n ?? 0) >= config.agent.queueMax) {
    throw AppError.agentLimitExceeded('该代理待执行任务过多，请稍后再试或先处理队列');
  }
}

/**
 * 智能体代理领域服务（v0.7.0 领域唯一入口）：
 * REST 路由、MCP 工具、LLM 工具三条入口共用，业务规则只实现一次（SDD 2.1）。
 */
export const agentService = {
  /* ---------------- 代理生命周期 ---------------- */

  async list(userId: number): Promise<AgentDTO[]> {
    const res = await query<AgentRow>(
      `SELECT * FROM agents WHERE user_id = $1
       ORDER BY last_seen_at DESC NULLS LAST, id ASC`,
      [userId]
    );
    const counts = await countsOf(
      userId,
      res.rows.map((r) => r.id)
    );
    return res.rows.map((row) => toAgentDTO(row, counts.get(row.id) ?? { running: 0, pending: 0 }));
  },

  /** LLM 用：仅已启用代理 */
  async listEnabled(userId: number): Promise<AgentDTO[]> {
    const all = await this.list(userId);
    return all.filter((a) => a.status === 'enabled');
  },

  async get(userId: number, agentId: number): Promise<AgentDTO> {
    const row = await getOwnedRow(userId, agentId);
    const counts = await countsOf(userId, [agentId]);
    return toAgentDTO(row, counts.get(agentId) ?? { running: 0, pending: 0 });
  },

  async create(userId: number, input: CreateAgentInput): Promise<AgentWithToken> {
    const name = normalizeName(input.name);
    const kind = input.kind;
    const kindLabel = normalizeKind(kind, input.kind_label);
    const description = normalizeDescription(input.description);

    const countRes = await query<{ n: number }>(
      `SELECT count(*)::int AS n FROM agents WHERE user_id = $1`,
      [userId]
    );
    if (Number(countRes.rows[0]?.n ?? 0) >= config.agent.maxPerUser) {
      throw AppError.agentLimitExceeded(`最多创建 ${config.agent.maxPerUser} 个智能体代理`);
    }

    const token = generateToken();
    let row: AgentRow;
    try {
      const res = await query<AgentRow>(
        `INSERT INTO agents(user_id, name, kind, kind_label, description, token_hash, token_prefix)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
        [userId, name, kind, kindLabel, description, token.hash, token.prefix]
      );
      row = res.rows[0];
    } catch (err) {
      if (isUniqueViolation(err, 'uniq_agents_user_name')) {
        throw AppError.conflict('已存在同名代理');
      }
      throw err;
    }

    logger.info('agent_create', { user_id: userId, agent_id: row.id, kind });
    return {
      agent: toAgentDTO(row, { running: 0, pending: 0 }),
      token: token.plain,
      mcp: { endpoint: '/mcp', auth_header: 'Authorization: Bearer <token>' },
    };
  },

  async update(userId: number, agentId: number, patch: UpdateAgentInput): Promise<AgentDTO> {
    const existing = await getOwnedRow(userId, agentId);
    const sets: string[] = [];
    const params: unknown[] = [];
    let index = 1;

    if (patch.name !== undefined) {
      sets.push(`name = $${index++}`);
      params.push(normalizeName(patch.name));
    }
    if (patch.kind !== undefined) {
      sets.push(`kind = $${index++}`, `kind_label = $${index++}`);
      params.push(patch.kind, normalizeKind(patch.kind, patch.kind_label));
    } else if (patch.kind_label !== undefined && existing.kind === 'custom') {
      sets.push(`kind_label = $${index++}`);
      params.push(normalizeKind('custom', patch.kind_label));
    }
    if (patch.description !== undefined) {
      sets.push(`description = $${index++}`);
      params.push(normalizeDescription(patch.description));
    }
    if (patch.status !== undefined) {
      sets.push(`status = $${index++}`);
      params.push(patch.status);
    }
    if (sets.length === 0) {
      throw AppError.paramInvalid('没有需要更新的字段');
    }

    sets.push('updated_at = now()');
    params.push(agentId, userId);
    try {
      await query(
        `UPDATE agents SET ${sets.join(', ')} WHERE id = $${index++} AND user_id = $${index}`,
        params
      );
    } catch (err) {
      if (isUniqueViolation(err, 'uniq_agents_user_name')) {
        throw AppError.conflict('已存在同名代理');
      }
      throw err;
    }

    if (patch.status !== undefined && patch.status !== existing.status) {
      logger.info(patch.status === 'enabled' ? 'agent_enable' : 'agent_disable', {
        user_id: userId,
        agent_id: agentId,
      });
    }
    logger.info('agent_update', {
      user_id: userId,
      agent_id: agentId,
      fields: Object.keys(patch).join(','),
    });
    return this.get(userId, agentId);
  },

  async rotateToken(userId: number, agentId: number): Promise<AgentWithToken> {
    await getOwnedRow(userId, agentId);
    const token = generateToken();
    const res = await query<AgentRow>(
      `UPDATE agents SET token_hash = $1, token_prefix = $2, updated_at = now()
       WHERE id = $3 AND user_id = $4 RETURNING *`,
      [token.hash, token.prefix, agentId, userId]
    );
    logger.info('agent_token_rotate', { user_id: userId, agent_id: agentId });
    const counts = await countsOf(userId, [agentId]);
    return {
      agent: toAgentDTO(res.rows[0], counts.get(agentId) ?? { running: 0, pending: 0 }),
      token: token.plain,
      mcp: { endpoint: '/mcp', auth_header: 'Authorization: Bearer <token>' },
    };
  },

  /** 删除影响计数（端上二次确认文案） */
  async removeImpact(userId: number, agentId: number): Promise<{ pending: number; running: number }> {
    await getOwnedRow(userId, agentId);
    const counts = await countsOf(userId, [agentId]);
    const c = counts.get(agentId) ?? { running: 0, pending: 0 };
    return { pending: c.pending, running: c.running };
  },

  /**
   * 删除代理：显式迁移队列状态，再删除代理行（避免直接删行产生的悬空执行态）。
   * - pending 任务 → 未指派（清空 agent_*）+ unassigned 日志（含"代理已删除"）
   * - running 任务 → agent_id 置空、状态保留（语义「执行中（代理已删除）」）
   */
  async remove(
    userId: number,
    agentId: number
  ): Promise<{
    pending: number;
    running: number;
    unassigned_tasks: number[];
    kept_running_tasks: number[];
  }> {
    const agent = await getOwnedRow(userId, agentId);

    const result = await withTransaction(async (client: PoolClient) => {
      const pendingRes = await client.query<{ id: number }>(
        `UPDATE tasks
         SET agent_id = NULL, agent_state = 'none', agent_queued_at = NULL,
             agent_claimed_at = NULL, agent_finished_at = NULL, agent_result = NULL,
             updated_at = now()
         WHERE user_id = $1 AND agent_id = $2 AND agent_state = 'pending'
         RETURNING id`,
        [userId, agentId]
      );
      for (const row of pendingRes.rows) {
        await client.query(
          `INSERT INTO agent_task_logs(user_id, task_id, agent_id, agent_name, action, content)
           VALUES ($1, $2, NULL, $3, 'unassigned', $4)`,
          [userId, row.id, agent.name, '代理已删除']
        );
      }

      const runningRes = await client.query<{ id: number }>(
        `UPDATE tasks SET agent_id = NULL, updated_at = now()
         WHERE user_id = $1 AND agent_id = $2 AND agent_state = 'running'
         RETURNING id`,
        [userId, agentId]
      );

      await client.query(`DELETE FROM agents WHERE id = $1 AND user_id = $2`, [agentId, userId]);

      return {
        pending: pendingRes.rowCount ?? 0,
        running: runningRes.rowCount ?? 0,
        unassigned_tasks: pendingRes.rows.map((r) => r.id),
        kept_running_tasks: runningRes.rows.map((r) => r.id),
      };
    });

    logger.info('agent_delete', {
      user_id: userId,
      agent_id: agentId,
      pending: result.pending,
      running: result.running,
    });
    return result;
  },

  /* ---------------- 指派 / 取消 / 重试 ---------------- */

  /**
   * 指派即执行：同一事务内完成「写指派关系 + 入队 + 记录」，提交后唤醒等待者。
   * replace=true 时允许从 pending / 终态更换代理（running 必须先取消指派）。
   */
  async assign(
    userId: number,
    taskId: number,
    agentId: number,
    opts: { replace?: boolean; source?: 'manual' | 'chat' } = {}
  ): Promise<TaskDTO> {
    const task = await loadAssignTarget(userId, taskId);
    if (task.status === 'completed') {
      throw AppError.agentTaskInvalidState('任务已完成，如需执行请先取消完成');
    }
    if (task.agent_state !== 'none') {
      if (!opts.replace) {
        throw AppError.agentTaskInvalidState('该任务已指派代理，请先取消指派或选择更换代理');
      }
      if (task.agent_state === 'running') {
        throw AppError.agentTaskInvalidState('任务正在执行中，请先取消指派');
      }
    }

    await withTransaction(async (client) => {
      const agent = await ensureAgentAssignable(client, userId, agentId);
      await ensureQueueCapacity(client, agentId);

      if (task.agent_state !== 'none') {
        // 更换代理：旧指派先出队并留痕
        const prev = await client.query<{ agent_name: string | null }>(
          `SELECT a.name AS agent_name FROM tasks t
           LEFT JOIN agents a ON a.id = t.agent_id
           WHERE t.id = $1 AND t.user_id = $2`,
          [taskId, userId]
        );
        await client.query(
          `INSERT INTO agent_task_logs(user_id, task_id, agent_id, agent_name, action, content)
           VALUES ($1, $2, NULL, $3, 'unassigned', $4)`,
          [userId, taskId, prev.rows[0]?.agent_name ?? null, '更换代理']
        );
      }

      const updated = await client.query<{ id: number }>(
        `UPDATE tasks
         SET agent_id = $3, agent_state = 'pending', agent_queued_at = now(),
             agent_claimed_at = NULL, agent_finished_at = NULL, agent_result = NULL,
             updated_at = now()
         WHERE id = $1 AND user_id = $2 AND status = 'todo'
         RETURNING id`,
        [taskId, userId, agentId]
      );
      if (updated.rowCount === 0) {
        throw AppError.agentTaskInvalidState('当前状态不支持指派');
      }
      await client.query(
        `INSERT INTO agent_task_logs(user_id, task_id, agent_id, agent_name, action, content)
         VALUES ($1, $2, $3, $4, 'assigned', $5)`,
        [userId, taskId, agentId, agent.name, opts.source === 'chat' ? '对话指派' : null]
      );
    });

    // 提交后唤醒等待者（失败仅影响实时性，2s 兜底轮询仍可捞到）
    const woken = notifyAgent(agentId);
    logger.info('agent_task_assign', {
      user_id: userId,
      task_id: taskId,
      agent_id: agentId,
      source: opts.source ?? 'manual',
    });
    logger.info('agent_task_auto_dispatch', { agent_id: agentId, task_id: taskId, woken });
    return taskService.get(userId, taskId);
  },

  /** 取消指派（running 需 confirm=true） */
  async unassign(userId: number, taskId: number, opts: { confirm?: boolean } = {}): Promise<TaskDTO> {
    const task = await loadAssignTarget(userId, taskId);
    if (task.agent_state === 'none') {
      throw AppError.agentTaskInvalidState('该任务未指派代理');
    }
    if (task.agent_state === 'running' && opts.confirm !== true) {
      throw AppError.agentTaskInvalidState('代理可能仍在执行', { need_confirm: true });
    }

    await withTransaction(async (client) => {
      const prev = await client.query<{ agent_id: number | null; agent_name: string | null }>(
        `SELECT t.agent_id, a.name AS agent_name FROM tasks t
         LEFT JOIN agents a ON a.id = t.agent_id
         WHERE t.id = $1 AND t.user_id = $2`,
        [taskId, userId]
      );
      const updated = await client.query<{ id: number }>(
        `UPDATE tasks
         SET agent_id = NULL, agent_state = 'none', agent_queued_at = NULL,
             agent_claimed_at = NULL, agent_finished_at = NULL, agent_result = NULL,
             updated_at = now()
         WHERE id = $1 AND user_id = $2 AND agent_state <> 'none'
         RETURNING id`,
        [taskId, userId]
      );
      if (updated.rowCount === 0) {
        throw AppError.agentTaskInvalidState('该任务未指派代理');
      }
      await client.query(
        `INSERT INTO agent_task_logs(user_id, task_id, agent_id, agent_name, action, content)
         VALUES ($1, $2, NULL, $3, 'unassigned', NULL)`,
        [userId, taskId, prev.rows[0]?.agent_name ?? null]
      );
    });

    logger.info('agent_task_unassign', { user_id: userId, task_id: taskId });
    return taskService.get(userId, taskId);
  },

  /** 重新执行：failed → pending（不自动重试，由用户显式触发） */
  async retry(userId: number, taskId: number): Promise<TaskDTO> {
    const task = await loadAssignTarget(userId, taskId);
    if (task.agent_state !== 'failed') {
      throw AppError.agentTaskInvalidState('当前不是失败状态，无需重新执行');
    }
    if (task.agent_id === null) {
      throw AppError.agentTaskInvalidState('代理已删除或已停用，请重新指派');
    }
    const agentId = task.agent_id;

    await withTransaction(async (client) => {
      const agent = await ensureAgentAssignable(client, userId, agentId);
      await ensureQueueCapacity(client, agentId);
      const updated = await client.query<{ id: number }>(
        `UPDATE tasks
         SET agent_state = 'pending', agent_queued_at = now(), agent_claimed_at = NULL,
             agent_finished_at = NULL, agent_result = NULL, updated_at = now()
         WHERE id = $1 AND user_id = $2 AND agent_state = 'failed'
         RETURNING id`,
        [taskId, userId]
      );
      if (updated.rowCount === 0) {
        throw AppError.agentTaskInvalidState('当前不是失败状态，无需重新执行');
      }
      await client.query(
        `INSERT INTO agent_task_logs(user_id, task_id, agent_id, agent_name, action, content)
         VALUES ($1, $2, $3, $4, 'retried', NULL)`,
        [userId, taskId, agentId, agent.name]
      );
    });

    const woken = notifyAgent(agentId);
    logger.info('agent_task_retry', { user_id: userId, task_id: taskId, agent_id: agentId });
    logger.info('agent_task_auto_dispatch', { agent_id: agentId, task_id: taskId, woken });
    return taskService.get(userId, taskId);
  },

  /** 执行记录（时间线，倒序分页） */
  async listLogs(
    userId: number,
    taskId: number,
    page = 1,
    pageSize = 20
  ): Promise<{ list: AgentLogDTO[]; total: number; page: number; page_size: number }> {
    await taskService.getOwned(userId, taskId);
    const safePage = page > 0 ? page : 1;
    const safeSize = pageSize > 0 ? Math.min(pageSize, 100) : 20;
    const countRes = await query<{ total: string }>(
      `SELECT COUNT(*)::int AS total FROM agent_task_logs WHERE user_id = $1 AND task_id = $2`,
      [userId, taskId]
    );
    const res = await query<AgentLogRow>(
      `SELECT * FROM agent_task_logs
       WHERE user_id = $1 AND task_id = $2
       ORDER BY created_at DESC, id DESC
       LIMIT $3 OFFSET $4`,
      [userId, taskId, safeSize, (safePage - 1) * safeSize]
    );
    return {
      list: res.rows.map(toAgentLogDTO),
      total: Number(countRes.rows[0]?.total ?? 0),
      page: safePage,
      page_size: safeSize,
    };
  },

  /* ---------------- 凭据（中间件调用） ---------------- */

  /** 凭据解析：命中且启用才返回归属（不返回任何凭据信息） */
  async resolveByToken(
    plainToken: string
  ): Promise<{ agentId: number; userId: number; lastSeenAt: Date | null } | null> {
    const res = await query<{ id: number; user_id: number; status: string; last_seen_at: Date | null }>(
      `SELECT id, user_id, status, last_seen_at FROM agents WHERE token_hash = $1`,
      [hashToken(plainToken)]
    );
    const row = res.rows[0];
    if (!row || row.status !== 'enabled') return null;
    return { agentId: row.id, userId: row.user_id, lastSeenAt: row.last_seen_at };
  },

  /** 最近活跃写入（节流：距上次写入 < 60s 跳过）。首次写入上报首连事件 */
  async touchLastSeen(agentId: number, lastSeenAt: Date | null): Promise<void> {
    const now = Date.now();
    const last = lastSeenWriteAt.get(agentId) ?? 0;
    const lastSeenMs = lastSeenAt ? lastSeenAt.getTime() : 0;
    if (now - last < LAST_SEEN_THROTTLE_SEC * 1000) return;
    if (lastSeenMs && now - lastSeenMs < LAST_SEEN_THROTTLE_SEC * 1000) return;
    lastSeenWriteAt.set(agentId, now);
    try {
      await query(`UPDATE agents SET last_seen_at = now() WHERE id = $1`, [agentId]);
      if (!lastSeenMs) {
        logger.info('agent_connect_first', { agent_id: agentId });
      }
    } catch (err) {
      logger.warn('agent_last_seen_write_failed', {
        agent_id: agentId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  },

  /* ---------------- 代理侧能力（MCP 工具转发，领域唯一入口） ---------------- */

  /**
   * 队首可领取任务（长轮询命中判定与立即返回用）。
   * 该方法被 waiter 高频调用，不在内部重复校验代理状态（agentAuth 已在请求入口校验）。
   */
  claimableHead(agentId: number): Promise<AgentTaskBrief | null> {
    return agentExecution.claimableHead(agentId);
  },

  countPending(agentId: number): Promise<number> {
    return agentExecution.countPending(agentId);
  },

  listTasksForAgent(agentId: number, state: AgentState | undefined, limit: number) {
    return agentExecution.listTasksForAgent(agentId, state, limit);
  },

  getTaskForAgent(agentId: number, taskId: number) {
    return agentExecution.getTaskForAgent(agentId, taskId);
  },

  claim(agentId: number, taskId?: number) {
    return agentExecution.claim(agentId, taskId);
  },

  reportProgress(agentId: number, taskId: number, message: string) {
    return agentExecution.reportProgress(agentId, taskId, message);
  },

  complete(agentId: number, taskId: number, result: string) {
    return agentExecution.complete(agentId, taskId, result);
  },

  fail(agentId: number, taskId: number, reason: string) {
    return agentExecution.fail(agentId, taskId, reason);
  },

  listHistory(agentId: number, limit: number) {
    return agentExecution.listHistory(agentId, limit);
  },

  recentLogsForAgent(agentId: number, taskId: number, limit = 10) {
    return agentExecution.recentLogs(agentId, taskId, limit);
  },
};

/** last_seen_at 节流表（进程内；重启即清空，最多多写一次） */
const lastSeenWriteAt = new Map<number, number>();
