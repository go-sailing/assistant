<script setup lang="ts">
import { computed, nextTick, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import * as eventApi from '@/api/events'
import * as taskApi from '@/api/tasks'
import { errorText } from '@/api/client'
import type { CalendarEvent } from '@/types'
import { formatClock, formatDayTitle, fromDateKey, toDateKey } from '@/utils/time'
import AppActionSheet from '@/components/AppActionSheet.vue'
import AppIcon from '@/components/AppIcon.vue'
import EventAgendaItem from '@/components/calendar/EventAgendaItem.vue'
import SkeletonList from '@/components/SkeletonList.vue'
import StateEmpty from '@/components/StateEmpty.vue'
import StateError from '@/components/StateError.vue'
import { useEventSyncStore } from '@/stores/eventSync'
import { useToastStore } from '@/stores/toast'

const route = useRoute()
const router = useRouter()
const toast = useToastStore()
const eventSync = useEventSyncStore()

const events = ref<CalendarEvent[]>([])
const loading = ref(true)
/** 延迟展示的骨架可见性（避免快网闪烁） */
const skeletonVisible = ref(false)
const error = ref('')
const refreshing = ref(false)
const actionEvent = ref<CalendarEvent | null>(null)
const deleteSheetVisible = ref(false)

const dateKey = computed(() =>
  typeof route.query.date === 'string' && route.query.date ? route.query.date : toDateKey(new Date())
)
const fromChat = computed(() => route.query.from === 'chat')
const isToday = computed(() => dateKey.value === toDateKey(new Date()))
const dayTitle = computed(() => formatDayTitle(dateKey.value))
const allDayEvents = computed(() => events.value.filter((e) => e.all_day))
const timedEvents = computed(() => events.value.filter((e) => !e.all_day))
const nowLabel = computed(() => formatClock(new Date()))

/**
 * 当前时间线在定时列表中的插入位置：按时间顺序插入即等于按时间轴定位，
 * 比绝对定位布局更稳（日程卡片高度随内容变化）。
 */
const nowIndex = computed(() => {
  if (!isToday.value) return -1
  const now = Date.now()
  const i = timedEvents.value.findIndex((e) => new Date(e.start_at).getTime() > now)
  return i < 0 ? timedEvents.value.length : i
})

const deleteTitle = computed(() => {
  const ev = actionEvent.value
  if (!ev) return ''
  return ev.event_type === 'task' && ev.task
    ? `确定删除该日程安排？关联任务『${ev.task.title}』不会被删除`
    : '确定删除该日程？删除后不可恢复'
})

function byStart(a: CalendarEvent, b: CalendarEvent): number {
  return new Date(a.start_at).getTime() - new Date(b.start_at).getTime()
}

function hasConflict(e: CalendarEvent): boolean {
  return !!e.conflicts && e.conflicts.length > 0
}

const SKELETON_DELAY_MS = 300
let skeletonTimer: number | undefined

/** 骨架延迟展示：本地/快网下 20~40ms 就返回，立刻显示骨架只会造成闪烁（UX 5.9） */
function scheduleSkeleton(): void {
  window.clearTimeout(skeletonTimer)
  skeletonTimer = window.setTimeout(() => {
    if (loading.value) skeletonVisible.value = true
  }, SKELETON_DELAY_MS)
}

async function load(): Promise<void> {
  loading.value = true
  skeletonVisible.value = false
  scheduleSkeleton()
  error.value = ''
  try {
    const list = await eventApi.fetchEvents({ date: dateKey.value })
    events.value = [...(list || [])].sort(byStart)
  } catch (e) {
    // 失败不展示旧数据
    events.value = []
    error.value = errorText(e)
  } finally {
    loading.value = false
    skeletonVisible.value = false
    window.clearTimeout(skeletonTimer)
  }
}

async function refresh(): Promise<void> {
  refreshing.value = true
  await load()
  refreshing.value = false
}

function shift(delta: number): void {
  const d = fromDateKey(dateKey.value)
  d.setDate(d.getDate() + delta)
  const query: Record<string, string> = { date: toDateKey(d) }
  if (fromChat.value) query.from = 'chat'
  router.replace({ path: '/calendar/day', query })
}

function goToday(): void {
  const query: Record<string, string> = { date: toDateKey(new Date()) }
  if (fromChat.value) query.from = 'chat'
  router.replace({ path: '/calendar/day', query })
}

function goBack(): void {
  // 返回月视图时显式带上当前日期，避免丢失选中日期（月视图以 query.date 恢复）
  router.replace({ path: '/calendar', query: { date: dateKey.value } })
}

function goDetail(ev: CalendarEvent): void {
  router.push(`/calendar/${ev.id}`)
}

function goEdit(ev: CalendarEvent): void {
  router.push(`/calendar/${ev.id}/edit`)
}

function goNew(): void {
  router.push(`/calendar/new?date=${dateKey.value}`)
}

/** 勾选完成关联任务：乐观更新，失败整体回滚 */
async function onToggle(ev: CalendarEvent): Promise<void> {
  const index = events.value.findIndex((e) => String(e.id) === String(ev.id))
  if (index < 0) return
  const original = events.value[index]
  const target = original.task
  if (!target) return
  const completed = target.status === 'completed'
  events.value[index] = {
    ...original,
    task: {
      ...target,
      status: completed ? 'todo' : 'completed',
      completed_at: completed ? null : new Date().toISOString(),
    },
  }
  try {
    const updated = completed
      ? await taskApi.uncompleteTask(target.id)
      : await taskApi.completeTask(target.id)
    const i = events.value.findIndex((e) => String(e.id) === String(original.id))
    const cur = i >= 0 ? events.value[i] : null
    if (cur && cur.task) {
      events.value[i] = {
        ...cur,
        task: { ...cur.task, status: updated.status, completed_at: updated.completed_at },
      }
    }
    toast.show(completed ? '已恢复未完成' : '已标记完成')
  } catch (e) {
    const i = events.value.findIndex((e) => String(e.id) === String(original.id))
    if (i >= 0) events.value[i] = original
    // 勾选失败统一给可操作文案，不透传服务端 500 的原始 message
    toast.show('操作失败，请重试')
    void errorText(e)
  }
}

function askDelete(ev: CalendarEvent): void {
  actionEvent.value = ev
  deleteSheetVisible.value = true
}

async function confirmDelete(): Promise<void> {
  const ev = actionEvent.value
  deleteSheetVisible.value = false
  if (!ev) return
  try {
    await eventApi.deleteEvent(ev.id)
    events.value = events.value.filter((e) => String(e.id) !== String(ev.id))
    eventSync.markDirty()
    toast.show('已删除')
  } catch (e) {
    toast.show(errorText(e))
  }
}

/* ---- 下拉刷新 ---- */
const scroller = ref<HTMLElement | null>(null)
const pullDistance = ref(0)
let startY = 0
let pullActive = false

function onTouchStart(e: TouchEvent): void {
  const el = scroller.value
  if (!el || el.scrollTop > 0 || refreshing.value) return
  startY = e.touches[0].clientY
  pullActive = true
}

function onTouchMove(e: TouchEvent): void {
  if (!pullActive) return
  const dy = e.touches[0].clientY - startY
  if (dy > 0) pullDistance.value = Math.min(72, dy * 0.5)
}

async function onTouchEnd(): Promise<void> {
  if (!pullActive) return
  pullActive = false
  const shouldRefresh = pullDistance.value >= 36
  pullDistance.value = 0
  if (shouldRefresh) await refresh()
}

onMounted(async () => {
  await load()
  if (!isToday.value || loading.value) return
  // 定位到当前时间附近，上方留 80px（见 .day__now 的 scroll-margin-top）
  await nextTick()
  const el = scroller.value?.querySelector('.day__now')
  el?.scrollIntoView({ block: 'start' })
})
</script>

<template>
  <div class="page day">
    <header class="day__head">
      <button class="day__back pressable" aria-label="返回" @click="goBack">
        ‹
        <span v-if="fromChat" class="day__back-text">返回对话</span>
      </button>
      <div class="day__nav">
        <button class="day__arrow pressable" aria-label="前一天" @click="shift(-1)">‹</button>
        <h1 class="day__title ellipsis">{{ dayTitle }}</h1>
        <button class="day__arrow pressable" aria-label="后一天" @click="shift(1)">›</button>
      </div>
      <button v-if="!isToday" class="day__today pressable" @click="goToday">今天</button>
    </header>

    <div
      ref="scroller"
      class="page-body day__body"
      @touchstart.passive="onTouchStart"
      @touchmove="onTouchMove"
      @touchend="onTouchEnd"
      @touchcancel="onTouchEnd"
    >
      <div v-if="pullDistance > 0 || refreshing" class="day__pull">
        {{ refreshing ? '正在刷新…' : pullDistance >= 36 ? '松开刷新' : '下拉刷新' }}
      </div>

      <SkeletonList v-if="skeletonVisible" :rows="3" />

      <StateError v-else-if="error" :text="error" @retry="load" />

      <StateEmpty
        v-else-if="!events.length"
        title="这天还没有安排"
        text="点下方按钮新建，或去助手说一句话"
        action-text="新建日程"
        @action="goNew"
      />

      <template v-else>
        <section v-if="allDayEvents.length" class="day__allday">
          <h2 class="day__allday-title">
            <AppIcon name="allday" :size="14" color="#6B7080" />
            全天
          </h2>
          <ul>
            <EventAgendaItem
              v-for="e in allDayEvents"
              :key="String(e.id)"
              :event="e"
              :conflict="hasConflict(e)"
              show-checkbox
              @detail="goDetail"
              @toggle="onToggle"
              @edit="goEdit"
              @remove="askDelete"
            />
          </ul>
        </section>

        <ul v-if="timedEvents.length" class="day__list">
          <li
            v-if="nowIndex === 0"
            class="day__now"
            role="separator"
            :aria-label="`当前时间 ${nowLabel}`"
          >
            <span class="day__now-dot" aria-hidden="true" />
            <span class="day__now-line" aria-hidden="true" />
            <span class="day__now-text">{{ nowLabel }}</span>
          </li>
          <template v-for="(e, i) in timedEvents" :key="String(e.id)">
            <EventAgendaItem
              :event="e"
              :conflict="hasConflict(e)"
              show-checkbox
              @detail="goDetail"
              @toggle="onToggle"
              @edit="goEdit"
              @remove="askDelete"
            />
            <li
              v-if="i + 1 === nowIndex"
              class="day__now"
              role="separator"
              :aria-label="`当前时间 ${nowLabel}`"
            >
              <span class="day__now-dot" aria-hidden="true" />
              <span class="day__now-line" aria-hidden="true" />
              <span class="day__now-text">{{ nowLabel }}</span>
            </li>
          </template>
        </ul>
      </template>
    </div>

    <AppActionSheet
      :visible="deleteSheetVisible"
      :title="deleteTitle"
      :items="[{ label: '删除', value: 'delete', danger: true }]"
      @select="confirmDelete"
      @cancel="deleteSheetVisible = false"
    />
  </div>
</template>

<style scoped>
.day__head {
  display: flex;
  align-items: center;
  gap: var(--sp-1);
  height: calc(var(--navbar-height) + var(--safe-top));
  padding: var(--safe-top) var(--sp-4) 0;
  background: var(--bg-card);
  border-bottom: 1px solid var(--border-color);
}
.day__back {
  display: flex;
  align-items: center;
  gap: 2px;
  min-width: 44px;
  min-height: 44px;
  margin-left: -12px;
  font-size: 26px;
  color: var(--color-primary);
}
.day__back-text {
  font-size: var(--font-body-m);
  white-space: nowrap;
}
.day__nav {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  min-width: 0;
}
.day__arrow {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 44px;
  height: 44px;
  font-size: 24px;
  color: var(--color-primary);
}
.day__title {
  flex: 1;
  min-width: 0;
  text-align: center;
  font-size: var(--font-body-l);
  line-height: var(--font-body-l-lh);
  font-weight: 600;
}
.day__today {
  min-height: 28px;
  padding: 0 var(--sp-3);
  border-radius: 14px;
  background: var(--color-primary-light);
  color: var(--color-primary);
  font-size: var(--font-caption);
  flex-shrink: 0;
}
.day__body {
  background: var(--bg-page);
  padding-bottom: var(--sp-8);
}
.day__pull {
  text-align: center;
  font-size: var(--font-caption);
  color: var(--text-secondary);
  padding: var(--sp-2) 0;
}
.day__allday {
  padding: var(--sp-2) var(--sp-4) var(--sp-3);
  background: var(--color-allday-bg);
}
.day__allday-title {
  display: flex;
  align-items: center;
  gap: 4px;
  height: 24px;
  font-size: var(--font-caption);
  line-height: var(--font-caption-lh);
  color: var(--text-secondary);
}
.day__list {
  padding: var(--sp-3) var(--sp-4) 0;
}
.day__now {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  height: 20px;
  /* 挂载后定位到此处时上方留出 80px */
  scroll-margin-top: 80px;
}
.day__now-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--color-danger);
  flex-shrink: 0;
}
.day__now-line {
  flex: 1;
  height: 1px;
  background: var(--color-danger);
}
.day__now-text {
  font-size: var(--font-caption-s);
  line-height: var(--font-caption-s-lh);
  color: var(--color-danger);
  font-variant-numeric: tabular-nums;
  flex-shrink: 0;
}
</style>