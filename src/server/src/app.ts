import express from 'express';
import cors from 'cors';
import { authMiddleware, errorHandler, traceMiddleware } from './middleware/auth';
import { authRoutes } from './modules/auth/auth.routes';
import { taskRoutes } from './modules/task/task.routes';
import { projectRoutes } from './modules/project/project.routes';
import { eventRoutes } from './modules/event/event.routes';
import { chatRoutes } from './modules/chat/chat.routes';
import { memoryRoutes } from './modules/memory/memory.routes';
import { settingsRoutes } from './modules/settings/settings.routes';
import { agentRoutes } from './modules/agent/agent.routes';
import { mcpErrorHandler, mcpRoutes } from './mcp/mcp.routes';
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

  // v0.7.0 MCP 接入面：代理凭据鉴权（与用户 JWT 完全并列，互不通用）
  app.use(mcpRoutes);
  // /mcp 专用错误出口：body 解析失败 → -32700；限流/异常 → JSON-RPC 形响应
  app.use('/mcp', mcpErrorHandler);

  // 无需登录
  app.use('/api/v1', authRoutes);

  // 需要登录：按受保护的业务前缀挂载鉴权中间件，
  // 这样未被任何路由匹配的 /api/v1 路径会走到下面的 404 处理（而不是先被判未登录）
  app.use('/api/v1/tasks', authMiddleware);
  // v0.8.0：项目从任务中抽离，独立资源路径
  app.use('/api/v1/projects', authMiddleware);
  app.use('/api/v1/events', authMiddleware);
  app.use('/api/v1/conversations', authMiddleware);
  // v0.4.0：个人信息与设置
  app.use('/api/v1/me', authMiddleware);
  app.use('/api/v1/settings', authMiddleware);
  // v0.5.0：长期记忆
  app.use('/api/v1/memories', authMiddleware);
  // v0.7.0：智能体代理（清单接口已随 LIST-01 下线，不再挂载）
  app.use('/api/v1/agents', authMiddleware);
  app.use('/api/v1', taskRoutes);
  app.use('/api/v1', projectRoutes);
  app.use('/api/v1', eventRoutes);
  app.use('/api/v1', chatRoutes);
  app.use('/api/v1', memoryRoutes);
  app.use('/api/v1', settingsRoutes);
  app.use('/api/v1', agentRoutes);

  app.use((_req, res) => {
    res.status(404).json({ code: 1004, message: '接口不存在', details: null });
  });

  app.use(errorHandler);

  return app;
}
