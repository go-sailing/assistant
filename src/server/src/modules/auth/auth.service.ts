import bcrypt from 'bcryptjs';
import { query, withTransaction } from '../../db/pool';
import { AppError } from '../../common/errors';
import { listService } from '../list/list.service';
import { issueToken, revokeToken } from '../../middleware/auth';

// 仅接受 ASCII 邮箱，避免「中文@test.com」这类实际不可用的地址通过校验
const EMAIL_REGEX = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}$/;
const PASSWORD_MIN = 8;
const BCRYPT_ROUNDS = 10;

interface UserRow {
  id: number;
  email: string;
  password_hash: string;
  status: number;
  created_at: Date;
  updated_at: Date;
}

function normalizeEmail(email: string): string {
  const normalized = (email ?? '').trim().toLowerCase();
  if (!normalized) throw AppError.paramInvalid('请输入邮箱');
  if (normalized.length > 254 || !EMAIL_REGEX.test(normalized)) {
    throw AppError.paramInvalid('邮箱格式不正确');
  }
  return normalized;
}

function validatePassword(password: string): string {
  const value = password ?? '';
  if (value.length < PASSWORD_MIN) {
    throw AppError.paramInvalid(`密码至少 ${PASSWORD_MIN} 位`);
  }
  if (value.length > 72) {
    throw AppError.paramInvalid('密码过长');
  }
  if (!/[a-zA-Z]/.test(value) || !/\d/.test(value)) {
    throw AppError.paramInvalid('密码需同时包含字母和数字');
  }
  return value;
}

export const authService = {
  /**
   * 注册：事务内创建用户 + 默认清单，保证「注册成功即有默认清单」
   * MVP 无验证码、无邮箱激活（PRD 6.3）
   */
  async register(email: string, password: string) {
    const normalizedEmail = normalizeEmail(email);
    const validPassword = validatePassword(password);
    const passwordHash = await bcrypt.hash(validPassword, BCRYPT_ROUNDS);

    const user = await withTransaction(async (client) => {
      const existed = await client.query(`SELECT 1 FROM users WHERE email = $1`, [normalizedEmail]);
      if (existed.rowCount && existed.rowCount > 0) {
        throw AppError.conflict('该邮箱已注册');
      }
      const inserted = await client.query<UserRow>(
        `INSERT INTO users(email, password_hash) VALUES ($1, $2) RETURNING *`,
        [normalizedEmail, passwordHash]
      );
      await listService.createDefaultList(inserted.rows[0].id, client);
      return inserted.rows[0];
    });

    return {
      token: issueToken(user.id, user.email),
      user: { id: user.id, email: user.email },
    };
  },

  async login(email: string, password: string) {
    const normalizedEmail = normalizeEmail(email);
    const res = await query<UserRow>(`SELECT * FROM users WHERE email = $1`, [normalizedEmail]);
    const user = res.rows[0];

    // 统一文案，避免账号枚举
    if (!user || user.status !== 1) {
      throw AppError.badCredentials();
    }
    const matched = await bcrypt.compare(password ?? '', user.password_hash);
    if (!matched) {
      throw AppError.badCredentials();
    }

    return {
      token: issueToken(user.id, user.email),
      user: { id: user.id, email: user.email },
    };
  },

  logout(jti: string, exp: number): void {
    revokeToken(jti, exp);
  },

  /** 注销账号：删除用户（任务/清单/会话级联删除） */
  async deleteAccount(userId: number, jti: string, exp: number): Promise<void> {
    const res = await query(`DELETE FROM users WHERE id = $1`, [userId]);
    if (res.rowCount === 0) throw AppError.notFound('账号不存在');
    revokeToken(jti, exp);
  },
};