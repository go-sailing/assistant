import { Router } from 'express';
import { asyncHandler, ok } from '../../common/response';
import { getUser } from '../../middleware/auth';
import { idParam, parse, rejectListParams, rejectParams } from '../../common/validate';
import {
  createProjectSchema,
  projectListQuerySchema,
  projectMemberQuerySchema,
  updateProjectSchema,
} from './project.schema';
import { projectService } from './project.service';

/** v0.8.0：项目不支持优先级与截止时间（模型上不存在这两列），携带即显式拒绝 */
const NO_PRIORITY_OR_DUE = '项目不支持优先级与截止时间';
/** v0.8.0：任务类型维度已取消（SDD 14.4） */
const NO_TASK_TYPE = '任务类型已取消';
/** 项目状态为派生只读（I4） */
const NO_STATUS_WRITE = '项目状态由成员完成度自动派生，不支持修改';

const LIST_REJECT = { task_type: NO_TASK_TYPE };
const WRITE_REJECT = {
  status: NO_STATUS_WRITE,
  priority: NO_PRIORITY_OR_DUE,
  due_at: NO_PRIORITY_OR_DUE,
  task_type: NO_TASK_TYPE,
};

export const projectRoutes = Router();

projectRoutes.get(
  '/projects',
  asyncHandler(async (req, res) => {
    const user = getUser(req);
    rejectParams(req.query, '查询参数', LIST_REJECT);
    rejectListParams(req.query, '查询参数');
    const filter = parse(projectListQuerySchema, req.query, '查询参数');
    ok(res, await projectService.list(user.id, filter));
  })
);

projectRoutes.post(
  '/projects',
  asyncHandler(async (req, res) => {
    const user = getUser(req);
    rejectParams(req.body, '项目参数', WRITE_REJECT);
    rejectListParams(req.body, '项目参数');
    const input = parse(createProjectSchema, req.body, '项目参数');
    ok(res, await projectService.create(user.id, input));
  })
);

projectRoutes.get(
  '/projects/:id',
  asyncHandler(async (req, res) => {
    const user = getUser(req);
    const id = parse(idParam, req.params.id, '项目 ID');
    ok(res, await projectService.get(user.id, id));
  })
);

/** 删除前预取：成员任务数与关联日程数（不写库，供二次确认文案） */
projectRoutes.get(
  '/projects/:id/preview-remove',
  asyncHandler(async (req, res) => {
    const user = getUser(req);
    const id = parse(idParam, req.params.id, '项目 ID');
    ok(res, await projectService.previewRemove(user.id, id));
  })
);

/** 项目成员（任务 DTO 列表，口径与任务列表一致） */
projectRoutes.get(
  '/projects/:id/members',
  asyncHandler(async (req, res) => {
    const user = getUser(req);
    const id = parse(idParam, req.params.id, '项目 ID');
    rejectParams(req.query, '查询参数', LIST_REJECT);
    rejectListParams(req.query, '查询参数');
    const filter = parse(projectMemberQuerySchema, req.query, '查询参数');
    ok(res, await projectService.listMembers(user.id, id, filter));
  })
);

projectRoutes.patch(
  '/projects/:id',
  asyncHandler(async (req, res) => {
    const user = getUser(req);
    const id = parse(idParam, req.params.id, '项目 ID');
    rejectParams(req.body, '项目参数', WRITE_REJECT);
    rejectListParams(req.body, '项目参数');
    const patch = parse(updateProjectSchema, req.body, '项目参数');
    ok(res, await projectService.update(user.id, id, patch));
  })
);

projectRoutes.delete(
  '/projects/:id',
  asyncHandler(async (req, res) => {
    const user = getUser(req);
    const id = parse(idParam, req.params.id, '项目 ID');
    const result = await projectService.remove(user.id, id);
    ok(res, { id, ...result });
  })
);
