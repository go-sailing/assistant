<script setup lang="ts">
import { computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import AppIcon from './AppIcon.vue'
import { useDrawerStore } from '@/stores/drawer'

const props = withDefaults(
  defineProps<{
    title?: string
    backText?: string
    showBack?: boolean
    /** 返回兜底路由（无历史记录时使用） */
    fallback?: string
  }>(),
  { title: '', backText: '', showBack: true, fallback: '/calendar' }
)

const router = useRouter()
const route = useRoute()
const drawer = useDrawerStore()

/** v0.2.0：一级页（日程/助手）左侧渲染汉堡菜单，底部 Tab 已下线 */
/** v0.3.0：会话列表页下线，助手改为一页（route name = chat） */
/** v0.6.0：个人信息页与系统设置页由抽屉进入，左上角同样改为菜单按钮 */
/** v0.9.0：任务/项目/智能体页已下线，一级入口只剩日历与助手 */
const MENU_ROUTE_NAMES = new Set(['calendar-month', 'chat', 'me', 'settings'])
const showMenu = computed(() => MENU_ROUTE_NAMES.has(String(route.name ?? '')))
/** 菜单态不并列渲染返回箭头，避免出现两个左操作 */
const renderBack = computed(() => props.showBack && !showMenu.value)

function goBack(): void {
  if (window.history.state && window.history.state.back) {
    router.back()
  } else {
    router.replace(props.fallback)
  }
}
</script>

<template>
  <header class="navbar">
    <div class="navbar__left">
      <button
        v-if="showMenu"
        class="navbar__menu pressable"
        aria-label="打开菜单"
        @click="drawer.openDrawer('hamburger')"
      >
        <AppIcon name="list" :size="22" />
      </button>
      <button v-if="renderBack" class="navbar__back pressable" aria-label="返回" @click="goBack">
        <span class="navbar__arrow" aria-hidden="true">‹</span>
        <span v-if="backText" class="navbar__back-text">{{ backText }}</span>
      </button>
      <slot name="left" />
    </div>
    <h1 class="navbar__title ellipsis">{{ title }}</h1>
    <div class="navbar__right">
      <slot name="right" />
    </div>
  </header>
</template>

<style scoped>
.navbar {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  height: calc(var(--navbar-height) + var(--safe-top));
  padding: var(--safe-top) var(--sp-4) 0;
  background: var(--bg-card);
  border-bottom: 1px solid var(--border-color);
  flex-shrink: 0;
}
.navbar__left,
.navbar__right {
  display: flex;
  align-items: center;
  gap: var(--sp-3);
  min-width: 44px;
}
.navbar__right {
  justify-content: flex-end;
}
.navbar__title {
  flex: 1;
  font-size: var(--font-heading-m);
  line-height: var(--font-heading-m-lh);
  font-weight: 600;
  text-align: center;
}
.navbar__menu {
  display: flex;
  align-items: center;
  justify-content: center;
  min-width: 44px;
  min-height: 44px;
  margin-left: -12px;
  color: var(--text-primary);
}
.navbar__back {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 2px;
  min-width: 44px;
  min-height: 44px;
  margin-left: -12px;
  color: var(--color-primary);
}
.navbar__arrow {
  font-size: 26px;
  line-height: 1;
}
.navbar__back-text {
  font-size: var(--font-body-m);
  white-space: nowrap;
}
</style>
