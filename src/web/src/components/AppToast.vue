<script setup lang="ts">
import { useToastStore } from '@/stores/toast'

const toast = useToastStore()
</script>

<template>
  <Transition name="toast">
    <div v-if="toast.visible" class="toast" role="status" :class="{ 'toast--action': !!toast.action }">
      <span class="toast__text">{{ toast.message }}</span>
      <button
        v-if="toast.action"
        class="toast__action pressable"
        type="button"
        :aria-label="toast.action.label"
        @click="toast.runAction()"
      >
        {{ toast.action.label }}
      </button>
    </div>
  </Transition>
</template>

<style scoped>
.toast {
  position: fixed;
  top: calc(var(--safe-top) + 12px);
  left: 50%;
  transform: translateX(-50%);
  max-width: 80%;
  padding: 8px 16px;
  border-radius: 999px;
  background: rgba(26, 29, 38, 0.86);
  color: #fff;
  font-size: var(--font-body-m);
  line-height: var(--font-body-m-lh);
  z-index: 300;
  pointer-events: none;
  text-align: center;
}
/* 带操作位：整条可点，按钮热区纵向覆盖整条 toast */
.toast--action {
  display: inline-flex;
  align-items: center;
  gap: var(--sp-3);
  max-width: 88%;
  pointer-events: auto;
}
.toast__text {
  flex: 1;
  min-width: 0;
  text-align: left;
}
.toast__action {
  flex-shrink: 0;
  min-height: 32px;
  padding: 0 var(--sp-1);
  font-size: var(--font-body-m);
  font-weight: 600;
  color: #9fb0ff;
}
.toast-enter-active,
.toast-leave-active {
  transition: all 200ms ease;
}
.toast-enter-from,
.toast-leave-to {
  opacity: 0;
  transform: translate(-50%, -16px);
}
</style>