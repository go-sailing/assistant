<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import * as taskApi from '@/api/tasks'
import * as eventApi from '@/api/events'
import { errorText } from '@/api/client'
import type { CalendarEvent, Task } from '@/types'
import AppActionSheet from '@/components/AppActionSheet.vue'
import AppButton from '@/components/AppButton.vue'
import AppCheckbox from '@/components/AppCheckbox.vue'
import AppIcon from '@/components/AppIcon.vue'
import AppModal from '@/components/AppModal.vue'
import PriorityFlag from '@/components/PriorityFlag.vue'
import AgentExecutionPanel from '@/components/agents/AgentExecutionPanel.vue'
import { useTaskSyncStore } from '@/stores/taskSync'
import { useEventSyncStore } from '@/stores/eventSync'
import { useToastStore } from '@/stores/toast'
import { dueTone, formatEventRange, formatFull, formatShort, overdueDays } from '@/utils/time'

/**
 * 普通任务面板（v0.8.0）：独立单任务，无成员分区/面包屑；
 * 归属项目时额外显示「所属项目」一行（可跳转项目详情）；
 * 已完成态整块隐藏「智能体执行」区与「日程安排」分区（PRD 决议 12 / UXUI 5.4、7.4）。
 */
const props = defineProps<{ task: Task }>()
const emit = defineEmits<{ (e: 'changed'): void }>()

const router = useRouter()
const toast = useToastStore()
const taskSync = useTaskSyncStore()
const eventSync = useEventSyncStore()

const events = ref<CalendarEvent[]>([])
const actionLoading = ref(false)
const sheetVisible = ref(false)
/** 删除级联告知（有日程安排时先明示数量） */
const deleteCascade = ref<{ events: number } | null>(null)

const completed = computed(() => props.task.status === 'completed')
const overdue = computed(() => dueTone(props.task) === 'danger')
const overdueText = computed(() => (overdue.value ? `已逾期 ${overdueDays(props.task.due_at)} 天` : ''))
/** v0.8.0：任务归属项目（独立任务为 null，不渲染该行） */
const project = computed(() => props.task.project)

/**
 * v0.8.0 A11y：已完成任务不再有执行/排期入口，仅在"曾有日程或指派"时
 * 展示一行 caption 说明，避免用户误以为功能丢失（无历史则完全不展示）。
 */
const hadHistory = computed(
  () =>
    events.value.length > 0 ||
    (props.task.event_count ?? 0) > 0 ||
    props.task.agent_id !== null ||
    props.task.agent_state !== 'none'
)

const deleteText = computed(() => {
  const info = deleteCascade.value
  if (!info) return ''
  return info.events > 0 ? `将同时删除 ${info.events} 条日程安排，且不可恢复。` : '删除后不可恢复。'
})

async function loadEvents(): Promise<void> {
  try {
    events.value = await eventApi.fetchTaskEvents(props.task.id)
  } catch {
    events.value = []
  }
}

async function toggleStatus(): Promise<void> {
  if (actionLoading.value) return
  actionLoading.value = true
  try {
    if (completed.value) {
      await taskApi.uncompleteTask(props.task.id)
      toast.show('已恢复未完成')
    } else {
      await taskApi.completeTask(props.task.id)
      toast.show('已标记完成')
    }
    taskSync.markDirty()
    emit('changed')
    await loadEvents()
  } catch (e) {
    toast.show(errorText(e))
  } finally {
    actionLoading.value = false
  }
}

/** 删除前预取影响范围（服务端权威计数） */
async function askDelete(): Promise<void> {
  try {
    const preview = await taskApi.fetchPreviewRemove(props.task.id)
    if (preview.deleted_event_count > 0) {
      deleteCascade.value = { events: preview.deleted_event_count }
      return
    }
    sheetVisible.value = true
  } catch (e) {
    toast.show(errorText(e))
  }
}

async function remove(): Promise<void> {
  sheetVisible.value = false
  deleteCascade.value = null
  try {
    const res = await taskApi.deleteTask(props.task.id)
    taskSync.markDirty()
    eventSync.markDirty()
    const eventCount = res.deleted_event_count ?? 0
    toast.show(eventCount > 0 ? `已删除任务及其 ${eventCount} 条日程安排` : '已删除')
    router.replace('/tasks')
  } catch (e) {
    toast.show(errorText(e))
  }
}

/** 为任务安排执行时段：进入独立的任务日程表单（任务锁定） */
function planEvent(): void {
  router.push(`/calendar/task/new?task_id=${props.task.id}&from=task`)
}

function openEvent(ev: CalendarEvent): void {
  router.push(`/calendar/${ev.id}`)
}

/** v0.8.0：跳转所属项目详情（独立任务无该行） */
function goProject(): void {
  const p = project.value
  if (p) router.push(`/projects/${p.id}`)
}

onMounted(() => {
  void loadEvents()
})

watch(
  () => props.task.id,
  () => {
    void loadEvents()
  }
)
</script>

<template>
  <div class="np">
    <section class="np__main">
      <AppCheckbox
        :checked="completed"
        :size="24"
        :disabled="actionLoading"
        :label="completed ? '标记为未完成' : '标记为已完成'"
        @toggle="toggleStatus"
      />
      <h1 class="np__title" :class="{ 'np__title--done': completed }">{{ task.title }}</h1>
    </section>

    <ul class="np__meta">
      <li class="np__meta-row">
        <PriorityFlag :priority="task.priority" with-text />
      </li>
      <li class="np__meta-row">
        <AppIcon name="clock" :size="18" color="#6B7080" />
        <span :class="{ 'np__overdue': overdue }">{{ formatFull(task.due_at) }}</span>
        <span v-if="overdueText" class="np__overdue-hint">{{ overdueText }}</span>
      </li>
      <!-- v0.8.0：归属项目时展示，可跳转项目详情；独立任务不渲染该行 -->
      <li
        v-if="project"
        class="np__meta-row pressable"
        role="button"
        tabindex="0"
        @click="goProject"
        @keydown.enter="goProject"
      >
        <AppIcon name="folder" :size="18" color="var(--color-primary)" />
        <span class="np__meta-label">所属项目</span>
        <span class="np__meta-value ellipsis">{{ project.name }}</span>
        <AppIcon name="chevron-right" :size="16" color="#B5B9C4" />
      </li>
    </ul>

    <section class="np__note">
      <h2 class="np__note-title">备注</h2>
      <p class="np__note-text">{{ task.note || '暂无备注' }}</p>
    </section>

    <!-- 智能体执行分区（v0.7.0）：指派 / 状态 / 执行记录；已完成态整块不渲染（PRD 决议 12） -->
    <AgentExecutionPanel v-if="!completed" :task="task" @changed="emit('changed')" />

    <!-- 日程安排分区：任务日程作为该任务的执行时段载体，同一任务可有多条；已完成态整块不渲染 -->
    <section v-if="!completed" class="np__schedule">
      <div class="np__schedule-head">
        <h2 class="np__schedule-title">
          日程安排<span v-if="events.length" class="np__schedule-count">（{{ events.length }}）</span>
        </h2>
        <button class="np__schedule-add pressable" @click="planEvent">
          <AppIcon name="plus" :size="14" color="#3D5AFE" />
          安排日程
        </button>
      </div>
      <ul v-if="events.length" class="np__schedule-list">
        <li
          v-for="ev in events"
          :key="String(ev.id)"
          class="np__schedule-item pressable"
          role="button"
          tabindex="0"
          :aria-label="`查看日程安排 ${ev.title}`"
          @click="openEvent(ev)"
          @keydown.enter="openEvent(ev)"
        >
          <AppIcon name="link" :size="16" color="#7C4DFF" />
          <span class="np__schedule-time">{{ formatEventRange(ev) }}</span>
          <span class="np__schedule-place ellipsis">{{ ev.location || formatShort(ev.start_at) }}</span>
          <AppIcon name="chevron-right" :size="16" color="#B5B9C4" />
        </li>
      </ul>
      <p v-else class="np__schedule-empty">还没有安排执行时段</p>
    </section>

    <!-- v0.8.0 A11y：已完成态入口去向说明（仅"曾有日程或指派"时展示一行 caption） -->
    <p v-if="completed && hadHistory" class="np__hidden-hint">取消完成后可重新指派/安排日程</p>

    <section class="np__times">
      <p>创建于 {{ formatShort(task.created_at) }}</p>
      <p v-if="task.completed_at">完成于 {{ formatShort(task.completed_at) }}</p>
    </section>

    <div class="np__actions">
      <AppButton type="primary" :loading="actionLoading" @click="toggleStatus">
        {{ completed ? '取消完成' : '标记已完成' }}
      </AppButton>
      <button class="np__delete pressable" @click="askDelete">删除</button>
    </div>

    <!-- 无日程影响时的简单确认 -->
    <AppActionSheet
      :visible="sheetVisible"
      title="删除后不可恢复"
      :items="[{ label: '删除任务', value: 'delete', danger: true }]"
      @select="remove"
      @cancel="sheetVisible = false"
    />

    <!-- 有日程安排时的级联删除告知 -->
    <AppModal
      :visible="!!deleteCascade"
      title="删除任务？"
      :text="deleteText"
      confirm-text="删除"
      danger
      @confirm="remove"
      @cancel="deleteCascade = null"
    />
  </div>
</template>

<style scoped>
.np__main {
  display: flex;
  align-items: flex-start;
  gap: var(--sp-3);
  padding: var(--sp-4);
  background: var(--bg-card);
}
.np__title {
  flex: 1;
  font-size: 20px;
  line-height: 28px;
  font-weight: 600;
  word-break: break-word;
}
.np__title--done {
  color: var(--text-disabled);
  text-decoration: line-through;
}
.np__meta {
  margin-top: var(--sp-2);
  background: var(--bg-card);
}
.np__meta-row {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  min-height: 48px;
  padding: 0 var(--sp-4);
  border-bottom: 1px solid var(--border-color);
  font-size: var(--font-body-m);
  color: var(--text-primary);
}
.np__meta-label {
  flex: 1;
}
.np__meta-value {
  max-width: 55%;
  font-size: var(--font-body-m);
  color: var(--text-secondary);
}
.np__overdue {
  color: var(--color-danger);
}
.np__overdue-hint {
  font-size: var(--font-caption);
  color: var(--color-danger);
}
.np__note {
  margin-top: var(--sp-2);
  padding: var(--sp-4);
  background: var(--bg-card);
}
.np__note-title {
  font-size: var(--font-caption);
  color: var(--text-secondary);
  margin-bottom: var(--sp-2);
}
.np__note-text {
  font-size: var(--font-body-m);
  line-height: var(--font-body-m-lh);
  white-space: pre-wrap;
  word-break: break-word;
}
.np__schedule {
  margin-top: var(--sp-2);
  padding: var(--sp-4);
  background: var(--bg-card);
}
.np__schedule-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--sp-2);
}
.np__schedule-title {
  font-size: var(--font-caption);
  color: var(--text-secondary);
}
.np__schedule-count {
  color: var(--text-secondary);
}
.np__schedule-add {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  min-height: 44px;
  margin: -10px -8px -10px 0;
  padding: 0 var(--sp-2);
  font-size: var(--font-body-m);
  color: var(--color-primary);
}
.np__schedule-list {
  margin-top: var(--sp-1);
  display: flex;
  flex-direction: column;
}
.np__schedule-item {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  min-height: 48px;
  border-bottom: 1px solid var(--border-color);
}
.np__schedule-item:last-child {
  border-bottom: none;
}
.np__schedule-time {
  font-size: var(--font-body-m);
  font-variant-numeric: tabular-nums;
  color: var(--text-primary);
  flex-shrink: 0;
}
.np__schedule-place {
  flex: 1;
  min-width: 0;
  font-size: var(--font-caption);
  color: var(--text-secondary);
}
.np__schedule-empty {
  margin-top: var(--sp-2);
  font-size: var(--font-caption);
  color: var(--text-disabled);
}
.np__times {
  margin-top: var(--sp-2);
  padding: var(--sp-4);
  background: var(--bg-card);
  display: flex;
  flex-direction: column;
  gap: var(--sp-1);
  font-size: var(--font-caption);
  color: var(--text-secondary);
}
/* 已完成态的入口去向说明（一行 caption，不占位、无历史时不渲染） */
.np__hidden-hint {
  margin-top: var(--sp-2);
  padding: var(--sp-4);
  background: var(--bg-card);
  font-size: var(--font-caption);
  line-height: var(--font-caption-lh);
  color: var(--text-secondary);
}
.np__actions {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--sp-2);
  padding: var(--sp-6) var(--sp-4) 0;
}
.np__delete {
  min-height: 44px;
  padding: 0 var(--sp-4);
  font-size: var(--font-body-m);
  color: var(--color-danger);
}
</style>
