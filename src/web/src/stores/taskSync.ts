import { ref } from 'vue'
import { defineStore } from 'pinia'

/**
 * 双入口同步标记：对话中工具执行成功后置脏，
 * 切回任务 Tab 时若为脏则重新从云端拉取列表（MVP 不引入推送）。
 */
export const useTaskSyncStore = defineStore('taskSync', () => {
  const dirty = ref(false)

  function markDirty(): void {
    dirty.value = true
  }

  /** 取出并清除标记 */
  function consumeDirty(): boolean {
    const v = dirty.value
    dirty.value = false
    return v
  }

  return { dirty, markDirty, consumeDirty }
})