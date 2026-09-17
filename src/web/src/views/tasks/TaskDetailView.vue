<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import * as taskApi from '@/api/tasks'
import * as eventApi from '@/api/events'
import { ApiError, errorText } from '@/api/client'
import type { CalendarEvent, Task } from '@/types'
import AppActionSheet from '@/components/AppActionSheet.vue'
import AppButton from '@/components/AppButton.vue'
import AppCheckbox from '@/components/AppCheckbox.vue'
import AppIcon from '@/components/AppIcon.vue'
import AppModal from '@/components/AppModal.vue'
import PriorityFlag from '@/components/PriorityFlag.vue'
import StateError from '@/components/StateError.vue'
import ParentBreadcrumb from '@/components/tasks/ParentBreadcrumb.vue'
import ParentPickerSheet from '@/components/tasks/ParentPickerSheet.vue'
import ProgressBar from '@/components/tasks/ProgressBar.vue'
import SubtaskTree from '@/components/tasks/SubtaskTree.vue'
import { useTaskSyncStore } from '@/stores/taskSync'
import { useEventSyncStore } from '@/stores/eventSync'
import { useToastStore } from '@/stores/toast'
import { dueTone, formatEventRange, formatFull, formatShort, overdueDays } from '@/utils/time'

const route = useRoute()
const router = useRouter()
const toast = useToastStore()
const taskSync = useTaskSyncStore()
const eventSync = useEventSyncStore()

const task = ref<Task | null>(null)
/** 面包屑链：根 → 父 → 当前 */
const ancestors = ref<Task[]>([])
/** 整棵子树（根 + 全部后代），用于子任务分区与删除计数 */
const subtree = ref<Task[]>([])
const subtreeError = ref('')
const events = ref<CalendarEvent[]>([])
const loading = ref(true)
const error = ref('')
const actionLoading = ref(false)
const sheetVisible = ref(false)
const pickerVisible = ref(false)

/** 级联完成确认（4010） */
const cascadeComplete = ref<{ count: number } | null>(null)
/** 删除级联告知（计数 >0 时先明示后果） */
const deleteCascade = ref<{ subTasks: number; events: number } | null>(null)

const taskId = computed(() => String(route.params.id))
const fromChat = computed(() => route.query.from === 'chat')
const completed = computed(() => task.value?.status === 'completed')
const overdue = computed(() => (task.value ? dueTone(task.value) === 'danger' : false))
const overdueText = computed(() => {
  if (!task.value || !overdue.value) return ''
  return `已逾期 ${overdueDays(task.value.due_at)} 天`
})
const hasSubtasks = computed(() => (task.value?.subtask_total ?? 0) > 0)
const allSubtasksDone = computed(
  () => hasSubtasks.value && (task.value?.subtask_completed ?? 0) >= (task.value?.subtask_total ?? 0)
)
/** 子树至少包含根自身，保证行内添加子任务能拿到同清单信息 */
const subtreeNodes = computed<Task[]>(() =>
  subtree.value.length ? subtree.value : task.value ? [task.value] : []
)
/**
 * v0.3.0：当前任务绝对层级 = 祖先数 + 1；已达 5 级时禁止再加子任务
 * （depth 是相对查询根的深度，故用面包屑链长度推算绝对层级）
 */
const atDepthLimit = computed(() => ancestors.value.length + 1 >= 5)

const deleteText = computed(() => {
  const info = deleteCascade.value
  if (!info) return ''
  const parts: string[] = []
  if (info.subTasks > 0) parts.push(`${info.subTasks} 个子任务`)
  if (info.events > 0) parts.push(`${info.events} 条日程安排`)
  return parts.length ? `将同时删除 ${parts.join('及')}，且不可恢复。` : '删除后不可恢复。'
})

function incompleteCount(e: unknown): number {
  const details = e instanceof ApiError ? (e.details as { incomplete_descendant_count?: number } | null) : null
  return details?.incomplete_descendant_count ?? 0
}

async function load(): Promise<void> {
  loading.value = true
  error.value = ''
  subtreeError.value = ''
  try {
    const [t, evs, anc, sub] = await Promise.all([
      taskApi.fetchTask(taskId.value),
      // 排期列表失败不阻塞任务详情展示
      eventApi.fetchTaskEvents(taskId.value).catch(() => [] as CalendarEvent[]),
      taskApi.fetchAncestors(taskId.value).catch(() => [] as Task[]),
      taskApi.fetchSubtree(taskId.value).catch(() => [] as Task[]),
    ])
    task.value = t
    events.value = evs
    ancestors.value = anc
    subtree.value = sub
    if (!sub.length && t.subtask_total > 0) subtreeError.value = '子任务加载失败'
  } catch (e) {
    task.value = null
    events.value = []
    ancestors.value = []
    subtree.value = []
    error.value = errorText(e)
  } finally {
    loading.value = false
  }
}

/** 子任务分区数据变化：刷新任务进度与子树 */
async function onSubtreeChanged(): Promise<void> {
  try {
    const [t, sub] = await Promise.all([
      taskApi.fetchTask(taskId.value),
      taskApi.fetchSubtree(taskId.value),
    ])
    task.value = t
    subtree.value = sub
  } catch {
    // 刷新失败保留现状，不打断操作
  }
}

async function toggleStatus(): Promise<void> {
  const t = task.value
  if (!t || actionLoading.value) return
  actionLoading.value = true
  try {
    if (t.status === 'completed') {
      // 取消父完成不级联
      task.value = await taskApi.uncompleteTask(t.id)
      toast.show('已恢复未完成')
    } else {
      try {
        task.value = await taskApi.completeTask(t.id)
        toast.show('已标记完成')
      } catch (e) {
        if (e instanceof ApiError && e.code === 4010) {
          cascadeComplete.value = { count: incompleteCount(e) }
          return
        }
        throw e
      }
    }
    taskSync.markDirty()
    await onSubtreeChanged()
  } catch (e) {
    toast.show(errorText(e))
  } finally {
    actionLoading.value = false
  }
}

/** 确认后带 cascade 一并完成未完成后代 */
async function confirmCascadeComplete(): Promise<void> {
  const t = task.value
  cascadeComplete.value = null
  if (!t) return
  actionLoading.value = true
  try {
    task.value = await taskApi.completeTask(t.id, true)
    taskSync.markDirty()
    toast.show('已标记完成')
    await onSubtreeChanged()
  } catch (e) {
    toast.show(errorText(e))
  } finally {
    actionLoading.value = false
  }
}

/** 移动层级：选择父任务（null = 移出为根任务） */
async function onPickParent(parentId: number | null): Promise<void> {
  pickerVisible.value = false
  const t = task.value
  if (!t) return
  const currentParent = t.parent_id === null ? null : String(t.parent_id)
  if (parentId === null && currentParent === null) {
    toast.show('已是顶层任务')
    return
  }
  if (parentId !== null && currentParent !== null && String(parentId) === currentParent) {
    toast.show('已是该父任务的子任务')
    return
  }
  actionLoading.value = true
  try {
    const updated = await taskApi.updateTask(t.id, { parent_id: parentId })
    if (updated.revived_parent) {
      toast.show(`父任务「${updated.revived_parent.title}」已自动恢复为未完成`)
    } else {
      toast.show('已移动')
    }
    taskSync.markDirty()
    await load()
  } catch (e) {
    toast.show(errorText(e))
  } finally {
    actionLoading.value = false
  }
}

/**
 * 删除任务：计数来自已加载的整棵子树与任务自身日程数，
 * 有级联影响时先弹确认并明示数量。
 */
function askDelete(): void {
  const t = task.value
  if (!t) return
  const subTasks = Math.max(0, subtree.value.length - 1, t.subtask_total)
  const eventCount = t.event_count ?? events.value.length
  if (subTasks > 0 || eventCount > 0) {
    deleteCascade.value = { subTasks, events: eventCount }
    return
  }
  sheetVisible.value = true
}

async function remove(): Promise<void> {
  const t = task.value
  if (!t) return
  sheetVisible.value = false
  deleteCascade.value = null
  try {
    const res = await taskApi.deleteTask(t.id)
    taskSync.markDirty()
    eventSync.markDirty()
    // 响应计数为权威值：任务数含自身
    const subTasks = Math.max(0, (res.deleted_task_count ?? 1) - 1)
    const eventCount = res.deleted_event_count ?? 0
    const parts: string[] = []
    if (subTasks > 0) parts.push(`${subTasks} 个子任务`)
    if (eventCount > 0) parts.push(`${eventCount} 条日程安排`)
    toast.show(parts.length ? `已删除任务及其 ${parts.join('、')}` : '已删除')
    router.replace('/tasks')
  } catch (e) {
    toast.show(errorText(e))
  }
}

/** 为任务安排执行时段：带入任务并锁定类型 */
function planEvent(): void {
  router.push(`/calendar/new?event_type=task&task_id=${taskId.value}&from=task`)
}

function openEvent(ev: CalendarEvent): void {
  router.push(`/calendar/${ev.id}`)
}

onMounted(load)
</script>

<template>
  <div class="page detail">
    <header class="detail__head">
      <button class="detail__back pressable" aria-label="返回" @click="router.back()">
        ‹
        <span v-if="fromChat" class="detail__back-text">返回对话</span>
      </button>
      <span class="detail__head-title">任务详情</span>
      <button
        v-if="task"
        class="detail__edit pressable"
        @click="router.push(`/tasks/${taskId}/edit`)"
      >
        编辑
      </button>
      <span v-else class="detail__edit" />
    </header>

    <!-- 父子面包屑：根 › … › 当前 -->
    <ParentBreadcrumb v-if="!loading && !error" :nodes="ancestors" />

    <div class="page-body detail__body">
      <p v-if="loading" class="detail__loading">加载中…</p>

      <StateError v-else-if="error" :text="error" @retry="load" />

      <template v-else-if="task">
        <section class="detail__main">
          <AppCheckbox
            :checked="completed"
            :size="24"
            :disabled="actionLoading"
            :label="completed ? '标记为未完成' : '标记为已完成'"
            @toggle="toggleStatus"
          />
          <h1 class="detail__title" :class="{ 'detail__title--done': completed }">{{ task.title }}</h1>
        </section>

        <ul class="detail__meta">
          <li class="detail__meta-row">
            <PriorityFlag :priority="task.priority" with-text />
          </li>
          <li class="detail__meta-row">
            <AppIcon name="folder" :size="18" color="#6B7080" />
            <span>{{ task.list_name || '默认清单' }}</span>
          </li>
          <li class="detail__meta-row">
            <AppIcon name="clock" :size="18" color="#6B7080" />
            <span :class="{ 'detail__overdue': overdue }">{{ formatFull(task.due_at) }}</span>
            <span v-if="overdueText" class="detail__overdue-hint">{{ overdueText }}</span>
          </li>
        </ul>

        <section class="detail__note">
          <h2 class="detail__note-title">备注</h2>
          <p class="detail__note-text">{{ task.note || '暂无备注' }}</p>
        </section>

        <!-- 日程安排分区：任务日程作为该任务的执行时段载体，同一任务可有多条 -->
        <section class="detail__schedule">
          <div class="detail__schedule-head">
            <h2 class="detail__schedule-title">
              日程安排<span v-if="events.length" class="detail__schedule-count">（{{ events.length }}）</span>
            </h2>
            <button class="detail__schedule-add pressable" @click="planEvent">
              <AppIcon name="plus" :size="14" color="#3D5AFE" />
              安排日程
            </button>
          </div>
          <ul v-if="events.length" class="detail__schedule-list">
            <li
              v-for="ev in events"
              :key="String(ev.id)"
              class="detail__schedule-item pressable"
              role="button"
              tabindex="0"
              :aria-label="`查看日程安排 ${ev.title}`"
              @click="openEvent(ev)"
              @keydown.enter="openEvent(ev)"
            >
              <AppIcon name="link" :size="16" color="#7C4DFF" />
              <span class="detail__schedule-time">{{ formatEventRange(ev) }}</span>
              <span class="detail__schedule-place ellipsis">
                {{ ev.location || formatShort(ev.start_at) }}
              </span>
              <AppIcon name="chevron-right" :size="16" color="#B5B9C4" />
            </li>
          </ul>
          <p v-else class="detail__schedule-empty">还没有安排执行时段</p>
        </section>

        <!-- 子任务分区：进度 + 树 + 行内添加 -->
        <section class="detail__subtasks">
          <div class="detail__subtasks-head">
            <h2 class="detail__subtasks-title">
              子任务<span v-if="hasSubtasks" class="detail__subtasks-count">
                （{{ task.subtask_completed }}/{{ task.subtask_total }}）</span
              >
            </h2>
            <button class="detail__subtasks-move pressable" :disabled="actionLoading" @click="pickerVisible = true">
              <AppIcon name="chevron-right" :size="14" color="#3D5AFE" />
              移动
            </button>
          </div>

          <div v-if="hasSubtasks" class="detail__subtasks-progress">
            <span class="detail__subtasks-progress-text">
              <template v-if="allSubtasksDone">子任务已全部完成</template>
              <template v-else>子任务 {{ task.subtask_completed }}/{{ task.subtask_total }}</template>
            </span>
            <ProgressBar :total="task.subtask_total" :completed="task.subtask_completed" />
          </div>

          <p v-if="subtreeError" class="detail__subtasks-hint detail__subtasks-hint--error">
            {{ subtreeError }}
            <button class="detail__subtasks-retry pressable" @click="load">重试</button>
          </p>

          <!-- 树容器：更深层级由树内部懒加载；v0.3.0 主任务可加直接子任务，第 5 级置灰 -->
          <SubtaskTree
            :nodes="subtreeNodes"
            :root-id="task.id"
            allow-add
            :add-disabled="atDepthLimit"
            @changed="onSubtreeChanged"
          />
        </section>

        <section class="detail__times">
          <p>创建于 {{ formatShort(task.created_at) }}</p>
          <p v-if="task.completed_at">完成于 {{ formatShort(task.completed_at) }}</p>
        </section>

        <div class="detail__actions">
          <AppButton type="primary" :loading="actionLoading" @click="toggleStatus">
            {{ completed ? '取消完成' : '标记已完成' }}
          </AppButton>
          <button class="detail__delete pressable" @click="askDelete">删除</button>
        </div>
      </template>
    </div>

    <!-- 无级联影响时的简单确认 -->
    <AppActionSheet
      :visible="sheetVisible"
      title="删除后不可恢复"
      :items="[{ label: '删除任务', value: 'delete', danger: true }]"
      @select="remove"
      @cancel="sheetVisible = false"
    />

    <!-- 有子任务或日程时的级联删除告知 -->
    <AppModal
      :visible="!!deleteCascade"
      title="删除任务？"
      :text="deleteText"
      confirm-text="删除"
      danger
      @confirm="remove"
      @cancel="deleteCascade = null"
    />

    <!-- 父任务带未完成子任务：级联完成确认 -->
    <AppModal
      :visible="!!cascadeComplete"
      :title="task ? `标记「${task.title}」完成？` : ''"
      :text="cascadeComplete ? `还有 ${cascadeComplete.count} 个子任务未完成，标记后将一并标记完成。` : ''"
      confirm-text="全部完成"
      @confirm="confirmCascadeComplete"
      @cancel="cascadeComplete = null"
    />

    <!-- 移动层级：选择父任务 / 移出为根任务 -->
    <ParentPickerSheet
      :visible="pickerVisible"
      title="移动到…"
      :task-id="taskId"
      :current-parent-id="task ? task.parent_id : null"
      @select="onPickParent"
      @cancel="pickerVisible = false"
    />
  </div>
</template>

<style scoped>
.detail__head {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  height: calc(var(--navbar-height) + var(--safe-top));
  padding: var(--safe-top) var(--sp-4) 0;
  background: var(--bg-card);
  border-bottom: 1px solid var(--border-color);
}
.detail__back {
  display: flex;
  align-items: center;
  gap: 2px;
  min-width: 44px;
  min-height: 44px;
  margin-left: -12px;
  font-size: 26px;
  color: var(--color-primary);
}
.detail__back-text {
  font-size: var(--font-body-m);
  white-space: nowrap;
}
.detail__head-title {
  flex: 1;
  text-align: center;
  font-size: var(--font-body-m);
  color: var(--text-secondary);
}
.detail__edit {
  min-width: 44px;
  min-height: 44px;
  text-align: right;
  font-size: var(--font-body-l);
  color: var(--color-primary);
}
.detail__body {
  /* 底部留白避让右下角 FAB（UXUI 2：内容底部留白 ≥ 80pt） */
  padding-bottom: calc(96px + var(--safe-bottom));
}
.detail__loading {
  padding: var(--sp-6);
  text-align: center;
  color: var(--text-secondary);
  font-size: var(--font-body-m);
}
.detail__main {
  display: flex;
  align-items: flex-start;
  gap: var(--sp-3);
  padding: var(--sp-4);
  background: var(--bg-card);
}
.detail__title {
  flex: 1;
  font-size: 20px;
  line-height: 28px;
  font-weight: 600;
  word-break: break-word;
}
.detail__title--done {
  color: var(--text-disabled);
  text-decoration: line-through;
}
.detail__meta {
  margin-top: var(--sp-2);
  background: var(--bg-card);
}
.detail__meta-row {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  min-height: 48px;
  padding: 0 var(--sp-4);
  border-bottom: 1px solid var(--border-color);
  font-size: var(--font-body-m);
  color: var(--text-primary);
}
.detail__overdue {
  color: var(--color-danger);
}
.detail__overdue-hint {
  font-size: var(--font-caption);
  color: var(--color-danger);
}
.detail__note {
  margin-top: var(--sp-2);
  padding: var(--sp-4);
  background: var(--bg-card);
}
.detail__note-title {
  font-size: var(--font-caption);
  color: var(--text-secondary);
  margin-bottom: var(--sp-2);
}
.detail__note-text {
  font-size: var(--font-body-m);
  line-height: var(--font-body-m-lh);
  white-space: pre-wrap;
  word-break: break-word;
}
.detail__schedule {
  margin-top: var(--sp-2);
  padding: var(--sp-4);
  background: var(--bg-card);
}
.detail__schedule-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--sp-2);
}
.detail__schedule-title {
  font-size: var(--font-caption);
  color: var(--text-secondary);
}
.detail__schedule-count {
  color: var(--text-secondary);
}
.detail__schedule-add {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  min-height: 44px;
  margin: -10px -8px -10px 0;
  padding: 0 var(--sp-2);
  font-size: var(--font-body-m);
  color: var(--color-primary);
}
.detail__schedule-list {
  margin-top: var(--sp-1);
  display: flex;
  flex-direction: column;
}
.detail__schedule-item {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  min-height: 48px;
  border-bottom: 1px solid var(--border-color);
}
.detail__schedule-item:last-child {
  border-bottom: none;
}
.detail__schedule-time {
  font-size: var(--font-body-m);
  font-variant-numeric: tabular-nums;
  color: var(--text-primary);
  flex-shrink: 0;
}
.detail__schedule-place {
  flex: 1;
  min-width: 0;
  font-size: var(--font-caption);
  color: var(--text-secondary);
}
.detail__schedule-empty {
  margin-top: var(--sp-2);
  font-size: var(--font-caption);
  color: var(--text-disabled);
}
.detail__subtasks {
  margin-top: var(--sp-2);
  padding-top: var(--sp-3);
  background: var(--bg-card);
}
.detail__subtasks-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--sp-2);
  padding: 0 var(--sp-4);
}
.detail__subtasks-title {
  font-size: var(--font-caption);
  color: var(--text-secondary);
}
.detail__subtasks-count {
  color: var(--text-secondary);
  font-variant-numeric: tabular-nums;
}
.detail__subtasks-move {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  min-height: 44px;
  padding: 0 var(--sp-2);
  font-size: var(--font-body-m);
  color: var(--color-primary);
}
.detail__subtasks-move:disabled {
  opacity: 0.45;
}
.detail__subtasks-progress {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  margin: var(--sp-1) var(--sp-4) var(--sp-2);
}
.detail__subtasks-progress-text {
  font-size: var(--font-caption);
  line-height: var(--font-caption-lh);
  color: var(--text-secondary);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.detail__subtasks-progress :deep(.progress) {
  flex: 1;
  min-width: 60px;
}
.detail__subtasks-hint {
  padding: var(--sp-1) var(--sp-4);
  font-size: var(--font-caption);
  color: var(--text-secondary);
}
.detail__subtasks-hint--error {
  color: var(--color-danger);
}
.detail__subtasks-retry {
  min-height: 32px;
  padding: 0 var(--sp-1);
  font-size: var(--font-caption);
  color: var(--color-primary);
}
.detail__times {
  margin-top: var(--sp-2);
  padding: var(--sp-4);
  background: var(--bg-card);
  display: flex;
  flex-direction: column;
  gap: var(--sp-1);
  font-size: var(--font-caption);
  color: var(--text-secondary);
}
.detail__actions {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--sp-2);
  padding: var(--sp-6) var(--sp-4) 0;
}
.detail__delete {
  min-height: 44px;
  padding: 0 var(--sp-4);
  font-size: var(--font-body-m);
  color: var(--color-danger);
}
</style>
