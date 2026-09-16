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

authRoutes.post(
  '/auth/logout',
  authMiddleware,
  asyncHandler(async (req, res) => {
    const user = getUser(req);
    authService.logout(user.jti, user.exp);
    ok(res, { success: true });
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