<script setup lang="ts">
import { computed, ref } from 'vue'
import type { Project } from '@/types'
import { lockAxis, resolveAxis } from '@/utils/gesture'
import AppIcon from '../AppIcon.vue'
import ProgressBar from './ProgressBar.vue'

/**
 * 项目卡片行（v0.8.0，UXUI 5.5）：
 * 项目图标 / 名称 / 状态徽标（派生只读）/ 成员进度条 + 计数；
 * 左滑操作区只剩「删除」（ACTION_WIDTH 收为 74）；无勾选框、无副行
 * （项目模型已无优先级与截止时间）。
 */
const props = withDefaults(
  defineProps<{
    project: Project
    /** 新建后高亮 2s */
    highlight?: boolean
  }>(),
  { highlight: false }
)

const emit = defineEmits<{
  (e: 'detail', project: Project): void
  (e: 'remove', project: Project): void
}>()

/** v0.8.0：仅「删除」一个按钮，宽度 74pt（UXUI 6.2） */
const ACTION_WIDTH = 74
const offset = ref(0)
let startX = 0
let startY = 0
let startOffset = 0
let dragging = false
/** 起手不在右半区：本行不参与左滑（左边缘让给浏览器返回手势） */
let locked = false

const completed = computed(() => props.project.status === 'completed')
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
    // 8px 观察期后与滚动容器共用方向锁：纵向已锁定（下拉刷新）时本行不进入拖动
    const axis = resolveAxis(dx, dy)
    if (axis === 'h' && lockAxis('h')) {
      dragging = true
    } else {
      if (axis) lockAxis(axis)
      return
    }
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

function onRemove(): void {
  close()
  emit('remove', props.project)
}

defineExpose({ close })
</script>

<template>
  <li class="project-item" :class="{ 'project-item--highlight': highlight }">
    <div class="project-item__actions">
      <button class="project-item__action project-item__action--danger" @click="onRemove">删除</button>
    </div>
    <div
      class="project-item__body"
      :style="style"
      role="button"
      tabindex="0"
      :aria-label="`项目 ${project.name}，成员 ${project.member_completed}/${project.member_total}`"
      @click="emit('detail', project)"
      @keydown.enter="emit('detail', project)"
      @touchstart.passive="onTouchStart"
      @touchmove="onTouchMove"
      @touchend="onTouchEnd"
      @touchcancel="onTouchEnd"
    >
      <div class="project-item__main">
        <p class="project-item__title">
          <AppIcon name="folder" :size="16" color="var(--color-primary)" class="project-item__icon" />
          <span class="ellipsis">{{ project.name }}</span>
          <span
            class="project-item__badge"
            :class="completed ? 'project-item__badge--done' : 'project-item__badge--doing'"
          >
            {{ completed ? '已完成' : '进行中' }}
          </span>
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
/* 状态徽标：派生只读（进行中 primary-light / 已完成 bg-page + 次级色） */
.project-item__badge {
  flex-shrink: 0;
  margin-left: auto;
  padding: 0 var(--sp-2);
  border-radius: 6px;
  font-size: var(--font-caption);
  line-height: var(--font-caption-lh);
  font-weight: 400;
}
.project-item__badge--doing {
  background: var(--color-primary-light);
  color: var(--color-primary);
}
.project-item__badge--done {
  background: var(--bg-page);
  color: var(--text-secondary);
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
