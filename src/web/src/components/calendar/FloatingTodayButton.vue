<script setup lang="ts">
import AppIcon from '@/components/AppIcon.vue'

/**
 * 日程主页浮动「今日」按钮（v0.6.0，UXUI 4.3）：
 * 选中日期 ≠ 今天时出现在右下角；点击回到今天，不改变日历折叠形态。
 * 白底胶囊（区别于已下线的助手 FAB：主色圆形）。
 */
const emit = defineEmits<{ (e: 'click'): void }>()
</script>

<template>
  <button class="today-fab pressable" type="button" aria-label="回到今天" @click="emit('click')">
    <AppIcon name="calendar" :size="16" color="var(--color-primary)" />
    <span class="today-fab__text">今日</span>
  </button>
</template>

<style scoped>
.today-fab {
  position: absolute;
  right: var(--sp-4);
  bottom: calc(var(--safe-bottom) + var(--sp-4));
  z-index: 20;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  min-height: 36px;
  padding: 0 var(--sp-3);
  border-radius: 18px;
  background: var(--bg-card);
  box-shadow: 0 2px 10px rgba(26, 29, 38, 0.16);
}
.today-fab:active {
  background: var(--color-primary-light);
}
.today-fab__text {
  font-size: var(--font-body-m);
  color: var(--color-primary);
  font-weight: 500;
}
</style>
