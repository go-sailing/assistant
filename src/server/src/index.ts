import { createApp } from './app';
import { config } from './config';
import { logger } from './common/logger';
import { closePool } from './db/pool';
import { runMigrations } from './db/migrate';
import { ensureWorkCalendarLoaded } from './modules/event/workday/workday.service';

async function bootstrap(): Promise<void> {
  if (config.dbAutoMigrate) {
    await runMigrations();
  }

  // v0.4.0：法定工作日历整表载入进程内存（数据量极小），
  // 使循环引擎的逐日判定为同步纯内存操作；失败时降级为默认周历并告警。
  try {
    await ensureWorkCalendarLoaded();
  } catch (err) {
    logger.warn('法定工作日历载入失败，将按周一至周五回退', {
      error: err instanceof Error ? err.message : String(err),
    });
  }

  if (!config.deepseek.apiKey) {
    logger.warn('未配置 DEEPSEEK_API_KEY，对话功能将不可用（任务管理功能不受影响）');
  } else {
    logger.info('已启用 DeepSeek', { model: config.deepseek.model, base_url: config.deepseek.baseUrl });
  }

  const app = createApp();
  const server = app.listen(config.port, () => {
    logger.info('服务已启动', { port: config.port });
  });

  const shutdown = async (signal: string) => {
    logger.info('收到退出信号，正在关闭服务', { signal });
    server.close(async () => {
      await closePool().catch(() => undefined);
      process.exit(0);
    });
    // 兜底：10 秒后强制退出
    setTimeout(() => process.exit(0), 10_000).unref();
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

bootstrap().catch((err) => {
  logger.error('服务启动失败', { error: err instanceof Error ? err.message : String(err) });
  process.exit(1);
});