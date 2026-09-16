import type { TaskDTO } from '../task/types';

/** 助手消息的结构化内容块，历史回看与实时流式复用同一套渲染模型 */
export type MessageBlock =
  | { type: 'text'; text: string }
  | { type: 'cards'; tasks: TaskDTO[] }
  | { type: 'clarify'; question: string; candidates: TaskDTO[]; intent?: string }
  | {
      type: 'confirm';
      pending_action_id: string;
      action: string;
      affected: TaskDTO[];
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
  affected: TaskDTO[];
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