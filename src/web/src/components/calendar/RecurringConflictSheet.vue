<script setup lang="ts">
import { computed } from 'vue'
import type { ConflictDateGroup } from '@/types'
import { formatEventRange, fromDateKey } from '@/utils/time'
import AppButton from '@/components/AppButton.vue'
import AppIcon from '@/components/AppIcon.vue'

const props = withDefaults(
  defineProps<{
    visible: boolean
    /** 按日期分组的冲突（后端已截断为前若干个日期） */
    dates: ConflictDateGroup[]
    /** 窗口内冲突日期总数 */
    datesTotal: number
    /** 窗口内冲突总次数 */
    total: number
    saving?: boolean
  }>(),
  { saving: false }
)

const emit = defineEmits<{ (e: 'cancel'): void; (e: 'confirm'): void }>()

const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']
/** 只列前 5 个日期分组，其余以汇总文案收口 */
const MAX_GROUPS = 5

const shown = computed(() => props.dates.slice(0, MAX_GROUPS))
const hasMore = computed(() => props.datesTotal > shown.value.length)
const dateCount = computed(() => props.datesTotal || props.dates.length)

function dateText(date: string): string {
  const d = fromDateKey(date)
  return `${d.getMonth() + 1}月${d.getDate()}日 ${WEEKDAYS[d.getDay()]}`
}

function timeText(item: { all_day: boolean; start_at: string; end_at: string }): string {
  return item.all_day ? '全天安排' : formatEventRange(item)
}
</script>

<template>
  <Transition name="sheet">
    <div v-if="visible" class="rc" role="dialog" aria-modal="true" aria-label="多个日期有冲突">
      <div class="rc__mask" @click="emit('cancel')" />

      <div class="rc__panel sheet-panel">
        <span class="rc__grabber" aria-hidden="true" />
        <div class="rc__head">
          <AppIcon name="conflict" :size="20" color="var(--color-warning)" />
          <h2 class="rc__title">多个日期有冲突</h2>
        </div>
        <p class="rc__sub">
          该循环在未来 90 天内，有 {{ dateCount }} 个日期与已有安排重叠：
        </p>

        <div class="rc__groups">
          <section v-for="g in shown" :key="g.date" class="rc__group">
            <h3 class="rc__group-date">{{ dateText(g.date) }}</h3>
            <p v-for="c in g.conflicts" :key="String(c.id)" class="rc__item">
              <span class="rc__item-dot" aria-hidden="true" />
              <span class="rc__item-time">{{ timeText(c) }}</span>
              <span class="rc__item-title ellipsis">{{ c.title }}</span>
            </p>
          </section>
        </div>

        <p v-if="hasMore" class="rc__rest">
          等共 {{ dateCount }} 个日期、{{ total }} 次冲突，仍要保存
        </p>
        <p class="rc__foot-note">你仍可以保存这条循环。</p>

        <div class="rc__actions">
          <AppButton class="rc__btn" type="secondary" @click="emit('cancel')">返回修改</AppButton>
          <!-- 冲突不是危险操作，主按钮保持品牌色 -->
          <AppButton class="rc__btn" type="primary" :loading="saving" @click="emit('confirm')">
            仍要保存
          </AppButton>
        </div>
      </div>
    </div>
  </Transition>
</template>

<style scoped>
.rc {
  position: fixed;
  inset: 0;
  z-index: 200;
  display: flex;
  flex-direction: column;
  justify-content: flex-end;
}
.rc__mask {
  position: absolute;
  inset: 0;
  background: rgba(26, 29, 38, 0.45);
}
.rc__panel {
  position: relative;
  max-height: 82%;
  overflow-y: auto;
  background: var(--bg-card);
  border-radius: 16px 16px 0 0;
  padding: var(--sp-2) var(--sp-4) calc(var(--sp-4) + var(--safe-bottom));
}
.rc__grabber {
  display: block;
  width: 36px;
  height: 4px;
  margin: 0 auto var(--sp-2);
  border-radius: 2px;
  background: var(--border-color);
}
.rc__head {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
}
.rc__title {
  font-size: var(--font-heading-m);
  line-height: var(--font-heading-m-lh);
  font-weight: 600;
}
.rc__sub {
  margin-top: var(--sp-2);
  font-size: var(--font-body-m);
  line-height: var(--font-body-m-lh);
  color: var(--text-secondary);
}
.rc__groups {
  margin-top: var(--sp-3);
  display: flex;
  flex-direction: column;
  gap: var(--sp-2);
}
.rc__group {
  padding: var(--sp-3);
  background: var(--bg-page);
  border-radius: var(--radius-card);
}
.rc__group-date {
  font-size: var(--font-body-m);
  line-height: var(--font-body-m-lh);
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}
.rc__item {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 4px;
  font-size: var(--font-caption);
  line-height: var(--font-caption-lh);
  color: var(--text-primary);
}
.rc__item-dot {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: var(--color-warning);
  flex-shrink: 0;
}
.rc__item-time {
  color: var(--text-secondary);
  font-variant-numeric: tabular-nums;
  flex-shrink: 0;
}
.rc__item-title {
  min-width: 0;
}
.rc__rest {
  margin-top: var(--sp-2);
  font-size: var(--font-caption);
  line-height: var(--font-caption-lh);
  color: var(--text-secondary);
}
.rc__foot-note {
  margin-top: var(--sp-3);
  font-size: var(--font-caption);
  color: var(--text-secondary);
}
.rc__actions {
  display: flex;
  gap: var(--sp-3);
  margin-top: var(--sp-3);
}
.rc__btn {
  flex: 1;
}
.sheet-enter-active,
.sheet-leave-active {
  transition: opacity 220ms ease;
}
.sheet-enter-active .rc__panel,
.sheet-leave-active .rc__panel {
  transition: transform 220ms ease;
}
.sheet-enter-from,
.sheet-leave-to {
  opacity: 0;
}
.sheet-enter-from .rc__panel,
.sheet-leave-to .rc__panel {
  transform: translateY(100%);
}
</style>
