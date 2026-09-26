<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, nextTick, reactive, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import * as eventApi from '@/api/events'
import { errorText } from '@/api/client'
import type { CalendarEvent, MonthDayCount, Occurrence } from '@/types'
import {
  buildMonthGrid,
  diffDays,
  formatEventRange,
  formatMonthTitle,
  fromDateKey,
  toDateKey,
} from '@/utils/time'
import {
  DRAG_OBSERVE_PX,
  DRAG_DIRECTION_RATIO,
  LIST_TOP_TOLERANCE,
  SETTLE_MS,
  clamp,
  easeOutCubic,
  mapProgress,
  settleTarget,
} from '@/utils/shape'
import AppIcon from '@/components/AppIcon.vue'
import FloatingTodayButton from '@/components/calendar/FloatingTodayButton.vue'
import MonthGrid from '@/components/calendar/MonthGrid.vue'
import RecurrenceBadge from '@/components/calendar/RecurrenceBadge.vue'
import SkeletonList from '@/components/SkeletonList.vue'
import StateError from '@/components/StateError.vue'
import { useEventSyncStore } from '@/stores/eventSync'
import { useDrawerStore } from '@/stores/drawer'
import type { GestureOrigin, GestureResult } from '@/utils/telemetry'
import { gestureDirection, logShapeGesture, logShapeGestureDropped } from '@/utils/telemetry'

/**
 * 日程主页（v0.6.0 CAL-01 / CAL-02；v0.9.0 CAL-04 跟手联动）。
 *
 * - 头部仅「菜单 · 月份 · ＋（最右）」；换月靠左右滑动与点补位日；
 * - 删除列表标题行；选中日 ≠ 今天时右下角显示浮动「今日」；
 * - 折叠/展开为**位移连续驱动**：p∈[0,1] 由手指纵向位移映射，跟手期间阻止列表滚动，
 *   松手吸附到 0 或 1，到位后无缝交还列表滚动；起手区域扩展为「日历区 ∪ 列表顶部」。
 */
const router = useRouter()
const route = useRoute()
const eventSync = useEventSyncStore()
const drawer = useDrawerStore()

const today = new Date()
const year = ref(today.getFullYear())
const month = ref(today.getMonth() + 1)
const selectedDate = ref(toDateKey(today))

/** 折叠态（纯内存 UI 态；首次进入恒为展开） */
const collapsed = ref(false)
/** 吸附/回弹动画进行中：忽略新手势 */
const animating = ref(false)
/** 折叠到位后只渲染选中周（跟手期间保持整月渲染，避免重渲染跳变） */
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
const gridWrap = ref<HTMLElement | null>(null)
/** 月历高度容器：跟手期间直写 height */
const gridEl = ref<HTMLElement | null>(null)
/** 月历容器宽度（中栏内容宽）：折叠/展开高度都由它推导，横竖屏切换同样成立 */
const containerWidth = ref(0)
const pageHeight = ref(0)
const headHeight = ref(0)
/** .grid__week 周标题行高度 */
const WEEK_HEAD_H = 28
/** .grid__days 底部内边距 */
const GRID_PAD_BOTTOM = 8
/** 与 --page-padding 一致（网格左右内边距） */
const GRID_PADDING = 16
/** 与 --grid-cell-min 一致：展开态空间不足时单格高度下限 */
const GRID_CELL_MIN = 36
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
/** 月历可用竖向空间 = 页面高 − 头部 */
const gridAvailable = computed(() => Math.max(0, pageHeight.value - headHeight.value))
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
/** 浮动「今日」按钮显隐：选中日 ≠ 今天（无论是否同月） */
const isSelectedToday = computed(() => selectedDate.value === toDateKey(new Date()))

/** 选中日在其所在月网格中的行号（0..5），折叠跟手位移用 */
const weekIndex = computed(() => {
  const gridStart = buildMonthGrid(year.value, month.value)[0]
  return Math.max(0, Math.floor(diffDays(gridStart, fromDateKey(selectedDate.value)) / 7))
})

const gridHeight = computed(() => {
  // 显式像素高度才能触发 height 过渡（auto 无法插值）
  if (collapsed.value) return weekHeight.value ? `${weekHeight.value}px` : undefined
  return expandedHeight.value ? `${expandedHeight.value}px` : undefined
})

/** 折叠态可见格子的标记点来源：选中日所在周可能跨两个月 */
const gridCounts = computed<MonthDayCount[]>(() => {
  if (!collapsed.value) return counts.value
  return weekMonthKeys().flatMap(({ y, m }) => countsCache[cacheKey(y, m)] || [])
})

function measureLayout(): void {
  const page = pageEl.value
  if (page) pageHeight.value = page.clientHeight
  const head = headEl.value
  if (head) headHeight.value = head.offsetHeight
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

/** 首屏：并行拉当日列表 + 当月计数；默认展开，不按条数自动折叠 */
async function bootstrap(): Promise<void> {
  loading.value = true
  error.value = ''
  beginSkeleton()
  const key = cacheKey(year.value, month.value)
  const [dayRes, monthRes] = await Promise.allSettled([
    fetchDay(),
    ensureCounts(year.value, month.value),
  ])

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

  loading.value = false
  endSkeleton()
  await nextTick()
  measureLayout()
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

/** 形态已定型后的加载分发（重试 / 翻周 / 翻月 / 点格） */
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

/** 左右滑动：折叠态翻周，展开态翻月 */
function shift(delta: number): void {
  if (collapsed.value) shiftWeek(delta)
  else shiftMonth(delta)
}

/** 浮动「今日」：日期/月历/列表回到今天，不改变日历形态 */
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

/* ================= v0.9.0（CAL-04）折叠/展开跟手联动 ================= */

type GestureLock = 'none' | 'vertical' | 'horizontal'

interface ShapeGesture {
  startX: number
  startY: number
  /** 相邻两次 move 的基准（观察期结束时对齐） */
  lastDy: number
  lastY: number
  lastT: number
  velocity: number
  lock: GestureLock
  origin: GestureOrigin
  /** 是否已接管形态（日历区 / 列表顶部 + 纵向锁定） */
  tookOver: boolean
  /** 是否已提交形态（到达端点） */
  committed: boolean
  startP: number
  /** p 触达端点时的 dy 与当时 scrollTop（交还列表滚动的基准） */
  endpointDy: number
  handoffBaseScroll: number
  /* ----- v0.9.0 埋点采样（TC-AUDIT-082：方向 / 帧率采样） ----- */
  /** 最近一次 move 的净纵向位移（判定方向） */
  netDy: number
  /** 已采样到的跟手帧数（每次写形态算一帧） */
  frames: number
  /** 首个跟手帧的时间戳（帧率采样起点） */
  firstFrameAt: number
  /** 帧率采样结果（已计算后复用，避免重复结算） */
  fps: number
}

/** 当前进度（仅在跟手/动画期间由脚本维护；提交后同步为 0/1） */
let dragP = 1
let shapeGesture: ShapeGesture | null = null
let motionRaf = 0

/** 行程：展开态与折叠态的高度差 */
function progressRange(): number {
  return Math.max(1, expandedHeight.value - weekHeight.value)
}

/** 起手点在其所在端的 p 值（未接管时按当前形态估算） */
function currentP(): number {
  return collapsed.value ? 0 : 1
}

/** 跟手期间逐帧直写（rAF 合并，无 CSS transition） */
function applyDragFrame(p: number): void {
  const el = gridEl.value
  if (!el) return
  // 埋点采样（TC-AUDIT-082）：跟手帧数按实际写形态的次数计，用于估算跟手帧率
  const g = shapeGesture
  if (g) {
    if (!g.frames) g.firstFrameAt = performance.now()
    g.frames += 1
  }
  const h = weekHeight.value + p * (expandedHeight.value - weekHeight.value)
  const shift = (1 - p) * weekIndex.value * effectiveCell.value
  el.classList.add('month__grid--dragging')
  el.style.height = h ? `${h}px` : ''
  el.style.setProperty('--shape-shift', `${shift}px`)
}

/** 提交/复位后按响应式状态写回静态高度与位移（归零且无 transition） */
function applyStatic(): void {
  const el = gridEl.value
  if (!el) return
  const h = collapsed.value ? weekHeight.value : expandedHeight.value
  el.classList.add('month__grid--dragging')
  el.style.height = h ? `${h}px` : ''
  el.style.setProperty('--shape-shift', '0px')
  // 下一帧解除过渡锁定：静态阶段由 CSS 过渡接管（值已相同，不产生动效）
  requestAnimationFrame(() => {
    el.classList.remove('month__grid--dragging')
  })
}

function beginGesture(t: Touch, origin: GestureOrigin): void {
  if (animating.value) {
    // 埋点（TC-AUDIT-083）：动画互斥导致丢弃
    shapeGesture = null
    logShapeDropped('animating', origin)
    return
  }
  dragP = currentP()
  shapeGesture = {
    startX: t.clientX,
    startY: t.clientY,
    lastDy: 0,
    lastY: t.clientY,
    lastT: performance.now(),
    velocity: 0,
    lock: 'none',
    origin,
    tookOver: false,
    committed: false,
    startP: dragP,
    endpointDy: 0,
    handoffBaseScroll: listEl.value?.scrollTop ?? 0,
    netDy: 0,
    frames: 0,
    firstFrameAt: 0,
    fps: 0,
  }
}

/* ---- v0.9.0：形态手势埋点（D-09：开发期日志 + 测试断言，无上报通道） ---- */

/** 手势被丢弃（TC-AUDIT-083）：方向锁 / 多指 / 动画互斥 */
function logShapeDropped(
  reason: 'direction_lock' | 'multi_touch' | 'animating',
  origin: GestureOrigin
): void {
  logShapeGestureDropped(reason, origin)
}

/**
 * 跟手帧率采样（TC-AUDIT-082）：按「写形态的帧数 / 采样时长」估算，
 * 跟手期间每个 move 写一帧，等价于跟手帧率；未接管（帧数 0）时记 0。
 */
function sampleFps(g: ShapeGesture): number {
  if (g.fps) return g.fps
  if (g.frames < 1 || !g.firstFrameAt) return 0
  const elapsed = performance.now() - g.firstFrameAt
  g.fps = elapsed > 0 ? Math.round((g.frames * 1000) / elapsed) : 0
  return g.fps
}

/** 一次手势一条（TC-AUDIT-082）：方向 / 起手区 / 是否接管 / 吸附结果 / 帧率采样 */
function logGesture(g: ShapeGesture, result: GestureResult): void {
  logShapeGesture({
    direction: gestureDirection(g.netDy),
    origin: g.origin,
    tookOver: g.tookOver,
    result,
    frames: g.frames,
    fps: sampleFps(g),
    durationMs: g.firstFrameAt ? Math.round(performance.now() - g.firstFrameAt) : 0,
  })
}

function onListTouchStart(e: TouchEvent): void {
  const t = e.touches[0]
  if (!t) return
  const top = (listEl.value?.scrollTop ?? 0) <= LIST_TOP_TOLERANCE
  beginGesture(t, top ? 'list-top' : 'list-mid')
}

function onCalTouchStart(e: TouchEvent): void {
  const t = e.touches[0]
  if (!t) return
  beginSwipe(t)
  beginGesture(t, 'calendar')
}

function onShapeTouchMove(e: TouchEvent): void {
  const g = shapeGesture
  if (!g) return
  // 多指中断：取消本次手势，回弹到起手端（不残留半开）
  if (e.touches.length > 1) {
    cancelGesture()
    return
  }
  const t = e.touches[0]
  if (!t) return
  const dx = t.clientX - g.startX
  const dy = t.clientY - g.startY
  g.netDy = dy

  // 速度采样（最近窗口）
  const now = performance.now()
  if (now - g.lastT >= 16) {
    g.velocity = (t.clientY - g.lastY) / Math.max(1, now - g.lastT)
    g.lastY = t.clientY
    g.lastT = now
  }

  if (g.lock === 'none') {
    if (Math.abs(dx) < DRAG_OBSERVE_PX && Math.abs(dy) < DRAG_OBSERVE_PX) return
    g.lock = Math.abs(dy) > DRAG_DIRECTION_RATIO * Math.abs(dx) ? 'vertical' : 'horizontal'
    g.lastDy = dy // 观察期结束点作为跟手基准
    // 埋点（TC-AUDIT-083）：方向锁判为横向 → 形态手势被丢弃（交还横滑换期）
    if (g.lock === 'horizontal') logShapeDropped('direction_lock', g.origin)
    // 接管条件：日历区任意纵向；列表顶部仅在「能驱动形态」的方向接管
    // （展开态需上滑折叠、折叠态需下拉展开；反向位移不接管，交回列表滚动）
    const wantsExpand = dragP < 0.5
    const directionFits = wantsExpand ? dy > 0 : dy < 0
    const canTakeOver =
      g.lock === 'vertical' &&
      (g.origin === 'calendar' || (g.origin === 'list-top' && directionFits))
    if (canTakeOver) {
      g.tookOver = true
      // 接管的第一帧就阻止原生滚动，避免浏览器在该帧已开始滚动后无法回退
      e.preventDefault()
      // 展开方向起手：若当前只渲染选中周，起手即恢复整月渲染，避免跳变
      if (renderWeek.value) {
        renderWeek.value = false
        applyDragFrame(dragP)
      }
    }
    return // 本帧不推进 p（观察期内不跟手）
  }
  if (g.lock !== 'vertical' || !g.tookOver) return // 列表中部：只滚动，不接管

  if (!g.committed) {
    e.preventDefault() // 跟手期间阻止原生滚动
    const dDy = dy - g.lastDy
    g.lastDy = dy
    dragP = mapProgress(dragP, dDy, progressRange())
    applyDragFrame(dragP)
    if (dragP <= 0) commitCollapse(g, dy)
    else if (dragP >= 1) commitExpand(g, dy)
    return
  }
  // 已提交：残余位移交还列表滚动（脚本滚动，原生滚动已被 preventDefault 抑制）
  e.preventDefault()
  const el = listEl.value
  if (!el) return
  const max = el.scrollHeight - el.clientHeight
  el.scrollTop = clamp(g.handoffBaseScroll + (g.endpointDy - dy), 0, Math.max(0, max))
}

/** p 触达折叠端点：提交折叠并开始交还列表滚动 */
function commitCollapse(g: ShapeGesture, dy: number): void {
  dragP = 0
  g.committed = true
  g.endpointDy = dy
  g.handoffBaseScroll = listEl.value?.scrollTop ?? 0
  collapsed.value = true
  renderWeek.value = true
  applyStatic()
  void loadCollapsed()
}

/** p 触达展开端点：提交展开并开始交还列表滚动 */
function commitExpand(g: ShapeGesture, dy: number): void {
  dragP = 1
  g.committed = true
  g.endpointDy = dy
  g.handoffBaseScroll = listEl.value?.scrollTop ?? 0
  collapsed.value = false
  renderWeek.value = false
  applyStatic()
  void loadExpanded()
}

/** 中断（多指/取消）：回弹到最近一次已吸附的合法态，不残留半开 */
function cancelGesture(): void {
  const g = shapeGesture
  if (!g) return
  shapeGesture = null
  // 埋点（TC-AUDIT-083）：多指打断 → 丢弃记录；已接管则回弹到起手端
  logShapeDropped('multi_touch', g.origin)
  // 观察期内即被打断（lock='none'）不算一次手势，与抬起路径同口径
  if (g.lock !== 'none' || g.committed) {
    logGesture(g, g.committed ? gestureCommitResult() : g.tookOver ? 'rebound' : 'none')
  }
  if (g.committed || !g.tookOver) return
  const target: 0 | 1 = g.startP >= 0.5 ? 1 : 0
  animateTo(target)
}

/** 已提交形态对应的结果枚举 */
function gestureCommitResult(): GestureResult {
  return collapsed.value ? 'collapse' : 'expand'
}

function onShapeTouchEnd(): void {
  const g = shapeGesture
  shapeGesture = null
  if (!g) return
  // 未接管（列表中部竖向、或横滑）时不结算形态，交回原生滚动/翻期
  // 观察期内即抬起（点按/轻触）不算一次手势，不落埋点
  if (g.lock === 'none' && !g.committed) return
  if (!g.tookOver) {
    logGesture(g, 'none')
    return
  }
  if (g.committed) {
    logGesture(g, gestureCommitResult())
    animating.value = false
    return
  }
  const target = settleTarget(dragP, g.startP, g.velocity)
  logGesture(g, target === g.startP ? 'rebound' : target === 0 ? 'collapse' : 'expand')
  animateTo(target)
}

/** 日历区抬手：先结算形态手势，再处理横滑换期 */
function onCalTouchEnd(e: TouchEvent): void {
  onShapeTouchEnd()
  onSwipeTouchEnd(e)
}

/** rAF ease-out 补间（≤250ms）；prefers-reduced-motion 下即时到位 */
function animateTo(target: 0 | 1): void {
  cancelAnimationFrame(motionRaf)
  const reduced =
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  const from = dragP
  if (from === target || reduced) {
    finishAt(target)
    return
  }
  animating.value = true
  const startAt = performance.now()
  const step = (now: number): void => {
    const t = clamp((now - startAt) / SETTLE_MS, 0, 1)
    dragP = from + (target - from) * easeOutCubic(t)
    applyDragFrame(dragP)
    if (t < 1) {
      motionRaf = requestAnimationFrame(step)
      return
    }
    finishAt(target)
  }
  motionRaf = requestAnimationFrame(step)
}

/** 动画结束：切渲染 + 加载数据 + 归零位移 */
function finishAt(target: 0 | 1): void {
  dragP = target
  if (target === 0) {
    collapsed.value = true
    renderWeek.value = true
    applyStatic()
    void loadCollapsed()
  } else {
    collapsed.value = false
    renderWeek.value = false
    applyStatic()
    void loadExpanded()
  }
  animating.value = false
}

function goNew(): void {
  router.push(`/calendar/new?date=${selectedDate.value}`)
}

/* ---- 左右滑动：展开态翻月 / 折叠态翻周（纵向锁定前仍生效） ---- */
let swipeStartX = 0
let swipeStartY = 0
let swipeActive = false

function beginSwipe(t: Touch): void {
  // 屏幕边缘 20px 起手让给浏览器返回/前进手势
  if (t.clientX < 20 || t.clientX > window.innerWidth - 20) {
    swipeActive = false
    return
  }
  swipeStartX = t.clientX
  swipeStartY = t.clientY
  swipeActive = true
}

function onSwipeTouchEnd(e: TouchEvent): void {
  if (!swipeActive) return
  swipeActive = false
  const g = shapeGesture
  // 已接管形态的手势不翻期（起手区与形态手势互斥）
  if (g && g.tookOver) return
  const t = e.changedTouches[0]
  if (!t) return
  const dx = t.clientX - swipeStartX
  const dy = t.clientY - swipeStartY
  // 横向位移足够且明显横滑才切换，避免与纵向滚动冲突
  if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy)) shift(dx < 0 ? 1 : -1)
}

/* ---- v0.4.0：详情返回恢复列表滚动位置（内存态，5 分钟内有效） ---- */

const SCROLL_TTL = 5 * 60 * 1000
/** 列表滚动位置 + 选中日 + 日历形态（组件离开即销毁，故放模块级；不做持久化） */
let lastView: { date: string; top: number; collapsed: boolean; at: number } | null = null
const listEl = ref<HTMLElement | null>(null)
/** 待恢复的滚动位置：数据渲染后再落位 */
let restoreTop = -1

/* ---- 全天置顶分组 + 定时按开始时间升序 ---- */
const allDayEvents = computed(() => dayEvents.value.filter((e) => e.all_day))
const timedEvents = computed(() => dayEvents.value.filter((e) => !e.all_day))

/* ---- v0.6.0：循环实例识别与跳转 ---- */

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

/** v0.3.0：列表 item 统一直达详情（普通日程 → 详情；循环实例 → 实例视角详情） */
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
    // 详情返回：沿用离开时的选中日、列表滚动位置与日历形态
    const d = fromDateKey(fresh.date)
    selectedDate.value = fresh.date
    year.value = d.getFullYear()
    month.value = d.getMonth() + 1
    collapsed.value = fresh.collapsed
    renderWeek.value = fresh.collapsed
    restoreTop = fresh.top
  }
  await nextTick()
  measureLayout()
  dragP = collapsed.value ? 0 : 1
  if (collapsed.value) await loadCollapsed()
  else await bootstrap()
  applyStatic()
  if (restoreTop >= 0 && listEl.value) {
    listEl.value.scrollTop = restoreTop
    restoreTop = -1
  }
  window.addEventListener('resize', measureLayout)
})

onBeforeUnmount(() => {
  window.removeEventListener('resize', measureLayout)
  window.clearTimeout(skeletonTimer)
  cancelAnimationFrame(motionRaf)
  shapeGesture = null
  const top = listEl.value?.scrollTop ?? 0
  lastView = {
    date: selectedDate.value,
    top,
    collapsed: collapsed.value,
    at: Date.now(),
  }
})
</script>

<template>
  <div ref="pageEl" class="page month" :class="{ 'month--listmin': !listBelowMin }">
    <!-- v0.6.0：头部固定三元素「菜单 · 月份 · ＋」，换月靠左右滑动 -->
    <header ref="headEl" class="month__head">
      <button
        class="month__menu pressable"
        aria-label="打开菜单"
        @click="drawer.openDrawer('hamburger')"
      >
        <AppIcon name="list" :size="22" />
      </button>
      <h1 class="month__title">{{ monthTitle }}</h1>
      <button class="month__add pressable" aria-label="在选中日期新建日程" @click="goNew">
        <AppIcon name="plus" :size="22" />
      </button>
    </header>

    <!-- 日历区：既可跟手折叠/展开，也保留横滑换期与点选日期 -->
    <section
      ref="gridWrap"
      class="month__cal"
      @touchstart="onCalTouchStart"
      @touchmove="onShapeTouchMove"
      @touchend="onCalTouchEnd"
      @touchcancel="onCalTouchEnd"
    >
      <div ref="gridEl" class="month__grid" :style="{ height: gridHeight }">
        <MonthGrid
          :year="year"
          :month="month"
          :counts="gridCounts"
          :selected="selectedDate"
          :mode="renderWeek ? 'week' : 'month'"
          :compact="!collapsed && compactCells"
          :cell-height="!collapsed && compressedCell > 0 ? compressedCell : null"
          @select="onSelect"
        />
      </div>
    </section>

    <!-- 列表区（无标题行）：顶部上滑折叠 / 下拉展开，中部只滚动 -->
    <div
      ref="listEl"
      class="month__body"
      @touchstart="onListTouchStart"
      @touchmove="onShapeTouchMove"
      @touchend="onShapeTouchEnd"
      @touchcancel="onShapeTouchEnd"
    >
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
              <span class="month__row-title ellipsis">{{ e.title }}</span>
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
              <span class="month__row-title ellipsis">{{ e.title }}</span>
              <RecurrenceBadge v-if="isModified(e)" kind="modified" />
              <AppIcon name="chevron-right" :size="12" color="var(--text-secondary)" />
            </button>
          </li>
        </ul>
      </template>
    </div>

    <!-- 选中日 ≠ 今天：右下角浮动「今日」 -->
    <Transition name="today-fab">
      <FloatingTodayButton v-if="!isSelectedToday" @click="goToday" />
    </Transition>
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
.month__menu,
.month__add {
  display: flex;
  align-items: center;
  justify-content: center;
  min-width: 44px;
  min-height: 44px;
  color: var(--text-primary);
}
.month__menu {
  margin-left: -12px;
}
.month__add {
  margin-right: -12px;
  color: var(--color-primary);
}
.month__title {
  flex: 1;
  text-align: center;
  font-size: var(--font-heading-m);
  line-height: var(--font-heading-m-lh);
  font-weight: 600;
}
/* 月历区：固定高（由脚本按可用空间算出，空间不足时压缩行高），折叠时裁切溢出 */
.month__cal {
  flex: none;
  background: var(--bg-card);
  overflow: hidden;
  border-bottom: 1px solid var(--border-color);
  /* 纵向交给脚本（跟手），横滑由脚本处理 */
  touch-action: pan-y;
}
.month__grid {
  transition: height var(--dur-page) ease-out;
}
/* 跟手/复位期间由脚本逐帧直写，禁用过渡避免与位移脱帧 */
.month__grid--dragging {
  transition: none;
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
/* 浮动今日按钮淡入淡出 */
.today-fab-enter-active,
.today-fab-leave-active {
  transition: opacity var(--dur-fast) ease;
}
.today-fab-enter-from,
.today-fab-leave-to {
  opacity: 0;
}
</style>
