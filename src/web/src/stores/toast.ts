import { ref } from 'vue'
import { defineStore } from 'pinia'

/** 顶部 Toast：轻反馈，2s 自动消失 */
export const useToastStore = defineStore('toast', () => {
  const message = ref('')
  const visible = ref(false)
  let timer: number | undefined

  function show(text: string, duration = 2000): void {
    message.value = text
    visible.value = true
    if (timer) window.clearTimeout(timer)
    timer = window.setTimeout(() => {
      visible.value = false
    }, duration)
  }

  return { message, visible, show }
})