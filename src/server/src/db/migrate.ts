import fs from 'fs';
import path from 'path';
import { pool, closePool } from './pool';
import { logger } from '../common/logger';

/** 编译产物（dist）中不含 .sql，回退到源码目录 */
function resolveMigrationsDir(): string {
  const built = path.resolve(__dirname, 'migrations');
  if (fs.existsSync(built) && fs.readdirSync(built).some((f) => f.endsWith('.sql'))) {
    return built;
  }
  const source = path.resolve(__dirname, '../../src/db/migrations');
  if (fs.existsSync(source)) return source;
  return built;
}

const MIGRATIONS_DIR = resolveMigrationsDir();

/** 只读查询执行器（`Pool` / `PoolClient` 均符合） */
interface SqlRunner {
  query(sql: string): Promise<{ rows: Record<string, unknown>[] }>;
}

/* ============================================================
 * v0.9.0：迁移观测（TC-AUDIT-081 / TC-AUDIT-091 / SDD 13.2 / 13.3）
 *
 * 口径：只记 ID / 枚举 / **计数**，不记录日程标题、备注等任何正文；
 * 计数按用户与全库均可聚合（`users` 为涉及用户数，明细可用 `eventShapeStats()` 复核）。
 * ============================================================ */

/** 015 迁移期间的基线（迁移前采集；迁移后任务日程已不可区分，故必须前采） */
export interface LegacyTaskEventBaseline {
  /** 需要转换的任务日程条数 */
  task_events: number;
  /** 其中标题为空、需落兜底文案的条数 */
  blank_title: number;
  /** 涉及用户数（可按用户聚合） */
  users: number;
}

/** 015 迁移后的 events 形态核对（残留与空标题必须为 0） */
export interface EventShapeStats {
  normal_total: number;
  fallback_titles: number;
  remaining: number;
  empty_titles: number;
}

/** 迁移上下文（仅计数与耗时） */
interface MigrationContext {
  file: string;
  attempts: number;
  durationMs: number;
}

type Baseline = Record<string, number>;

const int = (v: unknown): number => (typeof v === 'number' ? v : Number(v) || 0);

/** 迁移前基线：待转换的任务日程条数、需兜底标题条数、涉及用户数 */
export async function captureLegacyTaskEventBaseline(
  runner: SqlRunner
): Promise<LegacyTaskEventBaseline> {
  const { rows } = await runner.query(`
    SELECT
      count(*)::int AS task_events,
      count(*) FILTER (WHERE t.title IS NULL OR btrim(t.title) = '')::int AS blank_title,
      count(DISTINCT e.user_id)::int AS users
    FROM events e
    LEFT JOIN tasks t ON t.id = e.task_id
    WHERE e.event_type = 'task' OR e.task_id IS NOT NULL
  `);
  const row = rows[0] ?? {};
  return {
    task_events: int(row.task_events),
    blank_title: int(row.blank_title),
    users: int(row.users),
  };
}

/** events 形态核对：全部为普通日程且标题非空时，`remaining` 与 `empty_titles` 均为 0 */
export async function eventShapeStats(runner: SqlRunner): Promise<EventShapeStats> {
  const { rows } = await runner.query(`
    SELECT
      count(*) FILTER (WHERE event_type = 'normal' AND task_id IS NULL)::int AS normal_total,
      count(*) FILTER (WHERE title = '（原任务日程）')::int AS fallback_titles,
      count(*) FILTER (WHERE event_type <> 'normal' OR task_id IS NOT NULL)::int AS remaining,
      count(*) FILTER (WHERE title IS NULL OR btrim(title) = '')::int AS empty_titles
    FROM events
  `);
  const row = rows[0] ?? {};
  return {
    normal_total: int(row.normal_total),
    fallback_titles: int(row.fallback_titles),
    remaining: int(row.remaining),
    empty_titles: int(row.empty_titles),
  };
}

/** 015 汇总日志（迁移提交后执行）：条数 + 耗时 + 尝试/重试次数，不含标题正文 */
async function logMigration015(
  client: SqlRunner,
  baseline: Baseline,
  ctx: MigrationContext
): Promise<void> {
  const shape = await eventShapeStats(client);
  const converted = baseline.task_events ?? 0;
  const fallback = baseline.blank_title ?? 0;
  logger.info('migration_015_converted', {
    file: ctx.file,
    /** 转换条数（任务日程 → 普通日程） */
    converted,
    /** 兜底标题条数（标题为空，落「（原任务日程）」） */
    fallback,
    /** 涉及用户数（按用户可聚合） */
    users: baseline.users ?? 0,
    normal_total: shape.normal_total,
    fallback_titles: shape.fallback_titles,
    /** 迁移后残留（应 0） */
    remaining: shape.remaining,
    /** 迁移后空标题（应 0） */
    empty_titles: shape.empty_titles,
    attempts: ctx.attempts,
    retries: Math.max(0, ctx.attempts - 1),
    duration_ms: ctx.durationMs,
  });
  if (shape.remaining > 0 || shape.empty_titles > 0) {
    logger.warn('migration_015_residual_rows', {
      file: ctx.file,
      remaining: shape.remaining,
      empty_titles: shape.empty_titles,
    });
  }
}

/**
 * 按迁移文件注册观测钩子：
 * - `before`：迁移前基线（事务外只读；采集失败只告警，不阻断迁移）；
 * - `after`：迁移提交后汇总（只读；失败只告警，不回滚已提交的迁移）。
 */
const MIGRATION_OBSERVERS: Record<
  string,
  {
    before?: (client: SqlRunner) => Promise<Baseline>;
    after: (client: SqlRunner, baseline: Baseline, ctx: MigrationContext) => Promise<void>;
  }
> = {
  '015_retire_task_project_agent.sql': {
    before: async (client) => ({ ...(await captureLegacyTaskEventBaseline(client)) }),
    after: logMigration015,
  },
};

/* ---------------- 瞬时故障重试（可观测：attempts / retries） ---------------- */

/** 单个迁移的最大尝试次数（仅瞬时故障重试；SQL 错误立即失败） */
const MIGRATION_MAX_ATTEMPTS = 3;

/** 可重试的瞬时故障码：序列化失败、死锁、连接类故障、服务端关机 */
const TRANSIENT_PG_CODES = new Set([
  '40001',
  '40P01',
  '08000',
  '08001',
  '08003',
  '08004',
  '08006',
  '57P01',
  '57P02',
  '57P03',
]);

function errorCode(err: unknown): string | undefined {
  const code = (err as { code?: unknown } | null)?.code;
  return typeof code === 'string' ? code : undefined;
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** 按文件名顺序执行未执行过的迁移，已执行记录在 schema_migrations 中 */
export async function runMigrations(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name       VARCHAR(255) PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  const applied = await pool.query<{ name: string }>('SELECT name FROM schema_migrations');
  const appliedSet = new Set(applied.rows.map((r) => r.name));

  const files = fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  /** 本次真正执行的迁移文件（用于输出迁移摘要，如 v0.8.0 的项目抽离埋点） */
  const executed: string[] = [];

  for (const file of files) {
    if (appliedSet.has(file)) continue;
    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
    const observer = MIGRATION_OBSERVERS[file];
    const startedAt = Date.now();
    logger.info('执行数据库迁移', { file });

    let attempts = 0;
    let baseline: Baseline = {};
    // 重试循环：仅瞬时故障重试（每次都是完整事务，失败已整体回滚）
    for (;;) {
      attempts += 1;
      const client = await pool.connect();
      try {
        if (observer?.before) {
          try {
            baseline = await observer.before(client);
          } catch (err) {
            // 基线采集失败不阻断迁移，但观测计数会缺失，需告警留痕
            baseline = {};
            logger.warn('迁移观测基线采集失败', { file, error: errorText(err) });
          }
        }
        await client.query('BEGIN');
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations(name) VALUES ($1)', [file]);
        await client.query('COMMIT');
        // 只在真正提交后登记（瞬时故障重试到成功的那一次才会记入）
        executed.push(file);
        if (observer) {
          try {
            await observer.after(client, baseline, {
              file,
              attempts,
              durationMs: Date.now() - startedAt,
            });
          } catch (err) {
            logger.warn('迁移观测汇总失败', { file, error: errorText(err) });
          }
        }
        break;
      } catch (err) {
        await client.query('ROLLBACK').catch(() => undefined);
        const code = errorCode(err);
        if (code && TRANSIENT_PG_CODES.has(code) && attempts < MIGRATION_MAX_ATTEMPTS) {
          logger.warn('迁移遇到瞬时故障，准备重试', {
            file,
            attempts,
            pg_code: code,
          });
          continue;
        }
        logger.error('迁移失败', {
          file,
          attempts,
          retries: Math.max(0, attempts - 1),
          duration_ms: Date.now() - startedAt,
          error: errorText(err),
        });
        throw err;
      } finally {
        client.release();
      }
    }
  }
  logger.info('数据库迁移完成', { total: files.length, skipped: appliedSet.size });

  // v0.8.0（远程）项目模型抽离的迁移摘要（埋点 project_extract_migrated）——历史迁移观测，
  // v0.9.0 已下线项目域（projects 表保留在库、停止读写），此处只在本次真正执行 014 时记录：
  // 转正日程数与丢弃的项目 priority/due_at 行数在迁移后已不可回溯，以演练清单与 SQL 断言为准，
  // 故只记录可查询的项目数与成员关系数。
  if (executed.includes('014_project_extract.sql')) {
    const summary = await pool.query<{ project_count: string; member_count: string }>(
      `SELECT (SELECT count(*) FROM projects) AS project_count,
              (SELECT count(*) FROM tasks WHERE project_id IS NOT NULL) AS member_count`
    );
    logger.info('project_extract_migrated', {
      project_count: Number(summary.rows[0]?.project_count ?? 0),
      member_count: Number(summary.rows[0]?.member_count ?? 0),
    });
  }
}

if (require.main === module) {
  runMigrations()
    .then(() => closePool())
    .then(() => process.exit(0))
    .catch((err) => {
      logger.error('迁移失败', { error: err instanceof Error ? err.message : String(err) });
      process.exit(1);
    });
}
