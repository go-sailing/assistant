<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { MonthRuleType, RecurEndType, RecurFreq, RecurrenceRule } from '@/types'
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

const freq = ref<RecurFreq>('weekly')
const interval = ref(1)
const weekDays = ref<number[]>([])
/** 用户手动改过星期后，开始时间变化不再覆盖勾选 */
const weekTouched = ref(false)
const monthMode = ref<MonthRuleType>('day_of_month')
const monthDayInput = ref('1')
const monthOrd = ref<-1 | 1 | 2 | 3 | 4>(1)
const monthWeekday = ref(1)
const endType = ref<RecurEndType>('never')
const countInput = ref('10')
const until = ref('')

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
  monthMode.value = init?.month_rule?.type ?? 'day_of_month'
  monthDayInput.value = String(init?.month_rule?.day ?? firstDate.value.getDate())
  monthOrd.value = init?.month_rule?.ord ?? defaultOrd()
  monthWeekday.value = init?.month_rule?.weekday ?? firstDate.value.getDay()
  endType.value = init?.end_type ?? 'never'
  countInput.value = String(init?.count ?? 10)
  const fallback = new Date(firstDate.value)
  fallback.setDate(fallback.getDate() + 90)
  until.value = init?.until || toDateKey(fallback)
}

watch(
  () => props.visible,
  (v) => {
    if (v) reset()
  }
)

/* ---------------- 校验 ---------------- */

const weekError = computed(() =>
  freq.value === 'weekly' && !weekDays.value.length ? '请至少选择一个星期' : ''
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
  () => !weekError.value && !monthDayError.value && !countError.value && !untilError.value
)

/* ---------------- 规则与预览 ---------------- */

function buildRule(): RecurrenceRule {
  const rule: RecurrenceRule = {
    freq: freq.value,
    interval: interval.value,
    end_type: endType.value,
  }
  if (freq.value === 'weekly') rule.by_week_days = [...weekDays.value].sort((a, b) => a - b)
  if (freq.value === 'monthly') {
    rule.month_rule =
      monthMode.value === 'day_of_month'
        ? { type: 'day_of_month', day: Number(monthDayInput.value) }
        : { type: 'day_of_week', ord: monthOrd.value, weekday: monthWeekday.value }
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
  // yearly
  const yearDiff = d.getFullYear() - anchor.getFullYear()
  if (yearDiff < 0 || yearDiff % gap !== 0) return false
  return d.getMonth() === anchor.getMonth() && d.getDate() === anchor.getDate()
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
  const weekLabels = WEEK_CHIPS.filter((c) => weekDays.value.includes(c.value)).map((c) => `周${c.label}`)
  const isWorkDays =
    weekDays.value.length === WORK_DAYS.length && WORK_DAYS.every((d) => weekDays.value.includes(d))

  let head = ''
  if (rule.freq === 'daily') {
    head = rule.interval > 1 ? `每 ${rule.interval} 天` : '每天'
  } else if (rule.freq === 'weekly') {
    head = isWorkDays
      ? '工作日'
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
  } else {
    head = `每年 ${firstDate.value.getMonth() + 1} 月 ${firstDate.value.getDate()} 日`
  }

  let tail = ''
  if (rule.end_type === 'never') tail = '长期重复'
  else if (rule.end_type === 'count') tail = `共 ${rule.count ?? 0} 次`
  else tail = `至 ${rule.until} 止，共 ${previewCount(rule)} 次`

  // 与后端文案一致：定时日程「频率 + 空格 + 时段」，全天单独成段
  return props.allDay ? `${head}，全天，${tail}` : `${head} ${previewTimeText()}，${tail}`
})

/* ---------------- 交互 ---------------- */

function onFreqChange(v: string): void {
  freq.value = v as RecurFreq
}

function changeInterval(delta: number): void {
  const next = interval.value + delta
  if (next < MIN_INTERVAL || next > MAX_INTERVAL) return
  interval.value = next
}

function toggleWeekDay(day: number): void {
  weekTouched.value = true
  const set = new Set(weekDays.value)
  if (set.has(day)) set.delete(day)
  else set.add(day)
  weekDays.value = [...set]
}

function applyWorkDays(): void {
  weekTouched.value = true
  const allSelected = WORK_DAYS.every((d) => weekDays.value.includes(d))
  weekDays.value = allSelected
    ? weekDays.value.filter((d) => !WORK_DAYS.includes(d))
    : [...new Set([...weekDays.value, ...WORK_DAYS])]
}

function confirm(): void {
  if (!valid.value) return
  emit('confirm', buildRule(), previewSummary.value)
}

// 用户未手动改过星期时，开始时间变化同步默认勾选（UX 5.3）
watch(
  () => props.firstStart,
  () => {
    if (props.visible && !weekTouched.value) weekDays.value = [firstDate.value.getDay()]
  }
)
</script>

<template>
  <Transition name="sheet">
    <div v-if="visible" class="rep" role="dialog" aria-modal="true" aria-label="重复设置">
      <div class="rep__mask" @click="emit('cancel')" />

      <div class="rep__panel">
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
                  :disabled="interval <= MIN_INTERVAL"
                  @click="changeInterval(-1)"
                >
                  －
                </button>
                <span class="rep__step-value">{{ interval }}</span>
                <button
                  class="rep__step pressable"
                  aria-label="增加间隔"
                  :disabled="interval >= MAX_INTERVAL"
                  @click="changeInterval(1)"
                >
                  ＋
                </button>
              </div>
              <span class="rep__label">{{ freq === 'daily' ? '天' : freq === 'weekly' ? '周' : '月' }}重复</span>
            </div>
          </section>

          <section v-if="freq === 'weekly'" class="rep__block">
            <h3 class="rep__label">重复于</h3>
            <div class="rep__chips" role="group" aria-label="重复的星期">
              <button
                v-for="c in WEEK_CHIPS"
                :key="c.value"
                class="rep__chip pressable"
                :class="{ 'rep__chip--on': weekDays.includes(c.value) }"
                :aria-pressed="weekDays.includes(c.value)"
                :aria-label="`周${c.label}`"
                @click="toggleWeekDay(c.value)"
              >
                <span class="rep__chip-inner">{{ c.label }}</span>
              </button>
            </div>
            <button class="rep__quick pressable" @click="applyWorkDays">工作日（一至五）</button>
            <p v-if="weekError" class="rep__error">{{ weekError }}</p>
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
            <p class="rep__readonly">
              每年 {{ firstDate.getMonth() + 1 }} 月 {{ firstDate.getDate() }} 日（由首次时间决定）
            </p>
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
.rep__quick {
  min-height: 44px;
  margin-top: var(--sp-2);
  padding: 0 var(--sp-3);
  border: 1px solid var(--border-color);
  border-radius: 18px;
  font-size: var(--font-caption);
  color: var(--text-primary);
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
.rep__date {
  flex: 1;
  min-height: 36px;
  padding: 0 var(--sp-2);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-control);
  background: var(--bg-page);
  font-size: var(--font-body-m);
}
.rep__readonly {
  font-size: var(--font-body-m);
  line-height: var(--font-body-m-lh);
  color: var(--text-primary);
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
