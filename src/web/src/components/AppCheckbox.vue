<script setup lang="ts">
import AppIcon from './AppIcon.vue'

const props = withDefaults(
  defineProps<{
    checked: boolean
    disabled?: boolean
    label?: string
    size?: number
  }>(),
  { disabled: false, label: '切换完成状态', size: 22 }
)

const emit = defineEmits<{ (e: 'toggle'): void }>()

function onClick(e: Event): void {
  e.stopPropagation()
  if (props.disabled) return
  emit('toggle')
}
</script>

<template>
  <button
    class="checkbox pressable"
    :class="{ 'checkbox--checked': checked }"
    :style="{ width: `${size}px`, height: `${size}px` }"
    :disabled="disabled"
    role="checkbox"
    :aria-checked="checked"
    :aria-label="label"
    @click="onClick"
  >
    <AppIcon v-if="checked" name="check" :size="size - 6" color="#fff" />
  </button>
</template>

<style scoped>
.checkbox {
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  border: 1.5px solid var(--text-disabled);
  background: transparent;
  flex-shrink: 0;
  /* 视觉尺寸保持 22px，但用伪元素把点击热区扩展到 44px 以满足触控要求 */
  position: relative;
  transition: background-color var(--dur-fast) ease, border-color var(--dur-fast) ease;
}
.checkbox::after {
  content: '';
  position: absolute;
  top: 50%;
  left: 50%;
  width: 44px;
  height: 44px;
  transform: translate(-50%, -50%);
}
.checkbox--checked {
  background: var(--color-primary);
  border-color: var(--color-primary);
}
</style>