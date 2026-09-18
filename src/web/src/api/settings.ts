import { request } from './client'
import type { UserProfile, UserSettings } from '@/types'

/**
 * v0.4.0 个人信息与偏好设置（PRD 第 10 章）。
 */

export function getProfile(): Promise<UserProfile> {
  return request<UserProfile>('/me')
}

export function updateNickname(nickname: string | null): Promise<UserProfile> {
  return request<UserProfile>('/me', { method: 'PATCH', body: { nickname } })
}

export function getSettings(): Promise<UserSettings> {
  return request<UserSettings>('/settings')
}

export function updateSettings(patch: Partial<UserSettings>): Promise<UserSettings> {
  return request<UserSettings>('/settings', { method: 'PUT', body: patch })
}