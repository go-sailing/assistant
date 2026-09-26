<script setup lang="ts">
import { computed, ref } from 'vue'
import type { ConflictBlock } from '@/types'
import { formatDayTitle, formatEventRange } from '@/utils/time'
import AppButton from '../AppButton.vue'
import AppIcon from '../AppIcon.vue'

/**
 * 对话中的时间冲突提示块（UX 5.7 / 5.6）。
 * 冲突不是危险操作，因此用 warning 橙而非 danger 红；
 * 「仍要安排」只是把决定交回助手（由模型带 confirm_conflict=true 重试），前端不直接写库。
 * v0.2.0：循环冲突按日期分组（服务端只下前 5 组，其余以计数呈现）。
 */
const props = defineProps<{ block: ConflictBlock }>()

const emit = defineEmits<{ (e: 'change'): void; (e: 'force'): void }>()

const handled = ref<'none' | 'changing' | 'forced'>('none')

/** 按日期分组形态（循环冲突）与单次冲突形态共用同一组件 */
const isSeriesMode = computed(() => (props.block.conflict_dates?.length ?? 0) > 0)

/** 日期分组只列前 5 个（服务端已截断，这里再兜一层） */
const shownGroups = computed(() => (props.block.conflict_dates ?? []).slice(0, 5))
const datesTotal = computed(() => props.block.conflict_dates_total ?? shownGroups.value.length)
const shownConflicts = computed(() =>
  shownGroups.value.reduce((n, g) => n + (g.conflicts?.length ?? 0), 0)
)
const conflictsTotal = computed(() => props.block.conflict_total ?? shownConflicts.value)
const hasMore = computed(
  () => datesTotal.value > shownGroups.value.length || conflictsTotal.value > shownConflicts.value
)
const moreText = computed(
  () => `等共 ${datesTotal.value} 个日期、${conflictsTotal.value} 次冲突`
)

const title = computed(() => {
  if (isSeriesMode.value) {
    return props.block.message || `未来 90 天有 ${datesTotal.value} 个日期冲突`
  }
  return props.block.conflict_level === 'all_day' ? '该日期已有全天安排' : '这个时段已有安排'
})

/** 最多展示 3 条冲突，多余折叠（单次冲突形态） */
const preview = computed(() => props.block.conflicts.slice(0, 3))
const restCount = computed(() => Math.max(0, props.block.conflicts.length - preview.value.length))

function onChange(): void {
  handled.value = 'changing'
  emit('change')
}

function onForce(): void {
  handled.value = 'forced'
  emit('force')
}
</script>

<template>
  <div class="conflict">
    <p class="conflict__title">
      <AppIcon name="conflict" :size="16" color="#FF8F1F" />
      {{ title }}
    </p>

    <template v-if="handled === 'none'">
      <!-- 循环冲突：按日期分组 -->
      <template v-if="isSeriesMode">
        <div class="conflict__groups">
          <div v-for="g in shownGroups" :key="g.date" class="conflict__group">
            <p class="conflict__date">{{ formatDayTitle(g.date) }}</p>
            <ul class="conflict__list">
              <li v-for="c in g.conflicts" :key="String(c.id)" class="conflict__item">
                <span class="conflict__dot" aria-hidden="true" />
                <span class="conflict__time">{{ formatEventRange(c) }}</span>
                <span class="conflict__name ellipsis">{{ c.title }}</span>
              </li>
            </ul>
          </div>
          <p v-if="hasMore" class="conflict__rest">{{ moreText }}</p>
        </div>
        <p class="conflict__ask">你仍可以保存这条循环，要怎么处理？</p>
        <div class="conflict__actions">
          <AppButton type="secondary" size="small" @click="onChange">换个规则/时间</AppButton>
          <AppButton type="primary" size="small" @click="onForce">仍要安排</AppButton>
        </div>
      </template>

      <!-- 单次冲突（沿用 v0.1.0） -->
      <template v-else>
        <ul class="conflict__list">
          <li v-for="c in preview" :key="String(c.id)" class="conflict__item">
            <span class="conflict__time">{{ formatEventRange(c) }}</span>
            <span class="conflict__name ellipsis">{{ c.title }}</span>
          </li>
          <li v-if="restCount" class="conflict__item conflict__item--rest">等 {{ restCount }} 项</li>
        </ul>
        <p class="conflict__ask">要怎么处理？</p>
        <div class="conflict__actions">
          <AppButton type="secondary" size="small" @click="onChange">换个时间</AppButton>
          <AppButton type="primary" size="small" @click="onForce">仍要安排</AppButton>
        </div>
      </template>
    </template>
    <p v-else-if="handled === 'changing'" class="conflict__result">好的，想换到什么时候？</p>
    <p v-else class="conflict__result">好的，正在按原时间安排…</p>
  </div>
</template>

<style scoped>
.conflict {
  background: var(--color-conflict-bg);
  border: 1px solid rgba(255, 143, 31, 0.28);
  border-radius: var(--radius-card);
  padding: var(--sp-3);
}
.conflict__title {
  display: flex;
  align-items: flex-start;
  gap: 4px;
  font-size: var(--font-body-m);
  line-height: var(--font-body-m-lh);
  font-weight: 500;
  color: var(--text-primary);
}
.conflict__groups {
  margin-top: var(--sp-2);
  display: flex;
  flex-direction: column;
  gap: var(--sp-2);
}
.conflict__group {
  padding-left: var(--sp-2);
  border-left: 2px solid rgba(255, 143, 31, 0.35);
}
.conflict__date {
  font-size: var(--font-caption);
  line-height: var(--font-caption-lh);
  font-weight: 500;
  color: var(--text-primary);
  font-variant-numeric: tabular-nums;
}
.conflict__list {
  margin-top: var(--sp-2);
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.conflict__group .conflict__list {
  margin-top: 2px;
}
.conflict__item {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: var(--font-caption);
  line-height: var(--font-caption-lh);
  color: var(--text-secondary);
}
.conflict__dot {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: var(--color-warning);
  flex-shrink: 0;
}
.conflict__time {
  font-variant-numeric: tabular-nums;
  flex-shrink: 0;
}
.conflict__name {
  min-width: 0;
}
.conflict__item--rest {
  color: var(--text-disabled);
}
.conflict__rest {
  font-size: var(--font-caption);
  line-height: var(--font-caption-lh);
  color: var(--text-secondary);
  font-variant-numeric: tabular-nums;
}
.conflict__ask {
  margin-top: var(--sp-2);
  font-size: var(--font-caption);
  line-height: var(--font-caption-lh);
  color: var(--text-secondary);
}
.conflict__actions {
  display: flex;
  justify-content: flex-end;
  gap: var(--sp-2);
  margin-top: var(--sp-3);
}
.conflict__result {
  margin-top: var(--sp-2);
  font-size: var(--font-caption);
  line-height: var(--font-caption-lh);
  color: var(--text-secondary);
}
</style>
