<script setup lang="ts">
import { computed } from 'vue'
import type { EventType } from '@/types'
import AppIcon from '@/components/AppIcon.vue'

const props = defineProps<{
  type: EventType
  /** 覆盖默认文案（如冲突列表里需要更短的文案） */
  text?: string
}>()

// 任务日程带 link 图标：类型信息不能只靠颜色传达
const label = computed(() => props.text || (props.type === 'task' ? '任务日程' : '普通日程'))
</script>

<template>
  <span class="type-tag" :class="`type-tag--${type}`">
    <AppIcon v-if="type === 'task'" name="link" :size="12" />
    <span class="type-tag__text">{{ label }}</span>
  </span>
</template>

<style scoped>
.type-tag {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 20px;
  padding: 0 8px;
  border-radius: 10px;
  font-size: var(--font-caption);
  line-height: 1;
  white-space: nowrap;
  flex-shrink: 0;
}
.type-tag--normal {
  background: var(--color-primary-light);
  color: var(--color-primary);
}
.type-tag--task {
  background: var(--color-link-light);
  color: var(--color-link-text);
}
</style>