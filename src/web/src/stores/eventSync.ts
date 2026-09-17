import { ref } from 'vue'
import { defineStore } from 'pinia'

/**
 * 日程侧的双入口同步标记：对话中日程工具执行成功后置脏，
 * 切回日程 Tab 时若为脏则重新从云端拉取（与任务侧 taskSync 同构）。
 */
export const useEventSyncStore = defineStore('eventSync', () => {
  const dirty = ref(false)

  function markDirty(): void {
    dirty.value = true
  }

  function consumeDirty(): boolean {
    const v = dirty.value
    dirty.value = false
    return v
  }

  return { dirty, markDirty, consumeDirty }
})