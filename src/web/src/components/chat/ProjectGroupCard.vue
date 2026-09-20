<script setup lang="ts">
import { computed } from 'vue'
import { useRouter } from 'vue-router'
import type { ProjectGroup, Task } from '@/types'
import AppIcon from '../AppIcon.vue'

/**
 * 对话内项目结果组卡片（v0.8.0，UX 5.11）。
 * 项目与成员任务均按云端下发的快照渲染：标题取 group.name，
 * 进度取 group.member_total / member_completed，成员直接渲染 group.nodes（扁平一层，无层级缩进），
 * 不再依赖任务类型字段与 parent_id 过滤。
 */
const props = defineProps<{ group: ProjectGroup }>()

/** 成员行点击沿用既有 task 事件协议（由 MessageBlocks 转发为任务详情跳转） */
const emit = defineEmits<{ (e: 'task', task: Task): void }>()

const router = useRouter()

/** 折叠阈值：超过 3 个成员折叠（「查看全部 N 项」进入项目详情） */
const FOLD = 3

const nodes = computed<Task[]>(() => props.group.nodes || [])
const progress = computed(() => ({
  done: props.group.member_completed,
  total: props.group.member_total,
}))
const percent = computed(() =>
  progress.value.total ? Math.round((progress.value.done / progress.value.total) * 100) : 0
)
/** 折叠态只展示前 3 条，其余通过「查看全部 N 项」进入项目详情 */
const visibleRows = computed(() => nodes.value.slice(0, FOLD))

/** 整卡 /「查看全部」→ 项目详情（`from=chat` 保留「返回对话」语义） */
function openProject(): void {
  router.push(`/projects/${props.group.project_id}?from=chat`)
}

function openTask(task: Task): void {
  emit('task', task)
}
</script>

<template>
  <!-- 项目已被删除（服务端 missing 标记）：整组渲染占位，不展示陈旧快照 -->
  <div v-if="group.missing" class="sgroup sgroup--missing">
    <div class="sgroup__row">
      <AppIcon name="list" :size="16" color="#B5B9C4" />
      <p class="sgroup__missing">该项目已删除</p>
    </div>
  </div>

  <div v-else class="sgroup">
    <button
      type="button"
      class="sgroup__head pressable"
      :aria-label="`查看项目 ${group.name}，成员 ${progress.done}/${progress.total}`"
      @click="openProject"
    >
      <span class="sgroup__main">
        <span class="sgroup__title">{{ group.name }}</span>
        <span class="sgroup__count">成员 {{ progress.done }}/{{ progress.total }}</span>
      </span>
      <AppIcon name="chevron-right" :size="18" color="#B5B9C4" />
    </button>

    <div
      class="sgroup__bar"
      role="progressbar"
      :aria-valuenow="progress.done"
      aria-valuemin="0"
      :aria-valuemax="progress.total || 1"
    >
      <span
        class="sgroup__fill"
        :class="{ 'sgroup__fill--done': progress.total > 0 && progress.done >= progress.total }"
        :style="{ width: `${percent}%` }"
      />
    </div>

    <ul v-if="nodes.length" class="sgroup__list" role="list">
      <li v-for="task in visibleRows" :key="String(task.id)">
        <button
          type="button"
          class="sgroup__node pressable"
          :aria-label="`查看任务 ${task.title}${task.status === 'completed' ? '，已完成' : ''}`"
          @click="openTask(task)"
        >
          <svg class="sgroup__mark" width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
            <g
              stroke="currentColor"
              stroke-width="1.8"
              fill="none"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <rect x="4" y="4" width="16" height="16" rx="4" />
              <path v-if="task.status === 'completed'" d="M8 12.5l3 3 5.5-6" />
            </g>
          </svg>
          <span
            class="sgroup__node-title"
            :class="{ 'sgroup__node-title--done': task.status === 'completed' }"
          >
            {{ task.title }}
          </span>
          <span v-if="task.status === 'completed'" class="sgroup__pill">已完成</span>
        </button>
      </li>
    </ul>

    <button
      v-if="nodes.length > FOLD"
      type="button"
      class="sgroup__more pressable"
      @click="openProject"
    >
      查看全部 {{ nodes.length }} 项
    </button>
  </div>
</template>

<style scoped>
.sgroup {
  background: var(--bg-card);
  border: 1px solid var(--border-color);
  border-left: 4px solid var(--color-primary);
  border-radius: var(--radius-card);
  overflow: hidden;
}
.sgroup--missing {
  border-left-color: var(--text-disabled);
  background: var(--bg-page);
}
.sgroup__row {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  padding: var(--sp-3);
}
.sgroup__missing {
  font-size: var(--font-body-m);
  line-height: var(--font-body-m-lh);
  color: var(--text-disabled);
}
.sgroup__head {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  width: 100%;
  min-height: 44px;
  padding: var(--sp-2) var(--sp-3);
  text-align: left;
}
.sgroup__head:active {
  background: #fafbff;
}
.sgroup__main {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: baseline;
  gap: var(--sp-2);
}
.sgroup__title {
  font-size: var(--font-body-l);
  line-height: var(--font-body-l-lh);
  color: var(--text-primary);
  word-break: break-word;
}
.sgroup__count {
  flex-shrink: 0;
  font-size: var(--font-caption);
  line-height: var(--font-caption-lh);
  color: var(--text-secondary);
  font-variant-numeric: tabular-nums;
}
.sgroup__bar {
  height: 4px;
  margin: 0 var(--sp-3);
  border-radius: 2px;
  background: var(--border-color);
  overflow: hidden;
}
.sgroup__fill {
  display: block;
  height: 100%;
  border-radius: 2px;
  background: var(--color-primary);
  transition: width var(--dur-page) ease-out;
}
.sgroup__fill--done {
  background: var(--color-success);
}
.sgroup__list {
  display: flex;
  flex-direction: column;
  padding: var(--sp-2) var(--sp-3) 0;
}
.sgroup__node {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  width: 100%;
  min-height: 44px;
  padding-right: var(--sp-2);
  text-align: left;
  color: var(--text-secondary);
}
.sgroup__node:active {
  background: #fafbff;
}
.sgroup__mark {
  flex-shrink: 0;
  color: var(--text-disabled);
}
.sgroup__node-title {
  flex: 1;
  min-width: 0;
  font-size: var(--font-body-m);
  line-height: var(--font-body-m-lh);
  color: var(--text-primary);
  word-break: break-word;
}
.sgroup__node-title--done {
  color: var(--text-disabled);
  text-decoration: line-through;
}
.sgroup__pill {
  flex-shrink: 0;
  height: 18px;
  padding: 0 6px;
  border-radius: 9px;
  background: var(--color-allday-bg);
  color: var(--text-secondary);
  font-size: var(--font-caption-s);
  line-height: 18px;
}
.sgroup__more {
  width: 100%;
  min-height: 44px;
  padding: 0 var(--sp-3);
  text-align: left;
  font-size: var(--font-caption);
  color: var(--color-primary);
}
</style>
