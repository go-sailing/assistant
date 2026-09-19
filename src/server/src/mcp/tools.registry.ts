import { z } from 'zod';
import { AppError } from '../common/errors';
import { config } from '../config';
import { agentService } from '../modules/agent/agent.service';
import type { AgentState } from '../modules/agent/types';
import { waitForAgentTask } from './waiter';

/** MCP tools/call 的业务错误：走 isError，而不是 JSON-RPC error（SDD 5.6） */
export class ToolBusinessError extends Error {
  readonly bizCode: number;
  constructor(bizCode: number, message: string) {
    super(message);
    this.bizCode = bizCode;
  }
}

export interface ToolHandlerResult {
  payload: unknown;
  /** 覆盖默认 JSON 文本（用于给模型更可读的说明） */
  text?: string;
}

interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  validator: z.ZodTypeAny;
  // 各工具的入参类型由 validator 保证，这里统一为运行期已校验的载荷
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  handler: (agentId: number, args: any) => Promise<ToolHandlerResult>;
}

const stateEnum = z.enum(['pending', 'running', 'succeeded', 'failed']);
const taskIdSchema = z.number().int().positive();

const listTasksSchema = z.object({
  state: stateEnum.optional(),
  limit: z.number().int().positive().max(50).optional(),
});

const waitSchema = z.object({
  timeout_ms: z.number().int().min(0).max(25000).optional(),
});

const claimSchema = z.object({
  task_id: taskIdSchema.optional(),
});

const getTaskSchema = z.object({
  task_id: taskIdSchema,
});

const progressSchema = z.object({
  task_id: taskIdSchema,
  message: z.string().min(1).max(500),
});

const completeSchema = z.object({
  task_id: taskIdSchema,
  result: z.string().min(1).max(2000),
});

const failSchema = z.object({
  task_id: taskIdSchema,
  reason: z.string().min(1).max(500),
});

const historySchema = z.object({
  limit: z.number().int().positive().max(50).optional(),
});

function briefSummary(payload: { task_id: number; title: string; state: AgentState }): string {
  return `任务 #${payload.task_id}「${payload.title}」当前状态：${payload.state}`;
}

/** 8 个 MCP 工具的唯一定义处（JSON Schema 对外、zod 校验入参，字段一致性由测试断言） */
export const MCP_TOOLS: ToolDefinition[] = [
  {
    name: 'list_agent_tasks',
    description:
      '查询被指派给本代理的任务。缺省返回未终结任务（pending 待领取 + running 执行中）；可用 state 筛选 pending/running/succeeded/failed。',
    inputSchema: {
      type: 'object',
      properties: {
        state: {
          type: 'string',
          enum: ['pending', 'running', 'succeeded', 'failed'],
          description: '按执行状态筛选；省略则返回 pending 与 running',
        },
        limit: { type: 'integer', minimum: 1, maximum: 50, description: '返回条数上限，默认 20' },
      },
      additionalProperties: false,
    },
    validator: listTasksSchema,
    async handler(agentId, args: z.infer<typeof listTasksSchema>) {
      const tasks = await agentService.listTasksForAgent(agentId, args.state, args.limit ?? 20);
      return { payload: { tasks }, text: `共 ${tasks.length} 个任务` };
    },
  },
  {
    name: 'wait_agent_task',
    description:
      '等待新任务。队列中已有任务时立即返回；否则挂起等待，直到有新任务指派进来或超时。超时返回 task=null（不是错误），请立即再次调用以保持常驻。',
    inputSchema: {
      type: 'object',
      properties: {
        timeout_ms: {
          type: 'integer',
          minimum: 0,
          maximum: 25000,
          description: '最长等待毫秒数，默认 25000（服务端上限）',
        },
      },
      additionalProperties: false,
    },
    validator: waitSchema,
    async handler(agentId, args: z.infer<typeof waitSchema>) {
      const { task, waitedMs } = await waitForAgentTask(
        agentId,
        args.timeout_ms ?? config.agent.waitTimeoutMs
      );
      return {
        payload: { task, waited_ms: waitedMs },
        text: task ? briefSummary(task) : `等待 ${waitedMs}ms 未有新任务`,
      };
    },
  },
  {
    name: 'claim_agent_task',
    description:
      '领取任务（原子操作）。不传 task_id 时领取队列中最早入队的任务；被其他代理领取或已取消指派时返回错误。领取成功后任务进入执行中。',
    inputSchema: {
      type: 'object',
      properties: {
        task_id: { type: 'integer', description: '要领取的任务 ID；省略则领取队首任务' },
      },
      additionalProperties: false,
    },
    validator: claimSchema,
    async handler(agentId, args: z.infer<typeof claimSchema>) {
      const task = await agentService.claim(agentId, args.task_id);
      return { payload: { task }, text: `已领取：${briefSummary(task)}` };
    },
  },
  {
    name: 'get_agent_task',
    description:
      '查询单个任务的详情（含备注、优先级、截止时间、所属项目）以及本代理在该任务上的最近执行记录。仅可读取被指派给本代理的任务。',
    inputSchema: {
      type: 'object',
      properties: { task_id: { type: 'integer', description: '任务 ID' } },
      required: ['task_id'],
      additionalProperties: false,
    },
    validator: getTaskSchema,
    async handler(agentId, args: z.infer<typeof getTaskSchema>) {
      const task = await agentService.getTaskForAgent(agentId, args.task_id);
      const logs = await agentService.recentLogsForAgent(agentId, args.task_id, 10);
      return { payload: { task, logs }, text: briefSummary(task) };
    },
  },
  {
    name: 'report_task_progress',
    description: '回报执行进度（≤500 字）。任务保持执行中，用户可在执行记录里看到该进度。',
    inputSchema: {
      type: 'object',
      properties: {
        task_id: { type: 'integer', description: '任务 ID' },
        message: { type: 'string', minLength: 1, maxLength: 500, description: '进度说明' },
      },
      required: ['task_id', 'message'],
      additionalProperties: false,
    },
    validator: progressSchema,
    async handler(agentId, args: z.infer<typeof progressSchema>) {
      await agentService.reportProgress(agentId, args.task_id, args.message);
      return { payload: { ok: true }, text: '进度已记录' };
    },
  },
  {
    name: 'complete_agent_task',
    description:
      '回报完成（result ≤2000 字）。任务会被标记为已完成，并结束本次代理执行。仅执行中的任务可回报。',
    inputSchema: {
      type: 'object',
      properties: {
        task_id: { type: 'integer', description: '任务 ID' },
        result: { type: 'string', minLength: 1, maxLength: 2000, description: '结果摘要' },
      },
      required: ['task_id', 'result'],
      additionalProperties: false,
    },
    validator: completeSchema,
    async handler(agentId, args: z.infer<typeof completeSchema>) {
      await agentService.complete(agentId, args.task_id, args.result);
      return { payload: { ok: true, task_state: 'succeeded' }, text: '已回报完成' };
    },
  },
  {
    name: 'fail_agent_task',
    description:
      '回报失败（reason ≤500 字）。任务保持未完成并显示失败原因，等待用户「重新执行」。仅执行中的任务可回报。',
    inputSchema: {
      type: 'object',
      properties: {
        task_id: { type: 'integer', description: '任务 ID' },
        reason: { type: 'string', minLength: 1, maxLength: 500, description: '失败原因' },
      },
      required: ['task_id', 'reason'],
      additionalProperties: false,
    },
    validator: failSchema,
    async handler(agentId, args: z.infer<typeof failSchema>) {
      await agentService.fail(agentId, args.task_id, args.reason);
      return { payload: { ok: true, task_state: 'failed' }, text: '已回报失败' };
    },
  },
  {
    name: 'list_agent_history',
    description: '查询本代理执行过的任务（仅终态：已完成 / 失败）。',
    inputSchema: {
      type: 'object',
      properties: {
        limit: { type: 'integer', minimum: 1, maximum: 50, description: '返回条数上限，默认 20' },
      },
      additionalProperties: false,
    },
    validator: historySchema,
    async handler(agentId, args: z.infer<typeof historySchema>) {
      const tasks = await agentService.listHistory(agentId, args.limit ?? 20);
      return { payload: { tasks }, text: `共 ${tasks.length} 条历史任务` };
    },
  },
];

/** 工具表对外形态（tools/list） */
export function toolListPayload(): { tools: Array<Record<string, unknown>> } {
  return {
    tools: MCP_TOOLS.map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema,
    })),
  };
}

export function findTool(name: string): ToolDefinition | undefined {
  return MCP_TOOLS.find((tool) => tool.name === name);
}

/** 把领域错误统一转成 isError 文本（不含任何用户数据） */
export function businessErrorOf(err: unknown): ToolBusinessError {
  if (err instanceof AppError) {
    return new ToolBusinessError(err.code, err.message);
  }
  if (err instanceof ToolBusinessError) return err;
  return new ToolBusinessError(3002, '服务暂时不可用，请重试');
}
