import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler, ok } from '../../common/response';
import { getUser } from '../../middleware/auth';
import {
  idParam,
  parse,
  priorityEnum,
  rejectListParams,
  statusEnum,
  taskTypeEnum,
} from '../../common/validate';
import { taskService } from './task.service';
import { eventService } from '../event/event.service';

const dueAtSchema = z
  .union([z.string(), z.null()])
  .refine(
    (v) => v === null || v === '' || !Number.isNaN(new Date(v).getTime()),
    '截止时间格式不正确'
  );

/** 宽容布尔：兼容 "true"/"false" 字符串（前端 query 与模型输出都可能给字符串） */
const boolish = z.preprocess((v) => {
  if (typeof v === 'string') {
    if (v.toLowerCase() === 'true') return true;
    if (v.toLowerCase() === 'false') return false;
  }
  return v;
}, z.boolean());

/**
 * v0.6.0：parent_id 兼容 0 表示「无父/移出项目」（与 LLM 工具口径一致），
 * 其余非正整数一律 1001；字段缺省时保持 undefined（表示不改动）。
 */
const parentIdSchema = z.preprocess(
  (v) => (v === null || v === '' || v === 0 || v === '0' ? null : Number(v)),
  z.union([z.number().int().positive(), z.null()])
);

const createSchema = z.object({
  title: z.string().min(1, '请输入任务标题'),
  note: z.string().nullish(),
  priority: priorityEnum.optional(),
  due_at: dueAtSchema.optional(),
  /** v0.6.0：挂到项目任务下成为成员（父必须是 project）；0/null 表示无父 */
  parent_id: parentIdSchema.optional(),
  /** v0.6.0：任务类型，缺省 normal */
  task_type: taskTypeEnum.optional(),
});

const updateSchema = z.object({
  title: z.string().min(1, '请输入任务标题').optional(),
  note: z.string().nullish(),
  priority: priorityEnum.optional(),
  due_at: dueAtSchema.optional(),
  /** v0.6.0：移入项目传项目 ID；显式 null/0 = 移出成为独立任务 */
  parent_id: parentIdSchema.optional(),
  /** v0.6.0：不接受变更，携带即由服务层拒绝（保留字段以便给出明确错误） */
  task_type: taskTypeEnum.optional(),
});

const listQuerySchema = z.object({
  status: statusEnum.optional(),
  priority: priorityEnum.optional(),
  /** v0.6.0：按任务类型筛选（normal / project） */
  task_type: taskTypeEnum.optional(),
  due_from: z.string().optional(),
  due_to: z.string().optional(),
  sort: z.string().optional(),
  page: z.coerce.number().int().positive().optional(),
  page_size: z.coerce.number().int().positive().max(100).optional(),
  /** v0.2.0：只看根任务（任务首页默认）/ 只看某个任务的直接子任务 */
  root_only: boolish.optional(),
  parent_id: z.coerce.number().int().positive().optional(),
});

const subtreeQuerySchema = z.object({
  depth: z.coerce.number().int().positive().max(5).optional(),
});

const completeSchema = z.object({
  /** 级联完成后端二次提交标记（4010 之后带 true 重发） */
  cascade: boolish.optional(),
});

const batchSchema = z.object({
  filter: z
    .object({
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
  }),
});

export const taskRoutes = Router();

taskRoutes.get(
  '/tasks',
  asyncHandler(async (req, res) => {
    const user = getUser(req);
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

/** v0.2.0 子树：扁平节点数组（depth/进度），行内展开传 depth=1 */
taskRoutes.get(
  '/tasks/:id/subtree',
  asyncHandler(async (req, res) => {
    const user = getUser(req);
    const id = parse(idParam, req.params.id, '任务 ID');
    const { depth } = parse(subtreeQuerySchema, req.query, '查询参数');
    ok(res, await taskService.getSubtree(user.id, id, depth));
  })
);

/** v0.2.0 面包屑：根 → 父 → 当前 */
taskRoutes.get(
  '/tasks/:id/ancestors',
  asyncHandler(async (req, res) => {
    const user = getUser(req);
    const id = parse(idParam, req.params.id, '任务 ID');
    ok(res, await taskService.getAncestorPath(user.id, id));
  })
);

/** v0.2.0 可挂载父任务候选（排除自身与全部后代，同清单） */
taskRoutes.get(
  '/tasks/:id/parent-candidates',
  asyncHandler(async (req, res) => {
    const user = getUser(req);
    const id = parse(idParam, req.params.id, '任务 ID');
    ok(res, await taskService.listParentCandidates(user.id, id));
  })
);

/** v0.6.0 删除前预取：项目成员数 + 关联日程数（不写库，供删除确认文案） */
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
    rejectListParams(req.body, '任务参数');
    const patch = parse(updateSchema, req.body, '任务参数');
    ok(res, await taskService.update(user.id, id, patch));
  })
);

taskRoutes.post(
  '/tasks/:id/complete',
  asyncHandler(async (req, res) => {
    const user = getUser(req);
    const id = parse(idParam, req.params.id, '任务 ID');
    const { cascade } = parse(completeSchema, req.body ?? {}, '任务参数');
    // 有未完成后代且未确认级联时，服务层抛 4010，前端确认后带 cascade=true 重发
    ok(res, await taskService.setStatus(user.id, id, 'completed', { cascade: cascade === true }));
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
    // v0.2.0：删除整棵子树，返回任务与日程的级联计数
    const result = await taskService.remove(user.id, id);
    ok(res, { id, ...result });
  })
);