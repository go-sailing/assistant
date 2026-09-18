<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import * as eventApi from '@/api/events'
import { errorText } from '@/api/client'
import type {
  LunarResolved,
  MonthRuleType,
  RecurEndType,
  RecurFreq,
  RecurrenceRule,
} from '@/types'
import { parseDate, toDateKey } from '@/utils/time'
import AppButton from '@/components/AppButton.vue'
import AppIcon from '@/components/AppIcon.vue'
import SegmentedControl from '@/components/SegmentedControl.vue'

const props = withDefaults(
  defineProps<{
    visible: boolean
    /** 首次开始时间（ISO）：默认星期 / 月内规则与预览均由它推导 */
    firstStart: string
    /** 首次结束时间（ISO），用于预览时段 */
    firstEnd?: string
    allDay?: boolean
    /** 已设置规则时回填（重新打开弹层 / 编辑整条系列） */
    initial?: RecurrenceRule | null
  }>(),
  { firstEnd: '', allDay: false, initial: null }
)

const emit = defineEmits<{
  /** rule 为待提交规则；preview 为端上按同一规则拼装的预览摘要（最终展示以服务端 recurrence_summary 为准） */
  (e: 'confirm', rule: RecurrenceRule, preview: string): void
  (e: 'cancel'): void
}>()

const FREQ_OPTIONS = [
  { label: '每天', value: 'daily' },
  { label: '每周', value: 'weekly' },
  { label: '每月', value: 'monthly' },
  { label: '每年', value: 'yearly' },
]

/** 星期 chips 周一起始，值为 0..6（0 = 周日） */
const WEEK_CHIPS = [
  { label: '一', value: 1 },
  { label: '二', value: 2 },
  { label: '三', value: 3 },
  { label: '四', value: 4 },
  { label: '五', value: 5 },
  { label: '六', value: 6 },
  { label: '日', value: 0 },
]
const WORK_DAYS = [1, 2, 3, 4, 5]

const WEEKDAY_CN = ['日', '一', '二', '三', '四', '五', '六']
const ORD_OPTIONS: { label: string; value: -1 | 1 | 2 | 3 | 4 }[] = [
  { label: '第一个', value: 1 },
  { label: '第二个', value: 2 },
  { label: '第三个', value: 3 },
  { label: '第四个', value: 4 },
  { label: '最后一个', value: -1 },
]

const MIN_INTERVAL = 1
const MAX_INTERVAL = 99
const MAX_COUNT = 730
const MAX_UNTIL_YEARS = 5
/** 已录入法定安排的年份上限（2026 已录入；超过则按周一至周五回退并提示） */
const PUBLISHED_YEAR = 2026

/** v0.4.0：每周三选一（① 指定星期 ② 字面一至五 ③ 法定工作日） */
type WeekMode = 'pick' | 'mon_fri' | 'workdays_cn'
/** v0.4.0：每年三选一（① 跟随首次日期 ② 指定公历月日 ③ 指定农历月日） */
type YearMode = 'first' | 'solar' | 'lunar'

/** 农历月名（正月…腊月，不含闰月） */
const LUNAR_MONTH_LABELS = [
  '正月',
  '二月',
  '三月',
  '四月',
  '五月',
  '六月',
  '七月',
  '八月',
  '九月',
  '十月',
  '冬月',
  '腊月',
]

/** 农历日名（初一…三十）：固定 30 项，不随月份动态减项（小月回落由提示与预览承担） */
function lunarDayLabel(n: number): string {
  const digits = ['十', '一', '二', '三', '四', '五', '六', '七', '八', '九']
  if (n <= 10) return `初${digits[n % 10]}`
  if (n < 20) return `十${digits[n - 10]}`
  if (n === 20) return '二十'
  if (n < 30) return `廿${digits[n - 20]}`
  return '三十'
}
const LUNAR_DAY_LABELS = Array.from({ length: 30 }, (_, i) => lunarDayLabel(i + 1))

const freq = ref<RecurFreq>('weekly')
const interval = ref(1)
const weekDays = ref<number[]>([])
/** 用户手动改过星期后，开始时间变化不再覆盖勾选 */
const weekTouched = ref(false)
/** v0.4.0：每周三选一 */
const weekMode = ref<WeekMode>('pick')
const monthMode = ref<MonthRuleType>('day_of_month')
const monthDayInput = ref('1')
const monthOrd = ref<-1 | 1 | 2 | 3 | 4>(1)
const monthWeekday = ref(1)
/** v0.3.0：yearly 指定的公历月、日（1..12 / 1..31） */
const yearMonth = ref(1)
const yearDay = ref(1)
/** 用户手动改过年度月日后，开始时间变化不再覆盖 */
const yearlyTouched = ref(false)
/** v0.4.0：每年三选一 + 农历月日（1..12 / 1..30） */
const yearMode = ref<YearMode>('first')
const lunarMonth = ref(1)
const lunarDay = ref(1)
const endType = ref<RecurEndType>('never')
const countInput = ref('10')
const until = ref('')

/* ---------------- v0.4.0 农历年度循环预览（服务端换算，端上不推测） ---------------- */

const lunarPreview = ref<LunarResolved[]>([])
const lunarPreviewLoading = ref(false)
const lunarPreviewError = ref('')
let lunarTimer = 0

/** 农历预览生效条件：每年 + 指定农历月日 */
const lunarPreviewActive = computed(() => freq.value === 'yearly' && yearMode.value === 'lunar')

/** 换算失败/加载中禁止保存（宁停不猜，不凭端上猜测提交公历日期） */
const lunarBlocked = computed(
  () =>
    lunarPreviewActive.value &&
    (lunarPreviewLoading.value || !!lunarPreviewError.value || !lunarPreview.value.length)
)

async function fetchLunarPreview(): Promise<void> {
  lunarPreviewLoading.value = true
  lunarPreviewError.value = ''
  try {
    const res = await eventApi.resolveLunar({
      lunarYear: new Date().getFullYear(),
      month: lunarMonth.value,
      day: lunarDay.value,
      n: 3,
      anchor: firstKey.value,
    })
    lunarPreview.value = res || []
  } catch (e) {
    lunarPreview.value = []
    lunarPreviewError.value = errorText(e)
  } finally {
    lunarPreviewLoading.value = false
  }
}

/** 月日变化后防抖 200ms 换算（避免连点下拉狂发请求） */
function scheduleLunarPreview(): void {
  window.clearTimeout(lunarTimer)
  if (!lunarPreviewActive.value) {
    lunarPreview.value = []
    lunarPreviewError.value = ''
    lunarPreviewLoading.value = false
    return
  }
  lunarTimer = window.setTimeout(() => void fetchLunarPreview(), 200)
}

/** 预览行：`2027 年 公历 2 月 5 日（周五）· 除夕`（无节日只显示周几） */
const lunarPreviewRows = computed(() =>
  lunarPreview.value.map((r) => {
    const [y, m, d] = r.gregorian_date.split('-').map(Number)
    const festival = r.festival ? ` · ${r.festival}` : ''
    return `${y} 年 公历 ${m} 月 ${d} 日（周${WEEKDAY_CN[r.weekday]}）${festival}`
  })
)

const firstDate = computed(() => parseDate(props.firstStart) || new Date())
const firstKey = computed(() => toDateKey(firstDate.value))
/** 截止日期上限：首次日期 + 5 年 */
const untilMax = computed(() => {
  const d = new Date(firstDate.value)
  d.setFullYear(d.getFullYear() + MAX_UNTIL_YEARS)
  return toDateKey(d)
})

function daysInMonth(year: number, month: number): number {
  return new Date(year, month + 1, 0).getDate()
}

/** 首次日期所在星期在一个月内的序数（5 视为"最后一个"） */
function defaultOrd(): -1 | 1 | 2 | 3 | 4 {
  const n = Math.ceil(firstDate.value.getDate() / 7)
  if (n >= 5) return -1
  return n as 1 | 2 | 3 | 4
}

/** 每次打开都按当前首次时间与已选规则重置内部状态 */
function reset(): void {
  const init = props.initial
  freq.value = init?.freq ?? 'weekly'
  interval.value = init?.interval && init.interval > 0 ? Math.min(init.interval, MAX_INTERVAL) : 1
  const days = init?.by_week_days?.length ? [...init.by_week_days] : [firstDate.value.getDay()]
  weekDays.value = days
  weekTouched.value = !!init?.by_week_days?.length
  // v0.4.0 每周三选一回填：workdays_cn > 恰为 [1..5] > 指定星期
  if (init?.week_mode === 'workdays_cn') weekMode.value = 'workdays_cn'
  else if (sameWorkDays(init?.by_week_days)) weekMode.value = 'mon_fri'
  else weekMode.value = 'pick'
  monthMode.value = init?.month_rule?.type ?? 'day_of_month'
  monthDayInput.value = String(init?.month_rule?.day ?? firstDate.value.getDate())
  monthOrd.value = init?.month_rule?.ord ?? defaultOrd()
  monthWeekday.value = init?.month_rule?.weekday ?? firstDate.value.getDay()
  // 存量系列无 by_month_day：回填首次开始日期的月日（与引擎缺省语义一致）
  yearMonth.value = init?.by_month_day?.month ?? firstDate.value.getMonth() + 1
  yearDay.value = init?.by_month_day?.day ?? firstDate.value.getDate()
  yearlyTouched.value = !!init?.by_month_day
  // v0.4.0 每年三选一回填：农历月日 > 公历月日 > 跟随首次日期
  if (init?.by_lunar_month_day) {
    yearMode.value = 'lunar'
    lunarMonth.value = init.by_lunar_month_day.month
    lunarDay.value = init.by_lunar_month_day.day
  } else if (init?.by_month_day) {
    yearMode.value = 'solar'
  } else {
    yearMode.value = 'first'
  }
  endType.value = init?.end_type ?? 'never'
  countInput.value = String(init?.count ?? 10)
  const fallback = new Date(firstDate.value)
  fallback.setDate(fallback.getDate() + 90)
  until.value = init?.until || toDateKey(fallback)
  // 打开即按当前农历月日取一次未来实例（防抖 200ms）
  scheduleLunarPreview()
}

/** by_week_days 是否恰为周一至周五（用于回填第 2 项） */
function sameWorkDays(days?: number[]): boolean {
  if (!days || days.length !== WORK_DAYS.length) return false
  return WORK_DAYS.every((d) => days.includes(d))
}

watch(
  () => props.visible,
  (v) => {
    if (v) reset()
  }
)

/** 农历月日/模式变化 → 防抖换算预览 */
watch([lunarPreviewActive, lunarMonth, lunarDay], () => {
  if (props.visible) scheduleLunarPreview()
})

onBeforeUnmount(() => window.clearTimeout(lunarTimer))

/* ---------------- 校验 ---------------- */

const weekError = computed(() =>
  freq.value === 'weekly' && weekMode.value === 'pick' && !weekDays.value.length
    ? '请至少选择一个星期'
    : ''
)
const monthDayError = computed(() => {
  if (freq.value !== 'monthly' || monthMode.value !== 'day_of_month') return ''
  const n = Number(monthDayInput.value)
  return Number.isInteger(n) && n >= 1 && n <= 31 ? '' : '日期需在 1 ~ 31 之间'
})
const countError = computed(() => {
  if (endType.value !== 'count') return ''
  const n = Number(countInput.value)
  return Number.isInteger(n) && n >= 1 && n <= MAX_COUNT ? '' : `次数需在 1 ~ ${MAX_COUNT} 之间`
})
const untilError = computed(() => {
  if (endType.value !== 'until') return ''
  if (!until.value) return '请选择截止日期'
  if (until.value < firstKey.value) return '截止日期不能早于首次日期'
  if (until.value > untilMax.value) return `截止日期不能超过首次日期后 ${MAX_UNTIL_YEARS} 年`
  return ''
})

const valid = computed(
  () =>
    !weekError.value &&
    !monthDayError.value &&
    !countError.value &&
    !untilError.value &&
    !lunarBlocked.value
)

/** 法定工作日模式：interval 只允许为 1（>1 服务端返回 4011） */
const intervalLocked = computed(
  () => freq.value === 'weekly' && weekMode.value === 'workdays_cn'
)

/** 法定工作日 + until 跨入未公布年份：提示按周一至周五回退（文案带 until 年份） */
const workdaysNotice = computed(() => {
  if (!intervalLocked.value || endType.value !== 'until' || !until.value) return ''
  const y = Number(until.value.slice(0, 4))
  if (!y || y <= PUBLISHED_YEAR) return ''
  return `${y} 年安排公布前按周一至周五计算，公布后自动按法定工作日执行`
})

/** 当前生效的星期集合（第 2 项固定为字面一至五） */
const effectiveWeekDays = computed(() =>
  weekMode.value === 'mon_fri' ? [...WORK_DAYS] : weekDays.value
)

/* ---------------- 规则与预览 ---------------- */

function buildRule(): RecurrenceRule {
  const rule: RecurrenceRule = {
    freq: freq.value,
    interval: intervalLocked.value ? 1 : interval.value,
    end_type: endType.value,
  }
  if (freq.value === 'weekly') {
    // v0.4.0：法定工作日只带 week_mode（与 by_week_days 互斥）；第 2 项输出字面一至五
    if (weekMode.value === 'workdays_cn') rule.week_mode = 'workdays_cn'
    else if (weekMode.value === 'mon_fri') rule.by_week_days = [...WORK_DAYS]
    else rule.by_week_days = [...weekDays.value].sort((a, b) => a - b)
  }
  if (freq.value === 'monthly') {
    rule.month_rule =
      monthMode.value === 'day_of_month'
        ? { type: 'day_of_month', day: Number(monthDayInput.value) }
        : { type: 'day_of_week', ord: monthOrd.value, weekday: monthWeekday.value }
  }
  // v0.4.0：年度三选一——跟随首次日期则两个字段都不传（沿用服务端缺省语义）
  if (freq.value === 'yearly') {
    if (yearMode.value === 'solar') rule.by_month_day = { month: yearMonth.value, day: yearDay.value }
    else if (yearMode.value === 'lunar')
      rule.by_lunar_month_day = { month: lunarMonth.value, day: lunarDay.value }
  }
  if (endType.value === 'count') rule.count = Number(countInput.value)
  if (endType.value === 'until') rule.until = until.value
  return rule
}

function pad(n: number): string {
  return n < 10 ? `0${n}` : String(n)
}

function clockText(d: Date): string {
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** 本地预览用的人话时段（服务端同源文案以 recurrence_summary 为准） */
function previewTimeText(): string {
  if (props.allDay) return ''
  const s = firstDate.value
  const e = parseDate(props.firstEnd)
  if (!e) return clockText(s)
  return `${clockText(s)}–${clockText(e)}`
}

function mondayOf(d: Date): number {
  const c = new Date(d.getFullYear(), d.getMonth(), d.getDate())
  c.setDate(c.getDate() - ((c.getDay() + 6) % 7))
  return c.getTime()
}

function nthWeekdayMatches(d: Date, ord: number, weekday: number): boolean {
  if (d.getDay() !== weekday) return false
  if (ord === -1) return d.getDate() + 7 > daysInMonth(d.getFullYear(), d.getMonth())
  return Math.ceil(d.getDate() / 7) === ord
}

/**
 * 本地预览用的规则匹配：仅 RepeatSheet 内实时预览（次数 / 摘要）使用，
 * 端上不引入 rrule，也不把它当作最终数据（服务端返回的 recurrence_summary 才是唯一展示来源）。
 */
function matchesDay(d: Date, rule: RecurrenceRule): boolean {
  const anchor = firstDate.value
  const gap = Math.max(1, rule.interval || 1)
  if (rule.freq === 'daily') {
    const dayDiff = Math.round(
      (new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime() -
        new Date(anchor.getFullYear(), anchor.getMonth(), anchor.getDate()).getTime()) /
        86400000
    )
    return dayDiff >= 0 && dayDiff % gap === 0
  }
  const weekDiff = Math.round((mondayOf(d) - mondayOf(anchor)) / (7 * 86400000))
  if (weekDiff < 0 || weekDiff % gap !== 0) return false
  if (rule.freq === 'weekly') {
    // 法定工作日：端上无假日数据，次数估算按周一至周五近似（权威摘要由服务端下发）
    if (rule.week_mode === 'workdays_cn') return d.getDay() >= 1 && d.getDay() <= 5
    return (rule.by_week_days ?? [anchor.getDay()]).includes(d.getDay())
  }
  const monthDiff = (d.getFullYear() - anchor.getFullYear()) * 12 + (d.getMonth() - anchor.getMonth())
  if (monthDiff < 0) return false
  if (rule.freq === 'monthly') {
    if (monthDiff % gap !== 0) return false
    const mr = rule.month_rule
    if (!mr || mr.type === 'day_of_month') {
      const target = Math.min(mr?.day ?? anchor.getDate(), daysInMonth(d.getFullYear(), d.getMonth()))
      return d.getDate() === target
    }
    return nthWeekdayMatches(d, mr.ord ?? defaultOrd(), mr.weekday ?? anchor.getDay())
  }
  // yearly：优先用指定月日（缺省回退首次月日），月内无该日时落到月末
  const yearDiff = d.getFullYear() - anchor.getFullYear()
  if (yearDiff < 0 || yearDiff % gap !== 0) return false
  const bmd = rule.by_month_day
  const ym = bmd?.month ?? anchor.getMonth() + 1
  const yd = bmd?.day ?? anchor.getDate()
  if (d.getMonth() + 1 !== ym) return false
  return d.getDate() === Math.min(yd, daysInMonth(d.getFullYear(), ym))
}

/** 截止日期前的发生次数（本地估算，仅用于预览"共 N 次"） */
function previewCount(rule: RecurrenceRule): number {
  if (rule.end_type === 'count') return rule.count ?? 1
  const limit = rule.until ?? ''
  const cursor = new Date(firstDate.value)
  let n = 0
  // 逐日扫描上限 3000 天，避免规则异常时死循环
  for (let i = 0; i < 3000; i += 1) {
    if (limit && toDateKey(cursor) > limit) break
    if (matchesDay(cursor, rule)) n += 1
    cursor.setDate(cursor.getDate() + 1)
  }
  return n
}

/** 预览摘要：与后端 summary 同构的人话文案（本地拼装仅供预览） */
const previewSummary = computed(() => {
  const rule = buildRule()
  const weekLabels = WEEK_CHIPS.filter((c) => effectiveWeekDays.value.includes(c.value)).map(
    (c) => `周${c.label}`
  )

  let head = ''
  let yearlyNote = ''
  if (rule.freq === 'daily') {
    head = rule.interval > 1 ? `每 ${rule.interval} 天` : '每天'
  } else if (rule.freq === 'weekly') {
    head = intervalLocked.value
      ? '每个工作日'
      : `${rule.interval > 1 ? `每 ${rule.interval} 周` : '每'}${weekLabels.join('、')}`
  } else if (rule.freq === 'monthly') {
    const mr = rule.month_rule
    if (!mr || mr.type === 'day_of_month') {
      const day = mr?.day ?? firstDate.value.getDate()
      head = `每月 ${day} 日${day >= 29 ? '（遇到小月落到当月最后一天）' : ''}`
    } else {
      const ord = ORD_OPTIONS.find((o) => o.value === mr.ord)?.label ?? '第一个'
      head = `每月${ord}周${WEEKDAY_CN[mr.weekday ?? 0]}`
    }
  } else if (yearMode.value === 'lunar') {
    // v0.4.0：农历年度循环（公历日期逐年不同，权威结果以服务端换算为准）
    head = `每年农历${LUNAR_MONTH_LABELS[lunarMonth.value - 1]}${lunarDayLabel(lunarDay.value)}`
  } else {
    // v0.3.0：年度月日取指定值（与后端 summary 同构）；跟随首次日期时取首次月日
    const m = yearMode.value === 'solar' ? yearMonth.value : firstDate.value.getMonth() + 1
    const d = yearMode.value === 'solar' ? yearDay.value : firstDate.value.getDate()
    head = `每年 ${m} 月 ${d} 日`
    // 29/30/31 的月末括注与后端一致，缀于摘要末尾
    yearlyNote =
      m === 2 && d === 29
        ? '（平年安排在 2 月 28 日）'
        : d >= 29
          ? '（遇到小月落到当月最后一天）'
          : ''
  }

  let tail = ''
  if (rule.end_type === 'never') tail = '长期重复'
  else if (rule.end_type === 'count') tail = `共 ${rule.count ?? 0} 次`
  else if (rule.week_mode === 'workdays_cn') {
    // 法定工作日的次数依赖节假日/调休数据，端上无法准确估算：
    // 这里不给数字，避免显示一个与真实展开不符的"共 N 次"（权威摘要由服务端下发）
    tail = `至 ${rule.until} 止`
  } else tail = `至 ${rule.until} 止，共 ${previewCount(rule)} 次`

  // 与后端文案一致：定时日程「频率 + 空格 + 时段」，全天单独成段；年度括注缀于末尾
  const base = props.allDay
    ? `${head}，全天，${tail}`
    : `${head} ${previewTimeText()}，${tail}`
  return `${base}${yearlyNote}`
})

/* ---------------- 交互 ---------------- */

/** 日选择 29/30/31 时的月末弱提示（仅公历指定月日时需要） */
const yearDayHint = computed(() =>
  yearDay.value >= 29 ? '当月没有这一天时，将安排在当月最后一天' : ''
)

/**
 * 首次安排预览（端上唯一允许的年规则推算，仅用于提示跨年，权威结果以服务端为准）：
 * 候选年从开始日期的年起按 interval 递增，取指定公历月日（回落月末）不早于开始日期的第一个。
 * 仅当落在开始日期之后的年份时才展示该行；农历模式改用服务端换算的实例预览。
 */
const yearFirstOccurrence = computed(() => {
  if (freq.value !== 'yearly' || yearMode.value !== 'solar') return null
  const anchor = firstDate.value
  const anchorMs = new Date(anchor.getFullYear(), anchor.getMonth(), anchor.getDate()).getTime()
  const gap = Math.max(1, interval.value || 1)
  for (let i = 0; i < 100; i += 1) {
    const y = anchor.getFullYear() + i * gap
    const day = Math.min(yearDay.value, daysInMonth(y, yearMonth.value - 1))
    const candidate = new Date(y, yearMonth.value - 1, day)
    if (candidate.getTime() >= anchorMs) {
      return candidate.getFullYear() > anchor.getFullYear() ? candidate : null
    }
  }
  return null
})

const yearFirstOccurrenceText = computed(() => {
  const d = yearFirstOccurrence.value
  if (!d) return ''
  return `首次安排：${d.getFullYear()} 年 ${d.getMonth() + 1} 月 ${d.getDate()} 日 周${
    WEEKDAY_CN[d.getDay()]
  }`
})

function onFreqChange(v: string): void {
  freq.value = v as RecurFreq
}

function changeInterval(delta: number): void {
  if (intervalLocked.value) return
  const next = interval.value + delta
  if (next < MIN_INTERVAL || next > MAX_INTERVAL) return
  interval.value = next
}

function toggleWeekDay(day: number): void {
  if (weekMode.value !== 'pick') return
  weekTouched.value = true
  const set = new Set(weekDays.value)
  if (set.has(day)) set.delete(day)
  else set.add(day)
  weekDays.value = [...set]
}

function confirm(): void {
  if (!valid.value) return
  emit('confirm', buildRule(), previewSummary.value)
}

// 用户未手动改过星期/年度月日时，开始时间变化同步默认值（UX 5.3 / 5.4）
watch(
  () => props.firstStart,
  () => {
    if (!props.visible) return
    if (!weekTouched.value) weekDays.value = [firstDate.value.getDay()]
    if (!yearlyTouched.value) {
      yearMonth.value = firstDate.value.getMonth() + 1
      yearDay.value = firstDate.value.getDate()
    }
  }
)
</script>

<template>
  <Transition name="sheet">
    <div v-if="visible" class="rep" role="dialog" aria-modal="true" aria-label="重复设置">
      <div class="rep__mask" @click="emit('cancel')" />

      <div class="rep__panel sheet-panel">
        <span class="rep__grabber" aria-hidden="true" />
        <header class="rep__head">
          <button class="rep__head-btn pressable" @click="emit('cancel')">取消</button>
          <h2 class="rep__head-title">重复设置</h2>
          <button
            class="rep__head-btn rep__head-btn--primary pressable"
            :disabled="!valid"
            @click="confirm"
          >
            完成
          </button>
        </header>

        <div class="rep__body">
          <section class="rep__block">
            <h3 class="rep__label">频率</h3>
            <SegmentedControl :model-value="freq" :options="FREQ_OPTIONS" @update:model-value="onFreqChange" />
          </section>

          <section v-if="freq !== 'yearly'" class="rep__block">
            <div class="rep__stepper-row">
              <span class="rep__label">每</span>
              <div class="rep__stepper">
                <button
                  class="rep__step pressable"
                  aria-label="减少间隔"
                  :disabled="interval <= MIN_INTERVAL || intervalLocked"
                  @click="changeInterval(-1)"
                >
                  －
                </button>
                <span class="rep__step-value">{{ intervalLocked ? 1 : interval }}</span>
                <button
                  class="rep__step pressable"
                  aria-label="增加间隔"
                  :disabled="interval >= MAX_INTERVAL || intervalLocked"
                  @click="changeInterval(1)"
                >
                  ＋
                </button>
              </div>
              <span class="rep__label">{{ freq === 'daily' ? '天' : freq === 'weekly' ? '周' : '月' }}重复</span>
            </div>
            <p v-if="intervalLocked" class="rep__hint">法定工作日暂不支持隔周</p>
          </section>

          <!-- v0.4.0：每周三选一（第 1 项与星期 chips 为从属关系，未选中时 chips 置灰） -->
          <section v-if="freq === 'weekly'" class="rep__block">
            <h3 class="rep__label">重复于</h3>
            <div role="radiogroup" aria-label="每周重复方式">
              <label class="rep__radio-row">
                <input
                  v-model="weekMode"
                  class="rep__radio"
                  type="radio"
                  name="week-mode"
                  value="pick"
                />
                <span class="rep__radio-text">每周指定星期</span>
              </label>
              <div class="rep__chips rep__sub" role="group" aria-label="重复的星期">
                <button
                  v-for="c in WEEK_CHIPS"
                  :key="c.value"
                  class="rep__chip pressable"
                  :class="{ 'rep__chip--on': weekMode === 'pick' && weekDays.includes(c.value) }"
                  :aria-pressed="weekMode === 'pick' && weekDays.includes(c.value)"
                  :aria-disabled="weekMode !== 'pick'"
                  :disabled="weekMode !== 'pick'"
                  :aria-label="`周${c.label}`"
                  @click="toggleWeekDay(c.value)"
                >
                  <span class="rep__chip-inner">{{ c.label }}</span>
                </button>
              </div>
              <p v-if="weekError" class="rep__error rep__sub">{{ weekError }}</p>
              <label class="rep__radio-row">
                <input
                  v-model="weekMode"
                  class="rep__radio"
                  type="radio"
                  name="week-mode"
                  value="mon_fri"
                />
                <span class="rep__radio-text">周一至周五</span>
              </label>
              <label class="rep__radio-row">
                <input
                  v-model="weekMode"
                  class="rep__radio"
                  type="radio"
                  name="week-mode"
                  value="workdays_cn"
                />
                <span class="rep__radio-text">工作日（法定）</span>
              </label>
              <p class="rep__hint rep__sub">避开法定节假日，调休补班日照常</p>
            </div>
          </section>

          <section v-if="freq === 'monthly'" class="rep__block">
            <h3 class="rep__label">每月重复于</h3>
            <label class="rep__radio-row">
              <input
                v-model="monthMode"
                class="rep__radio"
                type="radio"
                name="month-mode"
                value="day_of_month"
              />
              <span class="rep__radio-text">每月</span>
              <input
                v-model="monthDayInput"
                class="rep__num"
                type="number"
                min="1"
                max="31"
                aria-label="每月的日"
              />
              <span class="rep__radio-text">日</span>
            </label>
            <label class="rep__radio-row">
              <input
                v-model="monthMode"
                class="rep__radio"
                type="radio"
                name="month-mode"
                value="day_of_week"
              />
              <span class="rep__radio-text">第</span>
              <select v-model="monthOrd" class="rep__select" aria-label="第几个星期">
                <option v-for="o in ORD_OPTIONS" :key="o.value" :value="o.value">{{ o.label }}</option>
              </select>
              <select v-model="monthWeekday" class="rep__select" aria-label="星期">
                <option v-for="(w, i) in WEEKDAY_CN" :key="i" :value="i">周{{ w }}</option>
              </select>
            </label>
            <p v-if="monthDayError" class="rep__error">{{ monthDayError }}</p>
          </section>

          <section v-if="freq === 'yearly'" class="rep__block">
            <h3 class="rep__label">每年重复于</h3>
            <div role="radiogroup" aria-label="每年重复方式">
              <label class="rep__radio-row">
                <input
                  v-model="yearMode"
                  class="rep__radio"
                  type="radio"
                  name="year-mode"
                  value="first"
                />
                <span class="rep__radio-text">
                  跟随首次日期（公历 {{ firstDate.getMonth() + 1 }} 月 {{ firstDate.getDate() }} 日）
                </span>
              </label>

              <label class="rep__radio-row">
                <input
                  v-model="yearMode"
                  class="rep__radio"
                  type="radio"
                  name="year-mode"
                  value="solar"
                />
                <span class="rep__radio-text">指定公历月日</span>
              </label>
              <div class="rep__year-row rep__sub">
                <select
                  v-model.number="yearMonth"
                  class="rep__select"
                  aria-label="每年重复的月份"
                  :aria-disabled="yearMode !== 'solar'"
                  :disabled="yearMode !== 'solar'"
                  @change="yearlyTouched = true"
                >
                  <option v-for="m in 12" :key="m" :value="m">{{ m }} 月</option>
                </select>
                <select
                  v-model.number="yearDay"
                  class="rep__select"
                  aria-label="每年重复的日期"
                  :aria-disabled="yearMode !== 'solar'"
                  :disabled="yearMode !== 'solar'"
                  @change="yearlyTouched = true"
                >
                  <option v-for="d in 31" :key="d" :value="d">{{ d }} 日</option>
                </select>
              </div>
              <p v-if="yearMode === 'solar' && yearDayHint" class="rep__hint rep__sub">
                {{ yearDayHint }}
              </p>

              <label class="rep__radio-row">
                <input
                  v-model="yearMode"
                  class="rep__radio"
                  type="radio"
                  name="year-mode"
                  value="lunar"
                />
                <span class="rep__radio-text">指定农历月日</span>
              </label>
              <div class="rep__year-row rep__sub">
                <select
                  v-model.number="lunarMonth"
                  class="rep__select"
                  aria-label="农历月份"
                  :aria-disabled="yearMode !== 'lunar'"
                  :disabled="yearMode !== 'lunar'"
                >
                  <option v-for="(label, i) in LUNAR_MONTH_LABELS" :key="i" :value="i + 1">
                    {{ label }}
                  </option>
                </select>
                <select
                  v-model.number="lunarDay"
                  class="rep__select"
                  aria-label="农历日期"
                  :aria-disabled="yearMode !== 'lunar'"
                  :disabled="yearMode !== 'lunar'"
                >
                  <option v-for="(label, i) in LUNAR_DAY_LABELS" :key="i" :value="i + 1">
                    {{ label }}
                  </option>
                </select>
              </div>
              <p v-if="yearMode === 'lunar'" class="rep__hint rep__sub">
                遇农历小月按当月最后一天（廿九）
              </p>
            </div>
          </section>

          <section class="rep__block">
            <h3 class="rep__label">结束</h3>
            <label class="rep__radio-row">
              <input v-model="endType" class="rep__radio" type="radio" name="end-type" value="never" />
              <span class="rep__radio-text">永不结束</span>
            </label>
            <label class="rep__radio-row">
              <input v-model="endType" class="rep__radio" type="radio" name="end-type" value="count" />
              <span class="rep__radio-text">重复</span>
              <input
                v-model="countInput"
                class="rep__num"
                type="number"
                min="1"
                :max="MAX_COUNT"
                aria-label="重复次数"
              />
              <span class="rep__radio-text">次</span>
            </label>
            <label class="rep__radio-row">
              <input v-model="endType" class="rep__radio" type="radio" name="end-type" value="until" />
              <span class="rep__radio-text">截止到</span>
              <input
                v-model="until"
                class="rep__date"
                type="date"
                aria-label="截止日期"
                :min="firstKey"
                :max="untilMax"
              />
            </label>
            <p v-if="countError" class="rep__error">{{ countError }}</p>
            <p v-if="untilError" class="rep__error">{{ untilError }}</p>
          </section>

          <section class="rep__block rep__block--preview">
            <h3 class="rep__label">预览</h3>
            <p class="rep__preview">
              <AppIcon name="repeat" :size="14" color="var(--color-primary)" />
              <span class="rep__preview-text">{{ previewSummary }}</span>
            </p>

            <!-- 法定工作日跨入未公布年份：回退规则提示 -->
            <p v-if="workdaysNotice" class="rep__notice">
              <AppIcon name="alert" :size="14" color="var(--color-notice-text)" />
              <span>{{ workdaysNotice }}</span>
            </p>

            <p v-if="yearFirstOccurrenceText" class="rep__first">{{ yearFirstOccurrenceText }}</p>

            <!-- v0.4.0 农历年度循环：未来 3 个候选由服务端换算，失败则禁止保存 -->
            <div v-if="lunarPreviewActive" class="rep__lunar" aria-live="polite">
              <template v-if="lunarPreviewLoading">
                <p class="rep__lunar-caption">换算中…</p>
                <span v-for="i in 3" :key="i" class="rep__lunar-skeleton" aria-hidden="true" />
              </template>
              <p v-else-if="lunarPreviewError" class="rep__lunar-error">暂无法换算，请稍后重试</p>
              <ul v-else class="rep__lunar-list">
                <li v-for="(row, i) in lunarPreviewRows" :key="i" class="rep__lunar-row">
                  {{ row }}
                </li>
              </ul>
            </div>
          </section>
        </div>

        <div class="rep__foot">
          <AppButton type="primary" :disabled="!valid" @click="confirm">保存规则</AppButton>
        </div>
      </div>
    </div>
  </Transition>
</template>

<style scoped>
.rep {
  position: fixed;
  inset: 0;
  z-index: 200;
  display: flex;
  flex-direction: column;
  justify-content: flex-end;
}
.rep__mask {
  position: absolute;
  inset: 0;
  background: rgba(26, 29, 38, 0.45);
}
.rep__panel {
  position: relative;
  display: flex;
  flex-direction: column;
  max-height: 92%;
  background: var(--bg-card);
  border-radius: 16px 16px 0 0;
}
.rep__grabber {
  width: 36px;
  height: 4px;
  margin: var(--sp-2) auto 0;
  border-radius: 2px;
  background: var(--border-color);
}
.rep__head {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  min-height: 48px;
  padding: 0 var(--sp-4);
  border-bottom: 1px solid var(--border-color);
}
.rep__head-btn {
  min-width: 56px;
  min-height: 44px;
  text-align: left;
  font-size: var(--font-body-l);
  color: var(--text-secondary);
}
.rep__head-btn--primary {
  text-align: right;
  color: var(--color-primary);
  font-weight: 500;
}
.rep__head-btn:disabled {
  color: var(--text-disabled);
}
.rep__head-title {
  flex: 1;
  text-align: center;
  font-size: var(--font-body-l);
  line-height: var(--font-body-l-lh);
  font-weight: 600;
}
.rep__body {
  flex: 1;
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
  padding-bottom: var(--sp-3);
}
.rep__block {
  padding: var(--sp-3) var(--sp-4);
  border-bottom: 1px solid var(--border-color);
}
.rep__block--preview {
  border-bottom: none;
}
.rep__label {
  font-size: var(--font-caption);
  line-height: var(--font-caption-lh);
  color: var(--text-secondary);
  margin-bottom: var(--sp-2);
}
.rep__stepper-row {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
}
.rep__stepper-row .rep__label {
  margin-bottom: 0;
  font-size: var(--font-body-m);
  color: var(--text-primary);
}
.rep__stepper {
  display: flex;
  align-items: center;
  border: 1px solid var(--border-color);
  border-radius: var(--radius-control);
  overflow: hidden;
}
.rep__step {
  width: 44px;
  min-height: 44px;
  font-size: var(--font-body-l);
  color: var(--color-primary);
}
.rep__step:disabled {
  color: var(--text-disabled);
}
.rep__step-value {
  min-width: 44px;
  text-align: center;
  font-size: var(--font-body-m);
  font-variant-numeric: tabular-nums;
}
.rep__chips {
  display: flex;
  gap: var(--sp-2);
}
.rep__chip {
  flex: 1;
  min-height: 44px;
  display: flex;
  align-items: center;
  justify-content: center;
}
.rep__chip-inner {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border-radius: 16px;
  border: 1px solid var(--border-color);
  background: var(--bg-card);
  font-size: var(--font-body-m);
  color: var(--text-primary);
}
.rep__chip--on .rep__chip-inner {
  background: var(--color-primary-light);
  border-color: var(--color-primary);
  color: var(--color-primary);
  font-weight: 600;
}
/* 从属控件缩进 12pt；未选中时置灰不可点（UXUI 5.3/5.4） */
.rep__sub {
  padding-left: 12px;
}
.rep__chips.rep__sub {
  margin-bottom: var(--sp-2);
}
.rep__year-row.rep__sub {
  margin-bottom: var(--sp-2);
}
.rep__hint.rep__sub,
.rep__error.rep__sub {
  padding-left: 12px;
}
.rep__chip:disabled .rep__chip-inner {
  background: var(--bg-page);
  border-color: var(--border-color);
  color: var(--text-disabled);
  font-weight: 400;
}
.rep__radio-row {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  min-height: 44px;
}
.rep__radio {
  width: 18px;
  height: 18px;
  flex-shrink: 0;
  accent-color: var(--color-primary);
}
.rep__radio-text {
  font-size: var(--font-body-m);
  color: var(--text-primary);
}
.rep__num {
  width: 64px;
  min-height: 36px;
  padding: 0 var(--sp-2);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-control);
  background: var(--bg-page);
  text-align: center;
  font-size: var(--font-body-m);
  font-variant-numeric: tabular-nums;
}
.rep__select {
  min-height: 36px;
  padding: 0 var(--sp-2);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-control);
  background: var(--bg-page);
  font-size: var(--font-body-m);
}
/* 从属下拉未选中时置灰不可点 */
.rep__select:disabled {
  color: var(--text-disabled);
  opacity: 0.6;
}
.rep__date {
  flex: 1;
  min-height: 36px;
  padding: 0 var(--sp-2);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-control);
  background: var(--bg-page);
  font-size: var(--font-body-m);
}
/* v0.3.0：年度月日双下拉（复用 select 样式，高度 ≥36pt） */
.rep__year-row {
  display: flex;
  gap: var(--sp-3);
}
.rep__hint {
  margin-top: var(--sp-2);
  font-size: var(--font-caption);
  line-height: var(--font-caption-lh);
  color: var(--text-secondary);
}
/* 指定月日本年已过时明示首次安排（避免"设了 6 月今年却看不到"） */
.rep__first {
  margin-top: var(--sp-2);
  font-size: var(--font-caption);
  line-height: var(--font-caption-lh);
  color: var(--color-success);
}
/* 法定工作日跨入未公布年份的回退提示（浅黄底信息条，样式同 v0.3.0 首次安排行） */
.rep__notice {
  display: flex;
  align-items: flex-start;
  gap: 6px;
  margin-top: var(--sp-2);
  padding: var(--sp-2) var(--sp-3);
  border-radius: var(--radius-card);
  background: var(--color-notice-bg);
  color: var(--color-notice-text);
  font-size: var(--font-caption);
  line-height: var(--font-caption-lh);
}
/* 农历年度循环的未来实例预览（服务端换算） */
.rep__lunar {
  margin-top: var(--sp-2);
}
.rep__lunar-list {
  display: flex;
  flex-direction: column;
  gap: var(--sp-1);
}
.rep__lunar-row {
  font-size: var(--font-caption);
  line-height: var(--font-caption-lh);
  color: var(--text-primary);
  font-variant-numeric: tabular-nums;
}
.rep__lunar-caption {
  font-size: var(--font-caption);
  line-height: var(--font-caption-lh);
  color: var(--text-secondary);
}
.rep__lunar-skeleton {
  display: block;
  height: 12px;
  margin-top: var(--sp-2);
  border-radius: 6px;
  background: #eceef4;
  animation: rep-pulse 1.4s ease-in-out infinite;
}
.rep__lunar-error {
  font-size: var(--font-caption);
  line-height: var(--font-caption-lh);
  color: var(--color-danger);
}
@keyframes rep-pulse {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.5;
  }
}
.rep__error {
  margin-top: var(--sp-1);
  font-size: var(--font-caption);
  line-height: var(--font-caption-lh);
  color: var(--color-danger);
}
.rep__preview {
  display: flex;
  align-items: flex-start;
  gap: var(--sp-2);
  padding: var(--sp-3);
  background: var(--color-primary-light);
  border-radius: var(--radius-card);
  font-size: var(--font-body-m);
  line-height: var(--font-body-m-lh);
  color: var(--text-primary);
}
.rep__preview-text {
  flex: 1;
  min-width: 0;
  word-break: break-word;
}
.rep__foot {
  padding: var(--sp-3) var(--sp-4) calc(var(--sp-3) + var(--safe-bottom));
  border-top: 1px solid var(--border-color);
}
.sheet-enter-active,
.sheet-leave-active {
  transition: opacity 220ms ease;
}
.sheet-enter-active .rep__panel,
.sheet-leave-active .rep__panel {
  transition: transform 220ms ease;
}
.sheet-enter-from,
.sheet-leave-to {
  opacity: 0;
}
.sheet-enter-from .rep__panel,
.sheet-leave-to .rep__panel {
  transform: translateY(100%);
}
</style>
