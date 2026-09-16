<script setup lang="ts">
import AppIcon from './AppIcon.vue'

withDefaults(defineProps<{ label?: string }>(), { label: '新建任务' })
const emit = defineEmits<{ (e: 'click'): void }>()
</script>

<template>
  <button class="fab pressable" :aria-label="label" @click="emit('click')">
    <AppIcon name="plus" :size="26" color="#fff" />
  </button>
</template>

<style scoped>
.fab {
  position: absolute;
  right: var(--sp-4);
  bottom: calc(var(--tabbar-height) + var(--safe-bottom) + var(--sp-4));
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