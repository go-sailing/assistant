/**
 * v0.9.0 端上埋点承接（评审决议 D-09 / SDD 13.2 T10 / UXUI 9.3）。
 *
 * 口径：项目无分析 SDK，**不新增上报通道、不新增依赖、不落本地存储**。
 * 端上事件只在开发期（`import.meta.env.DEV`）以一条结构化 `console.info` 落开发期日志，
 * 供开发期日志检查与自动化断言（TC-DEL-068 / TC-AUDIT-080~084 / TC-AUDIT-089）；
 * 生产构建下直接短路返回，不产生任何网络/存储副作用。
 *
 * 隐私：与后端结构化日志同口径——只记 ID / 枚举 / 计数，**不记标题、备注与对话正文**。
 */

/**
 * 开发期开关：语义等价于 Vite 的 `import.meta.env.DEV`。
 *
 * 实现说明（不写成 `import.meta.env.DEV` 字面量）：先取 `import.meta.env` 再取值，
 * 使**无 Vite 注入**的环境（裸 esbuild / 纯 Node 测试夹具）退化为「按开发期处理」，
 * 而不是抛 `Cannot read properties of undefined`；生产构建由 Vite 注入 env 对象
 * （`{DEV:false}`），`DEV` 恒为 `false`，日志分支不执行。
 */
const DEV: boolean =
  (import.meta as ImportMeta & { env?: { DEV?: boolean } }).env?.DEV ?? true

/** 端上事件名（与 PRD 6.4 / SDD 13.2 埋点表一一对应） */
export type AppEventName =
  /** 旧链重定向命中（/tasks、/projects、/agents、/search、/lists 等；一次访问一条） */
  | 'legacy_route_redirect'
  /** 折叠/展开跟手手势（一次手势一条；含方向/起手区/是否接管/吸附结果/帧率采样） */
  | 'calendar_shape_gesture'
  /** 形态手势被丢弃（方向锁 / 多指 / 动画互斥；与实际丢弃次数一致） */
  | 'calendar_shape_gesture_dropped'
  /** 历史会话中已下线能力卡片占位渲染命中（含对象类型，不含正文） */
  | 'legacy_card_placeholder_hit'

/**
 * 落一条端上开发期事件日志（生产构建下 no-op）。
 *
 * @param event  事件名（见 `AppEventName`）
 * @param fields 只允许 ID / 枚举 / 计数类字段
 */
export function logAppEvent(event: AppEventName, fields: Record<string, unknown> = {}): void {
  if (!DEV) return
  // 开发期日志：与后端 logger.info 同形态（事件名 + 结构化字段）
  console.info(event, fields)
}

/* ---------------- legacy_route_redirect（TC-DEL-068 / TC-AUDIT-080） ---------------- */

/** 路由位置最小子集（避免为了埋点把 vue-router 运行时拖进纯逻辑模块） */
export interface RouteLike {
  path: string
  meta?: Record<string, unknown>
}

/**
 * 已下线能力旧链重定向命中（一次访问一条）。
 * 只记命中的旧路径与最终落点；未标记 `retiredLegacy` 的历史重定向不落事件。
 */
export function logLegacyRouteRedirect(from: RouteLike | undefined, to: RouteLike): void {
  if (!from || from.meta?.retiredLegacy !== true) return
  logAppEvent('legacy_route_redirect', { path: from.path, target: to.path })
}

/* ---------------- calendar_shape_gesture（TC-AUDIT-082 / 083） ---------------- */

/** 起手区域：日历区 / 列表顶部 / 列表中部 */
export type GestureOrigin = 'calendar' | 'list-top' | 'list-mid'
/** 跟手方向（手指位移方向） */
export type GestureDirection = 'up' | 'down' | 'none'
/** 吸附结果 */
export type GestureResult = 'collapse' | 'expand' | 'rebound' | 'none'
/** 手势被丢弃的原因 */
export type GestureDropReason = 'direction_lock' | 'multi_touch' | 'animating'

/** 净位移方向：上滑（collapse 意图）/ 下拉（expand 意图）/ 无位移 */
export function gestureDirection(netDy: number): GestureDirection {
  if (netDy < 0) return 'up'
  if (netDy > 0) return 'down'
  return 'none'
}

/** 一次手势一条：方向 / 起手区 / 是否接管 / 吸附结果 / 帧率采样 */
export function logShapeGesture(fields: {
  direction: GestureDirection
  origin: GestureOrigin
  tookOver: boolean
  result: GestureResult
  frames: number
  fps: number
  durationMs: number
}): void {
  logAppEvent('calendar_shape_gesture', {
    direction: fields.direction,
    origin: fields.origin,
    took_over: fields.tookOver,
    result: fields.result,
    frames: fields.frames,
    fps: fields.fps,
    duration_ms: fields.durationMs,
  })
}

/** 手势被丢弃（方向锁 / 多指 / 动画互斥），与实际丢弃次数一致 */
export function logShapeGestureDropped(reason: GestureDropReason, origin: GestureOrigin): void {
  logAppEvent('calendar_shape_gesture_dropped', { reason, origin })
}

/* ---------------- legacy_card_placeholder_hit（TC-AUDIT-084） ---------------- */

/** 历史遗留占位对象类型（任务卡 / 项目结果组 / 任务候选 / 任务类确认条） */
export type PlaceholderType = 'task' | 'subtask_group' | 'candidate' | 'confirm'

/** 历史卡片占位渲染命中：只记对象类型（+ 动作枚举），**不含标题正文** */
export function logLegacyPlaceholderHit(type: PlaceholderType, action?: string): void {
  logAppEvent(
    'legacy_card_placeholder_hit',
    action ? { object_type: type, action } : { object_type: type }
  )
}
