<script setup lang="ts">
import { computed, ref } from 'vue'
import type { Task } from '@/types'
import { dueTone, formatDue } from '@/utils/time'
import AppCheckbox from '../AppCheckbox.vue'
import AppIcon from '../AppIcon.vue'
import PriorityFlag from '../PriorityFlag.vue'
import ProgressBar from './ProgressBar.vue'

/**
 * 项目卡片行（v0.6.0，UXUI 5.1）：
 * 完成勾选（走 4010 级联确认）/ 项目图标 / 名称 / 成员进度条 + 计数；
 * 左滑露出「完成 / 删除」，与普通任务行同一交互结构。
 */
const props = withDefaults(
  defineProps<{
    project: Task
    /** 新建后高亮 2s */
    highlight?: boolean
  }>(),
  { highlight: false }
)

const emit = defineEmits<{
  (e: 'toggle', task: Task): void
  (e: 'detail', task: Task): void
  (e: 'remove', task: Task): void
}>()

const ACTION_WIDTH = 148
const offset = ref(0)
let startX = 0
let startY = 0
let startOffset = 0
let dragging = false
let locked = false

const completed = computed(() => props.project.status === 'completed')
const tone = computed(() => dueTone(props.project))
const timeText = computed(() => formatDue(props.project.due_at))
const hasMembers = computed(() => props.project.member_total > 0)
const allDone = computed(
  () => hasMembers.value && props.project.member_completed >= props.project.member_total
)

const style = computed(() => ({
  transform: `translateX(${offset.value}px)`,
  transition: dragging ? 'none' : 'transform 200ms ease',
}))

function onTouchStart(e: TouchEvent): void {
  const t = e.touches[0]
  const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
  // 左滑触发区为右半区，左侧边缘让给浏览器返回手势
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
  offset.value = Math.min(0, Math.max(-ACTION_WIDTH, startOffset + dx))
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
  emit('toggle', props.project)
}

function onRemove(): void {
  close()
  emit('remove', props.project)
}

defineExpose({ close })
</script>

<template>
  <li class="project-item" :class="{ 'project-item--highlight': highlight }">
    <div class="project-item__actions">
      <button class="project-item__action" @click="onToggle">
        {{ completed ? '恢复' : '完成' }}
      </button>
      <button class="project-item__action project-item__action--danger" @click="onRemove">删除</button>
    </div>
    <div
      class="project-item__body"
      :style="style"
      role="button"
      tabindex="0"
      :aria-label="`项目 ${project.title}，成员 ${project.member_completed}/${project.member_total}`"
      @click="emit('detail', project)"
      @keydown.enter="emit('detail', project)"
      @touchstart.passive="onTouchStart"
      @touchmove="onTouchMove"
      @touchend="onTouchEnd"
      @touchcancel="onTouchEnd"
    >
      <AppCheckbox
        :checked="completed"
        :label="`标记项目「${project.title}」完成`"
        @toggle="onToggle"
      />
      <div class="project-item__main">
        <p class="project-item__title" :class="{ 'project-item__title--done': completed }">
          <AppIcon name="folder" :size="16" color="var(--color-primary)" class="project-item__icon" />
          <span class="ellipsis">{{ project.title }}</span>
        </p>
        <p class="project-item__sub">
          <span
            v-if="project.due_at"
            class="project-item__time"
            :class="{
              'project-item__time--danger': tone === 'danger',
              'project-item__time--warning': tone === 'warning',
            }"
            >{{ timeText }}</span
          >
          <PriorityFlag :priority="project.priority" />
        </p>
        <span v-if="hasMembers" class="project-item__progress">
          <ProgressBar
            :total="project.member_total"
            :completed="project.member_completed"
            :label="`项目成员进度 ${project.member_completed}/${project.member_total}`"
          />
        </span>
      </div>
      <span class="project-item__count" :class="{ 'project-item__count--done': allDone }">
        {{ hasMembers ? `${project.member_completed}/${project.member_total}` : '0 项' }}
      </span>
    </div>
  </li>
</template>

<style scoped>
.project-item {
  position: relative;
  overflow: hidden;
  border-bottom: 1px solid var(--border-color);
}
.project-item--highlight {
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
.project-item__actions {
  position: absolute;
  top: 0;
  right: 0;
  height: 100%;
  display: flex;
}
.project-item__action {
  width: 74px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--text-disabled);
  color: #fff;
  font-size: var(--font-body-m);
}
.project-item__action--danger {
  background: var(--color-danger);
}
.project-item__body {
  position: relative;
  display: flex;
  align-items: flex-start;
  gap: var(--sp-3);
  min-height: 64px;
  padding: var(--sp-3) var(--sp-4);
  background: var(--bg-card);
  will-change: transform;
}
.project-item__body:active {
  background: #fafbff;
}
.project-item__main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 3px;
}
.project-item__title {
  display: flex;
  align-items: center;
  min-width: 0;
  font-size: var(--font-body-l);
  line-height: var(--font-body-l-lh);
  font-weight: 600;
  color: var(--text-primary);
}
.project-item__icon {
  flex-shrink: 0;
  margin-right: 4px;
}
.project-item__title--done {
  color: var(--text-disabled);
  text-decoration: line-through;
}
.project-item__sub {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: var(--font-caption);
  line-height: var(--font-caption-lh);
  color: var(--text-secondary);
}
.project-item__time--danger {
  color: var(--color-danger);
}
.project-item__time--warning {
  color: var(--color-warning);
}
.project-item__progress {
  display: block;
  max-width: 140px;
  margin-top: 2px;
}
.project-item__count {
  flex-shrink: 0;
  align-self: center;
  font-size: var(--font-caption);
  line-height: var(--font-caption-lh);
  color: var(--text-secondary);
  font-variant-numeric: tabular-nums;
}
.project-item__count--done {
  color: var(--color-success);
}
</style>
