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
    logger.info('执行数据库迁移', { file });
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations(name) VALUES ($1)', [file]);
      await client.query('COMMIT');
      executed.push(file);
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }
  logger.info('数据库迁移完成', { total: files.length, skipped: appliedSet.size });

  // v0.8.0 项目模型抽离的迁移摘要（埋点 project_extract_migrated）。
  // 只在本次真正执行 014 时记录：转正日程数与丢弃的项目 priority/due_at 行数在迁移后
  // 已不可回溯，以演练清单与 SQL 断言为准，故此处只记录可查询的项目数与成员关系数。
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