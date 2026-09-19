import { logger } from '../../common/logger';
import { AppError } from '../../common/errors';
import { config } from '../../config';
import { randomUUID } from 'crypto';
import { buildSystemPrompt } from '../../llm/prompt';
import { TOOL_DEFINITIONS, isDangerousCall, isKnownTool } from '../../llm/tools';
import { llmProvider } from '../../llm/deepseek';
import { LlmError, type LlmMessage } from '../../llm/types';
import { toolExecutor, type ToolResult } from '../../tools/executor';
import { taskService } from '../task/task.service';
import type { SubtaskGroup, TaskDTO } from '../task/types';
import type { EventDTO, OccurrenceDTO, SeriesDTO } from '../event/types';
import type { ConflictDateGroup } from '../event/recurrence/types';
import {
  conversationService,
  pendingActionService,
} from './conversation.service';
import { compactionService } from './compaction.service';
import { memoryService } from '../memory/memory.service';
import type { MessageBlock } from './chat.types';
import { query } from '../../db/pool';

export type SseEmitter = (event: string, data: unknown) => void;

/**
 * 单次对话最多允许的「模型 → 工具 → 模型」轮数，防止无限循环。
 * 取 5 是为了容纳模型「先 list_lists/list_tasks 探查、再执行写操作」的多轮路径，
 * 轮数只有在模型请求工具时才会消耗。
 */
const MAX_TOOL_ROUNDS = 5;

/**
 * v0.5.0：只读工具集合（系统设计文档 6.4）。
 * 未列入者一律视为写工具（新增工具默认保守=写），present_proposal 单独排除：
 * 它是呈现型工具、无副作用，不应因它丢弃同轮的查询卡。
 */
const READ_TOOL_NAMES = new Set([
  'list_events',
  'search_events',
  'get_event',
  'list_tasks',
  'search_tasks',
  'get_task',
  'get_subtree',
  'list_lists',
  'resolve_lunar_date',
]);

export interface ChatContext {
  userId: number;
  conversationId: number;
  content: string;
  clientMsgId?: string;
  timezoneOffsetMinutes: number;
  /** 客户端 IANA 时区（用于日程按自然日查询与循环规则解释） */
  timezone?: string;
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
    // v0.6.0：任务类型与项目成员关系（数据最小化：不含备注全文）
    task_type: t.task_type,
    parent_id: t.parent_id,
    depth: t.depth,
    member_progress: t.member_total > 0 ? `${t.member_completed}/${t.member_total}` : undefined,
    // v0.7.0：代理执行维度（模型可回答"那个任务执行得怎么样"）
    agent_name: t.agent_name ?? undefined,
    agent_state: t.agent_id ? t.agent_state : undefined,
  }));
}

/** 喂回模型的日程摘要 */
function eventsForModel(events?: EventDTO[]) {
  if (!events || events.length === 0) return undefined;
  return events.map((e) => {
    const base = {
      id: e.id,
      type: e.event_type,
      title: e.title,
      task_id: e.task_id,
      start_at: e.start_at,
      end_at: e.end_at,
      all_day: e.all_day,
      location: e.location,
      note: e.note,
      task_status: e.task?.status,
      recurrence_summary: e.recurrence_summary ?? undefined,
    };
    // 实例：额外给出身份键，模型后续 scope=this/following 必须原样回传
    if ('occurrence_key' in e) {
      const inst = e as OccurrenceDTO;
      return {
        ...base,
        series_id: inst.series_id,
        occurrence_key: inst.occurrence_key,
        override_state: inst.override_state,
      };
    }
    return base;
  });
}

function seriesForModel(series?: SeriesDTO[]) {
  if (!series || series.length === 0) return undefined;
  return series.map((s) => ({
    id: s.id,
    title: s.title,
    recurrence_summary: s.recurrence_summary,
    next_occurrence: s.next_occurrence,
    first_occurrence_at: s.first_occurrence_at,
    total_count: s.total_count,
    all_day: s.all_day,
    location: s.location,
  }));
}

function subtaskGroupsForModel(groups?: SubtaskGroup[]) {
  if (!groups || groups.length === 0) return undefined;
  return groups.map((g) => ({
    root_task_id: g.root_task_id,
    nodes: g.nodes.map((n) => ({
      id: n.id,
      title: n.title,
      status: n.status,
      parent_id: n.parent_id,
      depth: n.depth,
    })),
  }));
}

/**
 * v0.6.0：任务类写结果轮末聚合（系统设计文档 9.4）。
 *
 * - 项目（任务自身 task_type=project，或出现在组根）→ 云端重拉成员，输出**一个**项目结果组
 *   （项目名 + 成员列表 + 最新进度），避免一轮「项目 + N 成员」产生 N+1 张散卡；
 * - 其余普通任务 → 合并为一个任务卡组；
 * - 同一 id 去重（后写覆盖先写，反映最新状态）；项目已被删除则跳过，不展示陈旧数据。
 */
async function aggregateTaskWriteCards(
  userId: number,
  cards: Array<Extract<MessageBlock, { type: 'cards' }>>
): Promise<Array<Extract<MessageBlock, { type: 'cards' }>>> {
  const byId = new Map<number, TaskDTO>();
  const groupRootIds: number[] = [];
  for (const card of cards) {
    for (const t of card.tasks) byId.set(t.id, t);
    for (const g of card.subtask_groups ?? []) {
      if (!groupRootIds.includes(g.root_task_id)) groupRootIds.push(g.root_task_id);
      for (const n of g.nodes) byId.set(n.id, n);
    }
  }

  const projectIds = new Set<number>(groupRootIds);
  for (const t of byId.values()) {
    if (t.task_type === 'project') projectIds.add(t.id);
  }

  const out: Array<Extract<MessageBlock, { type: 'cards' }>> = [];

  if (projectIds.size > 0) {
    const groups: SubtaskGroup[] = [];
    for (const projectId of projectIds) {
      try {
        const nodes = await taskService.getSubtree(userId, projectId);
        groups.push({ root_task_id: projectId, nodes });
        for (const n of nodes) byId.delete(n.id);
      } catch {
        /* 已删除/越权：跳过，不展示陈旧数据 */
      }
    }
    if (groups.length > 0) {
      out.push({
        type: 'cards',
        tasks: [],
        events: [],
        series: [],
        occurrences: [],
        subtask_groups: groups,
      });
    }
  }

  const rest = [...byId.values()].filter((t) => !projectIds.has(t.id));
  if (rest.length > 0) {
    out.push({
      type: 'cards',
      tasks: rest,
      events: [],
      series: [],
      occurrences: [],
      subtask_groups: [],
    });
  }
  return out;
}

function toolResultForModel(result: ToolResult) {
  return {
    ok: result.ok,
    summary: result.summary,
    tasks: tasksForModel(result.tasks),
    events: eventsForModel(result.events),
    series: seriesForModel(result.series),
    occurrences: eventsForModel(result.occurrences),
    subtask_groups: subtaskGroupsForModel(result.subtask_groups),
    list: result.data?.list,
    lists: result.data?.lists,
    // 冲突未确认：把冲突明细交给模型，必须先告知用户再决定是否二次提交
    saved: result.data?.saved,
    need_conflict_confirmation: result.data?.need_conflict_confirmation,
    conflict_level: result.data?.conflict_level,
    conflicts: result.data?.conflicts,
    conflict_dates: result.data?.conflict_dates,
    conflict_dates_total: result.data?.conflict_dates_total,
    conflict_total: result.data?.conflict_total,
    // v0.2.0：级联完成需用户确认；父任务自动恢复需在回复中告知
    need_cascade_confirmation: result.data?.need_cascade_confirmation,
    incomplete_descendant_count: result.data?.incomplete_descendant_count,
    revived_parent: result.data?.revived_parent,
    restored: result.data?.restored,
    error: result.error,
    // 失败时明确禁止重试同一调用，避免模型反复重试耗尽轮数
    hint: result.ok
      ? result.data?.need_conflict_confirmation
        ? '这是冲突提示，不是失败。请先把冲突日程（或冲突日期与次数）告知用户并询问如何处理；用户明确同意后才带 confirm_conflict=true 重试。'
        : result.data?.need_cascade_confirmation
          ? '这是确认请求，不是失败。请先询问用户是否把未完成的成员任务一起标记完成；用户同意后系统会代为执行，你无需再次调用工具。'
          : undefined
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
      const systemPrompt = buildSystemPrompt(new Date(), ctx.timezoneOffsetMinutes, ctx.timezone);
      // v0.5.0：长期记忆以独立 system 分区注入（第 [1] 段，见 SDD 4.3）
      const memorySection = await memoryService.sectionForPrompt(userId);

      // v0.5.0：超水位时先做一次 best-effort 压缩（失败静默降级，不阻断本轮）
      await compactionService.maybeCompact({
        userId,
        conversationId,
        systemPrompt,
        memorySection,
        onStatus: () => emit('status', { stage: 'compacting' }),
      });

      const llmMessages: LlmMessage[] = await compactionService.composeContext({
        conversationId,
        systemPrompt,
        memorySection,
      });

      let finalText = '';
      /**
       * v0.5.0 CHAT-01：本轮是否发生过写操作；只读工具的结果卡先缓冲、轮末裁决——
       * 有写操作则全部丢弃（过程查询不落地为用户可见卡片），纯查询轮再统一展示。
       * 模型侧的 tool result 始终照常 append（模型取数能力不受影响）。
       */
      let writeToolCalled = false;
      const pendingReadCards: Array<Extract<MessageBlock, { type: 'cards' }>> = [];
      /**
       * v0.6.0：任务类写结果轮末聚合（系统设计文档 9.4）。
       * 一轮「项目 + N 个成员」最终只展示一个项目结果组，不产生 N+1 张散卡；
       * 事件类写结果仍即时展示。
       */
      const pendingWriteTaskCards: Array<Extract<MessageBlock, { type: 'cards' }>> = [];

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
        let scopeBlock: Extract<MessageBlock, { type: 'scope' }> | null = null;

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

          // v0.5.0：读写分类。present_proposal 无副作用，不计入写操作
          const isReadTool = READ_TOOL_NAMES.has(toolName);
          if (!isReadTool && toolName !== 'present_proposal') writeToolCalled = true;

          emit('tool_call', { tool: toolName, arguments: parsedArgs.value });

          // v0.2.0：循环实例的写操作未指定作用域 → 先澄清（默认「仅本次」），禁止默认整条
          const scopeAsk = await toolExecutor.needsScopeClarification(
            userId,
            toolName,
            parsedArgs.value,
            {
              conversationId,
              traceId,
              tzOffsetMinutes: ctx.timezoneOffsetMinutes,
              timezone: ctx.timezone,
            }
          );
          if (scopeAsk) {
            scopeBlock = {
              type: 'scope',
              tool: scopeAsk.tool,
              question: `「${scopeAsk.title}」是循环日程，这次操作要应用到哪一范围？`,
              options: scopeAsk.options as Extract<MessageBlock, { type: 'scope' }>['options'],
              ref: { series_id: scopeAsk.series_id, occurrence_key: null },
              recommended: 'this',
            };
            emit('scope', scopeBlock);
            llmMessages.push({
              role: 'tool',
              tool_call_id: call.id,
              content: JSON.stringify({
                ok: false,
                error: 'need_scope_clarification',
                hint: '这是循环日程，作用域不明确。请先询问用户「仅本次 / 本次及以后 / 整条系列」，用户回答后再带 scope 与 occurrence_key 重新调用。',
              }),
            });
            continue;
          }

          // 危险操作：不执行，先挂起等待用户确认（系统设计文档 4.1 / 4.5）
          if (isDangerousCall(toolName, parsedArgs.value)) {
            const action = await toolExecutor.prepare(userId, toolName, parsedArgs.value, {
              conversationId,
              traceId,
              tzOffsetMinutes: ctx.timezoneOffsetMinutes,
              timezone: ctx.timezone,
            });
            const pending = await pendingActionService.create({
              conversationId,
              userId,
              toolName,
              resolvedParams: action.resolvedParams,
              affected: action.affected,
              affectedEvents: action.affectedEvents,
            });

            const affectedCount = action.affected.length + (action.affectedEvents?.length ?? 0);
            const confirmBlock: Extract<MessageBlock, { type: 'confirm' }> = {
              type: 'confirm',
              pending_action_id: pending.id,
              // 循环系列的整条删除用专用 action，前端文案与按钮区分于单次日程
              action:
                toolName === 'delete_event' && action.resolvedParams.scope === 'series'
                  ? 'delete_event_series'
                  : toolName,
              affected: action.affected,
              affected_events: action.affectedEvents ?? [],
              count: affectedCount,
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

          // v0.4.0：方案卡（PRD 8.3 / SDD 5.4）——呈现型工具，无副作用、不落 pending，
          // 用户确认后由模型按方案参数重新调用真实工具（届时照常经过全部服务端门控）
          if (toolName === 'present_proposal') {
            const raw = parsedArgs.value as {
              title?: unknown;
              params?: unknown;
              note?: unknown;
            };
            const title = typeof raw.title === 'string' && raw.title.trim() ? raw.title.trim() : '执行方案';
            const params = Array.isArray(raw.params)
              ? raw.params
                  .filter(
                    (p): p is { label: string; value: string; defaulted?: boolean } =>
                      !!p &&
                      typeof p === 'object' &&
                      typeof (p as { label?: unknown }).label === 'string' &&
                      typeof (p as { value?: unknown }).value === 'string'
                  )
                  .slice(0, 12)
                  .map((p) => ({
                    label: p.label,
                    value: p.value,
                    ...(p.defaulted === true ? { defaulted: true as const } : {}),
                  }))
              : [];
            // 参数行不可用时视为无效方案，回填错误让模型重来，避免出空白卡片
            if (params.length === 0) {
              llmMessages.push({
                role: 'tool',
                tool_call_id: call.id,
                content: JSON.stringify({
                  ok: false,
                  error: '方案参数为空，请提供 title 与至少一条 params（label+value）',
                }),
              });
              continue;
            }

            const proposalBlock: Extract<MessageBlock, { type: 'proposal' }> = {
              type: 'proposal',
              proposal_id: randomUUID(),
              title,
              params,
              ...(typeof raw.note === 'string' && raw.note.trim() ? { note: raw.note.trim() } : {}),
            };
            blocks.push(proposalBlock);
            emit('proposal', proposalBlock);

            if (!roundText.trim()) {
              const hint = '我按下面的方案安排，可以吗？';
              emit('text_delta', { delta: hint });
              blocks.push({ type: 'text', text: hint });
              finalText = hint;
            }

            await this.persistAssistantMessage(conversationId, finalText, blocks);
            emit('done', { finish_reason: 'awaiting_proposal_confirmation' });
            return;
          }

          // 澄清：渲染候选卡片，并结束本轮，不再让模型自行猜测
          if (toolName === 'clarify_task_selection' || toolName === 'clarify_event_selection') {
            const result2 = await toolExecutor.execute(userId, toolName, parsedArgs.value, {
              conversationId,
              traceId,
              tzOffsetMinutes: ctx.timezoneOffsetMinutes,
              timezone: ctx.timezone,
            });
            if (result2.clarify) {
              const isEvent = result2.clarify.kind === 'event';
              clarifyBlock = {
                type: 'clarify',
                question: result2.clarify.question,
                kind: result2.clarify.kind,
                candidates: result2.clarify.candidates,
                events: result2.clarify.candidatesEvents ?? [],
              };
              emit('clarify', {
                ...clarifyBlock,
                // 前端按 kind 取对应候选数组
                candidates: isEvent ? [] : clarifyBlock.candidates,
                events: clarifyBlock.events,
                kind: result2.clarify.kind,
              });
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
            tzOffsetMinutes: ctx.timezoneOffsetMinutes,
            timezone: ctx.timezone,
          });
          if (!toolResult.ok) {
            toolFailures.push(toolResult.summary);
          }

          // v0.6.0：项目级联完成 → 落 pending 并出确认条（系统设计文档 6.3 / 8.4）
          if (toolResult.ok && toolResult.data?.need_cascade_confirmation === true) {
            const task = toolResult.data.task as TaskDTO | undefined;
            const incomplete = (toolResult.data.incomplete_members as TaskDTO[] | undefined) ?? [];
            const n = Number(
              toolResult.data.incomplete_member_count ??
                toolResult.data.incomplete_descendant_count ??
                incomplete.length
            );
            if (task) {
              const affected = [task, ...incomplete];
              const pending = await pendingActionService.create({
                conversationId,
                userId,
                toolName: 'update_task_status',
                resolvedParams: { task_id: task.id, status: 'completed', cascade: true },
                affected,
                affectedEvents: [],
              });
              const confirmBlock: Extract<MessageBlock, { type: 'confirm' }> = {
                type: 'confirm',
                pending_action_id: pending.id,
                action: 'complete_task_cascade',
                affected,
                affected_events: [],
                count: affected.length,
                description: `完成项目「${task.title}」，并同时完成 ${n} 个未完成的成员任务`,
              };
              blocks.push(confirmBlock);
              emit('confirm', confirmBlock);
              if (!roundText.trim()) {
                const hint = `项目「${task.title}」还有 ${n} 个未完成的成员任务，是否一起标记完成？`;
                emit('text_delta', { delta: hint });
                blocks.push({ type: 'text', text: hint });
                finalText = hint;
              }
              await this.persistAssistantMessage(conversationId, finalText, blocks);
              emit('done', { finish_reason: 'awaiting_confirmation' });
              return;
            }
          }

          const hasTasks = !!toolResult.tasks && toolResult.tasks.length > 0;
          const hasEvents = !!toolResult.events && toolResult.events.length > 0;
          const hasSeries = !!toolResult.series && toolResult.series.length > 0;
          const hasOccurrences = !!toolResult.occurrences && toolResult.occurrences.length > 0;
          const hasGroups = !!toolResult.subtask_groups && toolResult.subtask_groups.length > 0;
          if (toolResult.ok && (hasTasks || hasEvents || hasSeries || hasOccurrences || hasGroups)) {
            const cardsBlock: Extract<MessageBlock, { type: 'cards' }> = {
              type: 'cards',
              tasks: toolResult.tasks ?? [],
              events: toolResult.events ?? [],
              series: toolResult.series ?? [],
              occurrences: toolResult.occurrences ?? [],
              subtask_groups: toolResult.subtask_groups ?? [],
            };
            if (isReadTool) {
              // 只读结果先缓冲：不 emit、不进 payload，由轮末裁决决定是否展示
              pendingReadCards.push(cardsBlock);
            } else if (
              !hasEvents &&
              !hasSeries &&
              !hasOccurrences &&
              (hasTasks || hasGroups)
            ) {
              // 任务类写结果：缓冲到轮末做「项目结果组」聚合
              pendingWriteTaskCards.push(cardsBlock);
            } else {
              // 事件类写工具结果卡：仅含本次实际受影响对象（executor 已保证），即时展示
              blocks.push(cardsBlock);
              emit('cards', cardsBlock);
            }
          }

          // 冲突未确认：以结构化冲突块呈现，由用户决定「仍要安排 / 换个时间」（UX 5.7）
          if (toolResult.ok && toolResult.data?.need_conflict_confirmation === true) {
            const groups = (toolResult.data.conflict_dates as ConflictDateGroup[] | undefined) ?? [];
            const conflictBlock: Extract<MessageBlock, { type: 'conflict' }> = {
              type: 'conflict',
              tool: toolName,
              conflicts:
                (toolResult.data.conflicts as Extract<MessageBlock, { type: 'conflict' }>['conflicts']) ??
                groups.flatMap((g) => g.conflicts),
              conflict_level: String(toolResult.data.conflict_level ?? 'overlap'),
              message:
                groups.length > 0
                  ? `未来 90 天内有 ${toolResult.data.conflict_dates_total ?? groups.length} 个日期与已有安排冲突`
                  : '这个时段已有安排',
              conflict_dates: groups,
              conflict_dates_total: Number(toolResult.data.conflict_dates_total ?? groups.length),
              conflict_total: Number(toolResult.data.conflict_total ?? 0),
            };
            blocks.push(conflictBlock);
            emit('conflict', conflictBlock);
          }
          llmMessages.push({
            role: 'tool',
            tool_call_id: call.id,
            content: JSON.stringify(toolResultForModel(toolResult)),
          });
        }

        if (clarifyBlock || scopeBlock) {
          if (clarifyBlock) blocks.push(clarifyBlock);
          if (scopeBlock) blocks.push(scopeBlock);
          const question = clarifyBlock?.question ?? scopeBlock?.question ?? '';
          if (!roundText.trim() && question) {
            emit('text_delta', { delta: question });
            blocks.push({ type: 'text', text: question });
            finalText = question;
          }
          await this.persistAssistantMessage(conversationId, finalText, blocks);
          emit('done', { finish_reason: 'clarify' });
          return;
        }
      }

      /* v0.5.0 轮末裁决：本轮无写操作 → 只读卡按原顺序补发；有写操作 → 全部丢弃 */
      if (!writeToolCalled) {
        for (const buffered of pendingReadCards) {
          blocks.push(buffered);
          emit('cards', buffered);
        }
      } else if (pendingReadCards.length > 0) {
        const hiddenItems = pendingReadCards.reduce(
          (sum, b) =>
            sum +
            b.tasks.length +
            (b.events?.length ?? 0) +
            (b.series?.length ?? 0) +
            (b.occurrences?.length ?? 0) +
            (b.subtask_groups?.length ?? 0),
          0
        );
        // 埋点：只记卡数与项数，不记正文
        logger.info('chat_tool_cards_hidden', {
          user_id: userId,
          conversation_id: conversationId,
          blocks: pendingReadCards.length,
          items: hiddenItems,
        });
      }

      /* v0.6.0 任务写结果轮末聚合：项目 → 项目结果组（含云端刷新的成员与进度） */
      if (pendingWriteTaskCards.length > 0) {
        const aggregated = await aggregateTaskWriteCards(userId, pendingWriteTaskCards);
        for (const card of aggregated) {
          blocks.push(card);
          emit('cards', card);
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
      { conversationId, traceId, tzOffsetMinutes: ctx.timezoneOffsetMinutes, timezone: ctx.timezone }
    );

    await pendingActionService.markStatus(action.id, 'confirmed');

    // 预取快照：任务与日程分列（v0.1.0 起 affected 为 { tasks, events } 结构）
    const affectedTasks = (action.affected?.tasks ?? []) as TaskDTO[];
    const affectedEvents = (action.affected?.events ?? []) as EventDTO[];

    if (result.ok) {
      const tasks = result.tasks && result.tasks.length > 0 ? result.tasks : result.events ? [] : affectedTasks;
      const events =
        result.events && result.events.length > 0 ? result.events : result.tasks ? [] : affectedEvents;
      const hasSeries = !!result.series && result.series.length > 0;
      const hasOccurrences = !!result.occurrences && result.occurrences.length > 0;
      const hasGroups = !!result.subtask_groups && result.subtask_groups.length > 0;
      if (tasks.length > 0 || events.length > 0 || hasSeries || hasOccurrences || hasGroups) {
        blocks.push({
          type: 'cards',
          tasks,
          events,
          series: result.series ?? [],
          occurrences: result.occurrences ?? [],
          subtask_groups: result.subtask_groups ?? [],
        });
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
    const action = await pendingActionService.resolveOwned(userId, conversationId, ctx.pendingActionId);
    if (action.status === 'pending') {
      await pendingActionService.markStatus(action.id, 'canceled');
    }
    // 埋点：级联完成确认的取消率（系统设计文档 9.2）
    if (action.tool_name === 'update_task_status') {
      logger.info('task_cascade_complete_canceled', {
        user_id: userId,
        conversation_id: conversationId,
      });
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
          emit('cards', {
            tasks: block.tasks,
            events: block.events ?? [],
            series: block.series ?? [],
            occurrences: block.occurrences ?? [],
            subtask_groups: block.subtask_groups ?? [],
          });
          break;
        case 'clarify':
          emit('clarify', {
            ...block,
            candidates: block.kind === 'event' ? [] : block.candidates,
            events: block.events ?? [],
          });
          break;
        case 'scope':
          emit('scope', block);
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
        case 'conflict':
          emit('conflict', block);
          break;
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
