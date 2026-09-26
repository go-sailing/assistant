import express from 'express';
import cors from 'cors';
import { authMiddleware, errorHandler, traceMiddleware } from './middleware/auth';
import { authRoutes } from './modules/auth/auth.routes';
import { eventRoutes } from './modules/event/event.routes';
import { chatRoutes } from './modules/chat/chat.routes';
import { memoryRoutes } from './modules/memory/memory.routes';
import { settingsRoutes } from './modules/settings/settings.routes';
import { asyncHandler, ok } from './common/response';
import { query } from './db/pool';
import { logger } from './common/logger';
import { config } from './config';

/**
 * 已下线的前缀：命中 404 兜底时落 legacy_api_hit 埋点（观测旧客户端占比，不记正文）。
 * - `/api/v1/tasks`、`/api/v1/agents`、`/mcp`：v0.9.0 下线（任务 / 智能体 / MCP 接入面）；
 * - `/api/v1/projects`：v0.8.0 新增、v0.9.0 随项目域一并下线（合并远程 v0.8.0 后补入观测面）。
 */
const RETIRED_PREFIXES = [
  '/api/v1/tasks',
  '/api/v1/projects',
  '/api/v1/agents',
  '/mcp',
];

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
  app.use('/api/v1/events', authMiddleware);
  app.use('/api/v1/conversations', authMiddleware);
  // v0.4.0：个人信息与设置
  app.use('/api/v1/me', authMiddleware);
  app.use('/api/v1/settings', authMiddleware);
  // v0.5.0：长期记忆
  app.use('/api/v1/memories', authMiddleware);
  app.use('/api/v1', eventRoutes);
  app.use('/api/v1', chatRoutes);
  app.use('/api/v1', memoryRoutes);
  app.use('/api/v1', settingsRoutes);

  // v0.9.0：任务 / 项目 / 智能体 / MCP 能力已下线，命中统一 404（1004）
  app.use((req, res) => {
    if (RETIRED_PREFIXES.some((p) => req.path.startsWith(p))) {
      logger.info('legacy_api_hit', { path: req.path, method: req.method });
    }
    res.status(404).json({ code: 1004, message: '接口不存在', details: null });
  });

  app.use(errorHandler);

  return app;
}
