<script setup lang="ts">
import AppButton from './AppButton.vue'

withDefaults(defineProps<{ title?: string; text?: string }>(), {
  title: '加载失败',
  text: '网络或服务异常，请稍后重试',
})

const emit = defineEmits<{ (e: 'retry'): void }>()
</script>

<template>
  <div class="error-state">
    <svg class="error-state__art" viewBox="0 0 120 120" aria-hidden="true">
      <g fill="none" stroke="var(--color-primary)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" opacity="0.55">
        <circle cx="60" cy="58" r="34" />
        <path d="M60 40v22" />
        <circle cx="60" cy="72" r="2.4" fill="var(--color-primary)" />
      </g>
    </svg>
    <h2 class="error-state__title">{{ title }}</h2>
    <p class="error-state__text">{{ text }}</p>
    <AppButton class="error-state__action" type="secondary" @click="emit('retry')">
      <slot name="action">重试</slot>
    </AppButton>
  </div>
</template>

<style scoped>
.error-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: var(--sp-8) var(--sp-6);
  text-align: center;
}
.error-state__art {
  width: 110px;
  height: 110px;
}
.error-state__title {
  margin-top: var(--sp-4);
  font-size: var(--font-body-l);
  font-weight: 600;
}
.error-state__text {
  margin-top: var(--sp-2);
  font-size: var(--font-body-m);
  color: var(--text-secondary);
}
.error-state__action {
  margin-top: var(--sp-6);
  width: auto;
  min-width: 140px;
}
</style>