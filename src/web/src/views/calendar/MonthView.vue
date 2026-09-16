<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import * as eventApi from '@/api/events'
import { errorText } from '@/api/client'
import type { CalendarEvent, MonthDayCount } from '@/types'
import { formatEventRange, formatDayTitle, formatMonthTitle, fromDateKey, toDateKey } from '@/utils/time'
import AppFAB from '@/components/AppFAB.vue'
import MonthGrid from '@/components/calendar/MonthGrid.vue'
import EventTypeTag from '@/components/calendar/EventTypeTag.vue'
import SkeletonList from '@/components/SkeletonList.vue'
import StateError from '@/components/StateError.vue'
import { useEventSyncStore } from '@/stores/eventSync'

const router = useRouter()
const route = useRoute()
const eventSync = useEventSyncStore()

/** 预览区首屏展示条数，超出折叠 */
const PREVIEW_LIMIT = 3

const today = new Date()
const year = ref(today.getFullYear())
const month = ref(today.getMonth() + 1)
const selectedDate = ref(toDateKey(today))

const counts = ref<MonthDayCount[]>([])
const dayEvents = ref<CalendarEvent[]>([])
const loading = ref(true)
const dayLoading = ref(false)
const error = ref('')
const expanded = ref(false)

const monthTitle = computed(() => formatMonthTitle(year.value, month.value))
const dayTitle = computed(() => formatDayTitle(selectedDate.value))
const inCurrentMonth = computed(() => {
  const now = new Date()
  return now.getFullYear() === year.value && now.getMonth() + 1 === month.value
})
const visibleEvents = computed(() =>
  expanded.value ? dayEvents.value : dayEvents.value.slice(0, PREVIEW_LIMIT)
)
const hasMore = computed(() => dayEvents.value.length > PREVIEW_LIMIT)

function byStart(a: CalendarEvent, b: CalendarEvent): number {
  return new Date(a.start_at).getTime() - new Date(b.start_at).getTime()
}

/** 月计数 + 选中日日程一起拉：两者失败即整块错误态，不保留旧数据 */
async function loadAll(): Promise<void> {
  loading.value = true
  error.value = ''
  try {
    const [c, events] = await Promise.all([
      eventApi.fetchMonthCounts(year.value, month.value),
      eventApi.fetchEvents({ date: selectedDate.value }),
    ])
    counts.value = c || []
    dayEvents.value = [...(events || [])].sort(byStart)
  } catch (e) {
    counts.value = []
    dayEvents.value = []
    error.value = errorText(e)
  } finally {
    loading.value = false
  }
}

/** 仅切换选中日：月计数不变，避免整月重拉 */
async function loadDay(): Promise<void> {
  dayLoading.value = true
  error.value = ''
  try {
    const events = await eventApi.fetchEvents({ date: selectedDate.value })
    dayEvents.value = [...(events || [])].sort(byStart)
  } catch (e) {
    dayEvents.value = []
    error.value = errorText(e)
  } finally {
    dayLoading.value = false
  }
}

function shiftMonth(delta: number): void {
  const d = new Date(year.value, month.value - 1 + delta, 1)
  year.value = d.getFullYear()
  month.value = d.getMonth() + 1
  // 切月时选中日回到「今天」或该月 1 号，避免预览区停留在别的月份
  const now = new Date()
  selectedDate.value =
    now.getFullYear() === year.value && now.getMonth() + 1 === month.value
      ? toDateKey(now)
      : toDateKey(new Date(year.value, month.value - 1, 1))
  expanded.value = false
  void loadAll()
}

function goToday(): void {
  const now = new Date()
  year.value = now.getFullYear()
  month.value = now.getMonth() + 1
  selectedDate.value = toDateKey(now)
  expanded.value = false
  void loadAll()
}

function onSelect(date: string): void {
  selectedDate.value = date
  expanded.value = false
  const d = fromDateKey(date)
  // 点到补位的非当月日期时同步切月，否则网格与预览区会对不上
  if (d.getFullYear() !== year.value || d.getMonth() + 1 !== month.value) {
    year.value = d.getFullYear()
    month.value = d.getMonth() + 1
    void loadAll()
  } else {
    void loadDay()
  }
}

function goDay(): void {
  router.push(`/calendar/day?date=${selectedDate.value}`)
}

function goNew(): void {
  router.push(`/calendar/new?date=${selectedDate.value}`)
}

/* ---- 左右滑动切月 ---- */
let swipeStartX = 0
let swipeStartY = 0
let swipeActive = false

function onTouchStart(e: TouchEvent): void {
  const t = e.touches[0]
  // 屏幕边缘 20px 起手让给浏览器返回/前进手势
  if (t.clientX < 20 || t.clientX > window.innerWidth - 20) {
    swipeActive = false
    return
  }
  swipeStartX = t.clientX
  swipeStartY = t.clientY
  swipeActive = true
}

function onTouchEnd(e: TouchEvent): void {
  if (!swipeActive) return
  swipeActive = false
  const t = e.changedTouches[0]
  const dx = t.clientX - swipeStartX
  const dy = t.clientY - swipeStartY
  // 横向位移足够且明显横滑才切月，避免与纵向滚动冲突
  if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy)) shiftMonth(dx < 0 ? 1 : -1)
}

onMounted(() => {
  // 定位日期优先取路由 query（从当日视图返回时携带），其次取跨页定位标记，
  // 最后消费脏标记（本页挂载即拉取，故只做清理）
  eventSync.consumeDirty()
  const fromQuery = typeof route.query.date === 'string' ? route.query.date : ''
  const focus = fromQuery || eventSync.takeFocusDate()
  if (focus) {
    const d = fromDateKey(focus)
    selectedDate.value = focus
    year.value = d.getFullYear()
    month.value = d.getMonth() + 1
  }
  void loadAll()
})
</script>

<template>
  <div class="page month">
    <header class="month__head">
      <button class="month__nav pressable" aria-label="上一月" @click="shiftMonth(-1)">‹</button>
      <h1 class="month__title">{{ monthTitle }}</h1>
      <button v-if="!inCurrentMonth" class="month__today pressable" @click="goToday">今天</button>
      <button class="month__nav pressable" aria-label="下一月" @click="shiftMonth(1)">›</button>
    </header>

    <section
      class="month__cal"
      @touchstart.passive="onTouchStart"
      @touchend="onTouchEnd"
      @touchcancel="onTouchEnd"
    >
      <MonthGrid
        :year="year"
        :month="month"
        :counts="counts"
        :selected="selectedDate"
        @select="onSelect"
      />
    </section>

    <div class="page-body month__body">
      <div class="month__bar">
        <span class="month__bar-day">{{ dayTitle }}</span>
        <span class="month__bar-count">共 {{ dayEvents.length }} 项</span>
        <button class="month__bar-add pressable" aria-label="这一天新建日程" @click="goNew">
          ＋
        </button>
      </div>

      <SkeletonList v-if="loading || dayLoading" :rows="3" />

      <StateError v-else-if="error" :text="error" @retry="loadAll" />

      <p v-else-if="!dayEvents.length" class="month__empty">这天还没有安排</p>

      <template v-else>
        <ul class="month__list">
          <li v-for="e in visibleEvents" :key="String(e.id)">
            <button class="month__row pressable" @click="goDay">
              <span class="month__row-time">{{ formatEventRange(e) }}</span>
              <span
                class="month__row-title ellipsis"
                :class="{ 'month__row-title--done': e.task?.status === 'completed' }"
                >{{ e.title }}</span
              >
              <EventTypeTag :type="e.event_type" />
            </button>
          </li>
        </ul>
        <button v-if="hasMore" class="month__more pressable" @click="expanded = !expanded">
          {{ expanded ? '收起' : `查看全部 ${dayEvents.length} 项` }}
        </button>
      </template>
    </div>

    <AppFAB label="新建日程" @click="goNew" />
  </div>
</template>

<style scoped>
.month {
  position: relative;
}
.month__head {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  height: calc(var(--navbar-height) + var(--safe-top));
  padding: var(--safe-top) var(--sp-4) 0;
  background: var(--bg-card);
}
.month__nav {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 44px;
  height: 44px;
  font-size: 26px;
  line-height: 1;
  color: var(--color-primary);
}
.month__title {
  flex: 1;
  text-align: center;
  font-size: var(--font-heading-m);
  line-height: var(--font-heading-m-lh);
  font-weight: 600;
}
.month__today {
  min-height: 28px;
  padding: 0 var(--sp-3);
  border-radius: 14px;
  background: var(--color-primary-light);
  color: var(--color-primary);
  font-size: var(--font-caption);
}
.month__cal {
  background: var(--bg-card);
  border-bottom: 1px solid var(--border-color);
}
.month__body {
  background: var(--bg-page);
  padding-bottom: var(--sp-8);
}
/* 吸顶摘要条：滚动明细时始终能看清当前选中的是哪一天 */
.month__bar {
  position: sticky;
  top: 0;
  z-index: 5;
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  min-height: 44px;
  padding: 0 var(--sp-4);
  background: var(--bg-page);
  border-bottom: 1px solid var(--border-color);
}
.month__bar-day {
  font-size: var(--font-body-m);
  font-weight: 600;
}
.month__bar-count {
  flex: 1;
  font-size: var(--font-caption);
  color: var(--text-secondary);
}
.month__bar-add {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 44px;
  height: 44px;
  margin-right: -12px;
  font-size: 22px;
  color: var(--color-primary);
}
.month__empty {
  padding: var(--sp-6) var(--sp-4);
  text-align: center;
  font-size: var(--font-body-m);
  color: var(--text-secondary);
}
.month__list {
  background: var(--bg-card);
}
.month__list > li + li .month__row {
  border-top: 1px solid var(--border-color);
}
.month__row {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  width: 100%;
  min-height: 52px;
  padding: 0 var(--sp-4);
  text-align: left;
}
.month__row-time {
  width: 84px;
  flex-shrink: 0;
  font-size: var(--font-caption);
  color: var(--text-secondary);
  font-variant-numeric: tabular-nums;
}
.month__row-title {
  flex: 1;
  min-width: 0;
  font-size: var(--font-body-m);
  color: var(--text-primary);
}
.month__row-title--done {
  color: var(--text-disabled);
  text-decoration: line-through;
}
.month__more {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  min-height: 44px;
  background: var(--bg-card);
  border-top: 1px solid var(--border-color);
  font-size: var(--font-body-m);
  color: var(--color-primary);
}
</style>