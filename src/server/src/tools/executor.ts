import { z } from 'zod';
import { query } from '../db/pool';
import { AppError } from '../common/errors';
import { logger } from '../common/logger';
import { taskService } from '../modules/task/task.service';
import { listService } from '../modules/list/list.service';
import { eventService } from '../modules/event/event.service';
import type { TaskDTO, TaskFilter } from '../modules/task/types';
import type { EventDTO } from '../modules/event/types';
import {
  batchEventsSchema,
  clarifyEventSchema,
  createEventSchema,
  listEventsSchema,
  searchEventsSchema,
  updateEventSchema,
} from '../modules/event/schema';
import { isDangerousTool, isKnownTool } from '../llm/tools';

const priorityEnum = z.enum(['none', 'low', 'medium', 'high']);
const statusEnum = z.enum(['todo', 'completed']);
/** 模型给出的时间可能是带时区的 ISO，也可能是空串（表示清除） */
const dueAtField = z.union([z.string(), z.null()]).optional();

const createTaskArgs = z.object({
  title: z.string().min(1),
  note: z.string().nullish(),
  priority: priorityEnum.optional(),
  due_at: dueAtField,
  list_name: z.string().nullish(),
  list_id: z.number().int().positive().nullish(),
});

const updateTaskArgs = z.object({
  task_id: z.number().int().positive(),
  title: z.string().optional(),
  note: z.string().nullish(),
  priority: priorityEnum.optional(),
  due_at: dueAtField,
  list_name: z.string().nullish(),
  list_id: z.number().int().positive().nullish(),
});

const updateStatusArgs = z.object({
  task_id: z.number().int().positive(),
  status: statusEnum,
});

const getTaskArgs = z.object({ task_id: z.number().int().positive() });

const listTasksArgs = z.object({
  list_name: z.string().nullish(),
  list_id: z.number().int().positive().nullish(),
  status: statusEnum.optional(),
  priority: priorityEnum.optional(),
  due_from: z.string().nullish(),
  due_to: z.string().nullish(),
  sort: z.string().optional(),
  limit: z.number().int().positive().max(200).optional(),
});

const searchTasksArgs = z.object({ keyword: z.string().min(1) });

const createListArgs = z.object({ name: z.string().min(1) });

const renameListArgs = z
  .object({
    list_id: z.number().int().positive().optional(),
    list_name: z.string().nullish(),
    name: z.string().min(1),
  })
  .refine((v) => v.list_id !== undefined || (v.list_name && v.list_name.trim()), {
    message: '必须提供 list_id 或 list_name',
  });

const deleteTaskArgs = z.object({
  task_id: z.number().int().positive(),
  reason: z.string().optional(),
});

const deleteListArgs = z
  .object({
    list_id: z.number().int().positive().optional(),
    list_name: z.string().nullish(),
  })
  .refine((v) => v.list_id !== undefined || (v.list_name && v.list_name.trim()), {
    message: '必须提供 list_id 或 list_name',
  });

const batchFilterArgs = z.object({
  list_name: z.string().nullish(),
  list_id: z.number().int().positive().nullish(),
  status: statusEnum.optional(),
  priority: priorityEnum.optional(),
  due_before: z.string().nullish(),
  due_after: z.string().nullish(),
  keyword: z.string().nullish(),
});

const batchUpdateArgs = z.object({
  filter: batchFilterArgs,
  update: z.object({
    priority: priorityEnum.optional(),
    due_at: dueAtField,
    status: statusEnum.optional(),
    list_name: z.string().nullish(),
    list_id: z.number().int().positive().nullish(),
  }),
});

const clarifyArgs = z.object({
  question: z.string().min(1),
  candidate_task_ids: z.array(z.number().int().positive()).optional(),
  pending_intent: z.string().optional(),
});

/** 日程工具入参：REST 侧 schema 复用同一份定义，仅补充/复用工具特有字段 */
const getEventArgs = z.object({ event_id: z.number().int().positive() });
const updateEventArgs = updateEventSchema.extend({ event_id: z.number().int().positive() });
const deleteEventArgs = z.object({
  event_id: z.number().int().positive(),
  reason: z.string().optional(),
});
const batchEventsArgs = batchEventsSchema;

export interface ToolResult {
  ok: boolean;
  tool: string;
  /** 直接展示给客户端的任务数据 */
  tasks?: TaskDTO[];
  /** 直接展示给客户端的日程数据（v0.1.0） */
  events?: EventDTO[];
  summary: string;
  error?: string;
  /** 危险工具：已挂起等待确认 */
  pending?: {
    pendingActionId: string;
    action: string;
    affected: TaskDTO[];
    /** 日程类危险操作的影响对象 */
    affectedEvents?: EventDTO[];
    count: number;
    description: string;
  };
  /** 需要用户澄清 */
  clarify?: {
    question: string;
    /** task：候选任务；event：候选日程 */
    kind: 'task' | 'event';
    candidates: TaskDTO[];
    candidatesEvents?: EventDTO[];
  };
  data?: Record<string, unknown>;
}

export interface ResolvedDangerousAction {
  tool: string;
  resolvedParams: Record<string, unknown>;
  affected: TaskDTO[];
  /** 日程类危险操作的影响对象（与 affected 互斥使用） */
  affectedEvents?: EventDTO[];
  description: string;
}

/** 工具执行上下文：时区用于日程按自然日筛选与可读时间格式化 */
export interface ToolContext {
  conversationId?: number;
  traceId?: string;
  /** 东八区为 480，缺省按 UTC 处理 */
  tzOffsetMinutes?: number;
  /** 客户端 IANA 时区（如 Asia/Shanghai），作为日程查询按日的兜底时区 */
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

/** 按名称解析清单，找不到返回 null（不报错，交由调用方给出提示） */
async function resolveListIdByName(userId: number, name?: string | null): Promise<number | null> {
  if (!name || !name.trim()) return null;
  const found = await listService.findByName(userId, name);
  return found ? found.id : null;
}

/**
 * 解析要操作的清单：优先 ID，其次按名称匹配；
 * 都失败时抛出带清单列表的错误信息，便于模型据此向用户澄清。
 */
async function resolveTargetListId(
  userId: number,
  listId?: number,
  listName?: string | null
): Promise<number> {
  if (listId) return listId;
  const byName = await resolveListIdByName(userId, listName);
  if (byName) return byName;
  const lists = await listService.listByUser(userId);
  throw AppError.notFound(
    `没有找到清单「${listName ?? ''}」。当前清单：${lists.map((l) => l.name).join('、')}`
  );
}

async function buildFilter(userId: number, raw: z.infer<typeof batchFilterArgs>): Promise<TaskFilter> {
  const filter: TaskFilter = {};
  if (raw.list_id) filter.list_id = raw.list_id;
  else {
    const listId = await resolveListIdByName(userId, raw.list_name);
    if (raw.list_name && listId === null) {
      // 指定的清单不存在，用一个不可能命中的条件，使结果为空
      filter.list_id = -1;
    } else if (listId) {
      filter.list_id = listId;
    }
  }
  if (raw.status) filter.status = raw.status;
  if (raw.priority) filter.priority = raw.priority;
  if (raw.due_after) filter.due_from = raw.due_after;
  if (raw.due_before) filter.due_to = raw.due_before;
  if (raw.keyword) filter.keyword = raw.keyword;
  return filter;
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
        result.tasks || result.events
          ? { count: (result.tasks?.length ?? 0) + (result.events?.length ?? 0) }
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
    if (isDangerousTool(toolName)) {
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
      case 'create_task': {
        const parsed = safeParseArgs(createTaskArgs, args, toolName);
        const listId = parsed.list_id ?? (await resolveListIdByName(userId, parsed.list_name));
        const task = await taskService.create(
          userId,
          {
            title: parsed.title,
            note: parsed.note ?? null,
            priority: parsed.priority,
            due_at: parsed.due_at ?? null,
            list_id: listId,
          },
          'chat'
        );
        const listHint =
          parsed.list_name && !listId ? `（未找到清单「${parsed.list_name}」，已放入默认清单）` : '';
        return {
          ok: true,
          tool: toolName,
          tasks: [task],
          summary: `已创建任务「${task.title}」${listHint}`,
        };
      }

      case 'update_task': {
        const parsed = safeParseArgs(updateTaskArgs, args, toolName);
        const listId =
          parsed.list_id ??
          (parsed.list_name ? await resolveListIdByName(userId, parsed.list_name) : undefined);
        const task = await taskService.update(userId, parsed.task_id, {
          title: parsed.title,
          note: parsed.note === undefined ? undefined : parsed.note ?? null,
          priority: parsed.priority,
          due_at: parsed.due_at === undefined ? undefined : parsed.due_at || null,
          list_id: listId === undefined ? undefined : listId,
        });
        return { ok: true, tool: toolName, tasks: [task], summary: `已更新任务「${task.title}」` };
      }

      case 'update_task_status': {
        const parsed = safeParseArgs(updateStatusArgs, args, toolName);
        const task = await taskService.setStatus(userId, parsed.task_id, parsed.status);
        const verb = parsed.status === 'completed' ? '已完成' : '已恢复为未完成';
        return { ok: true, tool: toolName, tasks: [task], summary: `任务「${task.title}」${verb}` };
      }

      case 'get_task': {
        const parsed = safeParseArgs(getTaskArgs, args, toolName);
        const task = await taskService.get(userId, parsed.task_id);
        return { ok: true, tool: toolName, tasks: [task], summary: `任务「${task.title}」详情已获取` };
      }

      case 'list_tasks': {
        const parsed = safeParseArgs(listTasksArgs, args, toolName);
        const filter: TaskFilter = {
          status: parsed.status,
          priority: parsed.priority,
          due_from: parsed.due_from || undefined,
          due_to: parsed.due_to || undefined,
          sort: parsed.sort,
        };
        if (parsed.list_id) filter.list_id = parsed.list_id;
        else {
          const listId = await resolveListIdByName(userId, parsed.list_name);
          if (parsed.list_name && listId === null) filter.list_id = -1;
          else if (listId) filter.list_id = listId;
        }
        const tasks = await taskService.listAll(userId, filter, parsed.limit ?? 50);
        return {
          ok: true,
          tool: toolName,
          tasks,
          summary: tasks.length ? `查询到 ${tasks.length} 个任务` : '没有符合条件的任务',
        };
      }

      case 'search_tasks': {
        const parsed = safeParseArgs(searchTasksArgs, args, toolName);
        const tasks = await taskService.search(userId, parsed.keyword);
        return {
          ok: true,
          tool: toolName,
          tasks,
          summary: tasks.length
            ? `搜索到 ${tasks.length} 个与「${parsed.keyword}」相关的任务`
            : `没有找到与「${parsed.keyword}」相关的任务`,
        };
      }

      case 'create_list': {
        const parsed = safeParseArgs(createListArgs, args, toolName);
        const list = await listService.create(userId, parsed.name);
        return {
          ok: true,
          tool: toolName,
          data: { list },
          summary: `已创建清单「${list.name}」`,
        };
      }

      case 'list_lists': {
        const lists = await listService.listByUser(userId);
        return {
          ok: true,
          tool: toolName,
          data: { lists },
          summary: lists.length
            ? `共 ${lists.length} 个清单：${lists.map((l) => `${l.name}(ID ${l.id}${l.is_default ? '，默认' : ''})`).join('、')}`
            : '暂无清单',
        };
      }

      case 'rename_list': {
        const parsed = safeParseArgs(renameListArgs, args, toolName);
        // 模型可能只给了名称，这里统一解析成真实 ID
        const listId = await resolveTargetListId(userId, parsed.list_id, parsed.list_name);
        const list = await listService.rename(userId, listId, parsed.name);
        return {
          ok: true,
          tool: toolName,
          data: { list },
          summary: `清单已重命名为「${list.name}」`,
        };
      }

      case 'clarify_task_selection': {
        const parsed = safeParseArgs(clarifyArgs, args, toolName);
        const candidates: TaskDTO[] = [];
        for (const id of parsed.candidate_task_ids ?? []) {
          try {
            candidates.push(await taskService.get(userId, id));
          } catch {
            // 候选 ID 不存在（可能是模型幻觉）时跳过，不阻塞澄清流程
          }
        }
        return {
          ok: true,
          tool: toolName,
          tasks: candidates,
          clarify: { question: parsed.question, kind: 'task', candidates, candidatesEvents: [] },
          summary: `需要用户澄清：${parsed.question}`,
        };
      }

      /* ------------------- v0.1.0 日程工具 ------------------- */

      case 'create_event': {
        const parsed = safeParseArgs(createEventSchema, args, toolName);
        const offset = ctx.tzOffsetMinutes ?? 0;
        const result = await eventService.create(
          userId,
          {
            event_type: parsed.event_type,
            task_id: parsed.task_id ?? null,
            title: parsed.title ?? null,
            note: parsed.note ?? null,
            location: parsed.location ?? null,
            all_day: parsed.all_day,
            start_at: parsed.start_at,
            end_at: parsed.end_at,
          },
          'chat',
          { confirmConflict: parsed.confirm_conflict === true }
        );

        // 冲突未确认：不落库，把冲突交给模型先告知用户
        if (!result.saved) {
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
        const kindLabel = event.event_type === 'task' ? '任务日程' : '日程';
        return {
          ok: true,
          tool: toolName,
          events: [event],
          summary: `已创建${kindLabel}「${event.title}」（${formatEventRange(event, offset)}）`,
        };
      }

      case 'update_event': {
        const parsed = safeParseArgs(updateEventArgs, args, toolName);
        const offset = ctx.tzOffsetMinutes ?? 0;
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
            event_type: parsed.event_type,
            task_id: parsed.task_id ?? undefined,
          },
          { confirmConflict: parsed.confirm_conflict === true }
        );

        if (!result.saved) {
          return {
            ok: true,
            tool: toolName,
            summary: `改期后与已有安排冲突：${result.conflicts
              .map((c) => `${formatEventRange(c, offset)} ${c.title}`)
              .join('；')}。尚未保存，请先告知用户冲突并询问处理方式。`,
            data: {
              saved: false,
              need_conflict_confirmation: true,
              conflict_level: result.conflict_level,
              conflicts: result.conflicts,
            },
          };
        }

        const event = result.event as EventDTO;
        return {
          ok: true,
          tool: toolName,
          events: [event],
          summary: `已更新日程「${event.title}」（${formatEventRange(event, offset)}）`,
        };
      }

      case 'get_event': {
        const parsed = safeParseArgs(getEventArgs, args, toolName);
        const event = await eventService.get(userId, parsed.event_id);
        const overlap =
          event.conflicts && event.conflicts.length > 0
            ? `，与 ${event.conflicts.length} 个日程时间重叠`
            : '';
        return {
          ok: true,
          tool: toolName,
          events: [event],
          summary: `日程「${event.title}」（${formatEventRange(event, ctx.tzOffsetMinutes ?? 0)}）${overlap}`,
        };
      }

      case 'list_events': {
        const parsed = safeParseArgs(listEventsSchema, args, toolName);
        // 模型未给 tz 时按客户端时区兜底，保证「今天/今天下午」的自然日边界正确
        const events = await eventService.list(userId, {
          ...parsed,
          tz: parsed.tz ?? ctx.timezone ?? eventService.defaultTz(),
        });
        return {
          ok: true,
          tool: toolName,
          events,
          summary: events.length ? `查询到 ${events.length} 项日程安排` : '这段时间没有日程安排',
        };
      }

      case 'search_events': {
        const parsed = safeParseArgs(searchEventsSchema, args, toolName);
        const events = await eventService.search(userId, parsed.keyword);
        return {
          ok: true,
          tool: toolName,
          events,
          summary: events.length
            ? `搜索到 ${events.length} 项与「${parsed.keyword}」相关的日程`
            : `没有找到与「${parsed.keyword}」相关的日程`,
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
          clarify: { question: parsed.question, kind: 'event', candidates: [], candidatesEvents: candidates },
          summary: `需要用户澄清：${parsed.question}`,
        };
      }

      default:
        return { ok: false, tool: toolName, summary: `不支持的工具：${toolName}`, error: 'unsupported_tool' };
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
        result: { count: action.affected.length },
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
      case 'delete_task': {
        const parsed = safeParseArgs(deleteTaskArgs, args, toolName);
        const task = await taskService.get(userId, parsed.task_id);
        // 删除任务会级联删除其全部任务日程，确认文案必须明示条数
        const eventCount = await eventService.countByTask(userId, task.id);
        const cascadeHint = eventCount > 0 ? `，并同时删除该任务的 ${eventCount} 条日程安排` : '';
        return {
          tool: toolName,
          resolvedParams: { task_id: task.id },
          affected: [task],
          description: `删除任务「${task.title}」（所属清单：${task.list_name}）${cascadeHint}，删除后不可恢复`,
        };
      }

      case 'delete_list': {
        const parsed = safeParseArgs(deleteListArgs, args, toolName);
        const listId = await resolveTargetListId(userId, parsed.list_id, parsed.list_name);
        const list = await listService.getOwned(userId, listId);
        if (list.is_default) {
          throw AppError.conflict('默认清单不可删除');
        }
        const tasks = await taskService.listAll(userId, { list_id: list.id }, 200);
        return {
          tool: toolName,
          resolvedParams: { list_id: list.id },
          affected: tasks,
          description: `删除清单「${list.name}」，其中 ${tasks.length} 个任务将迁移到默认清单（不会被删除）`,
        };
      }

      case 'batch_update_tasks': {
        const parsed = safeParseArgs(batchUpdateArgs, args, toolName);
        const filter = await buildFilter(userId, parsed.filter);
        if (Object.keys(filter).length === 0) {
          throw AppError.paramInvalid('批量操作必须指定筛选条件，请向用户确认范围');
        }
        const targets = await taskService.listAll(userId, filter, 200);

        const update: Record<string, unknown> = {};
        if (parsed.update.priority !== undefined) update.priority = parsed.update.priority;
        if (parsed.update.status !== undefined) update.status = parsed.update.status;
        if (parsed.update.due_at !== undefined) update.due_at = parsed.update.due_at || null;
        const updateListId =
          parsed.update.list_id ?? (await resolveListIdByName(userId, parsed.update.list_name));
        if (updateListId) update.list_id = updateListId;
        if (Object.keys(update).length === 0) {
          throw AppError.paramInvalid('批量操作必须指定要修改的字段');
        }

        const changes: string[] = [];
        if (update.priority) changes.push(`优先级改为 ${update.priority}`);
        if (update.status) changes.push(`状态改为 ${update.status === 'completed' ? '已完成' : '未完成'}`);
        if (update.due_at) changes.push(`截止时间改为 ${String(update.due_at)}`);
        if (update.list_id) changes.push('移动到指定清单');

        return {
          tool: toolName,
          resolvedParams: {
            task_ids: targets.map((t) => t.id),
            update,
          },
          affected: targets,
          description: `批量修改 ${targets.length} 个任务（${changes.join('、')}）`,
        };
      }

      case 'delete_event': {
        const parsed = safeParseArgs(deleteEventArgs, args, toolName);
        const event = await eventService.get(userId, parsed.event_id);
        const isTask = event.event_type === 'task';
        const hint = isTask
          ? `（这是任务日程，只取消该安排，关联任务「${event.title}」会被保留）`
          : '';
        return {
          tool: toolName,
          resolvedParams: { event_id: event.id },
          affected: [],
          affectedEvents: [event],
          description: `删除日程「${event.title}」（${formatEventRange(event, ctx.tzOffsetMinutes ?? 0)}）${hint}，删除后不可恢复`,
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
          task_id: rawFilter.task_id ?? undefined,
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
          affected: [],
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
          case 'delete_task': {
            const taskId = Number(resolvedParams.task_id);
            const task = await taskService.get(userId, taskId);
            await taskService.remove(userId, taskId);
            return { ok: true, tool: toolName, tasks: [task], summary: `已删除任务「${task.title}」` };
          }

          case 'delete_list': {
            const listId = Number(resolvedParams.list_id);
            const result = await listService.remove(userId, listId);
            return {
              ok: true,
              tool: toolName,
              summary: `清单已删除，其中 ${result.movedTasks} 个任务已迁移到默认清单`,
            };
          }

          case 'batch_update_tasks': {
            const ids = (resolvedParams.task_ids as number[]) ?? [];
            const update = (resolvedParams.update as Record<string, unknown>) ?? {};
            const tasks = await taskService.batchUpdateByIds(userId, ids, {
              priority: update.priority as never,
              due_at: update.due_at as never,
              status: update.status as never,
              list_id: update.list_id as never,
            });
            return {
              ok: true,
              tool: toolName,
              tasks,
              summary: `已更新 ${tasks.length} 个任务`,
            };
          }

          case 'delete_event': {
            const eventId = Number(resolvedParams.event_id);
            const event = await eventService.remove(userId, eventId);
            const hint = event.event_type === 'task' ? `，关联任务「${event.title}」已保留` : '';
            return {
              ok: true,
              tool: toolName,
              events: [event],
              summary: `已删除日程「${event.title}」${hint}`,
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