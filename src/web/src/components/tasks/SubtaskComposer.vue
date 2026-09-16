<script setup lang="ts">
import { nextTick, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import * as taskApi from '@/api/tasks'
import { errorText } from '@/api/client'
import type { Task } from '@/types'
import { useToastStore } from '@/stores/toast'

const props = withDefaults(
  defineProps<{
    /** 父任务 ID */
    parentId: number | string
    parentTitle?: string
    /** 同清单约束下代传，便于服务端归属校验 */
    listId?: number | string | null
  }>(),
  { parentTitle: '', listId: null }
)

const emit = defineEmits<{
  (e: 'created', task: Task): void
  (e: 'cancel'): void
}>()

const toast = useToastStore()
const router = useRouter()
const title = ref('')
const saving = ref(false)
const error = ref('')
const inputRef = ref<HTMLInputElement | null>(null)

/** 自动聚焦并保证输入框不被软键盘遮挡 */
function focusInput(): void {
  void nextTick(() => {
    const el = inputRef.value
    if (!el) return
    el.focus()
    el.scrollIntoView({ block: 'nearest' })
  })
}

onMounted(focusInput)

async function save(): Promise<void> {
  const text = title.value.trim()
  if (!text || saving.value) return
  saving.value = true
  error.value = ''
  try {
    const created = await taskApi.createTask({
      title: text,
      parent_id: props.parentId,
      list_id: props.listId ?? undefined,
    })
    title.value = ''
    emit('created', created)
    // 已完成父任务下新增未完成子任务：服务端自动恢复父任务
    if (created.revived_parent) {
      toast.show(`父任务「${created.revived_parent.title}」已自动恢复为未完成`)
    }
    // 连续添加：保存后保持聚焦
    focusInput()
  } catch (e) {
    // 失败保留输入内容，行内红字 + 重试
    error.value = errorText(e)
  } finally {
    saving.value = false
  }
}

function cancel(): void {
  title.value = ''
  error.value = ''
  emit('cancel')
}

/** 更多字段：进入完整任务表单，父任务与清单预选 */
function goFullForm(): void {
  emit('cancel')
  router.push({
    path: '/tasks/new',
    query: {
      parent_id: String(props.parentId),
      ...(props.listId !== null ? { list_id: String(props.listId) } : {}),
    },
  })
}
</script>

<template>
  <div class="composer">
    <div class="composer__box" :class="{ 'composer__box--error': !!error }">
      <span class="composer__box-mask" aria-hidden="true" />
      <input
        ref="inputRef"
        v-model="title"
        class="composer__input"
        type="text"
        placeholder="输入子任务标题…"
        :maxlength="200"
        :disabled="saving"
        aria-label="子任务标题"
        @keydown.enter.prevent="save"
        @input="error = ''"
      />
    </div>
    <p v-if="parentTitle" class="composer__hint">属于：{{ parentTitle }}</p>
    <p v-if="error" class="composer__error">
      {{ error }}
      <button class="composer__retry pressable" type="button" @click="save">重试</button>
    </p>
    <div class="composer__actions">
      <button class="composer__more pressable" type="button" @click="goFullForm">更多字段 ›</button>
      <button class="composer__btn pressable" type="button" :disabled="saving" @click="cancel">取消</button>
      <button
        class="composer__btn composer__btn--primary pressable"
        type="button"
        :disabled="!title.trim() || saving"
        @click="save"
      >
        保存
      </button>
    </div>
  </div>
</template>

<style scoped>
.composer {
  padding: var(--sp-2) var(--sp-4) var(--sp-3);
  background: var(--bg-card);
}
.composer__box {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  min-height: 44px;
  padding: 0 var(--sp-3);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-control);
  background: var(--bg-card);
}
.composer__box:focus-within {
  border-color: var(--color-primary);
}
.composer__box--error {
  border-color: var(--color-danger);
}
/* 与子任务行复选框对齐的占位（视觉上暗示"将成为子任务"） */
.composer__box-mask {
  width: 20px;
  height: 20px;
  border: 1.5px solid var(--text-disabled);
  border-radius: 50%;
  flex-shrink: 0;
}
.composer__input {
  flex: 1;
  min-width: 0;
  border: none;
  outline: none;
  background: transparent;
  font-size: var(--font-body-m);
  line-height: var(--font-body-m-lh);
  padding: 11px 0;
}
.composer__input::placeholder {
  color: var(--text-disabled);
}
.composer__hint {
  margin-top: var(--sp-1);
  font-size: var(--font-caption);
  line-height: var(--font-caption-lh);
  color: var(--text-disabled);
}
.composer__error {
  margin-top: var(--sp-1);
  font-size: var(--font-caption);
  line-height: var(--font-caption-lh);
  color: var(--color-danger);
}
.composer__retry {
  color: var(--color-primary);
  font-size: var(--font-caption);
  padding: 0 var(--sp-1);
}
.composer__actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: var(--sp-2);
  margin-top: var(--sp-2);
}
.composer__more {
  margin-right: auto;
  min-height: 44px;
  font-size: var(--font-body-m);
  color: var(--text-secondary);
}
.composer__btn {
  min-height: 44px;
  padding: 0 var(--sp-4);
  border-radius: var(--radius-control);
  font-size: var(--font-body-m);
  color: var(--text-secondary);
}
.composer__btn--primary {
  background: var(--color-primary);
  color: #fff;
}
.composer__btn:disabled {
  opacity: 0.45;
}
</style>
