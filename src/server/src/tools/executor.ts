import { z } from 'zod';
import { query } from '../db/pool';
import { AppError } from '../common/errors';
import { logger } from '../common/logger';
import { eventService } from '../modules/event/event.service';
import type { EventDTO, OccurrenceDTO, SeriesDTO } from '../modules/event/types';
import type { ConflictDateGroup } from '../modules/event/recurrence/types';
import {
  batchEventsSchema,
  clarifyEventSchema,
  createEventSchema,
  listEventsSchema,
  recurrenceSchema,
  searchEventsSchema,
  updateEventSchema,
} from '../modules/event/schema';
import { rejectRetiredParams } from '../common/validate';
import { isDangerousCall, isKnownTool } from '../llm/tools';

/** 日程工具入参：REST 侧 schema 复用同一份定义，仅补充/复用工具特有字段 */
const getEventArgs = z.object({
  event_id: z.number().int().positive(),
  occurrence_key: z.string().optional(),
});
const updateEventArgs = updateEventSchema.extend({
  event_id: z.number().int().positive(),
  // 模型可能把规则拆成独立字段传，这里复用同一份结构化校验
  recurrence: recurrenceSchema.nullish(),
});
const deleteEventArgs = z.object({
  event_id: z.number().int().positive(),
  scope: z.enum(['series', 'this']).optional(),
  occurrence_key: z.string().optional(),
  reason: z.string().optional(),
});
const restoreOccurrenceArgs = z.object({
  event_id: z.number().int().positive(),
  occurrence_key: z.string().min(1),
});
/** v0.4.0：农历换算入参 */
const resolveLunarArgs = z.object({
  lunar_year: z.number().int().min(1900).max(2100),
  month: z.number().int().min(1).max(12),
  day: z.number().int().min(1).max(30),
});
const batchEventsArgs = batchEventsSchema;

export interface ToolResult {
  ok: boolean;
  tool: string;
  /** 直接展示给客户端的日程数据（v0.1.0） */
  events?: EventDTO[];
  /** v0.2.0：循环系列卡片 */
  series?: SeriesDTO[];
  /** v0.2.0：循环实例卡片 */
  occurrences?: OccurrenceDTO[];
  summary: string;
  error?: string;
  /** 危险工具：已挂起等待确认 */
  pending?: {
    pendingActionId: string;
    action: string;
    /** 日程类危险操作的影响对象 */
    affectedEvents?: EventDTO[];
    count: number;
    description: string;
  };
  /** 需要用户澄清 */
  clarify?: {
    question: string;
    /** event：候选日程 */
    kind: 'event';
    candidatesEvents?: EventDTO[];
  };
  data?: Record<string, unknown>;
}

export interface ResolvedDangerousAction {
  tool: string;
  resolvedParams: Record<string, unknown>;
  /** 日程类危险操作的影响对象 */
  affectedEvents?: EventDTO[];
  description: string;
}

/** 工具执行上下文：时区用于日程按自然日筛选与可读时间格式化 */
export interface ToolContext {
  conversationId?: number;
  traceId?: string;
  /** 东八区为 480，缺省按 UTC 处理 */
  tzOffsetMinutes?: number;
  /** 客户端 IANA 时区（如 Asia/Shanghai），作为日程查询与循环规则的兜底时区 */
  timezone?: string;
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

/** 把日程时段格式化为用户时区下的可读文本，例如「9月18日 15:00–16:00」 */
function formatEventRange(
  event: { start_at: string; end_at: string; all_day: boolean },
  offsetMinutes = 0
): string {
  const shift = (iso: string) => new Date(new Date(iso).getTime() + offsetMinutes * 60_000);
  const s = shift(event.start_at);
  const e = shift(event.end_at);
  const day = `${s.getUTCMonth() + 1}月${s.getUTCDate()}日`;
  if (event.all_day) return `${day} 全天`;
  const time = (d: Date) => `${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}`;
  const crossDay = s.getUTCDate() !== e.getUTCDate();
  return crossDay
    ? `${day} ${time(s)} – ${e.getUTCMonth() + 1}月${e.getUTCDate()}日 ${time(e)}`
    : `${day} ${time(s)}–${time(e)}`;
}

/** 循环冲突按日期分组的可读摘要（喂给模型，让它先陈述冲突再决定） */
function formatConflictDates(groups: ConflictDateGroup[], datesTotal: number, total: number): string {
  const head = groups
    .map((g) => `${g.date}（${g.conflicts.length} 次：${g.conflicts.map((c) => c.title).join('、')}）`)
    .join('；');
  const tail = datesTotal > groups.length ? `，等共 ${datesTotal} 个日期` : '';
  return `未来 90 天内与已有安排冲突：${head}${tail}，合计 ${total} 次冲突`;
}

function safeParseArgs<T extends z.ZodTypeAny>(schema: T, args: unknown, tool: string): z.infer<T> {
  const result = schema.safeParse(args);
  if (!result.success) {
    const detail = result.error.issues
      .map((i) => `${i.path.join('.') || '参数'} ${i.message}`)
      .join('；');
    throw AppError.toolExecFailed(`工具 ${tool} 参数不合法：${detail}`);
  }
  return result.data;
}

/** 记录工具调用审计（对应系统设计文档 9.2 与 PRD 6.5） */
async function audit(params: {
  userId: number;
  conversationId?: number;
  toolName: string;
  args: unknown;
  result?: unknown;
  success: boolean;
  error?: string;
  latencyMs: number;
  traceId?: string;
}): Promise<void> {
  try {
    await query(
      `INSERT INTO tool_invocations
         (user_id, conversation_id, tool_name, arguments, result, success, error, latency_ms, trace_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        params.userId,
        params.conversationId ?? null,
        params.toolName,
        JSON.stringify(params.args ?? {}),
        params.result ? JSON.stringify(params.result) : null,
        params.success,
        params.error ?? null,
        params.latencyMs,
        params.traceId ?? null,
      ]
    );
  } catch (err) {
    logger.warn('写入工具审计失败', { error: (err as Error).message, tool: params.toolName });
  }
}

async function runTool(
  userId: number,
  toolName: string,
  handler: () => Promise<ToolResult>,
  auditCtx: { args: unknown; conversationId?: number; traceId?: string }
): Promise<ToolResult> {
  const start = Date.now();
  try {
    const result = await handler();
    await audit({
      userId,
      conversationId: auditCtx.conversationId,
      toolName,
      args: auditCtx.args,
      result:
        result.events || result.series || result.occurrences
          ? {
              count:
                (result.events?.length ?? 0) +
                (result.series?.length ?? 0) +
                (result.occurrences?.length ?? 0),
            }
          : undefined,
      success: true,
      latencyMs: Date.now() - start,
      traceId: auditCtx.traceId,
    });
    return result;
  } catch (err) {
    const message = err instanceof AppError ? err.message : (err as Error).message;
    await audit({
      userId,
      conversationId: auditCtx.conversationId,
      toolName,
      args: auditCtx.args,
      success: false,
      error: message,
      latencyMs: Date.now() - start,
      traceId: auditCtx.traceId,
    });
    return { ok: false, tool: toolName, summary: `工具执行失败：${message}`, error: message };
  }
}

/** 识别 eventService 返回的是系列还是实例 */
function eventPayload(event: EventDTO | null): Pick<ToolResult, 'series' | 'occurrences' | 'events'> {
  if (!event) return {};
  if ('occurrence_key' in event) return { occurrences: [event as OccurrenceDTO] };
  if (event.recurrence) return { series: [event as SeriesDTO] };
  return { events: [event] };
}

export const toolExecutor = {
  /**
   * 执行只读工具与安全写工具（创建/编辑/完成/清单增改），
   * 危险工具必须走 prepareDangerousAction → 用户确认 → executeConfirmedAction。
   */
  async execute(
    userId: number,
    toolName: string,
    args: unknown,
    ctx: ToolContext = {}
  ): Promise<ToolResult> {
    if (!isKnownTool(toolName)) {
      return {
        ok: false,
        tool: toolName,
        summary: `不支持的工具：${toolName}`,
        error: 'unsupported_tool',
      };
    }
    // 按参数判定危险度：delete_event 的「仅取消本次」可直接执行
    if (isDangerousCall(toolName, args)) {
      return {
        ok: false,
        tool: toolName,
        summary: '该操作需要用户确认后才能执行',
        error: 'requires_confirmation',
      };
    }

    return runTool(userId, toolName, () => this.dispatch(userId, toolName, args, ctx), {
      args,
      conversationId: ctx.conversationId,
      traceId: ctx.traceId,
    });
  },

  async dispatch(
    userId: number,
    toolName: string,
    args: unknown,
    ctx: ToolContext = {}
  ): Promise<ToolResult> {
    switch (toolName) {
      /* ------------------- v0.1.0 / v0.2.0 日程工具 ------------------- */

      case 'create_event': {
        // v0.9.0：任务日程已下线，携带旧字段（event_type / task_id）的模型输出显式拒绝
        rejectRetiredParams(args, `工具 ${toolName} 参数`);
        const parsed = safeParseArgs(createEventSchema, args, toolName);
        const offset = ctx.tzOffsetMinutes ?? 0;
        const result = await eventService.create(
          userId,
          {
            title: parsed.title ?? null,
            note: parsed.note ?? null,
            location: parsed.location ?? null,
            all_day: parsed.all_day,
            start_at: parsed.start_at,
            end_at: parsed.end_at,
            recurrence: parsed.recurrence ?? null,
          },
          'chat',
          { confirmConflict: parsed.confirm_conflict === true, tz: ctx.timezone ?? null }
        );

        // 冲突未确认：不落库，把冲突交给模型先告知用户
        if (!result.saved) {
          if (result.conflict_scope === 'series') {
            const groups = result.conflict_dates ?? [];
            return {
              ok: true,
              tool: toolName,
              summary:
                formatConflictDates(
                  groups,
                  result.conflict_dates_total ?? groups.length,
                  result.conflict_total ?? 0
                ) +
                '。尚未保存，请先把冲突日期告知用户，并询问「仍要保存，还是换个时间/规则」。',
              data: {
                saved: false,
                need_conflict_confirmation: true,
                scope: 'series',
                conflict_level: result.conflict_level,
                conflict_dates: groups,
                conflict_dates_total: result.conflict_dates_total ?? groups.length,
                conflict_total: result.conflict_total ?? 0,
              },
            };
          }
          return {
            ok: true,
            tool: toolName,
            summary: `该时段与已有安排冲突：${result.conflicts
              .map((c) => `${formatEventRange(c, offset)} ${c.title}`)
              .join('；')}。尚未保存，请先告知用户冲突并询问「仍要安排还是换个时间」。`,
            data: {
              saved: false,
              need_conflict_confirmation: true,
              conflict_level: result.conflict_level,
              conflicts: result.conflicts,
            },
          };
        }

        const event = result.event as EventDTO;
        const payload = eventPayload(event);
        if (payload.series) {
          const series = payload.series[0];
          logger.info('series_created', { user_id: userId, source: 'chat', freq: series.recurrence?.freq });
          return {
            ok: true,
            tool: toolName,
            series: payload.series,
            summary:
              `已创建循环日程「${series.title}」：${series.recurrence_summary}` +
              (series.next_occurrence
                ? `，下一次 ${formatEventRange(
                    { start_at: series.next_occurrence, end_at: series.next_occurrence, all_day: series.all_day },
                    offset
                  )}`
                : '') +
              `，共 ${series.total_count} 次。`,
          };
        }
        return {
          ok: true,
          tool: toolName,
          events: [event],
          summary: `已创建日程「${event.title}」（${formatEventRange(event, offset)}）`,
        };
      }

      case 'update_event': {
        // v0.9.0：编辑不再接受 event_type / task_id（携带即拒绝 1001）
        rejectRetiredParams(args, `工具 ${toolName} 参数`);
        const parsed = safeParseArgs(updateEventArgs, args, toolName);
        const offset = ctx.tzOffsetMinutes ?? 0;
        const scope = parsed.scope ?? 'series';
        if ((scope === 'this' || scope === 'following') && !parsed.occurrence_key) {
          return {
            ok: true,
            tool: toolName,
            summary:
              '按次修改需要 occurrence_key（本次实例的原始开始时间），它必须来自 list_events / get_event 的返回。' +
              '请先查询该系列实例后再调用。',
            error: 'missing_occurrence_key',
          };
        }
        const result = await eventService.update(
          userId,
          parsed.event_id,
          {
            title: parsed.title,
            note: parsed.note,
            location: parsed.location,
            all_day: parsed.all_day,
            start_at: parsed.start_at,
            end_at: parsed.end_at,
            recurrence: parsed.recurrence ?? undefined,
          },
          {
            confirmConflict: parsed.confirm_conflict === true,
            scope,
            occurrenceKey: parsed.occurrence_key,
            tz: ctx.timezone ?? null,
          }
        );

        if (!result.saved) {
          if (result.conflict_scope === 'series') {
            const groups = result.conflict_dates ?? [];
            return {
              ok: true,
              tool: toolName,
              summary:
                formatConflictDates(
                  groups,
                  result.conflict_dates_total ?? groups.length,
                  result.conflict_total ?? 0
                ) +
                '。尚未保存，请先把冲突日期告知用户，并询问「仍要保存，还是换个时间/规则」。',
              data: {
                saved: false,
                need_conflict_confirmation: true,
                scope: 'series',
                conflict_level: result.conflict_level,
                conflict_dates: groups,
                conflict_dates_total: result.conflict_dates_total ?? groups.length,
                conflict_total: result.conflict_total ?? 0,
              },
            };
          }
          return {
            ok: true,
            tool: toolName,
            summary: `改期后与已有安排冲突：${result.conflicts
              .map((c) => `${formatEventRange(c, offset)} ${c.title}`)
              .join('；')}。尚未保存，请先告知用户冲突并询问处理方式。`,
            data: {
              saved: false,
              need_conflict_confirmation: true,
              scope: result.conflict_scope ?? 'occurrence',
              conflict_level: result.conflict_level,
              conflicts: result.conflicts,
            },
          };
        }

        const event = result.event as EventDTO;
        const scopeLabel = scope === 'this' ? '本次' : scope === 'following' ? '本次及以后' : '整条';
        const payload = eventPayload(event);
        if (payload.occurrences) {
          const inst = payload.occurrences[0];
          return {
            ok: true,
            tool: toolName,
            occurrences: payload.occurrences,
            summary: `已更新「${inst.title}」的${scopeLabel}安排（${formatEventRange(inst, offset)}）${
              inst.override_state === 'modified' ? '，该次已标记为「已调整」' : ''
            }`,
          };
        }
        if (payload.series) {
          const series = payload.series[0];
          const derivedHint = result.derived
            ? `。原系列已截断，新的循环从本次开始（${series.recurrence_summary}）`
            : '';
          return {
            ok: true,
            tool: toolName,
            series: payload.series,
            summary: `已更新循环日程「${series.title}」：${series.recurrence_summary}${derivedHint}`,
          };
        }
        return {
          ok: true,
          tool: toolName,
          events: [event],
          summary: `已更新日程「${event.title}」（${formatEventRange(event, offset)}）`,
        };
      }

      case 'get_event': {
        const parsed = safeParseArgs(getEventArgs, args, toolName);
        const offset = ctx.tzOffsetMinutes ?? 0;
        const event = await eventService.get(userId, parsed.event_id, {
          occurrenceKey: parsed.occurrence_key ?? null,
          tz: ctx.timezone ?? null,
        });
        if ('occurrence_key' in event) {
          const inst = event as OccurrenceDTO;
          return {
            ok: true,
            tool: toolName,
            occurrences: [inst],
            summary:
              `循环日程「${inst.title}」本次安排：${formatEventRange(inst, offset)}` +
              `（${inst.recurrence_summary}，override_state=${inst.override_state}）`,
          };
        }
        if (event.recurrence) {
          const series = event as SeriesDTO;
          return {
            ok: true,
            tool: toolName,
            series: [series],
            summary:
              `循环日程「${series.title}」：${series.recurrence_summary}` +
              (series.next_occurrence
                ? `，下一次 ${formatEventRange(
                    {
                      start_at: series.next_occurrence,
                      end_at: series.next_occurrence,
                      all_day: series.all_day,
                    },
                    offset
                  )}`
                : '') +
              `，共 ${series.total_count} 次`,
          };
        }
        const overlap =
          event.conflicts && event.conflicts.length > 0
            ? `，与 ${event.conflicts.length} 个日程时间重叠`
            : '';
        return {
          ok: true,
          tool: toolName,
          events: [event],
          summary: `日程「${event.title}」（${formatEventRange(event, offset)}）${overlap}`,
        };
      }

      case 'list_events': {
        const parsed = safeParseArgs(listEventsSchema, args, toolName);
        // 模型未给 tz 时按客户端时区兜底，保证「今天/今天下午」的自然日边界正确
        const tz = parsed.tz ?? ctx.timezone ?? eventService.defaultTz();
        const events = await eventService.list(userId, { ...parsed, tz });
        const occurrences = events.filter((e) => 'occurrence_key' in e) as OccurrenceDTO[];
        return {
          ok: true,
          tool: toolName,
          events,
          occurrences: occurrences.length ? occurrences : undefined,
          summary: events.length
            ? `查询到 ${events.length} 项日程安排${
                occurrences.length ? `（其中 ${occurrences.length} 项来自循环日程）` : ''
              }`
            : '这段时间没有日程安排',
        };
      }

      case 'search_events': {
        const parsed = safeParseArgs(searchEventsSchema, args, toolName);
        const events = await eventService.search(userId, parsed.keyword);
        const series = events.filter((e) => e.recurrence) as SeriesDTO[];
        return {
          ok: true,
          tool: toolName,
          events,
          series: series.length ? series : undefined,
          summary: events.length
            ? `搜索到 ${events.length} 项与「${parsed.keyword}」相关的日程${
                series.length ? `（其中 ${series.length} 项是循环日程）` : ''
              }`
            : `没有找到与「${parsed.keyword}」相关的日程`,
        };
      }

      case 'resolve_lunar_date': {
        // v0.4.0：农历 → 公历换算（只读，供"单次农历日期"创建前查证公历日期）
        const parsed = safeParseArgs(resolveLunarArgs, args, toolName);
        try {
          const { results } = await eventService.resolveLunar({
            lunarYear: parsed.lunar_year,
            month: parsed.month,
            day: parsed.day,
            n: 1,
          });
          const hit = results[0];
          return {
            ok: true,
            tool: toolName,
            data: hit,
            summary:
              `农历${hit.month_label}${hit.day_label}` +
              `对应公历 ${hit.gregorian_date}${hit.festival ? `（${hit.festival}）` : ''}` +
              (hit.clamped ? '，该农历月为小月，已落到当月最后一天' : ''),
          };
        } catch (err) {
          return {
            ok: false,
            tool: toolName,
            summary: err instanceof AppError ? err.message : '农历日期换算失败',
          };
        }
      }

      case 'restore_occurrence': {
        const parsed = safeParseArgs(restoreOccurrenceArgs, args, toolName);
        const occurrence = await eventService.restoreOccurrence(
          userId,
          parsed.event_id,
          parsed.occurrence_key,
          ctx.timezone ?? null
        );
        if (!occurrence) {
          return {
            ok: true,
            tool: toolName,
            summary: '该次安排在当前规则下已不存在，无法恢复。',
            data: { restored: false },
          };
        }
        return {
          ok: true,
          tool: toolName,
          occurrences: [occurrence],
          summary: `已恢复「${occurrence.title}」的本次安排（${formatEventRange(
            occurrence,
            ctx.tzOffsetMinutes ?? 0
          )}）`,
          data: { restored: true },
        };
      }

      case 'delete_event': {
        // 只有 scope=this 会走到这里（series 走危险确认链路）
        const parsed = safeParseArgs(deleteEventArgs, args, toolName);
        if (!parsed.occurrence_key) {
          return {
            ok: true,
            tool: toolName,
            summary: '取消单次安排需要 occurrence_key，它必须来自 list_events / get_event 的返回。',
            error: 'missing_occurrence_key',
          };
        }
        const result = await eventService.remove(userId, parsed.event_id, {
          scope: 'this',
          occurrenceKey: parsed.occurrence_key,
          tz: ctx.timezone ?? null,
        });
        const occurrence = result.occurrence as OccurrenceDTO;
        return {
          ok: true,
          tool: toolName,
          occurrences: [occurrence],
          summary:
            `已取消「${occurrence.title}」的本次安排（${formatEventRange(
              occurrence,
              ctx.tzOffsetMinutes ?? 0
            )}），其他次数不受影响；如需恢复可以说「恢复那次安排」。`,
        };
      }

      case 'clarify_event_selection': {
        const parsed = safeParseArgs(clarifyEventSchema, args, toolName);
        const candidates: EventDTO[] = [];
        for (const id of parsed.candidate_event_ids ?? []) {
          try {
            candidates.push(await eventService.get(userId, id));
          } catch {
            // 幻觉 ID 跳过，不阻塞澄清
          }
        }
        return {
          ok: true,
          tool: toolName,
          events: candidates,
          clarify: { question: parsed.question, kind: 'event', candidatesEvents: candidates },
          summary: `需要用户澄清：${parsed.question}`,
        };
      }

      default:
        return { ok: false, tool: toolName, summary: `不支持的工具：${toolName}`, error: 'unsupported_tool' };
    }
  },

  /**
   * v0.2.0：循环日程的写操作未指定作用域时，先返回澄清需求（禁止默认按整条执行）。
   * 返回 null 表示无需澄清。
   */
  async needsScopeClarification(
    userId: number,
    toolName: string,
    args: unknown,
    ctx: ToolContext = {}
  ): Promise<{ series_id: number; title: string; tool: 'update_event' | 'delete_event'; options: string[] } | null> {
    if (toolName !== 'delete_event' && toolName !== 'update_event') return null;
    const raw = (args ?? {}) as Record<string, unknown>;
    if (raw.scope !== undefined || raw.occurrence_key) return null;
    // 改重复规则必然作用于整条系列，无需追问作用域
    if (toolName === 'update_event' && raw.recurrence !== undefined) return null;
    const eventId = Number(raw.event_id);
    if (!Number.isInteger(eventId) || eventId <= 0) return null;
    try {
      const event = await eventService.get(userId, eventId, { tz: ctx.timezone ?? null });
      if (!event.recurrence) return null;
      return {
        series_id: event.id,
        title: event.title,
        tool: toolName,
        options: toolName === 'delete_event' ? ['this', 'series'] : ['this', 'following', 'series'],
      };
    } catch {
      // 不存在/越权交给后续正常链路报错，不在澄清阶段吞掉
      return null;
    }
  },

  /** 危险工具：只做预取与参数固化，不写业务数据 */
  async prepare(
    userId: number,
    toolName: string,
    args: unknown,
    ctx: ToolContext = {}
  ): Promise<ResolvedDangerousAction> {
    const start = Date.now();
    try {
      const action = await this.resolveDangerous(userId, toolName, args, ctx);
      await audit({
        userId,
        conversationId: ctx.conversationId,
        toolName: `${toolName}:prepare`,
        args,
        result: { count: action.affectedEvents?.length ?? 0 },
        success: true,
        latencyMs: Date.now() - start,
        traceId: ctx.traceId,
      });
      return action;
    } catch (err) {
      const message = err instanceof AppError ? err.message : (err as Error).message;
      await audit({
        userId,
        conversationId: ctx.conversationId,
        toolName: `${toolName}:prepare`,
        args,
        success: false,
        error: message,
        latencyMs: Date.now() - start,
        traceId: ctx.traceId,
      });
      throw err;
    }
  },

  async resolveDangerous(
    userId: number,
    toolName: string,
    args: unknown,
    ctx: ToolContext = {}
  ): Promise<ResolvedDangerousAction> {
    switch (toolName) {
      case 'delete_event': {
        const parsed = safeParseArgs(deleteEventArgs, args, toolName);
        const event = await eventService.get(userId, parsed.event_id, { tz: ctx.timezone ?? null });
        // 循环系列：删除整条不可恢复，文案需含规则/下一次时间与总次数（TC-CHAT-092）
        if (event.recurrence) {
          const series = event as SeriesDTO;
          const nextHint = series.next_occurrence
            ? `，下一次 ${formatEventRange(
                {
                  start_at: series.next_occurrence,
                  end_at: series.next_occurrence,
                  all_day: series.all_day,
                },
                ctx.tzOffsetMinutes ?? 0
              )}`
            : '（已无后续安排）';
          return {
            tool: toolName,
            resolvedParams: { event_id: series.id, scope: 'series' },
            affectedEvents: [event],
            description:
              `删除整条循环日程「${series.title}」（${series.recurrence_summary}${nextHint}）` +
              `，共 ${series.total_count} 次安排将全部删除，删除后不可恢复`,
          };
        }
        return {
          tool: toolName,
          resolvedParams: { event_id: event.id, scope: 'series' },
          affectedEvents: [event],
          description: `删除日程「${event.title}」（${formatEventRange(
            event,
            ctx.tzOffsetMinutes ?? 0
          )}），删除后不可恢复`,
        };
      }

      case 'batch_update_events': {
        const parsed = safeParseArgs(batchEventsArgs, args, toolName);
        // 模型只表达「取消/删除」而不传 update 时视为批量删除（与工具描述一致），
        // 否则会误报参数错误而无法进入确认流程。
        const isDelete = parsed.delete === true || parsed.update === undefined;
        const { filter: rawFilter, update: rawUpdate } = parsed;
        const filter = {
          ...rawFilter,
          tz: rawFilter.tz ?? ctx.timezone ?? eventService.defaultTz(),
          keyword: rawFilter.keyword ?? undefined,
        };
        if (!filter.date && !filter.date_from && !filter.date_to && !filter.keyword) {
          throw AppError.paramInvalid('批量操作必须指定时间范围或关键词，请向用户确认范围');
        }

        const targets = await eventService.listAll(userId, filter);
        const changes: string[] = [];
        const update: Record<string, unknown> = {};
        if (!isDelete && rawUpdate) {
          if (rawUpdate.start_at !== undefined) {
            update.start_at = rawUpdate.start_at;
            changes.push('开始时间');
          }
          if (rawUpdate.end_at !== undefined) {
            update.end_at = rawUpdate.end_at;
            changes.push('结束时间');
          }
          if (rawUpdate.all_day !== undefined) {
            update.all_day = rawUpdate.all_day;
            changes.push('全天设置');
          }
          if (rawUpdate.location !== undefined) {
            update.location = rawUpdate.location;
            changes.push('地点');
          }
          if (rawUpdate.note !== undefined) update.note = rawUpdate.note;
        }
        if (!isDelete && Object.keys(update).length === 0) {
          throw AppError.paramInvalid('批量操作必须指定要修改的字段，或明确表示删除');
        }

        return {
          tool: toolName,
          resolvedParams: { event_ids: targets.map((e) => e.id), update: isDelete ? null : update },
          affectedEvents: targets,
          description: isDelete
            ? `批量删除 ${targets.length} 个日程`
            : `批量修改 ${targets.length} 个日程（${changes.join('、')}）`,
        };
      }

      default:
        throw AppError.paramInvalid(`工具 ${toolName} 不是危险操作`);
    }
  },

  /** 用户确认后按已固化的参数精确执行 */
  async executeConfirmed(
    userId: number,
    toolName: string,
    resolvedParams: Record<string, unknown>,
    ctx: ToolContext = {}
  ): Promise<ToolResult> {
    return runTool(
      userId,
      `${toolName}:confirmed`,
      async () => {
        switch (toolName) {
          case 'delete_event': {
            const eventId = Number(resolvedParams.event_id);
            const event = await eventService.get(userId, eventId, { tz: ctx.timezone ?? null });
            await eventService.remove(userId, eventId, { scope: 'series' });
            const seriesHint = event.recurrence
              ? `（整条循环日程共 ${(event as SeriesDTO).total_count} 次安排）`
              : '';
            return {
              ok: true,
              tool: toolName,
              events: [event],
              summary: `已删除日程「${event.title}」${seriesHint}`,
            };
          }

          case 'batch_update_events': {
            const ids = (resolvedParams.event_ids as number[]) ?? [];
            const update = resolvedParams.update as Record<string, unknown> | null;
            if (update === null || update === undefined) {
              const removed = await eventService.removeByIds(userId, ids);
              return {
                ok: true,
                tool: toolName,
                events: removed,
                summary: `已删除 ${removed.length} 个日程`,
              };
            }
            const updated = await eventService.batchUpdateByIds(userId, ids, update);
            return {
              ok: true,
              tool: toolName,
              events: updated,
              summary: `已更新 ${updated.length} 个日程`,
            };
          }

          default:
            return { ok: false, tool: toolName, summary: `不支持的工具：${toolName}`, error: 'unsupported_tool' };
        }
      },
      { args: resolvedParams, conversationId: ctx.conversationId, traceId: ctx.traceId }
    );
  },
};
