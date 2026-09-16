<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import * as taskApi from '@/api/tasks'
import { errorText } from '@/api/client'
import type { Task } from '@/types'
import { formatDue } from '@/utils/time'
import AppIcon from '@/components/AppIcon.vue'
import AppInput from '@/components/AppInput.vue'
import PriorityFlag from '@/components/PriorityFlag.vue'
import SkeletonList from '@/components/SkeletonList.vue'
import StateEmpty from '@/components/StateEmpty.vue'
import StateError from '@/components/StateError.vue'
import { useToastStore } from '@/stores/toast'

const router = useRouter()
const toast = useToastStore()

const keyword = ref('')
const todoTasks = ref<Task[]>([])
const doneTasks = ref<Task[]>([])
const selectedId = ref('')
const loading = ref(true)
const error = ref('')
let timer: number | undefined

function byDue(a: Task, b: Task): number {
  const ta = a.due_at ? new Date(a.due_at).getTime() : Number.MAX_SAFE_INTEGER
  const tb = b.due_at ? new Date(b.due_at).getTime() : Number.MAX_SAFE_INTEGER
  return ta - tb
}

/** 默认列表：待办在前、已完成在后（已完成仅作参考，不可选） */
async function loadDefault(): Promise<void> {
  loading.value = true
  error.value = ''
  try {
    const [todo, done] = await Promise.all([
      taskApi.fetchTasks({ status: 'todo', sort: 'due_at_asc', page: 1, page_size: 50 }),
      taskApi.fetchTasks({ status: 'completed', page: 1, page_size: 20 }),
    ])
    todoTasks.value = [...(todo.list || [])].sort(byDue)
    doneTasks.value = done.list || []
  } catch (e) {
    // 失败不展示旧数据
    todoTasks.value = []
    doneTasks.value = []
    error.value = errorText(e)
  } finally {
    loading.value = false
  }
}

async function runSearch(): Promise<void> {
  const kw = keyword.value.trim()
  if (!kw) {
    await loadDefault()
    return
  }
  loading.value = true
  error.value = ''
  try {
    const all = (await taskApi.searchTasks(kw)) || []
    todoTasks.value = all.filter((t) => t.status !== 'completed').sort(byDue)
    doneTasks.value = all.filter((t) => t.status === 'completed')
  } catch (e) {
    todoTasks.value = []
    doneTasks.value = []
    error.value = errorText(e)
  } finally {
    loading.value = false
  }
}

/** 输入防抖，避免每敲一个字都打接口 */
function onInput(): void {
  if (timer) window.clearTimeout(timer)
  timer = window.setTimeout(() => {
    void runSearch()
  }, 300)
}

function select(task: Task): void {
  if (task.status === 'completed') return
  selectedId.value = String(task.id)
}

/** 恢复已完成任务：变为可选并直接选中，省掉一次点击 */
async function restore(id: Task['id']): Promise<void> {
  try {
    const updated = await taskApi.uncompleteTask(id)
    doneTasks.value = doneTasks.value.filter((t) => String(t.id) !== String(id))
    todoTasks.value = [...todoTasks.value, updated].sort(byDue)
    selectedId.value = String(updated.id)
    toast.show('已恢复未完成')
  } catch (e) {
    toast.show(errorText(e))
  }
}

function goBack(): void {
  if (window.history.state && window.history.state.back) router.back()
  else router.replace('/calendar/new')
}

/** 选择结果通过 history.state 回传，避免把任务信息写进 URL */
function confirm(): void {
  const picked = [...todoTasks.value, ...doneTasks.value].find(
    (t) => String(t.id) === selectedId.value
  )
  if (!picked) return
  window.history.replaceState(
    { ...(window.history.state || {}), pickedTask: { id: String(picked.id), title: picked.title } },
    ''
  )
  goBack()
}

onMounted(loadDefault)
</script>

<template>
  <div class="page picker">
    <header class="picker__head">
      <button class="picker__back pressable" aria-label="返回" @click="goBack">‹</button>
      <h1 class="picker__title">选择任务</h1>
      <button class="picker__done" :disabled="!selectedId" @click="confirm">完成</button>
    </header>

    <div class="picker__search">
      <AppInput v-model="keyword" placeholder="搜索任务…" @update:model-value="onInput" />
    </div>

    <div class="page-body picker__body">
      <SkeletonList v-if="loading" :rows="4" />

      <StateError v-else-if="error" :text="error" @retry="runSearch" />

      <StateEmpty
        v-else-if="!todoTasks.length && !doneTasks.length"
        title="没有找到任务"
        text="换个关键词，或去新建一个任务"
      />

      <template v-else>
        <ul class="picker__list">
          <li v-for="t in todoTasks" :key="String(t.id)">
            <button
              class="picker__row pressable"
              :aria-pressed="selectedId === String(t.id)"
              @click="select(t)"
            >
              <span
                class="picker__radio"
                :class="{ 'picker__radio--on': selectedId === String(t.id) }"
                aria-hidden="true"
              >
                <AppIcon
                  v-if="selectedId === String(t.id)"
                  name="check"
                  :size="12"
                  color="#fff"
                />
              </span>
              <span class="picker__main">
                <span class="picker__task-title ellipsis">{{ t.title }}</span>
                <span class="picker__sub">
                  <span class="picker__list-name ellipsis">{{ t.list_name || '默认清单' }}</span>
                  <span aria-hidden="true">·</span>
                  <span class="ellipsis">{{ formatDue(t.due_at) }}</span>
                  <PriorityFlag :priority="t.priority" />
                </span>
              </span>
            </button>
          </li>
        </ul>

        <template v-if="doneTasks.length">
          <p class="picker__section">已完成</p>
          <ul class="picker__list">
            <li v-for="t in doneTasks" :key="String(t.id)">
              <div class="picker__row picker__row--done">
                <span class="picker__radio" aria-hidden="true" />
                <span class="picker__main">
                  <span class="picker__task-title ellipsis">{{ t.title }}</span>
                  <span class="picker__sub">
                    <span class="picker__list-name ellipsis">{{ t.list_name || '默认清单' }}</span>
                    <span aria-hidden="true">·</span>
                    <span class="ellipsis">已完成</span>
                  </span>
                </span>
                <button class="picker__restore pressable" @click="restore(t.id)">恢复</button>
              </div>
            </li>
          </ul>
        </template>
      </template>

      <button class="picker__new pressable" @click="router.push('/tasks/new')">
        没有目标任务？去新建任务
      </button>
    </div>
  </div>
</template>

<style scoped>
.picker__head {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  height: calc(var(--navbar-height) + var(--safe-top));
  padding: var(--safe-top) var(--sp-4) 0;
  background: var(--bg-card);
  border-bottom: 1px solid var(--border-color);
}
.picker__back {
  min-width: 44px;
  min-height: 44px;
  margin-left: -12px;
  text-align: left;
  font-size: 26px;
  color: var(--color-primary);
}
.picker__title {
  flex: 1;
  text-align: center;
  font-size: var(--font-heading-m);
  line-height: var(--font-heading-m-lh);
  font-weight: 600;
}
.picker__done {
  min-width: 44px;
  min-height: 44px;
  text-align: right;
  font-size: var(--font-body-l);
  color: var(--color-primary);
}
.picker__done:disabled {
  color: var(--text-disabled);
  cursor: not-allowed;
}
.picker__search {
  padding: var(--sp-3) var(--sp-4);
  background: var(--bg-card);
}
.picker__body {
  background: var(--bg-page);
  padding-top: var(--sp-2);
}
.picker__list {
  background: var(--bg-card);
}
.picker__row {
  display: flex;
  align-items: center;
  gap: var(--sp-3);
  width: 100%;
  min-height: 64px;
  padding: var(--sp-2) var(--sp-4);
  text-align: left;
}
.picker__list > li + li .picker__row,
.picker__row--done {
  border-top: 1px solid var(--border-color);
}
.picker__row--done {
  opacity: 0.55;
}
.picker__radio {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border-radius: 50%;
  border: 1.5px solid var(--text-disabled);
  flex-shrink: 0;
}
.picker__radio--on {
  background: var(--color-primary);
  border-color: var(--color-primary);
}
.picker__main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.picker__task-title {
  font-size: var(--font-body-l);
  line-height: var(--font-body-l-lh);
  color: var(--text-primary);
}
.picker__sub {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: var(--font-caption);
  line-height: var(--font-caption-lh);
  color: var(--text-secondary);
}
.picker__list-name {
  max-width: 40%;
}
.picker__restore {
  display: flex;
  align-items: center;
  justify-content: center;
  min-width: 56px;
  min-height: 44px;
  margin-right: -8px;
  font-size: var(--font-body-m);
  color: var(--color-primary);
  flex-shrink: 0;
}
.picker__section {
  padding: var(--sp-3) var(--sp-4) var(--sp-2);
  font-size: var(--font-caption);
  color: var(--text-secondary);
}
.picker__new {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  min-height: 52px;
  margin-top: var(--sp-3);
  background: var(--bg-card);
  font-size: var(--font-body-m);
  color: var(--color-primary);
}
</style>