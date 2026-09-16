# 个人助手（Personal Assistant）

用「说一句话」和「点一下列表/日历」两种方式管理个人待办与日程。核心特点是 **LLM 聊天具备任务与日程管理的全部能力**——凡是能在列表、日历里手动完成的操作，都能通过对助手说一句话完成，两条入口读写同一份云端数据。

> 当前形态是移动端 Web（H5），全云端架构，不做本地存储与离线。

**已交付版本**

| 版本 | 主题 | 状态 |
| --- | --- | --- |
| MVP v0.3 | 任务管理 + 具备同等能力的 LLM 对话 | 已交付 |
| v0.1.0 | 日程管理（含任务日程） + 日历视图 + 冲突检测 | 已交付，测试通过（详见 [测试报告](docs/v0.1.0/测试报告-个人助手v0.1.0.md)） |
| **v0.2.0** | **循环日程 + 子任务 + 导航重构（底部 Tab → 左侧抽屉）** | **已交付，测试通过**（详见 [测试报告](docs/v0.2.0/测试报告-个人助手v0.2.0.md)） |

---

## 目录

- [功能范围](#功能范围)
- [技术栈](#技术栈)
- [快速开始](#快速开始)
- [环境变量](#环境变量)
- [项目结构](#项目结构)
- [核心设计](#核心设计)
- [接口概览](#接口概览)
- [数据库](#数据库)
- [测试](#测试)
- [非目标](#非目标)
- [安全提示](#安全提示)

---

## 功能范围

### 任务管理（MVP）

- 任务的创建、查看、编辑、删除、完成/取消完成
- 清单管理：内置默认清单 + 自定义清单（新建/重命名/删除，删除清单时其内任务自动迁移至默认清单）
- 任务字段：标题、备注、优先级（无/低/中/高）、截止时间、所属清单
- 列表支持按清单切换、按状态筛选、按截止时间或创建时间排序、关键词搜索
- 逾期任务时间标红、今日截止标橙

### 子任务（v0.2.0）

- 任务可挂到另一个任务下（`parent_id` 自引用），最多 **5 级**，且**父子必须同清单**
- 任务首页默认只列根任务，行内展开子任务树（懒加载下一级、树引导线缩进），折叠态显示「已完/总数」进度
- 任务详情新增父子面包屑（可逐级跳转）、子任务分区（树 + 进度条 + 行内添加）、**移动层级**（挂到别的任务下 / 移出为顶层）
- 父任务进度为**直接子任务**口径：三态复选框（部分完成显示 `mixed`），勾选子任务不会自动完成父任务
- **级联完成两阶段**：完成仍有未完成子任务的父任务时，先返回 `4010` 告知数量，用户确认后才在同一事务内完成父与全部未完成后代
- **非对称联动**：取消父任务的完成状态**不会**级联到子任务；向已完成父任务新增/移入**未完成**子任务时，父任务自动恢复为未完成并在响应与对话中告知
- 删除任务 = 删除整棵子树及其全部任务日程（单事务，返回 `deleted_task_count` / `deleted_event_count`）

### 日程管理（v0.1.0）

- **两类日程**：
  - **普通日程**：用户自己要安排的一件事（自填标题）
  - **任务日程**：为某个**已有任务**安排的执行时段，链接该任务；标题/优先级/完成态实时取关联任务，不存冗余副本
- **日历视图**：月视图（日期标记点区分普通/任务/循环/聚合）+ 当日视图（全天分区置顶、时间轴、当前时间参考线、进行中高亮）
- 日程字段：标题、开始/结束时间、全天、地点、备注；跨日与全天日程按日期左闭右开存储
- **时间冲突检测**：时间段左闭右开相交即判冲突（端点相接不算），区分 `overlap` 与 `all_day` 两级提示；**冲突只提示不阻止**，用户确认「仍要保存」才落库
- **任务排期**：任务详情「安排日程」或新建日程选「任务日程」，同一任务可有多条排期（分段执行）
- 日程侧勾选完成 = 完成关联任务（日程本身无完成状态）
- **删除联动**：删除任务日程只取消安排、保留任务；删除任务则级联删除其全部任务日程（确认文案明示条数）
- 日程搜索（标题/地点/备注，任务日程同时匹配任务标题）

### 循环日程（v0.2.0）

- 支持**每天 / 每周 / 每月 / 每年** + 间隔（每 2 周、每 3 天…）+ 每周多选星期（含「工作日」快捷）/ 每月同日（超月落到月末）/ 每月第 N 个或最后一个周 X / 每年同月日（2-29 在平年落到 2-28）
- 结束条件：**永不 / 重复 N 次（≤730）/ 截止日期（≤首次后 5 年）**
- **实例虚拟展开、零物化**：库里只存一条系列主记录 + 例外表 `event_overrides`，任意日期窗口实时展开，切月/切年即时可见
- **三种写作用域**：
  - **仅本次**（默认推荐）：改期/改地点只影响该次，写入 modified 例外；取消本次可随时**恢复**
  - **本次及以后**：把原系列截断到本次之前，并从本次起派生一条新系列（`derived_from_event_id` 溯源），已有例外按切点迁移
  - **整条系列**：改规则/改时间作用于全部实例；删除整条不可恢复（走二次确认）
- **规则摘要服务端单点产出**（如「每周一、周四 10:00，至 2026-12-31 止」），表单、卡片、详情、对话共用同一文案
- **循环冲突扫描**：创建或整条改期时对未来 **90 天**实例做冲突扫描，按日期分组汇总（前 5 个日期 + 共 N 个日期 / M 次冲突），只提示不阻断；仅改结束条件不触发重扫
- 系列详情：规则 + 摘要 + 「下一次」+ 总次数、即将到来（正序分页）/ 历史（倒序，含已取消与已调整）分区
- 任务日程**不支持循环**（任务本身重复到期仍是后续版本能力）

### LLM 对话（任务 + 日程 + 子任务，v0.2.0 扩展）

- 一句话完成任务的增、删、改、查、完成、清单归类与批量操作；**一句话加子任务、移动层级、查询子树、级联完成父任务**
- 一句话完成日程的创建、改期、改地点/备注、删除、批量取消，以及**为任务排期**
- **一句话建循环日程**（"每周一和周四晚上8点健身，重复8次"）：口语解析为结构化规则，多选星期、间隔、月内规则与结束条件均支持
- **循环实例的作用域写操作**：用户说「这次/这周一次」→ 仅本次（可恢复）；「以后都」→ 整条；「从下次开始」→ 本次及以后（截断 + 派生）；**作用域不明确时先澄清（推荐仅本次），禁止默认按整条执行**
- 自动解析相对时间（"下周一上午10点"→绝对时间）与清单归属；只给开始时间时默认 +1 小时并明示
- 对话中的任务/日程/系列/实例/子任务组均以结构化卡片呈现，与列表、日历数据实时一致
- **危险操作强制二次确认**：删除任务（含子树与日程计数）、删除清单、批量修改、**删除整条循环系列**（含总次数与下一次）、删除日程、批量取消日程
- **时间冲突先告知**：命中冲突时不落库，先在对话中陈述冲突（循环按日期分组），用户明确同意后才带 `confirm_conflict` 重新提交
- **歧义必须澄清**：对象/时间/作用域不明确（多个候选、无匹配、"这周末""节后"）时追问或列候选，禁止猜测执行写操作
- **禁止猜测关联**：为任务排期/加子任务必须先查证真实 ID，多候选先澄清，父任务或实例不存在先询问/如实告知
- 多轮上下文，支持"把它改成高优先级""它再往后延一周"这类指代；历史卡片按云端最新数据刷新（系列按新规则重算摘要、实例重算「已调整/已取消」、子任务组按根重新拉取，已删除对象渲染占位）

### 账号

- 邮箱 + 密码注册与登录，**不做验证码、不做邮箱激活、不做自助找回密码**（MVP 与 v0.1.0 相同）

---

## 技术栈

| 层 | 选型 |
| --- | --- |
| 前端 | Vue 3 + Vite + TypeScript + Pinia + vue-router（原生 CSS 实现 Design Token，无 UI 库） |
| 后端 | Node.js 18 + TypeScript + Express（模块化单体） |
| 数据库 | PostgreSQL 15（Docker） |
| LLM | DeepSeek 官方 API，模型 `deepseek-flash`，Function Calling + SSE 流式输出 |
| 鉴权 | JWT（Bearer Token） + bcrypt 密码哈希 |

---

## 快速开始

### 前置条件

- Node.js 18+
- Docker（用于启动 PostgreSQL）
- 一个 DeepSeek API Key（[获取地址](https://platform.deepseek.com/)）

### 1. 启动数据库

```bash
cd src
docker compose up -d
```

### 2. 配置并启动后端

```bash
cd src/server
cp .env.example .env
# 编辑 .env，填入 DEEPSEEK_API_KEY
npm install
npm run dev          # 启动在 http://localhost:3000，首次启动自动执行数据库迁移（001~005）
```

验证后端与模型连通性：

```bash
curl http://localhost:3000/healthz
# {"code":0,"message":"ok","data":{"status":"ok","llm_configured":true}}
```

### 3. 启动前端

```bash
cd src/web
npm install
npm run dev          # 启动在 http://localhost:5173，/api 已代理到后端
```

用手机浏览器访问 `http://<本机IP>:5173`，或用桌面浏览器切到移动视口（如 390×844）使用。登录后默认落在**日程页**；导航为**左上角菜单按钮唤起的左侧抽屉**（日程 / 任务 / 助手），**右下角浮动按钮**随页面切换为「打开助手」或在会话列表页为「新建对话」（对话详情页隐藏，该页返回按钮退回列表）。

### 常用脚本

| 命令 | 位置 | 说明 |
| --- | --- | --- |
| `npm run dev` | `src/server` | 开发模式启动后端（tsx 直跑源码） |
| `npm run build` / `npm start` | `src/server` | 编译并运行生产版本 |
| `npm run migrate` | `src/server` | 手动执行数据库迁移 |
| `npm run typecheck` | `src/server` | TypeScript 类型检查 |
| `npm run dev` / `npm run build` | `src/web` | 前端开发 / 构建 |
| `npx vue-tsc --noEmit` | `src/web` | 前端类型检查 |

---

## 环境变量

后端配置位于 `src/server/.env`（参考 [.env.example](src/server/.env.example)）。

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `PORT` | `3000` | 服务端口 |
| `DATABASE_URL` | — | PostgreSQL 连接串（必填） |
| `DB_AUTO_MIGRATE` | `true` | 启动时自动执行迁移 |
| `JWT_SECRET` | — | JWT 签名密钥（必填，生产环境务必更换） |
| `JWT_EXPIRES_IN` | `2h` | 令牌有效期 |
| `DEEPSEEK_API_KEY` | 空 | DeepSeek 密钥；**缺失时对话功能不可用，任务/日程管理功能不受影响** |
| `DEEPSEEK_BASE_URL` | `https://api.deepseek.com` | API 地址 |
| `DEEPSEEK_MODEL` | `deepseek-flash` | 模型名（以官方 `/models` 接口返回为准，可选 `deepseek-flash` / `deepseek-v4-pro`） |
| `DEEPSEEK_TIMEOUT_MS` | `60000` | 单次调用超时 |
| `DEEPSEEK_MAX_RETRY` | `2` | 失败重试次数 |
| `CHAT_HISTORY_LIMIT` | `20` | 注入模型的最近消息条数 |
| `PENDING_ACTION_TTL_SECONDS` | `300` | 待确认操作有效期 |
| `RATE_LIMIT_AUTH_PER_MIN` | `20` | 登录/注册限流（次/分钟/IP） |
| `RATE_LIMIT_CHAT_PER_MIN` | `20` | 对话限流（次/分钟/用户） |
| `EVENT_DEFAULT_TZ` | `Asia/Shanghai` | 客户端未上传时区时的兜底时区，影响"今天/明天"的自然日边界、月视图归日与循环规则解释 |
| `EVENT_DEFAULT_DURATION_MIN` | `60` | 只给开始时间时的默认时长（分钟） |
| `EVENT_CONFLICT_SCAN_LIMIT` | `50` | 冲突检测返回条数上限 |
| `EVENT_LIST_MAX_LIMIT` | `200` | 日程列表/批量预取条数上限 |
| `EVENT_RECURRENCE_CONFLICT_WINDOW_DAYS` | `90` | 创建/整条改期的**循环冲突扫描窗口**（天） |
| `EVENT_SERIES_MAX_COUNT` | `730` | 重复次数上限，同时是单次展开的种子上限 |
| `EVENT_SERIES_MAX_UNTIL_YEARS` | `5` | 循环截止日期距首次实例的最大年限 |
| `EVENT_RECUR_INTERVAL_MAX` | `99` | 重复间隔上限（每 N 天/周/月/年） |
| `EVENT_OCCURRENCE_PAGE_SIZE` | `20` | 系列详情实例分页大小 |
| `TASK_MAX_DEPTH` | `5` | 子任务最大层级（根任务为第 1 级） |
| `TASK_TREE_MAX_NODES` | `200` | 子树查询节点数上限（超出返回参数错误并提示收窄） |

---

## 项目结构

```
.
├── docs/
│   ├── mvp/                       # MVP（任务管理）产品与技术文档
│   │   ├── PRD-个人助手MVP.md
│   │   ├── UXUI设计文档-个人助手MVP.md
│   │   ├── 系统设计文档-个人助手MVP.md
│   │   ├── 测试用例文档-个人助手MVP.md
│   │   └── 测试报告-个人助手MVP.md
│   ├── v0.1.0/                    # v0.1.0（日程管理）产品与技术文档
│   │   ├── PRD-个人助手v0.1.0.md
│   │   ├── UXUI设计文档-个人助手v0.1.0.md
│   │   ├── 系统设计文档-个人助手v0.1.0.md
│   │   ├── 测试用例文档-个人助手v0.1.0.md
│   │   └── 测试报告-个人助手v0.1.0.md
│   └── v0.2.0/                    # v0.2.0（循环日程 / 子任务 / 导航重构）产品与技术文档
│       ├── PRD-个人助手v0.2.0.md
│       ├── UXUI设计文档-个人助手v0.2.0.md
│       ├── 系统设计文档-个人助手v0.2.0.md
│       ├── 测试用例文档-个人助手v0.2.0.md
│       └── 测试报告-个人助手v0.2.0.md
└── src/
    ├── docker-compose.yml         # PostgreSQL
    ├── server/                    # 后端
    │   └── src/
    │       ├── config/            # 配置加载
    │       ├── common/            # 错误码、统一响应、校验、日志
    │       ├── db/                # 连接池、迁移器、SQL 迁移文件（001~005）
    │       ├── middleware/        # 鉴权、限流
    │       ├── modules/
    │       │   ├── auth/          # 注册/登录/注销
    │       │   ├── list/          # 清单
    │       │   ├── task/          # 任务（领域服务 + REST，含子树/级联完成）
    │       │   ├── event/         # 日程（领域服务 + REST + 参数校验 + 冲突）
    │       │   │   ├── recurrence/    # 循环引擎：纯函数展开 + 规则摘要 + 规则类型
    │       │   │   ├── occurrence.service.ts  # 实例虚拟展开、例外覆盖、作用域写操作
    │       │   │   └── sql.ts         # 日程域公共 SQL 片段与单次冲突查询
    │       │   └── chat/          # 会话、消息、对话编排（SSE）、历史卡片云端刷新
    │       ├── llm/               # DeepSeek 适配器、工具定义、系统提示词
    │       └── tools/             # LLM 工具执行器（参数校验 + 确认门控 + 审计）
    └── web/                       # 前端
        └── src/
            ├── api/               # HTTP 客户端与 SSE 消费
            ├── stores/            # Pinia 状态（taskSync / eventSync 脏标记、drawer 抽屉态）
            ├── router/            # 路由与登录守卫（URL 结构沿用 v0.1.0）
            ├── styles/            # Design Token 与全局样式
            ├── utils/             # 时间格式化（含日程区间/日期键）、校验、凭证
            ├── components/        # 通用组件（含 AppDrawer 抽屉、AppFAB 浮动入口）
            │   ├── calendar/      # 月网格、RepeatSheet、ScopeSheet、系列卡/实例行、冲突分组弹层
            │   ├── tasks/         # 子任务树、子任务行、进度条、面包屑、父任务选择器
            │   └── chat/          # 卡片、冲突块、作用域澄清块、子任务组卡、确认条
            └── views/             # 页面（auth / calendar / tasks / chat）
```

---

## 核心设计

### 领域服务，双入口能力对等

`TaskService` 与 `EventService` 分别是任务、日程领域的**唯一入口**：REST 控制器与 LLM 工具执行器都调用同一组领域方法，业务规则只实现一次，因此手动操作与对话操作的结果必然一致（含校验错误码与冲突判定）。循环实例的展开与例外覆盖由 `OccurrenceService` 承载、规则推算由纯函数 `RecurrenceEngine` 承载，二者被 `EventService` 复用。

```
REST 请求 ─                        ┌─→ TaskService  ──→ 递归 CTE / 级联事务 → PostgreSQL
           ├─（同一 Service，规则一致）┤
LLM 工具 ─┘                        └─→ EventService ─┬→ RecurrenceEngine（纯函数展开，无 IO）
                                                    └→ OccurrenceService（例外覆盖 / 作用域写）→ PostgreSQL
```

依赖方向固定为单向：`task → event`（删除任务时级联清理其任务日程）、`chat → task/event`；日程域只读任务表用于校验与展示，不反向依赖。

### 循环日程：实例虚拟展开、零物化

循环系列在库里**只有一条主记录**（`events.recurrence` 存受控子集规则）+ 一张例外表 `event_overrides`；实例永不落库，任意查询窗口由引擎实时展开，因此"切到 10 月"不会产生任何写操作，也不会随时间膨胀。

```sql
-- 例外表：一条 = 某一次被改期或被取消
event_overrides(event_id, occurrence_start, action /* cancelled | modified */, patch jsonb)
```

- **实例身份键** `occurrence_key` = 按规则推算的**原始**开始时间（UTC），改期后不漂移，因此"改期 → 再改地点 → 再取消 → 恢复"始终指向同一次
- 规则在用户时区（IANA）的墙钟时间上推进，输出统一转 UTC，夏令时切换不产生漂移；`31 日 → 小月月末`、`2-29 → 平年 2-28` 自动回落
- 物化合并：先按「查询窗口 ∪ 全部例外改期时间」展开种子，应用例外后再按真实窗口裁剪——保证"改到本窗口内的那一次"也能被查到
- **整条改时间**时同事务平移该系列全部例外的 `occurrence_start`，单次修改不会因主记录平移而失联
- **循环冲突扫描**：创建/整条改期时展开未来 90 天实例，与「单次日程 + 其他系列实例」在内存中两两相交，按日期分组返回（前 5 组 + 总日期数与总冲突数），只提示不阻断；仅改结束条件不触发重扫

### 循环写操作的作用域

| 作用域 | 语义 | 落地方式 | 可否恢复 |
| --- | --- | --- | --- |
| `this` 仅本次 | 只影响某一次 | 写 `modified` / `cancelled` 例外（upsert，字段级合并） | 可（删除例外即恢复） |
| `following` 本次及以后 | 从本次起换规则/时间 | 单事务：原系列截断（count 系列按剩余次数、until/never 按 until）+ 派生新系列（`derived_from_event_id`）+ 例外按切点迁移 | 需人工调整 |
| `series` 整条 | 作用全部实例 | 改主记录并平移例外；删除整条不可恢复（走二次确认） | 删除不可恢复 |

作用域不明确时**先澄清（默认推荐「仅本次」）**，禁止默认按整条执行；`following` 的截断/派生结果会在 REST 响应与工具结果中一并回传，供前端与会话卡片同步刷新。

### 子任务：自引用树 + 写时校验

任务用 `tasks.parent_id` 自引用成树，三条约束由服务端在**写时**校验（DB 只保留 `ON DELETE CASCADE` 兜底）：

| 约束 | 规则 | 错误码 |
| --- | --- | --- |
| 深度 | 最多 5 级（根为 1 级），移动整棵子树时按「目标深度 + 子树高度」判断 | 4013 |
| 同清单 | 子任务必须与父任务在同一清单；根任务改清单时整棵子树跟随 | 4014 |
| 无环 | 不能挂到自身或自己的后代下（祖先链 CTE 判定） | 4015 |

- 子树/祖先/候选父任务全部用**递归 CTE** 一次查完（`SUBTREE_CTE`、`ANCESTORS_CTE`），节点数超上限返回参数错误并提示收窄
- 进度为**直接子任务**口径，用一次聚合扫描 `LEFT JOIN` 回主查询，避免 N+1
- 完成父任务且存在未完成后代时，先返回 `4010` + 数量，确认后单事务级联完成（已完成后代的 `completed_at` 不被改写）；取消父完成**不**级联
- 向已完成父任务新增/移入未完成子任务时，**只恢复直接父**（不递归祖父），并在响应/工具结果里回传 `revived_parent` 以便如实告知

### 导航：抽屉 + 浮动入口（纯前端覆盖层）

v0.2.0 把底部 Tab 换成左侧抽屉，URL 与路由表**完全沿用 v0.1.0**（`/calendar`、`/tasks`、`/chat` 等深度链接与刷新行为不变），只移除 `meta.tab`：

- 三个一级页左上角为菜单按钮（汉堡），二级页为返回按钮；抽屉宽 `min(80%, 320px)`、遮罩点击/菜单项/浏览器后退三种关闭方式（打开时压入一条透明历史态并在关闭时回收，后退优先关抽屉）
- 右下角浮动按钮按当前路由分流：日程/任务页 = 打开助手，会话列表 = 新建对话，对话详情页隐藏
- 对话页禁用左缘手势（避免与消息区横滑冲突），其余页面支持左缘起手（20pt 内让位系统手势）唤起抽屉

### 任务日程：链接而非合并

任务日程通过 `events.task_id` 链接一个任务，代表"在某个时段执行该任务"：

- 标题/优先级/所属清单/完成态**实时取关联任务**（`COALESCE(t.title, e.title)`），不存副本
- 类型与关联**创建后不可变更**（应用层拒绝真变更 + DB `CHECK` 约束兜底）
- 完成动作落在任务上：日程侧勾选 = 写任务 `status/completed_at`，events 表无完成字段
- 删除单向级联：删日程不删任务；删任务在**单事务**内删除其全部任务日程并返回条数

### 时间冲突：只提示不阻止

冲突判定为时间段**左闭右开相交**（`A.end > B.start AND A.start < B.end`），端点相接不判冲突；命中冲突时**不落库**，由调用方二选一：

| 入口 | 首次请求 | 用户坚持 |
| --- | --- | --- |
| REST | 返回 `HTTP 409 / code=4009`，`details.conflicts` 带冲突明细 | 同参重发并带 `confirm_conflict: true` |
| 对话 | 工具返回 `need_conflict_confirmation: true`，编排推送 `conflict` 事件渲染冲突块 | 模型带 `confirm_conflict: true` 重调工具 |

该机制与危险操作的 `pending_actions` 门控区分：冲突不是危险操作，因此不挂起、不做 TTL，只做无副作用的参数化二次提交，保证不会重复创建。

### 危险操作由服务端门控

删除任务、删除清单、批量修改、删除日程、批量取消日程即使被模型调用也**不会立即执行**：服务端先预取受影响对象、落一条待确认记录（`pending_actions`），把影响范围推给前端渲染确认条；用户确认后才按固化的参数（预取到的 ID 集合）精确执行。安全边界由服务端强制，不依赖模型自觉。

### 对话流式协议（SSE）

`POST /api/v1/conversations/:id/chat` 返回 `text/event-stream`，事件类型：

| 事件 | 说明 |
| --- | --- |
| `meta` | 请求已受理（含 message_id、trace_id） |
| `text_delta` | 助手文本增量（逐字输出） |
| `tool_call` | 模型请求调用工具（前端可展示处理中） |
| `cards` | 卡片数据：任务 / 日程 / **循环系列** / **循环实例** / **子任务组**（可同时出现；始终为云端最新值） |
| `clarify` | 需要用户澄清，含 `kind: task \| event` 与对应候选 |
| `conflict` | 时间冲突提示块（单次冲突明细，或**循环按日期分组**：前 5 组 + 总日期数/总冲突数） |
| `scope` | **循环作用域澄清块**（仅本次 / 本次及以后 / 整条，推荐项排第一；点选后作为结构化消息回传） |
| `confirm` | 危险操作待确认，附带影响范围（任务或日程；含 `complete_task_cascade`、`delete_event_series` 两种 v0.2.0 动作） |
| `done` | 本轮结束 |
| `error` | 错误（含是否可重试） |

助手消息以结构化 `payload.blocks` 落库，**历史回看与实时流式复用同一套渲染模型**；读取历史时按对象 ID 批量回查云端最新值覆盖快照（系列按新规则重算摘要、实例用 `occurrence_key` 重新物化、子任务组按根重新拉取子树，已删除对象渲染占位）。

```bash
curl -N -X POST http://localhost:3000/api/v1/conversations/1/chat \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"content":"把季度报告安排在明天 15:00-16:00 写","timezone":"Asia/Shanghai"}'
```

---

## 接口概览

Base URL：`/api/v1`；除注册登录外均需 `Authorization: Bearer <token>`。
统一响应包裹：`{ "code": 0, "message": "ok", "data": {...} }`；错误含业务码与可选 `details`。

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| POST | `/auth/register` `/auth/login` `/auth/logout` | 注册 / 登录 / 登出 |
| DELETE | `/auth/me` | 注销账号（需 `confirm: true`） |
| GET/POST | `/lists` | 查询 / 新建清单 |
| PATCH/DELETE | `/lists/:id` | 重命名 / 删除清单 |
| GET/POST | `/tasks` | 查询（筛选/排序/分页/**`root_only` 只看根任务**/`parent_id` 只看直接子任务）/ 创建任务（可带 `parent_id`） |
| GET | `/tasks/search?keyword=` | 关键词搜索 |
| GET/PATCH/DELETE | `/tasks/:id` | 详情（含进度与 `event_count`）/ 编辑（`parent_id` 移动层级，显式 `null` 移出为顶层）/ 删除（返回 `deleted_task_count` 与 `deleted_event_count`，删除整棵子树及其日程） |
| GET | `/tasks/:id/subtree?depth=` | **子树**（扁平节点数组，含 `depth` 与进度；`depth=1` 取根+直接子级） |
| GET | `/tasks/:id/ancestors` | **祖先链**（根 → 父 → 当前，用于面包屑） |
| GET | `/tasks/:id/parent-candidates` | **可挂载的父任务候选**（同清单，已排除自身与全部后代） |
| GET | `/tasks/:id/events` | 该任务的全部任务日程（升序） |
| POST | `/tasks/:id/complete` `/tasks/:id/uncomplete` | 完成（有未完成后代先返回 4010，需带 `cascade: true` 确认）/ 取消完成（不级联） |
| POST | `/tasks/batch-update` | 批量更新 |
| GET | `/events/monthly?year=&month=&tz=` | **月视图聚合**（日期→计数，含 normal/task/**recurring**） |
| GET | `/events?date=&tz=` 或 `?date_from=&date_to=&tz=` | 按日 / 日期范围查询（左闭右开，含冲突标注，**循环实例由服务端展开**）；可加 `series_id`、`recurring_only`、`include_cancelled` |
| GET | `/events/series/:id?section=&cursor=` | **循环系列详情**（规则 + 摘要 + 下一次 + 总次数 + 实例分页） |
| GET | `/events/search?keyword=` | 日程搜索（标题/地点/备注 + 关联任务标题；循环系列返回主记录） |
| POST | `/events` | 创建日程（可带 `recurrence` 建循环；`confirm_conflict: true` 用于冲突二次提交） |
| GET/PATCH/DELETE | `/events/:id` | 详情（可带 `occurrence_key` 取实例视角，含 conflicts）/ 编辑（`scope: series\|this\|following` + `occurrence_key`）/ 删除（`scope=series` 删整条、`scope=this` 仅取消本次） |
| POST | `/events/:id/restore-occurrence` | **恢复某次已取消的实例**（body 带 `occurrence_key`） |
| GET/POST | `/conversations` | 会话列表 / 新建会话 |
| GET | `/conversations/:id/messages` | 历史消息（卡片按云端最新数据刷新） |
| PATCH/DELETE | `/conversations/:id` | 重命名 / 删除会话 |
| POST | `/conversations/:id/chat` | **发送消息（SSE 流式）** |
| POST | `/conversations/:id/pending-actions/:paId/confirm` `.../cancel` | 确认 / 取消待确认操作 |

完整定义见各版系统设计文档：[MVP §6](docs/mvp/系统设计文档-个人助手MVP.md)、[v0.1.0 §6](docs/v0.1.0/系统设计文档-个人助手v0.1.0.md)、[v0.2.0 §7](docs/v0.2.0/系统设计文档-个人助手v0.2.0.md)。

### 业务错误码（节选）

| code | HTTP | 含义 |
| --- | --- | --- |
| 1001 | 400 | 参数错误（字段级 `message`） |
| 1002 / 1003 / 1004 | 401 / 403 / 404 | 未登录 / 无权限 / 资源不存在 |
| 1005 / 1006 | 409 / 429 | 冲突（如默认清单不可删）/ 请求过频 |
| 2001 | 401 | 邮箱或密码错误（统一文案，防账号枚举） |
| 3001 / 3002 / 3003 | 502 / 500 / 409 | LLM 不可用 / 工具执行失败 / 待确认动作失效 |
| 4001 | 400 | 日程时间非法（结束早于开始等） |
| 4002 | 409 | 关联任务不可排期（已完成） |
| 4003 | 409 | 日程类型/关联任务创建后不可变更 |
| 4009 | 409 | 时间冲突待确认（单次 `details.conflicts` / 循环 `details.conflict_dates`） |
| **4010** | **409** | **父任务有未完成子任务，需确认级联完成（`details.incomplete_descendant_count`）** |
| **4011** | **400** | **循环规则非法（组合矛盾、上限越界、截止早于首次等，`details.reason`）** |
| **4012** | **404** | **循环实例不存在（`occurrence_key` 在当前规则下无对应实例）** |
| **4013 / 4014 / 4015** | **409** | **子任务超 5 级 / 与父任务不同清单 / 移动到自身或后代（成环）** |
| **4016** | **409** | **任务日程不支持循环** |

---

## 数据库

由 `src/server/src/db/migrations/*.sql` 版本化管理，启动时自动执行（记录于 `schema_migrations` 表）。

| 迁移 | 表 | 说明 |
| --- | --- | --- |
| 001 | `users` | 账号（bcrypt 哈希密码） |
| 001 | `task_lists` | 清单（每用户唯一默认清单，由部分唯一索引保证） |
| 001 | `tasks` | 任务 |
| 001 | `conversations` / `messages` | 会话与消息（消息 `payload` 存结构化内容块） |
| 001 | `pending_actions` | 待确认的危险操作（`affected` 存 `{tasks, events}` 快照） |
| 001 | `tool_invocations` | LLM 工具调用审计（入参、结果、耗时、trace_id） |
| 002 | `tasks.source` | 任务创建来源（manual/chat） |
| 003 | `events` | 日程（`event_type` + `task_id`） |
| **004** | **`events.recurrence` / `derived_from_event_id`、`event_overrides`** | **循环规则、派生溯源与单次例外（零物化的唯一持久化部分）** |
| **005** | **`tasks.parent_id`** | **子任务自引用（`ON DELETE CASCADE`）+ 子树/根任务/同清单索引** |

`events` 关键约束与索引：

```sql
-- 类型与关联一致；任务日程不存标题副本；结束不得早于开始
CONSTRAINT chk_event_task_link CHECK ((event_type='normal' AND task_id IS NULL)
                                   OR (event_type='task'   AND task_id IS NOT NULL))
CONSTRAINT chk_event_title     CHECK ((event_type='task' AND title IS NULL)
                                   OR (event_type='normal' AND btrim(title) <> ''))
CONSTRAINT chk_event_time      CHECK (end_at >= start_at)
-- v0.2.0：任务日程禁循环（Service / zod / DB 三处一致）
CONSTRAINT chk_event_no_recur_task CHECK (event_type = 'normal' OR recurrence IS NULL)

CREATE INDEX idx_events_user_time ON events(user_id, start_at, end_at);  -- 冲突相交查询
CREATE INDEX idx_events_user_task ON events(user_id, task_id);          -- 排期查询/级联
CREATE INDEX idx_events_recurring_active ON events(user_id, start_at) WHERE recurrence IS NOT NULL;
```

```sql
-- v0.2.0：单次例外（一条 = 某一次被改期或被取消）
CREATE TABLE event_overrides (
  user_id, event_id REFERENCES events(id) ON DELETE CASCADE,
  occurrence_start TIMESTAMPTZ NOT NULL,          -- 实例身份键（原始开始时间）
  action VARCHAR(16) NOT NULL,                    -- cancelled | modified
  patch JSONB NOT NULL DEFAULT '{}'::jsonb,       -- modified 时的字段子集
  CONSTRAINT uniq_override_occurrence UNIQUE (event_id, occurrence_start)
);

-- v0.2.0：子任务自引用
ALTER TABLE tasks ADD COLUMN parent_id INTEGER REFERENCES tasks(id) ON DELETE CASCADE;
```

004/005 全部语句幂等（`IF NOT EXISTS` / `DROP CONSTRAINT IF EXISTS`），存量数据零回填（新列全为 NULL），已在 v0.1.0 存量库快照上做过迁移演练。

所有业务查询强制携带 `user_id`，防止水平越权；删除任务对任务日程设 `ON DELETE CASCADE`、对子任务设自引用 `ON DELETE CASCADE` 作为事务之外的兜底（正常路径以服务端单事务为准）。

---

## 测试

| 版本 | 用例文档 | 测试报告 | 结论 |
| --- | --- | --- | --- |
| MVP | [133 项](docs/mvp/测试用例文档-个人助手MVP.md) | [测试报告](docs/mvp/测试报告-个人助手MVP.md) | 不建议直接发布（长上下文指代间歇失败） |
| v0.1.0 | [144 项](docs/v0.1.0/测试用例文档-个人助手v0.1.0.md) | [测试报告](docs/v0.1.0/测试报告-个人助手v0.1.0.md) | 达到发布门槛（P0 100%、P1 97%、0 未修复失败） |
| **v0.2.0** | **[254 项](docs/v0.2.0/测试用例文档-个人助手v0.2.0.md)** | **[测试报告](docs/v0.2.0/测试报告-个人助手v0.2.0.md)** | **达到发布质量**（可执行范围内 P0 100%、P1 100%、17 个缺陷全部修复） |

v0.2.0 执行方式：引擎单元断言（tsx）+ 接口/DB 自动化（210 断言）+ 浏览器实测（移动端设备模拟）+ **真实 DeepSeek 对话与双入口同源专项（85 断言，单轮干净复跑 0 失败）**。关键实测数据：

- **循环引擎领域正确性 100%**：四频率 + 间隔 + 多选星期 + 月内规则、31 日与 2-29 回落、count/until/never 边界、730/99/5 年上限、跨时区归桶、**零物化**（库内实例数恒为 0）
- **作用域三态**：仅本次（可恢复）／本次及以后（截断 + 派生 + 例外迁移）／整条（含 90 天按日期分组冲突扫描），越权一律 1004
- **子任务五项约束**：5 级上限（4013）、同清单（4014）、成环（4015）、级联完成两阶段（4010）、删除整树计数；非对称联动（取消不级联、新增未完成子任务只恢复直接父）均按设计
- **AI 对话 36/36 通过**：口语建循环、作用域澄清与直执行、单次改期/取消/恢复、删系列确认、子任务全流程、系列/实例/子任务组卡片、历史卡片云端刷新、6 轮长会话指代全部正确
- **双入口同源（SYNC 013~019）**：手动与对话各入口的例外、截断派生、子任务、自动恢复、级联删除、校验错误码（4012/4013/4014/4015/4016）逐条一致
- 接口性能抽测：区间展开 ≤112ms、月聚合 ≤47ms、子树查询 ≤11ms（单用户小规模）
- 安全：越权 1004、规则注入与畸形参数 1001/4011、XSS 原样存储且脚本不执行

两轮执行共发现 **17 个缺陷（2 个 P0 + 13 个 P1 + 2 个 P2）全部修复并复验**，其中 `对话里「仅本次」改期全线失败`、`整条改时间后单次例外失联`、`改期实例跨窗口查不到` 为业务级问题。**遗留门槛**：三端真机兼容走查、mock 故障注入、性能压测（均为环境依赖项）；导航埋点未实现（前端无埋点上报通道）。

---

## 非目标

以下均**明确不做**，避免范围蔓延：

- 原生 App（iOS/Android 安装包）与 PC 端专门适配
- 本地存储与离线能力（断网不可用，端上仅存登录凭证）
- 本地通知与消息推送；**日程与循环日程都不做提醒触达**，仅记录时间
- 短信/邮箱验证码、邮箱激活、自助找回密码
- 多人协作、任务指派、共享清单、参会人、会议室预订、空闲忙闲
- **任务本身的重复到期**（v0.2.0 的循环只作用于普通日程；任务日程禁循环，`4016`）
- **日程与任务的互相转换**；子任务的跨清单归属（父子必须同清单，`4014`）
- **RRULE 全量能力**（仅支持受控子集：daily/weekly/monthly/yearly + interval + 星期/月内规则 + never/count/until；不支持 BYSETPOS、多规则并集、按工作日顺延等）
- **循环系列的 REST 批量管理**（批量操作只作用于单次日程，循环系列不参与批量改/删，避免误伤整条系列）
- 第三方日历账号同步（Google/Outlook/系统日历/企微/飞书）与日历订阅；日历导入导出（.ics）
- 习惯打卡、笔记、记账
- 语音输入与多模态、插件市场与自定义 Agent

---

## 安全提示

- **`src/server/.env` 含真实 DeepSeek API Key，已加入 `.gitignore`，切勿提交。**
- `JWT_SECRET` 默认值仅供本地开发，部署前必须更换为随机强密钥。
- DeepSeek API Key 仅在服务端使用，不会下发到前端；发往模型的上下文只含必要的任务/日程结构化字段。
- 生产部署需由网关（Nginx 等）终止 TLS，全链路 HTTPS。
- 当前登出黑名单与限流基于**内存**实现，多实例部署时需替换为 Redis。
- 限流默认值为 20 次/分钟（登录注册按 IP、对话按用户）；压测或批量测试时可临时通过环境变量提高，**生产请保持默认**。
- 循环规则与子任务参数在入口做**白名单化结构校验**（频率枚举 + 数值上下限 + 星期/月内规则受控取值 + 结束条件互斥），服务端再做语义校验（`4011`）并限制展开与查询规模，避免畸形规则放大计算量；任务日程禁循环由 zod、Service 与 DB `CHECK` 三处一致拦截（`4016`）。