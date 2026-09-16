<script setup lang="ts">
import { computed, ref } from 'vue'
import type { ConflictBlock } from '@/types'
import { formatEventRange } from '@/utils/time'
import AppButton from '../AppButton.vue'
import AppIcon from '../AppIcon.vue'

/**
 * 对话中的时间冲突提示块（UX 5.7）。
 * 冲突不是危险操作，因此用 warning 橙而非 danger 红；
 * 「仍要安排」只是把决定交回助手（由模型带 confirm_conflict=true 重试），前端不直接写库。
 */
const props = defineProps<{ block: ConflictBlock }>()

const emit = defineEmits<{ (e: 'change'): void; (e: 'force'): void }>()

const handled = ref<'none' | 'changing' | 'forced'>('none')

const title = computed(() =>
  props.block.conflict_level === 'all_day' ? '该日期已有全天安排' : '这个时段已有安排'
)

/** 最多展示 3 条冲突，多余折叠 */
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
      <ul class="conflict__list">
        <li v-for="c in preview" :key="String(c.id)" class="conflict__item">
          <span class="conflict__time">{{ formatEventRange(c) }}</span>
          <AppIcon v-if="c.event_type === 'task'" name="link" :size="12" color="#7C4DFF" />
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
  align-items: center;
  gap: 4px;
  font-size: var(--font-body-m);
  line-height: var(--font-body-m-lh);
  font-weight: 500;
  color: var(--text-primary);
}
.conflict__list {
  margin-top: var(--sp-2);
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.conflict__item {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: var(--font-caption);
  line-height: var(--font-caption-lh);
  color: var(--text-secondary);
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