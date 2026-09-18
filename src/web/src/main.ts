import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import router from './router'
import { setUnauthorizedHandler } from './api/client'
import './styles/global.css'

const app = createApp(App)
app.use(createPinia())
app.use(router)

/**
 * 401：凭证已由 client 清除，这里跳登录页。
 *
 * v0.4.0：带上 redirect，登录后回到被打断的原页面（含深链），
 * 不再"一律回到日程页"；标记 session_expired 供登录页展示"登录已过期"提示。
 */
setUnauthorizedHandler(() => {
  const current = router.currentRoute.value
  if (current.path !== '/login') {
    // 首页加载途中（路由尚未解析完成）currentRoute 可能是 START_LOCATION('/')，
    // 此时用浏览器地址兜底，保证深链（如 /tasks/12）登录后能回跳原目标页
    const fallback = `${window.location.pathname}${window.location.search}`
    const target =
      current.path && current.path !== '/' ? current.fullPath : fallback || '/calendar'
    router.replace({
      path: '/login',
      query: { redirect: target, session_expired: '1' },
    })
  }
})

app.mount('#app')