<script setup lang="ts">
import { useRouter } from 'vue-router'
import AppIcon from './AppIcon.vue'

const props = withDefaults(
  defineProps<{
    title?: string
    backText?: string
    showBack?: boolean
    /** 返回兜底路由（无历史记录时使用） */
    fallback?: string
  }>(),
  { title: '', backText: '', showBack: true, fallback: '/tasks' }
)

const router = useRouter()

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
      <button v-if="showBack" class="navbar__back pressable" aria-label="返回" @click="goBack">
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