<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import * as eventApi from '@/api/events'
import * as taskApi from '@/api/tasks'
import { ApiError, errorText } from '@/api/client'
import type {
  ConflictDetail,
  ConflictLevel,
  EventConflictBrief,
  EventPayload,
  EventType,
} from '@/types'
import {
  formatDue,
  fromDateKey,
  fromLocalInputValue,
  nextDay,
  toDateKey,
  toIso,
  toLocalInputValue,
} from '@/utils/time'
import AppButton from '@/components/AppButton.vue'
import AppIcon from '@/components/AppIcon.vue'
import AppInput from '@/components/AppInput.vue'
import SegmentedControl from '@/components/SegmentedControl.vue'
import StateError from '@/components/StateError.vue'
import ConflictSheet from '@/components/calendar/ConflictSheet.vue'
import { useEventSyncStore } from '@/stores/eventSync'
import { useToastStore } from '@/stores/toast'

const route = useRoute()
const router = useRouter()
const toast = useToastStore()
const eventSync = useEventSyncStore()

const editId = computed(() => (route.name === 'event-edit' ? String(route.params.id) : ''))
const typeLocked = computed(() => !!editId.value)

const eventType = ref<EventType>('normal')
const title = ref('')
const taskId = ref('')
const taskTitle = ref('')
/** 由任务详情带入的任务不可再改 */
const taskLocked = ref(false)
const allDay = ref(false)
const startLocal = ref('')
const endLocal = ref('')
const startDay = ref('')
const endDay = ref('')
const location = ref('')
const note = ref('')

const titleError = ref('')
const taskError = ref('')
const formError = ref('')
const saving = ref(false)
const loading = ref(false)
const loadError = ref('')

const conflictVisible = ref(false)
const conflicts = ref<EventConflictBrief[]>([])
const conflictLevel = ref<ConflictLevel>('overlap')

/** 用户手动改过结束时间后，开始时间变化不再自动跟随 */
let endTouched = false

const typeOptions = [
  { label: '普通日程', value: 'normal' },
  { label: '任务日程', value: 'task' },
]

const startIso = computed<string | null>(() =>
  allDay.value ? toIso(fromDateKey(startDay.value)) : fromLocalInputValue(startLocal.value)
)
const endIso = computed<string | null>(() =>
  allDay.value ? toIso(nextDay(fromDateKey(endDay.value))) : fromLocalInputValue(endLocal.value)
)

const startDisplay = computed(() =>
  startLocal.value ? formatDue(fromLocalInputValue(startLocal.value)) : '未选择'
)
const endDisplay = computed(() =>
  endLocal.value ? formatDue(fromLocalInputValue(endLocal.value)) : '未选择'
)
const startDayDisplay = computed(() => formatDayValue(startDay.value))
const endDayDisplay = computed(() => formatDayValue(endDay.value))

/** 开始时间已过只是提醒，不阻止保存（历史日程补录是合理诉求） */
const startWarning = computed(() => {
  const s = startIso.value
  if (!s) return ''
  return new Date(s).getTime() < Date.now() ? '开始时间已过' : ''
})
const endError = computed(() => {
  const s = startIso.value
  const e = endIso.value
  if (!s || !e) return ''
  return new Date(e).getTime() <= new Date(s).getTime() ? '结束时间需晚于开始时间' : ''
})

function formatDayValue(day: string): string {
  if (!day) return '未选择'
  // 走 formatDue 以复用「今天 / 明天 / MM-DD」的既有文案
  return formatDue(fromLocalInputValue(`${day}T00:00`))
}

/** 新建默认开始：带 date 参数用当天 09:00，否则取下一个整点/半点 */
function defaultStart(): Date {
  const queryDate = typeof route.query.date === 'string' ? route.query.date : ''
  if (queryDate) {
    const d = fromDateKey(queryDate)
    d.setHours(9, 0, 0, 0)
    return d
  }
  const d = new Date()
  if (d.getMinutes() < 30) d.setMinutes(30, 0, 0)
  else d.setHours(d.getHours() + 1, 0, 0, 0)
  return d
}

function applyDefaults(): void {
  const s = defaultStart()
  const e = new Date(s.getTime() + 3600000)
  startLocal.value = toLocalInputValue(s.toISOString())
  endLocal.value = toLocalInputValue(e.toISOString())
  startDay.value = toDateKey(s)
  endDay.value = toDateKey(e)
}

function syncAutoEnd(): void {
  const s = new Date(startLocal.value)
  if (Number.isNaN(s.getTime())) return
  endLocal.value = toLocalInputValue(new Date(s.getTime() + 3600000).toISOString())
}

function onStartLocalChange(e: Event): void {
  const v = (e.target as HTMLInputElement).value
  if (!v) return
  startLocal.value = v
  if (!endTouched) syncAutoEnd()
}

function onEndLocalChange(e: Event): void {
  const v = (e.target as HTMLInputElement).value
  if (!v) return
  endTouched = true
  endLocal.value = v
}

function onStartDayChange(e: Event): void {
  const v = (e.target as HTMLInputElement).value
  if (!v) return
  startDay.value = v
  // 全天日程结束日不能早于开始日
  if (!endDay.value || endDay.value < v) endDay.value = v
}

function onEndDayChange(e: Event): void {
  const v = (e.target as HTMLInputElement).value
  if (!v) return
  endDay.value = v
}

function toggleAllDay(): void {
  allDay.value = !allDay.value
  if (allDay.value) {
    startDay.value = startLocal.value.slice(0, 10)
    const endDate = (endLocal.value || startLocal.value).slice(0, 10)
    endDay.value = endDate && endDate > startDay.value ? endDate : startDay.value
  } else {
    const lastDay = endDay.value && endDay.value > startDay.value ? endDay.value : startDay.value
    // 由全天转回定时：给一个 09:00–10:00 的合理初始时段
    startLocal.value = `${startDay.value}T09:00`
    endLocal.value = `${lastDay}T10:00`
    endTouched = true
  }
}

/** 原生日期/时间控件在部分桌面浏览器上需要显式唤起选择面板 */
function openPicker(e: MouseEvent): void {
  const el = e.target as HTMLInputElement | null
  if (!el || el.tagName !== 'INPUT') return
  const picker = el as unknown as { showPicker?: () => void }
  if (typeof picker.showPicker === 'function') {
    try {
      picker.showPicker()
    } catch {
      // 非用户手势等场景忽略
    }
  }
}

function onTypeChange(v: string): void {
  eventType.value = v as EventType
  titleError.value = ''
  taskError.value = ''
}

function initFromQuery(): void {
  if (route.query.event_type === 'task') {
    eventType.value = 'task'
    const qid = typeof route.query.task_id === 'string' ? route.query.task_id : ''
    if (qid) {
      taskId.value = qid
      taskLocked.value = true
      void loadTaskTitle(qid)
    }
  }
  applyDefaults()
}

async function loadTaskTitle(id: string): Promise<void> {
  try {
    const t = await taskApi.fetchTask(id)
    taskTitle.value = t.title
  } catch {
    taskTitle.value = ''
  }
}

interface FormDraft {
  key: string
  eventType: EventType
  title: string
  taskId: string
  taskTitle: string
  allDay: boolean
  startLocal: string
  endLocal: string
  startDay: string
  endDay: string
  location: string
  note: string
  endTouched: boolean
}

/**
 * 去「选择任务」页会卸载本组件（App.vue 以 fullPath 作 key），
 * 用模块级草稿存住已填内容，返回同一条表单路由时恢复，避免用户重填。
 */
let pickerDraft: FormDraft | null = null

function saveDraft(): void {
  pickerDraft = {
    key: route.fullPath,
    eventType: eventType.value,
    title: title.value,
    taskId: taskId.value,
    taskTitle: taskTitle.value,
    allDay: allDay.value,
    startLocal: startLocal.value,
    endLocal: endLocal.value,
    startDay: startDay.value,
    endDay: endDay.value,
    location: location.value,
    note: note.value,
    endTouched,
  }
}

function restoreDraft(): boolean {
  if (!pickerDraft || pickerDraft.key !== route.fullPath) return false
  const d = pickerDraft
  pickerDraft = null
  eventType.value = d.eventType
  title.value = d.title
  taskId.value = d.taskId
  taskTitle.value = d.taskTitle
  allDay.value = d.allDay
  startLocal.value = d.startLocal
  endLocal.value = d.endLocal
  startDay.value = d.startDay
  endDay.value = d.endDay
  location.value = d.location
  note.value = d.note
  endTouched = d.endTouched
  return true
}

function goPickTask(): void {
  if (taskLocked.value) return
  saveDraft()
  router.push('/calendar/tasks')
}

/** 任务选择结果由 TaskPickerView 写入 history.state，取用后清空 */
function consumePickedTask(): void {
  const state = window.history.state as { pickedTask?: { id?: string | number; title?: string } } | null
  const picked = state?.pickedTask
  if (!picked || picked.id === undefined || picked.id === null) return
  window.history.replaceState({ ...(state || {}), pickedTask: null }, '')
  taskId.value = String(picked.id)
  taskTitle.value = picked.title || ''
  taskError.value = ''
}

async function loadEvent(): Promise<void> {
  loading.value = true
  loadError.value = ''
  try {
    const ev = await eventApi.fetchEvent(editId.value)
    eventType.value = ev.event_type
    title.value = ev.title
    taskId.value = ev.task_id ? String(ev.task_id) : ev.task ? String(ev.task.id) : ''
    taskTitle.value = ev.task?.title || ev.title
    allDay.value = ev.all_day
    location.value = ev.location || ''
    note.value = ev.note || ''
    startLocal.value = toLocalInputValue(ev.start_at)
    endLocal.value = toLocalInputValue(ev.end_at)
    const s = new Date(ev.start_at)
    const e = new Date(ev.end_at)
    startDay.value = toDateKey(s)
    // 全天日程 end_at 是次日零点（右开区间），回退 1ms 得到包含式的结束日
    const last = new Date(e.getTime() - 1)
    endDay.value = toDateKey(last.getTime() >= s.getTime() ? last : s)
    endTouched = true
  } catch (e) {
    loadError.value = errorText(e)
  } finally {
    loading.value = false
  }
}

function buildPayload(confirmConflict: boolean): EventPayload {
  const payload: EventPayload = {
    all_day: allDay.value,
    start_at: startIso.value as string,
    end_at: endIso.value as string,
    location: location.value.trim() || null,
    note: note.value.trim() || null,
  }
  // 编辑时不下发 event_type/task_id：类型与关联创建后不可变更，服务端只接受创建时指定
  if (!editId.value) {
    payload.event_type = eventType.value
    if (eventType.value === 'task') {
      payload.task_id = taskId.value
      // 任务日程的标题即任务标题，前端不改写
    }
  }
  if (eventType.value === 'normal') payload.title = title.value.trim()
  if (confirmConflict) payload.confirm_conflict = true
  return payload
}

function validate(): boolean {
  let ok = true
  if (eventType.value === 'normal' && !title.value.trim()) {
    titleError.value = '请输入日程标题'
    ok = false
  }
  if (eventType.value === 'task' && !taskId.value) {
    taskError.value = '请选择关联任务'
    ok = false
  }
  if (!startIso.value || !endIso.value || endError.value) ok = false
  return ok
}

function goBackAfterSave(): void {
  if (window.history.state && window.history.state.back) router.back()
  else router.replace('/calendar')
}

async function submit(confirmConflict = false): Promise<void> {
  if (saving.value) return
  formError.value = ''
  if (!validate()) return
  saving.value = true
  try {
    const payload = buildPayload(confirmConflict)
    if (editId.value) await eventApi.updateEvent(editId.value, payload)
    else await eventApi.createEvent(payload)
    pickerDraft = null
    conflictVisible.value = false
    eventSync.markDirty()
    toast.show('已保存')
    goBackAfterSave()
  } catch (e) {
    if (e instanceof ApiError && e.code === 4009) {
      // 冲突不是错误：把后端返回的重叠明细交给用户决定
      const detail = (e.details || {}) as Partial<ConflictDetail>
      conflicts.value = detail.conflicts || []
      conflictLevel.value = detail.conflict_level || 'overlap'
      conflictVisible.value = true
    } else {
      formError.value = errorText(e)
    }
  } finally {
    saving.value = false
  }
}

function cancel(): void {
  pickerDraft = null
  goBackAfterSave()
}

onMounted(async () => {
  if (editId.value) await loadEvent()
  // 草稿优先于接口初始值（从任务选择页返回的场景）
  if (!restoreDraft() && !editId.value) initFromQuery()
  consumePickedTask()
})

// 若上层后续启用 keep-alive，返回本页时仍需消费任务选择结果
watch(
  () => route.fullPath,
  () => consumePickedTask()
)
</script>

<template>
  <div class="page form">
    <header class="form__head">
      <button class="form__cancel pressable" @click="cancel">取消</button>
      <span class="form__title">{{ editId ? '编辑日程' : '新建日程' }}</span>
      <span class="form__placeholder" />
    </header>

    <div class="page-body form__body">
      <p v-if="loading" class="form__loading">加载中…</p>

      <StateError v-else-if="loadError" :text="loadError" @retry="loadEvent" />

      <template v-else>
        <p v-if="formError" class="form__alert">{{ formError }}</p>

        <section class="form__group form__group--plain">
          <div class="form__type" :class="{ 'form__type--locked': typeLocked }">
            <SegmentedControl
              :model-value="eventType"
              :options="typeOptions"
              @update:model-value="onTypeChange"
            />
          </div>
          <p v-if="typeLocked" class="form__type-hint">日程类型创建后不可更改</p>
        </section>

        <section v-if="eventType === 'normal'" class="form__group">
          <AppInput
            v-model="title"
            label="标题 *"
            placeholder="请输入日程标题"
            :maxlength="100"
            autofocus
            :error="titleError"
            @update:model-value="titleError = ''"
          />
        </section>

        <section v-else class="form__group form__group--rows">
          <button
            class="form__row pressable"
            :disabled="taskLocked"
            @click="goPickTask"
          >
            <AppIcon name="link" :size="18" color="#6B7080" />
            <span class="form__row-label">关联任务 *</span>
            <span class="form__row-value" :class="{ 'form__row-value--empty': !taskTitle }">
              {{ taskTitle || '请选择任务' }}
            </span>
            <AppIcon v-if="!taskLocked" name="chevron-right" :size="18" color="#B5B9C4" />
          </button>
          <p v-if="taskLocked" class="form__hint">已由当前任务带入</p>
          <p v-if="taskError" class="form__hint form__hint--error">{{ taskError }}</p>
        </section>

        <section class="form__group form__group--rows">
          <div class="form__row form__row--switch">
            <AppIcon name="allday" :size="20" color="#6B7080" />
            <span class="form__row-label">全天</span>
            <button
              class="form__switch"
              role="switch"
              :aria-checked="allDay"
              aria-label="全天日程"
              @click="toggleAllDay"
            >
              <span class="form__track">
                <span class="form__knob" />
              </span>
            </button>
          </div>

          <div class="form__field">
            <label class="form__row" @click="openPicker">
              <span class="form__row-label">{{ allDay ? '开始日期' : '开始' }}</span>
              <span class="form__row-value">{{ allDay ? startDayDisplay : startDisplay }}</span>
              <AppIcon name="chevron-right" :size="18" color="#B5B9C4" />
              <input
                v-if="allDay"
                class="form__native"
                type="date"
                aria-label="开始日期"
                :value="startDay"
                @change="onStartDayChange"
              />
              <input
                v-else
                class="form__native"
                type="datetime-local"
                aria-label="开始时间"
                :value="startLocal"
                @change="onStartLocalChange"
              />
            </label>
            <p v-if="startWarning" class="form__hint form__hint--warning">{{ startWarning }}</p>
          </div>

          <div class="form__field">
            <label class="form__row" @click="openPicker">
              <span class="form__row-label">{{ allDay ? '结束日期' : '结束' }}</span>
              <span class="form__row-value">{{ allDay ? endDayDisplay : endDisplay }}</span>
              <AppIcon name="chevron-right" :size="18" color="#B5B9C4" />
              <input
                v-if="allDay"
                class="form__native"
                type="date"
                aria-label="结束日期"
                :value="endDay"
                @change="onEndDayChange"
              />
              <input
                v-else
                class="form__native"
                type="datetime-local"
                aria-label="结束时间"
                :value="endLocal"
                @change="onEndLocalChange"
              />
            </label>
            <p v-if="endError" class="form__hint form__hint--error">{{ endError }}</p>
          </div>
        </section>

        <section class="form__group form__stack">
          <AppInput v-model="location" label="地点" placeholder="添加地点" :maxlength="200" />
          <AppInput
            v-model="note"
            label="备注"
            type="textarea"
            placeholder="补充说明…"
            :maxlength="2000"
          />
        </section>

        <div class="form__submit">
          <AppButton type="primary" :loading="saving" @click="submit(false)">保 存</AppButton>
        </div>
      </template>
    </div>

    <ConflictSheet
      :visible="conflictVisible"
      :conflicts="conflicts"
      :level="conflictLevel"
      :saving="saving"
      @cancel="conflictVisible = false"
      @confirm="submit(true)"
    />
  </div>
</template>

<style scoped>
.form__head {
  display: flex;
  align-items: center;
  height: calc(var(--navbar-height) + var(--safe-top));
  padding: var(--safe-top) var(--sp-4) 0;
  background: var(--bg-card);
  border-bottom: 1px solid var(--border-color);
}
.form__cancel {
  min-width: 44px;
  min-height: 44px;
  text-align: left;
  font-size: var(--font-body-l);
  color: var(--text-secondary);
}
.form__title {
  flex: 1;
  text-align: center;
  font-size: var(--font-heading-m);
  font-weight: 600;
}
.form__placeholder {
  min-width: 44px;
}
.form__body {
  padding-bottom: calc(var(--sp-6) + var(--safe-bottom));
}
.form__loading {
  padding: var(--sp-6);
  text-align: center;
  font-size: var(--font-body-m);
  color: var(--text-secondary);
}
.form__alert {
  margin: var(--sp-3) var(--sp-4) 0;
  padding: var(--sp-3);
  /* 危险红在浅橙底上仅 4.47:1 不达 AA，改用白底 + 危险色描边（4.77:1） */
  background: var(--bg-card);
  border: 1px solid rgba(217, 48, 37, 0.32);
  border-radius: var(--radius-control);
  color: var(--color-danger);
  font-size: var(--font-caption);
}
.form__group {
  margin-top: var(--sp-3);
  padding: var(--sp-4);
  background: var(--bg-card);
}
.form__group--plain {
  padding: 0;
  overflow: hidden;
}
.form__group--rows {
  padding: 0;
  overflow: hidden;
}
.form__stack {
  display: flex;
  flex-direction: column;
  gap: var(--sp-4);
}
/* 类型创建后不可更改：只读展示 */
.form__type--locked {
  pointer-events: none;
  opacity: 0.5;
}
.form__type-hint {
  padding: var(--sp-2) var(--sp-4);
  font-size: var(--font-caption);
  color: var(--text-secondary);
}
.form__row {
  position: relative;
  display: flex;
  align-items: center;
  gap: var(--sp-3);
  width: 100%;
  min-height: 52px;
  padding: 0 var(--sp-4);
  background: var(--bg-card);
  text-align: left;
}
.form__row:disabled {
  opacity: 0.6;
}
.form__row--switch {
  border-bottom: 1px solid var(--border-color);
}
.form__row-label {
  flex: 1;
  font-size: var(--font-body-l);
}
.form__row-value {
  font-size: var(--font-body-m);
  color: var(--text-primary);
}
.form__row-value--empty {
  color: var(--text-secondary);
}
/* 透明原生控件盖住整行：点击行即唤起系统选择器 */
.form__native {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  opacity: 0;
  border: none;
  background: transparent;
}
.form__field + .form__field {
  border-top: 1px solid var(--border-color);
}
.form__hint {
  padding: 0 var(--sp-4) var(--sp-2);
  font-size: var(--font-caption);
  color: var(--text-secondary);
}
.form__hint--error {
  color: var(--color-danger);
}
.form__hint--warning {
  color: var(--color-conflict-text);
}
.form__switch {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  width: 48px;
  height: 44px;
  flex-shrink: 0;
}
.form__track {
  position: relative;
  display: block;
  width: 44px;
  height: 26px;
  border-radius: 13px;
  background: var(--text-disabled);
  transition: background-color var(--dur-fast) ease;
}
.form__knob {
  position: absolute;
  top: 3px;
  left: 3px;
  width: 20px;
  height: 20px;
  border-radius: 50%;
  background: #fff;
  transition: transform var(--dur-fast) ease;
}
.form__switch[aria-checked='true'] .form__track {
  background: var(--color-primary);
}
.form__switch[aria-checked='true'] .form__knob {
  transform: translateX(18px);
}
.form__submit {
  padding: var(--sp-6) var(--sp-4) 0;
}
</style>