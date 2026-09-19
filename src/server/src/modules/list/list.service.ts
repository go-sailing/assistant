import type { PoolClient } from 'pg';
import { query } from '../../db/pool';

const DEFAULT_LIST_NAME = '默认清单';

interface ListRow {
  id: number;
  user_id: number;
  name: string;
  is_default: boolean;
  created_at: Date;
  updated_at: Date;
}

/**
 * 清单服务（v0.7.0 收敛）：清单能力已从产品下线，
 * 本模块只保留内部兜底——保证任务始终有一个默认清单可落（tasks.list_id NOT NULL）。
 * 对外 REST 接口与其余 CRUD 能力已删除（SDD 6.1）。
 */
export const listService = {
  /** 默认清单 id；异常数据（缺失）时内联补建，保证调用方永不失败 */
  async getDefaultId(userId: number): Promise<number> {
    const res = await query<ListRow>(
      `SELECT * FROM task_lists WHERE user_id = $1 AND is_default = TRUE`,
      [userId]
    );
    if (res.rowCount && res.rowCount > 0) return res.rows[0].id;
    return this.createDefaultList(userId);
  },

  /** 注册时在事务内创建默认清单，保证「注册成功即有默认清单」 */
  async createDefaultList(userId: number, client?: PoolClient): Promise<number> {
    const sql = `INSERT INTO task_lists(user_id, name, is_default) VALUES ($1, $2, TRUE) RETURNING id`;
    if (client) {
      const res = await client.query<{ id: number }>(sql, [userId, DEFAULT_LIST_NAME]);
      return res.rows[0].id;
    }
    const res = await query<{ id: number }>(sql, [userId, DEFAULT_LIST_NAME]);
    return res.rows[0].id;
  },
};
