<script setup lang="ts">
import { computed, ref } from 'vue'
import type { CalendarEvent, Occurrence } from '@/types'
import { formatEventRange, isOngoing } from '@/utils/time'
import AppCheckbox from '@/components/AppCheckbox.vue'
import AppIcon from '@/components/AppIcon.vue'
import PriorityFlag from '@/components/PriorityFlag.vue'
import RecurrenceBadge from '@/components/calendar/RecurrenceBadge.vue'

const props = defineProps<{
  event: CalendarEvent
  /** 与其它日程时间重叠（由父级判定） */
  conflict?: boolean
  showCheckbox?: boolean
}>()

const emit = defineEmits<{
  (e: 'detail', event: CalendarEvent): void
  (e: 'toggle', event: CalendarEvent): void
  (e: 'edit', event: CalendarEvent): void
  (e: 'remove', event: CalendarEvent): void
}>()

const ACTION_WIDTH = 148
const offset = ref(0)
let startX = 0
let startY = 0
let startOffset = 0
let dragging = false
let locked = false

const completed = computed(() => props.event.task?.status === 'completed')
const ongoing = computed(() => isOngoing(props.event))
const rangeText = computed(() => formatEventRange(props.event))
const isTask = computed(() => props.event.event_type === 'task')
const showCheck = computed(() => !!props.showCheckbox && !!props.event.task)
const checkLabel = computed(() => `完成关联任务：${props.event.task?.title ?? ''}`)

/** v0.2.0：展开后的循环实例带 series_id / override_state（任务日程不循环） */
const isRecurring = computed(() => !!(props.event as Partial<Occurrence>).series_id)
const overrideState = computed(() => (props.event as Partial<Occurrence>).override_state)
const isModified = computed(() => isRecurring.value && overrideState.value === 'modified')

/** 左侧类型竖条：全天用中性色（全天不占具体时段，弱化类型区分） */
const barColor = computed(() => {
  if (props.event.all_day) return 'var(--text-disabled)'
  return isTask.value ? 'var(--color-link)' : 'var(--color-primary)'
})

/** 读屏用户无法看到颜色与竖条，用文案补齐类型与状态 */
const ariaLabel = computed(() => {
  const parts = [
    isTask.value ? '任务日程' : isRecurring.value ? '循环日程中的一次' : '普通日程',
    props.event.title,
    rangeText.value,
  ]
  if (isModified.value) parts.push('已调整')
  if (ongoing.value) parts.push('进行中')
  if (props.conflict) parts.push('时间冲突')
  return parts.join('，')
})

const style = computed(() => ({
  transform: `translateX(${offset.value}px)`,
  transition: dragging ? 'none' : 'transform 200ms ease',
}))

function onTouchStart(e: TouchEvent): void {
  const t = e.touches[0]
  // 左滑触发区为右半区，左侧边缘让给浏览器返回手势
  const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
  if (t.clientX - rect.left < rect.width / 2) {
    locked = true
    return
  }
  locked = false
  startX = t.clientX
  startY = t.clientY
  startOffset = offset.value
  dragging = false
}

function onTouchMove(e: TouchEvent): void {
  if (locked) return
  const t = e.touches[0]
  const dx = t.clientX - startX
  const dy = t.clientY - startY
  if (!dragging) {
    if (Math.abs(dx) < 8 || Math.abs(dx) < Math.abs(dy)) return
    dragging = true
  }
  const next = Math.min(0, Math.max(-ACTION_WIDTH, startOffset + dx))
  offset.value = next
}

function onTouchEnd(): void {
  if (locked) {
    locked = false
    return
  }
  dragging = false
  offset.value = offset.value < -ACTION_WIDTH / 2 ? -ACTION_WIDTH : 0
}

function close(): void {
  offset.value = 0
}

function onEdit(): void {
  close()
  emit('edit', props.event)
}

function onRemove(): void {
  close()
  emit('remove', props.event)
}

function onToggle(): void {
  close()
  emit('toggle', props.event)
}

function onDetail(): void {
  if (offset.value !== 0) {
    close()
    return
  }
  emit('detail', props.event)
}

defineExpose({ close })
</script>

<template>
  <li class="agenda">
    <div class="agenda__actions">
      <button class="agenda__action" @click="onEdit">编辑</button>
      <button class="agenda__action agenda__action--danger" @click="onRemove">删除</button>
    </div>

    <div
      class="agenda__body"
      :style="style"
      role="button"
      tabindex="0"
      :aria-label="ariaLabel"
      @click="onDetail"
      @keydown.enter="onDetail"
      @touchstart.passive="onTouchStart"
      @touchmove="onTouchMove"
      @touchend="onTouchEnd"
      @touchcancel="onTouchEnd"
    >
      <span class="agenda__bar" :style="{ background: barColor }" aria-hidden="true" />

      <div class="agenda__main" :class="{ 'agenda__main--done': completed }">
        <div class="agenda__row">
          <span class="agenda__time">{{ rangeText }}</span>
          <span class="agenda__chips">
            <span v-if="conflict" class="agenda__chip agenda__chip--conflict">
              <AppIcon name="conflict" :size="12" />
              冲突
            </span>
            <span v-if="ongoing" class="agenda__chip agenda__chip--ongoing">进行中</span>
          </span>
          <!-- 勾选框独立拦截触摸手势，避免点勾选时误触发左滑 -->
          <span
            v-if="showCheck"
            class="agenda__check"
            @touchstart.stop
            @touchmove.stop
            @touchend.stop
          >
            <AppCheckbox :checked="completed" :label="checkLabel" @toggle="onToggle" />
          </span>
        </div>

        <p class="agenda__title" :class="{ 'agenda__title--done': completed }">
          <AppIcon v-if="isTask" name="link" :size="14" color="var(--color-link)" />
          <AppIcon
            v-else-if="isRecurring"
            name="repeat"
            :size="14"
            color="var(--color-primary)"
          />
          <span class="agenda__title-text">{{ event.title }}</span>
          <RecurrenceBadge v-if="isModified" kind="modified" />
        </p>

        <p v-if="event.location || event.task" class="agenda__meta">
          <template v-if="event.location">
            <AppIcon name="pin" :size="13" color="#6B7080" />
            <span class="agenda__meta-text ellipsis">{{ event.location }}</span>
          </template>
          <PriorityFlag v-if="event.task" :priority="event.task.priority" />
        </p>
      </div>
    </div>
  </li>
</template>

<style scoped>
.agenda {
  position: relative;
  overflow: hidden;
  border-radius: var(--radius-card);
  margin-bottom: var(--sp-2);
}
.agenda__actions {
  position: absolute;
  top: 0;
  right: 0;
  height: 100%;
  display: flex;
}
.agenda__action {
  width: 74px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--text-disabled);
  color: #fff;
  font-size: var(--font-body-m);
}
.agenda__action--danger {
  background: var(--color-danger);
}
.agenda__body {
  position: relative;
  display: flex;
  align-items: stretch;
  min-height: 64px;
  padding-right: var(--sp-3);
  background: var(--bg-card);
  will-change: transform;
}
.agenda__bar {
  width: 4px;
  flex-shrink: 0;
  border-radius: 0 2px 2px 0;
}
.agenda__main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: var(--sp-3) 0 var(--sp-3) var(--sp-3);
}
.agenda__row {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  min-height: 22px;
}
.agenda__time {
  font-size: var(--font-caption);
  line-height: var(--font-caption-lh);
  color: var(--text-secondary);
  font-variant-numeric: tabular-nums;
  flex-shrink: 0;
}
.agenda__chips {
  display: flex;
  align-items: center;
  gap: 4px;
  flex: 1;
  min-width: 0;
  flex-wrap: wrap;
}
.agenda__chip {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  height: 18px;
  padding: 0 6px;
  border-radius: 9px;
  font-size: var(--font-caption-s);
  line-height: var(--font-caption-s-lh);
  flex-shrink: 0;
}
/* 冲突：图标 + 文字，避免只靠橙色传达 */
.agenda__chip--conflict {
  background: var(--color-conflict-bg);
  color: var(--color-conflict-text);
}
.agenda__chip--ongoing {
  background: var(--bg-page);
  color: var(--color-success);
  border: 1px solid var(--color-success);
}
.agenda__check {
  display: flex;
  align-items: center;
  flex-shrink: 0;
}
.agenda__title {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: var(--font-body-l);
  line-height: var(--font-body-l-lh);
  color: var(--text-primary);
  word-break: break-word;
}
.agenda__title-text {
  min-width: 0;
}
.agenda__title--done .agenda__title-text {
  color: var(--text-disabled);
  text-decoration: line-through;
}
/* 关联任务已完成：整行（时段/标题/地点）一起划线置灰，不只标题 */
.agenda__main--done .agenda__time,
.agenda__main--done .agenda__meta-text {
  color: var(--text-disabled);
  text-decoration: line-through;
}
.agenda__main--done .agenda__chip {
  opacity: 0.5;
}
.agenda__meta {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: var(--font-caption);
  line-height: var(--font-caption-lh);
  color: var(--text-secondary);
}
.agenda__meta-text {
  max-width: 60%;
}
</style>