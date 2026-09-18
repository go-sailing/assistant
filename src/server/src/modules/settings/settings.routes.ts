import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler, ok } from '../../common/response';
import { getUser } from '../../middleware/auth';
import { parse } from '../../common/validate';
import { settingsService } from './settings.service';

/**
 * v0.4.0 个人信息与偏好设置路由（PRD 第 10 章）。
 *
 * 挂载在 /api/v1 下、由 app.ts 统一套 authMiddleware（与 lists/tasks/events 同）。
 */
export const settingsRoutes = Router();

const nicknameSchema = z.object({
  // null = 清空昵称；长度校验在 service 内按 Unicode 码点执行（emoji 友好）
  nickname: z.union([z.string(), z.null()]),
});

const settingsPatchSchema = z.record(z.unknown());

/** 个人信息 */
settingsRoutes.get(
  '/me',
  asyncHandler(async (req, res) => {
    const user = getUser(req);
    ok(res, await settingsService.getProfile(user.id));
  })
);

settingsRoutes.patch(
  '/me',
  asyncHandler(async (req, res) => {
    const user = getUser(req);
    const { nickname } = parse(nicknameSchema, req.body, '昵称参数');
    ok(res, await settingsService.updateNickname(user.id, nickname));
  })
);

/** 偏好设置 */
settingsRoutes.get(
  '/settings',
  asyncHandler(async (req, res) => {
    const user = getUser(req);
    ok(res, await settingsService.getSettings(user.id));
  })
);

settingsRoutes.put(
  '/settings',
  asyncHandler(async (req, res) => {
    const user = getUser(req);
    const patch = parse(settingsPatchSchema, req.body, '设置参数');
    ok(res, await settingsService.updateSettings(user.id, patch));
  })
);