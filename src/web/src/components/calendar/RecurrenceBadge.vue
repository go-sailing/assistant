<script setup lang="ts">
import { computed } from 'vue'
import AppIcon from '@/components/AppIcon.vue'

const props = defineProps<{
  /** recurring 循环 / modified 已调整 / cancelled 已取消 */
  kind: 'recurring' | 'modified' | 'cancelled'
  /** 覆盖默认文案 */
  text?: string
}>()

const LABELS: Record<'recurring' | 'modified' | 'cancelled', string> = {
  recurring: '循环',
  modified: '已调整',
  cancelled: '已取消',
}

const label = computed(() => props.text || LABELS[props.kind])
</script>

<template>
  <span class="badge" :class="`badge--${kind}`">
    <!-- 循环身份不单靠颜色：胶囊内始终带 repeat 图标 -->
    <AppIcon v-if="kind === 'recurring'" name="repeat" :size="12" />
    <span class="badge__text">{{ label }}</span>
  </span>
</template>

<style scoped>
.badge {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  height: 18px;
  padding: 0 6px;
  border-radius: 9px;
  font-size: var(--font-caption-s);
  line-height: var(--font-caption-s-lh);
  white-space: nowrap;
  flex-shrink: 0;
}
.badge--recurring {
  background: var(--color-primary-light);
  color: var(--color-primary);
}
/* 已调整 = 偏离规则，复用冲突色系（浅底 + 深一档文字，保证对比度） */
.badge--modified {
  background: var(--color-conflict-bg);
  color: var(--color-conflict-text);
}
.badge--cancelled {
  background: var(--color-allday-bg);
  color: var(--text-secondary);
}
</style>
