const ACCESS_KEY = 'pa_token'
const REFRESH_KEY = 'pa_refresh'

/** 仅保存会话凭证；业务数据一律不落本地存储 */
export function getAccessToken(): string {
  try {
    return localStorage.getItem(ACCESS_KEY) || ''
  } catch {
    return ''
  }
}

export function getRefreshToken(): string {
  try {
    return localStorage.getItem(REFRESH_KEY) || ''
  } catch {
    return ''
  }
}

/** v0.4.0：同时保存 access + refresh（refresh 允许缺省，兼容旧调用） */
export function setTokens(access: string, refresh?: string): void {
  try {
    if (access) localStorage.setItem(ACCESS_KEY, access)
    if (refresh) localStorage.setItem(REFRESH_KEY, refresh)
  } catch {
    /* 隐私模式下写入失败可忽略，本次会话使用内存 token */
  }
}

export function clearTokens(): void {
  try {
    localStorage.removeItem(ACCESS_KEY)
    localStorage.removeItem(REFRESH_KEY)
  } catch {
    /* ignore */
  }
}

/** 解析 JWT 载荷（不校验签名，仅用于展示与过期预判） */
function decodePayload(token: string): { exp?: number; email?: string } | null {
  const payload = token.split('.')[1]
  if (!payload) return null
  try {
    // JWT 使用 base64url 编码且可能省略 padding
    const normalized = payload.replace(/-/g, '+').replace(/_/g, '/')
    const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4)
    const bytes = Uint8Array.from(atob(padded), (c) => c.charCodeAt(0))
    return JSON.parse(new TextDecoder().decode(bytes)) as { exp?: number; email?: string }
  } catch {
    return null
  }
}

/**
 * v0.4.0：access 是否即将过期（默认剩余 <10 分钟）。
 * 用于请求前静默续期，避免用户操作到一半被 401 打断。
 */
export function accessExpiringSoon(skewSeconds = 600): boolean {
  const token = getAccessToken()
  if (!token) return false
  const payload = decodePayload(token)
  if (!payload?.exp) return false
  return payload.exp * 1000 - Date.now() <= skewSeconds * 1000
}

/** 是否已持有 access（路由守卫用） */
export function hasSession(): boolean {
  return !!getAccessToken()
}

/**
 * 从 JWT 载荷中取出登录邮箱（仅用于展示，不做任何鉴权判断）。
 * 刷新页面后应用只剩凭证，用户信息由这里恢复，避免"当前账号"占位长期出现；
 * 解析失败返回空串。
 */
export function emailFromToken(token: string): string {
  const payload = decodePayload(token)
  return typeof payload?.email === 'string' ? payload.email : ''
}