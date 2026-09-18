import { request } from './client'
import type { Memory } from '@/types'

/**
 * v0.5.0 长期记忆接口（SDD 7.1）。
 * 全部走统一 request()：自动携带凭证与 401 静默重放。
 */
export function listMemories(): Promise<{ list: Memory[]; total: number }> {
  return request<{ list: Memory[]; total: number }>('/memories')
}

/** 单条删除（不存在/越权统一 404） */
export function deleteMemory(id: string | number): Promise<{ deleted: number }> {
  return request<{ deleted: number }>(`/memories/${id}`, { method: 'DELETE' })
}

/** 全部删除（危险操作，仅作用于本人） */
export function clearMemories(): Promise<{ deleted: number }> {
  return request<{ deleted: number }>('/memories/clear', { method: 'POST' })
}