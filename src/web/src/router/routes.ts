import type { RouteRecordRaw } from 'vue-router'

/**
 * v0.8.0：已下线能力的旧链标记（/tasks、/projects、/agents、/search、/lists 及任务日程旧表单）。
 * 命中这些记录的重定向时落 `legacy_route_redirect` 开发期日志，用于观测残余入口
 * （TC-DEL-068 / TC-AUDIT-080）；非本版下线的历史重定向（`/calendar/day`、`/chat/:id`）不标记。
 */
export const RETIRED_LEGACY = { retiredLegacy: true } as const

/** 路由表（独立成模块：不含浏览器 History 依赖，便于以 memory history 做重定向回归） */
export const routes: RouteRecordRaw[] = [
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
    // v0.6.0：日程主页头部 ＋ → 普通日程表单（v0.8.0 起为唯一表单）
    component: () => import('@/views/calendar/EventNormalFormView.vue'),
    meta: { requiresAuth: true },
  },
  // v0.8.0：任务日程已下线，旧链统一静默重定向到 /calendar（无中间态、无骨架、无 toast）
  { path: '/calendar/task/new', redirect: '/calendar', meta: RETIRED_LEGACY },
  { path: '/calendar/tasks', redirect: '/calendar', meta: RETIRED_LEGACY },
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
    // v0.8.0：编辑入口收敛为唯一普通表单（不再经过 EventEditDispatchView 分流，消除闪烁）
    path: '/calendar/:id/edit',
    name: 'event-edit',
    component: () => import('@/views/calendar/EventNormalFormView.vue'),
    meta: { requiresAuth: true },
  },
  {
    path: '/calendar/:id/edit/normal',
    name: 'event-edit-normal',
    component: () => import('@/views/calendar/EventNormalFormView.vue'),
    meta: { requiresAuth: true },
  },
  {
    // 旧链保留 id 与 query
    path: '/calendar/:id/edit/task',
    redirect: (to) => ({ path: `/calendar/${to.params.id}/edit`, query: to.query }),
    meta: RETIRED_LEGACY,
  },
  /* ----- v0.8.0：任务 / 项目 / 智能体 / 搜索 / 清单能力下线，旧链静默落 /calendar ----- */
  { path: '/tasks', redirect: '/calendar', meta: RETIRED_LEGACY },
  { path: '/tasks/new', redirect: '/calendar', meta: RETIRED_LEGACY },
  { path: '/tasks/:id', redirect: '/calendar', meta: RETIRED_LEGACY },
  { path: '/tasks/:id/edit', redirect: '/calendar', meta: RETIRED_LEGACY },
  { path: '/search', redirect: '/calendar', meta: RETIRED_LEGACY },
  { path: '/projects', redirect: '/calendar', meta: RETIRED_LEGACY },
  { path: '/projects/new', redirect: '/calendar', meta: RETIRED_LEGACY },
  { path: '/projects/:id', redirect: '/calendar', meta: RETIRED_LEGACY },
  { path: '/projects/:id/edit', redirect: '/calendar', meta: RETIRED_LEGACY },
  { path: '/agents', redirect: '/calendar', meta: RETIRED_LEGACY },
  { path: '/agents/new', redirect: '/calendar', meta: RETIRED_LEGACY },
  { path: '/agents/:id', redirect: '/calendar', meta: RETIRED_LEGACY },
  { path: '/agents/:id/edit', redirect: '/calendar', meta: RETIRED_LEGACY },
  { path: '/lists', redirect: '/calendar', meta: RETIRED_LEGACY },
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
