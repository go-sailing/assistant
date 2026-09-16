import { request } from './client'
import type { Paged, Task, TaskPayload, TaskQuery } from '@/types'

/** 把布尔/null 筛选参数转成后端可解析的 query 形态 */
function toQuery(query: TaskQuery & { root_only?: boolean; parent_id?: string | number }): Record<
  string,
  string | number | undefined
> {
  const out: Record<string, string | number | undefined> = {}
  Object.entries(query).forEach(([key, value]) => {
    if (value === undefined || value === null || value === '') return
    out[key] = typeof value === 'boolean' ? String(value) : (value as string | number)
  })
  return out
}

export function fetchTasks(
  query: TaskQuery & { root_only?: boolean; parent_id?: string | number } = {}
): Promise<Paged<Task>> {
  return request<Paged<Task>>('/tasks', { query: toQuery(query) })
}

export function searchTasks(keyword: string): Promise<Task[]> {
  return request<Task[]>('/tasks/search', { query: { keyword } })
}

export function fetchTask(id: string | number): Promise<Task> {
  return request<Task>(`/tasks/${id}`)
}

/** v0.2.0：子树（扁平节点数组，depth=1 表示只取下一级） */
export function fetchSubtree(id: string | number, depth?: number): Promise<Task[]> {
  return request<Task[]>(`/tasks/${id}/subtree`, { query: { depth } })
}

/** v0.2.0：面包屑链（根 → 父 → 当前） */
export function fetchAncestors(id: string | number): Promise<Task[]> {
  return request<Task[]>(`/tasks/${id}/ancestors`)
}

/** v0.2.0：可挂载父任务候选（排除自身与全部后代，同清单） */
export function fetchParentCandidates(id: string | number): Promise<Task[]> {
  return request<Task[]>(`/tasks/${id}/parent-candidates`)
}

export function createTask(payload: TaskPayload & { parent_id?: string | number | null }): Promise<Task> {
  return request<Task>('/tasks', { method: 'POST', body: payload })
}

export function updateTask(
  id: string | number,
  payload: Partial<TaskPayload> & { parent_id?: string | number | null }
): Promise<Task> {
  return request<Task>(`/tasks/${id}`, { method: 'PATCH', body: payload })
}

/** 删除任务：服务端会级联删除整棵子树及其全部任务日程，返回级联计数 */
export function deleteTask(
  id: string | number
): Promise<{ id: number; deleted_task_count?: number; deleted_event_count?: number }> {
  return request<{ id: number; deleted_task_count?: number; deleted_event_count?: number }>(
    `/tasks/${id}`,
    { method: 'DELETE' }
  )
}

/**
 * 完成 / 取消完成。
 * 完成含未完成子任务的父任务时服务端返回 4010（details.incomplete_descendant_count），
 * 由调用方确认后带 cascade=true 重发。
 */
export function completeTask(id: string | number, cascade = false): Promise<Task> {
  return request<Task>(`/tasks/${id}/complete`, { method: 'POST', body: cascade ? { cascade: true } : {} })
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
