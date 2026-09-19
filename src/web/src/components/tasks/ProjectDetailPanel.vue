<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import * as taskApi from '@/api/tasks'
import { ApiError, errorText } from '@/api/client'
import type { Task } from '@/types'
import AppButton from '@/components/AppButton.vue'
import AppIcon from '@/components/AppIcon.vue'
import AppModal from '@/components/AppModal.vue'
import PriorityFlag from '@/components/PriorityFlag.vue'
import ProgressBar from '@/components/tasks/ProgressBar.vue'
import MemberComposer from '@/components/tasks/MemberComposer.vue'
import MemberList from '@/components/tasks/MemberList.vue'
import { useTaskSyncStore } from '@/stores/taskSync'
import { useToastStore } from '@/stores/toast'
import { dueTone, formatFull, formatShort, overdueDays } from '@/utils/time'

/**
 * 项目详情面板（v0.6.0，UXUI 5.3）：
 * 项目头部 + 成员进度（member_*）+ 成员列表 + 快速添加成员 + 操作区；
 * 完成走 4010 级联确认；删除先经 preview-remove 明示影响范围。
 */
const props = defineProps<{ task: Task }>()
const emit = defineEmits<{ (e: 'changed'): void }>()

const router = useRouter()
const toast = useToastStore()
const taskSync = useTaskSyncStore()

const members = ref<Task[]>([])
const membersLoading = ref(true)
const membersError = ref('')
const actionLoading = ref(false)
/** 级联完成确认（4010） */
const cascadeCount = ref<number | null>(null)
/** 删除级联告知 */
const deleteCascade = ref<{ tasks: number; events: number } | null>(null)

const completed = computed(() => props.task.status === 'completed')
const overdue = computed(() => dueTone(props.task) === 'danger')
const overdueText = computed(() => (overdue.value ? `已逾期 ${overdueDays(props.task.due_at)} 天` : ''))
const total = computed(() => props.task.member_total)
const done = computed(() => props.task.member_completed)
const allMembersDone = computed(() => total.value > 0 && done.value >= total.value)
const sourceText = computed(() => (props.task.source === 'chat' ? '对话创建' : '手动创建'))

const deleteText = computed(() => {
  const info = deleteCascade.value
  if (!info) return ''
  const parts: string[] = []
  if (info.tasks > 0) parts.push(`${info.tasks} 个成员任务`)
  if (info.events > 0) parts.push(`${info.events} 条关联日程安排`)
  return parts.length ? `将同时删除 ${parts.join('及')}，且不可恢复。` : '删除后不可恢复。'
})

function incompleteCount(e: unknown): number {
  const details = e instanceof ApiError
    ? (e.details as { incomplete_member_count?: number; incomplete_descendant_count?: number } | null)
    : null
  return details?.incomplete_member_count ?? details?.incomplete_descendant_count ?? 0
}

async function loadMembers(): Promise<void> {
  membersLoading.value = true
  membersError.value = ''
  try {
    const nodes = await taskApi.fetchSubtree(props.task.id)
    // 首个节点为项目自身
    members.value = nodes.filter((n) => String(n.id) !== String(props.task.id))
  } catch (e) {
    members.value = []
    membersError.value = errorText(e)
  } finally {
    membersLoading.value = false
  }
}

/** 成员增删/勾选后：本地刷新成员并请容器重拉项目（member_* 进度） */
async function refresh(): Promise<void> {
  await loadMembers()
  emit('changed')
}

async function toggleMember(m: Task): Promise<void> {
  if (actionLoading.value) return
  actionLoading.value = true
  try {
    if (m.status === 'completed') await taskApi.uncompleteTask(m.id)
    else await taskApi.completeTask(m.id)
    taskSync.markDirty()
    await refresh()
  } catch (e) {
    toast.show(errorText(e))
  } finally {
    actionLoading.value = false
  }
}

function openMember(m: Task): void {
  router.push(`/tasks/${m.id}`)
}

/** 快速添加成员：响应带 revived_parent 时说明项目已自动恢复未完成 */
async function onMemberCreated(created: Task): Promise<void> {
  taskSync.markDirty()
  if (created.revived_parent) {
    toast.show(`项目「${created.revived_parent.title}」已自动恢复为未完成`)
  }
  await refresh()
}

async function toggleStatus(): Promise<void> {
  if (actionLoading.value) return
  actionLoading.value = true
  try {
    if (completed.value) {
      await taskApi.uncompleteTask(props.task.id)
      toast.show('已恢复未完成')
      taskSync.markDirty()
      emit('changed')
    } else {
      try {
        await taskApi.completeTask(props.task.id)
        toast.show('已标记完成')
        taskSync.markDirty()
        await refresh()
      } catch (e) {
        if (e instanceof ApiError && e.code === 4010) {
          cascadeCount.value = incompleteCount(e)
          return
        }
        throw e
      }
    }
  } catch (e) {
    toast.show(errorText(e))
  } finally {
    actionLoading.value = false
  }
}

async function confirmCascade(): Promise<void> {
  cascadeCount.value = null
  actionLoading.value = true
  try {
    await taskApi.completeTask(props.task.id, true)
    toast.show('已标记完成')
    taskSync.markDirty()
    await refresh()
  } catch (e) {
    toast.show(errorText(e))
  } finally {
    actionLoading.value = false
  }
}

/** 删除前预取影响范围（服务端权威计数） */
async function askDelete(): Promise<void> {
  try {
    const preview = await taskApi.fetchPreviewRemove(props.task.id)
    const memberTasks = Math.max(0, preview.deleted_task_count - 1)
    if (memberTasks > 0 || preview.deleted_event_count > 0) {
      deleteCascade.value = { tasks: memberTasks, events: preview.deleted_event_count }
      return
    }
    // 空项目：直接二次确认
    deleteCascade.value = { tasks: 0, events: 0 }
  } catch (e) {
    toast.show(errorText(e))
  }
}

async function remove(): Promise<void> {
  deleteCascade.value = null
  try {
    const res = await taskApi.deleteTask(props.task.id)
    taskSync.markDirty()
    const memberTasks = Math.max(0, (res.deleted_task_count ?? 1) - 1)
    const events = res.deleted_event_count ?? 0
    const parts: string[] = []
    if (memberTasks > 0) parts.push(`${memberTasks} 个成员任务`)
    if (events > 0) parts.push(`${events} 条日程安排`)
    toast.show(parts.length ? `已删除项目及其 ${parts.join('、')}` : '已删除项目')
    // v0.7.0：项目页与任务页分离，删除后回项目页
    router.replace('/projects')
  } catch (e) {
    toast.show(errorText(e))
  }
}

function planEvent(): void {
  router.push(`/calendar/task/new?task_id=${props.task.id}&from=task`)
}

onMounted(loadMembers)

watch(
  () => props.task.id,
  () => void loadMembers()
)
</script>

<template>
  <div class="pp">
    <!-- 项目头部 -->
    <section class="pp__head">
      <h1 class="pp__title" :class="{ 'pp__title--done': completed }">
        <AppIcon name="folder" :size="18" color="var(--color-primary)" class="pp__title-icon" />
        {{ task.title }}
      </h1>
      <div class="pp__tags">
        <span class="pp__badge" :class="completed ? 'pp__badge--done' : 'pp__badge--doing'">
          {{ completed ? '已完成' : '进行中' }}
        </span>
        <PriorityFlag :priority="task.priority" />
      </div>
      <p class="pp__meta">
        <AppIcon name="clock" :size="16" color="#6B7080" />
        <span :class="{ 'pp__overdue': overdue }">{{ formatFull(task.due_at) }}</span>
        <span v-if="overdueText" class="pp__overdue-hint">{{ overdueText }}</span>
        <span class="pp__dot">·</span>
        <span>{{ sourceText }}</span>
      </p>
      <p v-if="task.note" class="pp__note">{{ task.note }}</p>
    </section>

    <!-- 进度区：项目不自动完成 -->
    <section class="pp__progress">
      <div class="pp__progress-head">
        <span class="pp__progress-text">已完成 {{ done }} / 共 {{ total }}</span>
        <span v-if="allMembersDone" class="pp__progress-hint">成员已全部完成，可点下方完成项目</span>
      </div>
      <ProgressBar
        :total="total"
        :completed="done"
        :label="`项目成员进度 ${done}/${total}`"
      />
    </section>

    <!-- 成员区 -->
    <section class="pp__members">
      <h2 class="pp__section-title">
        成员任务<span v-if="total" class="pp__section-count">（{{ total }}）</span>
      </h2>

      <p v-if="membersLoading" class="pp__state">加载中…</p>
      <p v-else-if="membersError" class="pp__state pp__state--error">
        {{ membersError }}
        <button class="pp__retry pressable" @click="loadMembers">重试</button>
      </p>
      <p v-else-if="!members.length" class="pp__state">还没有成员任务，在下方添加第一个</p>
      <MemberList
        v-else
        :members="members"
        :disabled="actionLoading"
        @toggle="toggleMember"
        @detail="openMember"
      />

      <MemberComposer :project-id="task.id" @created="onMemberCreated" />
    </section>

    <section class="pp__times">
      <p>创建于 {{ formatShort(task.created_at) }}</p>
      <p v-if="task.completed_at">完成于 {{ formatShort(task.completed_at) }}</p>
    </section>

    <!-- 操作区 -->
    <div class="pp__actions">
      <AppButton type="primary" :loading="actionLoading" @click="planEvent">安排日程</AppButton>
      <AppButton :disabled="actionLoading" @click="router.push(`/projects/${task.id}/edit`)">
        编辑项目
      </AppButton>
      <AppButton :loading="actionLoading" @click="toggleStatus">
        {{ completed ? '取消完成' : '完成项目' }}
      </AppButton>
      <button class="pp__delete pressable" @click="askDelete">删除项目</button>
    </div>

    <!-- 级联完成确认 -->
    <AppModal
      :visible="cascadeCount !== null"
      :title="`完成项目「${task.title}」？`"
      :text="cascadeCount !== null ? `还有 ${cascadeCount} 个成员任务未完成，完成项目后将一并标记完成。` : ''"
      confirm-text="全部完成"
      @confirm="confirmCascade"
      @cancel="cascadeCount = null"
    />

    <!-- 删除级联告知 -->
    <AppModal
      :visible="!!deleteCascade"
      title="删除项目？"
      :text="deleteText"
      confirm-text="删除"
      danger
      @confirm="remove"
      @cancel="deleteCascade = null"
    />
  </div>
</template>

<style scoped>
.pp__head {
  padding: var(--sp-4);
  background: var(--bg-card);
}
.pp__title {
  font-size: 20px;
  line-height: 28px;
  font-weight: 600;
  word-break: break-word;
}
.pp__title-icon {
  margin-right: 4px;
}
.pp__title--done {
  color: var(--text-disabled);
  text-decoration: line-through;
}
.pp__tags {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  margin-top: var(--sp-2);
  flex-wrap: wrap;
}
.pp__badge {
  display: inline-flex;
  align-items: center;
  min-height: 22px;
  padding: 0 var(--sp-2);
  border-radius: 6px;
  font-size: var(--font-caption);
}
.pp__badge--doing {
  background: var(--color-primary-light);
  color: var(--color-primary);
}
.pp__badge--done {
  background: var(--bg-page);
  color: var(--text-secondary);
}
.pp__meta {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  margin-top: var(--sp-2);
  font-size: var(--font-caption);
  line-height: var(--font-caption-lh);
  color: var(--text-secondary);
}
.pp__dot {
  color: var(--text-disabled);
}
.pp__overdue {
  color: var(--color-danger);
}
.pp__overdue-hint {
  color: var(--color-danger);
}
.pp__note {
  margin-top: var(--sp-2);
  font-size: var(--font-body-m);
  line-height: var(--font-body-m-lh);
  white-space: pre-wrap;
  word-break: break-word;
}
.pp__progress {
  margin-top: var(--sp-2);
  padding: var(--sp-4);
  background: var(--bg-card);
}
.pp__progress-head {
  display: flex;
  align-items: baseline;
  gap: var(--sp-2);
  margin-bottom: var(--sp-2);
  flex-wrap: wrap;
}
.pp__progress-text {
  font-size: var(--font-body-m);
  color: var(--text-primary);
  font-variant-numeric: tabular-nums;
}
.pp__progress-hint {
  font-size: var(--font-caption);
  color: var(--color-success);
}
.pp__members {
  margin-top: var(--sp-2);
  background: var(--bg-card);
}
.pp__section-title {
  padding: var(--sp-3) var(--sp-4) var(--sp-1);
  font-size: var(--font-caption);
  color: var(--text-secondary);
}
.pp__section-count {
  color: var(--text-secondary);
  font-variant-numeric: tabular-nums;
}
.pp__state {
  padding: var(--sp-3) var(--sp-4);
  font-size: var(--font-caption);
  color: var(--text-secondary);
}
.pp__state--error {
  color: var(--color-danger);
}
.pp__retry {
  min-height: 32px;
  padding: 0 var(--sp-1);
  font-size: var(--font-caption);
  color: var(--color-primary);
}
.pp__times {
  margin-top: var(--sp-2);
  padding: var(--sp-4);
  background: var(--bg-card);
  display: flex;
  flex-direction: column;
  gap: var(--sp-1);
  font-size: var(--font-caption);
  color: var(--text-secondary);
}
.pp__actions {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: var(--sp-3);
  padding: var(--sp-6) var(--sp-4) 0;
}
.pp__delete {
  min-height: 44px;
  font-size: var(--font-body-m);
  color: var(--color-danger);
}
</style>
