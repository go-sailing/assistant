<script setup lang="ts">
import { computed, inject, provide, reactive, ref, watch } from 'vue'
import type { InjectionKey } from 'vue'
import { useRouter } from 'vue-router'
import * as taskApi from '@/api/tasks'
import { ApiError, errorText } from '@/api/client'
import type { Task } from '@/types'
import { useToastStore } from '@/stores/toast'
import AppIcon from '../AppIcon.vue'
import AppModal from '../AppModal.vue'
import SubtaskComposer from './SubtaskComposer.vue'
import SubtaskRow from './SubtaskRow.vue'

interface TreeState {
  /** 已知的扁平节点（含懒加载合并进来的节点） */
  nodes: Task[]
  /** 已展开的节点 id */
  expanded: Set<string>
  /** 已拉取过下一级的节点 id（会话内缓存，不重复请求） */
  loaded: Set<string>
  /** 正在拉取的节点 id */
  loading: Set<string>
  /** 节点 id -> 加载失败文案 */
  errors: Record<string, string>
  /** 节点 id -> 非阻断提示（如节点数超限） */
  notices: Record<string, string>
  /** 正在行内添加子任务的目标节点 id */
  composing: string
}

const TREE_KEY: InjectionKey<TreeState> = Symbol('subtask-tree')
/** 服务端子树节点上限（系统设计 6.6） */
const NODE_LIMIT = 200

const props = withDefaults(
  defineProps<{
    /** 扁平节点数组（含 rootId 自身与其后代） */
    nodes: Task[]
    /** 本次渲染的树根：本实例渲染它的直接子级 */
    rootId: number | string
    /** 只读模式：不可勾选/展开/添加 */
    interactive?: boolean
    /** 本层行在整棵树中的层级（根任务 = 1，故直接子级为 2） */
    level?: number
  }>(),
  { interactive: true, level: 2 }
)

const emit = defineEmits<{ (e: 'changed'): void }>()

const router = useRouter()
const toast = useToastStore()

/* 递归子实例通过 provide/inject 复用顶层的同一份状态，保证展开态与缓存在整棵树内共享 */
const injected = inject(TREE_KEY, null)
const isOwner = !injected
const state: TreeState =
  injected ??
  reactive<TreeState>({
    nodes: [],
    expanded: new Set<string>(),
    loaded: new Set<string>(),
    loading: new Set<string>(),
    errors: {},
    notices: {},
    composing: '',
  })
if (isOwner) provide(TREE_KEY, state)

/** 合并服务端 DTO：已存在节点原位替换，新节点追加（保持服务端返回顺序） */
function mergeNodes(list: Task[]): void {
  if (!list.length) return
  const incoming = new Map(list.map((n) => [String(n.id), n]))
  const merged: Task[] = state.nodes.map((n) => incoming.get(String(n.id)) ?? n)
  const known = new Set(merged.map((n) => String(n.id)))
  list.forEach((n) => {
    const id = String(n.id)
    if (!known.has(id)) {
      known.add(id)
      merged.push(n)
    }
  })
  state.nodes = merged
}

if (isOwner) {
  // 顶层实例负责把外部传入的节点同步进共享状态（筛选/排序切换后由父层传入新数组）
  watch(() => props.nodes, (list) => mergeNodes(list || []), { immediate: true })
}

const nodeId = computed(() => String(props.rootId))
const rootNode = computed(() => state.nodes.find((n) => String(n.id) === nodeId.value) || null)
/** 由 parent_id 从扁平数组还原出的直接子级 */
const children = computed(() => {
  const pid = nodeId.value
  return state.nodes.filter((n) => n.parent_id !== null && String(n.parent_id) === pid)
})
const loading = computed(() => state.loading.has(nodeId.value))
const error = computed(() => state.errors[nodeId.value] || '')
const composing = computed(() => state.composing === nodeId.value)
/** 无直接子任务且未在加载中：展示弱引导 */
const isEmpty = computed(
  () => !children.value.length && !loading.value && !!rootNode.value && rootNode.value.subtask_total === 0
)
const childLevel = computed(() => Math.min(props.level + 1, 5))

function isExpanded(task: Task): boolean {
  return state.expanded.has(String(task.id))
}

function isChildLoading(task: Task): boolean {
  return state.loading.has(String(task.id))
}

/** 懒加载某节点的下一级（depth=1 返回该节点自身 + 直接子级） */
async function loadChildren(id: string): Promise<void> {
  if (state.loading.has(id)) return
  state.loading.add(id)
  state.errors[id] = ''
  try {
    const list = await taskApi.fetchSubtree(id, 1)
    mergeNodes(list)
    state.loaded.add(id)
    if (list.length >= NODE_LIMIT) state.notices[id] = `子任务过多，仅展示前 ${NODE_LIMIT} 项`
  } catch (e) {
    state.errors[id] = errorText(e)
  } finally {
    state.loading.delete(id)
  }
}

async function toggleExpand(task: Task): Promise<void> {
  if (!props.interactive) return
  const id = String(task.id)
  if (state.expanded.has(id)) {
    state.expanded.delete(id)
    return
  }
  state.expanded.add(id)
  if (state.loaded.has(id)) return
  await loadChildren(id)
}

/* ---------------- 勾选与级联完成 ---------------- */

const busyId = ref('')
const cascade = ref<{ task: Task; count: number } | null>(null)

function applyNode(task: Task): void {
  const id = String(task.id)
  const i = state.nodes.findIndex((n) => String(n.id) === id)
  if (i >= 0) state.nodes.splice(i, 1, task)
  else state.nodes.push(task)
}

/** 4010：父任务带未完成子任务，取 details 里的数量用于确认文案 */
function incompleteCount(e: unknown): number {
  const details = e instanceof ApiError ? (e.details as { incomplete_descendant_count?: number } | null) : null
  return details?.incomplete_descendant_count ?? 0
}

async function toggleTask(task: Task): Promise<void> {
  if (!props.interactive || busyId.value) return
  busyId.value = String(task.id)
  try {
    if (task.status === 'completed') {
      applyNode(await taskApi.uncompleteTask(task.id))
      toast.show('已恢复未完成')
      emit('changed')
      return
    }
    try {
      applyNode(await taskApi.completeTask(task.id))
      toast.show('已标记完成')
      emit('changed')
    } catch (e) {
      if (e instanceof ApiError && e.code === 4010) {
        cascade.value = { task, count: incompleteCount(e) }
      } else {
        throw e
      }
    }
  } catch (e) {
    toast.show(errorText(e) || '操作失败，请重试')
  } finally {
    busyId.value = ''
  }
}

/** 级联完成：该节点以下缓存与展开态失效，交给父层重新拉取进度 */
async function confirmCascade(): Promise<void> {
  const target = cascade.value
  if (!target) return
  cascade.value = null
  busyId.value = String(target.task.id)
  try {
    applyNode(await taskApi.completeTask(target.task.id, true))
    toast.show('已标记完成')
    invalidateBelow(String(target.task.id))
    emit('changed')
  } catch (e) {
    toast.show(errorText(e))
  } finally {
    busyId.value = ''
  }
}

function invalidateBelow(id: string): void {
  const ids = new Set<string>([id])
  let grew = true
  while (grew) {
    grew = false
    state.nodes.forEach((n) => {
      if (n.parent_id !== null && ids.has(String(n.parent_id)) && !ids.has(String(n.id))) {
        ids.add(String(n.id))
        grew = true
      }
    })
  }
  ids.forEach((i) => {
    state.loaded.delete(i)
    state.expanded.delete(i)
    state.errors[i] = ''
    state.notices[i] = ''
  })
}

/* ---------------- 行内添加子任务 ---------------- */

async function startCompose(task?: Task): Promise<void> {
  if (!props.interactive) return
  if (!task) {
    state.composing = nodeId.value
    return
  }
  const id = String(task.id)
  state.expanded.add(id)
  state.composing = id
  // 首次为该节点添加：先补齐已有子任务，避免只看到新增项
  if (!state.loaded.has(id)) await loadChildren(id)
}

function onCreated(task: Task): void {
  mergeNodes([task])
  const pid = task.parent_id === null ? '' : String(task.parent_id)
  if (pid) {
    // 就地 +1 保证进度即时反馈，权威值随后由父层重新拉取
    const parent = state.nodes.find((n) => String(n.id) === pid)
    if (parent) parent.subtask_total += 1
  }
  emit('changed')
}

function stopCompose(): void {
  state.composing = ''
}

function goDetail(task: Task): void {
  router.push(`/tasks/${task.id}`)
}
</script>

<template>
  <div class="tree">
    <ul v-if="children.length" class="tree__list" role="group" :aria-label="`子任务，共 ${children.length} 项`">
      <li v-for="child in children" :key="String(child.id)" class="tree__item">
        <SubtaskRow
          :task="child"
          :level="level"
          :expandable="child.subtask_total > 0"
          :expanded="isExpanded(child)"
          :loading="isChildLoading(child)"
          :interactive="interactive"
          @detail="goDetail"
          @toggle="toggleTask"
          @toggle-expand="toggleExpand"
          @add="startCompose"
        />

        <p v-if="state.errors[String(child.id)]" class="tree__hint tree__hint--error">
          {{ state.errors[String(child.id)] }}
          <button class="tree__retry pressable" type="button" @click="loadChildren(String(child.id))">重试</button>
        </p>
        <p v-else-if="state.notices[String(child.id)]" class="tree__hint">
          {{ state.notices[String(child.id)] }}
        </p>

        <!-- 递归渲染下一级：节点/展开态由共享状态承载，切换清单后由父层 :key 重置 -->
        <SubtaskTree
          v-if="isExpanded(child)"
          :nodes="nodes"
          :root-id="child.id"
          :level="childLevel"
          :interactive="interactive"
          @changed="emit('changed')"
        />
      </li>
    </ul>

    <p v-else-if="loading" class="tree__hint">加载中…</p>
    <p v-else-if="isEmpty" class="tree__hint">还没有子任务</p>

    <p v-if="error" class="tree__hint tree__hint--error">
      {{ error }}
      <button class="tree__retry pressable" type="button" @click="loadChildren(nodeId)">重试</button>
    </p>

    <div v-if="interactive" class="tree__compose">
      <SubtaskComposer
        v-if="composing"
        :parent-id="rootId"
        :parent-title="rootNode ? rootNode.title : ''"
        :list-id="rootNode ? rootNode.list_id : null"
        @created="onCreated"
        @cancel="stopCompose"
      />
      <button v-else class="tree__add pressable" type="button" @click="startCompose()">
        <AppIcon name="plus" :size="14" color="#3D5AFE" />
        添加子任务
      </button>
    </div>
  </div>

  <!-- 父任务带未完成子任务：先确认级联范围再执行 -->
  <AppModal
    :visible="!!cascade"
    :title="cascade ? `标记「${cascade.task.title}」完成？` : ''"
    :text="cascade ? `还有 ${cascade.count} 个子任务未完成，标记后将一并标记完成。` : ''"
    confirm-text="全部完成"
    @confirm="confirmCascade"
    @cancel="cascade = null"
  />
</template>

<style scoped>
.tree__list {
  background: var(--bg-card);
}
.tree__item {
  background: var(--bg-card);
}
.tree__hint {
  padding: var(--sp-2) var(--sp-4);
  font-size: var(--font-caption);
  line-height: var(--font-caption-lh);
  color: var(--text-secondary);
}
.tree__hint--error {
  color: var(--color-danger);
}
.tree__retry {
  min-height: 32px;
  padding: 0 var(--sp-1);
  font-size: var(--font-caption);
  color: var(--color-primary);
}
.tree__compose {
  background: var(--bg-card);
}
.tree__add {
  display: inline-flex;
  align-items: center;
  gap: var(--sp-1);
  min-height: 44px;
  padding: 0 var(--sp-4);
  font-size: var(--font-body-m);
  color: var(--color-primary);
}
</style>
