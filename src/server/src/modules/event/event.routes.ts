import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler, ok } from '../../common/response';
import { getUser } from '../../middleware/auth';
import { idParam, parse } from '../../common/validate';
import { AppError } from '../../common/errors';
import { eventService } from './event.service';
import {
  createEventSchema,
  listEventsSchema,
  searchEventsSchema,
  tzField,
  updateEventSchema,
} from './schema';

const monthlyQuerySchema = z.object({
  year: z.coerce.number().int(),
  month: z.coerce.number().int(),
  tz: tzField,
});

export const eventRoutes = Router();

// 月视图聚合：日期 → 计数（含 normal / task 两类）
eventRoutes.get(
  '/events/monthly',
  asyncHandler(async (req, res) => {
    const user = getUser(req);
    const { year, month, tz } = parse(monthlyQuerySchema, req.query, '查询参数');
    ok(res, await eventService.monthly(user.id, year, month, tz));
  })
);

// 注意：/events/search 必须在 /events/:id 之前注册
eventRoutes.get(
  '/events/search',
  asyncHandler(async (req, res) => {
    const user = getUser(req);
    const { keyword } = parse(searchEventsSchema, req.query, '查询参数');
    ok(res, await eventService.search(user.id, keyword));
  })
);

// 按日 / 日期范围查询（左闭右开）
eventRoutes.get(
  '/events',
  asyncHandler(async (req, res) => {
    const user = getUser(req);
    const filter = parse(listEventsSchema, req.query, '查询参数');
    ok(res, await eventService.list(user.id, filter));
  })
);

eventRoutes.post(
  '/events',
  asyncHandler(async (req, res) => {
    const user = getUser(req);
    const input = parse(createEventSchema, req.body, '日程参数');
    const result = await eventService.create(user.id, input, 'manual', {
      confirmConflict: input.confirm_conflict === true,
    });
    // 冲突未确认：不落库，返回 409/code 4009 由前端弹冲突层决定是否二次提交
    if (!result.saved) {
      throw AppError.eventConflict(result.conflicts, result.conflict_level);
    }
    ok(res, result.event);
  })
);

eventRoutes.get(
  '/events/:id',
  asyncHandler(async (req, res) => {
    const user = getUser(req);
    const id = parse(idParam, req.params.id, '日程 ID');
    ok(res, await eventService.get(user.id, id));
  })
);

eventRoutes.patch(
  '/events/:id',
  asyncHandler(async (req, res) => {
    const user = getUser(req);
    const id = parse(idParam, req.params.id, '日程 ID');
    const patch = parse(updateEventSchema, req.body, '日程参数');
    const result = await eventService.update(user.id, id, patch, {
      confirmConflict: patch.confirm_conflict === true,
    });
    if (!result.saved) {
      throw AppError.eventConflict(result.conflicts, result.conflict_level);
    }
    ok(res, result.event);
  })
);

eventRoutes.delete(
  '/events/:id',
  asyncHandler(async (req, res) => {
    const user = getUser(req);
    const id = parse(idParam, req.params.id, '日程 ID');
    await eventService.remove(user.id, id);
    ok(res, { id });
  })
);