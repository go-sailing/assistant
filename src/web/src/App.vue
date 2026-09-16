<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import AppDrawer from '@/components/AppDrawer.vue'
import AppFAB from '@/components/AppFAB.vue'
import AppToast from '@/components/AppToast.vue'
import { createConversation } from '@/api/conversations'
import { useAuthStore } from '@/stores/auth'
import { useDrawerStore } from '@/stores/drawer'
import { useToastStore } from '@/stores/toast'
import { errorText } from '@/api/client'

const route = useRoute()
const router = useRouter()
const drawer = useDrawerStore()
const auth = useAuthStore()
const toast = useToastStore()

/** 抽屉仅在登录后的一级页面可用（登录/注册/引导页禁用） */
const drawerEnabled = computed(() => route.meta.requiresAuth === true)

/**
 * FAB 形态（系统设计文档 3.2）：
 * /calendar、/tasks 等 → open-chat；/chat 会话列表 → new-conversation；/chat/:id → hidden。
 */
const fabMode = computed<'open-chat' | 'new-conversation' | 'hidden'>(() => {
  const path = route.path
  if (path.startsWith('/chat/')) return 'hidden'
  if (path === '/chat') return 'new-conversation'
  if (path.startsWith('/calendar') || path.startsWith('/tasks')) return 'open-chat'
  return 'hidden'
})

async function onFabClick(): Promise<void> {
  if (fabMode.value === 'open-chat') {
    router.push('/chat')
    return
  }
  if (fabMode.value === 'new-conversation') {
    try {
      const conversation = await createConversation()
      router.push(`/chat/${conversation.id}`)
    } catch (err) {
      toast.show(errorText(err))
    }
  }
}

/* ---------------- 抽屉手势与后退关闭 ---------------- */

/** 左缘 20pt 内起手不拦截（让给系统/微信返回手势） */
const EDGE_AVOID_PX = 20
const OPEN_THRESHOLD_PX = 24
const MAX_VERTICAL_PX = 24

let startX = 0
let startY = 0
let tracking = false
/** 抽屉打开时压入的透明历史态，用于「后退优先关抽屉」 */
let pushedForDrawer = false

/** 对话页全域禁用手势（避免与消息区横向操作冲突） */
function gestureAllowed(): boolean {
  return drawerEnabled.value && !route.path.startsWith('/chat')
}

function onTouchStart(event: TouchEvent): void {
  if (!gestureAllowed() || drawer.open) return
  const touch = event.touches[0]
  if (!touch) return
  // 左缘 20pt 让给系统返回手势
  if (touch.clientX <= EDGE_AVOID_PX) {
    tracking = false
    return
  }
  startX = touch.clientX
  startY = touch.clientY
  tracking = true
}

function onTouchEnd(event: TouchEvent): void {
  if (!tracking) return
  tracking = false
  const touch = event.changedTouches[0]
  if (!touch) return
  const dx = touch.clientX - startX
  const dy = Math.abs(touch.clientY - startY)
  if (dx > OPEN_THRESHOLD_PX && dy < MAX_VERTICAL_PX) {
    drawer.openDrawer('gesture')
  }
}

function onPopState(): void {
  // 抽屉打开时优先关抽屉，而不是退出页面
  if (drawer.open) {
    pushedForDrawer = false
    drawer.closeDrawer()
  }
}

/** 遮罩 / ESC 关闭：通过后退回收压入的历史态，保持历史栈干净 */
function closeDrawer(): void {
  if (pushedForDrawer) {
    window.history.back()
    return
  }
  drawer.closeDrawer()
}

/** 菜单项跳转：用目标页替换抽屉占位的历史项，避免多出一条返回记录 */
function navigateFromDrawer(to: string): void {
  const wasPushed = pushedForDrawer
  pushedForDrawer = false
  drawer.closeDrawer()
  if (route.path === to) return
  if (wasPushed) router.replace(to)
  else router.push(to)
}

async function logoutFromDrawer(): Promise<void> {
  pushedForDrawer = false
  drawer.closeDrawer()
  await auth.logout()
  router.replace('/login')
}

watch(
  () => drawer.open,
  (open) => {
    if (!open || pushedForDrawer) return
    pushedForDrawer = true
    window.history.pushState({ ...(window.history.state ?? {}), drawer: true }, '')
  }
)

onMounted(() => {
  window.addEventListener('popstate', onPopState)
})

onBeforeUnmount(() => {
  window.removeEventListener('popstate', onPopState)
})
</script>

<template>
  <div class="app-shell" @touchstart.passive="onTouchStart" @touchend.passive="onTouchEnd">
    <router-view v-slot="{ Component }">
      <component :is="Component" :key="route.fullPath" />
    </router-view>
    <AppFAB v-if="drawerEnabled" :mode="fabMode" @click="onFabClick" />
    <AppDrawer @close="closeDrawer" @navigate="navigateFromDrawer" @logout="logoutFromDrawer" />
    <AppToast />
  </div>
</template>

<style scoped>
.app-shell {
  position: relative;
  height: 100%;
  /* 纵向 flex：页面占满整屏（底部 Tab 已下线，底部留白由各页自行保证） */
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
</style>
