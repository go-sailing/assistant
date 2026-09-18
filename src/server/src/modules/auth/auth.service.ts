import bcrypt from 'bcryptjs';
import { createHash, randomBytes } from 'crypto';
import { query, withTransaction } from '../../db/pool';
import { AppError } from '../../common/errors';
import { logger } from '../../common/logger';
import { config } from '../../config';
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
  nickname: string | null;
  status: number;
  created_at: Date;
  updated_at: Date;
}

interface RefreshRow {
  id: number;
  user_id: number;
  expires_at: Date;
  revoked_at: Date | null;
  replaced_by: number | null;
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

/* ------------------------- v0.4.0 刷新令牌 ------------------------- */

/** 令牌哈希：只存 SHA-256，库中不存在明文 */
function hashToken(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

/** 生成不透明刷新令牌（48 字节随机 → 96 位 hex） */
function generateRefreshToken(): string {
  return randomBytes(48).toString('hex');
}

function publicUser(user: { id: number; email: string; nickname?: string | null }) {
  return { id: user.id, email: user.email, nickname: user.nickname ?? null };
}

/** 签发一对凭证：access（JWT，2h）+ refresh（不透明，30 天滑动） */
async function issuePair(user: { id: number; email: string; nickname?: string | null }) {
  const refresh = generateRefreshToken();
  await query(
    `INSERT INTO refresh_tokens (user_id, token_hash, expires_at)
     VALUES ($1, $2, now() + ($3::int * interval '1 day'))`,
    [user.id, hashToken(refresh), config.refresh.ttlDays]
  );
  return {
    token: issueToken(user.id, user.email),
    refresh_token: refresh,
    user: publicUser(user),
  };
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

    // v0.4.0：注册即签发 access + refresh
    return issuePair(user);
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

    // v0.4.0：登录签发 access + refresh
    return issuePair(user);
  },

  logout(jti: string, exp: number): void {
    revokeToken(jti, exp);
  },

  /** v0.4.0：吊销指定刷新令牌（登出时可选传入） */
  async revokeRefreshToken(raw: string): Promise<void> {
    if (!raw) return;
    await query(
      `UPDATE refresh_tokens SET revoked_at = now()
       WHERE token_hash = $1 AND revoked_at IS NULL`,
      [hashToken(raw)]
    );
  },

  /**
   * v0.4.0：刷新令牌轮转（PRD 11.2 / SDD 5.1）。
   *
   * 单事务内「验旧 → 插新 → 废旧」，任何失败都返回统一 1002。
   * 安全要点：
   * - 已吊销令牌被再次使用 = 失窃信号 → 吊销该用户全部活跃 refresh 并告警；
   * - 成功响应不区分"不存在/过期/已吊销"，避免探测。
   */
  async rotateRefresh(raw: string) {
    if (!raw || !/^[0-9a-f]{96}$/.test(raw)) {
      throw AppError.unauthorized('登录已失效，请重新登录');
    }
    const hash = hashToken(raw);

    type RotateOutcome =
      | { kind: 'ok'; userId: number }
      | { kind: 'invalid' }
      | { kind: 'reuse'; userId: number; tokenId: number };

    // 注意：重放场景必须"先提交吊销、再抛错"——若在事务内直接抛错，
    // 吊销该用户全部令牌的 UPDATE 会随事务回滚，失窃保护就失效了。
    const outcome = await withTransaction<RotateOutcome>(async (client) => {
      const found = await client.query<RefreshRow>(
        `SELECT id, user_id, expires_at, revoked_at, replaced_by
         FROM refresh_tokens WHERE token_hash = $1 FOR UPDATE`,
        [hash]
      );
      const row = found.rows[0];
      if (!row) return { kind: 'invalid' };

      if (row.revoked_at) {
        // 重放已吊销令牌：视为失窃信号，吊销该用户全部活跃令牌
        await client.query(
          `UPDATE refresh_tokens SET revoked_at = now()
           WHERE user_id = $1 AND revoked_at IS NULL`,
          [row.user_id]
        );
        return { kind: 'reuse', userId: row.user_id, tokenId: row.id };
      }

      if (row.expires_at.getTime() <= Date.now()) return { kind: 'invalid' };

      const next = await client.query<{ id: number }>(
        `INSERT INTO refresh_tokens (user_id, token_hash, expires_at)
         VALUES ($1, $2, now() + ($3::int * interval '1 day'))
         RETURNING id`,
        [row.user_id, hashToken(generateRefreshToken()), config.refresh.ttlDays]
      );
      await client.query(
        `UPDATE refresh_tokens SET revoked_at = now(), replaced_by = $2 WHERE id = $1`,
        [row.id, next.rows[0].id]
      );
      return { kind: 'ok', userId: row.user_id };
    });

    if (outcome.kind === 'reuse') {
      logger.warn('refresh_token_reuse_detected', {
        user_id: outcome.userId,
        token_id: outcome.tokenId,
      });
      throw AppError.unauthorized('登录已失效，请重新登录');
    }
    if (outcome.kind === 'invalid') {
      throw AppError.unauthorized('登录已失效，请重新登录');
    }

    const res = await query<UserRow>(`SELECT * FROM users WHERE id = $1`, [outcome.userId]);
    const user = res.rows[0];
    if (!user || user.status !== 1) {
      throw AppError.unauthorized('登录已失效，请重新登录');
    }
    return issuePair(user);
  },

  /**
   * v0.4.0（P1）：修改密码（PRD 10.4）。
   *
   * 单事务：校验旧密码 → 更新 hash → 吊销该用户全部旧 refresh → 为当前设备签发新对。
   * 这样本端不掉线，其他端下次刷新即 1002（语义为"账号安全设置已变更"）。
   */
  async changePassword(
    userId: number,
    oldPassword: string,
    newPassword: string
  ) {
    const res = await query<UserRow>(`SELECT * FROM users WHERE id = $1`, [userId]);
    const user = res.rows[0];
    if (!user) throw AppError.notFound('账号不存在');

    const matched = await bcrypt.compare(oldPassword ?? '', user.password_hash);
    if (!matched) {
      // 与登录失败同文案，避免通过改密接口探测密码
      throw AppError.badCredentials();
    }
    const valid = validatePassword(newPassword);
    const passwordHash = await bcrypt.hash(valid, BCRYPT_ROUNDS);

    await withTransaction(async (client) => {
      await client.query(`UPDATE users SET password_hash = $2, updated_at = now() WHERE id = $1`, [
        userId,
        passwordHash,
      ]);
      // 先吊销全部旧 refresh（避免任何旧串残留），随后由 issuePair 签发当前设备的新对
      await client.query(
        `UPDATE refresh_tokens SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL`,
        [userId]
      );
    });

    return issuePair(user);
  },

  /** 注销账号：删除用户（任务/清单/会话/刷新令牌级联删除） */
  async deleteAccount(userId: number, jti: string, exp: number): Promise<void> {
    const res = await query(`DELETE FROM users WHERE id = $1`, [userId]);
    if (res.rowCount === 0) throw AppError.notFound('账号不存在');
    revokeToken(jti, exp);
  },
};