import type { PoolClient } from 'pg';
import { query } from '../../db/pool';
import { config } from '../../config';
import type { ExtractedItem, MemoryRow } from './memory.schema';

/**
 * v0.5.0 长期记忆数据访问（系统设计文档 5.4）。
 *
 * 所有语句一律带 user_id 条件（记忆归属不可越权）；
 * 更新/删除的 id 由 service 层先做归属校验，此处仍以 user_id 兜底。
 */

const RETURNING = 'id, user_id, content, category, created_at, updated_at, last_used_at';

export const memoryRepository = {
  /** 记忆列表：按 updated_at DESC、id DESC（上限 200，防异常膨胀） */
  async listByUser(userId: number, limit = 200): Promise<{ rows: MemoryRow[]; total: number }> {
    const res = await query<MemoryRow>(
      `SELECT ${RETURNING} FROM long_term_memories
       WHERE user_id = $1
       ORDER BY updated_at DESC, id DESC
       LIMIT $2`,
      [userId, limit]
    );
    const count = await query<{ total: string }>(
      `SELECT COUNT(*)::int AS total FROM long_term_memories WHERE user_id = $1`,
      [userId]
    );
    return { rows: res.rows, total: Number(count.rows[0]?.total ?? 0) };
  },

  /** 注入装配用：最近更新的记忆（≤ MEMORY_MAX_TOTAL 条） */
  async listForPrompt(userId: number): Promise<MemoryRow[]> {
    const res = await query<MemoryRow>(
      `SELECT ${RETURNING} FROM long_term_memories
       WHERE user_id = $1
       ORDER BY updated_at DESC, id DESC
       LIMIT $2`,
      [userId, config.memory.maxTotal]
    );
    return res.rows;
  },

  async countByUser(userId: number, client?: PoolClient): Promise<number> {
    const sql = `SELECT COUNT(*)::int AS total FROM long_term_memories WHERE user_id = $1`;
    const res = client
      ? await client.query<{ total: string }>(sql, [userId])
      : await query<{ total: string }>(sql, [userId]);
    return Number(res.rows[0]?.total ?? 0);
  },

  /** 本用户全部记忆 id（阶段 B 的 id 归属校验用） */
  async idsOfUser(userId: number): Promise<Set<number>> {
    const res = await query<{ id: string }>(
      `SELECT id FROM long_term_memories WHERE user_id = $1`,
      [userId]
    );
    return new Set(res.rows.map((r) => Number(r.id)));
  },

  /** 单条删除：行计数 0 表示不存在或不属于本人（对外统一 404） */
  async deleteOne(userId: number, id: number, client?: PoolClient): Promise<number> {
    const sql = `DELETE FROM long_term_memories WHERE id = $1 AND user_id = $2`;
    const res = client ? await client.query(sql, [id, userId]) : await query(sql, [id, userId]);
    return res.rowCount ?? 0;
  },

  /** 全部删除，返回删除条数 */
  async deleteAll(userId: number, client?: PoolClient): Promise<number> {
    const sql = `DELETE FROM long_term_memories WHERE user_id = $1`;
    const res = client ? await client.query(sql, [userId]) : await query(sql, [userId]);
    return res.rowCount ?? 0;
  },

  async insertMany(userId: number, items: ExtractedItem[], client?: PoolClient): Promise<number> {
    if (items.length === 0) return 0;
    const params: unknown[] = [userId];
    const values = items
      .map((item) => {
        params.push(item.content, item.category);
        return `($1, $${params.length - 1}, $${params.length})`;
      })
      .join(', ');
    const sql = `INSERT INTO long_term_memories(user_id, content, category) VALUES ${values}`;
    const res = client ? await client.query(sql, params) : await query(sql, params);
    return res.rowCount ?? 0;
  },

  async updateOne(
    userId: number,
    id: number,
    content: string,
    category: string,
    client?: PoolClient
  ): Promise<number> {
    const sql = `UPDATE long_term_memories
       SET content = $3, category = $4, updated_at = now()
       WHERE id = $1 AND user_id = $2`;
    const params = [id, userId, content, category];
    const res = client ? await client.query(sql, params) : await query(sql, params);
    return res.rowCount ?? 0;
  },

  async deleteMany(userId: number, ids: number[], client?: PoolClient): Promise<number> {
    if (ids.length === 0) return 0;
    const sql = `DELETE FROM long_term_memories WHERE id = ANY($1::bigint[]) AND user_id = $2`;
    const params = [ids, userId];
    const res = client ? await client.query(sql, params) : await query(sql, params);
    return res.rowCount ?? 0;
  },

  /** 容量淘汰：取最久未更新（updated_at 最旧）且不在本轮保留集合中的条目 */
  async listOldestNotUpdated(
    userId: number,
    keepIds: number[],
    limit: number,
    client?: PoolClient
  ): Promise<number[]> {
    if (limit <= 0) return [];
    const sql = `SELECT id FROM long_term_memories
       WHERE user_id = $1 AND NOT (id = ANY($2::bigint[]))
       ORDER BY updated_at ASC, id ASC
       LIMIT $3`;
    const params = [userId, keepIds, limit];
    const res = client
      ? await client.query<{ id: string }>(sql, params)
      : await query<{ id: string }>(sql, params);
    return res.rows.map((r) => Number(r.id));
  },

  /**
   * last_used_at 节流：每天最多 touch 一次（仅更新超过 1 天未 touch 的行）。
   * 失败不影响对话（调用方吞掉异常）。
   */
  async touchLastUsed(userId: number, ids: number[]): Promise<void> {
    if (ids.length === 0) return;
    await query(
      `UPDATE long_term_memories
       SET last_used_at = now()
       WHERE user_id = $1 AND id = ANY($2::bigint[])
         AND (last_used_at IS NULL OR last_used_at < now() - interval '1 day')`,
      [userId, ids]
    );
  },
};