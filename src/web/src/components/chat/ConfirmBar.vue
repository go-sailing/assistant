<script setup lang="ts">
import { computed, watch } from 'vue'
import type { ConfirmBlock, SeriesDetail } from '@/types'
import { formatEventCardTime, formatEventRange } from '@/utils/time'
import { logLegacyPlaceholderHit } from '@/utils/telemetry'
import AppButton from '../AppButton.vue'

const props = defineProps<{
  block: ConfirmBlock
  /** pending 待确认 / loading 请求中 / confirmed 已确认 / canceled 已取消 / stale 历史失效 */
  state: 'pending' | 'loading' | 'confirmed' | 'canceled' | 'stale'
}>()

const emit = defineEmits<{ (e: 'confirm'): void; (e: 'cancel'): void }>()

/** 系列卡的 total_count 只存在于系列对象上（CalendarEvent 无此字段） */
function totalCountOf(event: unknown): number | null {
  const n = (event as SeriesDetail | undefined)?.total_count
  return typeof n === 'number' ? n : null
}

const isDelete = computed(
  () =>
    props.block.action === 'delete_event' ||
    props.block.action === 'delete_event_series' ||
    props.block.action === 'batch_update_events'
)

/**
 * v0.9.0：历史消息里的任务/项目类确认条已随能力下线，
 * 不再渲染按钮，统一渲染为「该能力已下线」灰态占位（只读）。
 */
const LEGACY_ACTIONS = ['delete_task', 'batch_update_tasks', 'complete_task_cascade']
const isLegacy = computed(() => LEGACY_ACTIONS.includes(String(props.block.action)))

/**
 * v0.9.0（D-09 / TC-AUDIT-084）：历史确认条占位命中观测。
 * 只记对象类型与动作枚举，**不含任何正文**（历史消息不被改写）。
 * 以 `immediate` 监听在组件建立时即落日志（SSR/首帧渲染均为同一路径）。
 */
watch(
  isLegacy,
  (legacy) => {
    if (legacy) logLegacyPlaceholderHit('confirm', String(props.block.action))
  },
  { immediate: true }
)

/** 操作描述（含影响条数）；服务端已给出权威文案时优先展示 */
const description = computed(() => {
  const { action, count } = props.block
  const firstEvent = (props.block.affected_events ?? [])[0]
  const total = totalCountOf(firstEvent)
  switch (action) {
    case 'delete_event':
      return `确认删除日程「${firstEvent?.title || '该日程'}」？`
    case 'delete_event_series':
      // 循环系列整条删除：文案必须含总次数与不可恢复（UX 7.2）
      return (
        props.block.description ||
        `确认删除循环日程「${firstEvent?.title || '该系列'}」？共 ${total ?? count} 次安排将全部删除，不可恢复`
      )
    case 'batch_update_events':
      return `确认批量处理这 ${count} 个日程？`
    default:
      return props.block.description || `确认执行该操作？（影响 ${count} 项）`
  }
})

/** 确认按钮文案：系列删除用醒目动作文案，避免笼统「确认执行」 */
const confirmText = computed(() => {
  switch (props.block.action) {
    case 'delete_event_series':
      return '删除整条循环'
    default:
      return '确认执行'
  }
})

/** 结果态文案 */
const resultText = computed(() => {
  const { action, count } = props.block
  if (props.state === 'canceled') return '已取消，未执行任何修改'
  if (props.state === 'stale') return '该确认已失效'
  switch (action) {
    case 'delete_event':
      return '已删除该日程'
    case 'delete_event_series':
      return '已删除整条循环日程'
    case 'batch_update_events':
      return `已处理 ${count} 个日程`
    default:
      return `已执行（影响 ${count} 项）`
  }
})

/** 预览项：日程标题（系列按「首/下次时间 + 总次数」呈现） */
const preview = computed(() => {
  const isSeries = props.block.action === 'delete_event_series'
  return (props.block.affected_events ?? []).slice(0, 3).map((e) => {
    const total = totalCountOf(e)
    const when = isSeries ? formatEventCardTime(e) : formatEventRange(e)
    const times = isSeries && total !== null ? ` · 共 ${total} 次` : ''
    return { id: e.id, label: `${when} ${e.title}${times}` }
  })
})
const restCount = computed(() => Math.max(0, props.block.count - preview.value.length))
</script>

<template>
  <div class="confirm" :class="{ 'confirm--done': state !== 'pending' && state !== 'loading' }">
    <!-- v0.9.0：已下线能力的确认条只作灰态占位，不可点击、不请求接口 -->
    <template v-if="isLegacy">
      <p class="confirm__title">{{ block.description || '该操作' }}</p>
      <p class="confirm__legacy">该能力已下线</p>
    </template>
    <template v-else-if="state === 'pending' || state === 'loading'">
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
          {{ confirmText }}
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
.confirm__legacy {
  margin-top: var(--sp-2);
  font-size: var(--font-caption);
  line-height: var(--font-caption-lh);
  color: var(--text-disabled);
}
</style>
