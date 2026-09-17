<script setup lang="ts">
import AppIcon from './AppIcon.vue'

/**
 * 浮动按钮（v0.2.0，系统设计文档 3.2）：
 * 由 props 驱动形态 —— open-chat（日历/任务页 → 进入助手）、hidden（其余页面不渲染）。
 * v0.3.0：会话列表下线，`new-conversation`（新建对话）形态删除。
 */
withDefaults(
  defineProps<{
    mode?: 'open-chat' | 'hidden'
  }>(),
  { mode: 'open-chat' }
)
const emit = defineEmits<{ (e: 'click'): void }>()
</script>

<template>
  <button v-if="mode !== 'hidden'" class="fab pressable" aria-label="打开助手" @click="emit('click')">
    <AppIcon name="chat-fill" :size="24" color="#fff" />
  </button>
</template>

<style scoped>
.fab {
  position: absolute;
  right: var(--sp-4);
  bottom: calc(var(--safe-bottom) + var(--sp-4));
  width: 56px;
  height: 56px;
  border-radius: 50%;
  background: var(--color-primary);
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 4px 12px rgba(61, 90, 254, 0.32);
  z-index: 20;
  transition: background-color var(--dur-fast) ease;
}
.fab:active {
  background: var(--color-primary-pressed);
}
</style>
