import { ref } from 'vue'
import { defineStore } from 'pinia'

/**
 * 日程侧的双入口同步标记：对话中日程工具执行成功后置脏，
 * 切回日程 Tab 时若为脏则重新从云端拉取（与任务侧 taskSync 同构）。
 */
export const useEventSyncStore = defineStore('eventSync', () => {
  const dirty = ref(false)
  /** 进入月视图时希望定位到的日期（YYYY-MM-DD），仅消费一次 */
  const focusDate = ref('')

  function markDirty(): void {
    dirty.value = true
  }

  function consumeDirty(): boolean {
    const v = dirty.value
    dirty.value = false
    return v
  }

  /** 从对话/任务详情跳到某个日期时使用 */
  function setFocusDate(date: string): void {
    focusDate.value = date
  }

  function takeFocusDate(): string {
    const v = focusDate.value
    focusDate.value = ''
    return v
  }

  return { dirty, focusDate, markDirty, consumeDirty, setFocusDate, takeFocusDate }
})