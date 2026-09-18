<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import * as convApi from '@/api/conversations'
import * as taskApi from '@/api/tasks'
import { restoreOccurrence } from '@/api/events'
import { errorText } from '@/api/client'
import type {
  CalendarEvent,
  ConfirmBlock,
  EventScope,
  Occurrence,
  ProposalBlock,
  ScopeBlock,
  Task,
} from '@/types'
import AppActionSheet from '@/components/AppActionSheet.vue'
import AppModal from '@/components/AppModal.vue'
import AppIcon from '@/components/AppIcon.vue'
import StateError from '@/components/StateError.vue'
import ChatInput from '@/components/chat/ChatInput.vue'
import MessageItem from '@/components/chat/MessageItem.vue'
import { useChatStore } from '@/stores/chat'
import { useConversationStore } from '@/stores/conversation'
import { useDrawerStore } from '@/stores/drawer'
import { useTaskSyncStore } from '@/stores/taskSync'
import { useEventSyncStore } from '@/stores/eventSync'
import { useToastStore } from '@/stores/toast'
import { formatDaySeparator } from '@/utils/time'

const router = useRouter()
const toast = useToastStore()
const chat = useChatStore()
const conversation = useConversationStore()
const drawer = useDrawerStore()
const taskSync = useTaskSyncStore()
const eventSync = useEventSyncStore()

/** v0.3.0：每用户唯一会话；URL 始终是 /chat，会话 id 由自举获得 */
const convId = computed(() => (conversation.conversationId ? String(conversation.conversationId) : ''))
const messages = computed(() => (convId.value ? chat.messagesOf(convId.value) : []))
const streaming = computed(() => !!convId.value && chat.isStreaming(convId.value))

const booting = ref(true)
const bootError = ref('')
const loadError = computed(() => bootError.value || (convId.value ? chat.errorByConv[convId.value] || '' : ''))
const loading = computed(() => booting.value || (!!convId.value && !!chat.loadingByConv[convId.value]))

const scroller = ref<HTMLElement | null>(null)
/** 消息内容容器：仅用于观测高度（异步卡片刷新会继续撑高它） */
const flow = ref<HTMLElement | null>(null)
/** 「↓ 新消息」胶囊：仅在上翻且有新内容时出现 */
const showNewMessages = ref(false)
/** 「调整一下」的临时输入占位引导 */
const adjustHint = ref('')
const inputRef = ref<InstanceType<typeof ChatInput> | null>(null)
const moreVisible = ref(false)
const clearVisible = ref(false)
const clearing = ref(false)

const ADJUST_HINT = '把要改的地方告诉我，如：改成 16 点、要每周重复'

/** 锚定用：内容高度观测器与释放定时器 */
let anchorObserver: ResizeObserver | null = null
let anchorTimer = 0

const moreItems = [{ label: '清除聊天记录', value: 'clear', danger: true }]

function sameDay(a: string, b: string): boolean {
  const d1 = new Date(a)
  const d2 = new Date(b)
  return (
    d1.getFullYear() === d2.getFullYear() &&
    d1.getMonth() === d2.getMonth() &&
    d1.getDate() === d2.getDate()
  )
}

/** 跨天插入时间分隔条 */
const rendered = computed(() =>
  messages.value.map((m, i) => ({
    msg: m,
    showDay: i === 0 || !sameDay(m.created_at, messages.value[i - 1].created_at),
  }))
)

function atBottom(): boolean {
  const el = scroller.value
  if (!el) return true
  return el.scrollHeight - el.scrollTop - el.clientHeight < 120
}

function scrollToBottom(smooth = false): void {
  const el = scroller.value
  if (!el) return
  el.scrollTo({ top: el.scrollHeight, behavior: smooth ? 'smooth' : 'auto' })
}

/* ---------------- v0.4.0 定位修复（UXUI 7.6 / PRD 9.2） ---------------- */

/** 释放高度观测，避免后续内容变化继续强制贴底 */
function releaseAnchor(): void {
  anchorObserver?.disconnect()
  anchorObserver = null
  if (anchorTimer) {
    window.clearTimeout(anchorTimer)
    anchorTimer = 0
  }
}

/**
 * 冷启动/每次进入：数据渲染 → nextTick → 双 rAF → 滚到底；
 * 随后观测内容高度，异步卡片刷新把容器撑高时继续贴底，
 * 高度 500ms 内不再变化即释放（避免长期劫持滚动）。
 */
function anchorLatest(): void {
  releaseAnchor()
  void nextTick(() => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        scrollToBottom()
        const target = flow.value
        if (!target || typeof ResizeObserver === 'undefined') return
        const ro = new ResizeObserver(() => {
          scrollToBottom()
          if (anchorTimer) window.clearTimeout(anchorTimer)
          anchorTimer = window.setTimeout(releaseAnchor, 500)
        })
        ro.observe(target)
        anchorObserver = ro
      })
    })
  })
}

/** 锚定空态引导位（清除记录后）：无异常滚动条 */
function anchorGuide(): void {
  releaseAnchor()
  showNewMessages.value = false
  void nextTick(() => {
    if (scroller.value) scroller.value.scrollTop = 0
  })
}

/** 用户上翻后点胶囊：平滑滚到底并隐藏 */
function jumpToLatest(): void {
  showNewMessages.value = false
  scrollToBottom(true)
}

/** 滚回底部即隐藏胶囊（用户已在底部时永不显示） */
function onScroll(): void {
  if (atBottom()) showNewMessages.value = false
}

/** 内容指纹：仅「真的来了新内容」才触发跟随/胶囊（避免卡片内勾选等无关变更误触发） */
let lastSig = ''
function contentSignature(): string {
  const list = messages.value
  const last = list[list.length - 1]
  return `${list.length}|${last ? last.id : ''}|${last ? last.content.length : 0}|${last ? last.blocks.length : 0}`
}

/**
 * 会话自举（SDD 3.5.1）：取唯一会话 id（幂等）→ 拉历史。
 * 本地缓存的 id 与服务端不一致（清库/换环境）时丢弃旧缓存消息，避免展示他人轮次或陈旧数据。
 */
async function bootstrap(force = false): Promise<void> {
  booting.value = true
  bootError.value = ''
  const staleId = conversation.conversationId
  try {
    const id = await conversation.ensureConversationId()
    if (staleId && staleId !== id) chat.clearHistory(staleId)
    if (force) await chat.reloadHistory(id)
    else await chat.loadHistory(id)
    await nextTick()
    // 仅「页内跳详情再返回」恢复阅读位置；冷启动/F5/抽屉/FAB 进入一律锚定最新
    const restore = chat.consumeDetailReturn(id)
    const saved = chat.scrollTopOf(id)
    const el = scroller.value
    if (restore && el && saved > 0) {
      releaseAnchor()
      el.scrollTop = saved
    } else {
      anchorLatest()
    }
    lastSig = contentSignature()
  } catch (e) {
    bootError.value = errorText(e)
  } finally {
    booting.value = false
  }
}

onMounted(() => {
  void bootstrap()
})

onBeforeUnmount(() => {
  releaseAnchor()
  const el = scroller.value
  if (el && convId.value) chat.saveScrollTop(convId.value, el.scrollTop)
})

watch(
  messages,
  () => {
    // 无关变更（如卡片内勾选）不改变指纹，不触发跟随与胶囊
    const sig = contentSignature()
    if (sig === lastSig) return
    lastSig = sig
    if (atBottom()) {
      showNewMessages.value = false
      void nextTick(() => scrollToBottom())
    } else {
      showNewMessages.value = true
    }
  },
  { deep: true }
)

function onSend(text: string): void {
  if (!convId.value) return
  adjustHint.value = ''
  showNewMessages.value = false
  void nextTick(() => scrollToBottom())
  void chat.send(convId.value, text)
}

function onRetry(message: Parameters<typeof chat.retrySend>[1]): void {
  if (!convId.value) return
  chat.retrySend(convId.value, message)
}

/** 页内跳详情：记录离开时刻，返回时（5 分钟内）恢复阅读位置 */
function markDetailNav(): void {
  if (convId.value) chat.markDetailNavigation(convId.value)
}

function onDetail(task: Task): void {
  markDetailNav()
  router.push(`/tasks/${task.id}?from=chat`)
}

/** 卡片勾选完成：以云端返回的最新任务数据刷新卡片 */
async function onToggle(task: Task): Promise<void> {
  try {
    const updated =
      task.status === 'completed'
        ? await taskApi.uncompleteTask(task.id)
        : await taskApi.completeTask(task.id)
    updateTaskEverywhere(task.id, updated)
    taskSync.markDirty()
  } catch (e) {
    toast.show(errorText(e))
  }
}

function updateTaskEverywhere(id: Task['id'], updated: Task): void {
  messages.value.forEach((m) => {
    m.blocks.forEach((b) => {
      if (b.type === 'cards') {
        const i = b.tasks.findIndex((t) => String(t.id) === String(id))
        if (i >= 0) b.tasks[i] = updated
      } else if (b.type === 'clarify') {
        const i = b.candidates.findIndex((t) => String(t.id) === String(id))
        if (i >= 0) b.candidates[i] = updated
      } else if (b.type === 'confirm') {
        const i = b.affected.findIndex((t) => String(t.id) === String(id))
        if (i >= 0) b.affected[i] = updated
      }
    })
  })
}

function onPick(msg: (typeof messages.value)[number], blockIndex: number, task: Task): void {
  chat.pickCandidate(convId.value, msg, blockIndex, task)
}

function onEventDetail(event: CalendarEvent): void {
  markDetailNav()
  router.push(`/calendar/${event.id}?from=chat`)
}

function onEventTask(task: Task): void {
  markDetailNav()
  router.push(`/tasks/${task.id}?from=chat`)
}

/** 日程卡片勾选 = 完成关联任务（写任务状态，日程本身无完成态） */
async function onEventToggle(event: CalendarEvent): Promise<void> {
  const task = event.task
  if (!task) return
  try {
    const updated =
      task.status === 'completed'
        ? await taskApi.uncompleteTask(task.id)
        : await taskApi.completeTask(task.id)
    updateEventTaskEverywhere(task.id, updated)
    taskSync.markDirty()
    eventSync.markDirty()
  } catch (e) {
    toast.show(errorText(e))
  }
}

/** 任务完成态变化后刷新所有日程卡片内嵌的任务摘要 */
function updateEventTaskEverywhere(id: Task['id'], updated: Task): void {
  const patch = (ev: CalendarEvent): void => {
    if (ev.task && String(ev.task.id) === String(id)) {
      ev.task = {
        ...ev.task,
        title: updated.title,
        status: updated.status,
        priority: updated.priority,
        due_at: updated.due_at,
        completed_at: updated.completed_at,
      }
    }
  }
  messages.value.forEach((m) => {
    m.blocks.forEach((b) => {
      if (b.type === 'cards') (b.events ?? []).forEach(patch)
      else if (b.type === 'clarify') (b.events ?? []).forEach(patch)
      else if (b.type === 'confirm') (b.affected_events ?? []).forEach(patch)
    })
  })
}

function onEventPick(
  msg: (typeof messages.value)[number],
  blockIndex: number,
  event: CalendarEvent
): void {
  chat.pickEventCandidate(convId.value, msg, blockIndex, event)
}

/** 作用域澄清点选：折叠本块并把结构化选择回传助手，由模型重新调用工具 */
function onScopePick(
  msg: (typeof messages.value)[number],
  blockIndex: number,
  block: ScopeBlock,
  scope: EventScope
): void {
  chat.pickScope(convId.value, msg, blockIndex, block, scope)
}

/** 恢复本次安排：直接调接口（非危险操作），并用云端返回的实例刷新卡片 */
async function onOccurrenceRestore(occ: Occurrence): Promise<void> {
  try {
    const updated = await restoreOccurrence(occ.series_id ?? occ.id, occ.occurrence_key)
    if (updated) updateOccurrenceEverywhere(updated)
    eventSync.markDirty()
    toast.show('已恢复本次安排')
  } catch (e) {
    toast.show(errorText(e))
  }
}

/** 恢复后刷新所有消息中的同一次实例卡片（系列 id + occurrence_key 唯一定位） */
function updateOccurrenceEverywhere(updated: Occurrence): void {
  messages.value.forEach((m) => {
    m.blocks.forEach((b) => {
      if (b.type !== 'cards') return
      ;(b.occurrences ?? []).forEach((o) => {
        if (
          String(o.series_id) === String(updated.series_id) &&
          o.occurrence_key === updated.occurrence_key
        ) {
          Object.assign(o, updated)
        }
      })
    })
  })
}

/** 「仍要安排」把决定交回助手，由模型带 confirm_conflict=true 重新调用工具 */
function onConflictForce(): void {
  chat.conflictForce(convId.value)
}

function onConflictChange(): void {
  chat.conflictChange(convId.value)
  toast.show('告诉我新的时间就可以')
}

function onConfirm(msg: (typeof messages.value)[number], block: ConfirmBlock): void {
  void chat.confirmAction(convId.value, msg, block)
}

function onCancel(msg: (typeof messages.value)[number], block: ConfirmBlock): void {
  void chat.cancelAction(convId.value, msg, block)
}

/** 方案卡「就这么办」：置执行中并发送固定文本的普通用户消息（不发结构化字段） */
function onProposalAdopt(block: ProposalBlock): void {
  if (!convId.value) return
  adjustHint.value = ''
  chat.adoptProposal(convId.value, block)
}

/** 方案卡「调整一下」：不发任何请求，仅聚焦输入框并临时替换占位引导文案 */
function onProposalAdjust(): void {
  adjustHint.value = ADJUST_HINT
  void nextTick(() => inputRef.value?.focus())
}

/** 流式进行中禁用入口，避免与清除产生并发（不主动断连，SDD 3.5.3） */
function openMore(): void {
  if (streaming.value) return
  moreVisible.value = true
}

function onMoreSelect(v: string): void {
  moreVisible.value = false
  if (v === 'clear') clearVisible.value = true
}

/** 清除聊天记录：会话保留，只删消息与待确认动作；输入框草稿保留 */
async function confirmClear(): Promise<void> {
  const id = convId.value
  if (!id) return
  clearing.value = true
  try {
    await convApi.clearConversation(id)
    chat.clearHistory(id)
    clearVisible.value = false
    adjustHint.value = ''
    // 清除后锚定空态引导位
    anchorGuide()
    toast.show('聊天记录已清除')
  } catch (e) {
    toast.show(errorText(e))
  } finally {
    clearing.value = false
  }
}
</script>

<template>
  <div class="page chat">
    <header class="chat__head">
      <button
        class="chat__menu pressable"
        aria-label="打开菜单"
        @click="drawer.openDrawer('hamburger')"
      >
        <AppIcon name="list" :size="22" />
      </button>
      <h1 class="chat__title">助手</h1>
      <button
        class="chat__more pressable"
        aria-label="更多"
        :disabled="streaming"
        @click="openMore"
      >
        <AppIcon name="more" :size="20" color="#1A1D26" />
      </button>
    </header>

    <div class="chat__main">
      <div
        ref="scroller"
        class="page-body chat__body"
        role="log"
        aria-live="polite"
        @scroll.passive="onScroll"
      >
        <p v-if="loading" class="chat__loading">正在加载…</p>

        <StateError v-else-if="loadError" :text="loadError" @retry="bootstrap(true)" />

        <div v-else-if="!messages.length" class="chat__guide">
          <p class="chat__guide-title">和助手说一句话试试</p>
          <p class="chat__guide-tip">例如：「明天下午 3 点提醒我交季度报告」</p>
          <p class="chat__guide-tip">也可以说：「把季度报告安排在明天 15:00–16:00 写」</p>
        </div>

        <div v-else ref="flow" class="chat__flow">
          <template v-for="(item, i) in rendered" :key="i">
            <p v-if="item.showDay" class="chat__day">{{ formatDaySeparator(item.msg.created_at) }}</p>
            <MessageItem
              :message="item.msg"
              @detail="onDetail"
              @toggle="onToggle"
              @pick="onPick"
              @event-detail="onEventDetail"
              @event-task="onEventTask"
              @event-toggle="onEventToggle"
              @event-pick="onEventPick"
              @occurrence-restore="onOccurrenceRestore"
              @scope-pick="onScopePick"
              @conflict-change="onConflictChange"
              @conflict-force="onConflictForce"
              @confirm="onConfirm(item.msg, $event)"
              @cancel="onCancel(item.msg, $event)"
              @proposal-adopt="onProposalAdopt"
              @proposal-adjust="onProposalAdjust"
              @retry="onRetry"
            />
          </template>
        </div>
      </div>

      <!-- 上翻阅读时新消息到达：轻量悬浮提示，点击平滑滚到底 -->
      <button
        v-if="showNewMessages"
        class="chat__new pressable"
        type="button"
        aria-label="有新消息，跳到最新"
        @click="jumpToLatest"
      >
        <AppIcon name="chevron-down" :size="14" color="var(--color-primary)" />
        新消息
      </button>
    </div>

    <ChatInput
      ref="inputRef"
      :streaming="streaming"
      :placeholder="adjustHint || '输入消息…'"
      @send="onSend"
    />

    <AppActionSheet
      :visible="moreVisible"
      :items="moreItems"
      @select="onMoreSelect"
      @cancel="moreVisible = false"
    />

    <AppModal
      :visible="clearVisible"
      title="清除聊天记录？"
      text="将永久清除与助手的全部聊天记录，且不可恢复。任务与日程数据不会被删除。"
      confirm-text="清除"
      danger
      :loading="clearing"
      @confirm="confirmClear"
      @cancel="clearVisible = false"
    />
  </div>
</template>

<style scoped>
.chat {
  height: 100%;
}
.chat__head {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  height: calc(var(--navbar-height) + var(--safe-top));
  padding: var(--safe-top) var(--sp-4) 0;
  background: var(--bg-card);
  border-bottom: 1px solid var(--border-color);
  flex-shrink: 0;
}
.chat__menu {
  display: flex;
  align-items: center;
  justify-content: center;
  min-width: 44px;
  min-height: 44px;
  margin-left: -12px;
  color: var(--text-primary);
}
.chat__title {
  flex: 1;
  text-align: center;
  font-size: var(--font-heading-m);
  font-weight: 600;
}
.chat__more {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 44px;
  height: 44px;
  margin-right: -10px;
}
.chat__more:disabled {
  opacity: 0.4;
}
.chat__main {
  position: relative;
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
.chat__body {
  display: flex;
  flex-direction: column;
  gap: var(--sp-3);
  padding: var(--sp-4) var(--sp-4) var(--sp-6);
  background: var(--bg-page);
}
/* 消息内容容器：仅作为高度观测目标（异步卡片刷新会继续撑高它） */
.chat__flow {
  display: flex;
  flex-direction: column;
  gap: var(--sp-3);
}
/* 新消息胶囊：高 32pt、左右 14pt、圆角 16，阴影同 FAB 档 */
.chat__new {
  position: absolute;
  left: 50%;
  bottom: 14px;
  transform: translateX(-50%);
  display: inline-flex;
  align-items: center;
  gap: 2px;
  height: 32px;
  padding: 0 14px;
  border-radius: 16px;
  background: var(--bg-card);
  box-shadow: 0 4px 12px rgba(26, 29, 38, 0.16);
  font-size: var(--font-caption);
  line-height: var(--font-caption-lh);
  font-weight: 500;
  color: var(--color-primary);
  white-space: nowrap;
}
.chat__day {
  align-self: center;
  font-size: var(--font-caption);
  color: var(--text-secondary);
  padding: 2px 0;
}
.chat__loading {
  text-align: center;
  padding: var(--sp-6);
  font-size: var(--font-body-m);
  color: var(--text-secondary);
}
.chat__guide {
  padding: var(--sp-8) var(--sp-6);
  text-align: center;
}
.chat__guide-title {
  font-size: var(--font-body-l);
  font-weight: 600;
}
.chat__guide-tip {
  margin-top: var(--sp-2);
  font-size: var(--font-body-m);
  color: var(--text-secondary);
}
</style>