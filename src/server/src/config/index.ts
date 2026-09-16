import path from 'path';
import dotenv from 'dotenv';

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

function required(key: string): string {
  const val = process.env[key];
  if (!val) {
    throw new Error(`缺少必需的环境变量：${key}（请参考 .env.example 配置）`);
  }
  return val;
}

function num(key: string, fallback: number): number {
  const val = process.env[key];
  if (!val) return fallback;
  const parsed = Number(val);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export const config = {
  port: num('PORT', 3000),
  databaseUrl: required('DATABASE_URL'),
  dbAutoMigrate: process.env.DB_AUTO_MIGRATE !== 'false',
  jwt: {
    secret: required('JWT_SECRET'),
    expiresIn: process.env.JWT_EXPIRES_IN || '2h',
  },
  deepseek: {
    apiKey: process.env.DEEPSEEK_API_KEY || '',
    baseUrl: process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com',
    model: process.env.DEEPSEEK_MODEL || 'deepseek-flash',
    timeoutMs: num('DEEPSEEK_TIMEOUT_MS', 60000),
    maxRetry: num('DEEPSEEK_MAX_RETRY', 2),
  },
  chat: {
    historyLimit: num('CHAT_HISTORY_LIMIT', 20),
  },
  pendingActionTtlSeconds: num('PENDING_ACTION_TTL_SECONDS', 300),
  rateLimit: {
    authPerMin: num('RATE_LIMIT_AUTH_PER_MIN', 20),
    chatPerMin: num('RATE_LIMIT_CHAT_PER_MIN', 20),
  },
};

export function assertLlmConfigured(): void {
  if (!config.deepseek.apiKey) {
    throw new Error('缺少 DEEPSEEK_API_KEY，对话功能不可用（任务管理功能不受影响）');
  }
}