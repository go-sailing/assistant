<script setup lang="ts">
import AppButton from './AppButton.vue'

withDefaults(
  defineProps<{
    title: string
    text?: string
    actionText?: string
  }>(),
  { text: '', actionText: '' }
)

const emit = defineEmits<{ (e: 'action'): void }>()
</script>

<template>
  <div class="empty">
    <svg class="empty__art" viewBox="0 0 120 120" aria-hidden="true">
      <g fill="none" stroke="var(--color-primary)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" opacity="0.55">
        <rect x="28" y="20" width="64" height="80" rx="8" />
        <path d="M42 44h36M42 60h36M42 76h20" />
      </g>
      <circle cx="88" cy="88" r="16" fill="var(--color-primary-light)" />
      <path d="M82 88h12M88 82v12" stroke="var(--color-primary)" stroke-width="2" stroke-linecap="round" />
    </svg>
    <h2 class="empty__title">{{ title }}</h2>
    <p v-if="text" class="empty__text">{{ text }}</p>
    <AppButton v-if="actionText" class="empty__action" type="primary" @click="emit('action')">
      {{ actionText }}
    </AppButton>
  </div>
</template>

<style scoped>
.empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: var(--sp-8) var(--sp-6);
  text-align: center;
}
.empty__art {
  width: 120px;
  height: 120px;
}
.empty__title {
  margin-top: var(--sp-4);
  font-size: var(--font-body-l);
  line-height: var(--font-body-l-lh);
  font-weight: 600;
}
.empty__text {
  margin-top: var(--sp-2);
  font-size: var(--font-body-m);
  line-height: var(--font-body-m-lh);
  color: var(--text-secondary);
  white-space: pre-line;
}
.empty__action {
  margin-top: var(--sp-6);
  width: auto;
  min-width: 160px;
}
</style>