<script setup lang="ts">
import { computed } from 'vue'
import type { Task } from '@/types'
import { dueTone, formatDue } from '@/utils/time'
import AppCheckbox from './AppCheckbox.vue'
import AppIcon from './AppIcon.vue'
import PriorityFlag from './PriorityFlag.vue'

const props = withDefaults(
  defineProps<{
    task: Task
    /** 是否可点击跳详情 */
    clickable?: boolean
    /** 候选卡片等场景隐藏右侧箭头 */
    showArrow?: boolean
  }>(),
  { clickable: true, showArrow: true }
)

const emit = defineEmits<{
  (e: 'detail', task: Task): void
  (e: 'toggle', task: Task): void
}>()

const completed = computed(() => props.task.status === 'completed')
const tone = computed(() => dueTone(props.task))
const timeText = computed(() => formatDue(props.task.due_at))
</script>

<template>
  <div class="card">
    <div
      class="card__row"
      :class="{ 'card__row--clickable': clickable }"
      role="button"
      tabindex="0"
      :aria-label="`查看任务 ${task.title}`"
      @click="clickable && emit('detail', task)"
      @keydown.enter="clickable && emit('detail', task)"
    >
      <AppCheckbox
        :checked="completed"
        :size="20"
        :label="`标记「${task.title}」完成`"
        @toggle="emit('toggle', task)"
      />
      <div class="card__main">
        <p class="card__title" :class="{ 'card__title--done': completed }">{{ task.title }}</p>
        <p class="card__sub">
          <span class="card__list">{{ task.list_name || '默认清单' }}</span>
          <span v-if="task.due_at">·</span>
          <span
            v-if="task.due_at"
            :class="{
              'card__time--danger': tone === 'danger',
              'card__time--warning': tone === 'warning',
            }"
            >{{ timeText }}</span
          >
          <PriorityFlag :priority="task.priority" />
        </p>
      </div>
      <AppIcon v-if="showArrow && clickable" name="chevron-right" :size="18" color="#B5B9C4" />
      <slot name="trailing" />
    </div>
    <div v-if="$slots.footer" class="card__footer">
      <slot name="footer" />
    </div>
  </div>
</template>

<style scoped>
.card {
  background: var(--bg-card);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-card);
  overflow: hidden;
}
.card__row {
  display: flex;
  align-items: flex-start;
  gap: var(--sp-3);
  padding: var(--sp-3);
}
.card__row--clickable:active {
  background: #fafbff;
}
.card__main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.card__title {
  font-size: var(--font-body-l);
  line-height: var(--font-body-l-lh);
  color: var(--text-primary);
  word-break: break-word;
}
.card__title--done {
  color: var(--text-disabled);
  text-decoration: line-through;
}
.card__sub {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: var(--font-caption);
  line-height: var(--font-caption-lh);
  color: var(--text-secondary);
}
.card__time--danger {
  color: var(--color-danger);
}
.card__time--warning {
  color: var(--color-warning);
}
.card__footer {
  display: flex;
  justify-content: flex-end;
  gap: var(--sp-2);
  padding: var(--sp-2) var(--sp-3) var(--sp-3);
  border-top: 1px solid var(--border-color);
}
</style>