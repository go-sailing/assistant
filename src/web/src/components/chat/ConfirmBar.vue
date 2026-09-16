<script setup lang="ts">
import { computed } from 'vue'
import type { ConfirmBlock } from '@/types'
import { formatEventRange } from '@/utils/time'
import AppButton from '../AppButton.vue'

const props = defineProps<{
  block: ConfirmBlock
  /** pending 待确认 / loading 请求中 / confirmed 已确认 / canceled 已取消 / stale 历史失效 */
  state: 'pending' | 'loading' | 'confirmed' | 'canceled' | 'stale'
}>()

const emit = defineEmits<{ (e: 'confirm'): void; (e: 'cancel'): void }>()

const isDelete = computed(
  () =>
    props.block.action === 'delete_task' ||
    props.block.action === 'delete_list' ||
    props.block.action === 'delete_event' ||
    props.block.action === 'batch_update_events'
)

/** 日程类危险操作：影响对象来自 affected_events */
const isEventAction = computed(
  () => props.block.action === 'delete_event' || props.block.action === 'batch_update_events'
)

/** 操作描述（含影响条数） */
const description = computed(() => {
  const { action, count, affected } = props.block
  const first = affected[0]?.title
  const firstEvent = (props.block.affected_events ?? [])[0]
  switch (action) {
    case 'delete_task':
      return count > 1 ? `确认删除这 ${count} 个任务？` : `确认删除「${first || '该任务'}」？`
    case 'delete_list':
      return `确认删除该清单？其中 ${count} 个任务将移至默认清单`
    case 'batch_update_tasks':
      return `确认批量修改这 ${count} 个任务？`
    case 'delete_event':
      return `确认删除日程「${firstEvent?.title || '该日程'}」？`
    case 'batch_update_events':
      return `确认批量处理这 ${count} 个日程？`
    default:
      return `确认执行该操作？（影响 ${count} 项）`
  }
})

/** 结果态文案 */
const resultText = computed(() => {
  const { action, count } = props.block
  if (props.state === 'canceled') return '已取消，未执行任何修改'
  if (props.state === 'stale') return '该确认已失效'
  switch (action) {
    case 'delete_task':
      return `已删除 ${count} 个任务`
    case 'delete_list':
      return `已删除清单，${count} 个任务已移至默认清单`
    case 'batch_update_tasks':
      return `已更新 ${count} 个任务`
    case 'delete_event':
      return '已删除该日程'
    case 'batch_update_events':
      return `已处理 ${count} 个日程`
    default:
      return `已执行（影响 ${count} 项）`
  }
})

/** 预览项：任务标题或日程标题 */
const preview = computed(() => {
  if (isEventAction.value) {
    return (props.block.affected_events ?? [])
      .slice(0, 3)
      .map((e) => ({ id: e.id, label: `${formatEventRange(e)} ${e.title}` }))
  }
  return props.block.affected.slice(0, 3).map((t) => ({ id: t.id, label: t.title }))
})
const restCount = computed(() => Math.max(0, props.block.count - preview.value.length))
</script>

<template>
  <div class="confirm" :class="{ 'confirm--done': state !== 'pending' && state !== 'loading' }">
    <template v-if="state === 'pending' || state === 'loading'">
      <p class="confirm__title">{{ description }}</p>
      <ul v-if="preview.length" class="confirm__list">
        <li v-for="item in preview" :key="String(item.id)" class="confirm__item ellipsis">
          · {{ item.label }}
        </li>
        <li v-if="restCount" class="confirm__item">等 {{ restCount }} 项</li>
      </ul>
      <div class="confirm__actions">
        <AppButton
          type="secondary"
          size="small"
          :disabled="state === 'loading'"
          @click="emit('cancel')"
        >
          取消
        </AppButton>
        <AppButton
          :type="isDelete ? 'danger' : 'primary'"
          size="small"
          :loading="state === 'loading'"
          @click="emit('confirm')"
        >
          确认执行
        </AppButton>
      </div>
    </template>
    <template v-else>
      <p class="confirm__result">{{ resultText }}</p>
    </template>
  </div>
</template>

<style scoped>
.confirm {
  background: #fff5f4;
  border: 1px solid rgba(245, 72, 59, 0.24);
  border-radius: var(--radius-card);
  padding: var(--sp-3);
}
.confirm--done {
  background: var(--bg-page);
  border-color: var(--border-color);
}
.confirm__title {
  font-size: var(--font-body-m);
  line-height: var(--font-body-m-lh);
  color: var(--text-primary);
  font-weight: 500;
}
.confirm__list {
  margin-top: var(--sp-2);
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.confirm__item {
  font-size: var(--font-caption);
  line-height: var(--font-caption-lh);
  color: var(--text-secondary);
}
.confirm__actions {
  display: flex;
  justify-content: flex-end;
  gap: var(--sp-2);
  margin-top: var(--sp-3);
}
.confirm__result {
  font-size: var(--font-body-m);
  line-height: var(--font-body-m-lh);
  color: var(--text-secondary);
}
</style>