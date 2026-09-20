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
    /** v0.4.0：时钟容忍（秒），消除服务间小偏差导致的伪 401 */
    clockToleranceSec: num('ACCESS_CLOCK_TOLERANCE_SEC', 30),
  },
  /** v0.4.0 登录态续期（PRD 11.2） */
  refresh: {
    /** refresh 令牌有效期（天，滑动：每次轮转续期） */
    ttlDays: num('REFRESH_TOKEN_TTL_DAYS', 30),
  },
  deepseek: {
    apiKey: process.env.DEEPSEEK_API_KEY || '',
    baseUrl: process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com',
    model: process.env.DEEPSEEK_MODEL || 'deepseek-flash',
    timeoutMs: num('DEEPSEEK_TIMEOUT_MS', 60000),
    maxRetry: num('DEEPSEEK_MAX_RETRY', 2),
  },
  chat: {
    /** 无摘要时的取数上限（沿用 v0.4.0） */
    historyLimit: num('CHAT_HISTORY_LIMIT', 20),
    /* ----- v0.5.0 上下文自动压缩（系统设计文档 4.3 / 7.3） ----- */
    /** 模型上下文窗口（token），用于水位估算 */
    modelContextTokens: num('CHAT_MODEL_CONTEXT_TOKENS', 64000),
    /** 压缩触发水位（占窗口比例） */
    compactThresholdRatio: num('CHAT_COMPACT_THRESHOLD_RATIO', 0.8),
    /** 最近保留原文的消息条数 */
    recentKeep: num('CHAT_RECENT_KEEP', 10),
    /** 连续压缩时保留窗下限（floor 约束优先） */
    compactMinKeep: num('CHAT_COMPACT_MIN_KEEP', 6),
    /** 单份摘要 token 上限 */
    summaryMaxTokens: num('CHAT_SUMMARY_MAX_TOKENS', 1000),
  },
  /** v0.5.0 长期记忆（系统设计文档 5.3~5.5 / 7.3） */
  memory: {
    /** 单次归档的候选条数上限 */
    archiveBatchLimit: num('MEMORY_ARCHIVE_BATCH_LIMIT', 30),
    /** 每用户记忆总条数上限 */
    maxTotal: num('MEMORY_MAX_TOTAL', 100),
    /** 注入上下文的记忆 token 预算 */
    injectTokenBudget: num('MEMORY_INJECT_TOKEN_BUDGET', 800),
    /** 单次归档参与提取的最近消息条数上限 */
    archiveMaxMessages: num('MEMORY_ARCHIVE_MAX_MESSAGES', 400),
    /** 注入装配缓存 TTL（毫秒） */
    injectCacheTtlMs: num('MEMORY_INJECT_CACHE_TTL_MS', 60_000),
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
  /** v0.8.0 项目域配置（原 v0.6.0 的 task.treeMaxNodes 升级而来：项目成员上限） */
  project: {
    /**
     * 单个项目的成员任务数上限。
     * 兼容 v0.7.0 的 TASK_TREE_MAX_NODES（旧变量仍可读取），新变量优先。
     */
    maxMembers: num('PROJECT_MAX_MEMBERS', num('TASK_TREE_MAX_NODES', 200)),
  },
  /** v0.7.0 智能体代理（系统设计文档 16.3） */
  agent: {
    /** 单用户代理数上限 */
    maxPerUser: num('AGENT_MAX_PER_USER', 20),
    /** 单代理待执行队列上限 */
    queueMax: num('AGENT_QUEUE_MAX', 100),
    /** 代理"在线"判定窗口（分钟） */
    activeWindowMin: num('AGENT_ACTIVE_WINDOW_MIN', 5),
    /** wait_agent_task 长轮询服务端硬上限（毫秒） */
    waitTimeoutMs: num('AGENT_WAIT_TIMEOUT_MS', 25000),
    /** 长轮询兜底轮询间隔（毫秒，覆盖多实例与事件丢失） */
    waitFallbackPollMs: num('AGENT_WAIT_FALLBACK_POLL_MS', 2000),
    /** 长轮询并发等待者上限（超出快速返回，不排队） */
    waitMaxConcurrency: num('AGENT_WAIT_MAX_CONCURRENCY', 200),
    /** 每任务执行记录保留条数 */
    logKeep: num('AGENT_LOG_KEEP', 50),
    /** 代理绑定任务列表默认分页大小 */
    queuePageSize: num('AGENT_QUEUE_PAGE_SIZE', 20),
  },
  /** v0.4.0 法定工作日历 */
  workCalendar: {
    /** 国家/地区（本版仅 CN） */
    country: process.env.WORK_CALENDAR_COUNTRY || 'CN',
  },
  rateLimit: {
    authPerMin: num('RATE_LIMIT_AUTH_PER_MIN', 20),
    chatPerMin: num('RATE_LIMIT_CHAT_PER_MIN', 20),
    /** v0.4.0：/auth/refresh 每 IP 每分钟 */
    refreshPerMin: num('RATE_LIMIT_REFRESH_PER_MIN', 10),
    /** v0.5.0：归档聊天记录每用户每分钟（PRD 5.6 / SDD 7.2） */
    archivePerMin: num('RATE_LIMIT_ARCHIVE_PER_MIN', 1),
    /** v0.7.0：MCP 接入端点按代理凭据维度每分钟（SDD 5.2） */
    mcpPerMin: num('RATE_LIMIT_MCP_PER_MIN', 60),
  },
};

export function assertLlmConfigured(): void {
  if (!config.deepseek.apiKey) {
    throw new Error('缺少 DEEPSEEK_API_KEY，对话功能不可用（任务管理功能不受影响）');
  }
}