import { reactive, ref } from 'vue'
import { defineStore } from 'pinia'
import { streamChat, confirmPendingAction, cancelPendingAction, fetchMessages } from '@/api/conversations'
import { errorText } from '@/api/client'
import type {
  CalendarEvent,
  ChatMessage,
  ConflictBlock,
  ConflictDateGroup,
  ConfirmBlock,
  ErrorBlock,
  EventConflictBrief,
  EventScope,
  MessageBlock,
  Occurrence,
  ProposalBlock,
  RawMessage,
  ScopeBlock,
  SeriesDetail,
  SubtaskGroup,
  Task,
} from '@/types'
import { useToastStore } from './toast'
import { useTaskSyncStore } from './taskSync'
import { useEventSyncStore } from './eventSync'

/** 生成幂等键（重发沿用同一个，服务端据此去重） */
export function genClientMsgId(): string {
  return `c-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

/** 作用域选项文案（澄清块按钮与结构化回传共用同一文案，与 UX 6.3 文案表一致） */
export function scopeLabel(scope: EventScope): string {
  if (scope === 'this') return '仅本次'
  if (scope === 'following') return '本次及以后'
  return '整条系列'
}

function isScope(v: unknown): v is EventScope {
  return v === 'this' || v === 'following' || v === 'series'
}

/** 云端消息 → 渲染消息（历史与实时共用同一套 blocks 渲染） */
function toChatMessage(raw: RawMessage): ChatMessage {
  const blocks: MessageBlock[] = []
  if (raw.payload && Array.isArray(raw.payload.blocks)) {
    blocks.push(...raw.payload.blocks)
  } else if (raw.content) {
    blocks.push({ type: 'text', text: raw.content })
  }
  const msg: ChatMessage = {
    id: String(raw.id),
    role: raw.role === 'user' ? 'user' : 'assistant',
    content: raw.content || '',
    blocks,
    created_at: raw.created_at,
    sendStatus: 'sent',
    streaming: false,
  }
  // 历史确认条已无法再确认，标记为失效态（只读）
  const states: Record<string, 'stale'> = {}
  blocks.forEach((b) => {
    if (b.type === 'confirm') states[b.pending_action_id] = 'stale'
  })
  if (Object.keys(states).length) msg.pendingState = states
  return msg
}

export const useChatStore = defineStore('chat', () => {
  const toast = useToastStore()
  const taskSync = useTaskSyncStore()
  const eventSync = useEventSyncStore()

  const messagesByConv = ref<Record<string, ChatMessage[]>>({})
  const loadingByConv = ref<Record<string, boolean>>({})
  const errorByConv = ref<Record<string, string>>({})
  const streamingByConv = ref<Record<string, boolean>>({})
  const scrollTopByConv = ref<Record<string, number>>({})
  /**
   * v0.5.0：本轮是否正在自动压缩（SSE 瞬态 status 事件）。
   * 仅内存态：不持久化、断线重连与刷新后不补显（服务端同样不持久化）。
   */
  const compactingByConv = ref<Record<string, boolean>>({})
  /**
   * v0.4.0：从聊天页内跳详情的时间戳（纯内存，不持久化）。
   * 仅用于区分「页内跳详情再返回」（恢复阅读位置）与冷启动/F5/抽屉进入（锚定最新）。
   */
  const detailNavByConv = ref<Record<string, number>>({})

  /** 阅读位置恢复有效期：5 分钟 */
  const DETAIL_RETURN_WINDOW = 5 * 60 * 1000

  const keyOf = (id: string | number): string => String(id)

  function messagesOf(convId: string | number): ChatMessage[] {
    return messagesByConv.value[keyOf(convId)] || []
  }

  function appendMessage(convId: string | number, msg: ChatMessage): void {
    const k = keyOf(convId)
    if (!messagesByConv.value[k]) messagesByConv.value[k] = []
    messagesByConv.value[k].push(msg)
  }

  function isStreaming(convId: string | number): boolean {
    return !!streamingByConv.value[keyOf(convId)]
  }

  /** v0.5.0：本轮是否正处于「回顾之前的对话」压缩态 */
  function isCompacting(convId: string | number): boolean {
    return !!compactingByConv.value[keyOf(convId)]
  }

  function setCompacting(convId: string | number, value: boolean): void {
    compactingByConv.value = { ...compactingByConv.value, [keyOf(convId)]: value }
  }

  function saveScrollTop(convId: string | number, top: number): void {
    scrollTopByConv.value[keyOf(convId)] = top
  }

  function scrollTopOf(convId: string | number): number {
    return scrollTopByConv.value[keyOf(convId)] || 0
  }

  /** 记录「从聊天页跳详情」：返回时据此恢复阅读位置 */
  function markDetailNavigation(convId: string | number): void {
    detailNavByConv.value = { ...detailNavByConv.value, [keyOf(convId)]: Date.now() }
  }

  /**
   * 消费一次「页内跳详情」标记：命中且未超时才恢复 scrollTop，
   * 否则（冷启动/刷新/抽屉/FAB 进入）返回 false 由页面锚定最新消息。
   */
  function consumeDetailReturn(convId: string | number): boolean {
    const k = keyOf(convId)
    const at = detailNavByConv.value[k]
    if (!at) return false
    const next = { ...detailNavByConv.value }
    delete next[k]
    detailNavByConv.value = next
    return Date.now() - at <= DETAIL_RETURN_WINDOW
  }

  /* ---------------- v0.4.0 方案卡（对话层确认，状态仅存前端） ---------------- */

  /** 同一会话中仍在 pending 的旧方案卡：新方案出现即置为「已更新方案」 */
  function supersedePendingProposals(convId: string | number): void {
    const list = messagesByConv.value[keyOf(convId)] || []
    list.forEach((m) => {
      m.blocks.forEach((b) => {
        if (b.type === 'proposal' && b.status === 'pending') b.status = 'superseded'
      })
    })
  }

  /** 本轮结束（done）：仍在执行中的方案卡置为已完成（折叠摘要） */
  function settleExecutingProposals(convId: string | number): void {
    const list = messagesByConv.value[keyOf(convId)] || []
    list.forEach((m) => {
      m.blocks.forEach((b) => {
        if (b.type === 'proposal' && b.status === 'executing') b.status = 'done'
      })
    })
  }

  /**
   * 「就这么办」：本地置执行中，随后发送一条普通用户消息（文本固定），
   * 由模型在下一轮按方案参数调用真实工具（不发送 proposal_id 等结构化字段）。
   */
  function adoptProposal(convId: string | number, block: ProposalBlock): void {
    if (streamingByConv.value[keyOf(convId)]) return
    if (block.status !== 'pending') return
    block.status = 'executing'
    void send(convId, '就这么办')
  }

  /** 拉取历史消息；失败展示错误态，不使用任何缓存数据 */
  async function loadHistory(convId: string | number): Promise<void> {
    const k = keyOf(convId)
    if (messagesByConv.value[k] && messagesByConv.value[k].length) return
    loadingByConv.value[k] = true
    errorByConv.value[k] = ''
    try {
      const res = await fetchMessages(convId, 1, 50)
      messagesByConv.value[k] = (res.list || []).map(toChatMessage)
    } catch (e) {
      errorByConv.value[k] = errorText(e)
    } finally {
      loadingByConv.value[k] = false
    }
  }

  /** 重新拉取历史（错误态重试用） */
  async function reloadHistory(convId: string | number): Promise<void> {
    messagesByConv.value[keyOf(convId)] = []
    await loadHistory(convId)
  }

  /**
   * 发送消息并消费 SSE 流。
   * 流式期间禁止并发发送；重发沿用原 client_msg_id 保证幂等。
   */
  async function send(
    convId: string | number,
    content: string,
    clientMsgId?: string,
    existingUser?: ChatMessage
  ): Promise<void> {
    const k = keyOf(convId)
    if (streamingByConv.value[k]) {
      toast.show('助手正在处理，请稍候')
      return
    }
    const text = content.trim()
    if (!text) return
    const cid = clientMsgId || genClientMsgId()

    let userMsg = existingUser
    if (!userMsg) {
      // 注意：存入响应式数组后仍要就地修改该消息，必须用 reactive 包装，
      // 否则后续 sendStatus/thinking/blocks 的修改不会触发视图更新。
      userMsg = reactive<ChatMessage>({
        id: `local-u-${cid}`,
        role: 'user',
        content: text,
        blocks: [{ type: 'text', text }],
        created_at: new Date().toISOString(),
        sendStatus: 'sending',
        clientMsgId: cid,
      })
      appendMessage(convId, userMsg)
    } else {
      userMsg.sendStatus = 'sending'
    }

    streamingByConv.value[k] = true
    let assistant: ChatMessage | null = null

    const ensureAssistant = (): ChatMessage => {
      if (!assistant) {
        assistant = reactive<ChatMessage>({
          id: `local-a-${cid}`,
          role: 'assistant',
          content: '',
          blocks: [],
          created_at: new Date().toISOString(),
          streaming: true,
          clientMsgId: cid,
          thinking: true,
        })
        appendMessage(convId, assistant)
      }
      return assistant
    }

    try {
      await streamChat(convId, text, cid, (event, data) => {
        const msg = ensureAssistant()
        // v0.5.0：首个内容类事件（文本/卡片/交互块）到达即收起压缩状态条
        if (event !== 'meta' && event !== 'status') setCompacting(convId, false)
        switch (event) {
          case 'meta': {
            if (data.message_id !== undefined && data.message_id !== null) {
              msg.id = `m-${String(data.message_id)}`
            }
            break
          }
          case 'status': {
            // v0.5.0：压缩临时状态（仅本轮有效，随首个内容事件淡出）
            if (data.stage === 'compacting') setCompacting(convId, true)
            break
          }
          case 'text_delta': {
            const delta = typeof data.delta === 'string' ? data.delta : ''
            if (!delta) break
            msg.thinking = false
            const last = msg.blocks[msg.blocks.length - 1]
            if (last && last.type === 'text') last.text += delta
            else msg.blocks.push({ type: 'text', text: delta })
            msg.content += delta
            break
          }
          case 'tool_call': {
            // 工具执行中：保持「正在处理…」，不提前展示结果
            msg.thinking = true
            break
          }
          case 'cards': {
            msg.thinking = false
            const tasks = Array.isArray(data.tasks) ? (data.tasks as Task[]) : []
            const events = Array.isArray(data.events) ? (data.events as CalendarEvent[]) : []
            const series = Array.isArray(data.series) ? (data.series as SeriesDetail[]) : []
            const occurrences = Array.isArray(data.occurrences)
              ? (data.occurrences as Occurrence[])
              : []
            const subtaskGroups = Array.isArray(data.subtask_groups)
              ? (data.subtask_groups as SubtaskGroup[])
              : []
            if (
              tasks.length ||
              events.length ||
              series.length ||
              occurrences.length ||
              subtaskGroups.length
            ) {
              msg.blocks.push({
                type: 'cards',
                tasks,
                events,
                series,
                occurrences,
                subtask_groups: subtaskGroups,
              })
            }
            taskSync.markDirty()
            // 卡片出现即说明日程可能发生变化，日历 Tab 需重拉
            eventSync.markDirty()
            break
          }
          case 'proposal': {
            // v0.4.0 方案卡：参数由服务端结构化下发；状态仅前端本地维护
            msg.thinking = false
            // 新方案出现即把同会话中仍在 pending 的旧卡置为「已更新方案」
            supersedePendingProposals(convId)
            const params = (Array.isArray(data.params) ? data.params : [])
              .filter((p): p is { label?: unknown; value?: unknown; defaulted?: unknown } => !!p && typeof p === 'object')
              .map((p) => ({
                label: String(p.label ?? ''),
                value: String(p.value ?? ''),
                defaulted: p.defaulted === true,
              }))
            const block: ProposalBlock = {
              type: 'proposal',
              proposal_id: String(data.proposal_id ?? ''),
              title: typeof data.title === 'string' ? data.title : '',
              params,
              note: typeof data.note === 'string' && data.note ? data.note : undefined,
              status: 'pending',
            }
            msg.blocks.push(block)
            break
          }
          case 'clarify': {
            msg.thinking = false
            const candidates = Array.isArray(data.candidates) ? (data.candidates as Task[]) : []
            const events = Array.isArray(data.events) ? (data.events as CalendarEvent[]) : []
            msg.blocks.push({
              type: 'clarify',
              question: typeof data.question === 'string' ? data.question : '',
              kind: data.kind === 'event' ? 'event' : 'task',
              candidates,
              events,
            })
            break
          }
          case 'scope': {
            // 循环实例写操作的作用域澄清块：点选后由 pickScope 作为下一条结构化消息回传
            msg.thinking = false
            const ref = (data.ref && typeof data.ref === 'object' ? data.ref : {}) as {
              series_id?: unknown
              occurrence_key?: unknown
            }
            const block: ScopeBlock = {
              type: 'scope',
              tool: data.tool === 'delete_event' ? 'delete_event' : 'update_event',
              question: typeof data.question === 'string' ? data.question : '',
              options: (Array.isArray(data.options) ? data.options : []).filter(isScope),
              ref: {
                series_id: Number(ref.series_id ?? 0),
                occurrence_key:
                  typeof ref.occurrence_key === 'string' && ref.occurrence_key
                    ? ref.occurrence_key
                    : null,
              },
              recommended: isScope(data.recommended) ? data.recommended : 'this',
            }
            msg.blocks.push(block)
            break
          }
          case 'conflict': {
            msg.thinking = false
            const block: ConflictBlock = {
              type: 'conflict',
              tool: typeof data.tool === 'string' ? data.tool : '',
              conflicts: Array.isArray(data.conflicts)
                ? (data.conflicts as EventConflictBrief[])
                : [],
              conflict_level:
                data.conflict_level === 'all_day'
                  ? 'all_day'
                  : data.conflict_level === 'none'
                    ? 'none'
                    : 'overlap',
              message: typeof data.message === 'string' ? data.message : undefined,
              // v0.2.0：循环冲突按日期分组（服务端已取前 5 组，其余以计数呈现）
              conflict_dates: Array.isArray(data.conflict_dates)
                ? (data.conflict_dates as ConflictDateGroup[])
                : [],
              conflict_dates_total:
                typeof data.conflict_dates_total === 'number'
                  ? data.conflict_dates_total
                  : undefined,
              conflict_total:
                typeof data.conflict_total === 'number' ? data.conflict_total : undefined,
            }
            msg.blocks.push(block)
            break
          }
          case 'confirm': {
            // action 为字符串透传（含 v0.2.0 的 delete_event_series / complete_task_cascade），
            // 文案与危险级别差异在 ConfirmBar 内按 action 处理
            msg.thinking = false
            const block: ConfirmBlock = {
              type: 'confirm',
              pending_action_id: String(data.pending_action_id ?? ''),
              action: String(data.action ?? ''),
              affected: Array.isArray(data.affected) ? (data.affected as Task[]) : [],
              affected_events: Array.isArray(data.affected_events)
                ? (data.affected_events as CalendarEvent[])
                : [],
              count: typeof data.count === 'number' ? data.count : 0,
              description: typeof data.description === 'string' ? data.description : undefined,
            }
            msg.blocks.push(block)
            msg.pendingState = { ...(msg.pendingState || {}), [block.pending_action_id]: 'pending' }
            break
          }
          case 'error': {
            const block: ErrorBlock = {
              type: 'error',
              message: typeof data.message === 'string' ? data.message : '助手暂时不可用，请稍后重试',
              retryable: data.retryable !== false,
            }
            msg.blocks.push(block)
            msg.thinking = false
            break
          }
          case 'done': {
            msg.streaming = false
            msg.thinking = false
            // 结果卡片已接续（或本轮已结束）：执行中的方案卡置为已完成
            settleExecutingProposals(convId)
            break
          }
          default:
            break
        }
      })
      userMsg.sendStatus = 'sent'
    } catch (e) {
      userMsg.sendStatus = 'failed'
      if (assistant) {
        const m: ChatMessage = assistant
        m.streaming = false
        m.thinking = false
      }
      void e
    } finally {
      streamingByConv.value[k] = false
      setCompacting(convId, false)
      if (assistant) {
        const m: ChatMessage = assistant
        m.streaming = false
        m.thinking = false
        // 助手侧未产生任何内容且非错误态时，给出兜底提示，避免空气泡
        if (!m.blocks.length && userMsg.sendStatus !== 'failed') {
          m.blocks.push({
            type: 'error',
            message: '助手暂时不可用，请稍后重试',
            retryable: true,
          } as ErrorBlock)
        }
      }
    }
  }

  /** 发送失败重发：去掉错误助手消息，用原幂等键重新发起 */
  function retrySend(convId: string | number, errorOrUser: ChatMessage): void {
    const k = keyOf(convId)
    const list = messagesByConv.value[k] || []
    const cid = errorOrUser.clientMsgId
    if (!cid) return
    const userMsg = list.find((m) => m.role === 'user' && m.clientMsgId === cid)
    if (!userMsg) return
    if (errorOrUser.role === 'assistant') {
      messagesByConv.value[k] = list.filter((m) => m !== errorOrUser)
    }
    void send(convId, userMsg.content, cid, userMsg)
  }

  /** 确认执行待确认动作 */
  async function confirmAction(
    convId: string | number,
    msg: ChatMessage,
    block: ConfirmBlock
  ): Promise<void> {
    const state = msg.pendingState || {}
    if (state[block.pending_action_id] && state[block.pending_action_id] !== 'pending') return
    msg.pendingState = { ...state, [block.pending_action_id]: 'loading' }
    try {
      const res = await confirmPendingAction(convId, block.pending_action_id)
      msg.pendingState = { ...msg.pendingState, [block.pending_action_id]: 'confirmed' }
      if (res && res.message) appendMessage(convId, toChatMessage(res.message))
      taskSync.markDirty()
      // 日程类确认（删除日程/批量）同样需要日历重拉
      eventSync.markDirty()
    } catch (e) {
      msg.pendingState = { ...msg.pendingState, [block.pending_action_id]: 'pending' }
      toast.show(errorText(e))
    }
  }

  /** 取消待确认动作 */
  async function cancelAction(
    convId: string | number,
    msg: ChatMessage,
    block: ConfirmBlock
  ): Promise<void> {
    const state = msg.pendingState || {}
    if (state[block.pending_action_id] && state[block.pending_action_id] !== 'pending') return
    msg.pendingState = { ...state, [block.pending_action_id]: 'loading' }
    try {
      const res = await cancelPendingAction(convId, block.pending_action_id)
      msg.pendingState = { ...msg.pendingState, [block.pending_action_id]: 'canceled' }
      if (res && res.message) appendMessage(convId, toChatMessage(res.message))
    } catch (e) {
      msg.pendingState = { ...msg.pendingState, [block.pending_action_id]: 'pending' }
      toast.show(errorText(e))
    }
  }

  /**
   * 候选选择：本地折叠为「已选择：xxx」并把选择结果作为下一条用户消息发出，
   * 由助手基于上下文继续执行（接口契约仅有 /chat 接收 content）。
   */
  function pickCandidate(
    convId: string | number,
    msg: ChatMessage,
    blockIndex: number,
    task: Task
  ): void {
    if (streamingByConv.value[keyOf(convId)]) return
    msg.clarifyPicked = { ...(msg.clarifyPicked || {}), [blockIndex]: task.title }
    // 带上 ID，便于服务端在长会话中稳定地解析指代（避免只靠标题重名）
    void send(convId, `我选择：${task.title}（任务ID ${task.id}）`)
  }

  /** 日程候选选择（任务日程场景：选中的是候选日程还是候选任务由 block.kind 决定） */
  function pickEventCandidate(
    convId: string | number,
    msg: ChatMessage,
    blockIndex: number,
    event: CalendarEvent
  ): void {
    if (streamingByConv.value[keyOf(convId)]) return
    msg.clarifyPicked = { ...(msg.clarifyPicked || {}), [blockIndex]: event.title }
    void send(convId, `我选择：${event.title}（日程ID ${event.id}）`)
  }

  /**
   * 作用域澄清选择：本地折叠为「已选择：xxx」，并把结构化选择结果作为下一条用户消息发出，
   * 由模型据此带上 scope/occurrence_key 重新调用工具（前端不重放任何写请求）。
   */
  function pickScope(
    convId: string | number,
    msg: ChatMessage,
    blockIndex: number,
    block: ScopeBlock,
    scope: EventScope
  ): void {
    if (streamingByConv.value[keyOf(convId)]) return
    const label = scopeLabel(scope)
    msg.clarifyPicked = { ...(msg.clarifyPicked || {}), [blockIndex]: label }
    const { series_id, occurrence_key } = block.ref || { series_id: 0 }
    const keyPart = occurrence_key ? `，occurrence_key=${occurrence_key}` : ''
    void send(
      convId,
      `关于循环日程 #${series_id} 的这次操作，作用域选择：${label}(${scope})${keyPart}`
    )
  }

  /**
   * 冲突处理：两个动作都只是把决定交回助手。
   * 「仍要安排」由模型带 confirm_conflict=true 重新调用工具完成写入，避免前端绕过门控直接写库。
   */
  function conflictForce(convId: string | number): void {
    void send(convId, '仍要安排，请按原时间创建')
  }

  function conflictChange(_convId: string | number): void {
    // 仅折叠提示块，等待用户输入新时间（不自动发消息，避免替用户编时间）
  }

  /** v0.3.0：清除聊天记录后复位本地状态（会话 id 不变，无需重新自举） */
  function clearHistory(convId: string | number): void {
    const k = keyOf(convId)
    delete messagesByConv.value[k]
    delete loadingByConv.value[k]
    delete errorByConv.value[k]
    delete scrollTopByConv.value[k]
    setCompacting(convId, false)
    const next = { ...detailNavByConv.value }
    delete next[k]
    detailNavByConv.value = next
  }

  return {
    messagesByConv,
    loadingByConv,
    errorByConv,
    streamingByConv,
    messagesOf,
    isStreaming,
    isCompacting,
    loadHistory,
    reloadHistory,
    send,
    retrySend,
    confirmAction,
    cancelAction,
    pickCandidate,
    pickEventCandidate,
    pickScope,
    conflictForce,
    conflictChange,
    adoptProposal,
    clearHistory,
    saveScrollTop,
    scrollTopOf,
    markDetailNavigation,
    consumeDetailReturn,
    appendMessage,
  }
})