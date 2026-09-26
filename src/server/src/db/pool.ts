import { Pool, type PoolClient, type QueryResult, type QueryResultRow } from 'pg';
import { config } from '../config';
import { logger } from '../common/logger';

export const pool = new Pool({
  connectionString: config.databaseUrl,
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

pool.on('error', (err) => {
  logger.error('数据库连接异常', { error: err.message });
});

const SLOW_QUERY_MS = 300;

export async function query<R extends QueryResultRow = QueryResultRow>(
  sql: string,
  params: unknown[] = []
): Promise<QueryResult<R>> {
  const start = Date.now();
  const result = await pool.query<R>(sql, params as never[]);
  const latency = Date.now() - start;
  if (latency > SLOW_QUERY_MS) {
    logger.warn('慢查询', { latency_ms: latency, sql: sql.slice(0, 200) });
  }
  return result;
}

/** 在单个事务中执行，异常自动回滚（用于注册建用户、循环派生、清空会话等复合写） */
export async function withTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function closePool(): Promise<void> {
  await pool.end();
}