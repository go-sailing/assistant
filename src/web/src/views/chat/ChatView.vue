<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import * as convApi from '@/api/conversations'
import * as taskApi from '@/api/tasks'
import { restoreOccurrence } from '@/api/events'
import { errorText } from '@/api/client'
import type {
  CalendarEvent,
  ConfirmBlock,
  Conversation,
  EventScope,
  Occurrence,
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
import { useTaskSyncStore } from '@/stores/taskSync'
import { useEventSyncStore } from '@/stores/eventSync'
import { useToastStore } from '@/stores/toast'
import { formatDaySeparator } from '@/utils/time'

const route = useRoute()
const router = useRouter()
const toast = useToastStore()
const chat = useChatStore()
const taskSync = useTaskSyncStore()
const eventSync = useEventSyncStore()

const convId = computed(() => String(route.params.id))
const messages = computed(() => chat.messagesOf(convId.value))
const loading = computed(() => !!chat.loadingByConv[convId.value])
const loadError = computed(() => chat.errorByConv[convId.value] || '')
const streaming = computed(() => chat.isStreaming(convId.value))

const title = ref('对话')
const conversation = ref<Conversation | null>(null)
const scroller = ref<HTMLElement | null>(null)
const actionVisible = ref(false)
const renameVisible = ref(false)
const renameName = ref('')
const deleteVisible = ref(false)

const actionItems = [
  { label: '重命名会话', value: 'rename' },
  { label: '删除会话', value: 'delete', danger: true },
]

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

async function loadConversation(): Promise<void> {
  try {
    const list = await convApi.fetchConversations()
    const found = list.find((c) => String(c.id) === convId.value) || null
    conversation.value = found
    if (found) title.value = found.title
  } catch {
    // 标题获取失败不阻塞对话，使用默认标题
  }
}

onMounted(async () => {
  await Promise.all([loadConversation(), chat.loadHistory(convId.value)])
  await nextTick()
  // 从任务详情返回时恢复滚动位置，否则定位到最新消息
  const saved = chat.scrollTopOf(convId.value)
  const el = scroller.value
  if (el && saved > 0) el.scrollTop = saved
  else scrollToBottom()
})

onBeforeUnmount(() => {
  const el = scroller.value
  if (el) chat.saveScrollTop(convId.value, el.scrollTop)
})

watch(
  messages,
  () => {
    if (atBottom()) void nextTick(() => scrollToBottom())
  },
  { deep: true }
)

function onSend(text: string): void {
  void nextTick(() => scrollToBottom())
  void chat.send(convId.value, text)
}

function onRetry(message: Parameters<typeof chat.retrySend>[1]): void {
  chat.retrySend(convId.value, message)
}

function onDetail(task: Task): void {
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
  router.push(`/calendar/${event.id}?from=chat`)
}

function onEventTask(task: Task): void {
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

function onActionSelect(v: string): void {
  actionVisible.value = false
  if (v === 'rename') {
    renameName.value = title.value
    renameVisible.value = true
  } else if (v === 'delete') {
    deleteVisible.value = true
  }
}

async function submitRename(): Promise<void> {
  const name = renameName.value.trim()
  if (!name) return
  try {
    const updated = await convApi.renameConversation(convId.value, name)
    title.value = updated.title
    conversation.value = updated
    renameVisible.value = false
    toast.show('已重命名')
  } catch (e) {
    toast.show(errorText(e))
  }
}

async function confirmDelete(): Promise<void> {
  deleteVisible.value = false
  try {
    await convApi.deleteConversation(convId.value)
    chat.clearConversation(convId.value)
    toast.show('已删除会话')
    router.replace('/chat')
  } catch (e) {
    toast.show(errorText(e))
  }
}
</script>

<template>
  <div class="page chat">
    <header class="chat__head">
      <button class="chat__back pressable" aria-label="返回" @click="router.back()">‹</button>
      <h1 class="chat__title ellipsis">{{ title }}</h1>
      <button class="chat__more pressable" aria-label="会话操作" @click="actionVisible = true">
        <AppIcon name="more" :size="20" color="#1A1D26" />
      </button>
    </header>

    <div ref="scroller" class="page-body chat__body" role="log" aria-live="polite">
      <p v-if="loading" class="chat__loading">正在加载会话…</p>

      <StateError v-else-if="loadError" :text="loadError" @retry="chat.reloadHistory(convId)" />

      <div v-else-if="!messages.length" class="chat__guide">
        <p class="chat__guide-title">和助手说一句话试试</p>
        <p class="chat__guide-tip">例如：「明天下午 3 点提醒我交季度报告」</p>
        <p class="chat__guide-tip">也可以说：「把季度报告安排在明天 15:00–16:00 写」</p>
      </div>

      <template v-else>
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
            @retry="onRetry"
          />
        </template>
      </template>
    </div>

    <ChatInput :streaming="streaming" @send="onSend" />

    <AppActionSheet
      :visible="actionVisible"
      :items="actionItems"
      @select="onActionSelect"
      @cancel="actionVisible = false"
    />

    <AppModal
      :visible="renameVisible"
      title="重命名会话"
      confirm-text="保存"
      @confirm="submitRename"
      @cancel="renameVisible = false"
    >
      <input v-model="renameName" class="chat__rename" maxlength="100" aria-label="会话标题" />
    </AppModal>

    <AppModal
      :visible="deleteVisible"
      title="删除该会话？"
      text="会话中的所有消息将被删除，且不可恢复。"
      confirm-text="删除"
      danger
      @confirm="confirmDelete"
      @cancel="deleteVisible = false"
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
.chat__back {
  min-width: 44px;
  min-height: 44px;
  margin-left: -8px;
  font-size: 26px;
  color: var(--color-primary);
  text-align: left;
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
.chat__body {
  display: flex;
  flex-direction: column;
  gap: var(--sp-3);
  padding: var(--sp-4) var(--sp-4) var(--sp-6);
  background: var(--bg-page);
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
.chat__rename {
  width: 100%;
  margin-top: var(--sp-4);
  min-height: 44px;
  padding: 0 var(--sp-3);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-control);
  outline: none;
  font-size: var(--font-body-m);
}
.chat__rename:focus {
  border-color: var(--color-primary);
}
</style>