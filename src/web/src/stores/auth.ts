import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import * as authApi from '@/api/auth'
import { setTokensUpdatedHandler } from '@/api/client'
import type { AuthResult, User } from '@/types'
import {
  clearTokens,
  emailFromToken,
  getAccessToken,
  getRefreshToken,
  setTokens,
} from '@/utils/token'

/**
 * 登录态：仅凭证持久化，用户信息优先取内存（v0.4.0 起可由 /me 恢复昵称）。
 *
 * v0.4.0 变化：
 * - 同时持有 access + refresh 两个凭证，过期由 api/client 静默续期；
 * - 改密/刷新拿到新凭证对时，通过 tokensUpdatedHandler 同步内存 token，避免状态漂移。
 */
export const useAuthStore = defineStore('auth', () => {
  const token = ref<string>(getAccessToken())
  const user = ref<User | null>(null)
  const isLoggedIn = computed(() => !!token.value)
  /**
   * 展示用邮箱。刷新页面后只剩凭证（user 为空），
   * 从 JWT 载荷恢复邮箱，避免抽屉账号区长期显示「当前账号」占位。
   */
  const email = computed(() => user.value?.email ?? emailFromToken(token.value))

  /** v0.4.0：昵称（无昵称时为空，界面回落展示邮箱） */
  const nickname = computed(() => user.value?.nickname ?? null)

  /** 头像文字：昵称首字优先，否则邮箱首字母大写 */
  const avatarInitial = computed(() => {
    const name = (nickname.value ?? '').trim()
    if (name) return name.slice(0, 1).toUpperCase()
    return (email.value.slice(0, 1) || '?').toUpperCase()
  })

  /** v0.4.0：默认启动页（由设置页维护，登录成功后落地用） */
  const homeRoute = ref<'/calendar' | '/tasks'>('/calendar')

  function apply(result: AuthResult): void {
    token.value = result.token
    user.value = result.user
    setTokens(result.token, result.refresh_token)
  }

  /** 静默续期/改密后同步内存 access（凭证由 client 写入本地） */
  function syncTokens(): void {
    token.value = getAccessToken()
  }

  // 让 api/client 在刷新/改密成功后同步内存态
  setTokensUpdatedHandler(syncTokens)

  async function login(emailInput: string, password: string): Promise<void> {
    apply(await authApi.login(emailInput, password))
  }

  async function register(emailInput: string, password: string): Promise<void> {
    apply(await authApi.register(emailInput, password))
  }

  /** v0.4.0（P1）：修改密码（后端返回当前设备的新凭证对，本端不掉线） */
  async function changePassword(oldPassword: string, newPassword: string): Promise<void> {
    apply(await authApi.changePassword(oldPassword, newPassword))
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

  /** 更新内存中的昵称（个人信息页保存后调用，免去再次请求 /me） */
  function setNickname(value: string | null): void {
    if (user.value) user.value = { ...user.value, nickname: value }
    else if (value) user.value = { id: 0, email: email.value, nickname: value }
  }

  function setHomeRoute(route: '/calendar' | '/tasks'): void {
    homeRoute.value = route
  }

  /** 是否有可用会话（含仅剩 refresh 的场景，交给守卫静默恢复） */
  function hasCredentials(): boolean {
    return !!getAccessToken() || !!getRefreshToken()
  }

  /** 清空本地会话凭证（401 或主动退出） */
  function reset(): void {
    token.value = ''
    user.value = null
    clearTokens()
  }

  return {
    token,
    user,
    email,
    nickname,
    avatarInitial,
    homeRoute,
    isLoggedIn,
    login,
    register,
    changePassword,
    logout,
    destroyAccount,
    setNickname,
    setHomeRoute,
    hasCredentials,
    syncTokens,
    reset,
  }
})