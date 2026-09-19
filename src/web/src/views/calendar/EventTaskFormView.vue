<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import * as eventApi from '@/api/events'
import * as taskApi from '@/api/tasks'
import { ApiError, errorText } from '@/api/client'
import type { ConflictDetail, ConflictLevel, EventConflictBrief, EventPayload } from '@/types'
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
import StateError from '@/components/StateError.vue'
import ConflictSheet from '@/components/calendar/ConflictSheet.vue'
import { useEventSyncStore } from '@/stores/eventSync'
import { useToastStore } from '@/stores/toast'

/**
 * 任务日程表单（v0.6.0，FRM-01）：
 * 关联任务由 query/编辑对象带入并**锁定不可改**；标题恒为任务标题（只读）；
 * 不渲染重复行（任务日程禁循环 4016）；不渲染公历/农历切换。
 */
const route = useRoute()
const router = useRouter()
const toast = useToastStore()
const eventSync = useEventSyncStore()

const editId = computed(() => (route.name === 'event-edit-task' ? String(route.params.id) : ''))

const taskId = ref('')
const taskTitle = ref('')
/** 关联任务不可用（不存在/已删除）：禁止保存，避免产生无主日程 */
const taskMissing = ref(false)

const allDay = ref(false)
const startLocal = ref('')
const endLocal = ref('')
const startDay = ref('')
const endDay = ref('')
const location = ref('')
const note = ref('')

const formError = ref('')
const saving = ref(false)
const loading = ref(false)
const loadError = ref('')

const conflictVisible = ref(false)
const conflicts = ref<EventConflictBrief[]>([])
const conflictLevel = ref<ConflictLevel>('overlap')
const conflictDateGroups = ref<never[]>([])
const conflictDatesTotal = ref(0)
const conflictTotal = ref(0)

const headTitle = computed(() => (editId.value ? '编辑任务日程' : '安排任务日程'))
/** 关联任务不可用或加载失败时不允许提交 */
const blocked = computed(() => taskMissing.value || !!loadError.value)

const startIso = computed<string | null>(() =>
  allDay.value ? toIso(fromDateKey(startDay.value)) : fromLocalInputValue(startLocal.value)
)
const endIso = computed<string | null>(() =>
  allDay.value ? toIso(nextDay(fromDateKey(endDay.value))) : fromLocalInputValue(endLocal.value)
)

let endTouched = false

const startDisplay = computed(() =>
  startLocal.value ? formatDue(fromLocalInputValue(startLocal.value)) : '未选择'
)
const endDisplay = computed(() =>
  endLocal.value ? formatDue(fromLocalInputValue(endLocal.value)) : '未选择'
)
const startDayDisplay = computed(() => formatDayValue(startDay.value))
const endDayDisplay = computed(() => formatDayValue(endDay.value))

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
    startLocal.value = `${startDay.value}T09:00`
    endLocal.value = `${lastDay}T10:00`
    endTouched = true
  }
}

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

/** 载入关联任务：失败即错误态并禁止保存（不得产生无主日程） */
async function loadTask(id: string): Promise<void> {
  if (!id) {
    taskMissing.value = true
    return
  }
  try {
    const t = await taskApi.fetchTask(id)
    taskId.value = String(t.id)
    taskTitle.value = t.title
    taskMissing.value = false
  } catch {
    taskId.value = ''
    taskTitle.value = ''
    taskMissing.value = true
  }
}

async function loadEvent(): Promise<void> {
  loading.value = true
  loadError.value = ''
  try {
    const ev = await eventApi.fetchEvent(editId.value)
    if (ev.event_type !== 'task') {
      // 非任务日程：交由统一编辑入口按类型分流
      await router.replace({ path: `/calendar/${editId.value}/edit/normal`, query: { ...route.query } })
      return
    }
    await loadTask(ev.task_id ? String(ev.task_id) : ev.task ? String(ev.task.id) : '')
    allDay.value = ev.all_day
    location.value = ev.location || ''
    note.value = ev.note || ''
    startLocal.value = toLocalInputValue(ev.start_at)
    endLocal.value = toLocalInputValue(ev.end_at)
    const s = new Date(ev.start_at)
    const e = new Date(ev.end_at)
    startDay.value = toDateKey(s)
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
  // 编辑时不下发 event_type/task_id（类型与关联创建后不可变更）
  if (!editId.value) {
    payload.event_type = 'task'
    payload.task_id = taskId.value
  }
  if (confirmConflict) payload.confirm_conflict = true
  return payload
}

function validate(): boolean {
  if (blocked.value) return false
  if (!taskId.value) return false
  return !!startIso.value && !!endIso.value && !endError.value
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
    conflictVisible.value = false
    eventSync.markDirty()
    toast.show('已保存')
    goBackAfterSave()
  } catch (e) {
    if (e instanceof ApiError && e.code === 4009) {
      const detail = (e.details || {}) as Partial<ConflictDetail> & {
        conflict_dates?: never[]
        conflict_dates_total?: number
        conflict_total?: number
      }
      conflictLevel.value = detail.conflict_level || 'overlap'
      conflictDateGroups.value = detail.conflict_dates || []
      conflictDatesTotal.value = detail.conflict_dates_total || 0
      conflictTotal.value = detail.conflict_total || 0
      conflicts.value = detail.conflicts || []
      conflictVisible.value = true
    } else {
      formError.value = errorText(e)
    }
  } finally {
    saving.value = false
  }
}

onMounted(async () => {
  if (editId.value) {
    await loadEvent()
    return
  }
  const qTask = typeof route.query.task_id === 'string' ? route.query.task_id : ''
  await loadTask(qTask)
  applyDefaults()
})
</script>

<template>
  <div class="page form">
    <header class="form__head">
      <button class="form__cancel pressable" @click="goBackAfterSave">取消</button>
      <span class="form__title">{{ headTitle }}</span>
      <span class="form__placeholder" />
    </header>

    <div class="page-body form__body">
      <p v-if="loading" class="form__loading">加载中…</p>

      <!-- 关联任务不存在/加载失败：整页错误态，不渲染提交按钮 -->
      <StateError
        v-else-if="loadError"
        :text="loadError"
        @retry="editId ? loadEvent() : loadTask(String(route.query.task_id ?? ''))"
      />

      <StateError
        v-else-if="taskMissing"
        text="关联任务不存在，无法保存日程"
        @retry="editId ? loadEvent() : loadTask(String(route.query.task_id ?? ''))"
      />

      <template v-else>
        <p v-if="formError" class="form__alert">{{ formError }}</p>

        <!-- 关联任务：带入并锁定，不可修改、不提供选择入口 -->
        <section class="form__group form__group--rows">
          <div class="form__row">
            <AppIcon name="link" :size="18" color="var(--color-link)" />
            <span class="form__row-label">关联任务</span>
            <span class="form__row-value ellipsis">{{ taskTitle }}</span>
          </div>
          <p class="form__hint">标题即任务标题，不可修改；任务日程不支持重复</p>
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
          <AppButton type="primary" :loading="saving" :disabled="blocked" @click="submit(false)">
            保 存
          </AppButton>
        </div>
      </template>
    </div>

    <ConflictSheet
      :visible="conflictVisible"
      :conflicts="conflicts"
      :level="conflictLevel"
      :saving="saving"
      scope="occurrence"
      :date-groups="conflictDateGroups"
      :dates-total="conflictDatesTotal"
      :total="conflictTotal"
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
.form__group--rows {
  padding: 0;
  overflow: hidden;
}
.form__stack {
  display: flex;
  flex-direction: column;
  gap: var(--sp-4);
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
.form__row--switch {
  border-bottom: 1px solid var(--border-color);
}
.form__row-label {
  flex: 1;
  font-size: var(--font-body-l);
}
.form__row-value {
  max-width: 55%;
  font-size: var(--font-body-m);
  color: var(--text-primary);
}
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
