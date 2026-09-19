<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import * as taskApi from '@/api/tasks'
import { errorText } from '@/api/client'
import type { AgentLog, AgentLogAction } from '@/types'
import { formatFull, formatShort } from '@/utils/time'
import LoadingDots from '@/components/LoadingDots.vue'

/**
 * 执行记录时间线（v0.7.0，UXUI 5.4 / 7.3）：
 * 默认 3 条（倒序），超出显示「查看全部」→ 底部弹层分页加载；
 * 节点颜色按动作：指派/取消指派/领取/进度 = timeline，完成 = success，失败 = danger，重新执行 = primary。
 */
const props = defineProps<{ taskId: number | string }>()

const PREVIEW_SIZE = 3
const PAGE_SIZE = 20

const ACTION_META: Record<AgentLogAction, { label: string; tone: string }> = {
  assigned: { label: '指派', tone: 'neutral' },
  unassigned: { label: '取消指派', tone: 'neutral' },
  claimed: { label: '领取', tone: 'neutral' },
  progress: { label: '进度', tone: 'neutral' },
  succeeded: { label: '完成', tone: 'success' },
  failed: { label: '失败', tone: 'danger' },
  retried: { label: '重新执行', tone: 'primary' },
}

const logs = ref<AgentLog[]>([])
const total = ref(0)
const loading = ref(false)
const error = ref('')

const sheetVisible = ref(false)
const sheetLogs = ref<AgentLog[]>([])
const sheetTotal = ref(0)
const sheetPage = ref(1)
const sheetLoading = ref(false)
const sheetError = ref('')

const hasMore = computed(() => sheetLogs.value.length < sheetTotal.value)

function metaOf(action: AgentLogAction): { label: string; tone: string } {
  return ACTION_META[action] ?? { label: action, tone: 'neutral' }
}

function relText(iso: string): string {
  const t = new Date(iso).getTime()
  if (Number.isNaN(t)) return ''
  const diff = Date.now() - t
  if (diff < 60_000) return '刚刚'
  const minutes = Math.floor(diff / 60_000)
  if (minutes < 60) return `${minutes} 分钟前`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} 小时前`
  const days = Math.floor(hours / 24)
  if (days < 30) return `${days} 天前`
  return formatShort(iso)
}

/** 代理已删除：节点来源标记（执行类动作但无代理信息） */
function deletedAgent(log: AgentLog): boolean {
  return (
    log.agent_id === null &&
    log.agent_name === null &&
    log.action !== 'assigned' &&
    log.action !== 'unassigned'
  )
}

async function loadPreview(): Promise<void> {
  loading.value = true
  error.value = ''
  try {
    const res = await taskApi.fetchAgentLogs(props.taskId, { page: 1, page_size: PREVIEW_SIZE })
    logs.value = res.list || []
    total.value = res.total
  } catch (e) {
    logs.value = []
    total.value = 0
    error.value = errorText(e)
  } finally {
    loading.value = false
  }
}

async function loadSheetPage(page: number, reset = false): Promise<void> {
  sheetLoading.value = true
  sheetError.value = ''
  try {
    const res = await taskApi.fetchAgentLogs(props.taskId, { page, page_size: PAGE_SIZE })
    const list = res.list || []
    sheetLogs.value = reset ? list : [...sheetLogs.value, ...list]
    sheetTotal.value = res.total
    sheetPage.value = page
  } catch (e) {
    sheetError.value = errorText(e)
  } finally {
    sheetLoading.value = false
  }
}

function openSheet(): void {
  sheetVisible.value = true
  sheetLogs.value = []
  sheetTotal.value = 0
  sheetPage.value = 1
  sheetError.value = ''
  void loadSheetPage(1, true)
}

function loadMore(): void {
  if (sheetLoading.value || !hasMore.value) return
  void loadSheetPage(sheetPage.value + 1)
}

onMounted(loadPreview)

watch(
  () => props.taskId,
  () => {
    void loadPreview()
    if (sheetVisible.value) openSheet()
  }
)
</script>

<template>
  <div class="tl">
    <p v-if="loading" class="tl__state">加载中…</p>
    <p v-else-if="error" class="tl__state tl__state--error">
      {{ error }}
      <button class="tl__retry pressable" type="button" @click="loadPreview">重试</button>
    </p>
    <p v-else-if="!logs.length" class="tl__state">暂无执行记录</p>
    <template v-else>
      <ol class="tl__list" role="list">
        <li v-for="log in logs" :key="log.id" class="tl__item" role="listitem">
          <span class="tl__node" :class="`tl__node--${metaOf(log.action).tone}`" aria-hidden="true" />
          <div class="tl__body">
            <p class="tl__head">
              <span class="tl__action">{{ metaOf(log.action).label }}</span>
              <time class="tl__time" :datetime="log.created_at" :title="formatFull(log.created_at)">
                {{ relText(log.created_at) }}
              </time>
            </p>
            <p v-if="log.content" class="tl__content">{{ log.content }}</p>
            <p v-if="deletedAgent(log)" class="tl__deleted">代理已删除</p>
          </div>
        </li>
      </ol>
      <button
        v-if="total > logs.length"
        class="tl__all pressable"
        type="button"
        @click="openSheet"
      >
        查看全部
      </button>
    </template>

    <Transition name="sheet">
      <div v-if="sheetVisible" class="sheet" role="dialog" aria-modal="true" aria-label="执行记录">
        <div class="sheet__mask" @click="sheetVisible = false" />
        <div class="sheet__panel sheet-panel">
          <p class="sheet__handle" aria-hidden="true" />
          <h3 class="sheet__title">执行记录</h3>
          <div class="sheet__body">
            <p v-if="sheetError" class="tl__state tl__state--error">
              {{ sheetError }}
              <button class="tl__retry pressable" type="button" @click="loadSheetPage(1, true)">重试</button>
            </p>
            <ol v-else class="tl__list" role="list">
              <li v-for="log in sheetLogs" :key="log.id" class="tl__item" role="listitem">
                <span class="tl__node" :class="`tl__node--${metaOf(log.action).tone}`" aria-hidden="true" />
                <div class="tl__body">
                  <p class="tl__head">
                    <span class="tl__action">{{ metaOf(log.action).label }}</span>
                    <time class="tl__time" :datetime="log.created_at" :title="formatFull(log.created_at)">
                      {{ relText(log.created_at) }}
                    </time>
                  </p>
                  <p v-if="log.content" class="tl__content">{{ log.content }}</p>
                  <p v-if="deletedAgent(log)" class="tl__deleted">代理已删除</p>
                </div>
              </li>
            </ol>
            <div v-if="sheetLoading" class="sheet__foot">
              <LoadingDots text="加载中…" />
            </div>
            <button
              v-else-if="hasMore"
              class="tl__all pressable"
              type="button"
              @click="loadMore"
            >
              加载更多
            </button>
            <p v-else-if="sheetLogs.length" class="sheet__end">没有更多了</p>
          </div>
          <button class="sheet__cancel pressable" type="button" @click="sheetVisible = false">关闭</button>
        </div>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
.tl {
  display: flex;
  flex-direction: column;
}
.tl__state {
  padding: var(--sp-2) 0;
  font-size: var(--font-caption);
  color: var(--text-secondary);
}
.tl__state--error {
  color: var(--color-danger);
}
.tl__retry {
  margin-left: var(--sp-1);
  font-size: var(--font-caption);
  color: var(--color-primary);
}
.tl__list {
  display: flex;
  flex-direction: column;
}
.tl__item {
  position: relative;
  padding-left: 18px;
}
.tl__item + .tl__item {
  margin-top: 12px;
}
.tl__item::before {
  content: '';
  position: absolute;
  left: 5px;
  top: 0;
  bottom: 0;
  width: 1px;
  background: var(--color-timeline);
}
.tl__item:first-child::before {
  top: 7px;
}
.tl__item:last-child::before {
  bottom: calc(100% - 7px);
}
.tl__node {
  position: absolute;
  left: 2px;
  top: 4px;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--color-timeline);
  z-index: 1;
}
.tl__node--neutral {
  background: var(--color-timeline);
}
.tl__node--success {
  background: var(--color-success);
}
.tl__node--danger {
  background: var(--color-danger);
}
.tl__node--primary {
  background: var(--color-primary);
}
.tl__body {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.tl__head {
  display: flex;
  align-items: baseline;
  gap: var(--sp-2);
}
.tl__action {
  font-size: var(--font-caption);
  line-height: var(--font-caption-lh);
  font-weight: 600;
  color: var(--text-primary);
}
.tl__time {
  font-size: var(--font-caption);
  line-height: var(--font-caption-lh);
  color: var(--text-secondary);
}
.tl__content {
  font-size: var(--font-body-m);
  line-height: var(--font-body-m-lh);
  color: var(--text-primary);
  white-space: pre-wrap;
  word-break: break-word;
}
.tl__deleted {
  font-size: var(--font-caption);
  line-height: var(--font-caption-lh);
  color: var(--text-disabled);
}
.tl__all {
  margin-top: var(--sp-3);
  min-height: 44px;
  border-radius: var(--radius-control);
  border: 1px solid var(--border-color);
  background: var(--bg-card);
  font-size: var(--font-body-m);
  color: var(--text-primary);
}
.sheet {
  position: fixed;
  inset: 0;
  z-index: 200;
  display: flex;
  flex-direction: column;
  justify-content: flex-end;
}
.sheet__mask {
  position: absolute;
  inset: 0;
  background: rgba(26, 29, 38, 0.45);
}
.sheet__panel {
  position: relative;
  background: var(--bg-card);
  border-radius: 16px 16px 0 0;
  padding-bottom: var(--safe-bottom);
  height: 80vh;
  display: flex;
  flex-direction: column;
}
.sheet__handle {
  width: 36px;
  height: 4px;
  border-radius: 2px;
  background: var(--border-color);
  margin: var(--sp-2) auto 0;
  flex-shrink: 0;
}
.sheet__title {
  padding: var(--sp-3) var(--sp-4);
  font-size: var(--font-body-l);
  font-weight: 600;
  text-align: center;
  flex-shrink: 0;
}
.sheet__body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
  padding: var(--sp-3) var(--sp-4);
}
.sheet__foot {
  padding: var(--sp-3) 0;
  display: flex;
  justify-content: center;
}
.sheet__end {
  padding: var(--sp-3) 0;
  text-align: center;
  font-size: var(--font-caption);
  color: var(--text-disabled);
}
.sheet__cancel {
  min-height: 52px;
  flex-shrink: 0;
  border-top: 1px solid var(--border-color);
  font-size: var(--font-body-l);
  font-weight: 500;
  color: var(--text-primary);
}
.sheet-enter-active,
.sheet-leave-active {
  transition: opacity 220ms ease;
}
.sheet-enter-active .sheet__panel,
.sheet-leave-active .sheet__panel {
  transition: transform 220ms ease;
}
.sheet-enter-from,
.sheet-leave-to {
  opacity: 0;
}
.sheet-enter-from .sheet__panel,
.sheet-leave-to .sheet__panel {
  transform: translateY(100%);
}
</style>
