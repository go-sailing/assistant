import { request } from './client'
import type { TaskList } from '@/types'

export function fetchLists(): Promise<TaskList[]> {
  return request<TaskList[]>('/lists')
}

export function createList(name: string): Promise<TaskList> {
  return request<TaskList>('/lists', { method: 'POST', body: { name } })
}

export function renameList(id: string | number, name: string): Promise<TaskList> {
  return request<TaskList>(`/lists/${id}`, { method: 'PATCH', body: { name } })
}

export function deleteList(id: string | number): Promise<unknown> {
  return request<unknown>(`/lists/${id}`, { method: 'DELETE' })
}