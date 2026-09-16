import type { Task } from '@/types'

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

/** 是否逾期（未完成且截止时间早于当前） */
export function isOverdue(task: Pick<Task, 'status' | 'due_at'>): boolean {
  if (task.status === 'completed') return false
  const d = parseDate(task.due_at)
  return !!d && d.getTime() < Date.now()
}

/** 是否今天截止（未完成、截止时间在今天之内） */
export function isDueToday(task: Pick<Task, 'status' | 'due_at'>): boolean {
  if (task.status === 'completed') return false
  const d = parseDate(task.due_at)
  return !!d && dayDiff(d) === 0
}

/** 逾期天数（不足 1 天按 1 天计） */
export function overdueDays(iso: string | null | undefined): number {
  const d = parseDate(iso)
  if (!d) return 0
  const ms = Date.now() - d.getTime()
  if (ms <= 0) return 0
  return Math.max(1, Math.ceil(ms / 86400000))
}

/** 副标题时间颜色类型 */
export type TimeTone = 'normal' | 'danger' | 'warning'

export function dueTone(task: Pick<Task, 'status' | 'due_at' | 'completed_at'>): TimeTone {
  if (task.status === 'completed') return 'normal'
  if (isOverdue(task)) return 'danger'
  if (isDueToday(task)) return 'warning'
  return 'normal'
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