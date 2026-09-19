import { Router } from 'express';
import { asyncHandler, ok } from '../../common/response';
import { idParam, parse } from '../../common/validate';
import { getUser } from '../../middleware/auth';
import { taskService } from '../task/task.service';
import { agentService } from './agent.service';
import {
  agentLogsQuerySchema,
  agentTasksQuerySchema,
  assignAgentSchema,
  confirmQuerySchema,
  createAgentSchema,
  updateAgentSchema,
} from './agent.schema';

export const agentRoutes = Router();

/* ---------------- 代理管理（REST） ---------------- */

agentRoutes.get(
  '/agents',
  asyncHandler(async (req, res) => {
    const user = getUser(req);
    ok(res, await agentService.list(user.id));
  })
);

agentRoutes.post(
  '/agents',
  asyncHandler(async (req, res) => {
    const user = getUser(req);
    const input = parse(createAgentSchema, req.body, '代理参数');
    ok(res, await agentService.create(user.id, input));
  })
);

agentRoutes.get(
  '/agents/:id',
  asyncHandler(async (req, res) => {
    const user = getUser(req);
    const id = parse(idParam, req.params.id, '代理 ID');
    ok(res, await agentService.get(user.id, id));
  })
);

agentRoutes.patch(
  '/agents/:id',
  asyncHandler(async (req, res) => {
    const user = getUser(req);
    const id = parse(idParam, req.params.id, '代理 ID');
    const patch = parse(updateAgentSchema, req.body, '代理参数');
    ok(res, await agentService.update(user.id, id, patch));
  })
);

agentRoutes.post(
  '/agents/:id/token/rotate',
  asyncHandler(async (req, res) => {
    const user = getUser(req);
    const id = parse(idParam, req.params.id, '代理 ID');
    ok(res, await agentService.rotateToken(user.id, id));
  })
);

agentRoutes.delete(
  '/agents/:id',
  asyncHandler(async (req, res) => {
    const user = getUser(req);
    const id = parse(idParam, req.params.id, '代理 ID');
    ok(res, await agentService.remove(user.id, id));
  })
);

/** 该代理的绑定任务（按执行状态筛选，缺省返回全部非未指派态） */
agentRoutes.get(
  '/agents/:id/tasks',
  asyncHandler(async (req, res) => {
    const user = getUser(req);
    const id = parse(idParam, req.params.id, '代理 ID');
    const query = parse(agentTasksQuerySchema, req.query, '查询参数');
    await agentService.get(user.id, id);
    ok(
      res,
      await taskService.listByAgent(user.id, id, {
        agent_state: query.state,
        page: query.page,
        page_size: query.page_size,
      })
    );
  })
);

/* ---------------- 任务侧指派（REST） ---------------- */

/** 指派：指派成功即自动入队并自动下发（无第二个"通知"接口） */
agentRoutes.post(
  '/tasks/:id/agent',
  asyncHandler(async (req, res) => {
    const user = getUser(req);
    const taskId = parse(idParam, req.params.id, '任务 ID');
    const body = parse(assignAgentSchema, req.body, '指派参数');
    ok(
      res,
      await agentService.assign(user.id, taskId, body.agent_id, {
        replace: body.replace === true,
        source: 'manual',
      })
    );
  })
);

agentRoutes.delete(
  '/tasks/:id/agent',
  asyncHandler(async (req, res) => {
    const user = getUser(req);
    const taskId = parse(idParam, req.params.id, '任务 ID');
    const query = parse(confirmQuerySchema, req.query, '查询参数');
    ok(res, await agentService.unassign(user.id, taskId, { confirm: query.confirm === true }));
  })
);

/** 重新执行：仅 failed 态可用，任务重新入队（失败不自动重试） */
agentRoutes.post(
  '/tasks/:id/agent/retry',
  asyncHandler(async (req, res) => {
    const user = getUser(req);
    const taskId = parse(idParam, req.params.id, '任务 ID');
    ok(res, await agentService.retry(user.id, taskId));
  })
);

/** 执行记录（时间线，倒序分页） */
agentRoutes.get(
  '/tasks/:id/agent-logs',
  asyncHandler(async (req, res) => {
    const user = getUser(req);
    const taskId = parse(idParam, req.params.id, '任务 ID');
    const query = parse(agentLogsQuerySchema, req.query, '查询参数');
    ok(res, await agentService.listLogs(user.id, taskId, query.page ?? 1, query.page_size ?? 20));
  })
);
