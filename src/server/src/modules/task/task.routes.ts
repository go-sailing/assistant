import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler, ok } from '../../common/response';
import { getUser } from '../../middleware/auth';
import {
  idParam,
  parse,
  priorityEnum,
  projectIdFilter,
  rejectListParams,
  rejectParams,
  statusEnum,
} from '../../common/validate';
import { taskService } from './task.service';
import { eventService } from '../event/event.service';

const dueAtSchema = z
  .union([z.string(), z.null()])
  .refine(
    (v) => v === null || v === '' || !Number.isNaN(new Date(v).getTime()),
    '截止时间格式不正确'
  );

/**
 * v0.6.0 的 parent_id / v0.8.0 的项目归属：兼容 0 表示「未归属项目」，
 * 其余非正整数一律 1001；字段缺省时保持 undefined（表示不改动）。
 */
const projectIdSchema = z.preprocess(
  (v) => (v === null || v === '' || v === 0 || v === '0' ? null : Number(v)),
  z.union([z.number().int().positive(), z.null()])
);

/** v0.8.0：任务类型维度取消，携带旧参数一律显式拒绝（SDD 14.4） */
const NO_TASK_TYPE = '任务类型已取消';

const QUERY_REJECT: Record<string, string> = {
  task_type: NO_TASK_TYPE,
  root_only: '任务页已返回全部任务',
  parent_id: '请改用 project_id 过滤',
};

const BODY_REJECT: Record<string, string> = {
  task_type: NO_TASK_TYPE,
  parent_id: '任务的所属项目请用 project_id 表达',
};

const createSchema = z.object({
  title: z.string().min(1, '请输入任务标题'),
  note: z.string().nullish(),
  priority: priorityEnum.optional(),
  due_at: dueAtSchema.optional(),
  /** v0.8.0：加入某个项目成为成员；0/null 表示未归属项目 */
  project_id: projectIdSchema.optional(),
});

const updateSchema = z.object({
  title: z.string().min(1, '请输入任务标题').optional(),
  note: z.string().nullish(),
  priority: priorityEnum.optional(),
  due_at: dueAtSchema.optional(),
  /** v0.8.0：移入项目传项目 ID；显式 null/0 = 移出成为未归属项目的任务 */
  project_id: projectIdSchema.optional(),
});

const listQuerySchema = z.object({
  status: statusEnum.optional(),
  priority: priorityEnum.optional(),
  due_from: z.string().optional(),
  due_to: z.string().optional(),
  sort: z.string().optional(),
  page: z.coerce.number().int().positive().optional(),
  page_size: z.coerce.number().int().positive().max(100).optional(),
  /** v0.8.0：按所属项目筛选（正整数项目 id 或 'none' = 未归属项目） */
  project_id: projectIdFilter.optional(),
});

const batchSchema = z.object({
  filter: z
    .object({
      status: statusEnum.optional(),
      priority: priorityEnum.optional(),
      due_from: z.string().optional(),
      due_to: z.string().optional(),
      keyword: z.string().optional(),
      /** v0.8.0：按所属项目筛选（正整数项目 id 或 'none' = 未归属项目） */
      project_id: projectIdFilter.optional(),
    })
    .default({}),
  update: z.object({
    priority: priorityEnum.optional(),
    due_at: dueAtSchema.optional(),
    status: statusEnum.optional(),
  }),
});

export const taskRoutes = Router();

taskRoutes.get(
  '/tasks',
  asyncHandler(async (req, res) => {
    const user = getUser(req);
    rejectParams(req.query, '查询参数', QUERY_REJECT);
    rejectListParams(req.query, '查询参数');
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
    rejectParams(req.body, '任务参数', BODY_REJECT);
    rejectListParams(req.body, '任务参数');
    const input = parse(createSchema, req.body, '任务参数');
    ok(res, await taskService.create(user.id, input));
  })
);

taskRoutes.post(
  '/tasks/batch-update',
  asyncHandler(async (req, res) => {
    const user = getUser(req);
    const body = (req.body ?? {}) as { filter?: unknown; update?: unknown };
    rejectParams(body, '批量更新参数', BODY_REJECT);
    rejectParams(body.filter, '批量更新筛选参数', QUERY_REJECT);
    rejectParams(body.update, '批量更新字段', BODY_REJECT);
    rejectListParams(body, '批量更新参数');
    rejectListParams(body.filter, '批量更新筛选参数');
    rejectListParams(body.update, '批量更新字段');
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

/** v0.6.0 删除前预取：关联日程数（不写库，供删除确认文案） */
taskRoutes.get(
  '/tasks/:id/preview-remove',
  asyncHandler(async (req, res) => {
    const user = getUser(req);
    const id = parse(idParam, req.params.id, '任务 ID');
    ok(res, await taskService.previewRemove(user.id, id));
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
    rejectParams(req.body, '任务参数', BODY_REJECT);
    rejectListParams(req.body, '任务参数');
    const patch = parse(updateSchema, req.body, '任务参数');
    ok(res, await taskService.update(user.id, id, patch));
  })
);

// v0.8.0：完成任务不再有级联语义（项目状态由成员完成度派生），cascade 参数已移除
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

// v0.8.0 下线（决议 T7）：/tasks/:id/subtree、/tasks/:id/ancestors、
// /tasks/:id/parent-candidates 不再注册 —— 能力由 /projects/:id/members 与 /projects 承接，
// 旧链按全局 404（1004「接口不存在」）处理。
