import { createRouter, createWebHistory } from 'vue-router'
import type { RouteRecordRaw } from 'vue-router'
import { getToken } from '@/utils/token'

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
    meta: { requiresAuth: true, tab: 'calendar' },
  },
  {
    path: '/calendar/day',
    name: 'calendar-day',
    component: () => import('@/views/calendar/DayView.vue'),
    meta: { requiresAuth: true },
  },
  {
    path: '/calendar/new',
    name: 'event-create',
    component: () => import('@/views/calendar/EventFormView.vue'),
    meta: { requiresAuth: true },
  },
  {
    path: '/calendar/tasks',
    name: 'event-task-picker',
    component: () => import('@/views/calendar/TaskPickerView.vue'),
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
    component: () => import('@/views/calendar/EventFormView.vue'),
    meta: { requiresAuth: true },
  },
  {
    path: '/tasks',
    name: 'task-home',
    component: () => import('@/views/tasks/TaskHomeView.vue'),
    meta: { requiresAuth: true, tab: 'tasks' },
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
    name: 'conversation-list',
    component: () => import('@/views/chat/ConversationListView.vue'),
    meta: { requiresAuth: true, tab: 'chat' },
  },
  {
    path: '/chat/:id',
    name: 'chat',
    component: () => import('@/views/chat/ChatView.vue'),
    meta: { requiresAuth: true },
  },
  { path: '/:pathMatch(.*)*', redirect: '/calendar' },
]

const router = createRouter({
  history: createWebHistory(),
  routes,
  scrollBehavior: () => ({ top: 0 }),
})

// 登录守卫：除引导/登录/注册外全部要求登录
router.beforeEach((to) => {
  const logged = !!getToken()
  if (to.meta.requiresAuth && !logged) {
    return {
      path: '/login',
      query: to.fullPath !== '/calendar' ? { redirect: to.fullPath } : undefined,
    }
  }
  if (to.meta.public && logged) {
    return { path: '/calendar' }
  }
  return true
})

export default router