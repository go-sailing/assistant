<script setup lang="ts">
/**
 * v0.5.0：压缩临时状态条（UXUI 5.3 / SDD 3.1）。
 *
 * 仅在本轮真的发生压缩时出现（服务端 SSE `event: status {stage:'compacting'}`），
 * 随首个文本增量到达淡出；不落消息历史、刷新后不补显、不遮罩、不阻断阅读。
 */
defineProps<{ visible: boolean }>()
</script>

<template>
  <Transition name="fade">
    <div v-if="visible" class="compacting" role="status" aria-live="polite">
      <span class="compacting__spinner" aria-hidden="true" />
      <span class="compacting__text">正在回顾之前的对话…</span>
    </div>
  </Transition>
</template>

<style scoped>
.compacting {
  align-self: flex-start;
  display: inline-flex;
  align-items: center;
  gap: var(--sp-2);
  height: 32px;
  padding: 0 var(--sp-3);
  border: 1px solid var(--border-color);
  border-radius: 16px;
  background: var(--bg-card);
  font-size: var(--font-caption);
  line-height: var(--font-caption-lh);
  color: var(--text-secondary);
}
.compacting__spinner {
  width: 12px;
  height: 12px;
  border: 2px solid rgba(61, 90, 254, 0.25);
  border-top-color: var(--color-primary);
  border-radius: 50%;
  animation: compacting-spin 0.7s linear infinite;
}
@keyframes compacting-spin {
  to {
    transform: rotate(360deg);
  }
}
.fade-enter-active,
.fade-leave-active {
  transition: opacity 200ms ease;
}
.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
@media (prefers-reduced-motion: reduce) {
  .compacting__spinner {
    animation: none;
  }
}
</style>