<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { deleteProject, fetchProjects, previewRemoveProject } from '@/api/projects'
import { errorText } from '@/api/client'
import type { Project } from '@/types'
import AppIcon from '@/components/AppIcon.vue'
import AppModal from '@/components/AppModal.vue'
import AppNavBar from '@/components/AppNavBar.vue'
import SkeletonList from '@/components/SkeletonList.vue'
import StateEmpty from '@/components/StateEmpty.vue'
import StateError from '@/components/StateError.vue'
import ProjectCard from '@/components/tasks/ProjectCard.vue'
import { isHorizontalLocked, lockAxis, resetAxis, resolveAxis } from '@/utils/gesture'
import { useTaskSyncStore } from '@/stores/taskSync'
import { useToastStore } from '@/stores/toast'

/**
 * v0.8.0 项目页（UXUI 5.5）：只列全部项目，服务端固定创建时间倒序。
 * 已删除排序胶囊/排序弹层与状态分段（无状态 Tab、无筛选空态分支）；
 * 卡片无勾选框、无副行，左滑仅「删除」。
 */
const router = useRouter()
const route = useRoute()
const toast = useToastStore()
const taskSync = useTaskSyncStore()

/** 骨架 >300ms 才出现（避免快请求下的闪烁） */
const SKELETON_DELAY = 300
const showSkeleton = ref(false)
let skeletonTimer = 0

const projects = ref<Project[]>([])
const loading = ref(true)
const error = ref('')
const refreshing = ref(false)
const highlightId = ref('')

/** 删除确认：影响范围由 preview-remove 预取（成员任务数 / 关联日程数） */
const removeTarget = ref<{ project: Project; members: number; events: number } | null>(null)
const deleting = ref(false)

/** 删除确认文案：明示将一并删除的成员任务数与关联日程数 */
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
    const res = await fetchProjects({ page: 1, page_size: 50 })
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

function goDetail(project: Project): void {
  router.push(`/projects/${project.id}`)
}

function goCreate(): void {
  router.push('/projects/new')
}

/** 左滑删除：先取影响范围，再二次确认 */
async function askDelete(project: Project): Promise<void> {
  try {
    const preview = await previewRemoveProject(project.id)
    removeTarget.value = {
      project,
      members: preview.deleted_task_count ?? 0,
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
    const res = await deleteProject(target.project.id)
    projects.value = projects.value.filter((p) => String(p.id) !== String(target.project.id))
    const parts: string[] = []
    if (res.deleted_task_count > 0) parts.push(`${res.deleted_task_count} 个成员任务`)
    if (res.deleted_event_count > 0) parts.push(`${res.deleted_event_count} 条关联日程`)
    toast.show(parts.length ? `已删除项目及其 ${parts.join('、')}` : '已删除项目')
    removeTarget.value = null
    taskSync.markDirty()
    router.replace('/projects')
  } catch (e) {
    toast.show(errorText(e))
  } finally {
    deleting.value = false
  }
}

/* ---- 下拉刷新（与卡片左滑共用方向锁，GES-01） ---- */
const scroller = ref<HTMLElement | null>(null)
const pullDistance = ref(0)
let startX = 0
let startY = 0
/** 本次手势是否参与下拉（仅列表在顶部且非刷新中） */
let pullActive = false
/** 8px 观察期是否已判定方向 */
let axisDecided = false

function onTouchStart(e: TouchEvent): void {
  const el = scroller.value
  // 方向锁由本容器统一复位（行组件只锁定不复位）
  resetAxis()
  axisDecided = false
  pullDistance.value = 0
  startX = e.touches[0].clientX
  startY = e.touches[0].clientY
  pullActive = !!el && el.scrollTop <= 0 && !refreshing.value
}

function onTouchMove(e: TouchEvent): void {
  if (!pullActive) return
  const t = e.touches[0]
  const dx = t.clientX - startX
  const dy = t.clientY - startY
  if (!axisDecided) {
    // 8px 观察期内不累计、不显示提示
    if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return
    const axis = resolveAxis(dx, dy)
    if (axis) lockAxis(axis)
    axisDecided = true
    // 非纵向主导（含斜向未达任一条件）：本次手势不服务下拉
    if (axis !== 'v') {
      pullDistance.value = 0
      return
    }
  }
  // 左滑已占用本次手势：立即取消下拉，且不得出现刷新文案
  if (isHorizontalLocked()) {
    pullDistance.value = 0
    return
  }
  if (dy > 0) pullDistance.value = Math.min(72, dy * 0.5)
}

async function onTouchEnd(): Promise<void> {
  const shouldRefresh = pullActive && pullDistance.value >= 36
  pullActive = false
  pullDistance.value = 0
  axisDecided = false
  resetAxis()
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
          @remove="askDelete"
        />
      </ul>
    </div>

    <!-- 删除前明示级联后果（成员任务 / 关联日程） -->
    <AppModal
      :visible="!!removeTarget"
      :title="removeTarget ? `删除「${removeTarget.project.name}」？` : ''"
      :text="removeText"
      confirm-text="删除"
      danger
      :loading="deleting"
      @confirm="confirmDelete"
      @cancel="removeTarget = null"
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
