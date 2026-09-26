import { request } from './client'
import type {
  CalendarEvent,
  EventPayload,
  EventQuery,
  LunarResolved,
  MonthDayCount,
  Occurrence,
  SeriesDetail,
} from '@/types'

/** 用户 IANA 时区（日程按自然日筛选/聚合都以此为准） */
export function localTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Shanghai'
  } catch {
    return 'Asia/Shanghai'
  }
}

/** 把布尔筛选参数转成后端可解析的 query 形态 */
function toQuery(query: EventQuery): Record<string, string | number | undefined> {
  const out: Record<string, string | number | undefined> = {
    tz: localTimezone(),
  }
  Object.entries(query).forEach(([key, value]) => {
    if (value === undefined || value === null || value === '') return
    out[key] = typeof value === 'boolean' ? String(value) : (value as string | number)
  })
  return out
}

/** 月视图聚合：逐日返回计数 + 农历 + 法定状态（dense，无日程的日期也带农历） */
export function fetchMonthCounts(year: number, month: number): Promise<MonthDayCount[]> {
  return request<MonthDayCount[]>('/events/monthly', {
    query: { year, month, tz: localTimezone() },
  })
}

/**
 * v0.4.0：农历 → 公历换算。
 *
 * - n=1：单次日程表单，返回单个换算结果（含 festival/clamped）；
 * - n>1：年度循环表单预览，返回从 lunar_year 起、不早于 anchor 的最多 n 个候选。
 */
export function resolveLunar(params: {
  lunarYear: number
  month: number
  day: number
  n?: number
  anchor?: string
}): Promise<LunarResolved[]> {
  return request<{ results: LunarResolved[] }>('/events/lunar/resolve', {
    query: {
      lunar_year: params.lunarYear,
      month: params.month,
      day: params.day,
      n: params.n,
      anchor: params.anchor,
    },
  }).then((data) => data.results)
}

/** 按日 / 日期范围查询（左闭右开），服务端自动展开循环实例 */
export function fetchEvents(query: EventQuery): Promise<CalendarEvent[]> {
  return request<CalendarEvent[]>('/events', { query: toQuery(query) })
}

export function fetchEvent(
  id: string | number,
  occurrenceKey?: string
): Promise<CalendarEvent | Occurrence> {
  return request<CalendarEvent | Occurrence>(`/events/${id}`, {
    query: { tz: localTimezone(), occurrence_key: occurrenceKey },
  })
}

/** v0.2.0：系列详情（规则 + 摘要 + 实例分页） */
export function fetchSeriesDetail(
  id: string | number,
  opts: { section?: 'upcoming' | 'past'; cursor?: string } = {}
): Promise<SeriesDetail> {
  return request<SeriesDetail>(`/events/series/${id}`, {
    query: {
      tz: localTimezone(),
      section: opts.section,
      cursor: opts.cursor,
    },
  })
}

export function searchEvents(keyword: string): Promise<CalendarEvent[]> {
  return request<CalendarEvent[]>('/events/search', { query: { keyword } })
}

/** 创建日程；命中冲突时会抛 code=4009 的 ApiError（details 含 conflicts / conflict_dates） */
export function createEvent(payload: EventPayload): Promise<CalendarEvent> {
  return request<CalendarEvent>('/events', {
    method: 'POST',
    body: payload,
    query: { tz: localTimezone() },
  })
}

/** 编辑日程：scope=this/following 时必须带 occurrence_key */
export function updateEvent(
  id: string | number,
  payload: Partial<EventPayload>
): Promise<CalendarEvent | Occurrence> {
  return request<CalendarEvent | Occurrence>(`/events/${id}`, {
    method: 'PATCH',
    body: payload,
    query: { tz: localTimezone() },
  })
}

/**
 * 删除日程：
 * - scope=series（默认）删除整条系列（循环系列不可恢复）；
 * - scope=this 仅取消本次，返回 occurrence_state=cancelled。
 */
export function deleteEvent(
  id: string | number,
  opts: { scope?: 'series' | 'this'; occurrenceKey?: string } = {}
): Promise<{ id: number; occurrence_state?: string; occurrence?: Occurrence }> {
  return request<{ id: number; occurrence_state?: string; occurrence?: Occurrence }>(`/events/${id}`, {
    method: 'DELETE',
    query: {
      tz: localTimezone(),
      scope: opts.scope,
      occurrence_key: opts.occurrenceKey,
    },
  })
}

/** v0.2.0：恢复某次「已取消」的实例 */
export function restoreOccurrence(
  id: string | number,
  occurrenceKey: string
): Promise<Occurrence | null> {
  return request<Occurrence | null>(`/events/${id}/restore-occurrence`, {
    method: 'POST',
    body: { occurrence_key: occurrenceKey },
    query: { tz: localTimezone() },
  })
}

export type { CalendarEvent }