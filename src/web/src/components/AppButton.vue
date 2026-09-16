<script setup lang="ts">
withDefaults(
  defineProps<{
    /** primary 主要 / secondary 次级 / text 文字 / danger 危险 */
    type?: 'primary' | 'secondary' | 'text' | 'danger'
    block?: boolean
    disabled?: boolean
    loading?: boolean
    size?: 'normal' | 'small'
  }>(),
  { type: 'primary', block: true, disabled: false, loading: false, size: 'normal' }
)
</script>

<template>
  <button
    class="btn pressable"
    :class="[`btn--${type}`, `btn--${size}`, { 'btn--block': block }]"
    :disabled="disabled || loading"
    :aria-busy="loading"
  >
    <span v-if="loading" class="btn__spinner" aria-hidden="true" />
    <slot />
  </button>
</template>

<style scoped>
.btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: var(--sp-2);
  min-height: 44px;
  padding: 0 var(--sp-4);
  border-radius: var(--radius-control);
  font-size: var(--font-body-m);
  line-height: var(--font-body-m-lh);
  font-weight: 500;
  transition: background-color var(--dur-fast) ease, opacity var(--dur-fast) ease;
}
.btn--block {
  display: flex;
  width: 100%;
}
.btn--small {
  min-height: 32px;
  padding: 0 var(--sp-3);
  font-size: var(--font-caption);
  border-radius: 6px;
}
.btn--primary {
  background: var(--color-primary);
  color: #fff;
}
.btn--primary:active:not(:disabled) {
  background: var(--color-primary-pressed);
}
.btn--secondary {
  background: var(--bg-card);
  color: var(--text-primary);
  border: 1px solid var(--border-color);
}
.btn--text {
  background: transparent;
  color: var(--color-primary);
  padding: 0 var(--sp-2);
}
.btn--danger {
  background: var(--color-danger);
  color: #fff;
}
.btn--danger:active:not(:disabled) {
  opacity: 0.85;
}
.btn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}
.btn__spinner {
  width: 14px;
  height: 14px;
  border: 2px solid rgba(255, 255, 255, 0.5);
  border-top-color: #fff;
  border-radius: 50%;
  animation: btn-spin 0.7s linear infinite;
}
.btn--secondary .btn__spinner,
.btn--text .btn__spinner {
  border-color: rgba(61, 90, 254, 0.3);
  border-top-color: var(--color-primary);
}
@keyframes btn-spin {
  to {
    transform: rotate(360deg);
  }
}
</style>