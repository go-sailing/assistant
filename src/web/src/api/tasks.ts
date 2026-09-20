import { request } from './client'
import type { AgentLog, Paged, RemovePreview, Task, TaskPayload, TaskQuery } from '@/types'

/** 把布尔/null 筛选参数转成后端可解析的 query 形态 */
function toQuery(query: TaskQuery): Record<string, string | number | undefined> {
  const out: Record<string, string | number | undefined> = {}
  Object.entries(query).forEach(([key, value]) => {
    if (value === undefined || value === null || value === '') return
    out[key] = typeof value === 'boolean' ? String(value) : (value as string | number)
  })
  return out
}

/** 任务列表：不传 project_id 即为全部任务（含项目下的任务） */
export function fetchTasks(query: TaskQuery = {}): Promise<Paged<Task>> {
  return request<Paged<Task>>('/tasks', { query: toQuery(query) })
}

export function searchTasks(keyword: string): Promise<Task[]> {
  return request<Task[]>('/tasks/search', { query: { keyword } })
}

export function fetchTask(id: string | number): Promise<Task> {
  return request<Task>(`/tasks/${id}`)
}

/** 删除前预取影响范围（不写库） */
export function fetchPreviewRemove(id: string | number): Promise<RemovePreview> {
  return request<RemovePreview>(`/tasks/${id}/preview-remove`)
}

export function createTask(payload: TaskPayload): Promise<Task> {
  return request<Task>('/tasks', { method: 'POST', body: payload })
}

export function updateTask(id: string | number, payload: Partial<TaskPayload>): Promise<Task> {
  return request<Task>(`/tasks/${id}`, { method: 'PATCH', body: payload })
}

/** 删除任务：项目会级联删除全部成员任务及其日程，返回级联计数 */
export function deleteTask(
  id: string | number
): Promise<{ id: number; deleted_task_count?: number; deleted_event_count?: number }> {
  return request<{ id: number; deleted_task_count?: number; deleted_event_count?: number }>(
    `/tasks/${id}`,
    { method: 'DELETE' }
  )
}

/**
 * 完成 / 取消完成（v0.8.0：项目不再是任务，级联完成已随模型抽离下线）。
 * 完成含未完成成员的项目时，服务端会按其成员完成度派生项目状态；端上无级联确认。
 */
export function completeTask(id: string | number): Promise<Task> {
  return request<Task>(`/tasks/${id}/complete`, { method: 'POST' })
}

export function uncompleteTask(id: string | number): Promise<Task> {
  return request<Task>(`/tasks/${id}/uncomplete`, { method: 'POST' })
}

/** 批量更新：筛选条件 + 待更新字段 */
export function batchUpdateTasks(
  filter: TaskQuery,
  fields: Partial<TaskPayload>
): Promise<{ affected: number }> {
  return request<{ affected: number }>('/tasks/batch-update', {
    method: 'POST',
    body: { filter, update: fields },
  })
}

/* ---------------- v0.7.0 智能体代理（任务侧） ---------------- */

/**
 * 指派任务给代理：**指派即自动入队并自动下发**，无需二次通知。
 * 任务已有代理时需要 replace=true 才会更换代理。
 */
export function assignTaskAgent(
  id: string | number,
  agentId: number,
  replace = false
): Promise<Task> {
  return request<Task>(`/tasks/${id}/agent`, {
    method: 'POST',
    body: { agent_id: agentId, replace },
  })
}

/** 取消指派：执行中（running）需 confirm=true 二次确认 */
export function unassignTaskAgent(id: string | number, confirm = false): Promise<Task> {
  return request<Task>(`/tasks/${id}/agent${confirm ? '?confirm=true' : ''}`, {
    method: 'DELETE',
  })
}

/** 重新执行：仅 failed 态可用（失败不自动重试） */
export function retryTaskAgent(id: string | number): Promise<Task> {
  return request<Task>(`/tasks/${id}/agent/retry`, { method: 'POST' })
}

/** 执行记录（时间线，倒序分页） */
export function fetchAgentLogs(
  id: string | number,
  query: { page?: number; page_size?: number } = {}
): Promise<Paged<AgentLog>> {
  return request<Paged<AgentLog>>(`/tasks/${id}/agent-logs`, { query })
}
