import { ref } from 'vue'
import { defineStore } from 'pinia'
import { createConversation } from '@/api/conversations'

/**
 * 唯一会话自举（v0.3.0，系统设计文档 3.5.1）：
 * 每用户有且仅有一个会话，/chat 进入时调一次幂等 POST /conversations 取回 id。
 * 本地缓存 id 仅用于减少首屏等待，每次进入仍会校准（本地失效/被清库时自愈）。
 */
const STORAGE_KEY = 'assistant.conversation_id'

function loadCachedId(): number | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    const n = raw ? Number(raw) : NaN
    return Number.isInteger(n) && n > 0 ? n : null
  } catch {
    return null
  }
}

function saveCachedId(id: number): void {
  try {
    localStorage.setItem(STORAGE_KEY, String(id))
  } catch {
    /* 隐私模式等场景下写入失败不影响使用 */
  }
}

export const useConversationStore = defineStore('conversation', () => {
  const conversationId = ref<number | null>(loadCachedId())

  /** 幂等获取唯一会话 id（服务端有则返回、无则创建） */
  async function ensureConversationId(): Promise<number> {
    const conv = await createConversation()
    const id = Number(conv.id)
    conversationId.value = id
    saveCachedId(id)
    return id
  }

  /** 本地缓存失效（消息拉取 404）时清缓存，下次进入重新自举 */
  function invalidate(): void {
    conversationId.value = null
    try {
      localStorage.removeItem(STORAGE_KEY)
    } catch {
      /* 忽略 */
    }
  }

  return { conversationId, ensureConversationId, invalidate }
})