import { BASE_URL, authHeaders, request } from './client'
import { localTimezone } from './events'
import type { ArchiveResult, Conversation, Paged, RawMessage } from '@/types'

/**
 * v0.3.0：每用户唯一会话的幂等获取（存在即返回，不存在则创建）。
 * 不再有新建/重命名/删除会话的接口。
 */
export function createConversation(): Promise<Conversation> {
  return request<Conversation>('/conversations', { method: 'POST' })
}

/** v0.3.0：清除聊天记录（会话保留，删除全部消息与待确认动作） */
export function clearConversation(
  id: string | number
): Promise<{ id: number; deleted_messages: number }> {
  return request<{ id: number; deleted_messages: number }>(`/conversations/${id}/clear`, {
    method: 'POST',
  })
}

/**
 * v0.5.0：归档聊天记录（MEM-01）。
 * 非 SSE 的请求-响应模式；force_clear=true 表示「没提炼到内容但仍要清空」的二次确认。
 * 任何失败都不清空消息，错误文案直接透传服务端（SDD 7.2）。
 */
export function archiveConversation(
  id: string | number,
  forceClear = false
): Promise<ArchiveResult> {
  return request<ArchiveResult>(`/conversations/${id}/archive`, {
    method: 'POST',
    body: { force_clear: forceClear },
  })
}

export function fetchMessages(
  id: string | number,
  page = 1,
  pageSize = 50
): Promise<Paged<RawMessage>> {
  return request<Paged<RawMessage>>(`/conversations/${id}/messages`, {
    query: { page, page_size: pageSize },
  })
}

export function confirmPendingAction(
  convId: string | number,
  paId: string
): Promise<{ message: RawMessage }> {
  return request<{ message: RawMessage }>(
    `/conversations/${convId}/pending-actions/${paId}/confirm`,
    { method: 'POST' }
  )
}

export function cancelPendingAction(
  convId: string | number,
  paId: string
): Promise<{ message: RawMessage }> {
  return request<{ message: RawMessage }>(
    `/conversations/${convId}/pending-actions/${paId}/cancel`,
    { method: 'POST' }
  )
}

/* ---------------- SSE 流式对话 ---------------- */

export interface SseHandlers {
  onEvent: (event: string, data: Record<string, unknown>) => void
}

/**
 * 发送消息并消费 SSE 流。
 * 使用 fetch + ReadableStream（EventSource 不支持 POST 与自定义鉴权头）。
 * 按 \n\n 分帧，解析 event: / data: 行。
 */
export async function streamChat(
  convId: string | number,
  content: string,
  clientMsgId: string,
  onEvent: SseHandlers['onEvent'],
  signal?: AbortSignal
): Promise<void> {
  const res = await fetch(`${BASE_URL}/conversations/${convId}/chat`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
      ...authHeaders(),
    },
    // timezone_offset 让服务端按用户本地时区解析「明天」「下周五」等相对时间
    // 约定：东八区为 480（即 getTimezoneOffset 取反）
    // timezone（IANA）供日程工具按自然日筛选
    body: JSON.stringify({
      content,
      client_msg_id: clientMsgId,
      timezone_offset: -new Date().getTimezoneOffset(),
      timezone: localTimezone(),
    }),
    signal,
  })

  if (!res.ok || !res.body) {
    let message = '助手暂时不可用，请稍后重试'
    let retryable = true
    try {
      const j = await res.json()
      if (j && typeof j.message === 'string' && j.message) message = j.message
      if (j && j.code === 3001) retryable = true
    } catch {
      /* 响应非 JSON，使用默认文案 */
    }
    onEvent('error', { code: res.status, message, retryable })
    onEvent('done', { finish_reason: 'error' })
    return
  }

  const reader = res.body.getReader()
  const decoder = new TextDecoder('utf-8')
  let buffer = ''

  const dispatch = (frame: string) => {
    const lines = frame.split('\n')
    let event = 'message'
    const dataLines: string[] = []
    for (const line of lines) {
      if (line.startsWith('event:')) event = line.slice(6).trim()
      else if (line.startsWith('data:')) dataLines.push(line.slice(5).trimStart())
      // 忽略注释行（: heartbeat）与 id/retry
    }
    if (!dataLines.length) return
    const raw = dataLines.join('\n')
    let data: Record<string, unknown> = {}
    try {
      const parsed = JSON.parse(raw)
      if (parsed && typeof parsed === 'object') data = parsed as Record<string, unknown>
      else data = { value: parsed }
    } catch {
      data = { raw }
    }
    onEvent(event, data)
  }

  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      buffer = buffer.replace(/\r\n/g, '\n')
      let idx = buffer.indexOf('\n\n')
      while (idx >= 0) {
        const frame = buffer.slice(0, idx)
        buffer = buffer.slice(idx + 2)
        if (frame.trim()) dispatch(frame)
        idx = buffer.indexOf('\n\n')
      }
    }
    if (buffer.trim()) dispatch(buffer)
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') throw e
    onEvent('error', { code: -1, message: '连接中断，请重试', retryable: true })
    onEvent('done', { finish_reason: 'error' })
  }
}