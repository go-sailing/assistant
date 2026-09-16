<script setup lang="ts">
import { computed } from 'vue'
import type { SubtaskGroup, Task } from '@/types'
import AppIcon from '../AppIcon.vue'

/**
 * 对话内子任务组卡片（UX 5.10）。
 * 自包含实现：层级由 nodes 的 depth/parent_id 还原，缩进 + 树引导线表达父子关系，
 * 进度用「文字计数 + 4pt 进度条」双重表达，不只靠颜色。
 */
const props = defineProps<{ group: SubtaskGroup }>()

const emit = defineEmits<{ (e: 'task', task: Task): void }>()

/** 折叠阈值：超过 3 条子任务折叠（「查看全部 N 项」进入任务详情） */
const FOLD = 3
/** 树缩进：每级 14px，第 5 级不再缩进 */
const INDENT_STEP = 14
const MAX_LEVEL = 4

const nodes = computed<Task[]>(() => props.group.nodes || [])

/** 根节点（父任务）：被删除时整组降级为占位 */
const root = computed<Task | null>(
  () => nodes.value.find((n) => String(n.id) === String(props.group.root_task_id)) || null
)

/** 直接子任务（服务端未给进度时的兜底口径） */
const directChildren = computed<Task[]>(() =>
  nodes.value.filter((n) => String(n.parent_id) === String(props.group.root_task_id))
)

const progress = computed(() => {
  const r = root.value
  const total = r?.subtask_total ?? directChildren.value.length
  const done =
    r?.subtask_completed ?? directChildren.value.filter((n) => n.status === 'completed').length
  return { done, total }
})

const percent = computed(() =>
  progress.value.total ? Math.round((progress.value.done / progress.value.total) * 100) : 0
)

/** 扁平节点 → 缩进行（level 相对根任务，根任务行单独渲染） */
const rows = computed(() => {
  const list = nodes.value
  const r = root.value
  const byId = new Map(list.map((n) => [String(n.id), n]))
  // 优先用服务端 depth；缺失时按 parent_id 回溯
  const depthOf = (node: Task): number => {
    if (typeof node.depth === 'number' && node.depth > 0) return node.depth
    let depth = 1
    let cur: Task | undefined = node
    for (let i = 0; i < 32 && cur && cur.parent_id != null; i += 1) {
      const parent: Task | undefined = byId.get(String(cur.parent_id))
      if (!parent) break
      cur = parent
      depth += 1
    }
    return depth
  }
  const base = r ? depthOf(r) : 1
  return list
    .filter((n) => (r ? String(n.id) !== String(r.id) : true))
    .map((n) => {
      const level = Math.min(Math.max(depthOf(n) - base, 1), MAX_LEVEL)
      return { task: n, level, indent: (level - 1) * INDENT_STEP }
    })
})

/** 折叠态只展示前 3 条，其余通过「查看全部 N 项」进入任务详情 */
const visibleRows = computed(() => rows.value.slice(0, FOLD))
</script>

<template>
  <!-- 父任务已被删除（服务端 missing 标记或根节点缺失）：整组渲染占位，不展示陈旧快照 -->
  <div v-if="group.missing || !root" class="sgroup sgroup--missing">
    <div class="sgroup__row">
      <AppIcon name="list" :size="16" color="#B5B9C4" />
      <p class="sgroup__missing">该任务已删除</p>
    </div>
  </div>

  <div v-else class="sgroup">
    <button
      type="button"
      class="sgroup__head pressable"
      :aria-label="`查看任务 ${root.title}，子任务 ${progress.done}/${progress.total}`"
      @click="emit('task', root)"
    >
      <span class="sgroup__main">
        <span class="sgroup__title" :class="{ 'sgroup__title--done': root.status === 'completed' }">
          {{ root.title }}
        </span>
        <span class="sgroup__count">子任务 {{ progress.done }}/{{ progress.total }}</span>
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

    <ul v-if="rows.length" class="sgroup__list" role="tree">
      <li
        v-for="row in visibleRows"
        :key="String(row.task.id)"
        role="treeitem"
        :aria-level="row.level"
        :aria-selected="false"
      >
        <button
          type="button"
          class="sgroup__node pressable"
          :style="{ paddingLeft: `${row.indent}px` }"
          :aria-label="`查看任务 ${row.task.title}${row.task.status === 'completed' ? '，已完成' : ''}`"
          @click="emit('task', row.task)"
        >
          <span v-if="row.indent" class="sgroup__line" aria-hidden="true" />
          <svg class="sgroup__mark" width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
            <g
              stroke="currentColor"
              stroke-width="1.8"
              fill="none"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <rect x="4" y="4" width="16" height="16" rx="4" />
              <path v-if="row.task.status === 'completed'" d="M8 12.5l3 3 5.5-6" />
            </g>
          </svg>
          <span
            class="sgroup__node-title"
            :class="{ 'sgroup__node-title--done': row.task.status === 'completed' }"
          >
            {{ row.task.title }}
          </span>
          <span v-if="row.task.status === 'completed'" class="sgroup__pill">已完成</span>
        </button>
      </li>
    </ul>

    <button
      v-if="rows.length > FOLD"
      type="button"
      class="sgroup__more pressable"
      @click="emit('task', root)"
    >
      查看全部 {{ rows.length }} 项
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
.sgroup__title--done {
  color: var(--text-disabled);
  text-decoration: line-through;
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
  position: relative;
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
.sgroup__line {
  position: absolute;
  left: 6px;
  top: 0;
  bottom: 0;
  width: 1px;
  background: var(--color-allday-bg);
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
