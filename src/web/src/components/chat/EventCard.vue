<script setup lang="ts">
import { computed } from 'vue'
import type { CalendarEvent, Task } from '@/types'
import { formatEventCardTime } from '@/utils/time'
import AppCheckbox from '../AppCheckbox.vue'
import AppIcon from '../AppIcon.vue'
import PriorityFlag from '../PriorityFlag.vue'

/**
 * 对话中的日程卡片（UX 5.7）。
 * 任务日程与普通日程用「图标 + 颜色 + 文案」三重区分，不靠颜色单一传达。
 */
const props = withDefaults(
  defineProps<{
    event: CalendarEvent
    /** 多日分组卡片内不需要箭头 */
    showArrow?: boolean
  }>(),
  { showArrow: true }
)

const emit = defineEmits<{
  (e: 'detail', event: CalendarEvent): void
  (e: 'task', task: Task): void
  (e: 'toggle', event: CalendarEvent): void
}>()

const isTask = computed(() => props.event.event_type === 'task')
const taskDone = computed(() => props.event.task?.status === 'completed')
const timeText = computed(() => formatEventCardTime(props.event))

/** 任务日程的任务摘要转为 Task 形状，供跳转任务详情使用 */
const taskAsTask = computed<Task | null>(() => {
  const t = props.event.task
  if (!t) return null
  return {
    id: t.id,
    title: t.title,
    note: null,
    status: t.status,
    priority: t.priority,
    due_at: t.due_at,
    list_id: t.list_id,
    list_name: t.list_name,
    created_at: '',
    updated_at: '',
    completed_at: t.completed_at,
  }
})

function openDetail(): void {
  emit('detail', props.event)
}

function openTask(e: Event): void {
  e.stopPropagation()
  if (taskAsTask.value) emit('task', taskAsTask.value)
}

/** 勾选动作落在关联任务上（AppCheckbox 内部已阻止冒泡，避免同时触发整卡跳转） */
function toggleTask(): void {
  emit('toggle', props.event)
}
</script>

<template>
  <!-- 已删除的日程只展示占位，避免把历史快照误当最新状态 -->
  <div v-if="event.missing" class="ecard ecard--missing">
    <div class="ecard__row">
      <AppIcon name="calendar" :size="16" color="#B5B9C4" />
      <div class="ecard__main">
        <p class="ecard__title ecard__title--missing">{{ event.title }}</p>
        <p class="ecard__sub">该日程已删除</p>
      </div>
    </div>
  </div>

  <div v-else class="ecard" :class="{ 'ecard--task': isTask }">
    <div
      class="ecard__row"
      role="button"
      tabindex="0"
      :aria-label="`查看日程 ${event.title}`"
      @click="openDetail"
      @keydown.enter="openDetail"
    >
      <!-- 类型身份：任务日程用链接图标，普通日程用圆点 -->
      <AppIcon v-if="isTask" name="link" :size="16" color="#7C4DFF" />
      <span v-else class="ecard__dot" aria-hidden="true" />

      <div class="ecard__main">
        <div class="ecard__title-row">
          <span
            v-if="isTask"
            class="ecard__title ecard__title--link"
            :class="{ 'ecard__title--done': taskDone }"
            role="button"
            tabindex="0"
            :aria-label="`查看任务 ${event.title}`"
            @click="openTask"
            @keydown.enter="openTask"
            >{{ event.title }}</span
          >
          <span v-else class="ecard__title">{{ event.title }}</span>
          <span v-if="event.conflicts && event.conflicts.length" class="ecard__conflict">
            <AppIcon name="conflict" :size="12" color="#FF8F1F" />
            冲突
          </span>
        </div>
        <p class="ecard__sub">
          <span v-if="isTask" class="ecard__tag">任务日程</span>
          <span class="ecard__time">{{ timeText }}</span>
        </p>
        <p v-if="event.location" class="ecard__sub">
          <AppIcon name="pin" :size="13" color="#6B7080" />
          <span class="ellipsis">{{ event.location }}</span>
        </p>
      </div>

      <!-- 任务日程：勾选即完成关联任务（动作归属写在 aria-label 里） -->
      <AppCheckbox
        v-if="isTask && event.task"
        :checked="taskDone"
        :size="20"
        :label="`完成关联任务：${event.title}`"
        @toggle="toggleTask"
      />
      <AppIcon v-else-if="showArrow" name="chevron-right" :size="18" color="#B5B9C4" />
      <AppIcon v-if="isTask && showArrow" name="chevron-right" :size="18" color="#B5B9C4" />
    </div>
  </div>
</template>

<style scoped>
.ecard {
  background: var(--bg-card);
  border: 1px solid var(--border-color);
  border-left: 4px solid var(--color-primary);
  border-radius: var(--radius-card);
  overflow: hidden;
}
.ecard--task {
  border-left-color: var(--color-link);
}
.ecard--missing {
  border-left-color: var(--text-disabled);
  background: var(--bg-page);
}
.ecard__title--missing {
  color: var(--text-disabled);
  text-decoration: line-through;
}
.ecard__row {
  display: flex;
  align-items: flex-start;
  gap: var(--sp-2);
  padding: var(--sp-3);
}
.ecard__row:active {
  background: #fafbff;
}
.ecard__dot {
  width: 8px;
  height: 8px;
  margin-top: 6px;
  border-radius: 50%;
  background: var(--color-primary);
  flex-shrink: 0;
}
.ecard__main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.ecard__title-row {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}
.ecard__title {
  font-size: var(--font-body-l);
  line-height: var(--font-body-l-lh);
  color: var(--text-primary);
  word-break: break-word;
}
.ecard__title--link {
  color: var(--color-link-text);
  text-decoration: underline;
  text-decoration-style: dotted;
}
.ecard__title--done {
  color: var(--text-disabled);
  text-decoration: line-through;
}
.ecard__conflict {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  flex-shrink: 0;
  height: 18px;
  padding: 0 6px;
  border-radius: 9px;
  background: var(--color-conflict-bg);
  color: #a35b00;
  font-size: var(--font-caption-s);
  line-height: var(--font-caption-s-lh);
}
.ecard__sub {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: var(--font-caption);
  line-height: var(--font-caption-lh);
  color: var(--text-secondary);
}
.ecard__tag {
  height: 18px;
  padding: 0 6px;
  border-radius: 9px;
  background: var(--color-link-light);
  color: var(--color-link-text);
  font-size: var(--font-caption-s);
  line-height: 18px;
}
.ecard__time {
  font-variant-numeric: tabular-nums;
}
</style>