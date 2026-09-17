const TOKEN_KEY = 'pa_token'

/** 仅保存会话凭证；业务数据一律不落本地存储 */
export function getToken(): string {
  try {
    return localStorage.getItem(TOKEN_KEY) || ''
  } catch {
    return ''
  }
}

export function setToken(token: string): void {
  try {
    localStorage.setItem(TOKEN_KEY, token)
  } catch {
    /* 隐私模式下写入失败可忽略，本次会话使用内存 token */
  }
}

export function clearToken(): void {
  try {
    localStorage.removeItem(TOKEN_KEY)
  } catch {
    /* ignore */
  }
}

/**
 * 从 JWT 载荷中取出登录邮箱（仅用于展示，不做任何鉴权判断）。
 * 刷新页面后应用只剩凭证，用户信息（无 /auth/me 接口）由这里恢复，
 * 避免"当前账号"占位长期出现；解析失败返回空串。
 */
export function emailFromToken(token: string): string {
  const payload = token.split('.')[1]
  if (!payload) return ''
  try {
    // JWT 使用 base64url 编码且可能省略 padding
    const normalized = payload.replace(/-/g, '+').replace(/_/g, '/')
    const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4)
    const bytes = Uint8Array.from(atob(padded), (c) => c.charCodeAt(0))
    const json = JSON.parse(new TextDecoder().decode(bytes)) as { email?: unknown }
    return typeof json.email === 'string' ? json.email : ''
  } catch {
    return ''
  }
}