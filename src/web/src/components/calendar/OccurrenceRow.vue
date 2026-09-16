<script setup lang="ts">
import { computed } from 'vue'
import type { Occurrence } from '@/types'
import { formatEventRange, parseDate } from '@/utils/time'
import AppIcon from '@/components/AppIcon.vue'
import RecurrenceBadge from '@/components/calendar/RecurrenceBadge.vue'

const props = defineProps<{
  occurrence: Occurrence
}>()

const emit = defineEmits<{
  (e: 'open', occurrence: Occurrence): void
  (e: 'restore', occurrence: Occurrence): void
}>()

const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']

const state = computed(() => props.occurrence.override_state)
const cancelled = computed(() => state.value === 'cancelled')
const modified = computed(() => state.value === 'modified')

/** 实例行按「M-D 周X」展示日期，时段由 formatEventRange 给出（全天自适应） */
const dateText = computed(() => {
  const d = parseDate(props.occurrence.start_at)
  if (!d) return ''
  return `${d.getMonth() + 1}-${d.getDate()} ${WEEKDAYS[d.getDay()]}`
})
const rangeText = computed(() => formatEventRange(props.occurrence))

const ariaLabel = computed(() => {
  const parts = [dateText.value, rangeText.value, props.occurrence.title]
  if (cancelled.value) parts.push('已取消')
  else if (modified.value) parts.push('已调整')
  return parts.join('，')
})

function onOpen(): void {
  if (cancelled.value) return
  emit('open', props.occurrence)
}

function onRestore(): void {
  emit('restore', props.occurrence)
}
</script>

<template>
  <li class="occ" :class="{ 'occ--cancelled': cancelled }">
    <!-- 已取消实例不可点进入详情：整行只保留「恢复本次」一个动作 -->
    <button
      v-if="!cancelled"
      class="occ__body pressable"
      :aria-label="ariaLabel"
      @click="onOpen"
    >
      <span class="occ__date">{{ dateText }}</span>
      <span class="occ__time">{{ rangeText }}</span>
      <RecurrenceBadge v-if="modified" kind="modified" />
      <AppIcon class="occ__arrow" name="chevron-right" :size="18" color="#B5B9C4" />
    </button>

    <div v-else class="occ__body">
      <span class="occ__date">{{ dateText }}</span>
      <span class="occ__time">{{ rangeText }}</span>
      <RecurrenceBadge kind="cancelled" />
      <button class="occ__restore pressable" :aria-label="`恢复本次：${dateText}`" @click="onRestore">
        恢复本次
      </button>
    </div>
  </li>
</template>

<style scoped>
.occ {
  display: flex;
  align-items: stretch;
  background: var(--bg-card);
  border-bottom: 1px solid var(--border-color);
}
.occ__body {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  width: 100%;
  min-height: 48px;
  padding: 0 var(--sp-4);
  text-align: left;
}
.occ__date {
  flex-shrink: 0;
  width: 68px;
  font-size: var(--font-caption);
  line-height: var(--font-caption-lh);
  color: var(--text-secondary);
  font-variant-numeric: tabular-nums;
}
.occ__time {
  flex: 1;
  min-width: 0;
  font-size: var(--font-body-m);
  line-height: var(--font-body-m-lh);
  color: var(--text-primary);
  font-variant-numeric: tabular-nums;
}
.occ__arrow {
  flex-shrink: 0;
}
/* 已取消：整行划线置灰（不只用颜色表达状态，另有「已取消」胶囊） */
.occ--cancelled .occ__date,
.occ--cancelled .occ__time {
  color: var(--text-disabled);
  text-decoration: line-through;
}
.occ__restore {
  flex-shrink: 0;
  min-height: 44px;
  padding: 0 var(--sp-2);
  font-size: var(--font-caption);
  color: var(--color-success);
}
</style>
