<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import * as eventApi from '@/api/events'
import * as taskApi from '@/api/tasks'
import { errorText } from '@/api/client'
import type { CalendarEvent, EventScope, Occurrence } from '@/types'
import { formatDue, formatFull, formatShort } from '@/utils/time'
import AppButton from '@/components/AppButton.vue'
import AppCheckbox from '@/components/AppCheckbox.vue'
import AppIcon from '@/components/AppIcon.vue'
import AppModal from '@/components/AppModal.vue'
import PriorityFlag from '@/components/PriorityFlag.vue'
import StateError from '@/components/StateError.vue'
import EventTypeTag from '@/components/calendar/EventTypeTag.vue'
import RecurrenceBadge from '@/components/calendar/RecurrenceBadge.vue'
import ScopeSheet from '@/components/calendar/ScopeSheet.vue'
import SeriesHeaderCard from '@/components/calendar/SeriesHeaderCard.vue'
import { useEventSyncStore } from '@/stores/eventSync'
import { useSettingsStore } from '@/stores/settings'
import { useToastStore } from '@/stores/toast'

const route = useRoute()
const router = useRouter()
const toast = useToastStore()
const eventSync = useEventSyncStore()
const settings = useSettingsStore()

const detail = ref<CalendarEvent | Occurrence | null>(null)
const loading = ref(true)
const error = ref('')
const actionLoading = ref(false)
/** 单次日程的删除确认由 AppActionSheet 承担 */
const deleteVisible = ref(false)
/** 循环实例的作用域选择（编辑版/删除版） */
const scopeVisible = ref(false)
const scopeMode = ref<'edit' | 'delete'>('edit')
/** 「删除整条系列」的二次确认 */
const seriesConfirmVisible = ref(false)

const eventId = computed(() => String(route.params.id))
const occurrenceKey = computed(() =>
  typeof route.query.occurrence_key === 'string' ? route.query.occurrence_key : ''
)
/** 实例视角（带 occurrence_key）与单次视角的分流 */
const isOccurrence = computed(() => !!occurrenceKey.value)
const overrideState = computed(() => (detail.value as Occurrence | null)?.override_state)
const isCancelled = computed(() => isOccurrence.value && overrideState.value === 'cancelled')
const isModified = computed(() => isOccurrence.value && overrideState.value === 'modified')
/** 实例所属系列 id（实例 DTO 的 id 即系列 id，这里做兼容取值） */
const seriesId = computed(() => String((detail.value as Occurrence | null)?.series_id ?? eventId.value))
const seriesSummary = computed(() => detail.value?.recurrence_summary || '')

const fromChat = computed(() => route.query.from === 'chat')
const isTaskEvent = computed(() => detail.value?.event_type === 'task')
const completed = computed(() => detail.value?.task?.status === 'completed')
const startText = computed(() => (detail.value?.all_day ? '全天' : formatFull(detail.value?.start_at)))
const endText = computed(() => (detail.value?.all_day ? '' : formatFull(detail.value?.end_at)))
const sourceText = computed(() => (detail.value?.source === 'chat' ? '对话创建' : '手动创建'))
const conflicts = computed(() => detail.value?.conflicts ?? [])
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
const headTitle = computed(() => (isOccurrence.value ? '本次安排' : '日程详情'))

/** v0.4.0：日期下方农历一行（如「农历 八月十五 · 中秋节」），受农历开关控制 */
const lunarText = computed(() => {
  const l = detail.value?.lunar
  if (!l || !settings.lunarEnabled) return ''
  const festival = l.festival ? ` · ${l.festival}` : l.term ? ` · ${l.term}` : ''
  return `农历 ${l.month_label}${l.day_label}${festival}`
})

async function load(): Promise<void> {
  loading.value = true
  error.value = ''
  try {
    const ev = await eventApi.fetchEvent(eventId.value, occurrenceKey.value || undefined)
    // 无 occurrence_key 但带规则的系列主记录：统一走系列详情视角
    if (!occurrenceKey.value && ev.recurrence) {
      router.replace({ name: 'event-series', params: { id: eventId.value } })
      return
    }
    detail.value = ev
  } catch (e) {
    detail.value = null
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
  const ev = detail.value
  if (!ev || !ev.task || actionLoading.value) return
  const wasCompleted = ev.task.status === 'completed'
  actionLoading.value = true
  try {
    const updated = wasCompleted
      ? await taskApi.uncompleteTask(ev.task.id)
      : await taskApi.completeTask(ev.task.id)
    const cur = detail.value
    if (cur && cur.task) {
      detail.value = {
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
  const t = detail.value?.task
  if (t) router.push(`/tasks/${t.id}`)
}

function goSeries(): void {
  router.push({ name: 'event-series', params: { id: seriesId.value } })
}

/* ---------------- 单次日程 ---------------- */

async function remove(): Promise<void> {
  const ev = detail.value
  deleteVisible.value = false
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

/* ---------------- 循环实例：作用域动作 ---------------- */

function openScope(mode: 'edit' | 'delete'): void {
  scopeMode.value = mode
  scopeVisible.value = true
}

function goEditForm(scope: EventScope): void {
  const query: Record<string, string> = { scope }
  if (scope !== 'series') query.occurrence_key = occurrenceKey.value
  router.push({ path: `/calendar/${seriesId.value}/edit`, query })
}

/** 所选作用域决定后续动作：编辑进表单，删除走仅取消本次 / 整条二次确认 */
function onScopeSelect(scope: EventScope): void {
  scopeVisible.value = false
  if (scopeMode.value === 'edit') {
    goEditForm(scope)
    return
  }
  if (scope === 'this') {
    void cancelOccurrence()
    return
  }
  seriesConfirmVisible.value = true
}

async function cancelOccurrence(): Promise<void> {
  if (actionLoading.value) return
  actionLoading.value = true
  try {
    await eventApi.deleteEvent(seriesId.value, { scope: 'this', occurrenceKey: occurrenceKey.value })
    eventSync.markDirty()
    toast.show('已取消本次安排，可在系列详情中恢复')
    await load()
  } catch (e) {
    toast.show(errorText(e))
  } finally {
    actionLoading.value = false
  }
}

async function deleteSeries(): Promise<void> {
  seriesConfirmVisible.value = false
  if (actionLoading.value) return
  actionLoading.value = true
  try {
    await eventApi.deleteEvent(seriesId.value, { scope: 'series' })
    eventSync.markDirty()
    toast.show('已删除整条系列')
    router.replace('/calendar')
  } catch (e) {
    toast.show(errorText(e))
  } finally {
    actionLoading.value = false
  }
}

async function restore(): Promise<void> {
  if (actionLoading.value) return
  actionLoading.value = true
  try {
    await eventApi.restoreOccurrence(seriesId.value, occurrenceKey.value)
    eventSync.markDirty()
    toast.show('已恢复本次安排')
    await load()
  } catch (e) {
    toast.show(errorText(e))
  } finally {
    actionLoading.value = false
  }
}

/** 实例视角的编辑必须经过作用域 Sheet（默认项永远是「仅本次」），不做静默整条修改 */
function editThis(): void {
  openScope('edit')
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
      <span class="detail__head-title">{{ headTitle }}</span>
      <button
        v-if="isOccurrence && !isCancelled"
        class="detail__head-action pressable"
        @click="openScope('edit')"
      >
        编辑
      </button>
      <span v-else class="detail__placeholder" />
    </header>

    <div class="page-body detail__body">
      <p v-if="loading" class="detail__loading">加载中…</p>

      <StateError v-else-if="error" :text="error" @retry="load" />

      <template v-else-if="detail">
        <!-- 实例视角：顶部系列条（规则摘要来自服务端，点入系列详情） -->
        <SeriesHeaderCard
          v-if="isOccurrence && seriesSummary"
          :summary="seriesSummary"
          @open="goSeries"
        />

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
            <h1
              class="detail__title"
              :class="{ 'detail__title--done': completed || isCancelled }"
            >
              <AppIcon
                v-if="isTaskEvent"
                name="link"
                :size="16"
                color="var(--color-link)"
                class="detail__title-icon"
              />
              <AppIcon
                v-else-if="isOccurrence"
                name="repeat"
                :size="16"
                color="var(--color-primary)"
                class="detail__title-icon"
              />
              {{ detail.title }}
            </h1>
            <div class="detail__tags">
              <EventTypeTag :type="detail.event_type" />
              <!-- 三态不只靠颜色：已调整 / 已取消均为文字胶囊 -->
              <RecurrenceBadge v-if="isModified" kind="modified" />
              <RecurrenceBadge v-if="isCancelled" kind="cancelled" />
              <span v-if="isTaskEvent && detail.task" class="detail__list">
                <AppIcon name="folder" :size="14" color="#6B7080" />
                {{ detail.task.list_name || '默认清单' }}
              </span>
            </div>
          </div>
        </section>

        <ul class="detail__meta" :class="{ 'detail__meta--cancelled': isCancelled }">
          <li class="detail__meta-row">
            <AppIcon name="clock" :size="18" color="#6B7080" />
            <span>{{ startText }}</span>
            <span v-if="endText"> – {{ endText }}</span>
          </li>
          <!-- 农历对照：受「显示农历」开关控制 -->
          <li v-if="lunarText" class="detail__meta-row detail__meta-row--lunar">
            <AppIcon name="calendar" :size="18" color="#6B7080" />
            <span>{{ lunarText }}</span>
          </li>
          <li v-if="detail.location" class="detail__meta-row">
            <AppIcon name="pin" :size="18" color="#6B7080" />
            <span>{{ detail.location }}</span>
          </li>
        </ul>

        <button
          v-if="isTaskEvent && detail.task"
          class="detail__task pressable"
          @click="goTask"
        >
          <AppIcon name="link" :size="18" color="var(--color-link)" />
          <span class="detail__task-main">
            <span class="detail__task-title">查看关联任务</span>
            <span class="detail__task-sub">
              <PriorityFlag :priority="detail.task.priority" />
              <span class="ellipsis">{{ formatDue(detail.task.due_at) }}</span>
            </span>
          </span>
          <AppIcon name="chevron-right" :size="18" color="#B5B9C4" />
        </button>

        <section class="detail__note">
          <h2 class="detail__note-title">备注</h2>
          <p class="detail__note-text">{{ detail.note || '暂无备注' }}</p>
        </section>

        <section class="detail__times">
          <p>创建于 {{ formatShort(detail.created_at) }}</p>
          <p>来源：{{ sourceText }}</p>
        </section>

        <!-- 循环实例：所有编辑/删除都必须经过作用域选择（默认仅本次） -->
        <div v-if="isOccurrence" class="detail__actions">
          <template v-if="isCancelled">
            <button
              class="detail__restore pressable"
              :disabled="actionLoading"
              @click="restore"
            >
              恢复本次安排
            </button>
            <p class="detail__hint">恢复后该次安排回到原规则时间</p>
          </template>
          <template v-else>
            <AppButton type="primary" :loading="actionLoading" @click="editThis">
              编辑本次安排
            </AppButton>
            <button class="detail__cancel-one pressable" @click="openScope('delete')">
              取消本次安排
            </button>
            <button class="detail__series-link pressable" @click="goEditForm('series')">
              编辑整条系列
            </button>
          </template>
        </div>

        <div v-else class="detail__actions">
          <template v-if="isTaskEvent">
            <AppButton type="primary" :loading="actionLoading" @click="toggleStatus">
              {{ completed ? '取消完成任务' : '标记任务已完成' }}
            </AppButton>
            <button class="detail__delete pressable" @click="deleteVisible = true">删除此安排</button>
            <p class="detail__hint">只取消这个时间安排，不会删除任务</p>
          </template>
          <template v-else>
            <AppButton type="primary" @click="router.push(`/calendar/${eventId}/edit`)">
              编辑日程
            </AppButton>
            <button class="detail__delete pressable" @click="deleteVisible = true">删除日程</button>
          </template>
        </div>
      </template>
    </div>

    <!-- 循环实例的作用域选择：编辑版 / 删除版（默认永远是「仅本次」） -->
    <ScopeSheet
      :visible="scopeVisible"
      :mode="scopeMode"
      @select="onScopeSelect"
      @cancel="scopeVisible = false"
    />

    <AppModal
      :visible="seriesConfirmVisible"
      title="删除整条系列？"
      text="删除后该循环的全部安排将一并删除，且不可恢复。"
      confirm-text="删除"
      danger
      :loading="actionLoading"
      @confirm="deleteSeries"
      @cancel="seriesConfirmVisible = false"
    />

    <AppModal
      :visible="deleteVisible"
      :title="sheetTitle"
      :confirm-text="sheetItemLabel"
      danger
      @confirm="remove"
      @cancel="deleteVisible = false"
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
.detail__head-action {
  min-width: 44px;
  min-height: 44px;
  text-align: right;
  font-size: var(--font-body-l);
  color: var(--color-primary);
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
/* 已取消：时间同样划线置灰 */
.detail__meta--cancelled .detail__meta-row {
  color: var(--text-disabled);
  text-decoration: line-through;
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
/* 农历对照行：小字 secondary，不抢时间主行 */
.detail__meta-row--lunar {
  min-height: 40px;
  font-size: var(--font-caption);
  color: var(--text-secondary);
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
/* 仅取消本次是 warning 色文字按钮（可恢复，非危险删除） */
.detail__cancel-one {
  min-height: 44px;
  padding: 0 var(--sp-4);
  font-size: var(--font-body-m);
  color: var(--color-conflict-text);
}
.detail__series-link {
  min-height: 44px;
  padding: 0 var(--sp-4);
  font-size: var(--font-caption);
  color: var(--color-primary);
}
/* 恢复本次：success 色描边按钮，与"删除/取消"路径明确区分 */
.detail__restore {
  width: 100%;
  min-height: 44px;
  border: 1px solid var(--color-success);
  border-radius: var(--radius-control);
  background: var(--bg-card);
  color: var(--color-success);
  font-size: var(--font-body-m);
  font-weight: 500;
}
.detail__restore:disabled {
  opacity: 0.5;
}
.detail__hint {
  font-size: var(--font-caption);
  color: var(--text-secondary);
}
</style>
