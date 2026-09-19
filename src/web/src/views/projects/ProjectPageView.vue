<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import * as taskApi from '@/api/tasks'
import { ApiError, errorText } from '@/api/client'
import type { Task, TaskSort, TaskStatus } from '@/types'
import AppActionSheet from '@/components/AppActionSheet.vue'
import AppIcon from '@/components/AppIcon.vue'
import AppModal from '@/components/AppModal.vue'
import AppNavBar from '@/components/AppNavBar.vue'
import SegmentedControl from '@/components/SegmentedControl.vue'
import SkeletonList from '@/components/SkeletonList.vue'
import StateEmpty from '@/components/StateEmpty.vue'
import StateError from '@/components/StateError.vue'
import ProjectCard from '@/components/tasks/ProjectCard.vue'
import { useTaskSyncStore } from '@/stores/taskSync'
import { useToastStore } from '@/stores/toast'

/**
 * v0.7.0 项目页（UXUI 5.5）：只列项目（root_only + task_type=project）。
 * 筛选区 = 状态分段（全部/进行中/已完成）+ 排序胶囊；无类型筛选、无清单入口。
 */
const router = useRouter()
const route = useRoute()
const toast = useToastStore()
const taskSync = useTaskSyncStore()

/** 骨架 >300ms 才出现（避免快请求下的闪烁） */
const SKELETON_DELAY = 300
const showSkeleton = ref(false)
let skeletonTimer = 0

const projects = ref<Task[]>([])
const status = ref<TaskStatus | 'all'>('all')
const sort = ref<TaskSort>('due_at_asc')
const loading = ref(true)
const error = ref('')
const refreshing = ref(false)
const highlightId = ref('')

const sortSheetVisible = ref(false)
/** 级联完成确认（项目带未完成成员任务 → 服务端 4010） */
const cascade = ref<{ project: Task; count: number } | null>(null)
/** 删除确认：影响范围由 preview-remove 预取 */
const removeTarget = ref<{ project: Task; members: number; events: number } | null>(null)
const deleting = ref(false)

const statusOptions = [
  { label: '全部', value: 'all' },
  { label: '进行中', value: 'todo' },
  { label: '已完成', value: 'completed' },
]

const sortItems = [
  { label: '截止时间升序', value: 'due_at_asc' },
  { label: '创建时间倒序', value: 'created_at_desc' },
]

const sortLabel = computed(() =>
  sort.value === 'created_at_desc' ? '创建时间倒序' : '截止时间升序'
)

/** 删除确认文案：明示成员任务与关联日程数（无级联影响时只说不可恢复） */
const removeText = computed(() => {
  const target = removeTarget.value
  if (!target) return ''
  const parts: string[] = []
  if (target.members > 0) parts.push(`${target.members} 个成员任务`)
  if (target.events > 0) parts.push(`${target.events} 条关联日程`)
  return parts.length ? `该项目下有 ${parts.join('、')}，将一并删除且不可恢复。` : '删除后不可恢复。'
})

function beginSkeleton(): void {
  window.clearTimeout(skeletonTimer)
  showSkeleton.value = false
  skeletonTimer = window.setTimeout(() => {
    showSkeleton.value = true
  }, SKELETON_DELAY)
}

function endSkeleton(): void {
  window.clearTimeout(skeletonTimer)
  showSkeleton.value = false
}

async function loadProjects(): Promise<void> {
  error.value = ''
  try {
    const res = await taskApi.fetchTasks({
      task_type: 'project',
      status: status.value === 'all' ? undefined : status.value,
      sort: sort.value,
      root_only: true,
      page: 1,
      page_size: 50,
    })
    projects.value = res.list || []
  } catch (e) {
    // 失败不展示旧数据，只展示错误态
    projects.value = []
    error.value = errorText(e)
  }
}

async function loadAll(): Promise<void> {
  loading.value = true
  beginSkeleton()
  await loadProjects()
  loading.value = false
  endSkeleton()
}

async function refresh(): Promise<void> {
  refreshing.value = true
  await loadProjects()
  refreshing.value = false
}

/** 切换状态/排序后重新拉取 */
function reload(): void {
  void loadAll()
}

function onStatusChange(v: string): void {
  status.value = v as TaskStatus | 'all'
  reload()
}

function onSortSelect(v: string): void {
  sortSheetVisible.value = false
  if (v === sort.value) return
  sort.value = v as TaskSort
  reload()
}

function goDetail(project: Task): void {
  router.push(`/projects/${project.id}`)
}

function goCreate(): void {
  router.push('/projects/new')
}

function replaceProject(project: Task): void {
  const i = projects.value.findIndex((p) => String(p.id) === String(project.id))
  if (i >= 0) projects.value[i] = project
}

/** 完成/恢复后与当前状态筛选不符时移出列表 */
function dropIfFilteredOut(updated: Task, id: Task['id']): void {
  if (
    (status.value === 'completed' && updated.status !== 'completed') ||
    (status.value === 'todo' && updated.status === 'completed')
  ) {
    projects.value = projects.value.filter((p) => String(p.id) !== String(id))
  }
}

function incompleteCount(e: unknown): number {
  const details = e instanceof ApiError
    ? (e.details as { incomplete_member_count?: number; incomplete_descendant_count?: number } | null)
    : null
  return details?.incomplete_member_count ?? details?.incomplete_descendant_count ?? 0
}

/** 勾选完成：乐观更新，失败回弹；项目带未完成成员任务时走级联确认 */
async function onToggle(project: Task): Promise<void> {
  const index = projects.value.findIndex((p) => String(p.id) === String(project.id))
  if (index < 0) return
  const original = projects.value[index]
  const completed = original.status === 'completed'
  projects.value[index] = {
    ...original,
    status: completed ? 'todo' : 'completed',
    completed_at: completed ? null : new Date().toISOString(),
  }
  try {
    const updated = completed
      ? await taskApi.uncompleteTask(original.id)
      : await taskApi.completeTask(original.id)
    replaceProject(updated)
    dropIfFilteredOut(updated, original.id)
    taskSync.markDirty()
  } catch (e) {
    replaceProject(original)
    if (!completed && e instanceof ApiError && e.code === 4010) {
      cascade.value = { project: original, count: incompleteCount(e) }
      return
    }
    toast.show(errorText(e) || '操作失败，请重试')
  }
}

/** 级联完成：一并标记全部未完成成员任务 */
async function confirmCascade(): Promise<void> {
  const target = cascade.value
  if (!target) return
  cascade.value = null
  try {
    const updated = await taskApi.completeTask(target.project.id, true)
    replaceProject(updated)
    dropIfFilteredOut(updated, target.project.id)
    taskSync.markDirty()
    toast.show('已标记完成')
  } catch (e) {
    toast.show(errorText(e))
  }
}

/** 左滑删除：先取影响范围，再二次确认 */
async function askDelete(project: Task): Promise<void> {
  try {
    const preview = await taskApi.fetchPreviewRemove(project.id)
    removeTarget.value = {
      project,
      // deleted_task_count 含项目自身
      members: Math.max(0, (preview.deleted_task_count ?? 1) - 1),
      events: preview.deleted_event_count ?? 0,
    }
  } catch (e) {
    toast.show(errorText(e))
  }
}

async function confirmDelete(): Promise<void> {
  const target = removeTarget.value
  if (!target || deleting.value) return
  deleting.value = true
  try {
    const res = await taskApi.deleteTask(target.project.id)
    projects.value = projects.value.filter((p) => String(p.id) !== String(target.project.id))
    const members = Math.max(0, (res.deleted_task_count ?? 1) - 1)
    const events = res.deleted_event_count ?? 0
    const parts: string[] = []
    if (members > 0) parts.push(`${members} 个成员任务`)
    if (events > 0) parts.push(`${events} 条关联日程`)
    toast.show(parts.length ? `已删除项目及其 ${parts.join('、')}` : '已删除')
    removeTarget.value = null
    taskSync.markDirty()
  } catch (e) {
    toast.show(errorText(e))
  } finally {
    deleting.value = false
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
      if (route.query.highlight) router.replace({ path: '/projects' })
    }, 2000)
  }
})
</script>

<template>
  <div class="page projects">
    <AppNavBar title="项目" :show-back="false">
      <template #right>
        <button class="projects__icon-btn pressable" aria-label="新建项目" @click="goCreate">
          <AppIcon name="plus" :size="22" color="#1A1D26" />
        </button>
      </template>
    </AppNavBar>

    <div class="projects__filter">
      <button class="projects__sort-btn pressable" @click="sortSheetVisible = true">
        {{ sortLabel }}
        <AppIcon name="chevron-down" :size="14" color="#B5B9C4" />
      </button>
    </div>

    <SegmentedControl
      :model-value="status"
      :options="statusOptions"
      @update:model-value="onStatusChange"
    />

    <div
      ref="scroller"
      class="page-body projects__body"
      @touchstart.passive="onTouchStart"
      @touchmove="onTouchMove"
      @touchend="onTouchEnd"
      @touchcancel="onTouchEnd"
    >
      <div v-if="pullDistance > 0 || refreshing" class="projects__pull">
        {{ refreshing ? '正在刷新…' : pullDistance >= 36 ? '松开刷新' : '下拉刷新' }}
      </div>

      <SkeletonList v-if="showSkeleton" :rows="3" />

      <StateError v-else-if="error" :text="error" @retry="loadAll" />

      <StateEmpty
        v-else-if="!loading && !projects.length && status === 'completed'"
        title="还没有已完成的项目"
        text="完成一个项目后会出现在这里"
      />

      <StateEmpty
        v-else-if="!loading && !projects.length && status === 'todo'"
        title="没有符合条件的项目"
        text="换个状态试试"
      />

      <StateEmpty
        v-else-if="!loading && !projects.length"
        title="还没有项目"
        text="项目用来把一组相关任务放在一起"
        action-text="＋ 新建项目"
        @action="goCreate"
      />

      <ul v-else-if="projects.length" class="projects__list">
        <ProjectCard
          v-for="p in projects"
          :key="String(p.id)"
          :project="p"
          :highlight="String(p.id) === highlightId"
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

    <!-- 删除前明示级联后果（成员任务 / 关联日程） -->
    <AppModal
      :visible="!!removeTarget"
      :title="removeTarget ? `删除「${removeTarget.project.title}」？` : ''"
      :text="removeText"
      confirm-text="删除"
      danger
      :loading="deleting"
      @confirm="confirmDelete"
      @cancel="removeTarget = null"
    />

    <!-- 级联完成确认 -->
    <AppModal
      :visible="!!cascade"
      :title="cascade ? `标记「${cascade.project.title}」完成？` : ''"
      :text="cascade ? `还有 ${cascade.count} 个成员任务未完成，标记后将一并标记完成。` : ''"
      confirm-text="全部完成"
      @confirm="confirmCascade"
      @cancel="cascade = null"
    />
  </div>
</template>

<style scoped>
.projects {
  position: relative;
}
.projects__icon-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 44px;
  height: 44px;
  margin-right: -10px;
}
.projects__filter {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  padding: var(--sp-2) var(--sp-4);
  background: var(--bg-card);
}
.projects__sort-btn {
  display: flex;
  align-items: center;
  gap: 4px;
  min-height: 44px;
  font-size: var(--font-caption);
  color: var(--text-secondary);
}
.projects__body {
  position: relative;
  background: var(--bg-page);
}
.projects__pull {
  text-align: center;
  font-size: var(--font-caption);
  color: var(--text-secondary);
  padding: var(--sp-2) 0;
}
.projects__list {
  background: var(--bg-card);
  padding-bottom: calc(var(--safe-bottom) + 96px);
}
</style>
