import { createRouter, createWebHistory } from 'vue-router'
import type { RouteRecordRaw } from 'vue-router'
import { getToken } from '@/utils/token'

const routes: RouteRecordRaw[] = [
  { path: '/', redirect: '/tasks' },
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
  { path: '/:pathMatch(.*)*', redirect: '/tasks' },
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
    return { path: '/login', query: to.fullPath !== '/tasks' ? { redirect: to.fullPath } : undefined }
  }
  if (to.meta.public && logged) {
    return { path: '/tasks' }
  }
  return true
})

export default router