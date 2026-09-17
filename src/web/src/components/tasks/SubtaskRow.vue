<script setup lang="ts">
import { computed } from 'vue'
import type { Task } from '@/types'
import { dueTone, formatDue } from '@/utils/time'
import AppCheckbox from '../AppCheckbox.vue'
import AppIcon from '../AppIcon.vue'
import PriorityFlag from '../PriorityFlag.vue'
import ProgressBar from './ProgressBar.vue'

const props = withDefaults(
  defineProps<{
    task: Task
    /** 层级（1 = 树的直接子级），决定缩进与 aria-level */
    level?: number
    /** 是否可展开下一级（subtask_total > 0 时由树传入） */
    expandable?: boolean
    expanded?: boolean
    loading?: boolean
    /** 只读模式（如对话卡片中的预览） */
    interactive?: boolean
  }>(),
  { level: 1, expandable: false, expanded: false, loading: false, interactive: true }
)

const emit = defineEmits<{
  (e: 'detail', task: Task): void
  (e: 'toggle', task: Task): void
  (e: 'toggle-expand', task: Task): void
}>()

const completed = computed(() => props.task.status === 'completed')
const tone = computed(() => dueTone(props.task))
const timeText = computed(() => formatDue(props.task.due_at))
const progressText = computed(() => `${props.task.subtask_completed}/${props.task.subtask_total}`)

/** 父任务三态：未完成 / 已完成 / 部分完成（半选） */
const indeterminate = computed(
  () =>
    props.task.status !== 'completed' &&
    props.task.subtask_total > 0 &&
    props.task.subtask_completed > 0 &&
    props.task.subtask_completed < props.task.subtask_total
)

/** 每级缩进 14pt，第 5 级起不再缩进（保证 320pt 小屏标题宽度） */
const indent = computed(() => Math.min(Math.max(props.level - 1, 0), 4) * 14)
</script>

<template>
  <div
    class="srow"
    role="treeitem"
    :aria-level="Math.min(level, 5)"
    :aria-label="`${task.title}${completed ? '，已完成' : ''}`"
  >
    <span v-if="level > 1" class="srow__guide" :style="{ left: `${indent - 8}px` }" aria-hidden="true" />
    <div class="srow__line" :style="{ paddingLeft: `${indent}px` }">
      <button
        v-if="expandable"
        class="srow__chevron pressable"
        type="button"
        :aria-expanded="expanded"
        :aria-label="expanded ? `收起「${task.title}」的子任务` : `展开「${task.title}」的子任务`"
        @click.stop="emit('toggle-expand', task)"
      >
        <AppIcon name="chevron-right" :size="12" :class="['srow__arrow', { 'srow__arrow--open': expanded }]" color="#6B7080" />
      </button>
      <span v-else class="srow__chevron srow__chevron--empty" aria-hidden="true" />

      <AppCheckbox
        :checked="completed"
        :indeterminate="indeterminate"
        :size="20"
        :disabled="!interactive"
        :label="completed ? `恢复「${task.title}」为未完成` : `标记「${task.title}」完成`"
        @toggle="emit('toggle', task)"
      />

      <button
        class="srow__main pressable"
        type="button"
        :aria-label="`查看子任务 ${task.title}`"
        @click="emit('detail', task)"
      >
        <span class="srow__title" :class="{ 'srow__title--done': completed }">{{ task.title }}</span>
        <span class="srow__meta">
          <span v-if="task.due_at" class="srow__time" :class="{
            'srow__time--danger': tone === 'danger',
            'srow__time--warning': tone === 'warning',
          }">
            <AppIcon name="clock" :size="12" color="currentColor" />
            {{ timeText }}
          </span>
          <PriorityFlag :priority="task.priority" />
        </span>
        <span v-if="task.subtask_total > 0" class="srow__progress">
          <span class="srow__progress-text">
            子任务 {{ task.subtask_completed }}/{{ task.subtask_total }}
            <template v-if="task.subtask_completed >= task.subtask_total">（已全部完成）</template>
          </span>
          <ProgressBar :total="task.subtask_total" :completed="task.subtask_completed" />
        </span>
      </button>

      <span v-if="loading" class="srow__loading" aria-hidden="true">…</span>
    </div>
  </div>
</template>

<style scoped>
.srow {
  position: relative;
  background: var(--bg-card);
}
/* 树引导线：1pt，纵向贯穿行高 */
.srow__guide {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 1px;
  background: var(--color-tree-line, #eef0f5);
}
.srow__line {
  display: flex;
  align-items: center;
  gap: 2px;
  min-height: 44px;
  padding-right: var(--sp-4);
}
.srow__chevron {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 44px;
  flex-shrink: 0;
}
.srow__chevron--empty {
  width: 24px;
}
.srow__arrow {
  transition: transform 150ms ease;
}
.srow__arrow--open {
  transform: rotate(90deg);
}
.srow__main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-height: 44px;
  justify-content: center;
  text-align: left;
}
.srow__title {
  font-size: var(--font-body-m);
  line-height: var(--font-body-m-lh);
  color: var(--text-primary);
  word-break: break-word;
}
.srow__title--done {
  color: var(--text-disabled);
  text-decoration: line-through;
}
.srow__meta {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: var(--font-caption);
  line-height: var(--font-caption-lh);
  color: var(--text-secondary);
}
.srow__time {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  font-variant-numeric: tabular-nums;
}
.srow__time--danger {
  color: var(--color-danger);
}
.srow__time--warning {
  color: var(--color-warning);
}
.srow__progress {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
}
.srow__progress-text {
  font-size: var(--font-caption);
  color: var(--text-secondary);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.srow__progress :deep(.progress) {
  flex: 1;
  min-width: 40px;
}
.srow__loading {
  font-size: var(--font-caption);
  color: var(--text-disabled);
}
</style>
