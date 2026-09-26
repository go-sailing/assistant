/**
 * v0.8.0（CAL-04）折叠/展开跟手联动的纯函数与常量（系统设计文档 11.5 / 11.6 / 11.11）。
 *
 * 交互从「阈值触发的一次性切换」升级为**位移连续驱动（drag-linked）**：
 * 连续量 p ∈ [0,1]，p=1 完全展开整月、p=0 完全折叠选中周。
 * 本模块只放无副作用、可单测的映射与判定，DOM 写入由 MonthView 负责。
 */

/** 观察期（px）：位移小于该值不锁定方向、不进入形态手势（沿用 v0.6.0） */
export const DRAG_OBSERVE_PX = 8
/** 方向锁：|dy| > 1.5 × |dx| 判为纵向并进入形态手势（沿用） */
export const DRAG_DIRECTION_RATIO = 1.5
/** 端点阻尼区间：[0, 0.15] ∪ [0.85, 1] */
export const DRAG_DAMP_ZONE = 0.15
/** 端点阻尼系数：阻尼区间内的**增量**乘 0.4 */
export const DRAG_DAMP_FACTOR = 0.4
/** 吸附：行程过半即吸附目标端 */
export const SETTLE_RATIO = 0.5
/** 吸附：释放速度阈值（px/ms） */
export const SETTLE_VELOCITY = 0.3
/** 吸附/回弹动画时长上限（ms） */
export const SETTLE_MS = 250
/** 速度采样窗口（ms） */
export const VELOCITY_WINDOW_MS = 100
/** 列表顶部容差（px，沿用） */
export const LIST_TOP_TOLERANCE = 2

export function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v))
}

/**
 * 阻尼映射：中段 1:1，接近两端时增量乘 0.4（SDD 11.5）。
 *
 * 阻尼只作用于**增量**（非整体重映射），保证跟手过程中手感连续、不会在跨过阻尼区时跳变。
 *
 * @param p      当前进度 [0,1]
 * @param dDy    相邻两次 move 的纵向增量（手指向下为正）
 * @param range  行程（H_exp − H_week），<=0 时按 1 处理
 */
export function mapProgress(p: number, dDy: number, range: number): number {
  const span = range > 0 ? range : 1
  const delta = dDy / span
  const damped = p <= DRAG_DAMP_ZONE || p >= 1 - DRAG_DAMP_ZONE ? delta * DRAG_DAMP_FACTOR : delta
  return clamp(p + damped, 0, 1)
}

/**
 * 吸附判定（SDD 11.6）：
 * - 行程 |p − p0| ≥ 50% 或释放速度方向一致且 |v| ≥ 0.3px/ms → 吸附目标端（collapse/expand）；
 * - 否则回弹到 p0 所在端。
 */
export function settleTarget(p: number, p0: number, velocity: number): 0 | 1 {
  const travel = Math.abs(p - p0)
  const towardCollapse = p < p0
  const fast = towardCollapse ? velocity <= -SETTLE_VELOCITY : velocity >= SETTLE_VELOCITY
  if (travel >= SETTLE_RATIO || fast) return towardCollapse ? 0 : 1
  return p0 >= 0.5 ? 1 : 0
}

/** rAF ease-out 补间：`1 − (1−t)³`（SDD 11.6）；reducedMotion 时立即到位 */
export function easeOutCubic(t: number): number {
  const c = clamp(t, 0, 1)
  return 1 - Math.pow(1 - c, 3)
}
