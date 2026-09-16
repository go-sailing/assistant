<script setup lang="ts">
import { useToastStore } from '@/stores/toast'

const toast = useToastStore()
</script>

<template>
  <Transition name="toast">
    <div v-if="toast.visible" class="toast" role="status">{{ toast.message }}</div>
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