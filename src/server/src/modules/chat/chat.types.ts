import type { EventConflictBrief, EventDTO, OccurrenceDTO, SeriesDTO } from '../event/types';
import type { ConflictDateGroup, EventScope } from '../event/recurrence/types';

/**
 * 助手消息的结构化内容块，历史回看与实时流式复用同一套渲染模型。
 *
 * v0.8.0：任务 / 项目 / 代理能力下线，对象类内容块只剩日程（events / series / occurrences）。
 * 历史消息中残留的 tasks / subtask_groups / clarify.candidates / confirm.affected 字段
 * 不再刷新，由渲染层统一走「该能力已下线」灰态占位（SDD 8.4）。
 */
export type MessageBlock =
  | { type: 'text'; text: string }
  | {
      type: 'cards';
      /** 唯一对象类：日程卡片 */
      events?: EventDTO[];
      /** v0.2.0：循环系列卡片（每系列一条） */
      series?: SeriesDTO[];
      /** v0.2.0：循环实例卡片 */
      occurrences?: OccurrenceDTO[];
    }
  | {
      type: 'conflict';
      /** 触发冲突的工具名，便于客户端提示 */
      tool: string;
      conflicts: EventConflictBrief[];
      conflict_level: string;
      message?: string;
      /** v0.2.0：循环冲突按日期分组（scope=series） */
      conflict_dates?: ConflictDateGroup[];
      conflict_dates_total?: number;
      conflict_total?: number;
    }
  | {
      type: 'clarify';
      question: string;
      /** 候选日程（v0.1.0） */
      events?: EventDTO[];
      intent?: string;
    }
  | {
      /** v0.2.0：循环作用域澄清块（点选后作为结构化消息回传） */
      type: 'scope';
      tool: 'update_event' | 'delete_event';
      question: string;
      options: EventScope[];
      ref: { series_id: number; occurrence_key?: string | null };
      recommended: EventScope;
    }
  | {
      type: 'confirm';
      pending_action_id: string;
      action: string;
      /** 日程类危险操作的影响对象 */
      affected_events?: EventDTO[];
      count: number;
      description: string;
    }
  | { type: 'error'; message: string; retryable: boolean }
  | {
      /**
       * v0.4.0：助手方案卡（PRD 8.3）。
       *
       * 方案是**对话层概念**：present_proposal 工具无任何副作用、不落 pending；
       * 用户点「就这么办」后，模型按方案参数重新调用真实工具，届时照常经过
       * 冲突/危险/作用域等全部服务端门控（危险操作因此形成双层确认）。
       * status 由前端本地维护（服务端不持久化状态机），历史回看一律按只读摘要渲染。
       */
      type: 'proposal';
      proposal_id: string;
      /** 动作名，如「创建日程」「修改日程」 */
      title: string;
      /** 参数行：label + value，defaulted=true 表示这是助手替用户补的默认值 */
      params: Array<{ label: string; value: string; defaulted?: boolean }>;
      /** 默认项集中说明（让用户一眼知道改什么） */
      note?: string;
    };

export interface MessagePayload {
  blocks: MessageBlock[];
}

export interface MessageRow {
  id: number;
  conversation_id: number;
  role: string;
  content: string | null;
  payload: MessagePayload | null;
  client_msg_id: string | null;
  created_at: Date;
}

export interface MessageDTO {
  id: number;
  role: 'user' | 'assistant';
  content: string;
  payload: MessagePayload | null;
  created_at: string;
}

export interface ConversationRow {
  id: number;
  user_id: number;
  title: string;
  /** v0.5.0：滚动摘要全文（仅服务端使用，不下发端上） */
  context_summary: string | null;
  /** v0.5.0：已压缩段的最大消息 id（水位指针） */
  compacted_until_id: string | number | null;
  created_at: Date;
  updated_at: Date;
}

export interface ConversationDTO {
  id: number;
  title: string;
  /** v0.5.0：摘要水位（前端据此渲染历史分界条；摘要正文不外泄） */
  compacted_until_id: number | null;
  created_at: string;
  updated_at: string;
}

export interface PendingActionRow {
  id: string;
  conversation_id: number;
  user_id: number;
  tool_name: string;
  params: Record<string, unknown>;
  /** 预取的影响对象快照：v0.8.0 只剩日程（affected 列为通用 JSONB，键保留 events） */
  affected: { events?: EventDTO[] } | null;
  status: string;
  expires_at: Date;
  created_at: Date;
}

export function toMessageDTO(row: MessageRow): MessageDTO {
  return {
    id: row.id,
    role: row.role === 'user' ? 'user' : 'assistant',
    content: row.content ?? '',
    payload: row.payload,
    created_at: row.created_at.toISOString(),
  };
}

export function toConversationDTO(row: ConversationRow): ConversationDTO {
  return {
    id: row.id,
    title: row.title,
    // 水位是 bigint：pg 以字符串返回，统一转 number（摘要正文绝不下发）
    compacted_until_id: row.compacted_until_id != null ? Number(row.compacted_until_id) : null,
    created_at: row.created_at.toISOString(),
    updated_at: row.updated_at.toISOString(),
  };
}
