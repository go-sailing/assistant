import type { MemoryCategory } from '@/types'

/**
 * v0.5.0 前端 UI 常量（服务端阈值走环境变量，此处只放纯展示常量）。
 */

/** 纯查询轮「大卡组」折叠阈值：同一 cards 块对象总数 > 10 默认折叠（SDD 3.3） */
export const CARD_COLLAPSE_THRESHOLD = 10

/** 记忆类别中文名（与服务端 CATEGORY_LABELS 一一对应） */
export const MEMORY_CATEGORY_LABELS: Record<MemoryCategory, string> = {
  profile: '个人情况',
  preference: '时间偏好',
  routine: '固定作息',
  objects: '常用对象',
  context: '长期事项',
  other: '其他',
}

/** 归档成功 toast 的「查看」按钮停留时长（比普通 toast 长，留出点击时间） */
export const ARCHIVE_TOAST_DURATION = 4000