<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import * as projectApi from '@/api/projects'
import * as taskApi from '@/api/tasks'
import { errorText } from '@/api/client'
import type { Project, Task } from '@/types'
import AppIcon from '@/components/AppIcon.vue'
import StateEmpty from '@/components/StateEmpty.vue'
import StateError from '@/components/StateError.vue'
import SkeletonList from '@/components/SkeletonList.vue'
import TaskListItem from '@/components/TaskListItem.vue'
import { useToastStore } from '@/stores/toast'

/** 搜索结果项（v0.8.0）：任务与项目合并为一个本地列表，用 kind 判别 */
type SearchItem =
  | { kind: 'task'; key: string; task: Task }
  | { kind: 'project'; key: string; project: Project }

const router = useRouter()
const toast = useToastStore()

const keyword = ref('')
const items = ref<SearchItem[]>([])
const searched = ref(false)
const loading = ref(false)
const error = ref('')
const inputRef = ref<HTMLInputElement | null>(null)
let timer: number | undefined

async function runSearch(): Promise<void> {
  const kw = keyword.value.trim()
  if (!kw) {
    items.value = []
    searched.value = false
    return
  }
  loading.value = true
  error.value = ''
  try {
    // 任务与项目并发搜索后合并（任务在前，项目在后）
    const [tasks, projects] = await Promise.all([
      taskApi.searchTasks(kw),
      projectApi.fetchProjects({ keyword: kw, page_size: 20 }),
    ])
    items.value = [
      ...(tasks || []).map(
        (t): SearchItem => ({ kind: 'task', key: `task-${t.id}`, task: t })
      ),
      ...(projects.list || []).map(
        (p): SearchItem => ({ kind: 'project', key: `project-${p.id}`, project: p })
      ),
    ]
    searched.value = true
  } catch (e) {
    items.value = []
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
  items.value = []
  searched.value = false
  inputRef.value?.focus()
}

/** 点击结果：任务进任务详情，项目进项目详情（均带 from=search） */
function openItem(item: SearchItem): void {
  if (item.kind === 'project') {
    router.push({ path: `/projects/${item.project.id}`, query: { from: 'search' } })
    return
  }
  router.push({ path: `/tasks/${item.task.id}`, query: { from: 'search' } })
}

async function onToggle(task: Task): Promise<void> {
  try {
    const updated =
      task.status === 'completed'
        ? await taskApi.uncompleteTask(task.id)
        : await taskApi.completeTask(task.id)
    items.value = items.value.map((it) =>
      it.kind === 'task' && String(it.task.id) === String(task.id) ? { ...it, task: updated } : it
    )
  } catch (e) {
    toast.show(errorText(e))
  }
}

async function onRemove(task: Task): Promise<void> {
  try {
    await taskApi.deleteTask(task.id)
    items.value = items.value.filter(
      (it) => !(it.kind === 'task' && String(it.task.id) === String(task.id))
    )
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
          placeholder="搜索任务或项目…"
          aria-label="搜索任务或项目"
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
        title="搜索任务与项目"
        text="输入关键词搜索任务标题、备注或项目名称"
      />

      <StateEmpty v-else-if="!items.length" title="没有找到相关内容" text="换个关键词试试" />

      <ul v-else class="search__list">
        <template v-for="it in items" :key="it.key">
          <TaskListItem
            v-if="it.kind === 'task'"
            :task="it.task"
            :keyword="keyword.trim()"
            @detail="openItem(it)"
            @toggle="onToggle"
            @remove="onRemove"
          />
          <!-- 项目结果行：点击直达项目详情 -->
          <li
            v-else
            class="search__row pressable"
            role="button"
            tabindex="0"
            @click="openItem(it)"
            @keydown.enter="openItem(it)"
          >
            <AppIcon name="folder" :size="20" color="#3D5AFE" />
            <div class="search__row-main">
              <p class="search__row-title ellipsis">{{ it.project.name }}</p>
              <p class="search__row-sub">
                项目 · 成员 {{ it.project.member_completed }}/{{ it.project.member_total }}
              </p>
            </div>
            <AppIcon name="chevron-right" :size="18" color="#B5B9C4" />
          </li>
        </template>
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
.search__row {
  display: flex;
  align-items: center;
  gap: var(--sp-3);
  min-height: 56px;
  padding: var(--sp-3) var(--sp-4);
  background: var(--bg-card);
  border-bottom: 1px solid var(--border-color);
}
.search__row-main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.search__row-title {
  font-size: var(--font-body-l);
  line-height: var(--font-body-l-lh);
  color: var(--text-primary);
}
.search__row-sub {
  font-size: var(--font-caption);
  line-height: var(--font-caption-lh);
  color: var(--text-secondary);
}
</style>
