import { randomUUID } from 'crypto';
import { query, withTransaction } from '../../db/pool';
import { AppError } from '../../common/errors';
import { logger } from '../../common/logger';
import { config } from '../../config';
import type { TaskDTO } from '../task/types';
import { taskService } from '../task/task.service';
import { projectService } from '../project/project.service';
import { toSeriesDTO, type EventDTO, type EventRow, type OccurrenceDTO, type SeriesDTO } from '../event/types';
import { eventService } from '../event/event.service';
import { occurrenceService } from '../event/occurrence.service';
import type { EventOverrideRow } from '../event/recurrence/types';
import {
  toConversationDTO,
  toMessageDTO,
  type ConversationDTO,
  type ConversationRow,
  type MessageDTO,
  type MessagePayload,
  type MessageRow,
  type PendingActionRow,
  type ProjectGroup,
} from './chat.types';

const TITLE_MAX = 30;

function deriveTitle(content: string): string {
  const trimmed = content.trim().replace(/\s+/g, ' ');
  if (!trimmed) return '新对话';
  return trimmed.length > TITLE_MAX ? `${trimmed.slice(0, TITLE_MAX)}…` : trimmed;
}

/**
 * 历史消息里的任务/日程卡片落库时是快照。为了让「再次打开会话时卡片显示最新状态」
 * （PRD 8.2-5 / UX 7.1），读取历史时用云端最新数据覆盖快照。
 * 已被删除的对象保留原快照，以便用户仍能看到当时的操作对象。
 *
 * v0.2.0 扩展：循环系列卡片按 series_id 回查主记录；实例卡片用 occurrence_key
 * 在当前规则下重新物化（规则变更导致该次不再发生时渲染"已不再发生"占位）。
 */
async function refreshBlocksWithLatest(userId: number, messages: MessageDTO[]): Promise<void> {
  const taskIdSet = new Set<number>();
  const eventIdSet = new Set<number>();
  const seriesIdSet = new Set<number>();
  const projectIdSet = new Set<number>();

  const collectEvents = (events?: EventDTO[]) => {
    for (const e of events ?? []) {
      // 实例卡片的 id 就是系列 id，需要按 series+key 重算而不是按 id 取单条
      if ('occurrence_key' in e) {
        seriesIdSet.add((e as OccurrenceDTO).series_id);
      } else {
        eventIdSet.add(Number(e.id));
      }
    }
  };

  for (const msg of messages) {
    for (const block of msg.payload?.blocks ?? []) {
      if (block.type === 'cards') {
        block.tasks.forEach((t) => taskIdSet.add(Number(t.id)));
        (block.project_groups ?? []).forEach((g) => {
          projectIdSet.add(Number(g.project_id));
          g.nodes.forEach((n) => taskIdSet.add(Number(n.id)));
        });
        collectEvents(block.events);
        (block.occurrences ?? []).forEach((o) => seriesIdSet.add(o.series_id));
        (block.series ?? []).forEach((s) => seriesIdSet.add(Number(s.id)));
      } else if (block.type === 'clarify') {
        block.candidates.forEach((t) => taskIdSet.add(Number(t.id)));
        collectEvents(block.events);
      } else if (block.type === 'confirm') {
        block.affected.forEach((t) => taskIdSet.add(Number(t.id)));
        collectEvents(block.affected_events);
      }
    }
  }
  if (
    taskIdSet.size === 0 &&
    eventIdSet.size === 0 &&
    seriesIdSet.size === 0 &&
    projectIdSet.size === 0
  ) {
    return;
  }

  const tz = eventService.defaultTz();
  const [latestTasks, latestEvents, latestSeries] = await Promise.all([
    taskIdSet.size ? taskService.getManyByIds(userId, [...taskIdSet]) : Promise.resolve(new Map()),
    eventIdSet.size ? eventService.getManyByIds(userId, [...eventIdSet]) : Promise.resolve(new Map()),
    seriesIdSet.size
      ? eventService.getManySeriesByIds(userId, [...seriesIdSet])
      : Promise.resolve({ rows: new Map(), overrides: new Map() }),
  ]);

  /**
   * v0.8.0 项目结果组按项目重新拉取：他端新增/删除成员后重开会话要能看到最新结构
   * 与最新进度（只刷新已有节点的字段会漏掉新增节点）。项目已删除时保持快照并标 missing。
   */
  const freshProjects = new Map<number, ProjectGroup>();
  for (const projectId of projectIdSet) {
    try {
      const project = await projectService.get(userId, projectId);
      const { list: members } = await projectService.listMembers(userId, projectId, {});
      freshProjects.set(projectId, {
        project_id: project.id,
        name: project.name,
        member_total: project.member_total,
        member_completed: project.member_completed,
        nodes: members,
      });
    } catch {
      // 项目已删除/越权：保持快照，交给下面的 missing 占位
    }
  }

  const applyTasks = (tasks: TaskDTO[]): TaskDTO[] => tasks.map((t) => latestTasks.get(Number(t.id)) ?? t);
  // 日程被删除时标记 missing，交由客户端渲染"该日程已删除"占位（不要展示陈旧快照）
  const applyEvents = (events: EventDTO[] | undefined): EventDTO[] | undefined =>
    events
      ? events.map((e) => {
          if ('occurrence_key' in e) return refreshOccurrence(e as OccurrenceDTO, latestSeries, tz);
          return latestEvents.get(Number(e.id)) ?? { ...e, missing: true, missing_reason: 'deleted' };
        })
      : events;
  const applySeries = (series: SeriesDTO[] | undefined): SeriesDTO[] | undefined =>
    series
      ? series.map((s) => {
          const row = latestSeries.rows.get(Number(s.id));
          return row ? toSeriesDTO(row, tz) : { ...s, missing: true, missing_reason: 'deleted' };
        })
      : series;

  for (const msg of messages) {
    for (const block of msg.payload?.blocks ?? []) {
      if (block.type === 'cards') {
        block.tasks = applyTasks(block.tasks);
        block.events = applyEvents(block.events);
        block.series = applySeries(block.series);
        block.occurrences = (block.occurrences ?? []).map((o) =>
          refreshOccurrence(o, latestSeries, tz)
        );
        block.project_groups = (block.project_groups ?? []).map((g) => {
          // 项目被删 → 整组渲染「该项目已删除」占位（TC-CHAT-111）
          const fresh = freshProjects.get(Number(g.project_id));
          if (fresh) return fresh;
          return {
            ...g,
            nodes: applyTasks(g.nodes),
            missing: true,
            missing_reason: 'deleted' as const,
          };
        });
      } else if (block.type === 'clarify') {
        block.candidates = applyTasks(block.candidates);
        block.events = applyEvents(block.events);
      } else if (block.type === 'confirm') {
        block.affected = applyTasks(block.affected);
        block.affected_events = applyEvents(block.affected_events);
      }
    }
  }
}

/** 用当前规则重算一次实例的最新状态；系列已删或该次已不再发生时给出占位 */
function refreshOccurrence(
  occurrence: OccurrenceDTO,
  latestSeries: {
    rows: Map<number, EventRow>;
    overrides: Map<number, Map<string, EventOverrideRow>>;
  },
  tz: string
): OccurrenceDTO {
  const row = latestSeries.rows.get(occurrence.series_id);
  if (!row) {
    return { ...occurrence, missing: true, missing_reason: 'deleted' };
  }
  const fresh = occurrenceService.materializeSingle(
    row,
    latestSeries.overrides.get(occurrence.series_id) ?? new Map(),
    occurrence.occurrence_key,
    tz
  );
  if (!fresh) {
    // 规则变更/系列结束导致该次不再发生：保留标题但标记占位
    return {
      ...occurrence,
      missing: true,
      missing_reason: 'not_occurring',
      title: row.title ?? occurrence.title,
    };
  }
  return fresh;
}

export const conversationService = {
  async listByUser(userId: number): Promise<ConversationDTO[]> {
    const res = await query<ConversationRow>(
      `SELECT * FROM conversations WHERE user_id = $1 ORDER BY updated_at DESC LIMIT 100`,
      [userId]
    );
    return res.rows.map(toConversationDTO);
  },

  /**
   * v0.3.0：每用户唯一会话的幂等获取。
   * 单条 SQL 完成「有则返回、无则插入」，避免应用层 check-then-insert 的并发竞态；
   * DO UPDATE 为空更新（不改 updated_at），保证重复调用不把会话顶到最前。
   * 依赖迁移 006 的唯一索引 uniq_conversations_user。
   */
  async getOrCreate(userId: number): Promise<ConversationDTO> {
    const res = await query<ConversationRow>(
      `INSERT INTO conversations(user_id) VALUES ($1)
       ON CONFLICT (user_id) DO UPDATE SET updated_at = conversations.updated_at
       RETURNING *`,
      [userId]
    );
    return toConversationDTO(res.rows[0]);
  },

  async getOwned(userId: number, conversationId: number): Promise<ConversationRow> {
    const res = await query<ConversationRow>(
      `SELECT * FROM conversations WHERE id = $1 AND user_id = $2`,
      [conversationId, userId]
    );
    if (res.rowCount === 0) throw AppError.notFound('会话不存在');
    return res.rows[0];
  },

  /**
   * v0.3.0：清除聊天记录（会话本身保留）。
   * 单事务删除该会话全部消息与待确认动作，并重置标题；
   * v0.5.0：同时重置压缩摘要与水位（消息已清空，无旧内容可概括）；
   * 不触碰任何任务 / 日程 / 清单 / 长期记忆数据。
   */
  async clearHistory(
    userId: number,
    conversationId: number
  ): Promise<{ id: number; deleted_messages: number }> {
    await this.getOwned(userId, conversationId);
    const deleted = await withTransaction(async (client) => {
      const msg = await client.query(`DELETE FROM messages WHERE conversation_id = $1`, [
        conversationId,
      ]);
      await client.query(`DELETE FROM pending_actions WHERE conversation_id = $1`, [
        conversationId,
      ]);
      await client.query(
        `UPDATE conversations
         SET title = '新对话', updated_at = now(),
             context_summary = NULL, compacted_until_id = NULL
         WHERE id = $1`,
        [conversationId]
      );
      return msg.rowCount ?? 0;
    });
    logger.info('chat_history_cleared', {
      user_id: userId,
      conversation_id: conversationId,
      deleted_messages: deleted,
    });
    return { id: conversationId, deleted_messages: deleted };
  },

  /** 会话消息总数（归档空会话判定用） */
  async countMessages(conversationId: number): Promise<number> {
    const res = await query<{ total: string }>(
      `SELECT COUNT(*)::int AS total FROM messages WHERE conversation_id = $1`,
      [conversationId]
    );
    return Number(res.rows[0]?.total ?? 0);
  },

  /**
   * 最近 limit 条消息（ASC 返回），供归档转录使用。
   * 超长会话只取最近 N 条：更早内容已无长期价值，同时防止提取 token 失控。
   */
  async listRecentMessages(conversationId: number, limit: number): Promise<MessageRow[]> {
    const res = await query<MessageRow>(
      `SELECT * FROM messages WHERE conversation_id = $1 ORDER BY id DESC LIMIT $2`,
      [conversationId, limit]
    );
    return res.rows.reverse();
  },

  async touch(conversationId: number): Promise<void> {
    await query(`UPDATE conversations SET updated_at = now() WHERE id = $1`, [conversationId]);
  },

  /** 首条消息时用内容生成会话标题 */
  async maybeSetTitle(conversationId: number, title: string, currentTitle: string): Promise<void> {
    if (currentTitle !== '新对话') return;
    await query(`UPDATE conversations SET title = $1 WHERE id = $2`, [
      deriveTitle(title),
      conversationId,
    ]);
  },

  async appendMessage(params: {
    conversationId: number;
    role: 'user' | 'assistant';
    content: string;
    payload?: MessagePayload | null;
    clientMsgId?: string | null;
  }): Promise<MessageDTO> {
    const res = await query<MessageRow>(
      `INSERT INTO messages(conversation_id, role, content, payload, client_msg_id)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [
        params.conversationId,
        params.role,
        params.content,
        params.payload ? JSON.stringify(params.payload) : null,
        params.clientMsgId ?? null,
      ]
    );
    await this.touch(params.conversationId);
    return toMessageDTO(res.rows[0]);
  },

  /** 幂等查询：同一会话内相同 client_msg_id 的用户消息 */
  async findUserMessageByClientId(
    conversationId: number,
    clientMsgId: string
  ): Promise<MessageRow | null> {
    const res = await query<MessageRow>(
      `SELECT * FROM messages
       WHERE conversation_id = $1 AND client_msg_id = $2 AND role = 'user' LIMIT 1`,
      [conversationId, clientMsgId]
    );
    return res.rows[0] ?? null;
  },

  /** 取该用户消息之后的第一条助手消息（用于重放，保证重发不重复执行工具） */
  async findFollowingAssistantMessage(userMessageId: number): Promise<MessageRow | null> {
    const res = await query<MessageRow>(
      `SELECT * FROM messages
       WHERE id > $1 AND role = 'assistant'
       ORDER BY id ASC LIMIT 1`,
      [userMessageId]
    );
    return res.rows[0] ?? null;
  },

  async listMessages(
    userId: number,
    conversationId: number,
    page = 1,
    pageSize = 50
  ): Promise<{ list: MessageDTO[]; total: number; page: number; page_size: number }> {
    await this.getOwned(userId, conversationId);
    const size = Math.min(Math.max(pageSize, 1), 200);
    const countRes = await query<{ total: string }>(
      `SELECT COUNT(*)::int AS total FROM messages WHERE conversation_id = $1`,
      [conversationId]
    );
    const total = Number(countRes.rows[0]?.total ?? 0);
    const res = await query<MessageRow>(
      `SELECT * FROM messages WHERE conversation_id = $1
       ORDER BY id DESC LIMIT $2 OFFSET $3`,
      [conversationId, size, (page - 1) * size]
    );
    const list = res.rows.reverse().map(toMessageDTO);
    await refreshBlocksWithLatest(userId, list);
    return { list, total, page, page_size: size };
  },
};

export const pendingActionService = {
  async create(params: {
    conversationId: number;
    userId: number;
    toolName: string;
    resolvedParams: Record<string, unknown>;
    affected: TaskDTO[];
    affectedEvents?: EventDTO[];
  }): Promise<PendingActionRow> {
    // 过期时间在应用侧计算，避免 SQL 中的参数类型推断问题
    const expiresAt = new Date(Date.now() + config.pendingActionTtlSeconds * 1000);
    const snapshot = JSON.stringify({
      tasks: params.affected ?? [],
      events: params.affectedEvents ?? [],
    });
    const res = await query<PendingActionRow>(
      `INSERT INTO pending_actions(id, conversation_id, user_id, tool_name, params, affected, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [
        randomUUID(),
        params.conversationId,
        params.userId,
        params.toolName,
        JSON.stringify(params.resolvedParams),
        snapshot,
        expiresAt,
      ]
    );
    return res.rows[0];
  },

  /**
   * v0.3.0：取出「属于该用户会话」的待确认动作，用于确认/取消。
   * 与「按 id + 归属一起查」的差别在于错误语义：清除聊天记录会**物理删除** pending，
   * 此时该 id 已不存在 → 按 PRD 7.3 返回「该操作已失效」（pendingActionInvalid），
   * 而不是「不存在」。越权（他人 id / 他人会话）仍按不存在处理，不泄露存在性。
   */
  async resolveOwned(userId: number, conversationId: number, id: string): Promise<PendingActionRow> {
    const res = await query<PendingActionRow>(`SELECT * FROM pending_actions WHERE id = $1`, [id]);
    const row = res.rows[0];
    if (!row) throw AppError.pendingActionInvalid();
    if (row.user_id !== userId || row.conversation_id !== conversationId) {
      throw AppError.notFound('待确认操作不存在');
    }
    return row;
  },

  /**
   * 取出可执行的待确认动作：必须是 pending 且未过期。
   * 过期时顺手标记为 expired。
   */
  async takeExecutable(userId: number, conversationId: number, id: string): Promise<PendingActionRow> {
    const action = await this.resolveOwned(userId, conversationId, id);
    if (action.status !== 'pending') {
      throw AppError.pendingActionInvalid('该操作已被处理，请重新发起');
    }
    if (action.expires_at.getTime() <= Date.now()) {
      await this.markStatus(id, 'expired');
      throw AppError.pendingActionInvalid();
    }
    return action;
  },

  async markStatus(id: string, status: 'confirmed' | 'canceled' | 'expired'): Promise<void> {
    await query(`UPDATE pending_actions SET status = $1 WHERE id = $2`, [status, id]);
  },

  /** 作废该会话下所有未决动作（用户发新指令时调用） */
  async cancelPendingOfConversation(conversationId: number): Promise<void> {
    await query(
      `UPDATE pending_actions SET status = 'canceled'
       WHERE conversation_id = $1 AND status = 'pending'`,
      [conversationId]
    );
  },
};