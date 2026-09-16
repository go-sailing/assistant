export type LlmRole = 'system' | 'user' | 'assistant' | 'tool';

export interface LlmToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

export interface LlmMessage {
  role: LlmRole;
  content: string | null;
  tool_calls?: LlmToolCall[];
  tool_call_id?: string;
}

export interface LlmTool {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export interface LlmStreamHandlers {
  onTextDelta?: (delta: string) => void | Promise<void>;
}

export interface LlmCompletionResult {
  content: string;
  toolCalls: LlmToolCall[];
  finishReason?: string;
}

/** LLM 调用异常，区分「可重试」与「不可重试」 */
export class LlmError extends Error {
  readonly retryable: boolean;

  constructor(message: string, retryable: boolean) {
    super(message);
    this.retryable = retryable;
  }
}