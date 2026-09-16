import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler, ok } from '../../common/response';
import { getUser } from '../../middleware/auth';
import { idParam, parse } from '../../common/validate';
import { listService } from './list.service';

const nameSchema = z.object({ name: z.string().min(1, '请输入清单名称') });

export const listRoutes = Router();

listRoutes.get(
  '/lists',
  asyncHandler(async (req, res) => {
    const user = getUser(req);
    ok(res, await listService.listByUser(user.id));
  })
);

listRoutes.post(
  '/lists',
  asyncHandler(async (req, res) => {
    const user = getUser(req);
    const { name } = parse(nameSchema, req.body, '清单参数');
    ok(res, await listService.create(user.id, name));
  })
);

listRoutes.patch(
  '/lists/:id',
  asyncHandler(async (req, res) => {
    const user = getUser(req);
    const id = parse(idParam, req.params.id, '清单 ID');
    const { name } = parse(nameSchema, req.body, '清单参数');
    ok(res, await listService.rename(user.id, id, name));
  })
);

listRoutes.delete(
  '/lists/:id',
  asyncHandler(async (req, res) => {
    const user = getUser(req);
    const id = parse(idParam, req.params.id, '清单 ID');
    ok(res, await listService.remove(user.id, id));
  })
);