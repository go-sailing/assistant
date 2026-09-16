import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler, ok } from '../../common/response';
import { getUser } from '../../middleware/auth';
import { idParam, optionalId, parse, priorityEnum, statusEnum } from '../../common/validate';
import { taskService } from './task.service';
import { eventService } from '../event/event.service';

const dueAtSchema = z
  .union([z.string(), z.null()])
  .refine(
    (v) => v === null || v === '' || !Number.isNaN(new Date(v).getTime()),
    '截止时间格式不正确'
  );

const createSchema = z.object({
  title: z.string().min(1, '请输入任务标题'),
  note: z.string().nullish(),
  priority: priorityEnum.optional(),
  due_at: dueAtSchema.optional(),
  list_id: optionalId.optional(),
});

const updateSchema = z.object({
  title: z.string().min(1, '请输入任务标题').optional(),
  note: z.string().nullish(),
  priority: priorityEnum.optional(),
  due_at: dueAtSchema.optional(),
  list_id: optionalId.optional(),
});

const listQuerySchema = z.object({
  list_id: z.coerce.number().int().positive().optional(),
  status: statusEnum.optional(),
  priority: priorityEnum.optional(),
  due_from: z.string().optional(),
  due_to: z.string().optional(),
  sort: z.string().optional(),
  page: z.coerce.number().int().positive().optional(),
  page_size: z.coerce.number().int().positive().max(100).optional(),
});

const batchSchema = z.object({
  filter: z
    .object({
      list_id: z.number().int().positive().optional(),
      status: statusEnum.optional(),
      priority: priorityEnum.optional(),
      due_from: z.string().optional(),
      due_to: z.string().optional(),
      keyword: z.string().optional(),
    })
    .default({}),
  update: z.object({
    priority: priorityEnum.optional(),
    due_at: dueAtSchema.optional(),
    status: statusEnum.optional(),
    list_id: optionalId.optional(),
  }),
});

export const taskRoutes = Router();

taskRoutes.get(
  '/tasks',
  asyncHandler(async (req, res) => {
    const user = getUser(req);
    const filter = parse(listQuerySchema, req.query, '查询参数');
    ok(res, await taskService.list(user.id, filter));
  })
);

// 注意：/tasks/search 必须在 /tasks/:id 之前注册
taskRoutes.get(
  '/tasks/search',
  asyncHandler(async (req, res) => {
    const user = getUser(req);
    const keyword = String(req.query.keyword ?? '');
    ok(res, await taskService.search(user.id, keyword));
  })
);

taskRoutes.post(
  '/tasks',
  asyncHandler(async (req, res) => {
    const user = getUser(req);
    const input = parse(createSchema, req.body, '任务参数');
    ok(res, await taskService.create(user.id, input));
  })
);

taskRoutes.post(
  '/tasks/batch-update',
  asyncHandler(async (req, res) => {
    const user = getUser(req);
    const { filter, update } = parse(batchSchema, req.body, '批量更新参数');
    ok(res, await taskService.batchUpdateByFilter(user.id, filter, update));
  })
);

taskRoutes.get(
  '/tasks/:id',
  asyncHandler(async (req, res) => {
    const user = getUser(req);
    const id = parse(idParam, req.params.id, '任务 ID');
    const task = await taskService.get(user.id, id);
    // 附带排期数量，任务详情一次请求即可决定删除确认文案是否提示级联
    const event_count = await eventService.countByTask(user.id, id);
    ok(res, { ...task, event_count });
  })
);

/** 该任务的全部任务日程（任务详情「日程安排」分区） */
taskRoutes.get(
  '/tasks/:id/events',
  asyncHandler(async (req, res) => {
    const user = getUser(req);
    const id = parse(idParam, req.params.id, '任务 ID');
    // 先校验任务归属，避免通过该接口探测他人任务是否存在
    await taskService.getOwned(user.id, id);
    ok(res, await eventService.listByTask(user.id, id));
  })
);

taskRoutes.patch(
  '/tasks/:id',
  asyncHandler(async (req, res) => {
    const user = getUser(req);
    const id = parse(idParam, req.params.id, '任务 ID');
    const patch = parse(updateSchema, req.body, '任务参数');
    ok(res, await taskService.update(user.id, id, patch));
  })
);

taskRoutes.post(
  '/tasks/:id/complete',
  asyncHandler(async (req, res) => {
    const user = getUser(req);
    const id = parse(idParam, req.params.id, '任务 ID');
    ok(res, await taskService.setStatus(user.id, id, 'completed'));
  })
);

taskRoutes.post(
  '/tasks/:id/uncomplete',
  asyncHandler(async (req, res) => {
    const user = getUser(req);
    const id = parse(idParam, req.params.id, '任务 ID');
    ok(res, await taskService.setStatus(user.id, id, 'todo'));
  })
);

taskRoutes.delete(
  '/tasks/:id',
  asyncHandler(async (req, res) => {
    const user = getUser(req);
    const id = parse(idParam, req.params.id, '任务 ID');
    const result = await taskService.remove(user.id, id);
    ok(res, { id, ...result });
  })
);