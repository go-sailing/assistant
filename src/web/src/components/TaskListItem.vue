<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import type { Task } from '@/types'
import { lockAxis, resolveAxis } from '@/utils/gesture'
import { dueTone, formatDue } from '@/utils/time'
import AppCheckbox from './AppCheckbox.vue'
import AppIcon from './AppIcon.vue'
import PriorityFlag from './PriorityFlag.vue'

/**
 * 任务行（v0.8.0）：副行最前带「所属项目」chip（有项目才渲染，点击直达项目）；
 * 左滑与列表下拉刷新的方向互斥由 utils/gesture 方向锁承担（GES-01）。
 */
const props = withDefaults(
  defineProps<{
    task: Task
    /** 新建后高亮 2s */
    highlight?: boolean
    /** 搜索关键词高亮 */
    keyword?: string
    /** 搜索结果的所属项目路径（如「周末搬家」） */
    path?: string
  }>(),
  { highlight: false, keyword: '', path: '' }
)

const emit = defineEmits<{
  (e: 'toggle', task: Task): void
  (e: 'remove', task: Task): void
  (e: 'detail', task: Task): void
}>()

const router = useRouter()

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

/** v0.7.0：代理执行状态指示（仅 pending/running/failed 展示，含文字不只靠颜色） */
const agentHint = computed(() => {
  if (props.task.agent_id === null || props.task.agent_id === undefined) return null
  const map: Record<string, { text: string; color: string }> = {
    pending: { text: '待领取', color: 'var(--text-secondary)' },
    running: { text: '执行中', color: 'var(--color-primary)' },
    failed: { text: '失败（代理）', color: 'var(--color-danger)' },
  }
  return map[props.task.agent_state] ?? null
})

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
    // 8px 观察期后按主导方向判定：横向主导且锁定成功才进入拖动
    const axis = resolveAxis(dx, dy)
    // 斜向但未达任一主导：本行不拖动、不锁（本次手势仅滚动列表）
    if (axis === null) return
    if (axis === 'v') {
      // 纵向主导：方向归下拉刷新，本行不拖动
      lockAxis('v')
      locked = true
      return
    }
    // 已被纵向锁定（lockAxis 返回 false）时同样不拖动
    if (!lockAxis('h')) {
      locked = true
      return
    }
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

/** 点击项目 chip：直达项目详情（stopPropagation，不进入任务详情） */
function openProject(): void {
  const project = props.task.project
  if (!project) return
  router.push(`/projects/${project.id}`)
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
      <!-- 树形态：展开箭头等前置操作 -->
      <slot name="leading" />
      <AppCheckbox
        :checked="completed"
        :label="`标记「${task.title}」完成`"
        @toggle="onToggle"
      />
      <div class="task-item__main">
        <p class="task-item__title" :class="{ 'task-item__title--done': completed }">
          <span class="task-item__title-text">
            <span v-for="(part, i) in titleParts" :key="i" :class="{ 'task-item__hit': part.hit }">{{
              part.text
            }}</span>
          </span>
          <!-- v0.7.0：代理执行状态（圆点 + 文字，颜色非唯一通道） -->
          <span v-if="agentHint" class="task-item__agent" :style="{ color: agentHint.color }">
            <span
              class="task-item__agent-dot"
              :style="{ background: agentHint.color }"
              aria-hidden="true"
            />
            {{ agentHint.text }}
          </span>
        </p>
        <p class="task-item__sub">
          <!-- v0.8.0 所属项目 chip：无项目时不渲染、不占位 -->
          <button
            v-if="task.project"
            type="button"
            class="task-item__chip"
            :aria-label="`查看项目 ${task.project.name}`"
            @click.stop="openProject"
          >
            <AppIcon name="folder" :size="12" />
            <span class="task-item__chip-name ellipsis">{{ task.project.name }}</span>
          </button>
          <span v-if="path" class="task-item__path ellipsis">{{ path }}</span>
          <span v-if="path && task.due_at" class="task-item__dot">·</span>
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
  display: flex;
  align-items: baseline;
  gap: 6px;
  font-size: var(--font-body-l);
  line-height: var(--font-body-l-lh);
  color: var(--text-primary);
}
.task-item__title-text {
  flex: 1;
  min-width: 0;
  word-break: break-word;
}
.task-item__agent {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  flex-shrink: 0;
  font-size: var(--font-caption);
  line-height: var(--font-caption-lh);
  white-space: nowrap;
}
.task-item__agent-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
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
.task-item__path {
  max-width: 50%;
}
/* v0.8.0 所属项目 chip（高 20pt / 圆角 6 / primary-light 底） */
.task-item__chip {
  position: relative;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  flex-shrink: 0;
  height: 20px;
  padding: 0 6px;
  border-radius: 6px;
  background: var(--color-primary-light);
  color: var(--color-primary);
  font-size: var(--font-caption);
  line-height: var(--font-caption-lh);
}
/* 可点击元素扩热区（视觉 20pt + ::after，UXUI 8） */
.task-item__chip::after {
  content: '';
  position: absolute;
  inset: -11px -4px;
}
.task-item__chip-name {
  max-width: 140px;
}
.task-item__time--danger {
  color: var(--color-danger);
}
.task-item__time--warning {
  color: var(--color-warning);
}
</style>
