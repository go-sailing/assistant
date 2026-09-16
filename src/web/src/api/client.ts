import type { ApiResponse } from '@/types'
import { clearToken, getToken } from '@/utils/token'

export const BASE_URL = '/api/v1'

/** 业务错误：携带 code / HTTP 状态码 / 结构化 details */
export class ApiError extends Error {
  code: number
  status: number
  /** 后端 details 字段：日程冲突（4009）等场景携带结构化数据 */
  details: unknown
  constructor(message: string, code: number, status: number, details: unknown = null) {
    super(message)
    this.name = 'ApiError'
    this.code = code
    this.status = status
    this.details = details
  }
}

/** 统一错误文案（后端 message 优先） */
export function errorText(err: unknown): string {
  if (err instanceof ApiError) return err.message
  if (err instanceof Error) {
    if (err.name === 'AbortError') return '请求已取消'
    return err.message || '网络异常，请稍后重试'
  }
  return '网络异常，请稍后重试'
}

/** 401 处理（由 main.ts 注入跳转逻辑，避免模块循环依赖） */
let unauthorizedHandler: (() => void) | null = null
export function setUnauthorizedHandler(fn: () => void): void {
  unauthorizedHandler = fn
}

export function authHeaders(): Record<string, string> {
  const token = getToken()
  return token ? { Authorization: `Bearer ${token}` } : {}
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE'
  body?: unknown
  query?: Record<string, string | number | undefined | null>
  signal?: AbortSignal
}

function buildUrl(path: string, query?: RequestOptions['query']): string {
  let url = `${BASE_URL}${path}`
  if (query) {
    const parts: string[] = []
    Object.keys(query).forEach((k) => {
      const v = query[k]
      if (v !== undefined && v !== null && v !== '') {
        parts.push(`${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
      }
    })
    if (parts.length) url += `?${parts.join('&')}`
  }
  return url
}

/**
 * 统一请求：解析 { code, message, data }，code!==0 抛 ApiError；
 * 401（HTTP 或 code=1002）清除凭证并触发跳登录。
 */
export async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, query, signal } = options
  let res: Response
  try {
    res = await fetch(buildUrl(path, query), {
      method,
      headers: {
        Accept: 'application/json',
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...authHeaders(),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal,
    })
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') throw e
    throw new ApiError('网络连接失败，请检查网络后重试', -1, 0)
  }

  if (res.status === 401) {
    handle401()
    throw new ApiError('登录已失效，请重新登录', 1002, 401)
  }

  let json: ApiResponse<T> | null = null
  try {
    json = (await res.json()) as ApiResponse<T>
  } catch {
    json = null
  }

  if (!json) {
    throw new ApiError('服务异常，请稍后重试', -1, res.status)
  }
  if (json.code === 1002) {
    handle401()
    throw new ApiError(json.message || '登录已失效，请重新登录', 1002, 401)
  }
  if (json.code !== 0) {
    throw new ApiError(json.message || '请求失败', json.code, res.status, json.details ?? null)
  }
  return json.data
}

function handle401(): void {
  clearToken()
  if (unauthorizedHandler) unauthorizedHandler()
}