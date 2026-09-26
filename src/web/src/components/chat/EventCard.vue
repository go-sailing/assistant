<script setup lang="ts">
import { computed } from 'vue'
import { useRouter } from 'vue-router'
import type { CalendarEvent, Occurrence, SeriesDetail } from '@/types'
import { formatEventCardTime, parseDate } from '@/utils/time'
import AppIcon from '../AppIcon.vue'

/**
 * 对话中的日程卡片（UX 5.7 / 5.10）。
 * v0.8.0：任务日程形态已下线，只剩普通日程、循环系列与循环实例三种形态。
 */
const props = withDefaults(
  defineProps<{
    event: CalendarEvent
    /** 循环系列卡片（每系列一条） */
    series?: SeriesDetail
    /** 循环实例卡片 */
    occurrence?: Occurrence
    /** 多日分组卡片内不需要箭头 */
    showArrow?: boolean
  }>(),
  { showArrow: true }
)

const emit = defineEmits<{
  (e: 'detail', event: CalendarEvent): void
  (e: 'occurrence-restore', occurrence: Occurrence): void
}>()

const router = useRouter()

const timeText = computed(() => formatEventCardTime(props.event))

/** 实例状态胶囊三态：正常 / 已调整 / 已取消 */
const overrideState = computed(() => props.occurrence?.override_state ?? 'normal')
const cancelled = computed(() => overrideState.value === 'cancelled')

const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']

/** 下一次实例：9月21日 周一 10:00（全天只显示日期） */
const nextText = computed(() => {
  const d = parseDate(props.series?.next_occurrence)
  if (!d) return ''
  const day = `${d.getMonth() + 1}月${d.getDate()}日 ${WEEKDAYS[d.getDay()]}`
  if (props.series?.all_day) return `${day} 全天`
  const hh = d.getHours() < 10 ? `0${d.getHours()}` : String(d.getHours())
  const mm = d.getMinutes() < 10 ? `0${d.getMinutes()}` : String(d.getMinutes())
  return `${day} ${hh}:${mm}`
})

/** 次数行：永不结束显示「长期重复」，系列已结束显示「已全部结束（共 N 次）」 */
const seriesMeta = computed(() => {
  const s = props.series
  if (!s) return ''
  const total = typeof s.total_count === 'number' ? `共 ${s.total_count} 次` : ''
  if (!s.next_occurrence) return total ? `已全部结束（${total}）` : '已全部结束'
  if (s.recurrence?.end_type === 'never') return '长期重复'
  return total
})

/** 历史卡片刷新占位文案：区分「已删除」与「该次安排已不再发生」 */
const missingText = computed(() => {
  if (props.event.missing_reason === 'not_occurring') return '该次安排已不再发生'
  return props.series || props.occurrence ? '该循环日程已删除' : '该日程已删除'
})

function openDetail(): void {
  emit('detail', props.event)
}

/** 系列卡片：整卡点击 → 系列详情（与「查看全部安排」等价） */
function openSeries(): void {
  if (!props.series) return
  router.push(`/calendar/series/${props.series.id}?from=chat`)
}

/** 实例卡片：整卡点击 → 实例详情（带 occurrence_key） */
function openOccurrence(): void {
  const occ = props.occurrence
  if (!occ) return
  const seriesId = occ.series_id ?? occ.id
  router.push({
    path: `/calendar/${seriesId}`,
    query: { occurrence_key: occ.occurrence_key, from: 'chat' },
  })
}

/** 恢复本次：由 ChatView 调接口，前端不本地伪造状态 */
function restore(): void {
  if (props.occurrence) emit('occurrence-restore', props.occurrence)
}
</script>

<template>
  <!-- 循环系列卡片（v0.2.0）：规则摘要 + 次数/长期重复 + 下一次 -->
  <div v-if="series" class="ecard" :class="{ 'ecard--missing': series.missing }">
    <div v-if="series.missing" class="ecard__row">
      <AppIcon name="repeat" :size="14" color="var(--color-primary)" class="ecard__repeat" />
      <div class="ecard__main">
        <p class="ecard__title ecard__title--missing">{{ series.title }}</p>
        <p class="ecard__sub">{{ missingText }}</p>
      </div>
    </div>

    <div
      v-else
      class="ecard__row"
      role="button"
      tabindex="0"
      :aria-label="`查看循环日程 ${series.title} 的全部安排`"
      @click="openSeries"
      @keydown.enter="openSeries"
    >
      <AppIcon name="repeat" :size="14" color="var(--color-primary)" class="ecard__repeat" />
      <div class="ecard__main">
        <div class="ecard__title-row">
          <span class="ecard__title">{{ series.title }}</span>
          <span class="ecard__pill ecard__pill--primary">循环</span>
        </div>
        <p v-if="series.recurrence_summary" class="ecard__sub">{{ series.recurrence_summary }}</p>
        <p v-if="seriesMeta" class="ecard__sub">{{ seriesMeta }}</p>
        <p v-if="nextText" class="ecard__sub">
          <span class="ecard__pill ecard__pill--next">下一次</span>
          <span class="ecard__time">{{ nextText }}</span>
        </p>
        <p class="ecard__more">查看全部安排 ›</p>
      </div>
      <AppIcon v-if="showArrow" name="chevron-right" :size="18" color="#B5B9C4" />
    </div>
  </div>

  <!-- 循环实例卡片（v0.2.0）：本次视角 + 已调整/已取消胶囊 -->
  <div v-else-if="occurrence" class="ecard" :class="{ 'ecard--missing': occurrence.missing }">
    <div v-if="occurrence.missing" class="ecard__row">
      <AppIcon name="repeat" :size="14" color="var(--color-primary)" class="ecard__repeat" />
      <div class="ecard__main">
        <p class="ecard__title ecard__title--missing">{{ occurrence.title }}</p>
        <p class="ecard__sub">{{ missingText }}</p>
      </div>
    </div>

    <template v-else>
      <div
        class="ecard__row"
        role="button"
        tabindex="0"
        :aria-label="`查看本次安排 ${occurrence.title}`"
        @click="openOccurrence"
        @keydown.enter="openOccurrence"
      >
        <AppIcon name="repeat" :size="14" color="var(--color-primary)" class="ecard__repeat" />
        <div class="ecard__main">
          <div class="ecard__title-row">
            <span class="ecard__title" :class="{ 'ecard__title--done': cancelled }">
              {{ occurrence.title }}
            </span>
            <span v-if="overrideState === 'modified'" class="ecard__pill ecard__pill--modified">
              已调整
            </span>
            <span v-else-if="cancelled" class="ecard__pill">已取消</span>
          </div>
          <p class="ecard__sub" :class="{ 'ecard__sub--done': cancelled }">
            <span class="ecard__time">{{ timeText }}</span>
          </p>
          <p v-if="occurrence.location" class="ecard__sub">
            <AppIcon name="pin" :size="13" color="#6B7080" />
            <span class="ellipsis">{{ occurrence.location }}</span>
          </p>
        </div>
        <AppIcon v-if="showArrow" name="chevron-right" :size="18" color="#B5B9C4" />
      </div>
      <!-- 已取消实例：提供恢复入口（弱按钮，动作归属写在 aria-label 里） -->
      <div v-if="cancelled" class="ecard__footer">
        <button
          type="button"
          class="ecard__restore pressable"
          :aria-label="`恢复本次安排：${occurrence.title}`"
          @click="restore"
        >
          恢复本次
        </button>
      </div>
    </template>
  </div>

  <!-- 单次日程卡片（沿用 v0.1.0） -->
  <div v-else-if="event.missing" class="ecard ecard--missing">
    <div class="ecard__row">
      <AppIcon name="calendar" :size="16" color="#B5B9C4" />
      <div class="ecard__main">
        <p class="ecard__title ecard__title--missing">{{ event.title }}</p>
        <p class="ecard__sub">{{ missingText }}</p>
      </div>
    </div>
  </div>

  <div v-else class="ecard">
    <div
      class="ecard__row"
      role="button"
      tabindex="0"
      :aria-label="`查看日程 ${event.title}`"
      @click="openDetail"
      @keydown.enter="openDetail"
    >
      <span class="ecard__dot" aria-hidden="true" />

      <div class="ecard__main">
        <div class="ecard__title-row">
          <span class="ecard__title">{{ event.title }}</span>
          <span v-if="event.conflicts && event.conflicts.length" class="ecard__conflict">
            <AppIcon name="conflict" :size="12" color="#FF8F1F" />
            冲突
          </span>
        </div>
        <p class="ecard__sub">
          <span class="ecard__time">{{ timeText }}</span>
        </p>
        <p v-if="event.location" class="ecard__sub">
          <AppIcon name="pin" :size="13" color="#6B7080" />
          <span class="ellipsis">{{ event.location }}</span>
        </p>
      </div>

      <AppIcon v-if="showArrow" name="chevron-right" :size="18" color="#B5B9C4" />
    </div>
  </div>
</template>

<style scoped>
.ecard {
  background: var(--bg-card);
  border: 1px solid var(--border-color);
  border-left: 4px solid var(--color-primary);
  border-radius: var(--radius-card);
  overflow: hidden;
}
.ecard--missing {
  border-left-color: var(--text-disabled);
  background: var(--bg-page);
}
.ecard__title--missing {
  color: var(--text-disabled);
  text-decoration: line-through;
}
.ecard__row {
  display: flex;
  align-items: flex-start;
  gap: var(--sp-2);
  padding: var(--sp-3);
}
.ecard__row:active {
  background: #fafbff;
}
.ecard__repeat {
  flex-shrink: 0;
  margin-top: 2px;
  color: var(--color-primary);
}
.ecard__dot {
  width: 8px;
  height: 8px;
  margin-top: 6px;
  border-radius: 50%;
  background: var(--color-primary);
  flex-shrink: 0;
}
.ecard__main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.ecard__title-row {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}
.ecard__title {
  font-size: var(--font-body-l);
  line-height: var(--font-body-l-lh);
  color: var(--text-primary);
  word-break: break-word;
}
.ecard__conflict {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  flex-shrink: 0;
  height: 18px;
  padding: 0 6px;
  border-radius: 9px;
  background: var(--color-conflict-bg);
  color: #a35b00;
  font-size: var(--font-caption-s);
  line-height: var(--font-caption-s-lh);
}
/* 状态胶囊：循环 / 已调整 / 已取消 / 下一次，均带文字，不靠颜色单一传达 */
.ecard__pill {
  flex-shrink: 0;
  height: 18px;
  padding: 0 6px;
  border-radius: 9px;
  background: var(--color-allday-bg);
  color: var(--text-secondary);
  font-size: var(--font-caption-s);
  line-height: 18px;
}
.ecard__pill--primary {
  background: var(--color-primary-light);
  color: var(--color-primary);
}
.ecard__pill--modified {
  background: var(--color-conflict-bg);
  color: var(--color-conflict-text);
}
.ecard__pill--next {
  background: var(--color-primary-light);
  color: var(--color-primary);
}
.ecard__sub {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: var(--font-caption);
  line-height: var(--font-caption-lh);
  color: var(--text-secondary);
}
.ecard__sub--done {
  color: var(--text-disabled);
  text-decoration: line-through;
}
.ecard__time {
  font-variant-numeric: tabular-nums;
}
.ecard__more {
  font-size: var(--font-caption);
  line-height: var(--font-caption-lh);
  color: var(--color-primary);
}
.ecard__footer {
  display: flex;
  justify-content: flex-end;
  padding: 0 var(--sp-3) var(--sp-3);
}
.ecard__restore {
  min-height: 44px;
  padding: 0 var(--sp-4);
  border: 1px solid var(--color-success);
  border-radius: var(--radius-control);
  background: var(--bg-card);
  color: var(--color-success);
  font-size: var(--font-body-m);
}
</style>
