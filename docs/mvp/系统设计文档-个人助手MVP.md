# 个人助手 APP MVP 系统设计文档

| 项目 | 内容 |
| --- | --- |
| 文档名称 | 个人助手 APP MVP 系统设计文档（SDD） |
| 版本 | v0.1 |
| 日期 | 2026-09-16 |
| 对应需求 | [PRD-个人助手MVP.md](./PRD-个人助手MVP.md) v0.3、[UXUI设计文档](./UXUI设计文档-个人助手MVP.md) v0.1 |
| 阅读对象 | 后端、前端、测试、运维 |

---

## 1. 设计概述

### 1.1 系统边界

- 客户端：**移动端 Web（H5）瘦客户端**，只负责展示与交互，不含业务规则与业务数据持久化；
- 服务端：承载账号、任务/清单、会话消息、LLM 代理与工具执行等全部业务逻辑与数据；
- 外部依赖：DeepSeek 开放 API（模型 `deepseek-flash`，Function Calling）；
- MVP 不做：离线/本地存储、消息推送、验证码服务、邮箱服务、第三方集成。

### 1.2 设计目标

| 目标 | 设计手段 |
| --- | --- |
| 双入口数据同源 | 手动操作与对话工具调用走同一套 Service 层与数据库 |
| LLM 能力可控、安全 | 服务端代理调用；工具白名单；参数强校验；危险操作二次确认 |
| 快（首屏 ≤1.5s、首字 ≤3s） | 接口轻量化、SSE 流式输出、静态资源 CDN |
| 可快速迭代替换模型 | LLM 网关层抽象 Provider，模型名/超时/工具配置化 |
| 可观测、可排障 | 全链路 traceId、工具调用审计、结构化日志与埋点 |

---

## 2. 总体架构

### 2.1 架构图

```
┌────────────────────────────────────────────────────────┐
│                     客户端（H5 瘦客户端）                 │
│  任务模块页面      对话模块页面      登录/注册  通用组件库  │
│         │              │（HTTPS / SSE）                  │
└─────────┼──────────────┼───────────────────────────────┘
          ▼              ▼
┌────────────────────────────────────────────────────────┐
│                    接入层（Nginx / 网关）                │
│         HTTPS 终止 · 静态资源托管/CDN · 反向代理 · 限流   │
└───────────────────────┬────────────────────────────────┘
                        ▼
┌────────────────────────────────────────────────────────┐
│                    后端应用服务（单体）                   │
│ ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────────┐ │
│ │ Auth 模块 │ │ Task 模块 │ │ Chat 模块 │ │ Conversation │ │
│ │ 注册/登录 │ │ 任务/清单  │ │ 会话/消息 │ │   消息持久化  │ │
│ └────┬─────┘ └────┬─────┘ └────┬─────┘ └──────┬───────┘ │
│      │            │            │              │          │
│      │     ┌──────▼────────────▼──────┐       │          │
│      │     │  Task Service（领域服务）  │◄──────┘          │
│      │     │  任务/清单唯一业务入口     │ 工具复用同一 Service│
│      │     └──────┬────────────┬──────┘                  │
│      ▼            ▼            ▼                          │
│ ┌──────────┐ ┌────────┐ ┌───────────────────────────┐    │
│ │ JWT 鉴权  │ │ 校验层  │ │   LLM 网关（Provider 抽象） │    │
│ │ 中间件    │ │ 参数校验│ │ DeepSeek Adapter           │    │
│ └──────────┘ └────────┘ │ Prompt/工具装配·SSE·重试·降级│    │
│                         └─────────────┬─────────────┘    │
└───────────────────────────────────────┼──────────────────┘
                                        ▼
                          ┌──────────────────────────┐
                          │  DeepSeek API（公网）      │
                          │  model: deepseek-flash   │
                          └──────────────────────────┘
          ▼                              ▼
┌──────────────────┐           ┌──────────────────────┐
│  PostgreSQL       │           │  Redis（可选/轻量使用） │
│ 用户/清单/任务/会话 │           │ SSE 通道辅助/限流计数  │
└──────────────────┘           └──────────────────────┘
```

### 2.2 架构说明

- MVP 采用**模块化单体（Modular Monolith）**：一次部署、模块边界清晰，降低运维成本；后续可按 Chat/Task 平滑拆服务；
- **Task Service 是任务领域唯一入口**：REST Controller 与 LLM 工具执行器（Tool Executor）均调用它，保证能力对等与规则一致（PRD 3.3）；
- Chat 模块不直接访问任务表，只通过 Task Service 暴露的领域方法操作数据；
- LLM 网关独立成层，DeepSeek 仅作为一个 Provider 实现，便于后续替换模型或增加兜底 Provider。

### 2.3 推荐技术选型（建议，最终以团队栈为准）

| 层 | 选型建议 | 理由 |
| --- | --- | --- |
| 前端 | Vue 3 + Vite + TypeScript+ Pinia + 原生 SSE（EventSource/fetch stream） | 移动 H5 生态成熟、包体小 |
| 移动端适配 | viewport 方案 + postcss px→rem/viewport，按 UX 文档 375pt 基准 | 一套代码适配多机型 |
| 后端 | Node.js（NestJS） | SSE 与 JSON 工具调用处理自然； |
| 数据库 | PostgreSQL 15+ | 事务可靠、JSONB 便于存工具调用记录 |
| 缓存/辅助 | Redis（SSE 多实例辅助、限流、会话热数据，MVP 可先不引入） | 单体单实例阶段非必需 |
| 鉴权 | JWT（Access Token，Header 携带）+ HttpOnly Cookie 二选一（见 7.3） | 无状态、适配 H5 |
| 部署 | 单云服务器 + 容器（Docker）+ Nginx；数据库托管版 | MVP 成本最低 |

---

## 3. 前端设计（H5）

### 3.1 前端分层

```
src/
├── api/            # HTTP 客户端：统一 baseURL、鉴权头、错误码处理
├── stores/         # 全局状态：auth、taskList 刷新标记、chat 会话
├── views/          # 页面：auth / tasks / chat
│   ├── auth/       # 引导、登录、注册
│   ├── tasks/      # 任务首页、详情、表单、搜索、清单管理
│   └── chat/       # 会话列表、对话页
├── components/     # 通用组件 + 业务组件（TaskCard、ConfirmBar、Candidate…）
├── composables/    # useSSE、useAuth、useTaskSync
├── router/         # 路由 + 登录守卫
└── utils/          # 时间格式化（UX 7.2 规则）、校验、token 管理
```

### 3.2 前端职责与约束

- **不保存业务数据**：不使用 LocalStorage/IndexedDB 缓存任务、消息；刷新后一律重新拉取云端；
- 仅保存：JWT 会话凭证、必要的 UI 偏好；
- 表单未提交内容仅存在于页面内存（符合 UX 4.4：保存失败内容不丢，离开页面即清空）；
- 双入口同步策略：
  - 对话中工具执行成功后，前端直接以工具返回的最新任务数据更新本地 store，并标记任务列表 dirty；
  - Tab 切换到"任务"时若 dirty 则重新拉取列表（简单可靠，MVP 不引入 WebSocket 推送）；
- SSE：优先 `fetch` + ReadableStream（POST 携带鉴权与消息体方便）；`EventSource` 不支持自定义 Header 时降级为 Cookie 鉴权或 fetch 流。

---

## 4. 后端模块设计

| 模块 | 职责 | 关键内容 |
| --- | --- | --- |
| Auth | 注册、登录、注销、鉴权中间件、密码哈希 | 邮箱唯一、bcrypt/argon2、JWT 签发与校验 |
| Task | 清单与任务 CRUD、搜索、批量更新、业务规则校验 | 事务保证删清单迁移任务；用户数据隔离 |
| Chat | 会话/消息持久化、上下文组装、对话编排 | 多轮历史、候选/确认会话状态机 |
| LLM Gateway | Provider 抽象、Prompt/工具 schema 装配、SSE 转发、超时重试、降级 | DeepSeek Adapter、配置化模型 |
| Tool Executor | LLM 工具的注册、参数 JSON Schema 校验、调用 Task Service、审计 | 工具白名单、危险操作确认门 |
| Common | 统一响应、错误码、参数校验、日志、traceId、限流 | 见第 9 章 |

### 4.1 危险操作确认的会话状态机

删除/批量操作不允许模型一步执行，通过会话级"待确认动作（PendingAction）"实现：

```
正常对话
  │ 模型返回工具调用：delete_task / batch_update_tasks / delete_list
  ▼
服务端不执行写操作，先调用只读工具预取受影响对象（或直接预查询）
  │ 生成 PendingAction{id, tool, params, affected_items, expires_at}
  ▼
SSE 推送 confirm 事件（前端渲染确认条 + 候选摘要）
  ├─ 用户 confirm：前端回传 pending_action_id
  │     → 服务端校验未过期且归属当前会话 → Tool Executor 执行 → 推送结果
  ├─ 用户 cancel：标记 canceled → 推送 canceled 事件，不执行
  └─ 超时（建议 5min）/用户发新指令：PendingAction 失效，需重新发起
```

对象不明确的候选选择同理：返回 `clarify` 事件与候选任务列表，用户选择后携带 `candidate_id` 继续。

---

## 5. 数据库设计

### 5.1 ER 关系

```
users 1───* task_lists 1───* tasks
users 1───* conversations 1───* messages
users 1───* tasks（默认清单逻辑归属）
conversations 1───* pending_actions
messages 1───* tool_invocations（审计）
```

### 5.2 表结构（PostgreSQL DDL 概要）

```sql
-- 用户
CREATE TABLE users (
  id            BIGSERIAL PRIMARY KEY,
  email         VARCHAR(254) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,          -- bcrypt/argon2
  status        SMALLINT NOT NULL DEFAULT 1,    -- 1 正常 0 注销
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 清单
CREATE TABLE task_lists (
  id          BIGSERIAL PRIMARY KEY,
  user_id     BIGINT NOT NULL REFERENCES users(id),
  name        VARCHAR(50) NOT NULL,
  is_default  BOOLEAN NOT NULL DEFAULT FALSE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_lists_user ON task_lists(user_id);
-- 默认清单：每个用户注册成功后在同一事务内创建，is_default=true 唯一

-- 任务
CREATE TABLE tasks (
  id           BIGSERIAL PRIMARY KEY,
  user_id      BIGINT NOT NULL REFERENCES users(id),
  list_id      BIGINT NOT NULL REFERENCES task_lists(id),
  title        VARCHAR(200) NOT NULL,
  note         VARCHAR(2000) NULL,
  status       VARCHAR(16) NOT NULL DEFAULT 'todo',   -- todo/completed
  priority     VARCHAR(16) NOT NULL DEFAULT 'none',   -- none/low/medium/high
  due_at       TIMESTAMPTZ NULL,
  completed_at TIMESTAMPTZ NULL,
  -- 创建来源埋点：manual（任务页手动创建）/ chat（对话工具创建），见 9.3
  source       VARCHAR(16) NOT NULL DEFAULT 'manual',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_tasks_user_status_due ON tasks(user_id, status, due_at);
CREATE INDEX idx_tasks_user_list       ON tasks(user_id, list_id);
CREATE INDEX idx_tasks_title_note_fts  ON tasks
  USING gin (to_tsvector('simple', title || ' ' || coalesce(note,'')));
-- MVP 搜索亦可先 ILIKE，FTS 为增强项

-- 会话
CREATE TABLE conversations (
  id         BIGSERIAL PRIMARY KEY,
  user_id    BIGINT NOT NULL REFERENCES users(id),
  title      VARCHAR(100) NOT NULL DEFAULT '新对话',  -- 可由首条消息摘要生成
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_conv_user_updated ON conversations(user_id, updated_at DESC);

-- 消息
CREATE TABLE messages (
  id              BIGSERIAL PRIMARY KEY,
  conversation_id BIGINT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  role            VARCHAR(16) NOT NULL,   -- user / assistant / system / tool
  content         TEXT NULL,              -- 文本内容
  payload         JSONB NULL,             -- 任务卡片、候选、确认条、错误等结构化内容
  tool_call_id    VARCHAR(64) NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_msg_conv ON messages(conversation_id, id);

-- 待确认动作
CREATE TABLE pending_actions (
  id         VARCHAR(36) PRIMARY KEY,      -- UUID
  conversation_id BIGINT NOT NULL REFERENCES conversations(id),
  user_id    BIGINT NOT NULL,
  tool_name  VARCHAR(64) NOT NULL,
  params     JSONB NOT NULL,
  affected   JSONB NOT NULL,               -- 预取的影响对象快照
  status     VARCHAR(16) NOT NULL DEFAULT 'pending', -- pending/confirmed/canceled/expired
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- LLM 工具调用审计
CREATE TABLE tool_invocations (
  id          BIGSERIAL PRIMARY KEY,
  user_id     BIGINT NOT NULL,
  conversation_id BIGINT NULL,
  message_id  BIGINT NULL,
  tool_name   VARCHAR(64) NOT NULL,
  arguments   JSONB NOT NULL,
  result      JSONB NULL,
  success     BOOLEAN NOT NULL,
  error       TEXT NULL,
  latency_ms  INT NULL,
  trace_id    VARCHAR(64) NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

**关键约束与规则**

- 所有业务表带 `user_id`，查询强制注入用户条件（防越权），Service 层统一处理；
- 删除清单使用事务：`UPDATE tasks SET list_id=:defaultListId WHERE list_id=:id` → 删除清单，保证任务不丢；
- 完成任务：`status='completed' AND completed_at=now()`；取消完成时清空 `completed_at`；
- 注销用户：MVP 采用物理/逻辑删除二选一，建议逻辑删除（status=0）+ 级联清理会话；需求要求"数据删除"，上线前与法务确认口径。

---

## 6. API 设计

### 6.1 通用约定

- Base URL：`/api/v1`；
- 认证：`Authorization: Bearer <access_token>`（除注册/登录外全部必填）；
- 响应包裹：

```json
{ "code": 0, "message": "ok", "data": { } }
```

- 错误：HTTP 状态码语义化 + `code` 业务码（见 9.3）；
- 时间：请求/响应统一 ISO 8601 UTC（`2026-09-17T07:00:00Z`），前端按本地时区渲染；
- 分页：`page` / `page_size`，响应 `{list, total, page, page_size}`。

### 6.2 接口清单

**Auth**

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| POST | `/auth/register` | 注册：`{email, password}`，成功直接返回 token |
| POST | `/auth/login` | 登录：`{email, password}` |
| POST | `/auth/logout` | 注销登录（失效当前 token / 拉黑 jti） |
| DELETE | `/auth/me` | 注销账号 |

**任务与清单**

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/lists` | 清单列表（含默认清单） |
| POST | `/lists` | 新建清单 |
| PATCH | `/lists/{id}` | 重命名（默认清单拒绝） |
| DELETE | `/lists/{id}` | 删除（任务迁移默认清单，事务） |
| GET | `/tasks` | 列表：`list_id,status,priority,due_from,due_to,sort,page` |
| GET | `/tasks/search?keyword=` | 搜索（标题/备注） |
| POST | `/tasks` | 创建 |
| GET | `/tasks/{id}` | 详情 |
| PATCH | `/tasks/{id}` | 编辑 |
| POST | `/tasks/{id}/complete` | 完成 |
| POST | `/tasks/{id}/uncomplete` | 取消完成 |
| DELETE | `/tasks/{id}` | 删除 |
| POST | `/tasks/batch-update` | 批量更新（筛选条件 + 字段） |

任务对象示例：

```json
{
  "id": 1024,
  "title": "季度报告",
  "note": "完成 Q3 数据汇总",
  "status": "todo",
  "priority": "high",
  "due_at": "2026-09-17T07:00:00Z",
  "list_id": 12,
  "list_name": "工作",
  "created_at": "2026-09-14T02:22:00Z",
  "updated_at": "2026-09-16T01:30:00Z",
  "completed_at": null
}
```

**会话与对话**

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/conversations` | 会话列表 |
| POST | `/conversations` | 新建会话 |
| GET | `/conversations/{id}/messages` | 历史消息（分页） |
| PATCH | `/conversations/{id}` | 重命名 |
| DELETE | `/conversations/{id}` | 删除会话 |
| POST | `/conversations/{id}/chat` | **发送消息（SSE 流式响应）** |
| POST | `/conversations/{id}/pending-actions/{pa_id}/confirm` | 确认执行 |
| POST | `/conversations/{id}/pending-actions/{pa_id}/cancel` | 取消 |

### 6.3 SSE 事件协议（`/chat`）

响应：`Content-Type: text/event-stream`，事件类型：

| event | data 内容 | 前端动作 |
| --- | --- | --- |
| `meta` | `{message_id, trace_id}` | 建立助手消息占位 |
| `text_delta` | `{delta}` | 文本逐字追加（流式） |
| `tool_call` | `{tool, arguments(脱敏摘要)}` | 显示"正在处理…"（可选透明化） |
| `cards` | `{tasks:[...]}` | 渲染/更新任务卡片（数据为云端最新值） |
| `clarify` | `{candidates:[...], question}` | 渲染候选卡片 |
| `confirm` | `{pending_action_id, action, affected:[...], count}` | 渲染确认条 |
| `done` | `{finish_reason}` | 结束流 |
| `error` | `{code, message, retryable}` | 错误提示 + 重试按钮 |

确认/取消通过普通 POST 回传，服务端执行后再以一条新的 SSE（或独立短事件流）推送 `cards/done/error`。

---

## 7. LLM 集成设计（核心）

### 7.1 对话编排流程

```
POST /chat
 1. 鉴权、落库 user 消息
 2. 组装请求：
    system prompt（角色、工具使用规则、安全边界、当前时间）
    + 最近 N 轮 messages（MVP 取最近 20 条，超长做摘要/截断）
    + tools 定义（白名单）
 3. 调 DeepSeek（stream=true, model=deepseek-flash）
 4. 处理模型输出：
    a) 纯文本 → 直接 text_delta 转发
    b) tool_calls → 逐项处理：
        - 参数 JSON Schema 校验失败 → 回灌错误消息让模型自纠（最多 2 次）
        - 只读工具 → 直接经 Tool Executor 调 Task Service
        - 危险写工具 → 不执行，预取 affected → 推 confirm，挂起 PendingAction
 5. 工具结果（结构化 JSON）回灌模型，生成自然语言总结 + 附带 cards 事件
 6. 落库 assistant 消息（文本 + payload 卡片）、写 tool_invocations 审计
 7. done
```

### 7.2 系统提示词策略（要点）

- 角色定义：用户的个人任务助手，只在任务管理领域使用工具；
- 注入**当前日期时间**与用户时区，要求模型把"下周五/明天早上"解析为绝对时间；无法确定时必须 `clarify`，禁止猜测；
- 工具使用纪律：
  - 操作对象必须来自工具查询结果的真实 `id`，禁止凭空构造 id；
  - 多候选时先澄清；删除/批量必须等待用户确认（服务端门控兜底，不依赖模型自觉）；
  - 成功后简述"做了什么 + 影响数量"；
- 超范围问题可礼貌回答但不调用任务工具。

### 7.3 工具（Function）定义

工具 schema 与 PRD 5.4 一一对应，每个工具有服务端 JSON Schema 校验：

| 工具 | 类型 | 直接执行 | 备注 |
| --- | --- | --- | --- |
| `create_task` | 写 | 是 | title 必填；list_id 缺省落默认清单 |
| `update_task` | 写（单条） | 是 | 仅更新传入字段 |
| `update_task_status` | 写 | 是 | todo/completed |
| `get_task` / `list_tasks` / `search_tasks` | 只读 | 是 | 强制 user_id 过滤 |
| `create_list` / `rename_list` | 写 | 是 | 默认清单保护；两个工具均支持按清单名解析为真实 ID |
| `list_lists` | 只读 | 是 | 查询用户全部清单（ID + 名称 + 是否默认）。模型按名称操作清单前必须先调用它拿到真实 ID，否则空清单无法被重命名/删除（测试阶段补齐） |
| `delete_task` | 危险写 | **否，需 confirm** | 预取任务摘要 |
| `delete_list` | 危险写 | **否，需 confirm** | 告知任务迁移默认清单 |
| `batch_update_tasks` | 危险写 | **否，需 confirm** | 预取 count + 前 3 条摘要 |

工具返回统一结构：

```json
{ "ok": true, "data": {"tasks": [...]}, "summary": {"affected": 3, "action": "completed"} }
```

### 7.4 可靠性与降级

| 故障 | 策略 |
| --- | --- |
| DeepSeek 超时/5xx | 指数退避重试 2 次（仅对幂等的模型请求阶段）；仍失败推 `error(retryable=true)` |
| 流式中断 | 检测断流，推送 error；已落库的 user 消息保留，支持"重试"重新发起（幂等键 `client_msg_id` 防重复创建任务） |
| 模型输出非法参数 | 校验拦截 → 错误回灌自纠，最多 2 轮 → 失败降级提示，绝不带错执行 |
| 模型幻觉构造不存在 id | Service 查询为空返回 not_found，模型据此澄清而非报错给用户 |
| 写操作成功但总结生成失败 | 数据以工具执行结果为准，前端凭 `cards` 事件已可展示；文本缺失给默认话术 |

**幂等性**：`/chat` 请求携带 `client_msg_id`，服务端短时去重（Redis/内存），防止用户重发导致重复建任务。

---

## 8. 安全设计

| 项 | 方案 |
| --- | --- |
| 传输 | 全链路 HTTPS（H5↔网关、网关↔服务、服务↔DeepSeek） |
| 密码 | argon2id 或 bcrypt(cost≥10) 加盐哈希；密码强度校验（建议 ≥8 位含字母数字）；登录失败限流 |
| 鉴权 | JWT（短有效期，建议 2h）+ 服务端可吊销（jti 黑名单/版本号）；MVP 不做 refresh token 时以过期重新登录兜底 |
| 越权防护 | 所有查询/更新强制 `user_id` 归属校验（先查资源归属再操作），用集成测试覆盖水平越权用例 |
| 输入校验 | 前后端双重校验；后端 JSON Schema/白名单校验所有入参与工具参数；参数化查询防 SQL 注入 |
| XSS | 前端默认转义渲染；助手文本仅允许白名单 Markdown（加粗/列表），禁原始 HTML/脚本；富文本渲染前消毒 |
| DeepSeek Key | 仅存服务端密钥管理（环境变量/密钥服务），严禁下发前端；按最小权限申请；调用量按用户限流 |
| 限流 | 登录/注册接口按 IP+邮箱限流；`/chat` 按用户限流（如 20 次/分钟）防刷 token |
| CSRF | 若采用 Header Bearer 方案天然免疫；若用 Cookie 则 SameSite + CSRF Token |
| 敏感数据 | 发往 LLM 的仅含必要任务字段；审计日志脱敏；日志不记录密码与完整 Key |
| 注销 | 注销账号后令牌立即失效，数据按 5.2 口径处理 |

---

## 9. 通用横切设计

### 9.1 统一错误码（节选）

| code | HTTP | 含义 |
| --- | --- | --- |
| 0 | 200 | 成功 |
| 1001 | 400 | 参数错误（字段级 message） |
| 1002 | 401 | 未登录/Token 失效 |
| 1003 | 403 | 无权限（资源不属于当前用户） |
| 1004 | 404 | 资源不存在 |
| 1005 | 409 | 冲突（邮箱已注册、默认清单不可删） |
| 1006 | 429 | 请求过频 |
| 2001 | 401 | 邮箱或密码错误（统一文案，防止账号枚举） |
| 3001 | 502 | LLM 服务不可用 |
| 3002 | 500 | 工具执行失败 |
| 3003 | 409 | 待确认动作已失效 |

### 9.2 日志与链路追踪

- 每个请求生成 `trace_id`，贯穿 HTTP 日志、DeepSeek 调用、工具执行、SSE 事件；
- 结构化日志字段：time、level、trace_id、user_id、route、latency、error_code；
- `tool_invocations` 表记录每次工具调用入参/结果/耗时/成功与否，支撑 PRD 9 的"操作成功率"指标与问题复盘。

### 9.3 埋点（对应 PRD 6.5）

任务创建来源（manual/chat）、工具调用类型与结果、确认条接受/取消、对话轮次、首字时延、错误码分布。

### 9.4 配置管理

环境变量区分 dev/staging/prod：数据库连接串、JWT 密钥与有效期、`DEEPSEEK_API_KEY`、`DEEPSEEK_MODEL=deepseek-flash`、`DEEPSEEK_BASE_URL`、超时/重试参数、限流阈值、功能开关。模型名不硬编码于业务代码。

---

## 10. 关键时序

### 10.1 注册即建默认清单

```
客户端 → /auth/register(email,password)
服务端: BEGIN
  INSERT users → 校验邮箱唯一
  INSERT task_lists(is_default=true)
  签发 JWT
       COMMIT
     ← {token, user}
```

### 10.2 对话触发危险操作（删除任务）

```
H5            后端 Chat            ToolExecutor/TaskService        DeepSeek
 │ POST /chat    │                         │                          │
 │──────────────►│ 落 user 消息 → 组装上下文 ──────────────────────────►│
 │               │◄──────────────────── stream: tool_call(delete_task) │
 │               │ 校验参数 → 预取任务 → 写 pending_actions             │
 │ event confirm {affected:[…]}                                        │
 │◄──────────────│                                                      │
 │ 用户点确认     │                                                      │
 │ POST …/confirm│                                                      │
 │──────────────►│ 校验 pending 有效 → delete_task ─► DELETE DB         │
 │               │ 回灌工具结果给模型生成总结 ─────────────────────────►│
 │ event cards + text_delta + done                                     │
 │◄──────────────│                                                      │
切换任务 Tab → GET /tasks 列表中该任务已不存在（数据同源验证）
```

### 10.3 手动与对话同源

两条写路径：
- REST：Controller → **TaskService.create/update/delete**
- Chat：LLM tool_call → ToolExecutor → **TaskService.create/update/delete**

同一 Service 方法保证业务规则（标题校验、默认清单保护、删清单迁移、完成时间戳）只实现一次。

---

## 11. 非功能与运维

### 11.1 性能预算

- 任务列表接口 P95 ≤ 300ms（服务端），端到端首屏 ≤ 1.5s；
- 任务写接口 P95 ≤ 300ms；
- `/chat` 首字延迟 P90 ≤ 3s（取决于 DeepSeek）；SSE 心跳每 15s 一次防代理断连；
- 前端：首屏 JS gzip 后控制在合理范围（路由懒加载，对话页大组件分包）。

### 11.2 部署架构（MVP）

```
用户 → CDN（静态 H5 资源）
用户 → Nginx(HTTPS) → 后端容器（单实例/可双实例）
                         ├─ PostgreSQL（云托管，定时每日备份，保留 7 天）
                         └─ DeepSeek API（公网）
```

- 一套 staging + 一套 prod；环境变量隔离密钥；
- 数据库迁移使用版本化 migration（如 Flyway/Alemic/Prisma migrate），变更随发布执行；
- 健康检查 `/healthz`（含 DB 连通性）。

### 11.3 测试策略

| 层级 | 内容 |
| --- | --- |
| 单元 | Service 业务规则、工具参数校验、时间解析 |
| 集成 | API + DB：任务 CRUD、清单删除迁移、越权访问（403）、注册事务 |
| 契约 | SSE 事件类型与字段（mock DeepSeek 返回固定 tool_calls） |
| LLM 场景回归 | 用固定 Prompt 集（创建/查询/歧义/删除确认/批量/闲聊）跑工具选择与参数正确率 |
| 前端 E2E | 登录→建任务→对话创建/删除→双 Tab 一致性（Playwright 移动视口） |
| 兼容 | Safari(iOS)、Chrome(Android)、微信 WebView 走查（UX 9.2） |

---

## 12. 需求追溯与实现范围

| PRD 需求 | 设计落点 |
| --- | --- |
| T-01～T-08 | Task 模块 + §5 表 + §6.2 REST + §11.3 测试 |
| C-01～C-09 | Chat 模块 + SSE 协议 + §4.1 状态机 + §7 |
| 能力对等（PRD 5.3） | 双路径共用 TaskService（§10.3），工具表 §7.3 |
| 邮箱+密码、无验证码（6.3） | §8 安全、§10.1 注册流程、auth 接口 |
| 云端瘦客户端、无离线（1.3/6.2） | §3.2 前端约束、错误态不回显旧数据 |
| DeepSeek deepseek-flash（5.7） | §7 LLM 网关、§9.4 配置化 |
| 可观测（6.5）/指标（9） | tool_invocations 审计 + §9.2/9.3 |

### 12.1 本期明确不实现（避免过度设计）

Redis 强依赖、WebSocket 多端实时推送、消息已读、富文本/多模态、刷新 Token 轮换体系、微服务拆分、K8s 编排、多级缓存——均不进入 MVP，预留演进位置即可。
