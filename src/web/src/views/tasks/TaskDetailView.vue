<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import * as taskApi from '@/api/tasks'
import { errorText } from '@/api/client'
import type { Task } from '@/types'
import AppActionSheet from '@/components/AppActionSheet.vue'
import AppButton from '@/components/AppButton.vue'
import AppCheckbox from '@/components/AppCheckbox.vue'
import AppIcon from '@/components/AppIcon.vue'
import PriorityFlag from '@/components/PriorityFlag.vue'
import StateError from '@/components/StateError.vue'
import { useTaskSyncStore } from '@/stores/taskSync'
import { useToastStore } from '@/stores/toast'
import { dueTone, formatFull, formatShort, overdueDays } from '@/utils/time'

const route = useRoute()
const router = useRouter()
const toast = useToastStore()
const taskSync = useTaskSyncStore()

const task = ref<Task | null>(null)
const loading = ref(true)
const error = ref('')
const actionLoading = ref(false)
const sheetVisible = ref(false)

const taskId = computed(() => String(route.params.id))
const fromChat = computed(() => route.query.from === 'chat')
const completed = computed(() => task.value?.status === 'completed')
const overdue = computed(() => (task.value ? dueTone(task.value) === 'danger' : false))
const overdueText = computed(() => {
  if (!task.value || !overdue.value) return ''
  return `已逾期 ${overdueDays(task.value.due_at)} 天`
})

async function load(): Promise<void> {
  loading.value = true
  error.value = ''
  try {
    task.value = await taskApi.fetchTask(taskId.value)
  } catch (e) {
    task.value = null
    error.value = errorText(e)
  } finally {
    loading.value = false
  }
}

async function toggleStatus(): Promise<void> {
  const t = task.value
  if (!t || actionLoading.value) return
  actionLoading.value = true
  try {
    task.value = t.status === 'completed' ? await taskApi.uncompleteTask(t.id) : await taskApi.completeTask(t.id)
    taskSync.markDirty()
    toast.show(task.value.status === 'completed' ? '已标记完成' : '已恢复未完成')
  } catch (e) {
    toast.show(errorText(e))
  } finally {
    actionLoading.value = false
  }
}

async function remove(): Promise<void> {
  const t = task.value
  if (!t) return
  sheetVisible.value = false
  try {
    await taskApi.deleteTask(t.id)
    taskSync.markDirty()
    toast.show('已删除')
    router.replace('/tasks')
  } catch (e) {
    toast.show(errorText(e))
  }
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

        <section class="detail__times">
          <p>创建于 {{ formatShort(task.created_at) }}</p>
          <p v-if="task.completed_at">完成于 {{ formatShort(task.completed_at) }}</p>
        </section>

        <div class="detail__actions">
          <AppButton type="primary" :loading="actionLoading" @click="toggleStatus">
            {{ completed ? '取消完成' : '标记已完成' }}
          </AppButton>
          <button class="detail__delete pressable" @click="sheetVisible = true">删除</button>
        </div>
      </template>
    </div>

    <AppActionSheet
      :visible="sheetVisible"
      title="删除后不可恢复"
      :items="[{ label: '删除任务', value: 'delete', danger: true }]"
      @select="remove"
      @cancel="sheetVisible = false"
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
  padding-bottom: calc(var(--sp-6) + var(--safe-bottom));
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