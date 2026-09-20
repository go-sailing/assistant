<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import * as projectApi from '@/api/projects'
import * as taskApi from '@/api/tasks'
import { errorText } from '@/api/client'
import type { Project, Task, TaskSort, TaskStatus } from '@/types'
import AppActionSheet from '@/components/AppActionSheet.vue'
import AppIcon from '@/components/AppIcon.vue'
import AppNavBar from '@/components/AppNavBar.vue'
import SegmentedControl from '@/components/SegmentedControl.vue'
import SkeletonList from '@/components/SkeletonList.vue'
import StateEmpty from '@/components/StateEmpty.vue'
import StateError from '@/components/StateError.vue'
import TaskListItem from '@/components/TaskListItem.vue'
import ProjectFilter from '@/components/tasks/ProjectFilter.vue'
import { currentAxis, isHorizontalLocked, isVerticalLocked, lockAxis, resetAxis, resolveAxis } from '@/utils/gesture'
import { useTaskSyncStore } from '@/stores/taskSync'
import { useToastStore } from '@/stores/toast'

/**
 * v0.8.0 任务页（UXUI 5.1，TASK-01）：列表为**全部任务**（含项目下任务）。
 * 筛选区 = 左「项目筛选器」+ 右「排序胶囊」，其下为状态分段；
 * 三者正交（可叠加），任一变化仅重新拉取列表。
 */
const router = useRouter()
const route = useRoute()
const toast = useToastStore()
const taskSync = useTaskSyncStore()

const tasks = ref<Task[]>([])
const status = ref<TaskStatus | 'all'>('all')
const sort = ref<TaskSort>('due_at_asc')
/** 项目筛选：null = 全部；'none' = 未归属项目；number = 具体项目 */
const projectFilter = ref<number | 'none' | null>(null)
/** 筛选器候选（进入页面时一次性取回） */
const projects = ref<Project[]>([])
const loading = ref(true)
const error = ref('')
const refreshing = ref(false)
const highlightId = ref<string>('')

const sortSheetVisible = ref(false)
const actionTask = ref<Task | null>(null)
const deleteSheetVisible = ref(false)

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

/** 是否处于筛选态（用于区分首次空态与筛选空态） */
const filtered = computed(() => status.value !== 'all' || projectFilter.value !== null)

/** 命中「具体项目」筛选：空态用项目专属文案与新建入口 */
const isProjectFiltered = computed(() => typeof projectFilter.value === 'number')

async function loadTasks(): Promise<void> {
  error.value = ''
  try {
    // v0.8.0：不传 project_id 即全部任务（含项目下任务），不再有 task_type / root_only
    const res = await taskApi.fetchTasks({
      status: status.value === 'all' ? undefined : status.value,
      project_id: projectFilter.value === null ? undefined : projectFilter.value,
      sort: sort.value,
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

/** 项目筛选器候选：与列表并发加载，失败时静默降级（筛选器只剩「全部」） */
async function loadProjects(): Promise<void> {
  try {
    projects.value = await projectApi.fetchProjectOptions()
  } catch {
    projects.value = []
  }
}

/** 当前选中项目已被删除 → 回落「全部」、提示并同步列表（UXUI 7.1） */
async function validateProjectFilter(): Promise<void> {
  if (typeof projectFilter.value !== 'number') return
  if (projects.value.some((p) => p.id === projectFilter.value)) return
  projectFilter.value = null
  toast.show('所选项目已删除')
  await loadTasks()
}

async function loadAll(): Promise<void> {
  loading.value = true
  await loadTasks()
  loading.value = false
}

async function refresh(): Promise<void> {
  refreshing.value = true
  // 刷新时一并校验项目候选（项目被删除则回落「全部」）
  await Promise.all([loadTasks(), loadProjects()])
  await validateProjectFilter()
  refreshing.value = false
}

/** 切换筛选/状态/排序后重新拉取列表（不重置其它两个控件的值） */
function reloadTasks(): void {
  loading.value = true
  void loadTasks().finally(() => {
    loading.value = false
  })
}

function onSortSelect(v: string): void {
  sortSheetVisible.value = false
  if (v === sort.value) return
  sort.value = v as TaskSort
  reloadTasks()
}

function onStatusChange(v: string): void {
  status.value = v as TaskStatus | 'all'
  reloadTasks()
}

function onProjectChange(v: number | 'none' | null): void {
  if (v === projectFilter.value) return
  projectFilter.value = v
  reloadTasks()
}

function goDetail(task: Task): void {
  router.push(`/tasks/${task.id}`)
}

function goCreate(): void {
  router.push('/tasks/new')
}

/** 项目筛选空态：新建任务并预设所属项目为本项目 */
function goCreateForProject(): void {
  router.push(`/tasks/new?project_id=${String(projectFilter.value)}`)
}

function replaceRoot(task: Task): void {
  const i = tasks.value.findIndex((t) => String(t.id) === String(task.id))
  if (i >= 0) tasks.value[i] = task
}

/** 勾选完成：乐观更新，失败回弹（v0.8.0 已无级联完成） */
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
  } catch (e) {
    replaceRoot(original)
    toast.show(errorText(e) || '操作失败，请重试')
  }
}

function askDelete(task: Task): void {
  actionTask.value = task
  deleteSheetVisible.value = true
}

async function confirmDelete(): Promise<void> {
  const task = actionTask.value
  deleteSheetVisible.value = false
  if (!task) return
  try {
    const res = await taskApi.deleteTask(task.id)
    tasks.value = tasks.value.filter((t) => String(t.id) !== String(task.id))
    const events = res.deleted_event_count ?? 0
    toast.show(events > 0 ? `已删除任务及其 ${events} 条日程安排` : '已删除')
    actionTask.value = null
    taskSync.markDirty()
  } catch (e) {
    toast.show(errorText(e))
  }
}

/* ---- 下拉刷新（纵向）与行内左滑（横向）互斥：GES-01 / SDD 12.2 ---- */
const scroller = ref<HTMLElement | null>(null)
const pullDistance = ref(0)
let startX = 0
let startY = 0
let pullActive = false

function onTouchStart(e: TouchEvent): void {
  const el = scroller.value
  // 仅列表顶部起手才参与下拉（既有口径）
  if (!el || el.scrollTop > 0 || refreshing.value) {
    pullActive = false
    return
  }
  startX = e.touches[0].clientX
  startY = e.touches[0].clientY
  pullActive = true
}

function onTouchMove(e: TouchEvent): void {
  if (!pullActive) return
  // 横向已锁定（行内左滑占用）：本次手势立即取消下拉，不累计、不显示提示
  if (isHorizontalLocked()) {
    pullDistance.value = 0
    return
  }
  const dx = e.touches[0].clientX - startX
  const dy = e.touches[0].clientY - startY
  if (currentAxis() === null) {
    const axis = resolveAxis(dx, dy)
    // 斜向但未达任一主导：本次手势只滚动列表（既不下拉也不左滑）
    if (axis === null) return
    lockAxis(axis)
    if (axis === 'h') {
      pullDistance.value = 0
      return
    }
  }
  if (!isVerticalLocked()) return
  if (dy > 0) pullDistance.value = Math.min(72, dy * 0.5)
}

async function onTouchEnd(): Promise<void> {
  // 仅纵向锁定且过阈才刷新；手势结束统一复位方向锁（行组件不单独复位）
  const shouldRefresh = pullActive && isVerticalLocked() && pullDistance.value >= 36
  pullActive = false
  pullDistance.value = 0
  resetAxis()
  if (shouldRefresh) await refresh()
}

onMounted(async () => {
  taskSync.consumeDirty()
  // 列表与筛选器候选并发加载
  await Promise.all([loadAll(), loadProjects()])
  await validateProjectFilter()
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

    <!-- 筛选区：左项目筛选器 + 右排序胶囊（两端布局） -->
    <div class="home__filter">
      <ProjectFilter
        :model-value="projectFilter"
        :projects="projects"
        @update:model-value="onProjectChange"
      />
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
        v-else-if="!tasks.length && isProjectFiltered"
        title="该项目下还没有任务"
        text="点右上 ＋ 新建（预设所属项目为本项目）"
        action-text="＋ 新建任务"
        @action="goCreateForProject"
      />

      <StateEmpty
        v-else-if="!tasks.length && filtered"
        title="当前筛选下没有任务"
        text="换个状态或项目试试"
      />

      <StateEmpty
        v-else-if="!tasks.length"
        title="还没有任务"
        text="点 ＋ 新建，或去助手说一句话"
        action-text="去助手说一句话"
        @action="router.push('/chat')"
      />

      <ul v-else class="home__list">
        <!-- 全部任务（含项目下任务）：行内带项目标识，点击行进详情 -->
        <TaskListItem
          v-for="t in tasks"
          :key="String(t.id)"
          :task="t"
          :highlight="String(t.id) === highlightId"
          @detail="goDetail"
          @toggle="onToggle"
          @remove="askDelete"
        />
      </ul>
    </div>

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
  padding: 0 var(--page-padding) var(--sp-2);
  background: var(--bg-card);
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
</style>
