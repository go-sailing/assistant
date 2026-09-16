<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
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
import StateError from '@/components/StateError.vue'
import { useTaskSyncStore } from '@/stores/taskSync'
import { useEventSyncStore } from '@/stores/eventSync'
import { useToastStore } from '@/stores/toast'
import { dueTone, formatEventRange, formatFull, formatShort, overdueDays } from '@/utils/time'

const route = useRoute()
const router = useRouter()
const toast = useToastStore()
const taskSync = useTaskSyncStore()
const eventSync = useEventSyncStore()

const task = ref<Task | null>(null)
const events = ref<CalendarEvent[]>([])
const loading = ref(true)
const error = ref('')
const actionLoading = ref(false)
const sheetVisible = ref(false)
const cascadeVisible = ref(false)

const taskId = computed(() => String(route.params.id))
const fromChat = computed(() => route.query.from === 'chat')
const completed = computed(() => task.value?.status === 'completed')
const overdue = computed(() => (task.value ? dueTone(task.value) === 'danger' : false))
const overdueText = computed(() => {
  if (!task.value || !overdue.value) return ''
  return `已逾期 ${overdueDays(task.value.due_at)} 天`
})

async function load(): Promise<void> {
  loading.value = true
  error.value = ''
  try {
    const [t, evs] = await Promise.all([
      taskApi.fetchTask(taskId.value),
      // 排期列表失败不阻塞任务详情展示
      eventApi.fetchTaskEvents(taskId.value).catch(() => [] as CalendarEvent[]),
    ])
    task.value = t
    events.value = evs
  } catch (e) {
    task.value = null
    events.value = []
    error.value = errorText(e)
  } finally {
    loading.value = false
  }
}

async function toggleStatus(): Promise<void> {
  const t = task.value
  if (!t || actionLoading.value) return
  actionLoading.value = true
  try {
    task.value = t.status === 'completed' ? await taskApi.uncompleteTask(t.id) : await taskApi.completeTask(t.id)
    taskSync.markDirty()
    toast.show(task.value.status === 'completed' ? '已标记完成' : '已恢复未完成')
  } catch (e) {
    toast.show(errorText(e))
  } finally {
    actionLoading.value = false
  }
}

/**
 * 删除任务：有排期时先弹出级联告知（与对话侧文案一致），
 * 确认文案必须明示将同时删除 N 条日程安排。
 */
function askDelete(): void {
  if (events.value.length > 0) {
    cascadeVisible.value = true
    return
  }
  sheetVisible.value = true
}

async function remove(): Promise<void> {
  const t = task.value
  if (!t) return
  sheetVisible.value = false
  cascadeVisible.value = false
  try {
    const res = await taskApi.deleteTask(t.id)
    taskSync.markDirty()
    eventSync.markDirty()
    const cascaded = res.deleted_event_count ?? 0
    toast.show(cascaded > 0 ? `已删除任务及其 ${cascaded} 条日程安排` : '已删除')
    router.replace('/tasks')
  } catch (e) {
    toast.show(errorText(e))
  }
}

/** 为任务安排执行时段：带入任务并锁定类型 */
function planEvent(): void {
  router.push(`/calendar/new?event_type=task&task_id=${taskId.value}&from=task`)
}

function openEvent(ev: CalendarEvent): void {
  router.push(`/calendar/${ev.id}`)
}

onMounted(load)
</script>

<template>
  <div class="page detail">
    <header class="detail__head">
      <button class="detail__back pressable" aria-label="返回" @click="router.back()">
        ‹
        <span v-if="fromChat" class="detail__back-text">返回对话</span>
      </button>
      <span class="detail__head-title">任务详情</span>
      <button
        v-if="task"
        class="detail__edit pressable"
        @click="router.push(`/tasks/${taskId}/edit`)"
      >
        编辑
      </button>
      <span v-else class="detail__edit" />
    </header>

    <div class="page-body detail__body">
      <p v-if="loading" class="detail__loading">加载中…</p>

      <StateError v-else-if="error" :text="error" @retry="load" />

      <template v-else-if="task">
        <section class="detail__main">
          <AppCheckbox
            :checked="completed"
            :size="24"
            :disabled="actionLoading"
            :label="completed ? '标记为未完成' : '标记为已完成'"
            @toggle="toggleStatus"
          />
          <h1 class="detail__title" :class="{ 'detail__title--done': completed }">{{ task.title }}</h1>
        </section>

        <ul class="detail__meta">
          <li class="detail__meta-row">
            <PriorityFlag :priority="task.priority" with-text />
          </li>
          <li class="detail__meta-row">
            <AppIcon name="folder" :size="18" color="#6B7080" />
            <span>{{ task.list_name || '默认清单' }}</span>
          </li>
          <li class="detail__meta-row">
            <AppIcon name="clock" :size="18" color="#6B7080" />
            <span :class="{ 'detail__overdue': overdue }">{{ formatFull(task.due_at) }}</span>
            <span v-if="overdueText" class="detail__overdue-hint">{{ overdueText }}</span>
          </li>
        </ul>

        <section class="detail__note">
          <h2 class="detail__note-title">备注</h2>
          <p class="detail__note-text">{{ task.note || '暂无备注' }}</p>
        </section>

        <!-- 日程安排分区：任务日程作为该任务的执行时段载体，同一任务可有多条 -->
        <section class="detail__schedule">
          <div class="detail__schedule-head">
            <h2 class="detail__schedule-title">
              日程安排<span v-if="events.length" class="detail__schedule-count">（{{ events.length }}）</span>
            </h2>
            <button class="detail__schedule-add pressable" @click="planEvent">
              <AppIcon name="plus" :size="14" color="#3D5AFE" />
              安排日程
            </button>
          </div>
          <ul v-if="events.length" class="detail__schedule-list">
            <li
              v-for="ev in events"
              :key="String(ev.id)"
              class="detail__schedule-item pressable"
              role="button"
              tabindex="0"
              :aria-label="`查看日程安排 ${ev.title}`"
              @click="openEvent(ev)"
              @keydown.enter="openEvent(ev)"
            >
              <AppIcon name="link" :size="16" color="#7C4DFF" />
              <span class="detail__schedule-time">{{ formatEventRange(ev) }}</span>
              <span class="detail__schedule-place ellipsis">
                {{ ev.location || formatShort(ev.start_at) }}
              </span>
              <AppIcon name="chevron-right" :size="16" color="#B5B9C4" />
            </li>
          </ul>
          <p v-else class="detail__schedule-empty">还没有安排执行时段</p>
        </section>

        <section class="detail__times">
          <p>创建于 {{ formatShort(task.created_at) }}</p>
          <p v-if="task.completed_at">完成于 {{ formatShort(task.completed_at) }}</p>
        </section>

        <div class="detail__actions">
          <AppButton type="primary" :loading="actionLoading" @click="toggleStatus">
            {{ completed ? '取消完成' : '标记已完成' }}
          </AppButton>
          <button class="detail__delete pressable" @click="askDelete">删除</button>
        </div>
      </template>
    </div>

    <AppActionSheet
      :visible="sheetVisible"
      title="删除后不可恢复"
      :items="[{ label: '删除任务', value: 'delete', danger: true }]"
      @select="remove"
      @cancel="sheetVisible = false"
    />

    <!-- 有排期时的级联删除告知：条数由排期列表真实条数计算 -->
    <AppModal
      :visible="cascadeVisible"
      title="删除任务？"
      :text="`将同时删除该任务的 ${events.length} 条日程安排，且不可恢复。`"
      confirm-text="删除"
      danger
      @confirm="remove"
      @cancel="cascadeVisible = false"
    />
  </div>
</template>

<style scoped>
.detail__head {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  height: calc(var(--navbar-height) + var(--safe-top));
  padding: var(--safe-top) var(--sp-4) 0;
  background: var(--bg-card);
  border-bottom: 1px solid var(--border-color);
}
.detail__back {
  display: flex;
  align-items: center;
  gap: 2px;
  min-width: 44px;
  min-height: 44px;
  margin-left: -12px;
  font-size: 26px;
  color: var(--color-primary);
}
.detail__back-text {
  font-size: var(--font-body-m);
  white-space: nowrap;
}
.detail__head-title {
  flex: 1;
  text-align: center;
  font-size: var(--font-body-m);
  color: var(--text-secondary);
}
.detail__edit {
  min-width: 44px;
  min-height: 44px;
  text-align: right;
  font-size: var(--font-body-l);
  color: var(--color-primary);
}
.detail__body {
  padding-bottom: calc(var(--sp-6) + var(--safe-bottom));
}
.detail__loading {
  padding: var(--sp-6);
  text-align: center;
  color: var(--text-secondary);
  font-size: var(--font-body-m);
}
.detail__main {
  display: flex;
  align-items: flex-start;
  gap: var(--sp-3);
  padding: var(--sp-4);
  background: var(--bg-card);
}
.detail__title {
  flex: 1;
  font-size: 20px;
  line-height: 28px;
  font-weight: 600;
  word-break: break-word;
}
.detail__title--done {
  color: var(--text-disabled);
  text-decoration: line-through;
}
.detail__meta {
  margin-top: var(--sp-2);
  background: var(--bg-card);
}
.detail__meta-row {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  min-height: 48px;
  padding: 0 var(--sp-4);
  border-bottom: 1px solid var(--border-color);
  font-size: var(--font-body-m);
  color: var(--text-primary);
}
.detail__overdue {
  color: var(--color-danger);
}
.detail__overdue-hint {
  font-size: var(--font-caption);
  color: var(--color-danger);
}
.detail__note {
  margin-top: var(--sp-2);
  padding: var(--sp-4);
  background: var(--bg-card);
}
.detail__note-title {
  font-size: var(--font-caption);
  color: var(--text-secondary);
  margin-bottom: var(--sp-2);
}
.detail__note-text {
  font-size: var(--font-body-m);
  line-height: var(--font-body-m-lh);
  white-space: pre-wrap;
  word-break: break-word;
}
.detail__schedule {
  margin-top: var(--sp-2);
  padding: var(--sp-4);
  background: var(--bg-card);
}
.detail__schedule-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--sp-2);
}
.detail__schedule-title {
  font-size: var(--font-caption);
  color: var(--text-secondary);
}
.detail__schedule-count {
  color: var(--text-secondary);
}
.detail__schedule-add {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  min-height: 44px;
  margin: -10px -8px -10px 0;
  padding: 0 var(--sp-2);
  font-size: var(--font-body-m);
  color: var(--color-primary);
}
.detail__schedule-list {
  margin-top: var(--sp-1);
  display: flex;
  flex-direction: column;
}
.detail__schedule-item {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  min-height: 48px;
  border-bottom: 1px solid var(--border-color);
}
.detail__schedule-item:last-child {
  border-bottom: none;
}
.detail__schedule-time {
  font-size: var(--font-body-m);
  font-variant-numeric: tabular-nums;
  color: var(--text-primary);
  flex-shrink: 0;
}
.detail__schedule-place {
  flex: 1;
  min-width: 0;
  font-size: var(--font-caption);
  color: var(--text-secondary);
}
.detail__schedule-empty {
  margin-top: var(--sp-2);
  font-size: var(--font-caption);
  color: var(--text-disabled);
}
.detail__times {
  margin-top: var(--sp-2);
  padding: var(--sp-4);
  background: var(--bg-card);
  display: flex;
  flex-direction: column;
  gap: var(--sp-1);
  font-size: var(--font-caption);
  color: var(--text-secondary);
}
.detail__actions {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--sp-2);
  padding: var(--sp-6) var(--sp-4) 0;
}
.detail__delete {
  min-height: 44px;
  padding: 0 var(--sp-4);
  font-size: var(--font-body-m);
  color: var(--color-danger);
}
</style>