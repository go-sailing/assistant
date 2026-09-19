import { request } from './client'
import type { Agent, AgentWithToken } from '@/types'

/** 代理列表（含连接状态与任务计数） */
export function fetchAgents(): Promise<Agent[]> {
  return request<Agent[]>('/agents')
}

export function createAgent(payload: {
  name: string
  kind: string
  kind_label?: string
  description?: string | null
}): Promise<AgentWithToken> {
  return request<AgentWithToken>('/agents', { method: 'POST', body: payload })
}

export function fetchAgent(id: number | string): Promise<Agent> {
  return request<Agent>(`/agents/${id}`)
}

export function updateAgent(
  id: number | string,
  patch: Partial<{ name: string; kind: string; kind_label: string; description: string | null; status: string }>
): Promise<Agent> {
  return request<Agent>(`/agents/${id}`, { method: 'PATCH', body: patch })
}

/** 重置凭据：返回新明文（仅此一次） */
export function rotateAgentToken(id: number | string): Promise<AgentWithToken> {
  return request<AgentWithToken>(`/agents/${id}/token/rotate`, { method: 'POST' })
}

/** 删除代理：返回队列迁移与处理结果 */
export function deleteAgent(id: number | string): Promise<{
  pending: number
  running: number
  unassigned_tasks: number[]
  kept_running_tasks: number[]
}> {
  return request(`/agents/${id}`, { method: 'DELETE' })
}

/** 绑定任务列表（按执行状态筛选） */
export function fetchAgentTasks(
  id: number | string,
  query: { state?: string; page?: number; page_size?: number } = {}
): Promise<{ list: import('@/types').Task[]; total: number; page: number; page_size: number }> {
  return request(`/agents/${id}/tasks`, { query })
}
