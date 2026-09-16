import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import router from './router'
import { setUnauthorizedHandler } from './api/client'
import './styles/global.css'

const app = createApp(App)
app.use(createPinia())
app.use(router)

// 401：清除凭证并跳转登录页
setUnauthorizedHandler(() => {
  if (router.currentRoute.value.path !== '/login') {
    router.replace({ path: '/login' })
  }
})

app.mount('#app')