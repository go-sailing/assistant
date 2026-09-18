import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler, ok } from '../../common/response';
import { AppError } from '../../common/errors';
import { parse } from '../../common/validate';
import { authMiddleware, getUser, type AuthedRequest } from '../../middleware/auth';
import { clientIp, rateLimit } from '../../middleware/rateLimit';
import { config } from '../../config';
import { authService } from './auth.service';

const credentialSchema = z.object({
  email: z.string().min(1, '请输入邮箱'),
  password: z.string().min(1, '请输入密码'),
});

const authLimiter = rateLimit({
  windowMs: 60_000,
  max: config.rateLimit.authPerMin,
  keyOf: (req) => clientIp(req),
  message: '操作过于频繁，请稍后再试',
});

/** v0.4.0：刷新接口独立限流（防爆破 / 防遍历） */
const refreshLimiter = rateLimit({
  windowMs: 60_000,
  max: config.rateLimit.refreshPerMin,
  keyOf: (req) => clientIp(req),
  message: '操作过于频繁，请稍后再试',
});

/** v0.4.0：刷新令牌入参 */
const refreshSchema = z.object({
  refresh_token: z.string().min(1, '缺少刷新令牌'),
});

/** v0.4.0（P1）：修改密码入参 */
const changePasswordSchema = z.object({
  old_password: z.string().min(1, '请输入原密码'),
  new_password: z.string().min(1, '请输入新密码'),
});

export const authRoutes = Router();

authRoutes.post(
  '/auth/register',
  authLimiter,
  asyncHandler(async (req, res) => {
    const { email, password } = parse(credentialSchema, req.body, '注册参数');
    ok(res, await authService.register(email, password));
  })
);

authRoutes.post(
  '/auth/login',
  authLimiter,
  asyncHandler(async (req, res) => {
    const { email, password } = parse(credentialSchema, req.body, '登录参数');
    ok(res, await authService.login(email, password));
  })
);

/** v0.4.0：刷新令牌轮转（无需 access，凭 refresh 换新的一对凭证） */
authRoutes.post(
  '/auth/refresh',
  refreshLimiter,
  asyncHandler(async (req, res) => {
    const { refresh_token } = parse(refreshSchema, req.body, '刷新参数');
    ok(res, await authService.rotateRefresh(refresh_token));
  })
);

authRoutes.post(
  '/auth/logout',
  authMiddleware,
  asyncHandler(async (req, res) => {
    const user = getUser(req);
    authService.logout(user.jti, user.exp);
    // v0.4.0：带 refresh 时一并吊销，避免登出后旧串仍可换新
    const refreshToken = (req.body as { refresh_token?: string } | undefined)?.refresh_token;
    if (typeof refreshToken === 'string' && refreshToken) {
      await authService.revokeRefreshToken(refreshToken);
    }
    ok(res, { success: true });
  })
);

/** v0.4.0（P1）：修改密码；成功后响应携带当前设备的新凭证对 */
authRoutes.post(
  '/auth/change-password',
  authMiddleware,
  asyncHandler(async (req, res) => {
    const user = getUser(req);
    const { old_password, new_password } = parse(
      changePasswordSchema,
      req.body,
      '修改密码参数'
    );
    ok(res, await authService.changePassword(user.id, old_password, new_password));
  })
);

authRoutes.delete(
  '/auth/me',
  authMiddleware,
  asyncHandler(async (req, res) => {
    const user = getUser(req);
    const confirm = (req as AuthedRequest).body?.confirm;
    if (confirm !== true) {
      throw AppError.paramInvalid('注销账号需要二次确认（confirm=true）');
    }
    await authService.deleteAccount(user.id, user.jti, user.exp);
    ok(res, { success: true });
  })
);