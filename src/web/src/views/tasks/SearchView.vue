<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import * as taskApi from '@/api/tasks'
import { errorText } from '@/api/client'
import type { Task } from '@/types'
import AppIcon from '@/components/AppIcon.vue'
import StateEmpty from '@/components/StateEmpty.vue'
import StateError from '@/components/StateError.vue'
import SkeletonList from '@/components/SkeletonList.vue'
import TaskListItem from '@/components/TaskListItem.vue'
import { useToastStore } from '@/stores/toast'

const router = useRouter()
const toast = useToastStore()

const keyword = ref('')
const results = ref<Task[]>([])
const searched = ref(false)
const loading = ref(false)
const error = ref('')
const inputRef = ref<HTMLInputElement | null>(null)
let timer: number | undefined

async function runSearch(): Promise<void> {
  const kw = keyword.value.trim()
  if (!kw) {
    results.value = []
    searched.value = false
    return
  }
  loading.value = true
  error.value = ''
  try {
    results.value = await taskApi.searchTasks(kw)
    searched.value = true
  } catch (e) {
    results.value = []
    searched.value = true
    error.value = errorText(e)
  } finally {
    loading.value = false
  }
}

function onInput(): void {
  if (timer) window.clearTimeout(timer)
  timer = window.setTimeout(() => {
    void runSearch()
  }, 300)
}

function clearKeyword(): void {
  keyword.value = ''
  results.value = []
  searched.value = false
  inputRef.value?.focus()
}

function goDetail(task: Task): void {
  router.push(`/tasks/${task.id}`)
}

async function onToggle(task: Task): Promise<void> {
  try {
    const updated =
      task.status === 'completed'
        ? await taskApi.uncompleteTask(task.id)
        : await taskApi.completeTask(task.id)
    const i = results.value.findIndex((t) => String(t.id) === String(task.id))
    if (i >= 0) results.value[i] = updated
  } catch (e) {
    toast.show(errorText(e))
  }
}

async function onRemove(task: Task): Promise<void> {
  try {
    await taskApi.deleteTask(task.id)
    results.value = results.value.filter((t) => String(t.id) !== String(task.id))
    toast.show('已删除')
  } catch (e) {
    toast.show(errorText(e))
  }
}

onMounted(() => {
  inputRef.value?.focus()
})
</script>

<template>
  <div class="page search">
    <header class="search__head">
      <button class="search__back pressable" aria-label="返回" @click="router.back()">‹</button>
      <div class="search__box">
        <AppIcon name="search" :size="18" color="#6B7080" />
        <input
          ref="inputRef"
          v-model="keyword"
          class="search__input"
          type="search"
          placeholder="搜索任务…"
          aria-label="搜索任务"
          @input="onInput"
          @keydown.enter="runSearch"
        />
        <button
          v-if="keyword"
          class="search__clear pressable"
          aria-label="清空关键词"
          @click="clearKeyword"
        >
          <AppIcon name="close" :size="16" color="#6B7080" />
        </button>
      </div>
    </header>

    <div class="page-body">
      <SkeletonList v-if="loading" :rows="3" />

      <StateError v-else-if="error" :text="error" @retry="runSearch" />

      <StateEmpty
        v-else-if="!searched"
        title="搜索任务"
        text="输入关键词搜索标题或备注"
      />

      <StateEmpty v-else-if="!results.length" title="没有找到相关任务" text="换个关键词试试" />

      <ul v-else class="search__list">
        <TaskListItem
          v-for="t in results"
          :key="String(t.id)"
          :task="t"
          :keyword="keyword.trim()"
          @detail="goDetail"
          @toggle="onToggle"
          @remove="onRemove"
        />
      </ul>
    </div>
  </div>
</template>

<style scoped>
.search__head {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  height: calc(var(--navbar-height) + var(--safe-top));
  padding: var(--safe-top) var(--sp-4) 0;
  background: var(--bg-card);
  border-bottom: 1px solid var(--border-color);
}
.search__back {
  min-width: 44px;
  min-height: 44px;
  margin-left: -8px;
  font-size: 26px;
  color: var(--color-primary);
  text-align: left;
}
.search__box {
  flex: 1;
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  min-height: 36px;
  padding: 0 var(--sp-3);
  background: var(--bg-page);
  border-radius: 18px;
}
.search__input {
  flex: 1;
  min-width: 0;
  border: none;
  outline: none;
  background: transparent;
  font-size: var(--font-body-m);
}
.search__clear {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
}
.search__list {
  background: var(--bg-card);
}
</style>