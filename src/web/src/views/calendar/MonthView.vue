<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, nextTick, reactive, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import * as eventApi from '@/api/events'
import { errorText } from '@/api/client'
import type { CalendarEvent, MonthDayCount, Occurrence } from '@/types'
import {
  buildMonthGrid,
  diffDays,
  formatDayBarTitle,
  formatEventRange,
  formatMonthTitle,
  fromDateKey,
  toDateKey,
} from '@/utils/time'
import AppIcon from '@/components/AppIcon.vue'
import MonthGrid from '@/components/calendar/MonthGrid.vue'
import EventTypeTag from '@/components/calendar/EventTypeTag.vue'
import RecurrenceBadge from '@/components/calendar/RecurrenceBadge.vue'
import SkeletonList from '@/components/SkeletonList.vue'
import StateError from '@/components/StateError.vue'
import { useEventSyncStore } from '@/stores/eventSync'
import { useDrawerStore } from '@/stores/drawer'

const router = useRouter()
const route = useRoute()
const eventSync = useEventSyncStore()
const drawer = useDrawerStore()

const today = new Date()
const year = ref(today.getFullYear())
const month = ref(today.getMonth() + 1)
const selectedDate = ref(toDateKey(today))

/**
 * v0.4.0 智能定型：骨架期（数据未到达）月历按展开态占位、折叠开关条不渲染；
 * 当日列表与月计数**两个数据都就绪后一次性**定型（≥3 项 → 折叠），避免"先展开后收起"的弹动。
 */
const shapePhase = ref<'skeleton' | 'settled'>('skeleton')
/** 折叠态（纯内存 UI 态；用户手动切换后本次停留期间不再被重新定型） */
const collapsed = ref(false)
/** 折叠动画进行中：忽略开关重复点击 */
const animating = ref(false)
/** 动画结束后才真正只渲染一周（动画期间保留整月内容，位置连续） */
const renderWeek = ref(false)

/** 月计数缓存：key = `y-m`；折叠态跨月周需要同时覆盖两个月 */
const countsCache = reactive<Record<string, MonthDayCount[]>>({})
const counts = computed(() => countsCache[cacheKey(year.value, month.value)] || [])

const dayEvents = ref<CalendarEvent[]>([])
/** 当前列表对应的日期：折叠/展开切换时避免重复请求同一天的列表 */
const loadedDayKey = ref('')
const loading = ref(true)
const dayLoading = ref(false)
const error = ref('')
/** 骨架 >300ms 才出现（避免快请求下的闪烁） */
const showSkeleton = ref(false)
let skeletonTimer = 0

/* ---------------- 折叠动画与竖向空间度量 ---------------- */

const pageEl = ref<HTMLElement | null>(null)
const headEl = ref<HTMLElement | null>(null)
const barEl = ref<HTMLElement | null>(null)
const gridWrap = ref<HTMLElement | null>(null)
/** 月历容器宽度（中栏内容宽）：折叠/展开高度都由它推导，横竖屏切换同样成立 */
const containerWidth = ref(0)
const pageHeight = ref(0)
const headHeight = ref(0)
const barHeight = ref(0)
/** .grid__week 周标题行高度 */
const WEEK_HEAD_H = 28
/** .grid__days 底部内边距 */
const GRID_PAD_BOTTOM = 8
/** 与 --page-padding 一致（网格左右内边距） */
const GRID_PADDING = 16
/** 与 --grid-cell-min 一致：展开态空间不足时单格高度下限 */
const GRID_CELL_MIN = 36
/** 折叠开关条高度（骨架期不渲染，但空间照常预留，避免定型时列表跳动） */
const TOGGLE_H = 44
/** 与 --calendar-list-min-height 一致：列表区最小高度占视口比 */
const LIST_MIN_RATIO = 0.38
const SKELETON_DELAY = 300

/** 单格边长：(容器宽 − 左右内边距) / 7，格子 aspect-ratio:1 */
const cellSize = computed(() => {
  const usable = containerWidth.value - 2 * GRID_PADDING
  return usable > 0 ? usable / 7 : 0
})
/** 展开态网格理想高（6 行正方形格） */
const idealExpandedHeight = computed(() =>
  cellSize.value ? WEEK_HEAD_H + 6 * cellSize.value + GRID_PAD_BOTTOM : 0
)
/** 展开态网格高下限（行高收到 --grid-cell-min） */
const minExpandedHeight = computed(() => WEEK_HEAD_H + 6 * GRID_CELL_MIN + GRID_PAD_BOTTOM)
/** 折叠态网格高（1 行） */
const weekHeight = computed(() =>
  cellSize.value ? WEEK_HEAD_H + cellSize.value + GRID_PAD_BOTTOM : 0
)
/** 月历可用竖向空间 = 页面高 − 头部 − 开关条 − 标题条 */
const gridAvailable = computed(() =>
  Math.max(0, pageHeight.value - headHeight.value - TOGGLE_H - barHeight.value)
)
/** 列表区最小高度（38dvh，与 --calendar-list-min-height 一致） */
const listMinHeight = computed(() => pageHeight.value * LIST_MIN_RATIO)
/** 展开态空间不足：月格让位已到下限，列表区无法再保证 38dvh（页面仍不出现整页滚动） */
const listBelowMin = computed(
  () => gridAvailable.value - listMinHeight.value < minExpandedHeight.value
)

/** 展开态网格实际高：优先给列表留 38dvh，空间不足时压缩行高到 --grid-cell-min */
const expandedHeight = computed(() => {
  if (!cellSize.value) return 0
  const room = gridAvailable.value - listMinHeight.value
  return Math.max(minExpandedHeight.value, Math.min(idealExpandedHeight.value, room))
})
/** 压缩态单格高（0 = 不压缩，按格宽正方形渲染） */
const compressedCell = computed(() => {
  if (!cellSize.value) return 0
  if (expandedHeight.value >= idealExpandedHeight.value - 0.5) return 0
  return Math.max(GRID_CELL_MIN, (expandedHeight.value - WEEK_HEAD_H - GRID_PAD_BOTTOM) / 6)
})
/** 位移/压缩换算用的实际格高 */
const effectiveCell = computed(() => compressedCell.value || cellSize.value)
/** 格高偏小（压缩态或 320px 窄屏）：主字圆底/副字/标记点同步收紧，避免格内裁切 */
const COMPACT_CELL_MAX = 48
const compactCells = computed(() => effectiveCell.value > 0 && effectiveCell.value < COMPACT_CELL_MAX)

const monthTitle = computed(() => formatMonthTitle(year.value, month.value))
const dayTitle = computed(() => formatDayBarTitle(selectedDate.value))
const inCurrentMonth = computed(() => {
  const now = new Date()
  return now.getFullYear() === year.value && now.getMonth() + 1 === month.value
})

/** 选中日在其所在月网格中的行号（0..5），折叠动画用 */
const weekIndex = computed(() => {
  const gridStart = buildMonthGrid(year.value, month.value)[0]
  return Math.max(0, Math.floor(diffDays(gridStart, fromDateKey(selectedDate.value)) / 7))
})

const gridHeight = computed(() => {
  // 显式像素高度才能触发 height 过渡（auto 无法插值）
  if (collapsed.value) return weekHeight.value ? `${weekHeight.value}px` : undefined
  return expandedHeight.value ? `${expandedHeight.value}px` : undefined
})
/** 折叠动画：日期行上移的像素位移（把选中周滑到可视区顶部） */
const gridShift = computed(() => {
  if (!collapsed.value || renderWeek.value || !cellSize.value) return 0
  return weekIndex.value * effectiveCell.value
})

/** 折叠态可见格子的标记点来源：选中日所在周可能跨两个月 */
const gridCounts = computed<MonthDayCount[]>(() => {
  if (!collapsed.value) return counts.value
  return weekMonthKeys().flatMap(({ y, m }) => countsCache[cacheKey(y, m)] || [])
})

/** 标题条节日追加：有法定假日名时展示（不受农历开关控制，与「休」角标同源） */
const dayHolidayName = computed(() => {
  const c = gridCounts.value.find((x) => x.date === selectedDate.value)
  const cd = c?.calendar_day
  return cd?.type === 'holiday' ? cd.name || '' : ''
})

function measureLayout(): void {
  const page = pageEl.value
  if (page) pageHeight.value = page.clientHeight
  const head = headEl.value
  if (head) headHeight.value = head.offsetHeight
  const bar = barEl.value
  if (bar) barHeight.value = bar.offsetHeight
  const wrap = gridWrap.value
  if (wrap) containerWidth.value = wrap.clientWidth
}

function cacheKey(y: number, m: number): string {
  return `${y}-${m}`
}

function byStart(a: CalendarEvent, b: CalendarEvent): number {
  return new Date(a.start_at).getTime() - new Date(b.start_at).getTime()
}

/** 选中日所在自然周（周一~周日）涉及的月份（至多 2 个） */
function weekMonthKeys(): Array<{ y: number; m: number }> {
  const d = fromDateKey(selectedDate.value)
  const monday = new Date(d)
  monday.setDate(d.getDate() - ((d.getDay() + 6) % 7))
  const keys = new Map<string, { y: number; m: number }>()
  for (let i = 0; i < 7; i += 1) {
    const day = new Date(monday)
    day.setDate(monday.getDate() + i)
    const y = day.getFullYear()
    const m = day.getMonth() + 1
    keys.set(cacheKey(y, m), { y, m })
  }
  return [...keys.values()]
}

/* ---------------- 数据加载 ---------------- */

function beginSkeleton(): void {
  window.clearTimeout(skeletonTimer)
  showSkeleton.value = false
  skeletonTimer = window.setTimeout(() => {
    showSkeleton.value = true
  }, SKELETON_DELAY)
}

function endSkeleton(): void {
  window.clearTimeout(skeletonTimer)
  showSkeleton.value = false
}

/** 某月计数：命中缓存直接返回；单月失败抛错，由调用方决定容错级别 */
async function ensureCounts(y: number, m: number): Promise<void> {
  const key = cacheKey(y, m)
  if (countsCache[key]) return
  countsCache[key] = (await eventApi.fetchMonthCounts(y, m)) || []
}

/** 选中日全部日程（同一日期已加载则跳过，折叠/展开切换不重复请求） */
async function fetchDay(): Promise<CalendarEvent[]> {
  if (loadedDayKey.value === selectedDate.value) return dayEvents.value
  const events = await eventApi.fetchEvents({ date: selectedDate.value })
  const list = [...(events || [])].sort(byStart)
  loadedDayKey.value = selectedDate.value
  return list
}

/** 折叠态跨月周补齐邻月计数：失败静默（该月格子只缺点，不阻断） */
async function ensureNeighborCounts(): Promise<void> {
  const primaryKey = cacheKey(year.value, month.value)
  const neighbors = weekMonthKeys().filter((mm) => cacheKey(mm.y, mm.m) !== primaryKey)
  await Promise.allSettled(neighbors.map((mm) => ensureCounts(mm.y, mm.m)))
}

/**
 * v0.4.0 首屏：并行拉当日列表 + 当月计数，两者就绪后一次性定型。
 * 数据到达前不暴露形态开关（开关条 v-if 于 settled），因此不存在"先展开后收起"的弹动。
 */
async function bootstrap(): Promise<void> {
  loading.value = true
  error.value = ''
  beginSkeleton()
  const key = cacheKey(year.value, month.value)
  const [dayRes, monthRes] = await Promise.allSettled([fetchDay(), ensureCounts(year.value, month.value)])

  if (dayRes.status === 'fulfilled') {
    dayEvents.value = dayRes.value
  } else {
    dayEvents.value = []
    loadedDayKey.value = ''
    error.value = errorText(dayRes.reason)
  }
  if (monthRes.status === 'rejected') {
    delete countsCache[key]
    error.value = errorText(monthRes.reason)
  }

  // 定型口径 = 当日 list 返回条数（含全天、不含已取消实例），与标题条"共 N 项"同源
  const dayCount = dayRes.status === 'fulfilled' ? dayRes.value.length : 0
  collapsed.value = dayCount >= 3
  renderWeek.value = collapsed.value
  shapePhase.value = 'settled'

  loading.value = false
  endSkeleton()
  await nextTick()
  measureLayout()
  if (collapsed.value) void ensureNeighborCounts()
}

/** 展开态：当前月计数 + 当日列表，任一失败即整块错误态（不保留旧数据） */
async function loadExpanded(): Promise<void> {
  loading.value = true
  error.value = ''
  beginSkeleton()
  const key = cacheKey(year.value, month.value)
  try {
    const [, list] = await Promise.all([ensureCounts(year.value, month.value), fetchDay()])
    dayEvents.value = list
  } catch (e) {
    delete countsCache[key]
    dayEvents.value = []
    loadedDayKey.value = ''
    error.value = errorText(e)
  } finally {
    loading.value = false
    endSkeleton()
    void nextTick(measureLayout)
  }
}

/** 仅切换选中日（同一月内）：月计数不变 */
async function loadDayOnly(): Promise<void> {
  dayLoading.value = true
  error.value = ''
  beginSkeleton()
  try {
    dayEvents.value = await fetchDay()
    void nextTick(measureLayout)
  } catch (e) {
    dayEvents.value = []
    loadedDayKey.value = ''
    error.value = errorText(e)
  } finally {
    dayLoading.value = false
    endSkeleton()
  }
}

/**
 * 折叠态：跨月周需补齐邻月标记点。
 * 当前选中月失败 → 错误态；邻月失败 → 静默（该月格子无标记点，不阻断）。
 */
async function loadCollapsed(): Promise<void> {
  loading.value = true
  beginSkeleton()
  const primaryKey = cacheKey(year.value, month.value)
  const [dayRes, primaryRes] = await Promise.allSettled([
    fetchDay(),
    ensureCounts(year.value, month.value),
  ])
  await ensureNeighborCounts()

  if (primaryRes.status === 'rejected') {
    delete countsCache[primaryKey]
    dayEvents.value = []
    loadedDayKey.value = ''
    error.value = errorText(primaryRes.reason)
  } else if (dayRes.status === 'rejected') {
    dayEvents.value = []
    loadedDayKey.value = ''
    error.value = errorText(dayRes.reason)
  } else {
    dayEvents.value = dayRes.value
    error.value = ''
  }
  loading.value = false
  endSkeleton()
  void nextTick(measureLayout)
}

/** 形态已定型后的加载分发（重试 / 翻周 / 翻月 / 点格）；形态变化只由 toggleCollapse 触发 */
function load(): void {
  if (collapsed.value) void loadCollapsed()
  else void loadExpanded()
}

/* ---------------- 导航语义 ---------------- */

/** 展开态按月切换：选中日回「今天」或该月 1 号（沿用 v0.2.0） */
function shiftMonth(delta: number): void {
  const d = new Date(year.value, month.value - 1 + delta, 1)
  year.value = d.getFullYear()
  month.value = d.getMonth() + 1
  const now = new Date()
  selectedDate.value =
    now.getFullYear() === year.value && now.getMonth() + 1 === month.value
      ? toDateKey(now)
      : toDateKey(new Date(year.value, month.value - 1, 1))
  load()
}

/** 折叠态按周切换：选中日 ±7 天，年月跟随 */
function shiftWeek(delta: number): void {
  const d = fromDateKey(selectedDate.value)
  d.setDate(d.getDate() + delta * 7)
  selectedDate.value = toDateKey(d)
  year.value = d.getFullYear()
  month.value = d.getMonth() + 1
  load()
}

/** 头部 ‹ ›：折叠态翻周，展开态翻月 */
function shift(delta: number): void {
  if (collapsed.value) shiftWeek(delta)
  else shiftMonth(delta)
}

function goToday(): void {
  const now = new Date()
  year.value = now.getFullYear()
  month.value = now.getMonth() + 1
  selectedDate.value = toDateKey(now)
  load()
}

function onSelect(date: string): void {
  selectedDate.value = date
  const d = fromDateKey(date)
  const monthChanged = d.getFullYear() !== year.value || d.getMonth() + 1 !== month.value
  year.value = d.getFullYear()
  month.value = d.getMonth() + 1
  if (collapsed.value) {
    void loadCollapsed()
    return
  }
  // 点到补位的非当月日期时同步切月，否则网格与列表会对不上
  if (monthChanged) load()
  else void loadDayOnly()
}

/** 折叠/展开开关：不重置选中日；展开时定位到包含选中日的月份 */
async function toggleCollapse(): Promise<void> {
  if (animating.value) return
  measureLayout()
  if (!collapsed.value) {
    // 折叠：先按整月内容播放高度/位移过渡，动画结束后只渲染选中的那一周
    animating.value = true
    collapsed.value = true
    void loadCollapsed()
    window.setTimeout(() => {
      renderWeek.value = true
      animating.value = false
    }, 250)
    return
  }
  // 展开：恢复整月渲染并定位到选中日所在月份
  collapsed.value = false
  renderWeek.value = false
  const d = fromDateKey(selectedDate.value)
  year.value = d.getFullYear()
  month.value = d.getMonth() + 1
  await nextTick()
  measureLayout()
  void loadExpanded()
}

/* ---- v0.2.0：循环实例识别与跳转 ---- */

function occurrenceOf(e: CalendarEvent): Occurrence | null {
  const occ = e as Occurrence
  return occ.occurrence_key ? occ : null
}

function isModified(e: CalendarEvent): boolean {
  return occurrenceOf(e)?.override_state === 'modified'
}

/** 同系列实例 id 相同，列表 key 需叠加 occurrence_key */
function rowKey(e: CalendarEvent): string {
  return `${e.id}-${occurrenceOf(e)?.occurrence_key ?? ''}`
}

/** v0.3.0：列表 item 统一直达详情（普通/任务日程 → 详情；循环实例 → 实例视角详情） */
function onEventClick(e: CalendarEvent): void {
  const occ = occurrenceOf(e)
  if (occ) {
    router.push({
      path: `/calendar/${occ.series_id ?? e.id}`,
      query: { occurrence_key: occ.occurrence_key },
    })
    return
  }
  router.push(`/calendar/${e.id}`)
}

function goNew(): void {
  router.push(`/calendar/new?date=${selectedDate.value}`)
}

/* ---- 左右滑动：展开态翻月 / 折叠态翻周 ---- */
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
  // 横向位移足够且明显横滑才切换，避免与纵向滚动冲突
  if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy)) shift(dx < 0 ? 1 : -1)
}

/* ---- v0.4.0：详情返回恢复列表滚动位置（内存态，5 分钟内有效） ---- */

const SCROLL_TTL = 5 * 60 * 1000
/** 列表滚动位置 + 选中日（组件离开即销毁，故放模块级；不做持久化） */
let lastView: { date: string; top: number; at: number } | null = null
const listEl = ref<HTMLElement | null>(null)
/** 待恢复的滚动位置：数据渲染后再落位 */
let restoreTop = -1

/* ---- 全天置顶分组 + 定时按开始时间升序 ---- */
const allDayEvents = computed(() => dayEvents.value.filter((e) => e.all_day))
const timedEvents = computed(() => dayEvents.value.filter((e) => !e.all_day))

onMounted(async () => {
  // 消费脏标记（本页挂载即拉取，故只做清理）
  eventSync.consumeDirty()
  const fromQuery = typeof route.query.date === 'string' ? route.query.date : ''
  const fresh = lastView && Date.now() - lastView.at < SCROLL_TTL ? lastView : null
  lastView = null
  if (fromQuery) {
    const d = fromDateKey(fromQuery)
    selectedDate.value = fromQuery
    year.value = d.getFullYear()
    month.value = d.getMonth() + 1
  } else if (fresh) {
    // 详情返回：沿用离开时的选中日与列表滚动位置（月历形态按条数重新定型）
    const d = fromDateKey(fresh.date)
    selectedDate.value = fresh.date
    year.value = d.getFullYear()
    month.value = d.getMonth() + 1
    restoreTop = fresh.top
  }
  await nextTick()
  measureLayout()
  await bootstrap()
  if (restoreTop >= 0 && listEl.value) {
    listEl.value.scrollTop = restoreTop
    restoreTop = -1
  }
  window.addEventListener('resize', measureLayout)
})

onBeforeUnmount(() => {
  window.removeEventListener('resize', measureLayout)
  window.clearTimeout(skeletonTimer)
  const top = listEl.value?.scrollTop ?? 0
  lastView = { date: selectedDate.value, top, at: Date.now() }
})
</script>

<template>
  <div ref="pageEl" class="page month" :class="{ 'month--listmin': !listBelowMin }">
    <!-- v0.4.0：页面本身不滚；头部/月历/开关条/标题条固定，仅列表区独立滚动 -->
    <header ref="headEl" class="month__head">
      <button
        class="month__menu pressable"
        aria-label="打开菜单"
        @click="drawer.openDrawer('hamburger')"
      >
        <AppIcon name="list" :size="22" />
      </button>
      <button class="month__nav pressable" aria-label="上一月" @click="shift(-1)">‹</button>
      <h1 class="month__title">{{ monthTitle }}</h1>
      <button v-if="!inCurrentMonth" class="month__today pressable" @click="goToday">今天</button>
      <button class="month__nav pressable" aria-label="下一月" @click="shift(1)">›</button>
    </header>

    <section
      ref="gridWrap"
      class="month__cal"
      @touchstart.passive="onTouchStart"
      @touchend="onTouchEnd"
      @touchcancel="onTouchEnd"
    >
      <div
        class="month__grid"
        :class="{ 'month__grid--noanim': renderWeek }"
        :style="{ height: gridHeight }"
      >
        <MonthGrid
          :year="year"
          :month="month"
          :counts="gridCounts"
          :selected="selectedDate"
          :mode="renderWeek ? 'week' : 'month'"
          :week-shift="gridShift"
          :no-shift-anim="renderWeek"
          :compact="!collapsed && compactCells"
          :cell-height="!collapsed && compressedCell > 0 ? compressedCell : null"
          @select="onSelect"
        />
      </div>
    </section>

    <!-- 骨架期不暴露形态开关：数据到达定型后再淡入 -->
    <Transition name="fade">
      <button
        v-if="shapePhase === 'settled'"
        class="month__toggle pressable"
        :aria-expanded="!collapsed"
        :aria-label="collapsed ? '展开月历' : '折叠月历，只看本周'"
        @click="toggleCollapse"
      >
        <span class="month__toggle-icon" :class="{ 'month__toggle-icon--up': !collapsed }">
          <AppIcon name="chevron-down" :size="16" color="var(--color-primary)" />
        </span>
        <span class="month__toggle-text">{{ collapsed ? '展开' : '折叠' }}</span>
      </button>
    </Transition>

    <div ref="barEl" class="month__bar">
      <span class="month__bar-day">
        {{ dayTitle }}
        <span v-if="dayHolidayName" class="month__bar-holiday"> · {{ dayHolidayName }}</span>
      </span>
      <span class="month__bar-count">共 {{ dayEvents.length }} 项</span>
      <button class="month__bar-add pressable" aria-label="这一天新建日程" @click="goNew">
        ＋
      </button>
    </div>

    <div ref="listEl" class="month__body">
      <SkeletonList v-if="showSkeleton" :rows="3" />

      <StateError v-else-if="error" :text="error" @retry="load" />

      <!-- 数据到达前（<300ms 的骨架延迟窗口）既不出骨架也不出空态，避免空态闪烁 -->
      <template v-else-if="loading || dayLoading" />

      <p v-else-if="!dayEvents.length" class="month__empty">这天还没有安排</p>

      <template v-else>
        <p v-if="allDayEvents.length" class="month__group">全天</p>
        <ul class="month__list">
          <li v-for="e in allDayEvents" :key="rowKey(e)">
            <button
              class="month__row pressable"
              :aria-label="`全天 ${e.title}`"
              @click="onEventClick(e)"
            >
              <span class="month__row-allday">全天</span>
              <span
                class="month__row-title ellipsis"
                :class="{ 'month__row-title--done': e.task?.status === 'completed' }"
                >{{ e.title }}</span
              >
              <EventTypeTag :type="e.event_type" />
              <AppIcon name="chevron-right" :size="12" color="var(--text-secondary)" />
            </button>
          </li>
        </ul>

        <ul class="month__list">
          <li v-for="e in timedEvents" :key="rowKey(e)">
            <button
              class="month__row pressable"
              :aria-label="`${formatEventRange(e)} ${e.title}`"
              @click="onEventClick(e)"
            >
              <span class="month__row-time">{{ formatEventRange(e) }}</span>
              <!-- 循环身份：repeat 图标 + 「已调整」胶囊，不只靠颜色 -->
              <AppIcon
                v-if="occurrenceOf(e)"
                name="repeat"
                :size="14"
                color="var(--color-primary)"
              />
              <span
                class="month__row-title ellipsis"
                :class="{ 'month__row-title--done': e.task?.status === 'completed' }"
                >{{ e.title }}</span
              >
              <RecurrenceBadge v-if="isModified(e)" kind="modified" />
              <EventTypeTag :type="e.event_type" />
              <AppIcon name="chevron-right" :size="12" color="var(--text-secondary)" />
            </button>
          </li>
        </ul>
      </template>
    </div>
  </div>
</template>

<style scoped>
.month {
  /* 三段固定布局：页面容器不滚（禁止整页滚动/橡皮筋） */
  position: relative;
  height: 100dvh;
  max-height: 100%;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.month__head {
  flex: none;
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  height: calc(var(--navbar-height) + var(--safe-top));
  padding: var(--safe-top) var(--sp-4) 0;
  background: var(--bg-card);
}
.month__menu {
  display: flex;
  align-items: center;
  justify-content: center;
  min-width: 44px;
  min-height: 44px;
  margin-left: -12px;
  color: var(--text-primary);
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
/* 月历区：固定高（由脚本按可用空间算出，空间不足时压缩行高），折叠时裁切溢出 */
.month__cal {
  flex: none;
  background: var(--bg-card);
  overflow: hidden;
  border-bottom: 1px solid var(--border-color);
}
.month__grid {
  transition: height var(--dur-page) ease-out;
}
/* 智能定型/折叠动画结束后的内容切换不再 animate，避免一周行出现回弹 */
.month__grid--noanim {
  transition: none;
}
/* 折叠开关条：视觉 32pt，热区 ≥44pt；位置始终在月历下沿 */
.month__toggle {
  flex: none;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: var(--sp-1);
  width: 100%;
  min-height: 44px;
  background: var(--bg-card);
  border-bottom: 1px solid var(--border-color);
}
.month__toggle-icon {
  display: inline-flex;
  transition: transform var(--dur-page) ease-out;
}
.month__toggle-icon--up {
  transform: rotate(180deg);
}
.month__toggle-text {
  font-size: var(--font-caption);
  color: var(--text-secondary);
}
/* 标题条：固定高 44pt，白底 + 底部 1pt 分隔（页面不滚，无需 sticky） */
.month__bar {
  flex: none;
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  min-height: 44px;
  padding: 0 var(--sp-4);
  background: var(--bg-card);
  border-bottom: 1px solid var(--border-color);
}
.month__bar-day {
  font-size: var(--font-body-m);
  font-weight: 600;
}
/* 法定节假日名追加（与「休」角标同源，不受农历开关控制） */
.month__bar-holiday {
  color: var(--color-holiday);
  font-weight: 500;
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
/* 列表区：唯一滚动容器（flex 占满剩余高度，独立滚动防穿透） */
.month__body {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
  overscroll-behavior: contain;
  background: var(--bg-page);
  padding-bottom: calc(var(--sp-8) + var(--safe-bottom));
}
/* 空间充足时按设计保证列表区 ≥38dvh（不足时由月格下限兜底） */
.month--listmin .month__body {
  min-height: var(--calendar-list-min-height);
}
.month__group {
  padding: var(--sp-2) var(--sp-4) var(--sp-1);
  font-size: var(--font-caption);
  line-height: var(--font-caption-lh);
  color: var(--text-secondary);
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
.month__list + .month__list {
  margin-top: var(--sp-2);
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
/* 全天行：浅灰底「全天」徽标（复用 allday 底色） */
.month__row-allday {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 84px;
  flex-shrink: 0;
  min-height: 22px;
  border-radius: 6px;
  background: var(--color-allday-bg);
  font-size: var(--font-caption);
  color: var(--text-secondary);
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
/* 智能定型后开关条淡入（形态本身无过渡，避免弹动） */
.fade-enter-active,
.fade-leave-active {
  transition: opacity var(--dur-fast) ease;
}
.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>