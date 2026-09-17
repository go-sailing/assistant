<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import * as taskApi from '@/api/tasks'
import * as listApi from '@/api/lists'
import { ApiError, errorText } from '@/api/client'
import type { Task, TaskList, TaskSort, TaskStatus } from '@/types'
import AppActionSheet from '@/components/AppActionSheet.vue'
import AppIcon from '@/components/AppIcon.vue'
import AppModal from '@/components/AppModal.vue'
import AppNavBar from '@/components/AppNavBar.vue'
import SegmentedControl from '@/components/SegmentedControl.vue'
import SkeletonList from '@/components/SkeletonList.vue'
import StateEmpty from '@/components/StateEmpty.vue'
import StateError from '@/components/StateError.vue'
import TaskListItem from '@/components/TaskListItem.vue'
import SubtaskTree from '@/components/tasks/SubtaskTree.vue'
import { useTaskSyncStore } from '@/stores/taskSync'
import { useToastStore } from '@/stores/toast'

const router = useRouter()
const route = useRoute()
const toast = useToastStore()
const taskSync = useTaskSyncStore()

/** 清单筛选：ALL 表示全部清单 */
const ALL = 'all'

const tasks = ref<Task[]>([])
const lists = ref<TaskList[]>([])
const listId = ref<string>(ALL)
const status = ref<TaskStatus | 'all'>('all')
const sort = ref<TaskSort>('due_at_asc')
const loading = ref(true)
const error = ref('')
const refreshing = ref(false)
const highlightId = ref<string>('')

const listSheetVisible = ref(false)
const sortSheetVisible = ref(false)
const actionTask = ref<Task | null>(null)
const deleteSheetVisible = ref(false)
const cascadeDeleteVisible = ref(false)

/* v0.2.0 根任务树：展开态 + 首次展开懒加载的下一级节点（会话内缓存） */
const expandedRoots = ref<Set<string>>(new Set())
const treeData = ref<Record<string, Task[]>>({})
const treeLoading = ref<Record<string, boolean>>({})
const treeError = ref<Record<string, string>>({})
/** 筛选条件指纹：变化时重置树（组件 key 同步更换） */
const filterKey = computed(() => `${listId.value}|${status.value}|${sort.value}`)

/** 级联完成确认（父任务带未完成子任务） */
const cascade = ref<{ task: Task; count: number } | null>(null)

const statusOptions = [
  { label: '全部', value: 'all' },
  { label: '未完成', value: 'todo' },
  { label: '已完成', value: 'completed' },
]

const sortLabel = computed(() => (sort.value === 'created_at_desc' ? '按创建时间' : '按截止时间'))

const sortItems = [
  { label: '按截止时间', value: 'due_at_asc' },
  { label: '按创建时间', value: 'created_at_desc' },
]

const currentListName = computed(() => {
  if (listId.value === ALL) return '全部清单'
  const found = lists.value.find((l) => String(l.id) === String(listId.value))
  return found ? found.name : '全部清单'
})

/** 默认清单置顶 */
const orderedLists = computed(() =>
  [...lists.value].sort((a, b) => Number(b.is_default) - Number(a.is_default))
)

const listItems = computed(() => [
  { label: '全部清单', value: ALL },
  ...orderedLists.value.map((l) => ({ label: l.name, value: String(l.id) })),
  { label: '管理清单…', value: '__manage__' },
])

/** 是否处于筛选态（用于区分首次空态与筛选空态） */
const filtered = computed(() => listId.value !== ALL || status.value !== 'all')

async function loadLists(): Promise<void> {
  try {
    lists.value = await listApi.fetchLists()
  } catch {
    lists.value = []
  }
}

async function loadTasks(): Promise<void> {
  error.value = ''
  try {
    // 任务首页只以根任务为排序单位（子任务随父卡展开出现）
    const res = await taskApi.fetchTasks({
      list_id: listId.value === ALL ? undefined : listId.value,
      status: status.value === 'all' ? undefined : status.value,
      sort: sort.value,
      root_only: true,
      page: 1,
      page_size: 50,
    })
    tasks.value = res.list || []
  } catch (e) {
    // 失败不展示旧数据，只展示错误态
    tasks.value = []
    error.value = errorText(e)
  }
}

async function loadAll(): Promise<void> {
  loading.value = true
  await Promise.all([loadLists(), loadTasks()])
  loading.value = false
}

async function refresh(): Promise<void> {
  refreshing.value = true
  await Promise.all([loadLists(), loadTasks()])
  refreshing.value = false
}

/** 切换清单/排序/搜索后重置树展开态与缓存 */
function resetTree(): void {
  expandedRoots.value = new Set<string>()
  treeData.value = {}
  treeLoading.value = {}
  treeError.value = {}
}

function reloadWithTreeReset(): void {
  resetTree()
  loading.value = true
  void loadTasks().finally(() => {
    loading.value = false
  })
}

function openListSheet(): void {
  listSheetVisible.value = true
}

function onListSelect(v: string): void {
  listSheetVisible.value = false
  if (v === '__manage__') {
    router.push('/lists')
    return
  }
  if (v === listId.value) return
  listId.value = v
  reloadWithTreeReset()
}

function onSortSelect(v: string): void {
  sortSheetVisible.value = false
  if (v === sort.value) return
  sort.value = v as TaskSort
  reloadWithTreeReset()
}

function onStatusChange(v: string): void {
  status.value = v as TaskStatus | 'all'
  reloadWithTreeReset()
}

function goDetail(task: Task): void {
  router.push(`/tasks/${task.id}`)
}

function goCreate(): void {
  router.push('/tasks/new')
}

function isRootExpanded(task: Task): boolean {
  return expandedRoots.value.has(String(task.id))
}

/** 展开根任务：首次展开懒加载下一级（根 + 直接子级） */
async function toggleRoot(task: Task): Promise<void> {
  const id = String(task.id)
  if (expandedRoots.value.has(id)) {
    expandedRoots.value.delete(id)
    return
  }
  expandedRoots.value.add(id)
  if (treeData.value[id]) return
  await loadLevel1(task)
}

async function loadLevel1(task: Task): Promise<void> {
  const id = String(task.id)
  treeLoading.value[id] = true
  treeError.value[id] = ''
  try {
    treeData.value[id] = await taskApi.fetchSubtree(task.id, 1)
  } catch (e) {
    treeError.value[id] = errorText(e)
  } finally {
    treeLoading.value[id] = false
  }
}

function replaceRoot(task: Task): void {
  const i = tasks.value.findIndex((t) => String(t.id) === String(task.id))
  if (i >= 0) tasks.value[i] = task
}

/** 树下发生变更：重取第一级并同步根卡进度（进度为直接子任务口径） */
async function onTreeChanged(task: Task): Promise<void> {
  await loadLevel1(task)
  const nodes = treeData.value[String(task.id)] || []
  const direct = nodes.filter((n) => n.parent_id !== null && String(n.parent_id) === String(task.id))
  const i = tasks.value.findIndex((t) => String(t.id) === String(task.id))
  if (i < 0) return
  tasks.value[i] = {
    ...tasks.value[i],
    subtask_total: direct.length,
    subtask_completed: direct.filter((d) => d.status === 'completed').length,
  }
}

function incompleteCount(e: unknown): number {
  const details = e instanceof ApiError ? (e.details as { incomplete_descendant_count?: number } | null) : null
  return details?.incomplete_descendant_count ?? 0
}

/** 勾选完成：乐观更新，失败回弹；父任务带未完成子任务时走级联确认 */
async function onToggle(task: Task): Promise<void> {
  const index = tasks.value.findIndex((t) => String(t.id) === String(task.id))
  if (index < 0) return
  const original = tasks.value[index]
  const completed = original.status === 'completed'
  tasks.value[index] = {
    ...original,
    status: completed ? 'todo' : 'completed',
    completed_at: completed ? null : new Date().toISOString(),
  }
  try {
    const updated = completed
      ? await taskApi.uncompleteTask(original.id)
      : await taskApi.completeTask(original.id)
    replaceRoot(updated)
    // 筛选态与结果不符时移除该项
    if (
      (status.value === 'completed' && updated.status !== 'completed') ||
      (status.value === 'todo' && updated.status === 'completed')
    ) {
      tasks.value = tasks.value.filter((t) => String(t.id) !== String(original.id))
    }
    taskSync.markDirty()
    void refreshTreeAfterStatus(updated)
  } catch (e) {
    replaceRoot(original)
    if (!completed && e instanceof ApiError && e.code === 4010) {
      cascade.value = { task: original, count: incompleteCount(e) }
      return
    }
    toast.show(errorText(e) || '操作失败，请重试')
  }
}

/** 级联完成：一并标记全部未完成后代 */
async function confirmCascade(): Promise<void> {
  const target = cascade.value
  if (!target) return
  cascade.value = null
  try {
    const updated = await taskApi.completeTask(target.task.id, true)
    replaceRoot(updated)
    taskSync.markDirty()
    toast.show('已标记完成')
    await refreshTreeAfterStatus(updated)
  } catch (e) {
    toast.show(errorText(e))
  }
}

/** 状态变化后若树已加载，刷新第一级让勾选态与进度同步 */
async function refreshTreeAfterStatus(task: Task): Promise<void> {
  const id = String(task.id)
  if (!treeData.value[id]) return
  try {
    treeData.value[id] = await taskApi.fetchSubtree(task.id, 1)
  } catch {
    // 刷新失败保留原树，不阻断主流程
  }
}

function askDelete(task: Task): void {
  actionTask.value = task
  if (task.subtask_total > 0) {
    cascadeDeleteVisible.value = true
    return
  }
  deleteSheetVisible.value = true
}

async function confirmDelete(): Promise<void> {
  const task = actionTask.value
  deleteSheetVisible.value = false
  cascadeDeleteVisible.value = false
  if (!task) return
  try {
    const res = await taskApi.deleteTask(task.id)
    tasks.value = tasks.value.filter((t) => String(t.id) !== String(task.id))
    treeData.value = Object.fromEntries(
      Object.entries(treeData.value).filter(([key]) => key !== String(task.id))
    )
    // 级联计数来自服务端响应：任务数含自身，子任务数需减 1
    const subTasks = Math.max(0, (res.deleted_task_count ?? 1) - 1)
    const events = res.deleted_event_count ?? 0
    const parts: string[] = []
    if (subTasks > 0) parts.push(`${subTasks} 个子任务`)
    if (events > 0) parts.push(`${events} 条日程安排`)
    toast.show(parts.length ? `已删除任务及其 ${parts.join('、')}` : '已删除')
    actionTask.value = null
    taskSync.markDirty()
  } catch (e) {
    toast.show(errorText(e))
  }
}

/* ---- 下拉刷新 ---- */
const scroller = ref<HTMLElement | null>(null)
const pullDistance = ref(0)
let startY = 0
let pullActive = false

function onTouchStart(e: TouchEvent): void {
  const el = scroller.value
  if (!el || el.scrollTop > 0 || refreshing.value) return
  startY = e.touches[0].clientY
  pullActive = true
}

function onTouchMove(e: TouchEvent): void {
  if (!pullActive) return
  const dy = e.touches[0].clientY - startY
  if (dy > 0) pullDistance.value = Math.min(72, dy * 0.5)
}

async function onTouchEnd(): Promise<void> {
  if (!pullActive) return
  pullActive = false
  const shouldRefresh = pullDistance.value >= 36
  pullDistance.value = 0
  if (shouldRefresh) await refresh()
}

onMounted(async () => {
  taskSync.consumeDirty()
  await loadAll()
  const h = route.query.highlight
  if (typeof h === 'string' && h) {
    highlightId.value = h
    window.setTimeout(() => {
      highlightId.value = ''
      if (route.query.highlight) router.replace({ path: '/tasks' })
    }, 2000)
  }
})
</script>

<template>
  <div class="page home">
    <AppNavBar title="任务" :show-back="false">
      <template #right>
        <button class="home__icon-btn pressable" aria-label="搜索任务" @click="router.push('/search')">
          <AppIcon name="search" :size="22" color="#1A1D26" />
        </button>
        <button class="home__icon-btn pressable" aria-label="新建任务" @click="goCreate">
          <AppIcon name="plus" :size="22" color="#1A1D26" />
        </button>
      </template>
    </AppNavBar>

    <div class="home__filter">
      <button class="home__list-btn pressable" @click="openListSheet">
        <AppIcon name="folder" :size="18" color="#6B7080" />
        <span class="home__list-name ellipsis">{{ currentListName }}</span>
        <AppIcon name="chevron-down" :size="16" color="#B5B9C4" />
      </button>
      <button class="home__sort-btn pressable" @click="sortSheetVisible = true">
        {{ sortLabel }}
        <AppIcon name="chevron-down" :size="14" color="#B5B9C4" />
      </button>
    </div>

    <SegmentedControl :model-value="status" :options="statusOptions" @update:model-value="onStatusChange" />

    <div
      ref="scroller"
      class="page-body home__body"
      @touchstart.passive="onTouchStart"
      @touchmove="onTouchMove"
      @touchend="onTouchEnd"
      @touchcancel="onTouchEnd"
    >
      <div v-if="pullDistance > 0 || refreshing" class="home__pull">
        {{ refreshing ? '正在刷新…' : pullDistance >= 36 ? '松开刷新' : '下拉刷新' }}
      </div>

      <SkeletonList v-if="loading" :rows="4" />

      <StateError v-else-if="error" :text="error" @retry="loadAll" />

      <StateEmpty
        v-else-if="!tasks.length && filtered"
        title="当前筛选下没有任务"
        text="换个清单或状态试试"
      />

      <StateEmpty
        v-else-if="!tasks.length"
        title="还没有任务"
        text="点 ＋ 新建，或去助手说一句话"
        action-text="去助手说一句话"
        @action="router.push('/chat')"
      />

      <ul v-else class="home__list">
        <TaskListItem
          v-for="t in tasks"
          :key="String(t.id)"
          :task="t"
          :highlight="String(t.id) === highlightId"
          :subtask-display="isRootExpanded(t) ? 'bar' : 'count'"
          @detail="goDetail"
          @toggle="onToggle"
          @remove="askDelete"
        >
          <!-- 树展开箭头：仅展开/折叠，不进入详情 -->
          <template #leading>
            <button
              v-if="t.subtask_total > 0"
              class="home__chevron pressable"
              type="button"
              :aria-expanded="isRootExpanded(t)"
              :aria-label="isRootExpanded(t) ? `收起「${t.title}」的子任务` : `展开「${t.title}」的子任务`"
              @click.stop="toggleRoot(t)"
            >
              <AppIcon
                name="chevron-right"
                :size="12"
                :class="['home__arrow', { 'home__arrow--open': isRootExpanded(t) }]"
                color="#6B7080"
              />
            </button>
            <span v-else class="home__chevron home__chevron--empty" aria-hidden="true" />
          </template>

          <template #subtree>
            <div v-show="isRootExpanded(t)">
              <p v-if="treeLoading[String(t.id)]" class="home__tree-hint">加载中…</p>
              <p v-else-if="treeError[String(t.id)]" class="home__tree-hint home__tree-hint--error">
                {{ treeError[String(t.id)] }}
                <button class="home__tree-retry pressable" type="button" @click="loadLevel1(t)">重试</button>
              </p>
              <!-- 展开子树：更深层级由树内部继续懒加载；v0.3.0 仅根任务可加直接子任务 -->
              <SubtaskTree
                v-if="treeData[String(t.id)]"
                :key="filterKey"
                :nodes="treeData[String(t.id)]"
                :root-id="t.id"
                allow-add
                @changed="onTreeChanged(t)"
              />
            </div>
          </template>
        </TaskListItem>
      </ul>
    </div>

    <AppActionSheet
      :visible="listSheetVisible"
      title="切换清单"
      :items="listItems"
      @select="onListSelect"
      @cancel="listSheetVisible = false"
    />
    <AppActionSheet
      :visible="sortSheetVisible"
      title="排序方式"
      :items="sortItems"
      @select="onSortSelect"
      @cancel="sortSheetVisible = false"
    />
    <AppActionSheet
      :visible="deleteSheetVisible"
      :title="actionTask ? `删除「${actionTask.title}」？` : ''"
      :items="[{ label: '删除任务', value: 'delete', danger: true }]"
      @select="confirmDelete"
      @cancel="deleteSheetVisible = false"
    />

    <!-- 带子任务的根任务：删除前明示级联后果 -->
    <AppModal
      :visible="cascadeDeleteVisible"
      title="删除任务？"
      :text="`该任务下还有子任务，将一并删除子任务及其关联的日程安排，且不可恢复。`"
      confirm-text="删除"
      danger
      @confirm="confirmDelete"
      @cancel="cascadeDeleteVisible = false"
    />

    <!-- 级联完成确认 -->
    <AppModal
      :visible="!!cascade"
      :title="cascade ? `标记「${cascade.task.title}」完成？` : ''"
      :text="cascade ? `还有 ${cascade.count} 个子任务未完成，标记后将一并标记完成。` : ''"
      confirm-text="全部完成"
      @confirm="confirmCascade"
      @cancel="cascade = null"
    />
  </div>
</template>

<style scoped>
.home {
  position: relative;
}
.home__icon-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 44px;
  height: 44px;
  margin-right: -10px;
}
.home__filter {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--sp-2);
  padding: var(--sp-2) var(--sp-4);
  background: var(--bg-card);
}
.home__list-btn {
  display: flex;
  align-items: center;
  gap: 6px;
  min-height: 44px;
  padding: 0 var(--sp-3);
  background: var(--bg-page);
  border-radius: 18px;
  max-width: 60%;
}
.home__list-name {
  font-size: var(--font-body-m);
  color: var(--text-primary);
}
.home__sort-btn {
  display: flex;
  align-items: center;
  gap: 4px;
  min-height: 44px;
  font-size: var(--font-caption);
  color: var(--text-secondary);
}
.home__body {
  position: relative;
  background: var(--bg-page);
}
.home__pull {
  text-align: center;
  font-size: var(--font-caption);
  color: var(--text-secondary);
  padding: var(--sp-2) 0;
}
.home__list {
  background: var(--bg-card);
  padding-bottom: calc(var(--safe-bottom) + 96px);
}
/* 树展开箭头热区 44pt；负外边距保证与复选框热区不重叠 */
.home__chevron {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 44px;
  height: 44px;
  margin-left: -12px;
  flex-shrink: 0;
}
.home__chevron--empty {
  pointer-events: none;
}
.home__arrow {
  transition: transform 150ms ease;
}
.home__arrow--open {
  transform: rotate(90deg);
}
.home__tree-hint {
  padding: var(--sp-1) var(--sp-4);
  font-size: var(--font-caption);
  color: var(--text-secondary);
}
.home__tree-hint--error {
  color: var(--color-danger);
}
.home__tree-retry {
  min-height: 32px;
  padding: 0 var(--sp-1);
  font-size: var(--font-caption);
  color: var(--color-primary);
}
</style>
