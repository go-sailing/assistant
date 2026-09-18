import { ref } from 'vue'
import { defineStore } from 'pinia'

/** toast 可选操作位（如归档成功后的「查看」）：不改变既有 show(text) 调用语义 */
export interface ToastAction {
  label: string
  handler: () => void
}

/** 顶部 Toast：轻反馈，默认 2s 自动消失 */
export const useToastStore = defineStore('toast', () => {
  const message = ref('')
  const visible = ref(false)
  const action = ref<ToastAction | null>(null)
  let timer: number | undefined

  function show(text: string, duration = 2000, withAction?: ToastAction): void {
    message.value = text
    action.value = withAction ?? null
    visible.value = true
    if (timer) window.clearTimeout(timer)
    timer = window.setTimeout(() => {
      visible.value = false
      action.value = null
    }, duration)
  }

  function hide(): void {
    if (timer) window.clearTimeout(timer)
    visible.value = false
    action.value = null
  }

  /** 点击操作位：先收起再执行，避免遮挡后续跳转页面 */
  function runAction(): void {
    const current = action.value
    hide()
    current?.handler()
  }

  return { message, visible, action, show, hide, runAction }
})