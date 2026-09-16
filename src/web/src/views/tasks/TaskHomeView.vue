<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import * as taskApi from '@/api/tasks'
import * as listApi from '@/api/lists'
import { errorText } from '@/api/client'
import type { Task, TaskList, TaskSort, TaskStatus } from '@/types'
import AppActionSheet from '@/components/AppActionSheet.vue'
import AppFAB from '@/components/AppFAB.vue'
import AppIcon from '@/components/AppIcon.vue'
import SegmentedControl from '@/components/SegmentedControl.vue'
import SkeletonList from '@/components/SkeletonList.vue'
import StateEmpty from '@/components/StateEmpty.vue'
import StateError from '@/components/StateError.vue'
import TaskListItem from '@/components/TaskListItem.vue'
import { useTaskSyncStore } from '@/stores/taskSync'
import { useToastStore } from '@/stores/toast'

const router = useRouter()
const route = useRoute()
const toast = useToastStore()
const taskSync = useTaskSyncStore()

/** 清单筛选：ALL 表示全部清单 */
const ALL = 'all'

const tasks = ref<Task[]>([])
const lists = ref<TaskList[]>([])
const listId = ref<string>(ALL)
const status = ref<TaskStatus | 'all'>('all')
const sort = ref<TaskSort>('due_at_asc')
const loading = ref(true)
const error = ref('')
const refreshing = ref(false)
const highlightId = ref<string>('')

const listSheetVisible = ref(false)
const sortSheetVisible = ref(false)
const actionTask = ref<Task | null>(null)
const deleteSheetVisible = ref(false)

const statusOptions = [
  { label: '全部', value: 'all' },
  { label: '未完成', value: 'todo' },
  { label: '已完成', value: 'completed' },
]

const sortLabel = computed(() =>
  sort.value === 'created_at_desc' ? '按创建时间' : '按截止时间'
)

const sortItems = [
  { label: '按截止时间', value: 'due_at_asc' },
  { label: '按创建时间', value: 'created_at_desc' },
]

const currentListName = computed(() => {
  if (listId.value === ALL) return '全部清单'
  const found = lists.value.find((l) => String(l.id) === String(listId.value))
  return found ? found.name : '全部清单'
})

/** 默认清单置顶 */
const orderedLists = computed(() =>
  [...lists.value].sort((a, b) => Number(b.is_default) - Number(a.is_default))
)

const listItems = computed(() => [
  { label: '全部清单', value: ALL },
  ...orderedLists.value.map((l) => ({ label: l.name, value: String(l.id) })),
  { label: '管理清单…', value: '__manage__' },
])

/** 是否处于筛选态（用于区分首次空态与筛选空态） */
const filtered = computed(() => listId.value !== ALL || status.value !== 'all')

async function loadLists(): Promise<void> {
  try {
    lists.value = await listApi.fetchLists()
  } catch {
    lists.value = []
  }
}

async function loadTasks(): Promise<void> {
  error.value = ''
  try {
    const res = await taskApi.fetchTasks({
      list_id: listId.value === ALL ? undefined : listId.value,
      status: status.value === 'all' ? undefined : status.value,
      sort: sort.value,
      page: 1,
      page_size: 50,
    })
    tasks.value = res.list || []
  } catch (e) {
    // 失败不展示旧数据，只展示错误态
    tasks.value = []
    error.value = errorText(e)
  }
}

async function loadAll(): Promise<void> {
  loading.value = true
  await Promise.all([loadLists(), loadTasks()])
  loading.value = false
}

async function refresh(): Promise<void> {
  refreshing.value = true
  await Promise.all([loadLists(), loadTasks()])
  refreshing.value = false
}

function openListSheet(): void {
  listSheetVisible.value = true
}

function onListSelect(v: string): void {
  listSheetVisible.value = false
  if (v === '__manage__') {
    router.push('/lists')
    return
  }
  if (v === listId.value) return
  listId.value = v
  loading.value = true
  void loadTasks().finally(() => {
    loading.value = false
  })
}

function onSortSelect(v: string): void {
  sortSheetVisible.value = false
  if (v === sort.value) return
  sort.value = v as TaskSort
  loading.value = true
  void loadTasks().finally(() => {
    loading.value = false
  })
}

function onStatusChange(v: string): void {
  status.value = v as TaskStatus | 'all'
  loading.value = true
  void loadTasks().finally(() => {
    loading.value = false
  })
}

function goDetail(task: Task): void {
  router.push(`/tasks/${task.id}`)
}

/** 勾选完成：乐观更新，失败回弹 */
async function onToggle(task: Task): Promise<void> {
  const index = tasks.value.findIndex((t) => String(t.id) === String(task.id))
  if (index < 0) return
  const original = tasks.value[index]
  const completed = original.status === 'completed'
  tasks.value[index] = {
    ...original,
    status: completed ? 'todo' : 'completed',
    completed_at: completed ? null : new Date().toISOString(),
  }
  try {
    const updated = completed
      ? await taskApi.uncompleteTask(original.id)
      : await taskApi.completeTask(original.id)
    const i = tasks.value.findIndex((t) => String(t.id) === String(original.id))
    if (i >= 0) tasks.value[i] = updated
    // 已完成筛选下取消完成，该项不应再出现
    if (status.value === 'completed' && updated.status !== 'completed') {
      tasks.value = tasks.value.filter((t) => String(t.id) !== String(original.id))
    }
  } catch (e) {
    const i = tasks.value.findIndex((t) => String(t.id) === String(original.id))
    if (i >= 0) tasks.value[i] = original
    toast.show(errorText(e) || '操作失败，请重试')
  }
}

function askDelete(task: Task): void {
  actionTask.value = task
  deleteSheetVisible.value = true
}

async function confirmDelete(): Promise<void> {
  const task = actionTask.value
  deleteSheetVisible.value = false
  if (!task) return
  try {
    await taskApi.deleteTask(task.id)
    tasks.value = tasks.value.filter((t) => String(t.id) !== String(task.id))
    toast.show('已删除')
  } catch (e) {
    toast.show(errorText(e))
  }
}

/* ---- 下拉刷新 ---- */
const scroller = ref<HTMLElement | null>(null)
const pullDistance = ref(0)
let startY = 0
let pullActive = false

function onTouchStart(e: TouchEvent): void {
  const el = scroller.value
  if (!el || el.scrollTop > 0 || refreshing.value) return
  startY = e.touches[0].clientY
  pullActive = true
}

function onTouchMove(e: TouchEvent): void {
  if (!pullActive) return
  const dy = e.touches[0].clientY - startY
  if (dy > 0) pullDistance.value = Math.min(72, dy * 0.5)
}

async function onTouchEnd(): Promise<void> {
  if (!pullActive) return
  pullActive = false
  const shouldRefresh = pullDistance.value >= 36
  pullDistance.value = 0
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
      if (route.query.highlight) router.replace({ path: '/tasks' })
    }, 2000)
  }
})
</script>

<template>
  <div class="page home">
    <header class="home__head">
      <h1 class="home__title">我的任务</h1>
      <button class="home__icon-btn pressable" aria-label="搜索任务" @click="router.push('/search')">
        <AppIcon name="search" :size="24" color="#1A1D26" />
      </button>
    </header>

    <div class="home__filter">
      <button class="home__list-btn pressable" @click="openListSheet">
        <AppIcon name="folder" :size="18" color="#6B7080" />
        <span class="home__list-name ellipsis">{{ currentListName }}</span>
        <AppIcon name="chevron-down" :size="16" color="#B5B9C4" />
      </button>
      <button class="home__sort-btn pressable" @click="sortSheetVisible = true">
        {{ sortLabel }}
        <AppIcon name="chevron-down" :size="14" color="#B5B9C4" />
      </button>
    </div>

    <SegmentedControl :model-value="status" :options="statusOptions" @update:model-value="onStatusChange" />

    <div
      ref="scroller"
      class="page-body home__body"
      @touchstart.passive="onTouchStart"
      @touchmove="onTouchMove"
      @touchend="onTouchEnd"
      @touchcancel="onTouchEnd"
    >
      <div v-if="pullDistance > 0 || refreshing" class="home__pull">
        {{ refreshing ? '正在刷新…' : pullDistance >= 36 ? '松开刷新' : '下拉刷新' }}
      </div>

      <SkeletonList v-if="loading" :rows="4" />

      <StateError v-else-if="error" :text="error" @retry="loadAll" />

      <StateEmpty
        v-else-if="!tasks.length && filtered"
        title="当前筛选下没有任务"
        text="换个清单或状态试试"
      />

      <StateEmpty
        v-else-if="!tasks.length"
        title="还没有任务"
        text="点 ＋ 新建，或去助手说一句话"
        action-text="去助手说一句话"
        @action="router.push('/chat')"
      />

      <ul v-else class="home__list">
        <TaskListItem
          v-for="t in tasks"
          :key="String(t.id)"
          :task="t"
          :highlight="String(t.id) === highlightId"
          @detail="goDetail"
          @toggle="onToggle"
          @remove="askDelete"
        />
      </ul>
    </div>

    <AppFAB @click="router.push('/tasks/new')" />

    <AppActionSheet
      :visible="listSheetVisible"
      title="切换清单"
      :items="listItems"
      @select="onListSelect"
      @cancel="listSheetVisible = false"
    />
    <AppActionSheet
      :visible="sortSheetVisible"
      title="排序方式"
      :items="sortItems"
      @select="onSortSelect"
      @cancel="sortSheetVisible = false"
    />
    <AppActionSheet
      :visible="deleteSheetVisible"
      :title="actionTask ? `删除「${actionTask.title}」？` : ''"
      :items="[{ label: '删除任务', value: 'delete', danger: true }]"
      @select="confirmDelete"
      @cancel="deleteSheetVisible = false"
    />
  </div>
</template>

<style scoped>
.home {
  position: relative;
}
.home__head {
  display: flex;
  align-items: center;
  height: calc(var(--navbar-height) + var(--safe-top));
  padding: var(--safe-top) var(--sp-4) 0;
  background: var(--bg-card);
}
.home__title {
  flex: 1;
  font-size: var(--font-heading-m);
  line-height: var(--font-heading-m-lh);
  font-weight: 600;
}
.home__icon-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 44px;
  height: 44px;
  margin-right: -10px;
}
.home__filter {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--sp-2);
  padding: var(--sp-2) var(--sp-4);
  background: var(--bg-card);
}
.home__list-btn {
  display: flex;
  align-items: center;
  gap: 6px;
  min-height: 44px;
  padding: 0 var(--sp-3);
  background: var(--bg-page);
  border-radius: 18px;
  max-width: 60%;
}
.home__list-name {
  font-size: var(--font-body-m);
  color: var(--text-primary);
}
.home__sort-btn {
  display: flex;
  align-items: center;
  gap: 4px;
  min-height: 44px;
  font-size: var(--font-caption);
  color: var(--text-secondary);
}
.home__body {
  position: relative;
  background: var(--bg-page);
}
.home__pull {
  text-align: center;
  font-size: var(--font-caption);
  color: var(--text-secondary);
  padding: var(--sp-2) 0;
}
.home__list {
  background: var(--bg-card);
  padding-bottom: var(--sp-8);
}
</style>