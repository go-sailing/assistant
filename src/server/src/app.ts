import express from 'express';
import cors from 'cors';
import { authMiddleware, errorHandler, traceMiddleware } from './middleware/auth';
import { authRoutes } from './modules/auth/auth.routes';
import { listRoutes } from './modules/list/list.routes';
import { taskRoutes } from './modules/task/task.routes';
import { chatRoutes } from './modules/chat/chat.routes';
import { asyncHandler, ok } from './common/response';
import { query } from './db/pool';
import { config } from './config';

export function createApp() {
  const app = express();

  app.disable('x-powered-by');
  // H5 与 API 同源部署时无需 CORS；开发期前端 dev server 需要跨域
  app.use(cors({ origin: true, credentials: true }));
  app.use(express.json({ limit: '256kb' }));
  app.use(traceMiddleware);

  app.get(
    '/healthz',
    asyncHandler(async (_req, res) => {
      await query('SELECT 1');
      ok(res, { status: 'ok', llm_configured: Boolean(config.deepseek.apiKey) });
    })
  );

  // 无需登录
  app.use('/api/v1', authRoutes);

  // 需要登录：按受保护的业务前缀挂载鉴权中间件，
  // 这样未被任何路由匹配的 /api/v1 路径会走到下面的 404 处理（而不是先被判未登录）
  app.use('/api/v1/lists', authMiddleware);
  app.use('/api/v1/tasks', authMiddleware);
  app.use('/api/v1/conversations', authMiddleware);
  app.use('/api/v1', listRoutes);
  app.use('/api/v1', taskRoutes);
  app.use('/api/v1', chatRoutes);

  app.use((_req, res) => {
    res.status(404).json({ code: 1004, message: '接口不存在', details: null });
  });

  app.use(errorHandler);

  return app;
}