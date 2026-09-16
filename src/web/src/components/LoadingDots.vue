<script setup lang="ts">
withDefaults(defineProps<{ text?: string }>(), { text: '正在处理…' })
</script>

<template>
  <div class="dots-wrap" aria-live="polite">
    <span class="dots" aria-hidden="true">
      <i class="dot" />
      <i class="dot" />
      <i class="dot" />
    </span>
    <span class="dots-wrap__text">{{ text }}</span>
  </div>
</template>

<style scoped>
.dots-wrap {
  display: inline-flex;
  align-items: center;
  gap: var(--sp-2);
  color: var(--text-secondary);
  font-size: var(--font-caption);
  line-height: var(--font-caption-lh);
}
.dots {
  display: inline-flex;
  gap: 4px;
}
.dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--text-disabled);
  animation: breathe 1.2s ease-in-out infinite;
}
.dot:nth-child(2) {
  animation-delay: 0.16s;
}
.dot:nth-child(3) {
  animation-delay: 0.32s;
}
@keyframes breathe {
  0%,
  100% {
    opacity: 0.35;
    transform: scale(0.8);
  }
  50% {
    opacity: 1;
    transform: scale(1);
  }
}
</style>