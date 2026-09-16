<script setup lang="ts">
import { computed } from 'vue'
import type { TaskPriority } from '@/types'

const props = withDefaults(
  defineProps<{
    priority: TaskPriority
    /** 是否显示文字标签（颜色不作为唯一信息载体） */
    withText?: boolean
  }>(),
  { withText: false }
)

const textMap: Record<TaskPriority, string> = {
  high: '高',
  medium: '中',
  low: '低',
  none: '无',
}

const color = computed(() => `var(--priority-${props.priority})`)
</script>

<template>
  <span
    class="priority"
    :class="{ 'priority--flag': withText }"
    role="img"
    :aria-label="`优先级：${textMap[priority]}`"
  >
    <!-- 形状 + 颜色双重编码，避免只靠颜色传达优先级 -->
    <span
      class="priority__dot"
      :class="`priority__dot--${priority}`"
      :style="{ background: color }"
      aria-hidden="true"
    />
    <span v-if="withText" class="priority__text" :style="{ color }">
      {{ textMap[priority] }}优先级
    </span>
  </span>
</template>

<style scoped>
.priority {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}
.priority__dot {
  width: 7px;
  height: 7px;
  flex-shrink: 0;
}
/* 高=三角、中=菱形、低=圆点、无=空心圆：形状本身即可区分级别 */
.priority__dot--high {
  clip-path: polygon(50% 0%, 100% 100%, 0% 100%);
}
.priority__dot--medium {
  clip-path: polygon(50% 0%, 100% 50%, 50% 100%, 0% 50%);
}
.priority__dot--low {
  border-radius: 50%;
}
.priority__dot--none {
  border-radius: 50%;
  border: 1.5px solid var(--priority-none);
  background: transparent !important;
}
.priority__text {
  font-size: var(--font-caption);
  line-height: var(--font-caption-lh);
}
</style>