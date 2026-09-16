import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import * as authApi from '@/api/auth'
import type { AuthResult, User } from '@/types'
import { clearToken, getToken, setToken } from '@/utils/token'

/** 登录态：仅凭证持久化，用户信息存内存（无 /auth/me 查询接口） */
export const useAuthStore = defineStore('auth', () => {
  const token = ref<string>(getToken())
  const user = ref<User | null>(null)
  const isLoggedIn = computed(() => !!token.value)

  function apply(result: AuthResult): void {
    token.value = result.token
    user.value = result.user
    setToken(result.token)
  }

  async function login(email: string, password: string): Promise<void> {
    apply(await authApi.login(email, password))
  }

  async function register(email: string, password: string): Promise<void> {
    apply(await authApi.register(email, password))
  }

  async function logout(): Promise<void> {
    try {
      if (token.value) await authApi.logout()
    } catch {
      // 注销接口失败也清本地凭证，避免卡在登录态
    }
    reset()
  }

  async function destroyAccount(): Promise<void> {
    await authApi.deleteAccount()
    reset()
  }

  /** 清空本地会话凭证（401 或主动退出） */
  function reset(): void {
    token.value = ''
    user.value = null
    clearToken()
  }

  return { token, user, isLoggedIn, login, register, logout, destroyAccount, reset }
})