# 个人助手（Personal Assistant）

用「说一句话」和「点一下列表/日历」两种方式管理个人待办与日程。核心特点是 **LLM 聊天具备任务与日程管理的全部能力**——凡是能在列表、日历里手动完成的操作，都能通过对助手说一句话完成，两条入口读写同一份云端数据。

> 当前形态是移动端 Web（H5），全云端架构，不做本地存储与离线。

**已交付版本**

| 版本 | 主题 | 状态 |
| --- | --- | --- |
| MVP v0.3 | 任务管理 + 具备同等能力的 LLM 对话 | 已交付 |
| **v0.1.0** | **日程管理（含任务日程） + 日历视图 + 冲突检测** | **已交付，测试通过**（详见 [测试报告](docs/v0.1.0/测试报告-个人助手v0.1.0.md)） |

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

### 日程管理（v0.1.0）

- **两类日程**：
  - **普通日程**：用户自己要安排的一件事（自填标题）
  - **任务日程**：为某个**已有任务**安排的执行时段，链接该任务；标题/优先级/完成态实时取关联任务，不存冗余副本
- **日历视图**：月视图（日期标记点区分普通/任务/聚合）+ 当日视图（全天分区置顶、时间轴、当前时间参考线、进行中高亮）
- 日程字段：标题、开始/结束时间、全天、地点、备注；跨日与全天日程按日期左闭右开存储
- **时间冲突检测**：时间段左闭右开相交即判冲突（端点相接不算），区分 `overlap` 与 `all_day` 两级提示；**冲突只提示不阻止**，用户确认「仍要保存」才落库
- **任务排期**：任务详情「安排日程」或新建日程选「任务日程」，同一任务可有多条排期（分段执行）
- 日程侧勾选完成 = 完成关联任务（日程本身无完成状态）
- **删除联动**：删除任务日程只取消安排、保留任务；删除任务则级联删除其全部任务日程（确认文案明示条数）
- 日程搜索（标题/地点/备注，任务日程同时匹配任务标题）；当日视图可聚合当日到期任务（P1，本版未实现）

### LLM 对话（任务 + 日程）

- 一句话完成任务的增、删、改、查、完成、清单归类与批量操作
- 一句话完成日程的创建、改期、改地点/备注、删除、批量取消，以及**为任务排期**
- 自动解析相对时间（"下周一上午10点"→绝对时间）与清单归属；只给开始时间时默认 +1 小时并明示
- 对话中的任务/日程以结构化卡片呈现，与列表、日历数据实时一致
- **危险操作强制二次确认**：删除任务、删除清单、批量修改、删除日程、批量取消日程，执行前展示影响范围并要求用户确认
- **时间冲突先告知**：命中冲突时不落库，先在对话中陈述冲突日程并给出「换个时间 / 仍要安排」，用户明确同意后才带 `confirm_conflict` 重新提交
- **歧义必须澄清**：对象/时间不明确（多个候选、无匹配、"这周末""节后"）时追问或列候选，禁止猜测执行写操作
- **禁止猜测关联**：为任务排期必须先查证任务拿到真实 ID，多候选先澄清，任务不存在先询问是否新建
- 多轮上下文，支持"把它改成高优先级""把它改到下午 4 点"这类指代；历史卡片按云端最新数据刷新，已删除日程渲染「该日程已删除」占位

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
npm run dev          # 启动在 http://localhost:3000，首次启动自动执行数据库迁移（001~003）
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

用手机浏览器访问 `http://<本机IP>:5173`，或用桌面浏览器切到移动视口（如 390×844）使用。登录后默认落在**日程 Tab**，底部三个 Tab：日程 / 任务 / 助手。

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
| `EVENT_DEFAULT_TZ` | `Asia/Shanghai` | 客户端未上传时区时的兜底时区，影响"今天/明天"的自然日边界与月视图归日 |
| `EVENT_DEFAULT_DURATION_MIN` | `60` | 只给开始时间时的默认时长（分钟） |
| `EVENT_CONFLICT_SCAN_LIMIT` | `50` | 冲突检测返回条数上限 |
| `EVENT_LIST_MAX_LIMIT` | `200` | 日程列表/批量预取条数上限 |

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
│   └── v0.1.0/                    # v0.1.0（日程管理）产品与技术文档
│       ├── PRD-个人助手v0.1.0.md
│       ├── UXUI设计文档-个人助手v0.1.0.md
│       ├── 系统设计文档-个人助手v0.1.0.md
│       ├── 测试用例文档-个人助手v0.1.0.md
│       ── 测试报告-个人助手v0.1.0.md
└── src/
    ├── docker-compose.yml         # PostgreSQL
    ├── server/                    # 后端
    │   └── src/
    │       ├── config/            # 配置加载
    │       ├── common/            # 错误码、统一响应、校验、日志
    │       ├── db/                # 连接池、迁移器、SQL 迁移文件（001~003）
    │       ├── middleware/        # 鉴权、限流
    │       ├── modules/
    │       │   ├── auth/          # 注册/登录/注销
    │       │   ├── list/          # 清单
    │       │   ├── task/          # 任务（领域服务 + REST）
    │       │   ├── event/         # 日程（领域服务 + REST + 参数校验）
    │       │   └── chat/          # 会话、消息、对话编排（SSE）
    │       ├── llm/               # DeepSeek 适配器、工具定义、系统提示词
    │       └── tools/             # LLM 工具执行器（参数校验 + 确认门控 + 审计）
    └── web/                       # 前端
        ── src/
            ├── api/               # HTTP 客户端与 SSE 消费
            ├── stores/            # Pinia 状态（含 taskSync / eventSync 脏标记）
            ├── router/            # 路由与登录守卫
            ├── styles/            # Design Token 与全局样式
            ├── utils/             # 时间格式化（含日程区间/日期键）、校验、凭证
            ├── components/        # 通用组件 + 对话组件 + calendar/ 日历组件
            ── views/             # 页面（auth / calendar / tasks / chat）
```

---

## 核心设计

### 两个领域服务，双入口能力对等

`TaskService` 与 `EventService` 分别是任务、日程领域的**唯一入口**：REST 控制器与 LLM 工具执行器都调用同一组领域方法，业务规则只实现一次，因此手动操作与对话操作的结果必然一致（含校验错误码与冲突判定）。

```
REST 请求 ─                        ┌─→ TaskService  → PostgreSQL
           ├─（同一 Service，规则一致）┤
LLM 工具 ─┘                        ─→ EventService → PostgreSQL
```

依赖方向固定为单向：`task → event`（删除任务时级联清理其任务日程）、`chat → task/event`；日程域只读任务表用于校验与展示，不反向依赖。

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
| `cards` | 任务与日程卡片数据（可同时出现；始终为云端最新值） |
| `clarify` | 需要用户澄清，含 `kind: task \| event` 与对应候选 |
| `conflict` | 时间冲突提示块（冲突日程明细 + 「换个时间 / 仍要安排」） |
| `confirm` | 危险操作待确认，附带影响范围（任务或日程） |
| `done` | 本轮结束 |
| `error` | 错误（含是否可重试） |

助手消息以结构化 `payload.blocks` 落库，**历史回看与实时流式复用同一套渲染模型**；读取历史时按对象 ID 批量回查云端最新值覆盖快照。

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
| GET/POST | `/tasks` | 查询（筛选/排序/分页）/ 创建任务 |
| GET | `/tasks/search?keyword=` | 关键词搜索 |
| GET/PATCH/DELETE | `/tasks/:id` | 详情（含 `event_count`）/ 编辑 / 删除（返回 `deleted_event_count`） |
| GET | `/tasks/:id/events` | 该任务的全部任务日程（升序） |
| POST | `/tasks/:id/complete` `/tasks/:id/uncomplete` | 完成 / 取消完成 |
| POST | `/tasks/batch-update` | 批量更新 |
| GET | `/events/monthly?year=&month=&tz=` | **月视图聚合**（仅返回日期→计数，含 normal/task） |
| GET | `/events?date=&tz=` 或 `?date_from=&date_to=&tz=` | 按日 / 日期范围查询（左闭右开，含冲突标注） |
| GET | `/events/search?keyword=` | 日程搜索（标题/地点/备注 + 关联任务标题） |
| POST | `/events` | 创建日程（`confirm_conflict: true` 用于冲突二次提交） |
| GET/PATCH/DELETE | `/events/:id` | 详情（含 conflicts）/ 编辑 / 删除 |
| GET/POST | `/conversations` | 会话列表 / 新建会话 |
| GET | `/conversations/:id/messages` | 历史消息 |
| PATCH/DELETE | `/conversations/:id` | 重命名 / 删除会话 |
| POST | `/conversations/:id/chat` | **发送消息（SSE 流式）** |
| POST | `/conversations/:id/pending-actions/:paId/confirm` `.../cancel` | 确认 / 取消待确认操作 |

完整定义见各版系统设计文档：[MVP §6](docs/mvp/系统设计文档-个人助手MVP.md)、[v0.1.0 §6](docs/v0.1.0/系统设计文档-个人助手v0.1.0.md)。

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
| 4009 | 409 | 时间冲突待确认（`details.conflicts`） |

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
| **003** | **`events`** | **日程（`event_type` + `task_id`）** |

`events` 关键约束与索引：

```sql
-- 类型与关联一致；任务日程不存标题副本；结束不得早于开始
CONSTRAINT chk_event_task_link CHECK ((event_type='normal' AND task_id IS NULL)
                                   OR (event_type='task'   AND task_id IS NOT NULL))
CONSTRAINT chk_event_title     CHECK ((event_type='task' AND title IS NULL)
                                   OR (event_type='normal' AND btrim(title) <> ''))
CONSTRAINT chk_event_time      CHECK (end_at >= start_at)

CREATE INDEX idx_events_user_time ON events(user_id, start_at, end_at);  -- 冲突相交查询
CREATE INDEX idx_events_user_task ON events(user_id, task_id);          -- 排期查询/级联
```

所有业务查询强制携带 `user_id`，防止水平越权；删除任务对任务日程设 `ON DELETE CASCADE` 作为事务之外的兜底。

---

## 测试

| 版本 | 用例文档 | 测试报告 | 结论 |
| --- | --- | --- | --- |
| MVP | [133 项](docs/mvp/测试用例文档-个人助手MVP.md) | [测试报告](docs/mvp/测试报告-个人助手MVP.md) | 不建议直接发布（长上下文指代间歇失败） |
| **v0.1.0** | **[144 项](docs/v0.1.0/测试用例文档-个人助手v0.1.0.md)** | **[测试报告](docs/v0.1.0/测试报告-个人助手v0.1.0.md)** | **达到发布门槛**（P0 100%、P1 97%、0 未修复失败） |

v0.1.0 执行方式：自动化接口/对话用例（**真实 DeepSeek，无 mock**）+ 浏览器实测（移动端设备模拟）+ 数据库层校验。关键实测数据：

- 月聚合 P95 **4ms**、写接口 P95 5ms、冲突相交查询 **0.094ms**；单用户 3060 条日程下无劣化且走索引
- 对话链路：任务排期三分支（唯一命中/多候选澄清/不存在先询问）、冲突"先告知→仍要安排/改期"、幻觉 ID 如实告知、禁止猜测 `task_id`、6 轮长会话指代全部正确
- 安全：越权一律 1004、注入与通配返回 0 条、跨用户脏关联 0 条

测试中发现 **10 个缺陷已全部修复并复验**，其中 2 个为发布级阻断（编辑日程必保存失败、当日视图冲突标记缺失）。遗留事项：三端真机兼容需走查；字号体系为 `px`，系统字号放大 130% 暂不生效（待 rem 化）。

---

## 非目标

以下均**明确不做**，避免范围蔓延：

- 原生 App（iOS/Android 安装包）与 PC 端专门适配
- 本地存储与离线能力（断网不可用，端上仅存登录凭证）
- 本地通知与消息推送；**日程不做任何提醒触达**，仅记录时间
- 短信/邮箱验证码、邮箱激活、自助找回密码
- 多人协作、任务指派、共享清单、参会人、会议室预订、空闲忙闲
- **重复/周期性日程**（仅支持单次日程）、日程与任务的互相转换
- 第三方日历账号同步（Google/Outlook/系统日历/企微/飞书）与日历订阅
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