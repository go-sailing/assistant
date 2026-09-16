<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import * as taskApi from '@/api/tasks'
import { errorText } from '@/api/client'
import type { Task } from '@/types'
import AppIcon from '../AppIcon.vue'

/**
 * 选择父任务弹层：
 * - 编辑/移动：候选来自 fetchParentCandidates(id)（服务端已排除自身与全部后代、限同清单）
 * - 新建任务：无 id，候选来自同清单任务列表
 */
const props = withDefaults(
  defineProps<{
    visible: boolean
    title?: string
    /** 编辑/移动场景下的任务 id；新建场景传 null */
    taskId?: number | string | null
    /** 新建场景下的清单过滤 */
    listId?: number | string | null
    /** 当前父任务（用于回显选中态） */
    currentParentId?: number | string | null
  }>(),
  { title: '选择父任务', taskId: null, listId: null, currentParentId: null }
)

const emit = defineEmits<{
  (e: 'select', parentId: number | null): void
  (e: 'cancel'): void
}>()

const loading = ref(false)
const error = ref('')
const candidates = ref<Task[]>([])
const keyword = ref('')

const byId = computed(() => new Map(candidates.value.map((t) => [String(t.id), t])))

/** 候选在清单内的层级（用于缩进展示，父链不在候选内则按 0 计） */
function chainDepth(task: Task): number {
  let depth = 0
  let cur: Task | undefined = task
  while (cur && cur.parent_id !== null && depth < 5) {
    const parent: Task | undefined = byId.value.get(String(cur.parent_id))
    if (!parent) break
    cur = parent
    depth += 1
  }
  return depth
}

const filtered = computed(() => {
  const kw = keyword.value.trim().toLowerCase()
  if (!kw) return candidates.value
  return candidates.value.filter((t) => t.title.toLowerCase().includes(kw))
})

const rootSelected = computed(() => props.currentParentId === null || props.currentParentId === undefined)

async function load(): Promise<void> {
  loading.value = true
  error.value = ''
  try {
    if (props.taskId !== null && props.taskId !== undefined) {
      candidates.value = await taskApi.fetchParentCandidates(props.taskId)
    } else {
      const res = await taskApi.fetchTasks({
        list_id: props.listId ?? undefined,
        page: 1,
        page_size: 200,
      })
      candidates.value = res.list || []
    }
  } catch (e) {
    candidates.value = []
    error.value = errorText(e)
  } finally {
    loading.value = false
  }
}

watch(
  () => [props.visible, props.taskId, props.listId],
  () => {
    if (!props.visible) return
    keyword.value = ''
    void load()
  }
)

function isCurrent(task: Task): boolean {
  return props.currentParentId !== null && props.currentParentId !== undefined && String(props.currentParentId) === String(task.id)
}

function pick(parentId: number | null): void {
  emit('select', parentId)
}
</script>

<template>
  <Transition name="sheet">
    <div v-if="visible" class="picker" role="dialog" aria-modal="true" aria-labelledby="parent-picker-title">
      <div class="picker__mask" @click="emit('cancel')" />
      <div class="picker__panel">
        <p class="picker__handle" aria-hidden="true" />
        <h3 id="parent-picker-title" class="picker__title">{{ title }}</h3>

        <!-- 固定置顶：移出为根任务 -->
        <button class="picker__item picker__item--root pressable" type="button" @click="pick(null)">
          <span class="picker__radio" :class="{ 'picker__radio--on': rootSelected }" aria-hidden="true" />
          <span class="picker__item-title">移出为根任务</span>
          <span v-if="rootSelected" class="picker__note">当前</span>
        </button>

        <div class="picker__search">
          <AppIcon name="search" :size="16" color="#6B7080" />
          <input v-model="keyword" class="picker__input" type="search" placeholder="搜索父任务…" aria-label="搜索父任务" />
        </div>

        <p class="picker__tip">仅同清单任务可选，自身与全部子任务不在此列表中</p>

        <div class="picker__list">
          <p v-if="loading" class="picker__state">加载中…</p>
          <p v-else-if="error" class="picker__state picker__state--error">
            {{ error }}
            <button class="picker__retry pressable" type="button" @click="load">重试</button>
          </p>
          <p v-else-if="!filtered.length" class="picker__state">
            {{ keyword.trim() ? '没有匹配的任务' : '同清单暂无可作为父任务的任务' }}
          </p>
          <ul v-else class="picker__items">
            <li v-for="t in filtered" :key="String(t.id)">
              <button class="picker__item pressable" type="button" @click="pick(Number(t.id))">
                <span class="picker__radio" :class="{ 'picker__radio--on': isCurrent(t) }" aria-hidden="true" />
                <span
                  class="picker__item-title ellipsis"
                  :style="{ paddingLeft: `${Math.min(chainDepth(t), 4) * 14}px` }"
                >
                  {{ t.title }}
                </span>
                <span v-if="isCurrent(t)" class="picker__note">当前父任务</span>
              </button>
            </li>
          </ul>
        </div>

        <button class="picker__cancel pressable" type="button" @click="emit('cancel')">取消</button>
      </div>
    </div>
  </Transition>
</template>

<style scoped>
.picker {
  position: fixed;
  inset: 0;
  z-index: 200;
  display: flex;
  flex-direction: column;
  justify-content: flex-end;
}
.picker__mask {
  position: absolute;
  inset: 0;
  background: var(--color-scrim, rgba(26, 29, 38, 0.4));
}
.picker__panel {
  position: relative;
  background: var(--bg-card);
  border-radius: 16px 16px 0 0;
  padding-bottom: var(--safe-bottom);
  max-height: 82vh;
  display: flex;
  flex-direction: column;
}
.picker__handle {
  width: 36px;
  height: 4px;
  border-radius: 2px;
  background: var(--border-color);
  margin: var(--sp-2) auto 0;
}
.picker__title {
  padding: var(--sp-3) var(--sp-4);
  font-size: var(--font-body-l);
  font-weight: 600;
  text-align: center;
}
.picker__item {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  width: 100%;
  min-height: 48px;
  padding: 0 var(--sp-4);
  border-bottom: 1px solid var(--border-color);
  text-align: left;
}
.picker__item--root {
  border-top: 1px solid var(--border-color);
}
.picker__radio {
  width: 18px;
  height: 18px;
  border-radius: 50%;
  border: 1.5px solid var(--text-disabled);
  flex-shrink: 0;
}
.picker__radio--on {
  border-color: var(--color-primary);
  background: var(--color-primary);
  box-shadow: inset 0 0 0 3px var(--bg-card);
}
.picker__item-title {
  flex: 1;
  min-width: 0;
  font-size: var(--font-body-m);
  color: var(--text-primary);
}
.picker__note {
  flex-shrink: 0;
  font-size: var(--font-caption);
  color: var(--color-primary);
}
.picker__search {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  margin: var(--sp-2) var(--sp-4) 0;
  padding: 0 var(--sp-3);
  min-height: 40px;
  background: var(--bg-page);
  border-radius: 18px;
}
.picker__input {
  flex: 1;
  min-width: 0;
  border: none;
  outline: none;
  background: transparent;
  font-size: var(--font-body-m);
}
.picker__tip {
  padding: var(--sp-2) var(--sp-4);
  font-size: var(--font-caption);
  line-height: var(--font-caption-lh);
  color: var(--text-secondary);
}
.picker__list {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
}
.picker__state {
  padding: var(--sp-4);
  text-align: center;
  font-size: var(--font-caption);
  color: var(--text-secondary);
}
.picker__state--error {
  color: var(--color-danger);
}
.picker__retry {
  color: var(--color-primary);
  font-size: var(--font-caption);
  padding: 0 var(--sp-1);
}
.picker__cancel {
  min-height: 52px;
  margin-top: var(--sp-2);
  border-top: 1px solid var(--border-color);
  font-size: var(--font-body-l);
  font-weight: 500;
  color: var(--text-primary);
}
.sheet-enter-active,
.sheet-leave-active {
  transition: opacity 220ms ease;
}
.sheet-enter-active .picker__panel,
.sheet-leave-active .picker__panel {
  transition: transform 220ms ease;
}
.sheet-enter-from,
.sheet-leave-to {
  opacity: 0;
}
.sheet-enter-from .picker__panel,
.sheet-leave-to .picker__panel {
  transform: translateY(100%);
}
</style>
