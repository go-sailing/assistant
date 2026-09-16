import { randomUUID } from 'crypto';
import { query } from '../../db/pool';
import { AppError } from '../../common/errors';
import { config } from '../../config';
import type { TaskDTO } from '../task/types';
import { taskService } from '../task/task.service';
import type { EventDTO } from '../event/types';
import { eventService } from '../event/event.service';
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
 */
async function refreshBlocksWithLatest(userId: number, messages: MessageDTO[]): Promise<void> {
  const taskIdSet = new Set<number>();
  const eventIdSet = new Set<number>();
  for (const msg of messages) {
    for (const block of msg.payload?.blocks ?? []) {
      if (block.type === 'cards') {
        block.tasks.forEach((t) => taskIdSet.add(t.id));
        (block.events ?? []).forEach((e) => eventIdSet.add(e.id));
      } else if (block.type === 'clarify') {
        block.candidates.forEach((t) => taskIdSet.add(t.id));
        (block.events ?? []).forEach((e) => eventIdSet.add(e.id));
      } else if (block.type === 'confirm') {
        block.affected.forEach((t) => taskIdSet.add(t.id));
        (block.affected_events ?? []).forEach((e) => eventIdSet.add(e.id));
      }
    }
  }
  if (taskIdSet.size === 0 && eventIdSet.size === 0) return;

  const [latestTasks, latestEvents] = await Promise.all([
    taskIdSet.size ? taskService.getManyByIds(userId, [...taskIdSet]) : Promise.resolve(new Map()),
    eventIdSet.size ? eventService.getManyByIds(userId, [...eventIdSet]) : Promise.resolve(new Map()),
  ]);

  const applyTasks = (tasks: TaskDTO[]): TaskDTO[] => tasks.map((t) => latestTasks.get(t.id) ?? t);
  // 日程被删除时标记 missing，交由客户端渲染"该日程已删除"占位（不要展示陈旧快照）
  const applyEvents = (events: EventDTO[] | undefined): EventDTO[] | undefined =>
    events ? events.map((e) => latestEvents.get(e.id) ?? { ...e, missing: true }) : events;

  for (const msg of messages) {
    for (const block of msg.payload?.blocks ?? []) {
      if (block.type === 'cards') {
        block.tasks = applyTasks(block.tasks);
        block.events = applyEvents(block.events);
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
      for (const block of blocks) {
        if (block.type === 'cards') {
          referenced.push(...block.tasks);
          referencedEvents.push(...(block.events ?? []));
        } else if (block.type === 'clarify') {
          referenced.push(...block.candidates);
          referencedEvents.push(...(block.events ?? []));
        } else if (block.type === 'confirm') {
          referenced.push(...block.affected);
          referencedEvents.push(...(block.affected_events ?? []));
        }
      }
      const taskHint = referenced.length
        ? `\n[本轮涉及的任务] ${referenced
            .map((t) => `#${t.id} ${t.title}（${t.status === 'completed' ? '已完成' : '待办'}）`)
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

      const content = `${text}${taskHint}${eventHint}`.trim();
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