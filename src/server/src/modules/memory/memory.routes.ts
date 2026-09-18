import { Router } from 'express';
import { asyncHandler, ok } from '../../common/response';
import { getUser } from '../../middleware/auth';
import { idParam, parse } from '../../common/validate';
import { memoryService } from './memory.service';

/**
 * v0.5.0 长期记忆接口（系统设计文档 7.1）。
 *
 * 全部为鉴权接口，只访问本人数据；越权与不存在统一 404（不泄露存在性）。
 * 挂载在 /api/v1 下、由 app.ts 统一套 authMiddleware。
 */
export const memoryRoutes = Router();

memoryRoutes.get(
  '/memories',
  asyncHandler(async (req, res) => {
    const user = getUser(req);
    ok(res, await memoryService.list(user.id));
  })
);

memoryRoutes.delete(
  '/memories/:id',
  asyncHandler(async (req, res) => {
    const user = getUser(req);
    const id = parse(idParam, req.params.id, '记忆 ID');
    await memoryService.remove(user.id, id);
    ok(res, { deleted: 1 });
  })
);

memoryRoutes.post(
  '/memories/clear',
  asyncHandler(async (req, res) => {
    const user = getUser(req);
    ok(res, await memoryService.clearAll(user.id));
  })
);