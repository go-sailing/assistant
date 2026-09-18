import { request } from './client'
import type { AuthResult } from '@/types'
import { getRefreshToken } from '@/utils/token'

export function register(email: string, password: string): Promise<AuthResult> {
  return request<AuthResult>('/auth/register', {
    method: 'POST',
    body: { email, password },
  })
}

export function login(email: string, password: string): Promise<AuthResult> {
  return request<AuthResult>('/auth/login', {
    method: 'POST',
    body: { email, password },
  })
}

/** 登出：带上 refresh 一并吊销，避免登出后旧串仍可换新 */
export function logout(): Promise<unknown> {
  const refresh = getRefreshToken()
  return request<unknown>('/auth/logout', {
    method: 'POST',
    body: refresh ? { refresh_token: refresh } : {},
  })
}

/** 注销账号（不可恢复） */
export function deleteAccount(): Promise<unknown> {
  return request<unknown>('/auth/me', { method: 'DELETE', body: { confirm: true } })
}

/**
 * v0.4.0（P1）：修改密码。
 * 成功后后端直接返回当前设备的新凭证对（其他设备的刷新令牌会被吊销）。
 */
export function changePassword(oldPassword: string, newPassword: string): Promise<AuthResult> {
  return request<AuthResult>('/auth/change-password', {
    method: 'POST',
    body: { old_password: oldPassword, new_password: newPassword },
  })
}