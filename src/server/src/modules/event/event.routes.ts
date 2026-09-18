import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler, ok } from '../../common/response';
import { getUser } from '../../middleware/auth';
import { idParam, parse } from '../../common/validate';
import { AppError } from '../../common/errors';
import { eventService } from './event.service';
import {
  createEventSchema,
  deleteEventSchema,
  listEventsSchema,
  restoreOccurrenceSchema,
  searchEventsSchema,
  seriesDetailQuerySchema,
  tzField,
  updateEventSchema,
} from './schema';
import type { WriteEventResult } from './types';

const monthlyQuerySchema = z.object({
  year: z.coerce.number().int(),
  month: z.coerce.number().int(),
  tz: tzField,
});

const getEventQuerySchema = z.object({
  tz: tzField,
  occurrence_key: z.string().optional(),
});

/**
 * v0.4.0 农历换算（PRD 5.3/5.6）：
 * n=1 单次日程表单换算；n>1 年度循环预览未来 n 个候选（配合 anchor 过滤）。
 */
const lunarResolveQuerySchema = z.object({
  lunar_year: z.coerce.number().int(),
  month: z.coerce.number().int(),
  day: z.coerce.number().int(),
  n: z.coerce.number().int().min(1).max(5).optional(),
  anchor: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, '日期格式应为 YYYY-MM-DD')
    .optional(),
});

/** 冲突未确认：循环冲突按日期分组（scope=series），单次冲突走 v0.1.0 形态 */
function throwIfConflict(result: WriteEventResult): void {
  if (result.saved) return;
  if (result.conflict_scope === 'series') {
    throw AppError.seriesConflict({
      conflict_level: result.conflict_level,
      conflict_dates: result.conflict_dates ?? [],
      conflict_dates_total: result.conflict_dates_total ?? 0,
      conflict_total: result.conflict_total ?? 0,
    });
  }
  throw AppError.eventConflict(result.conflicts, result.conflict_level, {
    scope: result.conflict_scope === 'occurrence' ? 'occurrence' : 'single',
  });
}

export const eventRoutes = Router();

// 月视图聚合：日期 → 计数（normal / task / recurring）
eventRoutes.get(
  '/events/monthly',
  asyncHandler(async (req, res) => {
    const user = getUser(req);
    const { year, month, tz } = parse(monthlyQuerySchema, req.query, '查询参数');
    ok(res, await eventService.monthly(user.id, year, month, tz));
  })
);

// v0.4.0：农历 → 公历换算（单次日程表单与年度循环预览）
// 注意：必须在 /events/:id 之前注册，避免被动态段吞掉
eventRoutes.get(
  '/events/lunar/resolve',
  asyncHandler(async (req, res) => {
    getUser(req);
    const { lunar_year, month, day, n, anchor } = parse(
      lunarResolveQuerySchema,
      req.query,
      '查询参数'
    );
    ok(
      res,
      await eventService.resolveLunar({
        lunarYear: lunar_year,
        month,
        day,
        n,
        anchor,
      })
    );
  })
);

// 注意：/events/search、/events/series/:id 必须在 /events/:id 之前注册
eventRoutes.get(
  '/events/search',
  asyncHandler(async (req, res) => {
    const user = getUser(req);
    const { keyword } = parse(searchEventsSchema, req.query, '查询参数');
    ok(res, await eventService.search(user.id, keyword));
  })
);

// 系列详情：规则 + 摘要 + 下一次 + 实例分页（未来正序 / 历史倒序）
eventRoutes.get(
  '/events/series/:id',
  asyncHandler(async (req, res) => {
    const user = getUser(req);
    const id = parse(idParam, req.params.id, '日程 ID');
    const { tz, section, cursor } = parse(seriesDetailQuerySchema, req.query, '查询参数');
    ok(res, await eventService.getSeriesDetail(user.id, id, { tz, section, cursor }));
  })
);

// 按日 / 日期范围查询（左闭右开），自动展开循环实例
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
      // 循环规则按用户时区解释，缺省回退 EVENT_DEFAULT_TZ
      tz: typeof req.query.tz === 'string' ? req.query.tz : null,
    });
    // 冲突未确认：不落库，返回 409/code 4009 由前端弹冲突层决定是否二次提交
    throwIfConflict(result);
    // 「本次及以后」会把原系列截断并派生新系列，需把两边信息一并回传（前端据此刷新两处）
    ok(res, result.derived ? { ...result.event, derived: result.derived } : result.event);
  })
);

eventRoutes.get(
  '/events/:id',
  asyncHandler(async (req, res) => {
    const user = getUser(req);
    const id = parse(idParam, req.params.id, '日程 ID');
    const { tz, occurrence_key } = parse(getEventQuerySchema, req.query, '查询参数');
    ok(res, await eventService.get(user.id, id, { tz, occurrenceKey: occurrence_key ?? null }));
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
      scope: patch.scope,
      occurrenceKey: patch.occurrence_key,
      tz: typeof req.query.tz === 'string' ? req.query.tz : null,
    });
    throwIfConflict(result);
    // 「本次及以后」会把原系列截断并派生新系列，需把两边信息一并回传（前端据此刷新两处）
    ok(res, result.derived ? { ...result.event, derived: result.derived } : result.event);
  })
);

/** 恢复某次已取消的实例（删除其 override） */
eventRoutes.post(
  '/events/:id/restore-occurrence',
  asyncHandler(async (req, res) => {
    const user = getUser(req);
    const id = parse(idParam, req.params.id, '日程 ID');
    const { occurrence_key } = parse(restoreOccurrenceSchema, req.body, '日程参数');
    const { tz } = parse(getEventQuerySchema, req.query, '查询参数');
    ok(res, await eventService.restoreOccurrence(user.id, id, occurrence_key, tz));
  })
);

eventRoutes.delete(
  '/events/:id',
  asyncHandler(async (req, res) => {
    const user = getUser(req);
    const id = parse(idParam, req.params.id, '日程 ID');
    // 作用域既可走 query 也可走 body，兼容前端两种调用形态
    const { scope, occurrence_key } = parse(
      deleteEventSchema,
      { ...(req.query as Record<string, unknown>), ...((req.body ?? {}) as Record<string, unknown>) },
      '日程参数'
    );
    const { tz } = parse(getEventQuerySchema, req.query, '查询参数');
    const result = await eventService.remove(user.id, id, {
      scope,
      occurrenceKey: occurrence_key,
      tz,
    });
    if (result.occurrence) {
      ok(res, {
        id,
        occurrence_state: 'cancelled',
        occurrence: result.occurrence,
      });
      return;
    }
    ok(res, { id });
  })
);
