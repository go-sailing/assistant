import { ref } from 'vue'
import { defineStore } from 'pinia'

/**
 * 一次性代理凭据（v0.7.0，UXUI 7.2）。
 *
 * 明文凭据仅在「创建成功 → 详情页」「重置成功 → 详情页」两次会话内可见：
 * 创建/重置成功后由页面写入本 store，代理详情页读取一次后立即清除；
 * **禁止**写入 URL / sessionStorage / localStorage，刷新或重新进入即不再展示。
 */
export const useAgentTokenStore = defineStore('agentToken', () => {
  const tokens = ref<Record<string, string>>({})

  function setOneTimeToken(agentId: number, token: string): void {
    tokens.value[String(agentId)] = token
  }

  /** 读取即清除：同一凭据不会出现第二次 */
  function takeOneTimeToken(agentId: number): string | null {
    const key = String(agentId)
    const token = tokens.value[key] ?? null
    if (token !== null) delete tokens.value[key]
    return token
  }

  function clear(): void {
    tokens.value = {}
  }

  return { setOneTimeToken, takeOneTimeToken, clear }
})
