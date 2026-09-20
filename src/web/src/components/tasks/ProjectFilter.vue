<script setup lang="ts">
import { computed, nextTick, ref } from 'vue'
import type { Project } from '@/types'
import AppIcon from '../AppIcon.vue'

/**
 * 任务页项目筛选器（v0.8.0，UXUI 5.2 / 7.1，TASK-01）：
 * 胶囊按钮（32pt，常显当前值）+ 自建底部弹层（沿用 AppActionSheet 的遮罩/面板/取消行规格）。
 * 选中态用「右侧 check 图标 + 主色文字」双通道表达（不用 radio、不整行底色）。
 */
type FilterValue = number | 'none' | null

interface FilterOption {
  value: FilterValue
  label: string
  /** 成员任务计数（仅具体项目有） */
  caption?: string
  disabled?: boolean
}

const props = defineProps<{
  /** null = 全部；'none' = 未归属项目；number = 具体项目 */
  modelValue: FilterValue
  /** 筛选候选（进入页面时一次性取回） */
  projects: Project[]
}>()

const emit = defineEmits<{ (e: 'update:modelValue', value: FilterValue): void }>()

/** 项目数超过该值时在弹层顶部提供本地搜索（UXUI 5.2） */
const SEARCH_THRESHOLD = 8

const open = ref(false)
const keyword = ref('')
const btnRef = ref<HTMLButtonElement | null>(null)
const panelRef = ref<HTMLElement | null>(null)

const hasProjects = computed(() => props.projects.length > 0)
const searchable = computed(() => props.projects.length > SEARCH_THRESHOLD)

/** 选项顺序：全部 → 未归属项目 → 各项目（项目按创建时间倒序，服务端口径） */
const options = computed<FilterOption[]>(() => {
  const list: FilterOption[] = [
    { value: null, label: '全部' },
    // 无项目时仍展示，但为禁用态（UXUI 5.2 联动态）
    { value: 'none', label: '未归属项目', disabled: !hasProjects.value },
  ]
  props.projects.forEach((p) =>
    list.push({ value: p.id, label: p.name, caption: `${p.member_total} 个任务` })
  )
  return list
})

/** 搜索按项目名过滤；「全部 / 未归属项目」为固定项，始终保留 */
const visibleOptions = computed<FilterOption[]>(() => {
  const kw = keyword.value.trim().toLowerCase()
  if (!kw) return options.value
  return options.value.filter(
    (o) => o.value === null || o.value === 'none' || o.label.toLowerCase().includes(kw)
  )
})

const currentLabel = computed(() => {
  if (props.modelValue === null) return '全部'
  if (props.modelValue === 'none') return '未归属项目'
  const hit = props.projects.find((p) => p.id === props.modelValue)
  return hit ? hit.name : '全部'
})

function isSelected(o: FilterOption): boolean {
  return o.value === props.modelValue
}

function openSheet(): void {
  keyword.value = ''
  open.value = true
  // 打开后滚动定位并聚焦当前选中项（UXUI 7.1 / A11y）
  void nextTick(() => {
    const node = panelRef.value?.querySelector<HTMLElement>('[data-selected="true"]')
    if (!node) {
      panelRef.value?.focus()
      return
    }
    node.scrollIntoView({ block: 'center' })
    node.focus()
  })
}

/** 点遮罩 / 「取消」/ Esc：不变更筛选，仅关闭并归还焦点 */
function closeSheet(): void {
  open.value = false
  btnRef.value?.focus()
}

function pick(o: FilterOption): void {
  if (o.disabled) return
  emit('update:modelValue', o.value)
  closeSheet()
}
</script>

<template>
  <div class="pf">
    <button
      ref="btnRef"
      type="button"
      class="pf__btn pressable"
      :class="{ 'pf__btn--on': modelValue !== null }"
      aria-haspopup="listbox"
      :aria-expanded="open"
      @click="openSheet"
    >
      <span class="pf__btn-label">项目：</span>
      <span class="pf__btn-value ellipsis">{{ currentLabel }}</span>
      <AppIcon name="chevron-down" :size="14" color="#B5B9C4" />
    </button>

    <Transition name="sheet">
      <div v-if="open" class="pf__root" role="dialog" aria-modal="true" aria-label="选择项目">
        <div class="pf__mask" @click="closeSheet" />
        <div
          ref="panelRef"
          class="pf__panel sheet-panel"
          role="listbox"
          aria-label="项目筛选"
          tabindex="-1"
          @keydown.esc="closeSheet"
        >
          <p class="pf__title">选择项目</p>

          <div v-if="searchable" class="pf__search">
            <AppIcon name="search" :size="16" color="#6B7080" />
            <input
              v-model="keyword"
              class="pf__input"
              type="search"
              placeholder="搜索项目…"
              aria-label="搜索项目"
            />
          </div>

          <ul class="pf__list">
            <li v-for="o in visibleOptions" :key="String(o.value)">
              <button
                type="button"
                class="pf__item"
                :class="{ 'pf__item--on': isSelected(o), 'pf__item--disabled': o.disabled }"
                role="option"
                :aria-selected="isSelected(o)"
                :aria-disabled="o.disabled"
                :disabled="o.disabled"
                :data-selected="isSelected(o) ? 'true' : undefined"
                @click="pick(o)"
              >
                <span class="pf__item-label ellipsis">{{ o.label }}</span>
                <span v-if="o.caption" class="pf__item-caption">{{ o.caption }}</span>
                <AppIcon v-if="isSelected(o)" name="check" :size="18" color="#3D5AFE" />
              </button>
            </li>
          </ul>

          <p v-if="!hasProjects" class="pf__tip">还没有项目，去项目页新建</p>

          <button type="button" class="pf__cancel pressable" @click="closeSheet">取消</button>
        </div>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
/* ---- 胶囊按钮（高 32pt / 圆角 8 / 白底描边） ---- */
.pf__btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  max-width: 100%;
  height: 32px;
  padding: 0 var(--sp-3);
  background: var(--bg-card);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-control);
  font-size: var(--font-body-m);
  color: var(--text-secondary);
}
/* 已选非「全部」：文字转主文本色（不换底色，避免与排序胶囊争视觉） */
.pf__btn--on {
  color: var(--text-primary);
  font-weight: 500;
}
.pf__btn-value {
  max-width: 140px;
}

/* ---- 弹层（沿用 ActionSheet：遮罩 / 顶部圆角 16 / 220ms translateY） ---- */
.pf__root {
  position: fixed;
  inset: 0;
  z-index: 200;
  display: flex;
  flex-direction: column;
  justify-content: flex-end;
}
.pf__mask {
  position: absolute;
  inset: 0;
  background: rgba(26, 29, 38, 0.45);
}
.pf__panel {
  position: relative;
  display: flex;
  flex-direction: column;
  background: var(--bg-page);
  border-radius: 16px 16px 0 0;
  padding-bottom: var(--safe-bottom);
  overflow: hidden;
}
.pf__title {
  padding: var(--sp-3) var(--sp-4);
  text-align: center;
  font-size: var(--font-body-l);
  font-weight: 600;
  background: var(--bg-card);
}
.pf__search {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  margin: var(--sp-2) var(--sp-4) 0;
  padding: 0 var(--sp-3);
  min-height: 40px;
  background: var(--bg-card);
  border: 1px solid var(--border-color);
  border-radius: 18px;
}
.pf__input {
  flex: 1;
  min-width: 0;
  border: none;
  outline: none;
  background: transparent;
  font-size: var(--font-body-m);
}
.pf__list {
  background: var(--bg-card);
  max-height: 60dvh;
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
}
.pf__item {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  width: 100%;
  min-height: 52px;
  padding: 0 var(--sp-4);
  background: var(--bg-card);
  border-bottom: 1px solid var(--border-color);
  text-align: left;
  font-size: var(--font-body-l);
  color: var(--text-primary);
}
.pf__item--on {
  color: var(--color-primary);
}
.pf__item--disabled {
  color: var(--text-disabled);
  cursor: not-allowed;
}
.pf__item-label {
  flex: 1;
  min-width: 0;
}
.pf__item-caption {
  flex-shrink: 0;
  font-size: var(--font-caption);
  color: var(--text-secondary);
}
.pf__tip {
  padding: var(--sp-3) var(--sp-4);
  background: var(--bg-card);
  text-align: center;
  font-size: var(--font-caption);
  line-height: var(--font-caption-lh);
  color: var(--text-secondary);
}
.pf__cancel {
  min-height: 52px;
  margin-top: var(--sp-2);
  background: var(--bg-card);
  font-size: var(--font-body-l);
  font-weight: 500;
}
.sheet-enter-active,
.sheet-leave-active {
  transition: opacity 220ms ease;
}
.sheet-enter-active .pf__panel,
.sheet-leave-active .pf__panel {
  transition: transform 220ms ease;
}
.sheet-enter-from,
.sheet-leave-to {
  opacity: 0;
}
.sheet-enter-from .pf__panel,
.sheet-leave-to .pf__panel {
  transform: translateY(100%);
}
</style>
