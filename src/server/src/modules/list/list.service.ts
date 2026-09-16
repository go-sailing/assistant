import type { PoolClient } from 'pg';
import { query, withTransaction } from '../../db/pool';
import { AppError } from '../../common/errors';
import { toListDTO, type ListDTO, type ListRow } from '../task/types';

const LIST_NAME_MAX = 50;
const DEFAULT_LIST_NAME = '默认清单';

function normalizeName(name: string): string {
  const trimmed = (name ?? '').trim();
  if (!trimmed) throw AppError.paramInvalid('清单名称不能为空');
  if (trimmed.length > LIST_NAME_MAX) {
    throw AppError.paramInvalid(`清单名称不能超过 ${LIST_NAME_MAX} 个字符`);
  }
  return trimmed;
}

export const listService = {
  async listByUser(userId: number): Promise<ListDTO[]> {
    const res = await query<ListRow>(
      `SELECT * FROM task_lists WHERE user_id = $1 ORDER BY is_default DESC, id ASC`,
      [userId]
    );
    return res.rows.map(toListDTO);
  },

  async getDefault(userId: number): Promise<ListRow> {
    const res = await query<ListRow>(
      `SELECT * FROM task_lists WHERE user_id = $1 AND is_default = TRUE`,
      [userId]
    );
    if (res.rowCount === 0) {
      throw AppError.notFound('默认清单不存在');
    }
    return res.rows[0];
  },

  /** 注册时在事务内创建默认清单，保证「注册成功即有默认清单」 */
  async createDefaultList(userId: number, client: PoolClient): Promise<number> {
    const res = await client.query<ListRow>(
      `INSERT INTO task_lists(user_id, name, is_default) VALUES ($1, $2, TRUE) RETURNING *`,
      [userId, DEFAULT_LIST_NAME]
    );
    return res.rows[0].id;
  },

  async create(userId: number, name: string): Promise<ListDTO> {
    const normalized = normalizeName(name);
    const duplicated = await query(
      `SELECT 1 FROM task_lists WHERE user_id = $1 AND name = $2`,
      [userId, normalized]
    );
    if (duplicated.rowCount && duplicated.rowCount > 0) {
      throw AppError.conflict('已存在同名清单');
    }
    const res = await query<ListRow>(
      `INSERT INTO task_lists(user_id, name) VALUES ($1, $2) RETURNING *`,
      [userId, normalized]
    );
    return toListDTO(res.rows[0]);
  },

  /** 查询清单归属，不存在或不属于该用户时抛错（防水平越权） */
  async getOwned(userId: number, listId: number): Promise<ListRow> {
    const res = await query<ListRow>(`SELECT * FROM task_lists WHERE id = $1 AND user_id = $2`, [
      listId,
      userId,
    ]);
    if (res.rowCount === 0) throw AppError.notFound('清单不存在');
    return res.rows[0];
  },

  /** 按名称查找清单（供对话创建任务时使用），找不到返回 null */
  async findByName(userId: number, name: string): Promise<ListRow | null> {
    const res = await query<ListRow>(
      `SELECT * FROM task_lists WHERE user_id = $1 AND name = $2 LIMIT 1`,
      [userId, name.trim()]
    );
    return res.rows[0] ?? null;
  },

  async rename(userId: number, listId: number, name: string): Promise<ListDTO> {
    const list = await this.getOwned(userId, listId);
    if (list.is_default) {
      throw AppError.conflict('默认清单不可重命名');
    }
    const normalized = normalizeName(name);
    const duplicated = await query(
      `SELECT 1 FROM task_lists WHERE user_id = $1 AND name = $2 AND id <> $3`,
      [userId, normalized, listId]
    );
    if (duplicated.rowCount && duplicated.rowCount > 0) {
      throw AppError.conflict('已存在同名清单');
    }
    const res = await query<ListRow>(
      `UPDATE task_lists SET name = $1, updated_at = now() WHERE id = $2 RETURNING *`,
      [normalized, listId]
    );
    return toListDTO(res.rows[0]);
  },

  /**
   * 删除清单：事务内先把清单内任务迁移到默认清单，再删除清单（任务不丢失）
   */
  async remove(userId: number, listId: number): Promise<{ movedTasks: number }> {
    const list = await this.getOwned(userId, listId);
    if (list.is_default) {
      throw AppError.conflict('默认清单不可删除');
    }
    const defaultList = await this.getDefault(userId);

    return withTransaction(async (client) => {
      const moved = await client.query(
        `UPDATE tasks SET list_id = $1, updated_at = now() WHERE list_id = $2 AND user_id = $3`,
        [defaultList.id, listId, userId]
      );
      await client.query(`DELETE FROM task_lists WHERE id = $1 AND user_id = $2`, [listId, userId]);
      return { movedTasks: moved.rowCount ?? 0 };
    });
  },
};