import { reactive, ref } from 'vue'
import { defineStore } from 'pinia'
import { streamChat, confirmPendingAction, cancelPendingAction, fetchMessages } from '@/api/conversations'
import { errorText } from '@/api/client'
import type {
  ChatMessage,
  ConfirmBlock,
  ErrorBlock,
  MessageBlock,
  RawMessage,
  Task,
} from '@/types'
import { useToastStore } from './toast'
import { useTaskSyncStore } from './taskSync'

/** 生成幂等键（重发沿用同一个，服务端据此去重） */
export function genClientMsgId(): string {
  return `c-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
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

  const messagesByConv = ref<Record<string, ChatMessage[]>>({})
  const loadingByConv = ref<Record<string, boolean>>({})
  const errorByConv = ref<Record<string, string>>({})
  const streamingByConv = ref<Record<string, boolean>>({})
  const scrollTopByConv = ref<Record<string, number>>({})

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

  function saveScrollTop(convId: string | number, top: number): void {
    scrollTopByConv.value[keyOf(convId)] = top
  }

  function scrollTopOf(convId: string | number): number {
    return scrollTopByConv.value[keyOf(convId)] || 0
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
        switch (event) {
          case 'meta': {
            if (data.message_id !== undefined && data.message_id !== null) {
              msg.id = `m-${String(data.message_id)}`
            }
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
            if (tasks.length) msg.blocks.push({ type: 'cards', tasks })
            taskSync.markDirty()
            break
          }
          case 'clarify': {
            msg.thinking = false
            const candidates = Array.isArray(data.candidates) ? (data.candidates as Task[]) : []
            msg.blocks.push({
              type: 'clarify',
              question: typeof data.question === 'string' ? data.question : '',
              candidates,
            })
            break
          }
          case 'confirm': {
            msg.thinking = false
            const block: ConfirmBlock = {
              type: 'confirm',
              pending_action_id: String(data.pending_action_id ?? ''),
              action: String(data.action ?? ''),
              affected: Array.isArray(data.affected) ? (data.affected as Task[]) : [],
              count: typeof data.count === 'number' ? data.count : 0,
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
    void send(convId, `我选择：${task.title}`)
  }

  function clearConversation(convId: string | number): void {
    const k = keyOf(convId)
    delete messagesByConv.value[k]
    delete loadingByConv.value[k]
    delete errorByConv.value[k]
    delete scrollTopByConv.value[k]
  }

  return {
    messagesByConv,
    loadingByConv,
    errorByConv,
    streamingByConv,
    messagesOf,
    isStreaming,
    loadHistory,
    reloadHistory,
    send,
    retrySend,
    confirmAction,
    cancelAction,
    pickCandidate,
    clearConversation,
    saveScrollTop,
    scrollTopOf,
    appendMessage,
  }
})