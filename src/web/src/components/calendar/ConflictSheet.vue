<script setup lang="ts">
import { computed } from 'vue'
import type { ConflictDateGroup, ConflictLevel, EventConflictBrief } from '@/types'
import { formatEventRange } from '@/utils/time'
import AppButton from '@/components/AppButton.vue'
import AppIcon from '@/components/AppIcon.vue'
import RecurringConflictSheet from '@/components/calendar/RecurringConflictSheet.vue'

const props = withDefaults(
  defineProps<{
    visible: boolean
    conflicts: EventConflictBrief[]
    level: ConflictLevel
    saving?: boolean
    /** v0.2.0：series = 循环规则冲突（按日期分组），occurrence = 单次冲突列表 */
    scope?: 'series' | 'occurrence'
    /** scope=series 时的按日期分组数据 */
    dateGroups?: ConflictDateGroup[]
    datesTotal?: number
    /** 窗口内冲突总次数 */
    total?: number
  }>(),
  { saving: false, scope: 'occurrence', dateGroups: () => [], datesTotal: 0, total: 0 }
)

const emit = defineEmits<{ (e: 'cancel'): void; (e: 'confirm'): void }>()

const MAX_SHOWN = 3

// 全天冲突只是弱化提示，措辞与时段重叠区分开
const title = computed(() => (props.level === 'all_day' ? '该日期已有全天安排' : '时间有冲突'))
const subtitle = computed(() =>
  props.level === 'all_day' ? '该日期已有以下安排：' : '该时段与以下安排重叠：'
)
const shown = computed(() => props.conflicts.slice(0, MAX_SHOWN))
const restText = computed(() => `等 ${props.conflicts.length} 项`)
</script>

<template>
  <!-- 循环规则冲突：整体交给按日期分组的弹层，避免两套实现 -->
  <RecurringConflictSheet
    v-if="scope === 'series'"
    :visible="visible"
    :dates="dateGroups"
    :dates-total="datesTotal || dateGroups.length"
    :total="total"
    :saving="saving"
    @cancel="emit('cancel')"
    @confirm="emit('confirm')"
  />

  <Transition v-else name="sheet">
    <div v-if="visible" class="conflict" role="dialog" aria-modal="true">
      <div class="conflict__mask" @click="emit('cancel')" />

      <div class="conflict__panel sheet-panel">
        <div class="conflict__head">
          <AppIcon name="conflict" :size="20" color="var(--color-warning)" />
          <h2 class="conflict__title">{{ title }}</h2>
        </div>
        <p class="conflict__sub">{{ subtitle }}</p>

        <ul class="conflict__list">
          <li v-for="c in shown" :key="String(c.id)" class="conflict__item">
            <div class="conflict__item-head">
              <span class="conflict__time">{{ c.all_day ? '全天' : formatEventRange(c) }}</span>
            </div>
            <p class="conflict__item-title ellipsis">{{ c.title }}</p>
            <p v-if="c.location" class="conflict__item-loc">
              <AppIcon name="pin" :size="13" color="#6B7080" />
              <span class="ellipsis">{{ c.location }}</span>
            </p>
          </li>
        </ul>
        <p v-if="conflicts.length > MAX_SHOWN" class="conflict__rest">{{ restText }}</p>

        <p class="conflict__foot-note">你仍可以保存这条日程。</p>

        <div class="conflict__actions">
          <AppButton class="conflict__btn" type="secondary" @click="emit('cancel')">
            返回修改
          </AppButton>
          <!-- 冲突不是危险操作，主按钮保持品牌色 -->
          <AppButton
            class="conflict__btn"
            type="primary"
            :loading="saving"
            @click="emit('confirm')"
          >
            仍要保存
          </AppButton>
        </div>
      </div>
    </div>
  </Transition>
</template>

<style scoped>
.conflict {
  position: fixed;
  inset: 0;
  z-index: 200;
  display: flex;
  flex-direction: column;
  justify-content: flex-end;
}
.conflict__mask {
  position: absolute;
  inset: 0;
  background: rgba(26, 29, 38, 0.45);
}
.conflict__panel {
  position: relative;
  max-height: 80%;
  overflow-y: auto;
  background: var(--bg-card);
  border-radius: 16px 16px 0 0;
  padding: var(--sp-4) var(--sp-4) calc(var(--sp-4) + var(--safe-bottom));
}
.conflict__head {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
}
.conflict__title {
  font-size: var(--font-heading-m);
  line-height: var(--font-heading-m-lh);
  font-weight: 600;
}
.conflict__sub {
  margin-top: var(--sp-2);
  font-size: var(--font-body-m);
  line-height: var(--font-body-m-lh);
  color: var(--text-secondary);
}
.conflict__list {
  margin-top: var(--sp-3);
  display: flex;
  flex-direction: column;
  gap: var(--sp-2);
}
.conflict__item {
  padding: var(--sp-3);
  background: var(--bg-page);
  border-radius: var(--radius-card);
}
.conflict__item-head {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
}
.conflict__time {
  font-size: var(--font-caption);
  line-height: var(--font-caption-lh);
  color: var(--text-secondary);
  font-variant-numeric: tabular-nums;
}
.conflict__item-title {
  margin-top: 4px;
  font-size: var(--font-body-m);
  line-height: var(--font-body-m-lh);
  color: var(--text-primary);
}
.conflict__item-loc {
  display: flex;
  align-items: center;
  gap: 4px;
  margin-top: 2px;
  font-size: var(--font-caption);
  color: var(--text-secondary);
}
.conflict__rest {
  margin-top: var(--sp-2);
  font-size: var(--font-caption);
  color: var(--text-secondary);
}
.conflict__foot-note {
  margin-top: var(--sp-3);
  font-size: var(--font-caption);
  color: var(--text-secondary);
}
.conflict__actions {
  display: flex;
  gap: var(--sp-3);
  margin-top: var(--sp-3);
}
.conflict__btn {
  flex: 1;
}
.sheet-enter-active,
.sheet-leave-active {
  transition: opacity 220ms ease;
}
.sheet-enter-active .conflict__panel,
.sheet-leave-active .conflict__panel {
  transition: transform 220ms ease;
}
.sheet-enter-from,
.sheet-leave-to {
  opacity: 0;
}
.sheet-enter-from .conflict__panel,
.sheet-leave-to .conflict__panel {
  transform: translateY(100%);
}
</style>