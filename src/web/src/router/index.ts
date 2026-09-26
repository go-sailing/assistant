import { createRouter, createWebHistory } from 'vue-router'
import { refreshTokens } from '@/api/client'
import { hasSession } from '@/utils/token'
import { routes } from './routes'
import { observeLegacyRedirects } from './legacyRedirect'

const router = createRouter({
  history: createWebHistory(),
  routes,
  scrollBehavior: () => ({ top: 0 }),
})

/**
 * 登录守卫：除引导/登录/注册外全部要求登录。
 *
 * v0.4.0：access 过期但 refresh 仍有效时**先静默续期再放行**，
 * 避免"页面回收后返回被踢回登录页"；续期失败才跳登录。
 * 深链（含 /me、/settings 等）登录后按 redirect 回跳原目标页。
 */
router.beforeEach(async (to) => {
  const logged = hasSession()
  if (to.meta.requiresAuth && !logged) {
    const restored = await refreshTokens()
    if (!restored) {
      return {
        path: '/login',
        query: to.fullPath !== '/calendar' ? { redirect: to.fullPath } : undefined,
      }
    }
  }
  if (to.meta.public && (hasSession() || logged)) {
    return { path: '/calendar' }
  }
  return true
})

// v0.8.0：旧链重定向命中观测（端上开发期日志，见 router/legacyRedirect.ts）
observeLegacyRedirects(router)

export default router
