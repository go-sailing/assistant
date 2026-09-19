<script setup lang="ts">
import { computed } from 'vue'
import type { Task } from '@/types'
import { dueTone, formatDue } from '@/utils/time'
import AppCheckbox from './AppCheckbox.vue'
import AppIcon from './AppIcon.vue'
import PriorityFlag from './PriorityFlag.vue'
import ProgressBar from './tasks/ProgressBar.vue'

const props = withDefaults(
  defineProps<{
    task: Task
    /** 是否可点击跳详情 */
    clickable?: boolean
    /** 候选卡片等场景隐藏右侧箭头 */
    showArrow?: boolean
    /** v0.6.0 项目进度展示：bar 含进度条 / count 仅计数 */
    subtaskDisplay?: 'bar' | 'count'
  }>(),
  { clickable: true, showArrow: true, subtaskDisplay: 'bar' }
)

const emit = defineEmits<{
  (e: 'detail', task: Task): void
  (e: 'toggle', task: Task): void
}>()

const completed = computed(() => props.task.status === 'completed')
const tone = computed(() => dueTone(props.task))
const timeText = computed(() => formatDue(props.task.due_at))
/** 仅项目任务有成员进度；普通任务恒为 0 */
const isProject = computed(() => props.task.task_type === 'project')
const total = computed(() => props.task.member_total)
const doneCount = computed(() => props.task.member_completed)
const hasMembers = computed(() => isProject.value && total.value > 0)
const allMembersDone = computed(() => hasMembers.value && doneCount.value >= total.value)
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
        <p class="card__title" :class="{ 'card__title--done': completed }">
          <AppIcon v-if="isProject" name="folder" :size="14" color="var(--color-primary)" />
          {{ task.title }}
        </p>
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

        <!-- 项目成员进度：全部完成时进度条转 success 色 -->
        <p v-if="hasMembers" class="card__progress">
          <span class="card__progress-text">
            <template v-if="allMembersDone">成员已全部完成</template>
            <template v-else>成员 {{ doneCount }}/{{ total }}</template>
          </span>
          <ProgressBar v-if="subtaskDisplay === 'bar'" :total="total" :completed="doneCount" />
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
.card__progress {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  margin-top: 2px;
}
.card__progress-text {
  font-size: var(--font-caption);
  line-height: var(--font-caption-lh);
  color: var(--text-secondary);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.card__progress :deep(.progress) {
  flex: 1;
  min-width: 40px;
}
.card__footer {
  display: flex;
  justify-content: flex-end;
  gap: var(--sp-2);
  padding: var(--sp-2) var(--sp-3) var(--sp-3);
  border-top: 1px solid var(--border-color);
}
</style>
