import { config } from '../config';
import { logger } from '../common/logger';
import { LlmError, type LlmCompletionResult, type LlmMessage, type LlmStreamHandlers, type LlmTool, type LlmToolCall } from './types';

interface RawToolCallDelta {
  index: number;
  id?: string;
  type?: string;
  function?: { name?: string; arguments?: string };
}

interface RawStreamChunk {
  choices?: Array<{
    delta?: { content?: string | null; tool_calls?: RawToolCallDelta[] };
    finish_reason?: string | null;
  }>;
  error?: { message?: string };
}

interface AccumulatedToolCall {
  id: string;
  name: string;
  arguments: string;
}

function isRetryableStatus(status: number): boolean {
  return status >= 500 || status === 408 || status === 429;
}

/**
 * DeepSeek 适配器（OpenAI 兼容协议）。
 * 仅作为 LlmProvider 的一个实现，业务代码不直接依赖它（系统设计文档 2.2）。
 */
export class DeepSeekProvider {
  private readonly url: string;

  constructor() {
    this.url = `${config.deepseek.baseUrl.replace(/\/$/, '')}/chat/completions`;
  }

  private headers(): Record<string, string> {
    if (!config.deepseek.apiKey) {
      throw new LlmError('未配置 DEEPSEEK_API_KEY，助手功能不可用', false);
    }
    return {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.deepseek.apiKey}`,
    };
  }

  private body(
    messages: LlmMessage[],
    tools: LlmTool[],
    stream: boolean,
    extra?: Record<string, unknown>
  ): string {
    const payload: Record<string, unknown> = {
      model: config.deepseek.model,
      messages,
      stream,
      ...(extra ?? {}),
    };
    if (tools.length > 0) {
      payload.tools = tools;
      payload.tool_choice = 'auto';
    }
    return JSON.stringify(payload);
  }

  /**
   * 流式对话：逐字回调文本增量，结束后返回完整文本与累积的工具调用。
   * 仅在「尚未输出任何内容」时重试，避免重复输出。
   */
  async streamChat(
    messages: LlmMessage[],
    tools: LlmTool[],
    handlers: LlmStreamHandlers,
    signal?: AbortSignal
  ): Promise<LlmCompletionResult> {
    const maxAttempts = Math.max(1, config.deepseek.maxRetry + 1);
    let lastError: unknown;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      let emitted = false;
      try {
        return await this.doStream(messages, tools, handlers, () => {
          emitted = true;
        }, signal);
      } catch (err) {
        lastError = err;
        const retryable = err instanceof LlmError ? err.retryable : false;
        if (!retryable || emitted || attempt === maxAttempts) break;
        logger.warn('DeepSeek 流式调用失败，准备重试', { attempt, error: (err as Error).message });
        await new Promise((resolve) => setTimeout(resolve, attempt * 500));
      }
    }

    if (lastError instanceof LlmError) throw lastError;
    throw new LlmError(
      `助手服务调用失败：${lastError instanceof Error ? lastError.message : String(lastError)}`,
      true
    );
  }

  private async doStream(
    messages: LlmMessage[],
    tools: LlmTool[],
    handlers: LlmStreamHandlers,
    markEmitted: () => void,
    outerSignal?: AbortSignal
  ): Promise<LlmCompletionResult> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), config.deepseek.timeoutMs);
    const onOuterAbort = () => controller.abort();
    outerSignal?.addEventListener('abort', onOuterAbort);

    try {
      const response = await fetch(this.url, {
        method: 'POST',
        headers: this.headers(),
        body: this.body(messages, tools, true),
        signal: controller.signal,
      });

      if (!response.ok || !response.body) {
        const text = await response.text().catch(() => '');
        throw new LlmError(
          `DeepSeek 返回异常（${response.status}）${text.slice(0, 200)}`,
          isRetryableStatus(response.status)
        );
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder('utf-8');
      let buffer = '';
      let content = '';
      const toolCallMap = new Map<number, AccumulatedToolCall>();
      let finishReason: string | undefined;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        let sepIndex: number;
        while ((sepIndex = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0, sepIndex).trim();
          buffer = buffer.slice(sepIndex + 1);
          if (!line.startsWith('data:')) continue;

          const data = line.slice(5).trim();
          if (data === '[DONE]') continue;

          let chunk: RawStreamChunk;
          try {
            chunk = JSON.parse(data) as RawStreamChunk;
          } catch {
            continue; // 忽略无法解析的片段（心跳等）
          }
          if (chunk.error) {
            throw new LlmError(`DeepSeek 错误：${chunk.error.message ?? '未知错误'}`, false);
          }

          const choice = chunk.choices?.[0];
          if (!choice) continue;

          const delta = choice.delta;
          if (delta?.content) {
            content += delta.content;
            markEmitted();
            await handlers.onTextDelta?.(delta.content);
          }
          if (delta?.tool_calls) {
            markEmitted();
            for (const raw of delta.tool_calls) {
              const index = raw.index ?? 0;
              const existing = toolCallMap.get(index) ?? { id: '', name: '', arguments: '' };
              if (raw.id) existing.id = raw.id;
              if (raw.function?.name) existing.name += raw.function.name;
              if (raw.function?.arguments) existing.arguments += raw.function.arguments;
              toolCallMap.set(index, existing);
            }
          }
          if (choice.finish_reason) finishReason = choice.finish_reason;
        }
      }

      const toolCalls: LlmToolCall[] = [...toolCallMap.entries()]
        .sort((a, b) => a[0] - b[0])
        .map(([index, value], order) => ({
          id: value.id || `call_${index}_${order}`,
          type: 'function' as const,
          function: { name: value.name, arguments: value.arguments || '{}' },
        }));

      return { content, toolCalls, finishReason };
    } catch (err) {
      if (err instanceof LlmError) throw err;
      const aborted = err instanceof Error && err.name === 'AbortError';
      throw new LlmError(
        aborted ? '助手响应超时，请重试' : `助手服务调用失败：${(err as Error).message}`,
        true
      );
    } finally {
      clearTimeout(timer);
      outerSignal?.removeEventListener('abort', onOuterAbort);
    }
  }

  /**
   * 非流式调用：确认执行后生成总结文本 / 压缩摘要 / 记忆提取与合并等机械转换。
   *
   * `disableThinking` 用于纯转换型任务（如压缩摘要）：这类任务不需要推理，
   * 开启思考会额外生成上千 reasoning token，使 P95 从 <1s 涨到 4~8s
   * （PRD 435 要求「压缩 LLM 调用 P95 ≤ 3s」）。
   */
  async complete(
    messages: LlmMessage[],
    tools: LlmTool[] = [],
    options?: { disableThinking?: boolean; maxTokens?: number }
  ): Promise<LlmCompletionResult> {
    const extra: Record<string, unknown> = {};
    if (options?.disableThinking) extra.thinking = { type: 'disabled' };
    if (options?.maxTokens != null) extra.max_tokens = options.maxTokens;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), config.deepseek.timeoutMs);
    try {
      const response = await fetch(this.url, {
        method: 'POST',
        headers: this.headers(),
        body: this.body(messages, tools, false, extra),
        signal: controller.signal,
      });
      if (!response.ok) {
        const text = await response.text().catch(() => '');
        throw new LlmError(`DeepSeek 返回异常（${response.status}）${text.slice(0, 200)}`, isRetryableStatus(response.status));
      }
      const json = (await response.json()) as {
        choices?: Array<{
          message?: { content?: string | null; tool_calls?: Array<{ id: string; function: { name: string; arguments: string } }> };
          finish_reason?: string;
        }>;
      };
      const message = json.choices?.[0]?.message;
      return {
        content: message?.content ?? '',
        toolCalls: (message?.tool_calls ?? []).map((call) => ({
          id: call.id,
          type: 'function' as const,
          function: { name: call.function.name, arguments: call.function.arguments },
        })),
        finishReason: json.choices?.[0]?.finish_reason,
      };
    } catch (err) {
      if (err instanceof LlmError) throw err;
      const aborted = err instanceof Error && err.name === 'AbortError';
      throw new LlmError(aborted ? '助手响应超时，请重试' : `助手服务调用失败：${(err as Error).message}`, true);
    } finally {
      clearTimeout(timer);
    }
  }
}

export const llmProvider = new DeepSeekProvider();