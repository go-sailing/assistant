<script setup lang="ts">
import AppIcon from './AppIcon.vue'

defineProps<{ active: 'tasks' | 'chat' }>()

const tabs = [
  { key: 'tasks', label: '任务', to: '/tasks', icon: 'list', activeIcon: 'list-fill' },
  { key: 'chat', label: '助手', to: '/chat', icon: 'chat', activeIcon: 'chat-fill' },
] as const
</script>

<template>
  <nav class="tabbar" aria-label="主导航">
    <router-link
      v-for="t in tabs"
      :key="t.key"
      class="tabbar__item"
      :class="{ 'tabbar__item--active': active === t.key }"
      :to="t.to"
      :aria-label="t.label"
      :aria-current="active === t.key ? 'page' : undefined"
    >
      <AppIcon :name="active === t.key ? t.activeIcon : t.icon" :size="24" />
      <span class="tabbar__label">{{ t.label }}</span>
    </router-link>
  </nav>
</template>

<style scoped>
.tabbar {
  display: flex;
  height: calc(var(--tabbar-height) + var(--safe-bottom));
  padding-bottom: var(--safe-bottom);
  background: var(--bg-card);
  border-top: 1px solid var(--border-color);
  flex-shrink: 0;
}
.tabbar__item {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 2px;
  min-height: 44px;
  color: var(--text-secondary);
  transition: color var(--dur-fast) ease;
}
.tabbar__item--active {
  color: var(--color-primary);
}
.tabbar__label {
  font-size: 10px;
  line-height: 14px;
}
</style>