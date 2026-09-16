import { request } from './client'
import type { AuthResult } from '@/types'

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

export function logout(): Promise<unknown> {
  return request<unknown>('/auth/logout', { method: 'POST' })
}

/** 注销账号（不可恢复） */
export function deleteAccount(): Promise<unknown> {
  return request<unknown>('/auth/me', { method: 'DELETE' })
}