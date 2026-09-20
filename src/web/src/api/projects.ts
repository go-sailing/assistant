import { request } from './client'
import type { Paged, Project, ProjectPayload, ProjectQuery, RemovePreview, Task } from '@/types'

/* ---------------- v0.8.0 项目（独立实体，MDL-01） ---------------- */

/** 项目列表：服务端固定按创建时间倒序（端上无排序控件） */
export function fetchProjects(query: ProjectQuery = {}): Promise<Paged<Project>> {
  return request<Paged<Project>>('/projects', { query: { ...query } })
}

/** 筛选器候选/表单候选：一次取足够多条（上限 100） */
export function fetchProjectOptions(): Promise<Project[]> {
  return fetchProjects({ page: 1, page_size: 100 }).then((res) => res.list)
}

export function fetchProject(id: string | number): Promise<Project> {
  return request<Project>(`/projects/${id}`)
}

export function createProject(payload: ProjectPayload): Promise<Project> {
  return request<Project>('/projects', { method: 'POST', body: payload })
}

export function updateProject(id: string | number, payload: Partial<ProjectPayload>): Promise<Project> {
  return request<Project>(`/projects/${id}`, { method: 'PATCH', body: payload })
}

/** 项目成员任务（任务 DTO；分页） */
export function fetchProjectMembers(
  id: string | number,
  query: { status?: 'todo' | 'completed'; keyword?: string; page?: number; page_size?: number } = {}
): Promise<Paged<Task>> {
  return request<Paged<Task>>(`/projects/${id}/members`, { query: { ...query } })
}

/** 删除前预取影响范围（成员任务数与关联日程数） */
export function previewRemoveProject(id: string | number): Promise<RemovePreview> {
  return request<RemovePreview>(`/projects/${id}/preview-remove`)
}

/** 删除项目：级联删除成员任务及其任务日程，返回实际删除计数 */
export function deleteProject(
  id: string | number
): Promise<{ id: number; deleted_task_count: number; deleted_event_count: number }> {
  return request<{ id: number; deleted_task_count: number; deleted_event_count: number }>(
    `/projects/${id}`,
    { method: 'DELETE' }
  )
}
