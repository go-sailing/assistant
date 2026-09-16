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
  /** v0.1.0 日程领域配置 */
  event: {
    /** 未指定时区时的兜底时区（IANA） */
    defaultTz: process.env.EVENT_DEFAULT_TZ || 'Asia/Shanghai',
    /** 仅给开始时间时的默认时长（分钟），用于文档一致性 */
    defaultDurationMin: num('EVENT_DEFAULT_DURATION_MIN', 60),
    /** 冲突返回条数上限 */
    conflictScanLimit: num('EVENT_CONFLICT_SCAN_LIMIT', 50),
    /** 日程列表/批量预取上限 */
    listMaxLimit: num('EVENT_LIST_MAX_LIMIT', 200),
    /* ----- v0.2.0 循环日程（系统设计文档 9.3） ----- */
    /** 创建/整条改期循环冲突扫描窗口（天） */
    recurrenceConflictWindowDays: num('EVENT_RECURRENCE_CONFLICT_WINDOW_DAYS', 90),
    /** count 上限及单次展开种子上限 */
    seriesMaxCount: num('EVENT_SERIES_MAX_COUNT', 730),
    /** until 距首次实例最大年限 */
    seriesMaxUntilYears: num('EVENT_SERIES_MAX_UNTIL_YEARS', 5),
    /** interval 上限 */
    recurIntervalMax: num('EVENT_RECUR_INTERVAL_MAX', 99),
    /** 系列详情实例分页大小 */
    occurrencePageSize: num('EVENT_OCCURRENCE_PAGE_SIZE', 20),
  },
  /** v0.2.0 子任务配置 */
  task: {
    /** 子任务最大层级（根为 1） */
    maxDepth: num('TASK_MAX_DEPTH', 5),
    /** 子树查询节点上限 */
    treeMaxNodes: num('TASK_TREE_MAX_NODES', 200),
  },
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