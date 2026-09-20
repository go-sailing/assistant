<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { fetchProjectOptions } from '@/api/projects'
import { errorText } from '@/api/client'
import type { Project } from '@/types'
import AppIcon from '../AppIcon.vue'

/**
 * 选择所属项目弹层（v0.8.0）：
 * - 候选一律来自 fetchProjectOptions()（项目独立实体，服务端已无 parent-candidates）；
 * - 第一项固定为「无（独立任务）」，选中即移出项目；
 * - 任务是项目的成员，项目之间不可嵌套。
 */
const props = withDefaults(
  defineProps<{
    visible: boolean
    title?: string
    /** 编辑/移动场景下的任务 id；新建场景传 null（v0.8.0 候选不再依赖，保留入参兼容） */
    taskId?: number | string | null
    /** 当前所属项目（用于回显选中态） */
    currentProjectId?: number | string | null
  }>(),
  { title: '选择所属项目', taskId: null, currentProjectId: null }
)

const emit = defineEmits<{
  (e: 'select', projectId: number | null): void
  (e: 'cancel'): void
}>()

const loading = ref(false)
const error = ref('')
const candidates = ref<Project[]>([])
const keyword = ref('')

const filtered = computed(() => {
  const kw = keyword.value.trim().toLowerCase()
  if (!kw) return candidates.value
  return candidates.value.filter((p) => p.name.toLowerCase().includes(kw))
})

const detached = computed(
  () => props.currentProjectId === null || props.currentProjectId === undefined
)

/** 候选来源统一为项目列表（新建/编辑/移动同源） */
async function load(): Promise<void> {
  loading.value = true
  error.value = ''
  try {
    candidates.value = await fetchProjectOptions()
  } catch (e) {
    candidates.value = []
    error.value = errorText(e)
  } finally {
    loading.value = false
  }
}

watch(
  () => props.visible,
  () => {
    if (!props.visible) return
    keyword.value = ''
    void load()
  }
)

function isCurrent(project: Project): boolean {
  return (
    props.currentProjectId !== null &&
    props.currentProjectId !== undefined &&
    String(props.currentProjectId) === String(project.id)
  )
}

function pick(projectId: number | null): void {
  emit('select', projectId)
}
</script>

<template>
  <Transition name="sheet">
    <div v-if="visible" class="picker" role="dialog" aria-modal="true" aria-labelledby="project-picker-title">
      <div class="picker__mask" @click="emit('cancel')" />
      <div class="picker__panel sheet-panel">
        <p class="picker__handle" aria-hidden="true" />
        <h3 id="project-picker-title" class="picker__title">{{ title }}</h3>

        <!-- 固定置顶：移出项目 -->
        <button class="picker__item picker__item--root pressable" type="button" @click="pick(null)">
          <span class="picker__radio" :class="{ 'picker__radio--on': detached }" aria-hidden="true" />
          <span class="picker__item-title">无（独立任务）</span>
          <span v-if="detached" class="picker__note">当前</span>
        </button>

        <div class="picker__search">
          <AppIcon name="search" :size="16" color="#6B7080" />
          <input
            v-model="keyword"
            class="picker__input"
            type="search"
            placeholder="搜索项目…"
            aria-label="搜索项目"
          />
        </div>

        <p class="picker__tip">任务是项目的成员，项目之间不可嵌套</p>

        <div class="picker__list">
          <p v-if="loading" class="picker__state">加载中…</p>
          <p v-else-if="error" class="picker__state picker__state--error">
            {{ error }}
            <button class="picker__retry pressable" type="button" @click="load">重试</button>
          </p>
          <p v-else-if="!filtered.length" class="picker__state">
            {{ keyword.trim() ? '没有匹配的项目' : '暂无项目，可先新建一个项目' }}
          </p>
          <ul v-else class="picker__items">
            <li v-for="p in filtered" :key="String(p.id)">
              <button class="picker__item pressable" type="button" @click="pick(Number(p.id))">
                <span class="picker__radio" :class="{ 'picker__radio--on': isCurrent(p) }" aria-hidden="true" />
                <span class="picker__item-title ellipsis">{{ p.name }}</span>
                <span v-if="isCurrent(p)" class="picker__note">当前项目</span>
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
