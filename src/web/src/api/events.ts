import { request } from './client'
import type {
  CalendarEvent,
  EventPayload,
  EventQuery,
  MonthDayCount,
  Task,
} from '@/types'

/** 用户 IANA 时区（日程按自然日筛选/聚合都以此为准） */
export function localTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Shanghai'
  } catch {
    return 'Asia/Shanghai'
  }
}

/** 月视图聚合：日期 → 计数（只返回计数，不拉明细） */
export function fetchMonthCounts(year: number, month: number): Promise<MonthDayCount[]> {
  return request<MonthDayCount[]>('/events/monthly', {
    query: { year, month, tz: localTimezone() },
  })
}

/** 按日 / 日期范围查询（左闭右开） */
export function fetchEvents(query: EventQuery): Promise<CalendarEvent[]> {
  return request<CalendarEvent[]>('/events', {
    query: { tz: localTimezone(), ...query } as Record<string, string | number | undefined>,
  })
}

export function fetchEvent(id: string | number): Promise<CalendarEvent> {
  return request<CalendarEvent>(`/events/${id}`)
}

export function searchEvents(keyword: string): Promise<CalendarEvent[]> {
  return request<CalendarEvent[]>('/events/search', { query: { keyword } })
}

/** 创建日程；命中冲突时会抛 code=4009 的 ApiError（details 含 conflicts） */
export function createEvent(payload: EventPayload): Promise<CalendarEvent> {
  return request<CalendarEvent>('/events', { method: 'POST', body: payload })
}

export function updateEvent(
  id: string | number,
  payload: Partial<EventPayload>
): Promise<CalendarEvent> {
  return request<CalendarEvent>(`/events/${id}`, { method: 'PATCH', body: payload })
}

export function deleteEvent(id: string | number): Promise<unknown> {
  return request<unknown>(`/events/${id}`, { method: 'DELETE' })
}

/** 某任务的全部任务日程（任务详情「日程安排」分区） */
export function fetchTaskEvents(taskId: string | number): Promise<CalendarEvent[]> {
  return request<CalendarEvent[]>(`/tasks/${taskId}/events`)
}

export type { CalendarEvent, Task }