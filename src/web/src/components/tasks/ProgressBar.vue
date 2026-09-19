<script setup lang="ts">
import { computed } from 'vue'

const props = withDefaults(
  defineProps<{
    /** 总项数（项目成员总数） */
    total: number
    /** 已完成数 */
    completed: number
    /** 无障碍标签；缺省按进度自动生成 */
    label?: string
  }>(),
  { label: '' }
)

const ratio = computed(() => {
  if (!props.total) return 0
  return Math.min(1, Math.max(0, props.completed / props.total))
})

/** 全部完成时填充变 success 色 */
const allDone = computed(() => props.total > 0 && props.completed >= props.total)

const ariaLabel = computed(() => props.label || `进度 ${props.completed}/${props.total}`)
</script>

<template>
  <span
    class="progress"
    :class="{ 'progress--done': allDone }"
    role="progressbar"
    :aria-valuenow="completed"
    aria-valuemin="0"
    :aria-valuemax="total"
    :aria-label="ariaLabel"
  >
    <span class="progress__fill" :style="{ width: `${ratio * 100}%` }" />
  </span>
</template>

<style scoped>
/* 高 4pt、圆角 2pt 的细进度条（UXUI 6.2）；用 span 承载，便于嵌在按钮/文本行内 */
.progress {
  display: block;
  height: 4px;
  border-radius: 2px;
  background: var(--color-progress-track, var(--border-color));
  overflow: hidden;
}
.progress__fill {
  display: block;
  height: 100%;
  border-radius: 2px;
  background: var(--color-primary);
  transition: width 200ms ease, background-color var(--dur-fast) ease;
}
.progress--done .progress__fill {
  background: var(--color-success);
}
</style>
