import { z } from 'zod';
import { query } from '../db/pool';
import { AppError } from '../common/errors';
import { logger } from '../common/logger';
import { taskService } from '../modules/task/task.service';
import { listService } from '../modules/list/list.service';
import type { TaskDTO, TaskFilter } from '../modules/task/types';
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

export interface ToolResult {
  ok: boolean;
  tool: string;
  /** 直接展示给客户端的任务数据 */
  tasks?: TaskDTO[];
  summary: string;
  error?: string;
  /** 危险工具：已挂起等待确认 */
  pending?: {
    pendingActionId: string;
    action: string;
    affected: TaskDTO[];
    count: number;
  };
  /** 需要用户澄清 */
  clarify?: {
    question: string;
    candidates: TaskDTO[];
  };
  data?: Record<string, unknown>;
}

export interface ResolvedDangerousAction {
  tool: string;
  resolvedParams: Record<string, unknown>;
  affected: TaskDTO[];
  description: string;
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
      result: result.tasks ? { count: result.tasks.length } : undefined,
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
    ctx: { conversationId?: number; traceId?: string } = {}
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

    return runTool(userId, toolName, () => this.dispatch(userId, toolName, args), {
      args,
      conversationId: ctx.conversationId,
      traceId: ctx.traceId,
    });
  },

  async dispatch(userId: number, toolName: string, args: unknown): Promise<ToolResult> {
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
          clarify: { question: parsed.question, candidates },
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
    ctx: { conversationId?: number; traceId?: string } = {}
  ): Promise<ResolvedDangerousAction> {
    const start = Date.now();
    try {
      const action = await this.resolveDangerous(userId, toolName, args);
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

  async resolveDangerous(userId: number, toolName: string, args: unknown): Promise<ResolvedDangerousAction> {
    switch (toolName) {
      case 'delete_task': {
        const parsed = safeParseArgs(deleteTaskArgs, args, toolName);
        const task = await taskService.get(userId, parsed.task_id);
        return {
          tool: toolName,
          resolvedParams: { task_id: task.id },
          affected: [task],
          description: `删除任务「${task.title}」（所属清单：${task.list_name}），删除后不可恢复`,
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

      default:
        throw AppError.paramInvalid(`工具 ${toolName} 不是危险操作`);
    }
  },

  /** 用户确认后按已固化的参数精确执行 */
  async executeConfirmed(
    userId: number,
    toolName: string,
    resolvedParams: Record<string, unknown>,
    ctx: { conversationId?: number; traceId?: string } = {}
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

          default:
            return { ok: false, tool: toolName, summary: `不支持的工具：${toolName}`, error: 'unsupported_tool' };
        }
      },
      { args: resolvedParams, conversationId: ctx.conversationId, traceId: ctx.traceId }
    );
  },
};