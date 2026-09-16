import { ref } from 'vue'
import { defineStore } from 'pinia'

/**
 * 左侧抽屉开关态（系统设计文档 3.2 / UXUI 5.9）。
 * 纯内存 UI 态：不持久化、不含业务数据，关闭只切 UI 不改变路由与历史。
 */
export const useDrawerStore = defineStore('drawer', () => {
  const open = ref(false)
  /** 打开来源，用于埋点：hamburger（导航栏） / gesture（边缘手势） */
  const source = ref<'hamburger' | 'gesture'>('hamburger')

  function openDrawer(from: 'hamburger' | 'gesture' = 'hamburger'): void {
    source.value = from
    open.value = true
  }

  function closeDrawer(): void {
    open.value = false
  }

  function toggle(from: 'hamburger' | 'gesture' = 'hamburger'): void {
    if (open.value) closeDrawer()
    else openDrawer(from)
  }

  return { open, source, openDrawer, closeDrawer, toggle }
})
