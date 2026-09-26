import type { CalendarEvent } from '@/types'

/** ISO8601 UTC 字符串 → 本地 Date */
export function parseDate(iso: string | null | undefined): Date | null {
  if (!iso) return null
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? null : d
}

function pad(n: number): string {
  return n < 10 ? `0${n}` : String(n)
}

/** 当天零点（本地时区） */
function startOfDay(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
}

/** 相差天数：0 今天、1 明天、-1 昨天 */
function dayDiff(d: Date): number {
  return Math.round((startOfDay(d) - startOfDay(new Date())) / 86400000)
}

/** 是否零点的"仅日期"截止时间（视为未指定具体时刻） */
function isDateOnly(d: Date): boolean {
  return d.getHours() === 0 && d.getMinutes() === 0
}

/** 单日文案：今天 / 明天 / 昨天 / MM-DD / YYYY-MM-DD */
function dayLabel(d: Date): string {
  const diff = dayDiff(d)
  if (diff === 0) return '今天'
  if (diff === 1) return '明天'
  if (diff === -1) return '昨天'
  const ymd = `${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
  return d.getFullYear() === new Date().getFullYear()
    ? ymd
    : `${d.getFullYear()}-${ymd}`
}

/**
 * 截止时间展示（UX 7.2）：
 * 今天 HH:mm / 明天 HH:mm / 昨天 HH:mm / MM-DD HH:mm / YYYY-MM-DD HH:mm
 * 无具体时刻时只展示日期部分。
 */
export function formatDue(iso: string | null | undefined): string {
  const d = parseDate(iso)
  if (!d) return '未设置截止时间'
  const label = dayLabel(d)
  if (isDateOnly(d)) return label
  return `${label} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** 完整时间：YYYY-MM-DD HH:mm */
export function formatFull(iso: string | null | undefined): string {
  const d = parseDate(iso)
  if (!d) return '-'
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(
    d.getMinutes()
  )}`
}

/** 简短时间：MM-DD HH:mm（跨年带年份） */
export function formatShort(iso: string | null | undefined): string {
  const d = parseDate(iso)
  if (!d) return '-'
  const md = `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(
    d.getMinutes()
  )}`
  return d.getFullYear() === new Date().getFullYear() ? md : `${d.getFullYear()}-${md}`
}

/** 会话时间分隔条：今天 HH:mm / 昨天 HH:mm / YYYY-MM-DD */
export function formatDaySeparator(iso: string): string {
  const d = parseDate(iso)
  if (!d) return ''
  const label = dayLabel(d)
  if (label === '今天' || label === '昨天') {
    return `${label} ${pad(d.getHours())}:${pad(d.getMinutes())}`
  }
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** 会话列表时间：今天 → HH:mm；昨天 → 昨天；本年 → MM-DD；跨年 → YYYY-MM-DD */
export function formatListTime(iso: string): string {
  const d = parseDate(iso)
  if (!d) return ''
  const diff = dayDiff(d)
  if (diff === 0) return `${pad(d.getHours())}:${pad(d.getMinutes())}`
  if (diff === -1) return '昨天'
  const md = `${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
  return d.getFullYear() === new Date().getFullYear() ? md : `${d.getFullYear()}-${md}`
}

/** Date → 提交给后端的 ISO8601 UTC 字符串 */
export function toIso(d: Date): string {
  return d.toISOString()
}

/** ISO → datetime-local 输入框值（本地时区） */
export function toLocalInputValue(iso: string | null | undefined): string {
  const d = parseDate(iso)
  if (!d) return ''
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(
    d.getHours()
  )}:${pad(d.getMinutes())}`
}

/** datetime-local 输入值 → ISO UTC */
export function fromLocalInputValue(v: string): string | null {
  if (!v) return null
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? null : d.toISOString()
}

/* ---------------- 日程（v0.1.0） ---------------- */

const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']

/** Date → YYYY-MM-DD（本地时区） */
export function toDateKey(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** YYYY-MM-DD → 本地零点的 Date */
export function fromDateKey(key: string): Date {
  const [y, m, d] = key.split('-').map(Number)
  return new Date(y, (m ?? 1) - 1, d ?? 1)
}

/** 日期标题：M月D日 周X（今天/明天/昨天时附加提示） */
export function formatDayTitle(key: string): string {
  const d = fromDateKey(key)
  const base = `${d.getMonth() + 1}月${d.getDate()}日 ${WEEKDAYS[d.getDay()]}`
  const diff = Math.round((startOfDay(d) - startOfDay(new Date())) / 86400000)
  if (diff === 0) return `${base} 今天`
  if (diff === 1) return `${base} 明天`
  if (diff === -1) return `${base} 昨天`
  return base
}

/**
 * v0.3.0 日程主页标题条（去重）：月/年由头部承载，这里只表达「相对日 + 星期 + 日序」
 * 今天 → `今天 周三`；明天/昨天同理；其余 → `周三 17 日`
 */
export function formatDayBarTitle(key: string): string {
  const d = fromDateKey(key)
  const weekday = WEEKDAYS[d.getDay()]
  const diff = Math.round((startOfDay(d) - startOfDay(new Date())) / 86400000)
  if (diff === 0) return `今天 ${weekday}`
  if (diff === 1) return `明天 ${weekday}`
  if (diff === -1) return `昨天 ${weekday}`
  return `${weekday} ${d.getDate()} 日`
}

/** 月视图标题：YYYY年M月 */
export function formatMonthTitle(year: number, month: number): string {
  return `${year}年${month}月`
}

/** 时段：HH:mm–HH:mm；全天返回「全天」；跨日追加「(次日)」或「–M月D日」 */
export function formatEventRange(event: Pick<CalendarEvent, 'start_at' | 'end_at' | 'all_day'>): string {
  const s = parseDate(event.start_at)
  const e = parseDate(event.end_at)
  if (!s || !e) return ''
  if (event.all_day) return '全天'
  const start = `${pad(s.getHours())}:${pad(s.getMinutes())}`
  const end = `${pad(e.getHours())}:${pad(e.getMinutes())}`
  if (toDateKey(s) !== toDateKey(e)) {
    const dayGap = Math.round((startOfDay(e) - startOfDay(s)) / 86400000)
    const suffix = dayGap <= 1 ? '(次日)' : ` – ${e.getMonth() + 1}月${e.getDate()}日`
    return `${start}–${end}${suffix}`
  }
  return `${start}–${end}`
}

/** 日程卡片完整时段：M月D日 周X 15:00–16:00 */
export function formatEventCardTime(event: Pick<CalendarEvent, 'start_at' | 'end_at' | 'all_day'>): string {
  const s = parseDate(event.start_at)
  if (!s) return ''
  const day = `${s.getMonth() + 1}月${s.getDate()}日 ${WEEKDAYS[s.getDay()]}`
  if (event.all_day) return `${day} 全天`
  return `${day} ${formatEventRange(event)}`
}

/** 时间轴左栏刻度：HH:mm */
export function formatClock(d: Date): string {
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** 日程是否正在进行中（当前时间落在 [start, end) 内） */
export function isOngoing(event: Pick<CalendarEvent, 'start_at' | 'end_at' | 'all_day'>): boolean {
  if (event.all_day) return false
  const s = parseDate(event.start_at)
  const e = parseDate(event.end_at)
  if (!s || !e) return false
  const now = Date.now()
  return now >= s.getTime() && now < e.getTime()
}

/** 当前时间参考线在当日时间轴中的位置比例（0~1，用于定位） */
export function nowRatio(): number {
  const d = new Date()
  return (d.getHours() * 60 + d.getMinutes()) / 1440
}

/** 月份网格：返回 6×7 = 42 个日期（含上月补位） */
export function buildMonthGrid(year: number, month: number): Date[] {
  const first = new Date(year, month - 1, 1)
  // v0.2.0：以周一为一周起点（与 UX 设计稿「一 二 … 日」及 weekly 规则的周起始一致）
  const start = new Date(first)
  start.setDate(first.getDate() - ((first.getDay() + 6) % 7))
  const days: Date[] = []
  for (let i = 0; i < 42; i += 1) {
    const d = new Date(start)
    d.setDate(start.getDate() + i)
    days.push(d)
  }
  return days
}

/**
 * v0.3.0：选中日所在自然周（周一~周日）的 7 天，供折叠态 MonthGrid 单行渲染。
 * 与 buildMonthGrid 共用同一套「周一起始」规则，保证两种形态格子位置一致。
 */
export function buildWeekGrid(dateKey: string): Date[] {
  const d = fromDateKey(dateKey)
  const monday = new Date(d)
  monday.setDate(d.getDate() - ((d.getDay() + 6) % 7))
  const days: Date[] = []
  for (let i = 0; i < 7; i += 1) {
    const day = new Date(monday)
    day.setDate(monday.getDate() + i)
    days.push(day)
  }
  return days
}

/** 两个日期相差的整天数（b - a） */
export function diffDays(a: Date, b: Date): number {
  return Math.round((startOfDay(b) - startOfDay(a)) / 86400000)
}

/** 下一整天（全天日程结束边界） */
export function nextDay(d: Date): Date {
  const next = new Date(d)
  next.setDate(d.getDate() + 1)
  return next
}