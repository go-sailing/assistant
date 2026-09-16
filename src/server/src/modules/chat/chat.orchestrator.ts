import { logger } from '../../common/logger';
import { AppError } from '../../common/errors';
import { config } from '../../config';
import { buildSystemPrompt } from '../../llm/prompt';
import { TOOL_DEFINITIONS, isDangerousTool, isKnownTool } from '../../llm/tools';
import { llmProvider } from '../../llm/deepseek';
import { LlmError, type LlmMessage } from '../../llm/types';
import { toolExecutor, type ToolResult } from '../../tools/executor';
import type { TaskDTO } from '../task/types';
import {
  conversationService,
  pendingActionService,
} from './conversation.service';
import type { MessageBlock } from './chat.types';
import { query } from '../../db/pool';

export type SseEmitter = (event: string, data: unknown) => void;

/**
 * 单次对话最多允许的「模型 → 工具 → 模型」轮数，防止无限循环。
 * 取 5 是为了容纳模型「先 list_lists/list_tasks 探查、再执行写操作」的多轮路径，
 * 轮数只有在模型请求工具时才会消耗。
 */
const MAX_TOOL_ROUNDS = 5;

export interface ChatContext {
  userId: number;
  conversationId: number;
  content: string;
  clientMsgId?: string;
  timezoneOffsetMinutes: number;
  traceId?: string;
}

/** 喂回模型的任务摘要，控制 token 同时保留关键信息 */
function tasksForModel(tasks?: TaskDTO[]) {
  if (!tasks || tasks.length === 0) return undefined;
  return tasks.map((t) => ({
    id: t.id,
    title: t.title,
    status: t.status,
    priority: t.priority,
    due_at: t.due_at,
    list: t.list_name,
  }));
}

function toolResultForModel(result: ToolResult) {
  return {
    ok: result.ok,
    summary: result.summary,
    tasks: tasksForModel(result.tasks),
    list: result.data?.list,
    lists: result.data?.lists,
    error: result.error,
    // 失败时明确禁止重试同一调用，避免模型反复重试耗尽轮数
    hint: result.ok
      ? undefined
      : '该工具调用已失败，不要用相同的参数重试。请向用户说明失败原因，或请求用户澄清后再试。',
  };
}

function parseToolArguments(raw: string): { ok: true; value: Record<string, unknown> } | { ok: false; message: string } {
  if (!raw || !raw.trim()) return { ok: true, value: {} };
  try {
    const parsed = JSON.parse(raw);
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { ok: false, message: '参数必须是 JSON 对象' };
    }
    return { ok: true, value: parsed as Record<string, unknown> };
  } catch {
    return { ok: false, message: '参数不是合法的 JSON' };
  }
}

export const chatOrchestrator = {
  /**
   * 处理一次对话请求，通过 emit 输出 SSE 事件。
   * 完整流程见系统设计文档 7.1。
   */
  async run(ctx: ChatContext, emit: SseEmitter, abortSignal?: AbortSignal): Promise<void> {
    const { userId, conversationId, traceId } = ctx;

    // 1. 幂等：同一个 client_msg_id 重发时，重放已产生的回复，不重复执行工具
    if (ctx.clientMsgId) {
      const existed = await conversationService.findUserMessageByClientId(
        conversationId,
        ctx.clientMsgId
      );
      if (existed) {
        const assistant = await conversationService.findFollowingAssistantMessage(existed.id);
        emit('meta', { message_id: existed.id, trace_id: traceId, replayed: true });
        if (assistant) {
          await this.replayBlocks(assistant.payload?.blocks ?? [], emit);
        }
        emit('done', { finish_reason: 'replayed' });
        return;
      }
    }

    const conversation = await conversationService.getOwned(userId, conversationId);

    // 2. 落库用户消息（client_msg_id 冲突说明并发重发，直接重放）
    let userMessageId: number;
    try {
      const saved = await conversationService.appendMessage({
        conversationId,
        role: 'user',
        content: ctx.content,
        clientMsgId: ctx.clientMsgId ?? null,
      });
      userMessageId = saved.id;
    } catch (err) {
      // 唯一索引冲突：并发重发场景
      if (ctx.clientMsgId) {
        const existed = await conversationService.findUserMessageByClientId(conversationId, ctx.clientMsgId);
        if (existed) {
          const assistant = await conversationService.findFollowingAssistantMessage(existed.id);
          emit('meta', { message_id: existed.id, trace_id: traceId, replayed: true });
          if (assistant) await this.replayBlocks(assistant.payload?.blocks ?? [], emit);
          emit('done', { finish_reason: 'replayed' });
          return;
        }
      }
      throw err;
    }
    await conversationService.maybeSetTitle(conversationId, ctx.content, conversation.title);

    // 3. 用户已经发了新指令，作废此前未决的待确认操作
    await pendingActionService.cancelPendingOfConversation(conversationId);

    emit('meta', { message_id: userMessageId, trace_id: traceId });

    const blocks: MessageBlock[] = [];
    /** 记录工具失败原因，用于在模型未能给出解释时生成具体的兜底文案 */
    const toolFailures: string[] = [];

    try {
      const history = await conversationService.buildHistory(conversationId);
      const llmMessages: LlmMessage[] = [
        {
          role: 'system',
          content: buildSystemPrompt(new Date(), ctx.timezoneOffsetMinutes),
        },
        ...history,
      ];

      let finalText = '';

      for (let round = 0; round < MAX_TOOL_ROUNDS; round += 1) {
        let roundText = '';
        const result = await llmProvider.streamChat(
          llmMessages,
          TOOL_DEFINITIONS,
          {
            onTextDelta: (delta) => {
              roundText += delta;
              emit('text_delta', { delta });
            },
          },
          abortSignal
        );

        roundText = result.content || roundText;
        if (roundText.trim()) {
          blocks.push({ type: 'text', text: roundText.trim() });
          finalText = finalText ? `${finalText}\n${roundText.trim()}` : roundText.trim();
        }

        if (result.toolCalls.length === 0) break;

        llmMessages.push({
          role: 'assistant',
          content: result.content || null,
          tool_calls: result.toolCalls,
        });

        let clarifyBlock: Extract<MessageBlock, { type: 'clarify' }> | null = null;

        for (const call of result.toolCalls) {
          const toolName = call.function.name;
          const parsedArgs = parseToolArguments(call.function.arguments);

          if (!parsedArgs.ok) {
            const message = `工具参数解析失败：${parsedArgs.message}`;
            toolFailures.push(message);
            llmMessages.push({
              role: 'tool',
              tool_call_id: call.id,
              content: JSON.stringify({
                ok: false,
                error: message,
                hint: '不要用相同参数重试，请向用户说明或请求澄清。',
              }),
            });
            continue;
          }

          if (!isKnownTool(toolName)) {
            llmMessages.push({
              role: 'tool',
              tool_call_id: call.id,
              content: JSON.stringify({ ok: false, error: `不支持的工具 ${toolName}` }),
            });
            continue;
          }

          emit('tool_call', { tool: toolName, arguments: parsedArgs.value });

          // 危险操作：不执行，先挂起等待用户确认（系统设计文档 4.1）
          if (isDangerousTool(toolName)) {
            const action = await toolExecutor.prepare(userId, toolName, parsedArgs.value, {
              conversationId,
              traceId,
            });
            const pending = await pendingActionService.create({
              conversationId,
              userId,
              toolName,
              resolvedParams: action.resolvedParams,
              affected: action.affected,
            });

            const confirmBlock: Extract<MessageBlock, { type: 'confirm' }> = {
              type: 'confirm',
              pending_action_id: pending.id,
              action: toolName,
              affected: action.affected,
              count: action.affected.length,
              description: action.description,
            };
            blocks.push(confirmBlock);
            emit('confirm', confirmBlock);

            if (!roundText.trim()) {
              const hint = `即将${action.description}，请确认后执行。`;
              emit('text_delta', { delta: hint });
              blocks.push({ type: 'text', text: hint });
              finalText = hint;
            }

            await this.persistAssistantMessage(conversationId, finalText, blocks);
            emit('done', { finish_reason: 'awaiting_confirmation' });
            return;
          }

          // 澄清：渲染候选卡片，并结束本轮，不再让模型自行猜测
          if (toolName === 'clarify_task_selection') {
            const result2 = await toolExecutor.execute(userId, toolName, parsedArgs.value, {
              conversationId,
              traceId,
            });
            if (result2.clarify) {
              clarifyBlock = {
                type: 'clarify',
                question: result2.clarify.question,
                candidates: result2.clarify.candidates,
              };
              emit('clarify', clarifyBlock);
            }
            llmMessages.push({
              role: 'tool',
              tool_call_id: call.id,
              content: JSON.stringify(toolResultForModel(result2)),
            });
            continue;
          }

          // 只读与安全写工具：直接执行
          const toolResult = await toolExecutor.execute(userId, toolName, parsedArgs.value, {
            conversationId,
            traceId,
          });
          if (!toolResult.ok) {
            toolFailures.push(toolResult.summary);
          }
          if (toolResult.ok && toolResult.tasks && toolResult.tasks.length > 0) {
            const cardsBlock: Extract<MessageBlock, { type: 'cards' }> = {
              type: 'cards',
              tasks: toolResult.tasks,
            };
            blocks.push(cardsBlock);
            emit('cards', cardsBlock);
          }
          llmMessages.push({
            role: 'tool',
            tool_call_id: call.id,
            content: JSON.stringify(toolResultForModel(toolResult)),
          });
        }

        if (clarifyBlock) {
          blocks.push(clarifyBlock);
          if (!roundText.trim()) {
            emit('text_delta', { delta: clarifyBlock.question });
            blocks.push({ type: 'text', text: clarifyBlock.question });
            finalText = clarifyBlock.question;
          }
          await this.persistAssistantMessage(conversationId, finalText, blocks);
          emit('done', { finish_reason: 'clarify' });
          return;
        }
      }

      if (blocks.length === 0) {
        // 模型没有产出任何内容：若有工具失败，给出具体原因；否则给出通用兜底
        const fallback = toolFailures.length
          ? `抱歉，我没能完成这个操作：${toolFailures[0]}。你可以换个说法，或直接在任务页处理。`
          : '我没有理解你的意思，可以换个说法再试一次吗？';
        emit('text_delta', { delta: fallback });
        blocks.push({ type: 'text', text: fallback });
        finalText = fallback;
      }

      await this.persistAssistantMessage(conversationId, finalText, blocks);
      emit('done', { finish_reason: 'stop' });
    } catch (err) {
      const isLlm = err instanceof LlmError;
      const retryable = isLlm ? (err as LlmError).retryable : true;
      // 对外只给友好文案，技术细节（含上游原始响应）只写日志，避免信息泄露
      const message = isLlm
        ? config.deepseek.apiKey
          ? '助手暂时不可用，请稍后重试'
          : '助手功能未启用，请联系管理员配置'
        : err instanceof AppError
          ? err.message
          : '助手处理失败，请稍后重试';

      logger.error('对话处理失败', {
        trace_id: traceId,
        user_id: userId,
        conversation_id: conversationId,
        error: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined,
      });

      // 已产出的内容仍然保留，追加错误块
      blocks.push({ type: 'error', message, retryable });
      await this.persistAssistantMessage(conversationId, finalTextOf(blocks), blocks).catch(() => undefined);
      emit('error', { code: isLlm ? 3001 : 3002, message, retryable });
      emit('done', { finish_reason: 'error' });
    }
  },

  /** 用户确认后执行写操作，并生成总结文本（返回落库的助手消息） */
  async confirm(ctx: ChatContext & { pendingActionId: string }): Promise<{ message: unknown }> {
    const { userId, conversationId, traceId } = ctx;
    const action = await pendingActionService.takeExecutable(
      userId,
      conversationId,
      ctx.pendingActionId
    );

    const blocks: MessageBlock[] = [];

    const result = await toolExecutor.executeConfirmed(
      userId,
      action.tool_name,
      action.params,
      { conversationId, traceId }
    );

    await pendingActionService.markStatus(action.id, 'confirmed');

    const affected = (action.affected ?? []) as TaskDTO[];

    if (result.ok) {
      if (result.tasks && result.tasks.length > 0) {
        blocks.push({ type: 'cards', tasks: result.tasks });
      } else if (affected.length > 0) {
        // 删除类操作：卡片已不存在，展示被删除对象的快照
        blocks.push({ type: 'cards', tasks: affected.map((t) => ({ ...t, status: t.status })) });
      }
      blocks.unshift({ type: 'text', text: `${result.summary}。` });
    } else {
      blocks.push({ type: 'text', text: '操作未能完成。' });
      blocks.push({ type: 'error', message: result.summary, retryable: true });
    }

    const text = result.ok ? result.summary : '操作未能完成';
    const saved = await conversationService.appendMessage({
      conversationId,
      role: 'assistant',
      content: text,
      payload: { blocks },
    });
    return { message: saved };
  },

  async cancel(ctx: ChatContext & { pendingActionId: string }): Promise<{ message: unknown }> {
    const { userId, conversationId } = ctx;
    const action = await pendingActionService.getOwned(userId, conversationId, ctx.pendingActionId);
    if (action.status === 'pending') {
      await pendingActionService.markStatus(action.id, 'canceled');
    }

    const blocks: MessageBlock[] = [{ type: 'text', text: '好的，已取消该操作，任务数据未做任何修改。' }];
    const saved = await conversationService.appendMessage({
      conversationId,
      role: 'assistant',
      content: '已取消该操作',
      payload: { blocks },
    });
    return { message: saved };
  },

  async persistAssistantMessage(
    conversationId: number,
    content: string,
    blocks: MessageBlock[]
  ): Promise<void> {
    await conversationService.appendMessage({
      conversationId,
      role: 'assistant',
      content,
      payload: { blocks },
    });
  },

  /** 幂等重放：把历史消息块按事件重新推给客户端 */
  async replayBlocks(blocks: MessageBlock[], emit: SseEmitter): Promise<void> {
    for (const block of blocks) {
      switch (block.type) {
        case 'text':
          emit('text_delta', { delta: block.text });
          break;
        case 'cards':
          emit('cards', { tasks: block.tasks });
          break;
        case 'clarify':
          emit('clarify', block);
          break;
        case 'confirm': {
          // 仅当待确认动作仍然有效时才重放确认条，否则会造成误解
          const res = await query<{ status: string }>(
            `SELECT status FROM pending_actions WHERE id = $1`,
            [block.pending_action_id]
          );
          if (res.rows[0]?.status === 'pending') {
            emit('confirm', block);
          }
          break;
        }
        case 'error':
          emit('error', { code: 3002, message: block.message, retryable: block.retryable });
          break;
        default:
          break;
      }
    }
  },
};

function finalTextOf(blocks: MessageBlock[]): string {
  return blocks
    .filter((b): b is Extract<MessageBlock, { type: 'text' }> => b.type === 'text')
    .map((b) => b.text)
    .join('\n');
}

export { MAX_TOOL_ROUNDS };