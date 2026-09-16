<script setup lang="ts">
import { computed, ref } from 'vue'
import type { Task } from '@/types'
import { dueTone, formatDue } from '@/utils/time'
import AppCheckbox from './AppCheckbox.vue'
import PriorityFlag from './PriorityFlag.vue'

const props = withDefaults(
  defineProps<{
    task: Task
    /** 新建后高亮 2s */
    highlight?: boolean
    /** 搜索关键词高亮 */
    keyword?: string
  }>(),
  { highlight: false, keyword: '' }
)

const emit = defineEmits<{
  (e: 'toggle', task: Task): void
  (e: 'remove', task: Task): void
  (e: 'detail', task: Task): void
}>()

const ACTION_WIDTH = 148
const offset = ref(0)
let startX = 0
let startY = 0
let startOffset = 0
let dragging = false
let locked = false

const completed = computed(() => props.task.status === 'completed')
const tone = computed(() => dueTone(props.task))
const timeText = computed(() => formatDue(props.task.due_at))

/** 关键词高亮分段（避免 v-html，安全） */
const titleParts = computed(() => {
  const kw = props.keyword.trim()
  if (!kw) return [{ text: props.task.title, hit: false }]
  const lower = props.task.title.toLowerCase()
  const target = kw.toLowerCase()
  const parts: { text: string; hit: boolean }[] = []
  let i = 0
  for (;;) {
    const idx = lower.indexOf(target, i)
    if (idx < 0) break
    if (idx > i) parts.push({ text: props.task.title.slice(i, idx), hit: false })
    parts.push({ text: props.task.title.slice(idx, idx + kw.length), hit: true })
    i = idx + kw.length
  }
  if (i < props.task.title.length) parts.push({ text: props.task.title.slice(i), hit: false })
  return parts.length ? parts : [{ text: props.task.title, hit: false }]
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

function onToggle(): void {
  close()
  emit('toggle', props.task)
}

function onRemove(): void {
  close()
  emit('remove', props.task)
}

defineExpose({ close })
</script>

<template>
  <li class="task-item" :class="{ 'task-item--highlight': highlight }">
    <div class="task-item__actions">
      <button class="task-item__action" @click="onToggle">
        {{ completed ? '恢复' : '完成' }}
      </button>
      <button class="task-item__action task-item__action--danger" @click="onRemove">删除</button>
    </div>
    <div
      class="task-item__body"
      :style="style"
      role="button"
      tabindex="0"
      @click="emit('detail', task)"
      @keydown.enter="emit('detail', task)"
      @touchstart.passive="onTouchStart"
      @touchmove="onTouchMove"
      @touchend="onTouchEnd"
      @touchcancel="onTouchEnd"
    >
      <AppCheckbox :checked="completed" :label="`标记「${task.title}」完成`" @toggle="onToggle" />
      <div class="task-item__main">
        <p class="task-item__title" :class="{ 'task-item__title--done': completed }">
          <span v-for="(part, i) in titleParts" :key="i" :class="{ 'task-item__hit': part.hit }">{{
            part.text
          }}</span>
        </p>
        <p class="task-item__sub">
          <span class="task-item__list ellipsis">{{ task.list_name || '默认清单' }}</span>
          <span v-if="task.due_at" class="task-item__dot">·</span>
          <span
            v-if="task.due_at"
            class="task-item__time"
            :class="{
              'task-item__time--danger': tone === 'danger',
              'task-item__time--warning': tone === 'warning',
            }"
            >{{ timeText }}</span
          >
          <PriorityFlag :priority="task.priority" />
        </p>
      </div>
    </div>
  </li>
</template>

<style scoped>
.task-item {
  position: relative;
  overflow: hidden;
  border-bottom: 1px solid var(--border-color);
}
.task-item--highlight {
  animation: fade-up 200ms ease;
  background: var(--color-primary-light);
  transition: background 600ms ease 1.4s;
}
@keyframes fade-up {
  from {
    opacity: 0;
    transform: translateY(6px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}
.task-item__actions {
  position: absolute;
  top: 0;
  right: 0;
  height: 100%;
  display: flex;
}
.task-item__action {
  width: 74px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--text-disabled);
  color: #fff;
  font-size: var(--font-body-m);
}
.task-item__action--danger {
  background: var(--color-danger);
}
.task-item__body {
  position: relative;
  display: flex;
  align-items: flex-start;
  gap: var(--sp-3);
  min-height: 56px;
  padding: var(--sp-3) var(--sp-4);
  background: var(--bg-card);
  will-change: transform;
}
.task-item__body:active {
  background: #fafbff;
}
.task-item__main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.task-item__title {
  font-size: var(--font-body-l);
  line-height: var(--font-body-l-lh);
  color: var(--text-primary);
  word-break: break-word;
}
.task-item__title--done {
  color: var(--text-disabled);
  text-decoration: line-through;
}
.task-item__hit {
  background: var(--color-primary-light);
  color: var(--color-primary);
  border-radius: 3px;
}
.task-item__sub {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: var(--font-caption);
  line-height: var(--font-caption-lh);
  color: var(--text-secondary);
}
.task-item__list {
  max-width: 40%;
}
.task-item__time--danger {
  color: var(--color-danger);
}
.task-item__time--warning {
  color: var(--color-warning);
}
</style>