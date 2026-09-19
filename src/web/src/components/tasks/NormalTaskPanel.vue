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
 * 普通任务面板（v0.6.0）：独立单任务，无子任务分区/子树/面包屑；
 * 成员任务额外显示「所属项目」一行（可跳转项目详情）。
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
/** 所属项目名称（成员任务展示用） */
const projectTitle = ref('')

const completed = computed(() => props.task.status === 'completed')
const overdue = computed(() => dueTone(props.task) === 'danger')
const overdueText = computed(() => (overdue.value ? `已逾期 ${overdueDays(props.task.due_at)} 天` : ''))
const isMember = computed(() => props.task.parent_id !== null)

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

async function loadProjectTitle(): Promise<void> {
  if (props.task.parent_id === null) {
    projectTitle.value = ''
    return
  }
  try {
    const p = await taskApi.fetchTask(props.task.parent_id)
    projectTitle.value = p.title
  } catch {
    projectTitle.value = ''
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

function goProject(): void {
  if (props.task.parent_id !== null) router.push(`/tasks/${props.task.parent_id}`)
}

onMounted(() => {
  void loadEvents()
  void loadProjectTitle()
})

watch(
  () => props.task.id,
  () => {
    void loadEvents()
    void loadProjectTitle()
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
      <!-- 成员任务：可跳转所属项目 -->
      <li v-if="isMember" class="np__meta-row pressable" role="button" tabindex="0" @click="goProject" @keydown.enter="goProject">
        <AppIcon name="list" :size="18" color="var(--color-primary)" />
        <span class="np__meta-label">所属项目</span>
        <span class="np__meta-value ellipsis">{{ projectTitle || `#${task.parent_id}` }}</span>
        <AppIcon name="chevron-right" :size="16" color="#B5B9C4" />
      </li>
    </ul>

    <section class="np__note">
      <h2 class="np__note-title">备注</h2>
      <p class="np__note-text">{{ task.note || '暂无备注' }}</p>
    </section>

    <!-- 智能体执行分区（v0.7.0）：指派 / 状态 / 执行记录 -->
    <AgentExecutionPanel :task="task" @changed="emit('changed')" />

    <!-- 日程安排分区：任务日程作为该任务的执行时段载体，同一任务可有多条 -->
    <section class="np__schedule">
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
