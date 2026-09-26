import type { Router } from 'vue-router'
import { logLegacyRouteRedirect } from '@/utils/telemetry'

/**
 * v0.8.0（D-09 / TC-DEL-068 / TC-AUDIT-080）：已下线能力旧链重定向命中观测。
 *
 * 端上口径：不新增上报通道，只在开发期落一条 `console.info`（一次访问一条），
 * 只记命中的旧路径与最终落点，不含任何业务正文。
 * 独立成模块（不含浏览器 History 依赖），便于以 memory history 做重定向回归。
 */
export function observeLegacyRedirects(router: Router): void {
  router.afterEach((to) => {
    logLegacyRouteRedirect(to.redirectedFrom, to)
  })
}
