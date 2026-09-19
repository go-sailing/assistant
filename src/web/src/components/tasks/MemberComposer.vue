<script setup lang="ts">
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import * as taskApi from '@/api/tasks'
import { errorText } from '@/api/client'
import type { Task } from '@/types'
import AppIcon from '@/components/AppIcon.vue'

/**
 * 项目内快速添加成员（v0.6.0）：输入标题即创建（parent_id = 项目 ID）；
 * 「更多字段」跳到任务表单并预填所属项目与清单。
 */
const props = defineProps<{
  projectId: number | string
  listId: number | string
}>()

const emit = defineEmits<{
  (e: 'created', task: Task): void
}>()

const title = ref('')
const saving = ref(false)
const error = ref('')
const router = useRouter()

async function add(): Promise<void> {
  const value = title.value.trim()
  if (!value || saving.value) return
  saving.value = true
  error.value = ''
  try {
    const created = await taskApi.createTask({
      title: value,
      list_id: Number(props.listId),
      parent_id: Number(props.projectId),
      task_type: 'normal',
    })
    title.value = ''
    emit('created', created)
  } catch (e) {
    error.value = errorText(e)
  } finally {
    saving.value = false
  }
}

/** 需要备注/优先级/截止时间时进入完整表单 */
function moreFields(): void {
  router.push({
    path: '/tasks/new',
    query: { parent_id: String(props.projectId), list_id: String(props.listId) },
  })
}
</script>

<template>
  <div class="composer">
    <div class="composer__row">
      <input
        v-model="title"
        class="composer__input"
        type="text"
        maxlength="200"
        placeholder="添加任务…"
        aria-label="添加项目任务"
        :disabled="saving"
        @keydown.enter="add"
      />
      <button
        class="composer__add pressable"
        type="button"
        :disabled="!title.trim() || saving"
        aria-label="添加任务"
        @click="add"
      >
        <AppIcon name="plus" :size="20" color="var(--color-primary)" />
      </button>
    </div>
    <p v-if="error" class="composer__error" role="alert">{{ error }}</p>
    <button class="composer__more pressable" type="button" @click="moreFields">更多字段（备注/优先级/截止时间）</button>
  </div>
</template>

<style scoped>
.composer {
  padding: var(--sp-3) var(--sp-4);
  background: var(--bg-card);
  border-top: 1px solid var(--border-color);
}
.composer__row {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
}
.composer__input {
  flex: 1;
  min-width: 0;
  min-height: 44px;
  padding: 0 var(--sp-3);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-control);
  background: var(--bg-page);
  outline: none;
  font-size: var(--font-body-m);
}
.composer__input:focus {
  border-color: var(--color-primary);
}
.composer__add {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 44px;
  min-height: 44px;
  flex-shrink: 0;
}
.composer__add:disabled {
  opacity: 0.4;
}
.composer__error {
  margin-top: var(--sp-2);
  font-size: var(--font-caption);
  color: var(--color-danger);
}
.composer__more {
  margin-top: var(--sp-2);
  min-height: 32px;
  font-size: var(--font-caption);
  color: var(--color-primary);
}
</style>
