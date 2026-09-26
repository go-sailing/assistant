/**
 * SettingsService：个人信息与偏好设置（对应系统设计文档 5.2 节 / PRD 第 10 章）。
 *
 * - 昵称：≤20 字符，可空（空时界面回落展示邮箱）；头像为文字首字母，不涉及图片上传；
 * - 偏好：user_settings 单行 jsonb，读时与默认值合并（老用户无行也能取默认）。
 */
import { query } from '../../db/pool';
import { AppError } from '../../common/errors';

export interface UserProfile {
  id: number;
  email: string;
  nickname: string | null;
  avatar_initial: string;
  created_at: string;
}

export interface UserSettings {
  /** 显示农历（默认开）；关闭后全站农历文案隐藏，但法定「休/班」角标不受影响 */
  lunar_enabled: boolean;
  /** 二十四节气（默认开）；仅在 lunar_enabled 时可用 */
  solar_terms_enabled: boolean;
  /** 默认启动页（v0.9.0：只剩 /calendar 一个有效值） */
  home_route: '/calendar';
}

const DEFAULT_SETTINGS: UserSettings = {
  lunar_enabled: true,
  solar_terms_enabled: true,
  home_route: '/calendar',
};

const NICKNAME_MAX = 20;
/** 允许偏好的键白名单（未知键拒绝，避免脏数据进入 jsonb） */
const SETTINGS_KEYS = ['lunar_enabled', 'solar_terms_enabled', 'home_route'] as const;

interface UserRow {
  id: number;
  email: string;
  nickname: string | null;
  created_at: Date;
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function toDateString(d: Date): string {
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}

/** 头像文字：昵称首字优先，否则邮箱首字母大写 */
function avatarInitial(nickname: string | null, email: string): string {
  const name = (nickname ?? '').trim();
  if (name) return name.slice(0, 1).toUpperCase();
  return (email.slice(0, 1) || '?').toUpperCase();
}

function normalizeNickname(raw: unknown): string | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw !== 'string') throw AppError.paramInvalid('昵称格式不正确');
  const trimmed = raw.trim();
  if (!trimmed) return null;
  // 按 Unicode 码点计数，避免 emoji 被算作多个字符
  const chars = [...trimmed];
  if (chars.length > NICKNAME_MAX) {
    throw AppError.paramInvalid(`昵称不能超过 ${NICKNAME_MAX} 个字符`);
  }
  return chars.join('');
}

/** 合并存量 payload 与默认值，得到**用户原始偏好**（不做联动，联动见 toEffective） */
function mergeSettings(payload: Record<string, unknown> | null | undefined): UserSettings {
  const raw = payload ?? {};
  const bool = (key: keyof UserSettings, fallback: boolean): boolean =>
    typeof raw[key] === 'boolean' ? (raw[key] as boolean) : fallback;
  const homeRoute = '/calendar' as const;
  return {
    lunar_enabled: bool('lunar_enabled', DEFAULT_SETTINGS.lunar_enabled),
    solar_terms_enabled: bool('solar_terms_enabled', DEFAULT_SETTINGS.solar_terms_enabled),
    home_route: homeRoute,
  };
}

/**
 * 由原始偏好推导**生效值**：节气依赖农历。
 *
 * 只影响返回值，不覆盖用户存储的原始偏好——这样"关农历 → 再开"能恢复
 * 用户原先的节气选择，而不是被静默重置为默认（PRD 5.4 的联动是生效层面的约束）。
 */
function toEffective(raw: UserSettings): UserSettings {
  return raw.lunar_enabled ? raw : { ...raw, solar_terms_enabled: false };
}

export const settingsService = {
  /** GET /me：账号信息（含头像文字与注册日期） */
  async getProfile(userId: number): Promise<UserProfile> {
    const res = await query<UserRow>(
      `SELECT id, email, nickname, created_at FROM users WHERE id = $1`,
      [userId]
    );
    const row = res.rows[0];
    if (!row) throw AppError.notFound('账号不存在');
    return {
      id: row.id,
      email: row.email,
      nickname: row.nickname,
      avatar_initial: avatarInitial(row.nickname, row.email),
      created_at: toDateString(row.created_at),
    };
  },

  /** PATCH /me：更新昵称（null 或 ≤20 字） */
  async updateNickname(userId: number, rawNickname: unknown): Promise<UserProfile> {
    const nickname = normalizeNickname(rawNickname);
    const res = await query(
      `UPDATE users SET nickname = $2, updated_at = now() WHERE id = $1`,
      [userId, nickname]
    );
    if (res.rowCount === 0) throw AppError.notFound('账号不存在');
    return this.getProfile(userId);
  },

  /** GET /settings：返回**生效值**（农历关闭时节气为 false，但用户原始偏好被保留） */
  async getSettings(userId: number): Promise<UserSettings> {
    const res = await query<{ payload: Record<string, unknown> }>(
      `SELECT payload FROM user_settings WHERE user_id = $1`,
      [userId]
    );
    return toEffective(mergeSettings(res.rows[0]?.payload));
  },

  /** PUT /settings：半量更新（键白名单 + 类型校验），持久化用户原始偏好 */
  async updateSettings(userId: number, patch: Record<string, unknown>): Promise<UserSettings> {
    if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
      throw AppError.paramInvalid('设置参数格式不正确');
    }
    const keys = Object.keys(patch);
    if (keys.length === 0) throw AppError.paramInvalid('没有需要更新的设置项');
    for (const key of keys) {
      if (!(SETTINGS_KEYS as readonly string[]).includes(key)) {
        throw AppError.paramInvalid(`不支持的设置项：${key}`);
      }
    }
    if (patch.home_route !== undefined && patch.home_route !== '/calendar') {
      throw AppError.paramInvalid('默认启动页取值不合法');
    }
    for (const key of ['lunar_enabled', 'solar_terms_enabled'] as const) {
      if (patch[key] !== undefined && typeof patch[key] !== 'boolean') {
        throw AppError.paramInvalid('开关取值需为布尔值');
      }
    }

    // 以**原始偏好**（而非生效值）为基座合并，避免联动结果被写回存储
    const res = await query<{ payload: Record<string, unknown> }>(
      `SELECT payload FROM user_settings WHERE user_id = $1`,
      [userId]
    );
    const raw = mergeSettings(res.rows[0]?.payload);
    // 农历关闭时用户无法操作节气开关，此时不接受对节气的写入（保持原偏好）
    const effectiveNow = toEffective(raw);
    const next: UserSettings = {
      ...raw,
      ...(patch as Partial<UserSettings>),
    };
    if (!effectiveNow.lunar_enabled && patch.solar_terms_enabled !== undefined) {
      next.solar_terms_enabled = raw.solar_terms_enabled;
    }

    await query(
      `INSERT INTO user_settings (user_id, payload, updated_at)
       VALUES ($1, $2::jsonb, now())
       ON CONFLICT (user_id)
       DO UPDATE SET payload = $2::jsonb, updated_at = now()`,
      [userId, JSON.stringify(next)]
    );
    return toEffective(next);
  },
};