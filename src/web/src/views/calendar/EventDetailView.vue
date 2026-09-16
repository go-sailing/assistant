<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import * as eventApi from '@/api/events'
import * as taskApi from '@/api/tasks'
import { errorText } from '@/api/client'
import type { CalendarEvent } from '@/types'
import { formatDue, formatFull, formatShort } from '@/utils/time'
import AppActionSheet from '@/components/AppActionSheet.vue'
import AppButton from '@/components/AppButton.vue'
import AppCheckbox from '@/components/AppCheckbox.vue'
import AppIcon from '@/components/AppIcon.vue'
import PriorityFlag from '@/components/PriorityFlag.vue'
import StateError from '@/components/StateError.vue'
import EventTypeTag from '@/components/calendar/EventTypeTag.vue'
import { useEventSyncStore } from '@/stores/eventSync'
import { useToastStore } from '@/stores/toast'

const route = useRoute()
const router = useRouter()
const toast = useToastStore()
const eventSync = useEventSyncStore()

const event = ref<CalendarEvent | null>(null)
const loading = ref(true)
const error = ref('')
const actionLoading = ref(false)
const sheetVisible = ref(false)

const eventId = computed(() => String(route.params.id))
const fromChat = computed(() => route.query.from === 'chat')
const isTaskEvent = computed(() => event.value?.event_type === 'task')
const completed = computed(() => event.value?.task?.status === 'completed')
const startText = computed(() => (event.value?.all_day ? '全天' : formatFull(event.value?.start_at)))
const endText = computed(() => (event.value?.all_day ? '' : formatFull(event.value?.end_at)))
const sourceText = computed(() => (event.value?.source === 'chat' ? '对话创建' : '手动创建'))
const conflicts = computed(() => event.value?.conflicts ?? [])
const conflictText = computed(() => {
  const first = conflicts.value[0]
  if (!first) return ''
  const rest = conflicts.value.length > 1 ? `等 ${conflicts.value.length} 项` : ''
  return `与『${first.title}』时间重叠${rest}`
})
const sheetTitle = computed(() =>
  isTaskEvent.value ? '确定删除该日程安排？关联任务不会被删除' : '删除后不可恢复'
)
const sheetItemLabel = computed(() => (isTaskEvent.value ? '删除此安排' : '删除日程'))

async function load(): Promise<void> {
  loading.value = true
  error.value = ''
  try {
    event.value = await eventApi.fetchEvent(eventId.value)
  } catch (e) {
    event.value = null
    error.value = errorText(e)
  } finally {
    loading.value = false
  }
}

function goBack(): void {
  if (window.history.state && window.history.state.back) router.back()
  else router.replace('/calendar')
}

/** 任务日程的完成状态即关联任务的状态，两者必须一致 */
async function toggleStatus(): Promise<void> {
  const ev = event.value
  if (!ev || !ev.task || actionLoading.value) return
  const wasCompleted = ev.task.status === 'completed'
  actionLoading.value = true
  try {
    const updated = wasCompleted
      ? await taskApi.uncompleteTask(ev.task.id)
      : await taskApi.completeTask(ev.task.id)
    const cur = event.value
    if (cur && cur.task) {
      event.value = {
        ...cur,
        task: { ...cur.task, status: updated.status, completed_at: updated.completed_at },
      }
    }
    toast.show(wasCompleted ? '已恢复未完成' : '已标记完成')
  } catch (e) {
    toast.show(errorText(e))
  } finally {
    actionLoading.value = false
  }
}

function goTask(): void {
  const t = event.value?.task
  if (t) router.push(`/tasks/${t.id}`)
}

async function remove(): Promise<void> {
  const ev = event.value
  sheetVisible.value = false
  if (!ev) return
  try {
    await eventApi.deleteEvent(ev.id)
    eventSync.markDirty()
    toast.show('已删除')
    router.replace('/calendar')
  } catch (e) {
    toast.show(errorText(e))
  }
}

onMounted(load)
</script>

<template>
  <div class="page detail">
    <header class="detail__head">
      <button class="detail__back pressable" aria-label="返回" @click="goBack">
        ‹
        <span v-if="fromChat" class="detail__back-text">返回对话</span>
      </button>
      <span class="detail__head-title">日程详情</span>
      <span class="detail__placeholder" />
    </header>

    <div class="page-body detail__body">
      <p v-if="loading" class="detail__loading">加载中…</p>

      <StateError v-else-if="error" :text="error" @retry="load" />

      <template v-else-if="event">
        <p v-if="conflictText" class="detail__conflict">
          <AppIcon name="conflict" :size="16" color="var(--color-warning)" />
          {{ conflictText }}
        </p>

        <!-- 任务日程：标题即任务标题，此处不可编辑 -->
        <section class="detail__main">
          <AppCheckbox
            v-if="isTaskEvent"
            :checked="completed"
            :size="24"
            :disabled="actionLoading"
            :label="completed ? '取消完成任务' : '标记任务已完成'"
            @toggle="toggleStatus"
          />
          <div class="detail__main-text">
            <h1 class="detail__title" :class="{ 'detail__title--done': completed }">
              <AppIcon
                v-if="isTaskEvent"
                name="link"
                :size="16"
                color="var(--color-link)"
                class="detail__title-icon"
              />
              {{ event.title }}
            </h1>
            <div class="detail__tags">
              <EventTypeTag :type="event.event_type" />
              <span v-if="isTaskEvent && event.task" class="detail__list">
                <AppIcon name="folder" :size="14" color="#6B7080" />
                {{ event.task.list_name || '默认清单' }}
              </span>
            </div>
          </div>
        </section>

        <ul class="detail__meta">
          <li class="detail__meta-row">
            <AppIcon name="clock" :size="18" color="#6B7080" />
            <span>{{ startText }}</span>
            <span v-if="endText"> – {{ endText }}</span>
          </li>
          <li v-if="event.location" class="detail__meta-row">
            <AppIcon name="pin" :size="18" color="#6B7080" />
            <span>{{ event.location }}</span>
          </li>
        </ul>

        <button
          v-if="isTaskEvent && event.task"
          class="detail__task pressable"
          @click="goTask"
        >
          <AppIcon name="link" :size="18" color="var(--color-link)" />
          <span class="detail__task-main">
            <span class="detail__task-title">查看关联任务</span>
            <span class="detail__task-sub">
              <PriorityFlag :priority="event.task.priority" />
              <span class="ellipsis">{{ formatDue(event.task.due_at) }}</span>
            </span>
          </span>
          <AppIcon name="chevron-right" :size="18" color="#B5B9C4" />
        </button>

        <section class="detail__note">
          <h2 class="detail__note-title">备注</h2>
          <p class="detail__note-text">{{ event.note || '暂无备注' }}</p>
        </section>

        <section class="detail__times">
          <p>创建于 {{ formatShort(event.created_at) }}</p>
          <p>来源：{{ sourceText }}</p>
        </section>

        <div class="detail__actions">
          <template v-if="isTaskEvent">
            <AppButton type="primary" :loading="actionLoading" @click="toggleStatus">
              {{ completed ? '取消完成任务' : '标记任务已完成' }}
            </AppButton>
            <button class="detail__delete pressable" @click="sheetVisible = true">删除此安排</button>
            <p class="detail__hint">只取消这个时间安排，不会删除任务</p>
          </template>
          <template v-else>
            <AppButton type="primary" @click="router.push(`/calendar/${eventId}/edit`)">
              编辑日程
            </AppButton>
            <button class="detail__delete pressable" @click="sheetVisible = true">删除日程</button>
          </template>
        </div>
      </template>
    </div>

    <AppActionSheet
      :visible="sheetVisible"
      :title="sheetTitle"
      :items="[{ label: sheetItemLabel, value: 'delete', danger: true }]"
      @select="remove"
      @cancel="sheetVisible = false"
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
.detail__placeholder {
  min-width: 44px;
}
.detail__body {
  padding-bottom: calc(var(--sp-6) + var(--safe-bottom));
}
.detail__loading {
  padding: var(--sp-6);
  text-align: center;
  font-size: var(--font-body-m);
  color: var(--text-secondary);
}
/* 冲突提示：图标 + 文字 + 橙色，三重编码 */
.detail__conflict {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  margin: var(--sp-3) var(--sp-4) 0;
  padding: var(--sp-3);
  background: var(--color-conflict-bg);
  border-radius: var(--radius-card);
  color: var(--color-conflict-text);
  font-size: var(--font-caption);
  line-height: var(--font-caption-lh);
}
.detail__main {
  display: flex;
  align-items: flex-start;
  gap: var(--sp-3);
  padding: var(--sp-4);
  background: var(--bg-card);
}
.detail__main-text {
  flex: 1;
  min-width: 0;
}
.detail__title {
  font-size: 20px;
  line-height: 28px;
  font-weight: 600;
  word-break: break-word;
}
.detail__title-icon {
  margin-right: 4px;
}
.detail__title--done {
  color: var(--text-disabled);
  text-decoration: line-through;
}
.detail__tags {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  margin-top: var(--sp-2);
  flex-wrap: wrap;
}
.detail__list {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: var(--font-caption);
  color: var(--text-secondary);
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
.detail__task {
  display: flex;
  align-items: center;
  gap: var(--sp-3);
  width: 100%;
  min-height: 64px;
  margin-top: var(--sp-2);
  padding: var(--sp-3) var(--sp-4);
  background: var(--bg-card);
  text-align: left;
}
.detail__task-main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.detail__task-title {
  font-size: var(--font-body-m);
  color: var(--text-primary);
}
.detail__task-sub {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: var(--font-caption);
  color: var(--text-secondary);
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
.detail__hint {
  font-size: var(--font-caption);
  color: var(--text-secondary);
}
</style>