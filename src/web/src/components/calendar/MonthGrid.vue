<script setup lang="ts">
import { computed } from 'vue'
import type { MonthDayCount } from '@/types'
import { buildMonthGrid, buildWeekGrid, toDateKey } from '@/utils/time'

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
  }>(),
  { mode: 'month', weekShift: 0, noShiftAnim: false }
)

const emit = defineEmits<{ (e: 'select', date: string): void }>()

/** v0.2.0：一周自周一开始（与 weekly 规则的周起始一致） */
const WEEK_LABELS = ['一', '二', '三', '四', '五', '六', '日']
const WEEK_FULL = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']

/** 标记点形态：实心点（单次）/ 空心环（循环）/ 紫点（任务日程）；环心点表示混合 */
interface CellMark {
  kind: 'single' | 'ring' | 'task'
  /** 空心环中心点：primary 蓝心 / link 紫心 */
  core?: 'primary' | 'link'
}

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

interface CellInfo {
  key: string
  day: number
  inMonth: boolean
  isToday: boolean
  isSelected: boolean
  total: number
  marks: CellMark[]
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
    return {
      key,
      day: d.getDate(),
      inMonth: d.getMonth() + 1 === props.month && d.getFullYear() === props.year,
      isToday,
      isSelected: key === props.selected,
      total,
      marks,
      label: `${d.getMonth() + 1}月${d.getDate()}日 ${WEEK_FULL[d.getDay()]}${
        isToday ? '，今天' : ''
      }，${total} 个日程${types ? `，${types}` : ''}`,
    }
  })
)
</script>

<template>
  <div class="grid">
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
          <span
            class="grid__num"
            :class="{
              'grid__num--today': cell.isToday,
              'grid__num--selected': cell.isSelected && !cell.isToday,
            }"
            >{{ cell.day }}</span
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
.grid__day {
  display: flex;
  flex-direction: column;
  align-items: center;
  /* 格子即热区，正方形保证触控面积 ≥ 44px（宽度随容器，尺寸比例与 v0.2.0 一致） */
  width: 100%;
  aspect-ratio: 1;
  padding-top: 4px;
  gap: 2px;
}
.grid__num {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border-radius: 50%;
  border: 1.5px solid transparent;
  font-size: var(--font-body-m);
  color: var(--text-primary);
}
.grid__day--out .grid__num {
  color: var(--text-disabled);
}
.grid__num--today {
  color: var(--color-primary);
  border-color: var(--color-primary);
  font-weight: 600;
}
.grid__num--selected {
  background: var(--color-primary-light);
  color: var(--color-primary);
  font-weight: 600;
}
.grid__marks {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 2px;
  height: 7px;
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
</style>
