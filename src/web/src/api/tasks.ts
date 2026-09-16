import { request } from './client'
import type { Paged, Task, TaskPayload, TaskQuery } from '@/types'

export function fetchTasks(query: TaskQuery = {}): Promise<Paged<Task>> {
  return request<Paged<Task>>('/tasks', { query: query as Record<string, string | number> })
}

export function searchTasks(keyword: string): Promise<Task[]> {
  return request<Task[]>('/tasks/search', { query: { keyword } })
}

export function fetchTask(id: string | number): Promise<Task> {
  return request<Task>(`/tasks/${id}`)
}

export function createTask(payload: TaskPayload): Promise<Task> {
  return request<Task>('/tasks', { method: 'POST', body: payload })
}

export function updateTask(id: string | number, payload: Partial<TaskPayload>): Promise<Task> {
  return request<Task>(`/tasks/${id}`, { method: 'PATCH', body: payload })
}

export function deleteTask(id: string | number): Promise<unknown> {
  return request<unknown>(`/tasks/${id}`, { method: 'DELETE' })
}

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
    body: { filter, fields },
  })
}