import { z } from 'zod';
import { query } from '../db/pool';
import { AppError } from '../common/errors';
import { logger } from '../common/logger';
import { taskService } from '../modules/task/task.service';
import { projectService } from '../modules/project/project.service';
import { agentService } from '../modules/agent/agent.service';
import type { AgentDTO } from '../modules/agent/types';
import { eventService } from '../modules/event/event.service';
import type { TaskDTO, TaskFilter } from '../modules/task/types';
import type { ProjectDTO } from '../modules/project/types';
import type { ProjectGroup } from '../modules/chat/chat.types';
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
import { isDangerousCall, isKnownTool } from '../llm/tools';

const priorityEnum = z.enum(['none', 'low', 'medium', 'high']);
const statusEnum = z.enum(['todo', 'completed']);
/** 模型给出的时间可能是带时区的 ISO，也可能是空串（表示清除） */
const dueAtField = z.union([z.string(), z.null()]).optional();
/** 模型可能用 0 表示「移出项目成为独立任务」 */
const projectIdField = z.union([z.number().int().min(0), z.null()]).optional();

const createTaskArgs = z.object({
  title: z.string().min(1),
  note: z.string().nullish(),
  priority: priorityEnum.optional(),
  due_at: dueAtField,
  project_id: z.number().int().positive().nullish(),
});

const createProjectArgs = z.object({
  name: z.string().min(1),
  note: z.string().nullish(),
});

const listProjectsArgs = z.object({ keyword: z.string().nullish() });

const deleteProjectArgs = z.object({
  project_id: z.number().int().positive(),
  reason: z.string().optional(),
});

const updateTaskArgs = z.object({
  task_id: z.number().int().positive(),
  title: z.string().optional(),
  note: z.string().nullish(),
  priority: priorityEnum.optional(),
  due_at: dueAtField,
  project_id: projectIdField,
});

const updateStatusArgs = z.object({
  task_id: z.number().int().positive(),
  status: statusEnum,
});

const getTaskArgs = z.object({ task_id: z.number().int().positive() });

const getProjectMembersArgs = z.object({
  project_id: z.number().int().positive(),
});

const listTasksArgs = z.object({
  status: statusEnum.optional(),
  priority: priorityEnum.optional(),
  due_from: z.string().nullish(),
  due_to: z.string().nullish(),
  sort: z.string().optional(),
  limit: z.number().int().positive().max(200).optional(),
  project_id: z.union([z.number().int().positive(), z.literal('none')]).nullish(),
});

const searchTasksArgs = z.object({ keyword: z.string().min(1) });

/** v0.7.0：智能体代理工具（指派即执行，无第二个"通知"工具） */
const listAgentsArgs = z.object({});

const assignTaskToAgentArgs = z
  .object({
    task_id: z.number().int().positive(),
    agent_id: z.number().int().positive().optional(),
    agent_name: z.string().nullish(),
    replace: z.boolean().optional(),
  })
  .refine((v) => v.agent_id !== undefined || (v.agent_name && v.agent_name.trim()), {
    message: '必须提供 agent_id 或 agent_name',
  });

const deleteTaskArgs = z.object({
  task_id: z.number().int().positive(),
  reason: z.string().optional(),
});

const batchFilterArgs = z.object({
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
  }),
});

const clarifyArgs = z.object({
  question: z.string().min(1),
  candidate_task_ids: z.array(z.number().int().positive()).optional(),
  pending_intent: z.string().optional(),
});

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
  /** 直接展示给客户端的任务数据 */
  tasks?: TaskDTO[];
  /** 直接展示给客户端的日程数据（v0.1.0） */
  events?: EventDTO[];
  /** v0.2.0：循环系列卡片 */
  series?: SeriesDTO[];
  /** v0.2.0 循环实例卡片 */
  occurrences?: OccurrenceDTO[];
  /** v0.8.0：项目结果组卡片（项目 + 一层成员任务） */
  project_groups?: ProjectGroup[];
  /** v0.8.0：项目实体（create_project / list_projects / get_project_members 等返回） */
  projects?: ProjectDTO[];
  /** v0.7.0：智能体代理数据（列表/指派结果展示） */
  agents?: AgentDTO[];
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

/** v0.7.0：按 ID 或名称解析代理（都不匹配时报错并列出可用代理，禁止编造） */
async function resolveAgentId(
  userId: number,
  agentId?: number,
  agentName?: string | null
): Promise<number> {
  const agents = await agentService.listEnabled(userId);
  if (agentId) {
    const hit = agents.find((a) => a.id === agentId);
    if (!hit) {
      throw AppError.notFound(
        `没有找到该智能体代理。当前可用代理：${agents.map((a) => `${a.name}(ID ${a.id})`).join('、') || '（无）'}`
      );
    }
    return hit.id;
  }
  const name = (agentName ?? '').trim();
  const hit = agents.find((a) => a.name === name);
  if (!hit) {
    throw AppError.notFound(
      `没有找到代理「${name}」。当前可用代理：${agents.map((a) => `${a.name}(ID ${a.id})`).join('、') || '（无）'}`
    );
  }
  return hit.id;
}

async function buildFilter(_userId: number, raw: z.infer<typeof batchFilterArgs>): Promise<TaskFilter> {
  const filter: TaskFilter = {};
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
        result.tasks || result.events || result.series || result.occurrences
          ? {
              count:
                (result.tasks?.length ?? 0) +
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
      case 'create_task': {
        const parsed = safeParseArgs(createTaskArgs, args, toolName);
        const task = await taskService.create(
          userId,
          {
            title: parsed.title,
            note: parsed.note ?? null,
            priority: parsed.priority,
            due_at: parsed.due_at ?? null,
            project_id: parsed.project_id ?? null,
          },
          'chat'
        );
        return {
          ok: true,
          tool: toolName,
          tasks: [task],
          summary: task.project
            ? `已创建任务「${task.title}」，并已作为项目成员加入「${task.project.name}」`
            : `已创建任务「${task.title}」`,
        };
      }

      case 'create_project': {
        const parsed = safeParseArgs(createProjectArgs, args, toolName);
        const project = await projectService.create(
          userId,
          { name: parsed.name, note: parsed.note ?? null },
          'chat'
        );
        return {
          ok: true,
          tool: toolName,
          projects: [project],
          summary: `已创建项目「${project.name}」，可以往里加任务`,
        };
      }

      case 'list_projects': {
        const parsed = safeParseArgs(listProjectsArgs, args, toolName);
        const keyword = (parsed.keyword ?? '').trim();
        const projects = keyword
          ? (await projectService.list(userId, { keyword })).list
          : await projectService.listAll(userId);
        return {
          ok: true,
          tool: toolName,
          projects,
          summary: projects.length
            ? `共 ${projects.length} 个项目：${projects
                .map((p) => `${p.name}(ID ${p.id}，成员 ${p.member_completed}/${p.member_total})`)
                .join('、')}`
            : keyword
              ? `没有找到名称包含「${keyword}」的项目`
              : '还没有项目',
        };
      }

      case 'update_task': {
        const parsed = safeParseArgs(updateTaskArgs, args, toolName);
        // 0 / null 都表示移出项目成为独立任务
        const projectId =
          parsed.project_id === undefined
            ? undefined
            : parsed.project_id === null || parsed.project_id === 0
              ? null
              : parsed.project_id;
        const task = await taskService.update(userId, parsed.task_id, {
          title: parsed.title,
          note: parsed.note === undefined ? undefined : parsed.note ?? null,
          priority: parsed.priority,
          due_at: parsed.due_at === undefined ? undefined : parsed.due_at || null,
          project_id: projectId,
        });
        const projectHint =
          projectId === undefined
            ? ''
            : projectId === null
              ? '，已移出项目成为独立任务'
              : `，已移入项目「${task.project?.name ?? `#${projectId}`}」`;
        return {
          ok: true,
          tool: toolName,
          tasks: [task],
          summary: `已更新任务「${task.title}」${projectHint}`,
        };
      }

      case 'update_task_status': {
        const parsed = safeParseArgs(updateStatusArgs, args, toolName);
        const task = await taskService.setStatus(userId, parsed.task_id, parsed.status);
        const verb = parsed.status === 'completed' ? '已完成' : '已恢复为未完成';
        // v0.8.0：项目不再是任务，完成成员任务只会触发项目状态自动派生
        const projectHint = task.project ? '，所属项目状态已自动更新' : '';
        return {
          ok: true,
          tool: toolName,
          tasks: [task],
          summary: `任务「${task.title}」${verb}${projectHint}`,
        };
      }

      case 'get_task': {
        const parsed = safeParseArgs(getTaskArgs, args, toolName);
        const task = await taskService.get(userId, parsed.task_id);
        const ownerHint = task.project
          ? `，属于项目「${task.project.name}」(ID ${task.project.id})`
          : '，是未归属项目的独立任务';
        return {
          ok: true,
          tool: toolName,
          tasks: [task],
          summary: `任务「${task.title}」详情已获取${ownerHint}`,
        };
      }

      case 'get_project_members': {
        const parsed = safeParseArgs(getProjectMembersArgs, args, toolName);
        const project = await projectService.get(userId, parsed.project_id);
        const { list: members } = await projectService.listMembers(userId, project.id, {});
        const group: ProjectGroup = {
          project_id: project.id,
          name: project.name,
          member_total: project.member_total,
          member_completed: project.member_completed,
          nodes: members,
        };
        return {
          ok: true,
          tool: toolName,
          tasks: members,
          projects: [project],
          project_groups: [group],
          summary: members.length
            ? `项目「${project.name}」成员 ${project.member_total} 个（已完成 ${project.member_completed} 个）：${members
                .map((m) => `${m.title}（${m.status === 'completed' ? '已完成' : '待办'}）`)
                .join('、')}`
            : `项目「${project.name}」还没有成员任务`,
        };
      }

      case 'list_tasks': {
        const parsed = safeParseArgs(listTasksArgs, args, toolName);
        const projectFilter: number | 'none' | undefined =
          parsed.project_id === 'none'
            ? 'none'
            : typeof parsed.project_id === 'number'
              ? parsed.project_id
              : undefined;
        const filter: TaskFilter = {
          status: parsed.status,
          priority: parsed.priority,
          due_from: parsed.due_from || undefined,
          due_to: parsed.due_to || undefined,
          sort: parsed.sort,
          project_id: projectFilter,
        };
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

      case 'list_agents': {
        safeParseArgs(listAgentsArgs, args, toolName);
        const agents = await agentService.listEnabled(userId);
        const payload: AgentDTO[] = agents;
        return {
          ok: true,
          tool: toolName,
          agents: payload,
          summary: agents.length
            ? `共 ${agents.length} 个可用代理：${agents
                .map((a) => `${a.name}(ID ${a.id}，${a.connection === 'online' ? '已连接' : a.connection === 'offline' ? '离线' : '未连接'}，进行中 ${a.running_count})`)
                .join('、')}`
            : '还没有可用的智能体代理',
        };
      }

      case 'assign_task_to_agent': {
        const parsed = safeParseArgs(assignTaskToAgentArgs, args, toolName);
        const agentId = await resolveAgentId(userId, parsed.agent_id, parsed.agent_name);
        // 指派即自动入队并自动下发（无第二个"通知"步骤）
        const task = await agentService.assign(userId, parsed.task_id, agentId, {
          replace: parsed.replace === true,
          source: 'chat',
        });
        const agentName = task.agent_name ?? parsed.agent_name ?? '';
        return {
          ok: true,
          tool: toolName,
          tasks: [task],
          summary: `已把任务「${task.title}」指派给代理「${agentName}」，代理将自动领取并执行（等待代理领取）`,
          data: { agent_id: agentId, agent_state: task.agent_state },
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

      /* ------------------- v0.1.0 / v0.2.0 日程工具 ------------------- */

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
            event_type: parsed.event_type,
            task_id: parsed.task_id ?? undefined,
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
          clarify: { question: parsed.question, kind: 'event', candidates: [], candidatesEvents: candidates },
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
        // 任务维度：仅自身与其任务日程（项目级联删除走 delete_project）
        const counts = await taskService.previewRemove(userId, task.id);
        const eventHint =
          counts.deleted_event_count > 0
            ? `，并同时删除 ${counts.deleted_event_count} 条日程安排`
            : '';
        return {
          tool: toolName,
          resolvedParams: { task_id: task.id },
          affected: [task],
          description: `删除任务「${task.title}」${eventHint}，删除后不可恢复`,
        };
      }

      case 'delete_project': {
        const parsed = safeParseArgs(deleteProjectArgs, args, toolName);
        const project = await projectService.get(userId, parsed.project_id);
        // 删除项目会级联删除全部成员任务及其日程，确认文案必须明示计数
        const counts = await projectService.previewRemove(userId, project.id);
        const parts: string[] = [];
        if (counts.deleted_task_count > 0) parts.push(`${counts.deleted_task_count} 个成员任务`);
        if (counts.deleted_event_count > 0) parts.push(`${counts.deleted_event_count} 条日程安排`);
        const cascadeHint = parts.length > 0 ? `，并同时删除${parts.join('及')}` : '';
        return {
          tool: toolName,
          resolvedParams: { project_id: project.id },
          affected: [],
          description: `删除项目「${project.name}」${cascadeHint}，删除后不可恢复`,
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
        if (Object.keys(update).length === 0) {
          throw AppError.paramInvalid('批量操作必须指定要修改的字段');
        }

        const changes: string[] = [];
        if (update.priority) changes.push(`优先级改为 ${update.priority}`);
        if (update.status) changes.push(`状态改为 ${update.status === 'completed' ? '已完成' : '未完成'}`);
        if (update.due_at) changes.push(`截止时间改为 ${String(update.due_at)}`);

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
        const event = await eventService.get(userId, parsed.event_id, { tz: ctx.timezone ?? null });
        const isTask = event.event_type === 'task';
        const taskHint = isTask
          ? `（这是任务日程，只取消该安排，关联任务「${event.title}」会被保留）`
          : '';
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
            affected: [],
            affectedEvents: [event],
            description:
              `删除整条循环日程「${series.title}」（${series.recurrence_summary}${nextHint}）` +
              `，共 ${series.total_count} 次安排将全部删除${taskHint}，删除后不可恢复`,
          };
        }
        return {
          tool: toolName,
          resolvedParams: { event_id: event.id, scope: 'series' },
          affected: [],
          affectedEvents: [event],
          description: `删除日程「${event.title}」（${formatEventRange(
            event,
            ctx.tzOffsetMinutes ?? 0
          )}）${taskHint}，删除后不可恢复`,
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
            const counts = await taskService.remove(userId, taskId);
            const extra: string[] = [];
            if (counts.deleted_event_count > 0) extra.push(`${counts.deleted_event_count} 条日程`);
            return {
              ok: true,
              tool: toolName,
              tasks: [task],
              summary: `已删除任务「${task.title}」${
                extra.length ? `（同时删除${extra.join('与')}）` : ''
              }`,
            };
          }

          case 'delete_project': {
            const projectId = Number(resolvedParams.project_id);
            const project = await projectService.get(userId, projectId);
            const counts = await projectService.remove(userId, projectId);
            const extra: string[] = [];
            if (counts.deleted_task_count > 0) extra.push(`${counts.deleted_task_count} 个成员任务`);
            if (counts.deleted_event_count > 0) extra.push(`${counts.deleted_event_count} 条日程`);
            return {
              ok: true,
              tool: toolName,
              summary: `已删除项目「${project.name}」${
                extra.length ? `（同时删除${extra.join('与')}）` : ''
              }`,
            };
          }

          case 'batch_update_tasks': {
            const ids = (resolvedParams.task_ids as number[]) ?? [];
            const update = (resolvedParams.update as Record<string, unknown>) ?? {};
            const tasks = await taskService.batchUpdateByIds(userId, ids, {
              priority: update.priority as never,
              due_at: update.due_at as never,
              status: update.status as never,
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
            const event = await eventService.get(userId, eventId, { tz: ctx.timezone ?? null });
            await eventService.remove(userId, eventId, { scope: 'series' });
            const isTasks = event.event_type === 'task';
            const hint = isTasks ? `，关联任务「${event.title}」已保留` : '';
            const seriesHint = event.recurrence
              ? `（整条循环日程共 ${(event as SeriesDTO).total_count} 次安排）`
              : '';
            return {
              ok: true,
              tool: toolName,
              events: [event],
              summary: `已删除日程「${event.title}」${seriesHint}${hint}`,
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
