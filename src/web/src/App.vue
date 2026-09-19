<script setup lang="ts">
import { onBeforeUnmount, onMounted, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import AppDrawer from '@/components/AppDrawer.vue'
import AppToast from '@/components/AppToast.vue'
import { useAuthStore } from '@/stores/auth'
import { useDrawerStore } from '@/stores/drawer'
import { useSettingsStore } from '@/stores/settings'

/**
 * 应用外壳（v0.6.0）：
 * - 抽屉仅由各页左上角菜单按钮打开（右滑手势已取消，UI-03）；
 * - 右下角助手 FAB 已下线，助手入口仅保留左侧抽屉（UI-04）。
 */
const route = useRoute()
const router = useRouter()
const drawer = useDrawerStore()
const auth = useAuthStore()
const settings = useSettingsStore()

/**
 * v0.4.0 偏好 bootstrap（PRD 10.3）：登录后拉一次用户设置；
 * 退出登录时清空，避免下一个账号继承上一个账号的偏好（含 401 被动退出）。
 */
watch(
  () => auth.isLoggedIn,
  (logged) => {
    if (logged) void settings.load()
    else settings.reset()
  },
  { immediate: true }
)

/* ---------------- 抽屉后退关闭 ---------------- */

/** 抽屉打开时压入的透明历史态，用于「后退优先关抽屉」 */
let pushedForDrawer = false

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
  <div class="app-shell">
    <!-- v0.3.0 宽屏中栏：页面内容限宽居中，抽屉/Toast 仍相对视口定位 -->
    <div class="app-column">
      <router-view v-slot="{ Component }">
        <component :is="Component" :key="route.fullPath" />
      </router-view>
    </div>
    <AppDrawer @close="closeDrawer" @navigate="navigateFromDrawer" />
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
/* 内容中栏：手机宽度下即全宽（与 v0.2.0 像素一致），宽视口居中限宽 */
.app-column {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  width: 100%;
  max-width: var(--content-max-width);
  margin: 0 auto;
  background: var(--bg-page);
}
</style>
