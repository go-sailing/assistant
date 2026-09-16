# 个人助手（Personal Assistant）MVP

用「说一句话」和「点一下列表」两种方式管理个人待办事项。核心特点是 **LLM 聊天具备任务管理的全部能力**——凡是能在任务列表里手动完成的操作，都能通过对助手说一句话完成，两条入口读写同一份云端数据。

> 当前为 **MVP 版本**，形态是移动端 Web（H5），全云端架构，不做本地存储与离线。

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
- [MVP 非目标](#mvp-非目标)
- [安全提示](#安全提示)

---

## 功能范围

### 任务管理

- 任务的创建、查看、编辑、删除、完成/取消完成
- 清单管理：内置默认清单 + 自定义清单（新建/重命名/删除，删除清单时其内任务自动迁移至默认清单）
- 任务字段：标题、备注、优先级（无/低/中/高）、截止时间、所属清单
- 列表支持按清单切换、按状态筛选、按截止时间或创建时间排序、关键词搜索
- 逾期任务时间标红、今日截止标橙

### LLM 对话

- 一句话完成任务的增、删、改、查、完成、清单归类与批量操作
- 自动解析相对时间（"下周一上午10点" → 绝对时间）与清单归属
- 对话中的任务以结构化卡片呈现，与任务列表数据实时一致
- **危险操作强制二次确认**：删除任务、删除清单、批量修改在执行前展示影响范围并要求用户确认
- **歧义必须澄清**：对象不明确时列出候选让用户选择，禁止猜测执行写操作
- 多轮上下文，支持"把它改成高优先级"这类指代

### 账号

- 邮箱 + 密码注册与登录，**不做验证码、不做邮箱激活、不做自助找回密码**

---

## 技术栈

| 层 | 选型 |
| --- | --- |
| 前端 | Vue 3 + Vite + TypeScript + Pinia + vue-router（原生 CSS 实现 Design Token，无 UI 库） |
| 后端 | Node.js 18 + TypeScript + Express |
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
npm run dev          # 启动在 http://localhost:3000，首次启动自动执行数据库迁移
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

用手机浏览器访问 `http://<本机IP>:5173`，或用桌面浏览器切到移动视口（如 390×844）使用。

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
| `DEEPSEEK_API_KEY` | 空 | DeepSeek 密钥；**缺失时对话功能不可用，任务管理功能不受影响** |
| `DEEPSEEK_BASE_URL` | `https://api.deepseek.com` | API 地址 |
| `DEEPSEEK_MODEL` | `deepseek-flash` | 模型名（以官方 `/models` 接口返回为准，可选 `deepseek-flash` / `deepseek-v4-pro`） |
| `DEEPSEEK_TIMEOUT_MS` | `60000` | 单次调用超时 |
| `DEEPSEEK_MAX_RETRY` | `2` | 失败重试次数 |
| `CHAT_HISTORY_LIMIT` | `20` | 注入模型的最近消息条数 |
| `PENDING_ACTION_TTL_SECONDS` | `300` | 待确认操作有效期 |
| `RATE_LIMIT_AUTH_PER_MIN` | `20` | 登录/注册限流（次/分钟/IP） |
| `RATE_LIMIT_CHAT_PER_MIN` | `20` | 对话限流（次/分钟/用户） |

---

## 项目结构

```
.
├── docs/mvp/                      # 产品与技术文档
│   ├── PRD-个人助手MVP.md
│   ├── UXUI设计文档-个人助手MVP.md
│   ├── 系统设计文档-个人助手MVP.md
│   ├── 测试用例文档-个人助手MVP.md
│   └── 测试报告-个人助手MVP.md
└── src/
    ├── docker-compose.yml         # PostgreSQL
    ├── server/                    # 后端
    │   └── src/
    │       ├── config/            # 配置加载
    │       ├── common/            # 错误码、统一响应、校验、日志
    │       ├── db/                # 连接池、迁移器、SQL 迁移文件
    │       ├── middleware/        # 鉴权、限流
    │       ├── modules/
    │       │   ├── auth/          # 注册/登录/注销
    │       │   ├── list/          # 清单
    │       │   ├── task/          # 任务（领域服务 + REST）
    │       │   └── chat/          # 会话、消息、对话编排（SSE）
    │       ├── llm/               # DeepSeek 适配器、工具定义、系统提示词
    │       └── tools/             # LLM 工具执行器（参数校验 + 审计）
    └── web/                       # 前端
        └── src/
            ├── api/               # HTTP 客户端与 SSE 消费
            ├── stores/            # Pinia 状态
            ├── router/            # 路由与登录守卫
            ├── styles/            # Design Token 与全局样式
            ├── utils/             # 时间格式化、校验、凭证
            ├── components/        # 通用组件 + 对话组件
            └── views/             # 页面（auth / tasks / chat）
```

---

## 核心设计

### 双入口能力对等

`TaskService` 是任务领域的**唯一入口**：REST 控制器与 LLM 工具执行器都调用同一组领域方法，因此业务规则（标题校验、默认清单保护、删清单迁移任务、完成时间戳）只实现一次，手动操作与对话操作的结果必然一致。

```
REST 请求 ─┐
           ├─→ TaskService → PostgreSQL
LLM 工具 ─┘
```

### 危险操作由服务端门控

删除任务、删除清单、批量修改即使被模型调用也**不会立即执行**：服务端先预取受影响对象、落一条待确认记录（`pending_actions`），把影响范围推给前端渲染确认条；用户确认后才按固化的参数精确执行。安全边界由服务端强制，不依赖模型自觉。

### 对话流式协议（SSE）

`POST /api/v1/conversations/:id/chat` 返回 `text/event-stream`，事件类型：

| 事件 | 说明 |
| --- | --- |
| `meta` | 请求已受理（含 message_id、trace_id） |
| `text_delta` | 助手文本增量（逐字输出） |
| `tool_call` | 模型请求调用工具（前端可展示处理中） |
| `cards` | 任务卡片数据（始终为云端最新值） |
| `clarify` | 需要用户澄清，附带候选任务 |
| `confirm` | 危险操作待确认，附带影响范围 |
| `done` | 本轮结束 |
| `error` | 错误（含是否可重试） |

助手消息以结构化 `payload.blocks` 落库，**历史回看与实时流式复用同一套渲染模型**。

---

## 接口概览

Base URL：`/api/v1`；除注册登录外均需 `Authorization: Bearer <token>`。
统一响应包裹：`{ "code": 0, "message": "ok", "data": {...} }`。

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| POST | `/auth/register` `/auth/login` `/auth/logout` | 注册 / 登录 / 登出 |
| DELETE | `/auth/me` | 注销账号（需 `confirm: true`） |
| GET/POST | `/lists` | 查询 / 新建清单 |
| PATCH/DELETE | `/lists/:id` | 重命名 / 删除清单 |
| GET/POST | `/tasks` | 查询（筛选/排序/分页）/ 创建任务 |
| GET | `/tasks/search?keyword=` | 关键词搜索 |
| GET/PATCH/DELETE | `/tasks/:id` | 详情 / 编辑 / 删除 |
| POST | `/tasks/:id/complete` `/tasks/:id/uncomplete` | 完成 / 取消完成 |
| POST | `/tasks/batch-update` | 批量更新 |
| GET/POST | `/conversations` | 会话列表 / 新建会话 |
| GET | `/conversations/:id/messages` | 历史消息 |
| PATCH/DELETE | `/conversations/:id` | 重命名 / 删除会话 |
| POST | `/conversations/:id/chat` | **发送消息（SSE 流式）** |
| POST | `/conversations/:id/pending-actions/:paId/confirm` `.../cancel` | 确认 / 取消待确认操作 |

完整定义见 [系统设计文档 §6](docs/mvp/系统设计文档-个人助手MVP.md)。

---

## 数据库

由 `src/server/src/db/migrations/*.sql` 版本化管理，启动时自动执行（记录于 `schema_migrations` 表）。

| 表 | 说明 |
| --- | --- |
| `users` | 账号（bcrypt 哈希密码） |
| `task_lists` | 清单（每用户唯一默认清单，由部分唯一索引保证） |
| `tasks` | 任务（含 `source` 字段区分手动/对话创建） |
| `conversations` / `messages` | 会话与消息（消息 `payload` 存结构化内容块） |
| `pending_actions` | 待确认的危险操作 |
| `tool_invocations` | LLM 工具调用审计（入参、结果、耗时、trace_id） |

所有业务查询强制携带 `user_id`，防止水平越权。

---

## 测试

测试用例与执行结果见：

- [测试用例文档](docs/mvp/测试用例文档-个人助手MVP.md) —— 8 个章节共 133 项用例
- [测试报告](docs/mvp/测试报告-个人助手MVP.md) —— 执行结果、缺陷清单与发布建议

**当前测试结论：不建议直接发布。** 主要原因是 P0 用例 `TC-CHAT-015`（对话完成/取消完成）在超长会话中存在间歇性失败，指向长上下文指代消解能力，需专项优化后重跑稳定性回归。详见测试报告第 4 章。

---

## MVP 非目标

以下均**明确不做**，避免范围蔓延：

- 原生 App（iOS/Android 安装包）与 PC 端专门适配
- 本地存储与离线能力（断网不可用，端上仅存登录凭证）
- 本地通知与消息推送
- 短信/邮箱验证码、邮箱激活、自助找回密码
- 多人协作、任务指派、共享清单
- 日历、习惯打卡、笔记、记账
- 第三方服务集成（邮箱、IM、日历账号）
- 语音输入与多模态、插件市场与自定义 Agent

---

## 安全提示

- **`src/server/.env` 含真实 DeepSeek API Key，已加入 `.gitignore`，切勿提交。**
- `JWT_SECRET` 默认值仅供本地开发，部署前必须更换为随机强密钥。
- DeepSeek API Key 仅在服务端使用，不会下发到前端。
- 生产部署需由网关（Nginx 等）终止 TLS，全链路 HTTPS。
- 当前登出黑名单与限流基于**内存**实现，多实例部署时需替换为 Redis。