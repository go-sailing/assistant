import type { SubtaskGroup, TaskDTO } from '../task/types';
import type { EventConflictBrief, EventDTO, OccurrenceDTO, SeriesDTO } from '../event/types';
import type { ConflictDateGroup, EventScope } from '../event/recurrence/types';

/** 助手消息的结构化内容块，历史回看与实时流式复用同一套渲染模型 */
export type MessageBlock =
  | { type: 'text'; text: string }
  | {
      type: 'cards';
      tasks: TaskDTO[];
      events?: EventDTO[];
      /** v0.2.0：循环系列卡片（每系列一条） */
      series?: SeriesDTO[];
      /** v0.2.0：循环实例卡片 */
      occurrences?: OccurrenceDTO[];
      /** v0.2.0：子任务组卡片（根任务 + 扁平节点） */
      subtask_groups?: SubtaskGroup[];
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
      /** task：候选任务；event：候选日程（v0.1.0） */
      kind?: 'task' | 'event';
      candidates: TaskDTO[];
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
      affected: TaskDTO[];
      /** 日程类危险操作的影响对象（v0.1.0） */
      affected_events?: EventDTO[];
      count: number;
      description: string;
    }
  | { type: 'error'; message: string; retryable: boolean };

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
  created_at: Date;
  updated_at: Date;
}

export interface ConversationDTO {
  id: number;
  title: string;
  created_at: string;
  updated_at: string;
}

export interface PendingActionRow {
  id: string;
  conversation_id: number;
  user_id: number;
  tool_name: string;
  params: Record<string, unknown>;
  /** 预取的影响对象快照：任务与日程分列（affected 列为通用 JSONB） */
  affected: { tasks?: TaskDTO[]; events?: EventDTO[] } | null;
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
    created_at: row.created_at.toISOString(),
    updated_at: row.updated_at.toISOString(),
  };
}