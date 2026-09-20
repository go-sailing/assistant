/**
 * 手势方向锁（v0.8.0，GES-01）
 *
 * 同一次触摸手势只服务一个方向意图：
 * - 纵向（v）= 列表下拉刷新；
 * - 横向（h）= 行内左滑（露出操作按钮）。
 *
 * 由「列表滚动容器（刷新）」与「行组件（左滑）」共享：谁先通过观察期判定，
 * 谁锁定方向，另一侧在整个手势周期内失效（避免左滑误触发下拉刷新）。
 * 手势结束/取消时由滚动容器统一复位。
 */
export type GestureAxis = 'h' | 'v'

/** 观察期（px）：与既有左滑 8px 观察期、下拉阈值口径一致 */
export const GESTURE_LOCK_PX = 8

/** 纵向主导判定系数（沿用日历/列表既有方向锁系数） */
export const GESTURE_RATIO = 1.5

let axis: GestureAxis | null = null

/**
 * 观察期后判定主导方向：
 * - 观察期内（水平与垂直位移均 < 8px）返回 null：调用方不应据此锁定方向，
 *   否则手指起手的微小抖动会把整次手势定格为某个方向（左滑/下拉互相抢占）；
 * - 横向主导：水平位移 ≥ 8px 且大于垂直位移；
 * - 纵向主导：垂直位移 > 水平位移 × 1.5 且水平位移 < 8px；
 * - 其余（斜向但未达任一条件，例如 dx=12、dy=90）返回 null：
 *   本次手势不服务任一方向（仅滚动列表），既不下拉刷新也不进入左滑。
 *
 * 注：观察期守卫放在本函数内，是为了让所有调用点（列表容器与行组件）都不可能漏判。
 */
export function resolveAxis(dx: number, dy: number): GestureAxis | null {
  const absX = Math.abs(dx)
  const absY = Math.abs(dy)
  if (absX < GESTURE_LOCK_PX && absY < GESTURE_LOCK_PX) return null
  if (absX >= GESTURE_LOCK_PX && absX > absY) return 'h'
  if (absY > absX * GESTURE_RATIO && absX < GESTURE_LOCK_PX) return 'v'
  return null
}

/** 尝试锁定方向；已被锁定为其它方向时返回 false（当次手势不再翻转） */
export function lockAxis(next: GestureAxis): boolean {
  if (axis === null) {
    axis = next
    return true
  }
  return axis === next
}

export function currentAxis(): GestureAxis | null {
  return axis
}

/** 横向已锁定：下拉刷新侧应立即取消本手势的累计与提示 */
export function isHorizontalLocked(): boolean {
  return axis === 'h'
}

export function isVerticalLocked(): boolean {
  return axis === 'v'
}

/** 手势结束 / 取消时复位（仅由承载 touchstart/touchend 的滚动容器调用） */
export function resetAxis(): void {
  axis = null
}
