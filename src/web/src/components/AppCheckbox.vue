<script setup lang="ts">
import { computed } from 'vue'
import AppIcon from './AppIcon.vue'

const props = withDefaults(
  defineProps<{
    checked: boolean
    disabled?: boolean
    label?: string
    size?: number
    /** v0.2.0 三态：部分完成（视觉为横向短杠，aria-checked="mixed"） */
    indeterminate?: boolean
  }>(),
  { disabled: false, label: '切换完成状态', size: 22, indeterminate: false }
)

const emit = defineEmits<{ (e: 'toggle'): void }>()

/** 半选优先于勾选：父任务未完成但部分子任务已完成 */
const ariaChecked = computed<'true' | 'false' | 'mixed'>(() =>
  props.indeterminate ? 'mixed' : props.checked ? 'true' : 'false'
)

function onClick(e: Event): void {
  e.stopPropagation()
  if (props.disabled) return
  emit('toggle')
}
</script>

<template>
  <button
    class="checkbox pressable"
    :class="{ 'checkbox--checked': checked && !indeterminate, 'checkbox--indeterminate': indeterminate }"
    :style="{ width: `${size}px`, height: `${size}px` }"
    :disabled="disabled"
    role="checkbox"
    :aria-checked="ariaChecked"
    :aria-label="label"
    @click="onClick"
  >
    <AppIcon v-if="checked && !indeterminate" name="check" :size="size - 6" color="#fff" />
    <!-- 半选：短杠 + primary 描边，形态与对勾区分，不依赖颜色 -->
    <span v-else-if="indeterminate" class="checkbox__dash" aria-hidden="true" />
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
.checkbox--indeterminate {
  background: var(--color-primary-light);
  border-color: var(--color-primary);
}
.checkbox__dash {
  width: 55%;
  height: 2px;
  border-radius: 1px;
  background: var(--color-primary);
}
</style>
