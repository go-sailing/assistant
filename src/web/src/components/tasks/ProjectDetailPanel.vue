<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import { deleteProject, previewRemoveProject } from '@/api/projects'
import * as taskApi from '@/api/tasks'
import { errorText } from '@/api/client'
import type { Project, Task } from '@/types'
import AppIcon from '@/components/AppIcon.vue'
import AppModal from '@/components/AppModal.vue'
import ProgressBar from '@/components/tasks/ProgressBar.vue'
import MemberComposer from '@/components/tasks/MemberComposer.vue'
import MemberList from '@/components/tasks/MemberList.vue'
import { useTaskSyncStore } from '@/stores/taskSync'
import { useToastStore } from '@/stores/toast'
import { formatShort } from '@/utils/time'

/**
 * 项目详情面板（v0.8.0，UXUI 5.7）：
 * 头部（名称 + 派生只读状态徽标 + 备注 + 来源）/ 进度 / 成员任务 + 快速添加成员；
 * 底部仅「删除项目」（项目不可手工完成，优先级/截止时间行与
 * 「安排日程」「编辑项目」「完成项目」及 4010 级联确认全部移除）。
 * 项目状态由成员完成度派生：端上只读展示，全部完成时进度数字转 success 色。
 */
const props = defineProps<{
  project: Project
  /** 成员任务由容器加载后传入（变更后通过 changed 请容器重拉） */
  members: Task[]
}>()
const emit = defineEmits<{ (e: 'changed'): void }>()

const router = useRouter()
const toast = useToastStore()
const taskSync = useTaskSyncStore()

const actionLoading = ref(false)
/** 删除前预取的影响范围（成员任务数 / 关联日程数） */
const removeInfo = ref<{ tasks: number; events: number } | null>(null)
const deleting = ref(false)

const completed = computed(() => props.project.status === 'completed')
const total = computed(() => props.project.member_total)
const done = computed(() => props.project.member_completed)
const allDone = computed(() => total.value > 0 && done.value >= total.value)
const sourceText = computed(() => (props.project.source === 'chat' ? '对话创建' : '手动创建'))

const deleteText = computed(() => {
  const info = removeInfo.value
  if (!info) return ''
  const parts: string[] = []
  if (info.tasks > 0) parts.push(`${info.tasks} 个成员任务`)
  if (info.events > 0) parts.push(`${info.events} 条关联日程`)
  return parts.length ? `将同时删除 ${parts.join('及')}，且不可恢复。` : '删除后不可恢复。'
})

/** 成员勾选完成/取消完成：项目状态由服务端派生，完成后请容器重拉 */
async function toggleMember(m: Task): Promise<void> {
  if (actionLoading.value) return
  actionLoading.value = true
  try {
    if (m.status === 'completed') await taskApi.uncompleteTask(m.id)
    else await taskApi.completeTask(m.id)
    taskSync.markDirty()
    emit('changed')
  } catch (e) {
    toast.show(errorText(e))
  } finally {
    actionLoading.value = false
  }
}

function openMember(m: Task): void {
  router.push(`/tasks/${m.id}`)
}

/** 快速添加成员：保存后由容器重拉项目（进度/派生徽标）与成员列表 */
function onMemberCreated(): void {
  taskSync.markDirty()
  emit('changed')
}

/** 删除前预取影响范围（服务端权威计数） */
async function askDelete(): Promise<void> {
  try {
    const preview = await previewRemoveProject(props.project.id)
    removeInfo.value = {
      tasks: preview.deleted_task_count ?? 0,
      events: preview.deleted_event_count ?? 0,
    }
  } catch (e) {
    toast.show(errorText(e))
  }
}

async function remove(): Promise<void> {
  if (deleting.value) return
  deleting.value = true
  try {
    const res = await deleteProject(props.project.id)
    taskSync.markDirty()
    const parts: string[] = []
    if (res.deleted_task_count > 0) parts.push(`${res.deleted_task_count} 个成员任务`)
    if (res.deleted_event_count > 0) parts.push(`${res.deleted_event_count} 条关联日程`)
    toast.show(parts.length ? `已删除项目及其 ${parts.join('、')}` : '已删除项目')
    removeInfo.value = null
    router.replace('/projects')
  } catch (e) {
    toast.show(errorText(e))
  } finally {
    deleting.value = false
  }
}
</script>

<template>
  <div class="pp">
    <!-- 项目头部：名称 + 只读状态徽标 + 备注 + 来源 -->
    <section class="pp__head">
      <h1 class="pp__title">
        <AppIcon name="folder" :size="18" color="var(--color-primary)" class="pp__title-icon" />
        <span class="pp__name">{{ project.name }}</span>
        <span class="pp__badge" :class="completed ? 'pp__badge--done' : 'pp__badge--doing'">
          {{ completed ? '已完成' : '进行中' }}
        </span>
      </h1>
      <p v-if="project.note" class="pp__note">{{ project.note }}</p>
      <p class="pp__meta">{{ sourceText }}</p>
    </section>

    <!-- 进度区：派生态（无手工完成入口） -->
    <section class="pp__progress">
      <div class="pp__progress-head">
        <span class="pp__progress-text" :class="{ 'pp__progress-text--done': allDone }">
          已完成 {{ done }} / 共 {{ total }}
        </span>
      </div>
      <ProgressBar :total="total" :completed="done" :label="`项目成员进度 ${done}/${total}`" />
    </section>

    <!-- 成员区 -->
    <section class="pp__members">
      <h2 class="pp__section-title">
        成员任务<span v-if="total" class="pp__section-count">（{{ total }}）</span>
      </h2>

      <p v-if="!members.length" class="pp__state">还没有成员任务，在下方添加第一个</p>
      <MemberList
        v-else
        :members="members"
        :disabled="actionLoading"
        @toggle="toggleMember"
        @detail="openMember"
      />

      <MemberComposer :project-id="project.id" @created="onMemberCreated" />
    </section>

    <section class="pp__times">
      <p>创建于 {{ formatShort(project.created_at) }}</p>
      <p v-if="project.completed_at">完成于 {{ formatShort(project.completed_at) }}</p>
    </section>

    <!-- 操作区：v0.8.0 仅保留「删除项目」 -->
    <div class="pp__actions">
      <button class="pp__delete pressable" :disabled="deleting" @click="askDelete">删除项目</button>
    </div>

    <!-- 删除级联告知（成员任务数 / 关联日程数） -->
    <AppModal
      :visible="!!removeInfo"
      :title="`删除项目「${project.name}」？`"
      :text="deleteText"
      confirm-text="删除"
      danger
      :loading="deleting"
      @confirm="remove"
      @cancel="removeInfo = null"
    />
  </div>
</template>

<style scoped>
.pp__head {
  padding: var(--sp-4);
  background: var(--bg-card);
}
.pp__title {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  font-size: 20px;
  line-height: 28px;
  font-weight: 600;
  word-break: break-word;
}
.pp__title-icon {
  flex-shrink: 0;
}
.pp__name {
  min-width: 0;
  word-break: break-word;
}
/* 状态徽标：派生只读（紧邻项目名右侧，不可点） */
.pp__badge {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  min-height: 22px;
  padding: 0 var(--sp-2);
  border-radius: 6px;
  font-size: var(--font-caption);
  font-weight: 400;
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
  margin-top: var(--sp-2);
  font-size: var(--font-caption);
  line-height: var(--font-caption-lh);
  color: var(--text-secondary);
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
/* 全部完成：数字与文案转 success 色（派生态视觉，UXUI 7.7） */
.pp__progress-text--done {
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
  padding: var(--sp-6) var(--sp-4) 0;
}
.pp__delete {
  width: 100%;
  min-height: 44px;
  font-size: var(--font-body-m);
  color: var(--color-danger);
}
</style>
