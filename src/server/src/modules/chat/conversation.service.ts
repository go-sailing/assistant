import { randomUUID } from 'crypto';
import { query } from '../../db/pool';
import { AppError } from '../../common/errors';
import { config } from '../../config';
import type { TaskDTO } from '../task/types';
import { taskService } from '../task/task.service';
import { toSeriesDTO, type EventDTO, type EventRow, type OccurrenceDTO, type SeriesDTO } from '../event/types';
import { eventService } from '../event/event.service';
import { occurrenceService } from '../event/occurrence.service';
import type { EventOverrideRow } from '../event/recurrence/types';
import type { LlmMessage } from '../../llm/types';
import {
  toConversationDTO,
  toMessageDTO,
  type ConversationDTO,
  type ConversationRow,
  type MessageBlock,
  type MessageDTO,
  type MessagePayload,
  type MessageRow,
  type PendingActionRow,
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
  const groupRootIds = new Set<number>();

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
        (block.subtask_groups ?? []).forEach((g) => {
          taskIdSet.add(Number(g.root_task_id));
          groupRootIds.add(Number(g.root_task_id));
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
  if (taskIdSet.size === 0 && eventIdSet.size === 0 && seriesIdSet.size === 0) return;

  const tz = eventService.defaultTz();
  const [latestTasks, latestEvents, latestSeries] = await Promise.all([
    taskIdSet.size ? taskService.getManyByIds(userId, [...taskIdSet]) : Promise.resolve(new Map()),
    eventIdSet.size ? eventService.getManyByIds(userId, [...eventIdSet]) : Promise.resolve(new Map()),
    seriesIdSet.size
      ? eventService.getManySeriesByIds(userId, [...seriesIdSet])
      : Promise.resolve({ rows: new Map(), overrides: new Map() }),
  ]);

  /**
   * 子任务组按 root 重新拉取整棵子树：他端新增/删除子任务后重开会话要能看到最新结构
   * （只刷新已有节点的字段会漏掉新增节点）。拉取失败（如超节点上限）时退回字段刷新。
   */
  const freshSubtrees = new Map<number, TaskDTO[]>();
  for (const rootId of groupRootIds) {
    if (!latestTasks.has(rootId)) continue;
    try {
      freshSubtrees.set(rootId, await taskService.getSubtree(userId, rootId));
    } catch {
      // 保持快照，交给字段级刷新
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
        block.subtask_groups = (block.subtask_groups ?? []).map((g) => {
          // 根任务被删 → 整组渲染「该任务已删除」占位（TC-CHAT-111）
          const rootAlive = latestTasks.has(Number(g.root_task_id));
          return {
            ...g,
            nodes: rootAlive
              ? freshSubtrees.get(Number(g.root_task_id)) ?? applyTasks(g.nodes)
              : applyTasks(g.nodes),
            missing: !rootAlive,
            missing_reason: rootAlive ? undefined : ('deleted' as const),
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

  async create(userId: number, title = '新对话'): Promise<ConversationDTO> {
    const res = await query<ConversationRow>(
      `INSERT INTO conversations(user_id, title) VALUES ($1, $2) RETURNING *`,
      [userId, title.slice(0, 100)]
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

  async rename(userId: number, conversationId: number, title: string): Promise<ConversationDTO> {
    await this.getOwned(userId, conversationId);
    const trimmed = (title ?? '').trim();
    if (!trimmed) throw AppError.paramInvalid('会话标题不能为空');
    const res = await query<ConversationRow>(
      `UPDATE conversations SET title = $1, updated_at = now() WHERE id = $2 RETURNING *`,
      [trimmed.slice(0, 100), conversationId]
    );
    return toConversationDTO(res.rows[0]);
  },

  async remove(userId: number, conversationId: number): Promise<void> {
    const res = await query(`DELETE FROM conversations WHERE id = $1 AND user_id = $2`, [
      conversationId,
      userId,
    ]);
    if (res.rowCount === 0) throw AppError.notFound('会话不存在');
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

  /**
   * 组装发给模型的对话历史。
   * 不回放历史工具调用（避免与当前数据状态不一致），但会把历史消息中涉及的任务 ID
   * 以紧凑文本附在助手消息后，使「把它改成高优先级」这类指代能在多轮中解析到真实 ID。
   */
  async buildHistory(conversationId: number): Promise<LlmMessage[]> {
    const res = await query<MessageRow>(
      `SELECT * FROM messages WHERE conversation_id = $1 ORDER BY id DESC LIMIT $2`,
      [conversationId, config.chat.historyLimit]
    );
    const rows = res.rows.reverse();
    const messages: LlmMessage[] = [];
    for (const row of rows) {
      if (row.role === 'user') {
        messages.push({ role: 'user', content: row.content ?? '' });
        continue;
      }
      if (row.role !== 'assistant') continue;

      const blocks = row.payload?.blocks ?? [];
      const text = blocks
        .filter((b): b is Extract<MessageBlock, { type: 'text' }> => b.type === 'text')
        .map((b) => b.text)
        .join('\n')
        .trim();

      const referenced: TaskDTO[] = [];
      const referencedEvents: EventDTO[] = [];
      const referencedSeries: SeriesDTO[] = [];
      const referencedOccurrences: OccurrenceDTO[] = [];
      const referencedScopes: Array<{ tool: string; seriesId: number; occurrenceKey: string | null }> = [];
      for (const block of blocks) {
        if (block.type === 'cards') {
          referenced.push(...block.tasks);
          referencedEvents.push(...(block.events ?? []));
          referencedSeries.push(...(block.series ?? []));
          referencedOccurrences.push(...(block.occurrences ?? []));
          for (const group of block.subtask_groups ?? []) referenced.push(...group.nodes);
        } else if (block.type === 'clarify') {
          referenced.push(...block.candidates);
          referencedEvents.push(...(block.events ?? []));
        } else if (block.type === 'confirm') {
          referenced.push(...block.affected);
          referencedEvents.push(...(block.affected_events ?? []));
        } else if (block.type === 'scope') {
          // 作用域澄清未选择时，下一轮必须还能定位到同一系列/实例（TC-CHAT-108）
          referencedScopes.push({
            tool: block.tool,
            seriesId: block.ref.series_id,
            occurrenceKey: block.ref.occurrence_key ?? null,
          });
        }
      }
      const taskHint = referenced.length
        ? `\n[本轮涉及的任务] ${referenced
            .map(
              (t) =>
                `#${t.id} ${t.title}（${t.status === 'completed' ? '已完成' : '待办'}${
                  t.parent_id ? `，父任务 #${t.parent_id}` : ''
                }）`
            )
            .join('；')}`
        : '';
      // 把日程 ID 一并喂给模型，使「把它改到下午4点」这类指代能在多轮中解析到真实 event_id
      const eventHint = referencedEvents.length
        ? `\n[本轮涉及的日程] ${referencedEvents
            .map(
              (e) =>
                `#${e.id} ${e.title}（${e.event_type === 'task' ? '任务日程' : '普通日程'} ${e.start_at}~${e.end_at}）`
            )
            .join('；')}`
        : '';
      // v0.2.0：系列与实例身份必须回灌，否则模型无法正确传 occurrence_key
      const seriesHint = referencedSeries.length
        ? `\n[本轮涉及的循环日程] ${referencedSeries
            .map(
              (s) =>
                `series#${s.id} ${s.title}（${s.recurrence_summary}，下一次 ${s.next_occurrence ?? '已无'}，共 ${s.total_count} 次）`
            )
            .join('；')}`
        : '';
      const occurrenceHint = referencedOccurrences.length
        ? `\n[本轮涉及的循环实例] ${referencedOccurrences
            .map(
              (o) =>
                `series#${o.series_id} occurrence_key=${o.occurrence_key} ${o.title}（${o.start_at}~${o.end_at}${
                  o.override_state === 'modified'
                    ? '，已调整'
                    : o.override_state === 'cancelled'
                      ? '，已取消'
                      : ''
                }）`
            )
            .join('；')}`
        : '';

      const scopeHint = referencedScopes.length
        ? `\n[待用户确认的作用域] ${referencedScopes
            .map(
              (s) =>
                `${s.tool} series#${s.seriesId}${s.occurrenceKey ? ` occurrence_key=${s.occurrenceKey}` : ''}（用户还没选作用域，继续沿用这条上下文，不要换成别的日程）`
            )
            .join('；')}`
        : '';

      const content = `${text}${taskHint}${eventHint}${seriesHint}${occurrenceHint}${scopeHint}`.trim();
      if (content) messages.push({ role: 'assistant', content });
    }
    return messages;
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

  async getOwned(userId: number, conversationId: number, id: string): Promise<PendingActionRow> {
    const res = await query<PendingActionRow>(
      `SELECT * FROM pending_actions WHERE id = $1 AND user_id = $2 AND conversation_id = $3`,
      [id, userId, conversationId]
    );
    if (res.rowCount === 0) throw AppError.notFound('待确认操作不存在');
    return res.rows[0];
  },

  /**
   * 取出可执行的待确认动作：必须是 pending 且未过期。
   * 过期时顺手标记为 expired。
   */
  async takeExecutable(userId: number, conversationId: number, id: string): Promise<PendingActionRow> {
    const action = await this.getOwned(userId, conversationId, id);
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