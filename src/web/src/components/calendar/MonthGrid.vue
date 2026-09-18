<script setup lang="ts">
import { computed } from 'vue'
import type { CalendarDayInfo, LunarDayInfo, MonthDayCount } from '@/types'
import { buildMonthGrid, buildWeekGrid, toDateKey } from '@/utils/time'
import { useSettingsStore } from '@/stores/settings'

const props = withDefaults(
  defineProps<{
    year: number
    /** 1 ~ 12 */
    month: number
    counts: MonthDayCount[]
    /** 选中日 YYYY-MM-DD */
    selected: string
    /** v0.3.0：month = 6 行整月；week = 仅选中日所在周一行（折叠态） */
    mode?: 'month' | 'week'
    /**
     * v0.3.0 折叠动画：日期行整体上移的像素位移（周标题行不参与位移），
     * 收起时把选中周滑到可视区，避免"跳变"。
     */
    weekShift?: number
    /** 折叠动画结束后的内容切换：位移需瞬时归零、不做过渡 */
    noShiftAnim?: boolean
    /** v0.4.0：展开态竖向空间不足（列表区需保 38dvh）时压缩圆底/副字/标记点 */
    compact?: boolean
    /** v0.4.0：压缩后的单格高度（px）；null = 按格子宽度正方形 */
    cellHeight?: number | null
  }>(),
  { mode: 'month', weekShift: 0, noShiftAnim: false, compact: false, cellHeight: null }
)

const emit = defineEmits<{ (e: 'select', date: string): void }>()

const settings = useSettingsStore()

/** v0.2.0：一周自周一开始（与 weekly 规则的周起始一致） */
const WEEK_LABELS = ['一', '二', '三', '四', '五', '六', '日']
const WEEK_FULL = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']

/** 标记点形态：实心点（单次）/ 空心环（循环）/ 紫点（任务日程）；环心点表示混合 */
interface CellMark {
  kind: 'single' | 'ring' | 'task'
  /** 空心环中心点：primary 蓝心 / link 紫心 */
  core?: 'primary' | 'link'
}

/** 副字语义色（对应 UXUI 5.2 优先级 1~5） */
type SubTone = 'holiday' | 'festival' | 'term' | 'lunar'

// v0.3.0：折叠态只渲染选中日所在周一行，其余复用同一套格子
const days = computed(() =>
  props.mode === 'week' ? buildWeekGrid(props.selected) : buildMonthGrid(props.year, props.month)
)
const todayKey = toDateKey(new Date())

/** 日期 → 计数：42 个格子逐个线性查找太浪费，先建 Map */
const countMap = computed(() => {
  const map = new Map<string, MonthDayCount>()
  props.counts.forEach((c) => map.set(c.date, c))
  return map
})

/**
 * 副字与角标只来自接口（端上不内置任何历法/假日数据）。
 * 节日名较长时按 UXUI 5.2 取简称：「国庆节」→「国庆」、「中元节」→「中元」。
 */
function shortLabel(name: string): string {
  if (name.length <= 2) return name
  if (name.endsWith('节')) return name.slice(0, -1)
  return name.length > 4 ? name.slice(0, 3) : name
}

interface CellInfo {
  key: string
  day: number
  inMonth: boolean
  isToday: boolean
  isSelected: boolean
  total: number
  marks: CellMark[]
  /** 农历副字（优先级 1~5 只取一个）；null = 无副字 */
  sub: { text: string; tone: SubTone } | null
  /** 是否渲染副字行（农历开关关闭时整行隐藏，角标仍显示） */
  showSub: boolean
  /** 休/班角标（不受农历开关控制） */
  badge: CalendarDayInfo['type'] | null
  label: string
}

const cells = computed<CellInfo[]>(() =>
  days.value.map((d) => {
    const key = toDateKey(d)
    const c = countMap.value.get(key)
    const normal = c?.normal ?? 0
    const task = c?.task ?? 0
    const recurring = c?.recurring ?? 0
    // normal 已含循环实例，单次数量需要扣减后再判断形态
    const single = Math.max(0, normal - recurring)
    const total = normal + task

    const marks: CellMark[] = []
    if (recurring > 0) {
      // 含循环实例：空心环；与其他类型同日时用环心点聚合
      marks.push({
        kind: 'ring',
        core: task > 0 ? 'link' : single > 0 ? 'primary' : undefined,
      })
    } else {
      // 无循环：按类型逐点展示，最多 3 点（避免单点无法表达混合信息）
      const rest: CellMark[] = [
        ...Array.from({ length: single }, () => ({ kind: 'single' as const })),
        ...Array.from({ length: task }, () => ({ kind: 'task' as const })),
      ]
      marks.push(...rest.slice(0, 3))
    }

    const isToday = key === todayKey
    const types = [recurring > 0 ? '含循环日程' : '', task > 0 ? '含任务日程' : '']
      .filter(Boolean)
      .join('与')

    // 日期格副字：法定节假日名 ＞ 农历传统节日 ＞ 节气 ＞ 农历月名（初一）＞ 农历日序
    const lunar: LunarDayInfo | null = c?.lunar ?? null
    const calendarDay: CalendarDayInfo | null = c?.calendar_day ?? null
    const badge: CellInfo['badge'] = calendarDay?.type ?? null
    let sub: CellInfo['sub'] = null
    if (lunar) {
      if (calendarDay?.name) sub = { text: shortLabel(calendarDay.name), tone: 'holiday' }
      else if (lunar.festival) sub = { text: shortLabel(lunar.festival), tone: 'festival' }
      else if (lunar.term && settings.termsEnabled) sub = { text: lunar.term, tone: 'term' }
      else if (lunar.day_label === '初一') sub = { text: lunar.month_label, tone: 'lunar' }
      else sub = { text: lunar.day_label, tone: 'lunar' }
    }

    // 无障碍朗读：角标与副字视觉层 aria-hidden，信息全部并入格 aria-label
    const parts = [`${d.getFullYear()} 年 ${d.getMonth() + 1} 月 ${d.getDate()} 日`, WEEK_FULL[d.getDay()]]
    if (isToday) parts.push('今天')
    if (lunar && settings.lunarEnabled) {
      parts.push(`农历${lunar.month_label}${lunar.day_label}`)
      if (lunar.festival) parts.push(lunar.festival)
      if (lunar.term && settings.termsEnabled) parts.push(lunar.term)
    }
    if (badge === 'holiday') parts.push('法定放假日')
    else if (badge === 'makeup') parts.push('调休补班日')
    parts.push(`${total} 个日程`)
    if (types) parts.push(types)

    return {
      key,
      day: d.getDate(),
      inMonth: d.getMonth() + 1 === props.month && d.getFullYear() === props.year,
      isToday,
      isSelected: key === props.selected,
      total,
      marks,
      sub,
      showSub: settings.lunarEnabled && !!sub,
      badge,
      label: parts.join('，'),
    }
  })
)

/** 压缩态行高通过 CSS 变量下发（未压缩时不设置，走 aspect-ratio 正方形） */
const gridStyle = computed(() =>
  props.cellHeight ? { '--grid-cell-h': `${props.cellHeight}px` } : undefined
)
</script>

<template>
  <div class="grid" :class="{ 'grid--compact': compact }" :style="gridStyle">
    <div class="grid__week" aria-hidden="true">
      <span v-for="w in WEEK_LABELS" :key="w" class="grid__week-item">{{ w }}</span>
    </div>
    <ul
      class="grid__days"
      :class="{ 'grid__days--noanim': noShiftAnim }"
      :style="{ transform: `translateY(${weekShift}px)` }"
    >
      <li v-for="cell in cells" :key="cell.key">
        <button
          class="grid__day"
          :class="{ 'grid__day--out': !cell.inMonth }"
          :aria-label="cell.label"
          :aria-current="cell.isSelected ? 'date' : undefined"
          @click="emit('select', cell.key)"
        >
          <!-- 休/班角标：法定语义，不受农历开关控制 -->
          <span class="grid__badge-slot" aria-hidden="true">
            <span
              v-if="cell.badge"
              class="grid__badge"
              :class="`grid__badge--${cell.badge}`"
              >{{ cell.badge === 'holiday' ? '休' : '班' }}</span
            >
          </span>
          <span
            class="grid__num"
            :class="{
              'grid__num--today': cell.isToday,
              'grid__num--selected': cell.isSelected && !cell.isToday,
            }"
            >{{ cell.day }}</span
          >
          <!-- 农历副字：单行省略，农历开关关闭时整行不渲染 -->
          <span
            v-if="cell.showSub && cell.sub"
            class="grid__sub"
            :class="`grid__sub--${cell.sub.tone}`"
            aria-hidden="true"
            >{{ cell.sub.text }}</span
          >
          <span class="grid__marks" aria-hidden="true">
            <span
              v-for="(m, i) in cell.marks"
              :key="i"
              class="grid__dot"
              :class="[`grid__dot--${m.kind}`, m.core ? `grid__dot--core-${m.core}` : '']"
            />
          </span>
        </button>
      </li>
    </ul>
  </div>
</template>

<style scoped>
.grid {
  background: var(--bg-card);
}
/* v0.3.0：列宽按「中栏容器」计算（1fr + 页面内边距），不再引用 100vw——
   宽屏下格子随中栏宽度走（修复异常放大），手机上格子尺寸与 v0.2.0 一致 */
.grid__week {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  align-items: center;
  height: 28px;
  padding: 0 var(--page-padding);
}
.grid__week-item {
  text-align: center;
  font-size: var(--font-caption);
  color: var(--text-secondary);
}
.grid__days {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  padding: 0 var(--page-padding) var(--sp-2);
  /* 折叠动画：仅日期行位移，周标题行保持不动 */
  transition: transform var(--dur-page) ease-out;
}
.grid__days--noanim {
  transition: none;
}
/* 格内自上而下：角标（绝对定位贴左上角）→ 公历主字 → 农历副字 → 标记点 */
.grid__day {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  /* 格子即热区，正方形保证触控面积 ≥ 44px；压缩态由 --grid-cell-h 收紧行高 */
  width: 100%;
  height: var(--grid-cell-h, auto);
  aspect-ratio: 1;
  gap: 1px;
  overflow: hidden;
}
/* 角标行不占布局高度：避免压缩态把主字挤出格 */
.grid__badge-slot {
  position: absolute;
  top: 0;
  left: 0;
  line-height: 0;
}
.grid__badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 12px;
  height: 12px;
  border-radius: 2px;
  font-size: 9px;
  line-height: 1;
  color: #fff;
}
.grid__badge--holiday {
  background: var(--color-holiday);
}
.grid__badge--makeup {
  background: var(--color-makeup);
}
.grid__num {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border-radius: 50%;
  border: 1.5px solid transparent;
  font-size: 16px;
  line-height: 1;
  color: var(--text-primary);
  font-variant-numeric: tabular-nums;
}
.grid__day--out .grid__num {
  color: var(--text-disabled);
}
.grid__num--today {
  color: var(--color-primary);
  border-color: var(--color-primary);
  font-weight: 600;
}
/* 选中态：主字反白（实心主色圆底 + 白字） */
.grid__num--selected {
  background: var(--color-primary);
  border-color: var(--color-primary);
  color: #fff;
  font-weight: 600;
}
/* 副字单行省略：优先级只出一个（色见下），窄屏也不换行不挤压主字 */
.grid__sub {
  max-width: 100%;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  font-size: var(--font-caption-s);
  line-height: 12px;
}
.grid__sub--holiday {
  color: var(--color-holiday);
}
.grid__sub--festival {
  color: var(--color-festival);
}
.grid__sub--term {
  color: var(--color-term);
}
.grid__sub--lunar {
  color: var(--color-lunar-text);
}
/* 选中态副字取主色 70%（角标保持本色，在浅底上仍可读） */
.grid__num--selected + .grid__sub {
  color: var(--color-primary);
  opacity: 0.7;
}
.grid__marks {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 2px;
  height: 6px;
}
.grid__dot {
  width: 5px;
  height: 5px;
  border-radius: 50%;
}
/* 单次日程：实心蓝点 */
.grid__dot--single {
  background: var(--color-primary);
}
/* 任务日程：实心紫点（沿用 v0.1.0） */
.grid__dot--task {
  background: var(--color-link);
}
/* 循环实例：空心圆环，环心点表示同日还有单次或任务日程 */
.grid__dot--ring {
  position: relative;
  background: transparent;
  border: 1.5px solid var(--color-primary);
}
.grid__dot--core-primary::after,
.grid__dot--core-link::after {
  content: '';
  position: absolute;
  top: 50%;
  left: 50%;
  width: 2px;
  height: 2px;
  border-radius: 50%;
  transform: translate(-50%, -50%);
  background: var(--color-primary);
}
.grid__dot--core-link::after {
  background: var(--color-link);
}
/* v0.4.0 紧凑态（展开空间不足或 320px 窄屏）：收紧圆底与标记点，保证格内不裁切 */
.grid--compact .grid__num {
  width: 22px;
  height: 22px;
  font-size: 13px;
}
.grid--compact .grid__sub {
  line-height: 11px;
}
.grid--compact .grid__marks {
  height: 5px;
}
.grid--compact .grid__dot {
  width: 4px;
  height: 4px;
}
/* 320px 窄屏：节日简称最多 2 字（'中秋'），不换行不截断主字 */
@media (max-width: 340px) {
  .grid__sub {
    max-width: 2.2em;
  }
}
</style>