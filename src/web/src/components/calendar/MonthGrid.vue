<script setup lang="ts">
import { computed } from 'vue'
import type { MonthDayCount } from '@/types'
import { buildMonthGrid, toDateKey } from '@/utils/time'

const props = defineProps<{
  year: number
  /** 1 ~ 12 */
  month: number
  counts: MonthDayCount[]
  /** 选中日 YYYY-MM-DD */
  selected: string
}>()

const emit = defineEmits<{ (e: 'select', date: string): void }>()

const WEEK_LABELS = ['日', '一', '二', '三', '四', '五', '六']
const WEEK_FULL = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']

type Mark = 'normal' | 'task' | 'muted'

const days = computed(() => buildMonthGrid(props.year, props.month))
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
  hasTask: boolean
  marks: Mark[]
  label: string
}

const cells = computed<CellInfo[]>(() =>
  days.value.map((d) => {
    const key = toDateKey(d)
    const c = countMap.value.get(key)
    const normal = c?.normal ?? 0
    const task = c?.task ?? 0
    const total = normal + task
    // 两类都有（或数量较多）时用聚合三点的形式，避免单点无法表达混合信息
    const marks: Mark[] =
      (normal > 0 && task > 0) || total >= 3
        ? ['normal', 'task', 'muted']
        : normal > 0
          ? ['normal']
          : task > 0
            ? ['task']
            : []
    const isToday = key === todayKey
    return {
      key,
      day: d.getDate(),
      inMonth: d.getMonth() + 1 === props.month && d.getFullYear() === props.year,
      isToday,
      isSelected: key === props.selected,
      total,
      hasTask: task > 0,
      marks,
      label: `${d.getMonth() + 1}月${d.getDate()}日 ${WEEK_FULL[d.getDay()]}${
        isToday ? '，今天' : ''
      }，${total} 个日程${task > 0 ? '，含任务日程' : ''}`,
    }
  })
)
</script>

<template>
  <div class="grid">
    <div class="grid__week" aria-hidden="true">
      <span v-for="w in WEEK_LABELS" :key="w" class="grid__week-item">{{ w }}</span>
    </div>
    <ul class="grid__days">
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
            <span v-for="(m, i) in cell.marks" :key="i" class="grid__dot" :class="`grid__dot--${m}`" />
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
.grid__week {
  display: grid;
  grid-template-columns: repeat(7, calc((100vw - 32px) / 7));
  align-items: center;
  height: 28px;
}
.grid__week-item {
  text-align: center;
  font-size: var(--font-caption);
  color: var(--text-secondary);
}
.grid__days {
  display: grid;
  grid-template-columns: repeat(7, calc((100vw - 32px) / 7));
  padding-bottom: var(--sp-2);
}
.grid__day {
  display: flex;
  flex-direction: column;
  align-items: center;
  /* 格子即热区，正方形保证触控面积 ≥ 44px */
  width: calc((100vw - 32px) / 7);
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
.grid__dot--normal {
  background: var(--color-primary);
}
.grid__dot--task {
  background: var(--color-link);
}
.grid__dot--muted {
  background: var(--text-disabled);
}
</style>