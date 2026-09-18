<script setup lang="ts">
import { computed } from 'vue'
import type { Memory } from '@/types'
import AppIcon from './AppIcon.vue'
import { MEMORY_CATEGORY_LABELS } from '@/utils/constants'

/**
 * v0.5.0：单条记忆卡（UXUI 5.4）。
 *
 * 内容按**纯文本**渲染（不经 MarkdownText，XSS 面无新增）；
 * 类别为受控枚举 → 中文映射；时间为「M 月 D 日归档」（跨年带年份）。
 */
const props = defineProps<{ memory: Memory; removing?: boolean }>()

const emit = defineEmits<{ (e: 'remove', memory: Memory): void }>()

const categoryLabel = computed(
  () => MEMORY_CATEGORY_LABELS[props.memory.category] ?? '其他'
)

/** 归档时间：当年 M 月 D 日归档，跨年 YYYY 年 M 月 D 日 */
const archivedText = computed(() => {
  const date = new Date(props.memory.created_at)
  if (Number.isNaN(date.getTime())) return ''
  const now = new Date()
  const md = `${date.getMonth() + 1} 月 ${date.getDate()} 日`
  return date.getFullYear() === now.getFullYear()
    ? `${md}归档`
    : `${date.getFullYear()} 年 ${md}`
})

/** 删除按钮的可访问名：带内容前 10 字，防多条同名时误删（UXUI 8） */
const removeLabel = computed(() => {
  const head = props.memory.content.slice(0, 10)
  return `删除记忆：${head}${props.memory.content.length > 10 ? '…' : ''}`
})
</script>

<template>
  <article class="memory" :class="{ 'memory--removing': removing }" role="group">
    <p class="memory__content">{{ memory.content }}</p>
    <div class="memory__foot">
      <span class="memory__tag" :aria-label="`类别：${categoryLabel}`">{{ categoryLabel }}</span>
      <span class="memory__time">{{ archivedText }}</span>
      <button
        class="memory__remove pressable"
        type="button"
        :aria-label="removeLabel"
        @click="emit('remove', memory)"
      >
        <AppIcon name="trash" :size="20" color="var(--text-secondary)" />
      </button>
    </div>
  </article>
</template>

<style scoped>
.memory {
  padding: 12px 14px;
  border-radius: 12px;
  background: var(--bg-card);
  transition: opacity 200ms ease;
}
.memory--removing {
  opacity: 0;
}
.memory__content {
  font-size: var(--font-body-m);
  line-height: var(--font-body-m-lh);
  color: var(--text-primary);
  word-break: break-word;
  display: -webkit-box;
  -webkit-line-clamp: 3;
  line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.memory__foot {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  margin-top: var(--sp-2);
}
.memory__tag {
  padding: 2px 6px;
  border-radius: 4px;
  background: var(--color-primary-light);
  color: var(--color-primary);
  font-size: 11px;
  line-height: 16px;
}
.memory__time {
  flex: 1;
  min-width: 0;
  font-size: var(--font-caption);
  line-height: var(--font-caption-lh);
  color: var(--text-secondary);
  font-variant-numeric: tabular-nums;
}
.memory__remove {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 44px;
  height: 44px;
  margin: -10px -10px -10px 0;
  flex-shrink: 0;
}
@media (prefers-reduced-motion: reduce) {
  .memory {
    transition: none;
  }
}
</style>