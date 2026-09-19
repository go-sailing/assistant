import { createRouter, createWebHistory } from 'vue-router'
import type { RouteRecordRaw } from 'vue-router'
import { refreshTokens } from '@/api/client'
import { hasSession } from '@/utils/token'

const routes: RouteRecordRaw[] = [
  { path: '/', redirect: '/calendar' },
  {
    path: '/onboarding',
    name: 'onboarding',
    component: () => import('@/views/auth/OnboardingView.vue'),
    meta: { public: true },
  },
  {
    path: '/login',
    name: 'login',
    component: () => import('@/views/auth/LoginView.vue'),
    meta: { public: true },
  },
  {
    path: '/register',
    name: 'register',
    component: () => import('@/views/auth/RegisterView.vue'),
    meta: { public: true },
  },
  {
    path: '/calendar',
    name: 'calendar-month',
    component: () => import('@/views/calendar/MonthView.vue'),
    meta: { requiresAuth: true },
  },
  {
    path: '/calendar/day',
    name: 'calendar-day-legacy',
    // v0.3.0：当日列表页已下线，旧链重定向到主页并透传 date，由主页恢复选中日
    redirect: (to) =>
      typeof to.query.date === 'string' && to.query.date
        ? { path: '/calendar', query: { date: to.query.date } }
        : { path: '/calendar' },
  },
  {
    path: '/calendar/new',
    name: 'event-create',
    // v0.6.0：日程主页头部 ＋ → 普通日程表单（与任务日程拆分为两页）
    component: () => import('@/views/calendar/EventNormalFormView.vue'),
    meta: { requiresAuth: true },
  },
  {
    path: '/calendar/task/new',
    name: 'event-task-create',
    // v0.6.0：任务「安排日程」→ 任务日程表单（关联任务带入锁定）
    component: () => import('@/views/calendar/EventTaskFormView.vue'),
    meta: { requiresAuth: true },
  },
  {
    // v0.6.0：任务选择页已下线（任务日程由当前任务直接带入）
    path: '/calendar/tasks',
    redirect: '/tasks',
  },
  // v0.2.0：循环系列详情（须在 /calendar/:id 之前注册）
  {
    path: '/calendar/series/:id',
    name: 'event-series',
    component: () => import('@/views/calendar/SeriesDetailView.vue'),
    meta: { requiresAuth: true },
  },
  {
    path: '/calendar/:id',
    name: 'event-detail',
    component: () => import('@/views/calendar/EventDetailView.vue'),
    meta: { requiresAuth: true },
  },
  {
    path: '/calendar/:id/edit',
    name: 'event-edit',
    // v0.6.0：统一编辑入口，进入后按日程类型分流到两个独立表单
    component: () => import('@/views/calendar/EventEditDispatchView.vue'),
    meta: { requiresAuth: true },
  },
  {
    path: '/calendar/:id/edit/normal',
    name: 'event-edit-normal',
    component: () => import('@/views/calendar/EventNormalFormView.vue'),
    meta: { requiresAuth: true },
  },
  {
    path: '/calendar/:id/edit/task',
    name: 'event-edit-task',
    component: () => import('@/views/calendar/EventTaskFormView.vue'),
    meta: { requiresAuth: true },
  },
  {
    path: '/tasks',
    name: 'task-home',
    component: () => import('@/views/tasks/TaskHomeView.vue'),
    meta: { requiresAuth: true },
  },
  {
    path: '/tasks/new',
    name: 'task-create',
    component: () => import('@/views/tasks/TaskFormView.vue'),
    meta: { requiresAuth: true },
  },
  {
    path: '/tasks/:id',
    name: 'task-detail',
    component: () => import('@/views/tasks/TaskDetailView.vue'),
    meta: { requiresAuth: true },
  },
  {
    path: '/tasks/:id/edit',
    name: 'task-edit',
    component: () => import('@/views/tasks/TaskFormView.vue'),
    meta: { requiresAuth: true },
  },
  {
    path: '/search',
    name: 'search',
    component: () => import('@/views/tasks/SearchView.vue'),
    meta: { requiresAuth: true },
  },
  {
    path: '/lists',
    name: 'list-manage',
    component: () => import('@/views/tasks/ListManageView.vue'),
    meta: { requiresAuth: true },
  },
  {
    path: '/chat',
    name: 'chat',
    // v0.3.0：/chat 直接渲染唯一对话页（会话列表页下线）
    component: () => import('@/views/chat/ChatView.vue'),
    meta: { requiresAuth: true },
  },
  {
    // v0.3.0：旧链 /chat/:id 重定向到 /chat
    path: '/chat/:id',
    redirect: '/chat',
  },
  /* ----- v0.4.0：个人信息与设置 ----- */
  {
    path: '/me',
    name: 'me',
    component: () => import('@/views/me/MeView.vue'),
    meta: { requiresAuth: true },
  },
  {
    path: '/me/password',
    name: 'me-password',
    component: () => import('@/views/me/ChangePasswordView.vue'),
    meta: { requiresAuth: true },
  },
  /* v0.5.0：长期记忆管理页（设置页「长期记忆」行与归档 toast 直达） */
  {
    path: '/me/memories',
    name: 'me-memories',
    component: () => import('@/views/me/MemoriesView.vue'),
    meta: { requiresAuth: true },
  },
  {
    path: '/settings',
    name: 'settings',
    component: () => import('@/views/me/SettingsView.vue'),
    meta: { requiresAuth: true },
  },
  { path: '/:pathMatch(.*)*', redirect: '/calendar' },
]

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
 * 深链（含 /tasks/:id、/settings 等）登录后按 redirect 回跳原目标页。
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

export default router