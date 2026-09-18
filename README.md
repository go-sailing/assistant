# 个人助手（Personal Assistant）

用「说一句话」和「点一下列表/日历」两种方式管理个人待办与日程。核心特点是 **LLM 聊天具备任务与日程管理的全部能力**——凡是能在列表、日历里手动完成的操作，都能通过对助手说一句话完成，两条入口读写同一份云端数据。

> 当前形态是移动端 Web（H5），全云端架构，不做本地存储与离线。

**已交付版本**

| 版本 | 主题 | 状态 |
| --- | --- | --- |
| MVP v0.3 | 任务管理 + 具备同等能力的 LLM 对话 | 已交付 |
| v0.1.0 | 日程管理（含任务日程） + 日历视图 + 冲突检测 | 已交付，测试通过（详见 [测试报告](docs/v0.1.0/测试报告-个人助手v0.1.0.md)） |
| v0.2.0 | 循环日程 + 子任务 + 导航重构（底部 Tab → 左侧抽屉） | 已交付，测试通过（详见 [测试报告](docs/v0.2.0/测试报告-个人助手v0.2.0.md)） |
| **v0.3.0** | 日历体验重构（折叠看本周 + 直达详情）+ 每年指定月日 + 清单弹层 + 子任务入口收敛 + 助手单会话化 | 已交付，测试通过（详见 [测试报告](docs/v0.3.0/测试报告-个人助手v0.3.0.md)） |
| **v0.4.0** | **法定工作日历 + 农历（含农历日程）+ 主页智能折叠与独立滚动 + 任务扁平化 + 助手方案化 + Markdown + 登录态续期 + 个人信息与设置** | **已交付**（详见 [测试报告](docs/v0.4.0/测试报告-个人助手v0.4.0.md)：277 项用例，通过 215 / 失败 8） |

---

## 目录

- [功能范围](#功能范围)
- [技术栈](#技术栈)
- [快速开始](#快速开始)
- [环境变量](#环境变量)
- [容器化与镜像发布](#容器化与镜像发布)
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
- **子任务树只在任务详情页**（v0.4.0 起任务首页彻底扁平化）：任务首页只列根任务、**不再有展开箭头/子树/行内「添加子任务」**，仅保留只读的「已完/总数」进度摘要
- 任务详情页含父子面包屑（可逐级跳转）、子任务分区（树 + 进度条）、**移动层级**（挂到别的任务下 / 移出为顶层）、「添加子任务」入口；给更深层任务加下级需逐层点进对应子任务详情（第 5 级入口置灰）
- 父任务进度为**直接子任务**口径：三态复选框（部分完成显示 `mixed`），勾选子任务不会自动完成父任务
- **级联完成两阶段**：完成仍有未完成子任务的父任务时，先返回 `4010` 告知数量，用户确认后才在同一事务内完成父与全部未完成后代
- **非对称联动**：取消父任务的完成状态**不会**级联到子任务；向已完成父任务新增/移入**未完成**子任务时，父任务自动恢复为未完成并在响应与对话中告知
- 删除任务 = 删除整棵子树及其全部任务日程（单事务，返回 `deleted_task_count` / `deleted_event_count`）
- 搜索仍可命中**任意层级**的子任务（结果行带父级路径，可直达其详情）

### 日程管理（v0.1.0）

- **两类日程**：
  - **普通日程**：用户自己要安排的一件事（自填标题）
  - **任务日程**：为某个**已有任务**安排的执行时段，链接该任务；标题/优先级/完成态实时取关联任务，不存冗余副本
- **日历视图（v0.4.0 重构）**：月视图（日期格含**公历数字 + 农历副字 + 法定「休/班」角标 + 标记点**，标记点区分普通/任务/循环/聚合）+ 主页当日列表（全天分组置顶、按开始时间升序）；页面为**三段固定布局**——头部/月历/折叠开关/标题条固定，**只有当日列表区独立滚动**（列表最小高度 38dvh）；进主页时按选中日条数**自动定型**（≥3 项折叠、<3 项展开），手动切换后本次停留不再被重算；~~当日视图（时间轴 / 当前时间参考线 / 进行中高亮）~~ 已在 v0.3.0 下线，编辑/删除/作用域/任务勾选全部由日程详情页承接
- 日程字段：标题、开始/结束时间、全天、地点、备注；跨日与全天日程按日期左闭右开存储
- **时间冲突检测**：时间段左闭右开相交即判冲突（端点相接不算），区分 `overlap` 与 `all_day` 两级提示；**冲突只提示不阻止**，用户确认「仍要保存」才落库
- **任务排期**：任务详情「安排日程」或新建日程选「任务日程」，同一任务可有多条排期（分段执行）
- 日程侧勾选完成 = 完成关联任务（日程本身无完成状态）
- **删除联动**：删除任务日程只取消安排、保留任务；删除任务则级联删除其全部任务日程（确认文案明示条数）
- 日程搜索（标题/地点/备注，任务日程同时匹配任务标题）

### 循环日程（v0.2.0）

- 支持**每天 / 每周 / 每月 / 每年** + 间隔（每 2 周、每 3 天…）+ 每周多选星期 / **法定工作日**（v0.4.0，`week_mode=workdays_cn`：避开放假、含调休补班）/ 每月同日（超月落到月末）/ 每月第 N 个或最后一个周 X / 每年**可指定公历月日**（v0.3.0）或**指定农历月日**（v0.4.0，`by_lunar_month_day`，公历日期逐年浮动）
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
- **一句话建循环日程**（"每周一和周四晚上8点健身，重复8次"）：口语解析为结构化规则，多选星期、间隔、月内规则与结束条件均支持；**支持「每个工作日」**（按法定工作日历展开，避开放假、含补班）与**「每年农历八月十五」**（农历年度循环）
- **方案优先（v0.4.0）**：写操作意图明确、只缺非关键参数时，助手**不再逐个追问**，而是用合理默认补齐后给出一张**方案卡**（参数行 + 「助手默认值」标记 + 默认项说明 + 「就这么办 / 调整一下」），用户一次确认即执行
- **循环实例的作用域写操作**：用户说「这次/这周一次」→ 仅本次（可恢复）；「以后都」→ 整条；「从下次开始」→ 本次及以后（截断 + 派生）；**作用域不明确时先澄清（推荐仅本次），禁止默认按整条执行**
- 自动解析相对时间（"下周一上午10点"→绝对时间）与清单归属；只给开始时间时默认 +1 小时并明示
- 对话中的任务/日程/系列/实例/子任务组均以结构化卡片呈现，与列表、日历数据实时一致
- **危险操作强制二次确认**：删除任务（含子树与日程计数）、删除清单、批量修改、**删除整条循环系列**（含总次数与下一次）、删除日程、批量取消日程
- **时间冲突先告知**：命中冲突时不落库，先在对话中陈述冲突（循环按日期分组），用户明确同意后才带 `confirm_conflict` 重新提交
- **硬边界仍必须打断（v0.4.0）**：多候选对象、关联对象不存在、时间已过、时间无法换算（"节后""找个有空的下午"）、删除/批量等危险操作、时间冲突、越权与超出能力，一律按原规则澄清或确认，**方案化不得绕过**；危险操作在方案确认之后仍会再过一次系统 `pending` 确认（刻意的双层保护）
- **禁止猜测关联**：为任务排期/加子任务必须先查证真实 ID，多候选先澄清，父任务或实例不存在先询问/如实告知
- 多轮上下文，支持"把它改成高优先级""它再往后延一周"这类指代；历史卡片按云端最新数据刷新（系列按新规则重算摘要、实例重算「已调整/已取消」、子任务组按根重新拉取，已删除对象渲染占位）

### 账号（v0.4.0 扩展）

- 邮箱 + 密码注册与登录，**不做验证码、不做邮箱激活、不做自助找回密码**
- **登录态续期**：access 凭证（JWT，2h）+ refresh 凭证（不透明串，30 天滑动、每次使用轮转），前端静默续期与 401 自动重放，长时间使用不再被突兀踢回登录页
- **个人信息页**（`/me`）：昵称（≤20 字符，可空）、邮箱（只读）、注册时间、修改密码、清除聊天记录、退出登录、注销账号
- **系统设置页**（`/settings`）：显示农历、二十四节气、默认启动页（日程/任务）、清除聊天记录、修改密码、关于

### v0.4.0 体验改动

**法定工作日历（H-01）**

- 新增 `work_calendar_days` 表（只存偏离默认周历的特殊日：`holiday` 法定放假 / `makeup` 调休补班），数据以**国务院办公厅年度节假日安排通知**为准随迁移录入（当前覆盖 2025、2026）
- 循环日程的「每周」新增第三种模式**工作日（法定）**：逐自然日按法定日历判定，**避开放假、调休补班的周末照常执行**；与「周一至周五」（字面星期）严格区分，二者互斥
- 该模式不支持隔周（`interval` 固定 1）；**未公布年份回退为周一至周五**，并在系列详情说明「公布前按周一至周五计算，公布后自动更新」（数据补齐后提示自动消失）
- 月历日期格显示**「休」/「班」角标**与节假日名（如「中秋」「国庆」）；角标**不受农历开关控制**

**农历（N-01，含农历日程）**

- 月历日期格显示**农历副字**，按优先级只显示一个：法定节假日名 ＞ 农历传统节日 ＞ 二十四节气 ＞ 农历月名（初一） ＞ 农历日序；范围限定 **1900-01-31 ~ 2100-12-31**（越界不显示副字、不报错）
- 传统节日与节气均为**服务端白名单**（11 个节日 + 24 节气，不直接透出历法库的全部节日）
- **单次日程支持按农历日期创建**：新建表单可在「公历 / 农历」间切换（正月..腊月 × 初一..三十），服务端换算后以公历落库，**不保存农历来源**（故编辑已有日程时固定按公历）
- **年度循环支持「每年农历月日」**：如「每年农历八月十五」「每年腊月三十」，公历日期逐年浮动；腊月三十遇小月自动落廿九（除夕天然成立）；首次实例为**不早于系列开始时间的第一个候选**（如 9 月建「每年正月初一」→ 首次落在次年春节）
- 换算与展开全部在服务端完成（历法库隔离在单一 wrapper 内），**前端不内置任何历法/假日数据**；农历在月历、标题条、日程详情、对话卡片四处同源显示，可在设置中关闭（关闭后角标仍保留）

**主页：智能折叠与独立滚动（C-01）**

- 三段固定布局：头部 / 月历 / 折叠开关 / 当日标题条固定，**只有当日列表区独立滚动**（列表最小高度 38dvh，页面整体不滚、无橡皮筋）
- **进入主页按选中日条数自动定型**：≥3 项折叠为一周一行、<3 项展开整月；定型只发生一次且**无"先展开后收起"跳动**（骨架期开关条隐藏），用户手动切换后本次停留不再被重算，重新进入才重算

**任务扁平化（T-01）**

- 任务首页删除子任务树展开与行内「添加子任务」，只列根任务 + 只读进度摘要；**子任务树与添加入口仅在任务详情页**

**助手方案化（A-01）与 Markdown（M-01）**

- 新增 `present_proposal` 呈现型工具与 SSE `proposal` 块：方案卡是**对话层概念**，无副作用、不落 `pending`；用户确认后模型按方案参数重新调用真实工具，届时照常经过全部服务端门控
- 系统提示词补充默认策略表（时间/时长/结束条件/清单/作用域/多步合并）并明确"替用户补的默认值必须如实标记"
- 助手消息按**白名单 Markdown**渲染（标题/加粗/列表/代码块/引用/链接），原始 HTML、图片、表格与非 http(s) 链接一律不渲染；**用户消息保持纯文本**

**聊天定位与登录态（缺陷修复）**

- 修复"打开聊天页停在最早消息"：渲染稳定后锚定最新（含卡片异步刷新后仍贴底）；阅读位置仅用于"页内跳详情再返回"（内存态），冷启动一律锚定最新；上翻时新消息只出「↓ 新消息」胶囊，不强制拉回
- 修复"普通日程改为重复日程无效"：补齐"无规则 → 有规则"更新分支（含 90 天冲突扫描与二次确认），规则真实落库
- 修复"使用中突发登录失效"：见上文「账号（v0.4.0 扩展）」

### v0.3.0 体验改动

**日历主页（重构）**

- **折叠看本周**：月历下沿开关可把 6 行月网格收成「选中日所在周」一行；折叠态下 ‹ › 与横滑按**周**（±7 天）切换，头部年月跟随选中日；再点开关展开回整月并定位到选中日所在月份
- **折叠态跨月周**：周行可能横跨两个月，邻月标记点按需补齐（已拉取月份走缓存），**邻月补齐失败只缺点不阻断**，当前月失败才走错误态
- **整页滚动 + 标题条吸顶**：导航栏随页面滚走，日期标题条吸顶；当日日程**全量展示**（取消原来的 3 条预览与「查看全部」）
- **日期信息去重**：列表标题只表达「相对日 + 星期 + 日序」（`今天 周三` / `周三 17 日`），月/年由头部承载
- **item 直达详情**：普通/任务日程 → 日程详情，循环实例 → 实例视角详情；**当日列表页（`/calendar/day`）下线**（旧链重定向到 `/calendar` 并透传 `date`）
- **全天分组**：全天日程置顶成组，定时日程按开始时间升序；不再渲染竖向时间轴与当前时间线
- **宽屏中栏**：登录后页面内容限宽 **480px** 居中，月格宽度按容器计算（不再用 `100vw`，修掉宽屏格子异常放大）；抽屉/FAB/Toast 仍相对视口定位

**每年指定月日（yearly 加强）**

- 「每年」重复可**指定月日**（如「每年 6 月 1 日体检」），不再被首次开始日期锁死；表单为月/日双下拉，改过月日后不被开始日期覆盖（touched 策略同 weekly 星期）
- 首次实例 = **不早于系列开始时间的第一个候选**：指定月日本年已过则落到次年（如 9 月建「每年 6 月 1 日」→ 首次 2027-06-01），间隔年同理；`count` 从首次实例起算
- 2 月 29 日平年落 2 月 28 日、29/30/31 日遇到小月落当月最后一天；摘要在末尾追加括注，跨年时弹层预览额外提示「首次安排」
- 对话侧同等支持（"每年 6 月 1 日提醒我体检"）；**「每年第 N 个周 X」仍不支持**，助手会追问具体月日或如实说明

**清单与子任务交互修正**

- 清单新建/重命名改为**底部表单弹层**（输入框全宽、确认与取消纵向排布、打开即聚焦并全选、失败在弹层内联报错且不丢输入），修掉原先行内输入框被挤压到极小的问题
- 子任务**添加入口收敛**：删除子任务行右侧的「＋」；只有**根任务**（任务首页）与**当前任务**（任务详情页）的子树底部保留「添加子任务」，「孙任务」的唯一手动创建路径是**进入子任务详情页添加**；第 5 级入口置灰并提示上限
- 对话入口不受影响（仍可经助手直接创建任意合法层级）

**助手单会话化**

- 每个用户**有且仅有一个会话**：`POST /conversations` 改为幂等 get-or-create（并发安全，无重复行），会话列表页、新建/重命名/删除会话全部下线
- `/chat` 直接就是对话页（URL 不再跳 `/chat/:id`，旧链重定向），顶部为汉堡 + 固定标题「助手」+ 更多菜单
- 「删除会话」替换为**清除聊天记录**：一个事务删除该会话全部消息与待确认动作、标题重置，**会话本身保留**，任务/日程/清单数据不受影响；前端清空消息区并回到首次引导空态（不做二次确认以外的额外步骤）

---

## 技术栈

| 层 | 选型 |
| --- | --- |
| 前端 | Vue 3 + Vite + TypeScript + Pinia + vue-router（原生 CSS 实现 Design Token，无 UI 库）；`markdown-it` + `dompurify`（助手消息白名单渲染） |
| 后端 | Node.js 18 + TypeScript + Express（模块化单体）；`lunar-javascript`（农历/节气换算，隔离在单一 wrapper 内） |
| 数据库 | PostgreSQL 15（Docker） |
| LLM | DeepSeek 官方 API，模型 `deepseek-flash`，Function Calling + SSE 流式输出 |
| 鉴权 | access：JWT（Bearer Token，2h） + refresh：不透明令牌（30 天滑动轮转，只存 SHA-256 哈希）；bcrypt 密码哈希 |
| 部署 | Docker 多阶段镜像（后端 node:22-alpine / 前端 nginx + 同源反代），GitHub Actions 多架构构建推送 GHCR（见[容器化与镜像发布](#容器化与镜像发布)） |

---

## 快速开始

### 前置条件

- Node.js 18+
- Docker（用于启动 PostgreSQL）
- 一个 DeepSeek API Key（[获取地址](https://platform.deepseek.com/)）

### 1. 启动数据库

```bash
cd src
docker compose up -d postgres   # 只起数据库；起全套（用 CI 镜像）见「容器化与镜像发布」
```

### 2. 配置并启动后端

```bash
cd src/server
cp .env.example .env
# 编辑 .env，填入 DEEPSEEK_API_KEY
npm install
npm run dev          # 启动在 http://localhost:3000，首次启动自动执行数据库迁移（001~009）
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

用手机浏览器访问 `http://<本机IP>:5173`，或用桌面浏览器切到移动视口（如 390×844）使用。注册/登录后默认落在**日程主页**（可在「设置 → 默认启动页」改为任务页，深链 `?redirect=` 优先）；导航为**左上角菜单按钮唤起的左侧抽屉**（日程 / 任务 / 助手 + 底部账号区，账号区可点进个人信息页、齿轮进设置页），**右下角浮动按钮**在日程与任务页为「打开助手」，`/chat` 自身与其他页面隐藏。

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
| `JWT_EXPIRES_IN` | `2h` | access 令牌有效期 |
| `ACCESS_CLOCK_TOLERANCE_SEC` | `30` | **（v0.4.0）** JWT 时钟容忍（秒），消除时钟偏差导致的伪 401 |
| `REFRESH_TOKEN_TTL_DAYS` | `30` | **（v0.4.0）** refresh 令牌有效期（天，滑动：每次使用轮转续期） |
| `RATE_LIMIT_REFRESH_PER_MIN` | `10` | **（v0.4.0）** `/auth/refresh` 限流（次/分钟/IP） |
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
| `WORK_CALENDAR_COUNTRY` | `CN` | **（v0.4.0）** 法定工作日历国家/地区（当前仅支持 `CN`，数据见迁移 007） |

---

## 容器化与镜像发布

### 镜像构成

| 镜像 | Dockerfile | 基础镜像 | 说明 |
| --- | --- | --- | --- |
| server | [src/server/Dockerfile](src/server/Dockerfile) | `node:22-alpine` | 多阶段构建：`tsc` 编译 → 仅拷贝产物 + 生产依赖 + 迁移 SQL（`dist/db/migrations`），以非 root 用户 `node` 运行；启动时按 `DB_AUTO_MIGRATE` 自动迁移；健康检查走 `/healthz`（含数据库探测） |
| web | [src/web/Dockerfile](src/web/Dockerfile) | `nginx:1.27-alpine` | 多阶段构建：`vue-tsc + vite build` → nginx 托管静态产物；同源反向代理 `/api` 到后端（**已关闭 proxy_buffering**，保证对话 SSE 正常流式返回）；SPA 路由回落 `index.html`，带内容指纹的 `/assets/*` 强缓存 |

### compose 一键起（使用 CI 镜像）

[src/docker-compose.yml](src/docker-compose.yml) 已编排 `postgres` + `server` + `web`，其中后端与前端**直接拉取 CI 推送到 GHCR 的镜像，不在本地构建**（镜像标签由 `docker-publish.yml` 产出）：

```bash
cd src
# 可选：把 JWT_SECRET / DEEPSEEK_API_KEY 写进 src/.env，compose 会自动读取
docker compose up -d                           # 全套：http://localhost:8080
docker compose up -d postgres                  # 只起数据库（本地 npm run dev 时用）
docker compose pull && docker compose up -d    # 更新到 CI 最新镜像
```

- `latest` 可换成 CI 产出的任意标签：分支名、`v0.4.0`、`sha-xxxxxxx`；包为私有时需先 `echo <PAT> | docker login ghcr.io -u <用户名> --password-stdin`
- 容器内 `DATABASE_URL` 指向 compose 服务名 `postgres`（不是 `localhost`），`DB_AUTO_MIGRATE` 默认开启，首次启动自动迁移 001~009
- `server` 的宿主端口 `3000` 便于直接 curl；本机若已在跑 `npm run dev` 需错开或先停掉
- 与本地开发共用同一个数据卷 `assistant_pgdata` 与库 `assistant`，两种方式连的是同一份数据

### 本地构建与运行（可选）

```bash
# 后端（必需 DATABASE_URL / JWT_SECRET）
docker build -t assistant-server src/server
docker run -d --name assistant-server -p 3000:3000 \
  -e DATABASE_URL='postgres://assistant:assistant_pwd@<db-host>:5432/assistant' \
  -e JWT_SECRET='change-me' \
  -e DEEPSEEK_API_KEY='<key>' \
  assistant-server

# 前端（API_UPSTREAM 指向后端地址，默认 http://server:3000）
docker build -t assistant-web src/web
docker run -d --name assistant-web -p 8080:80 \
  -e API_UPSTREAM='http://assistant-server:3000' \
  assistant-web
```

容器运行时可配的环境变量：**后端**同[环境变量](#环境变量)章节（`PORT`/`DATABASE_URL`/`JWT_SECRET`/`DB_AUTO_MIGRATE`/DeepSeek 相关等）；**前端**仅 `API_UPSTREAM`（后端基址）与 `API_PROXY_TIMEOUT`（SSE/长请求超时秒数，默认 300）。

### CI 自动构建推送

工作流：[.github/workflows/docker-publish.yml](.github/workflows/docker-publish.yml)

| 项 | 配置 |
| --- | --- |
| 触发 | 推送 `master`/`main`、推送 `v*` 标签、Actions 页面手动触发 |
| 推送目标 | GitHub Container Registry：`ghcr.io/<owner>/<repo>/server`、`ghcr.io/<owner>/<repo>/web` |
| 标签 | 分支名、标签名（如 `v0.4.0`）、`sha-<短哈希>`；默认分支额外打 `latest` |
| 架构 | `linux/amd64` + `linux/arm64`（多架构 manifest，`PLATFORMS` 可按需精简） |
| 认证 | 使用内置 `GITHUB_TOKEN`（`packages: write`），无需配置任何 secret |
| 缓存 | `type=gha` 分层缓存，二次构建明显加速 |

```bash
# 拉取并运行 CI 产出的镜像
docker pull ghcr.io/<owner>/<repo>/server:latest
docker pull ghcr.io/<owner>/<repo>/web:latest
```

注意事项：

- 首次推送后，包会出现在仓库的 Packages 页；若推送失败并提示权限不足，检查 **Settings → Actions → General → Workflow permissions** 是否为 "Read and write permissions"。
- 如需改用 Docker Hub：把 `env.REGISTRY` 改为 `docker.io`、镜像名前缀改为自己的命名空间，并新增 `DOCKERHUB_USERNAME` / `DOCKERHUB_TOKEN` 两个 secret 供 `docker/login-action` 使用。

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
│   ├── v0.2.0/                    # v0.2.0（循环日程 / 子任务 / 导航重构）产品与技术文档
│   │   ├── PRD-个人助手v0.2.0.md
│   │   ├── UXUI设计文档-个人助手v0.2.0.md
│   │   ├── 系统设计文档-个人助手v0.2.0.md
│   │   ├── 测试用例文档-个人助手v0.2.0.md
│   │   └── 测试报告-个人助手v0.2.0.md
│   ├── v0.3.0/                    # v0.3.0（日历折叠/直达 · 每年指定月日 · 清单弹层 · 子任务入口 · 单会话）
│   │   ├── PRD-个人助手v0.3.0.md
│   │   ├── UXUI设计文档-个人助手v0.3.0.md
│   │   ├── 系统设计文档-个人助手v0.3.0.md
│   │   ├── 测试用例文档-个人助手v0.3.0.md
│   │   └── 测试报告-个人助手v0.3.0.md
│   └── v0.4.0/                    # v0.4.0（法定工作日历 · 农历 · 智能折叠 · 任务扁平化 · 方案化助手 · 登录态 · 账号设置）
│       ├── PRD-个人助手v0.4.0.md
│       ├── UXUI设计文档-个人助手v0.4.0.md
│       ├── 系统设计文档-个人助手v0.4.0.md
│       ├── 测试用例文档-个人助手v0.4.0.md
│       └── 测试报告-个人助手v0.4.0.md
├── .github/workflows/             # CI：docker-publish.yml（多架构构建并推送 GHCR）
└── src/
    ├── docker-compose.yml         # 编排 postgres + server + web（应用服务使用 GHCR 上的 CI 镜像）
    ├── server/                    # 后端
    │   ├── Dockerfile             # 多阶段构建（tsc → 生产依赖 + 迁移 SQL，非 root 运行）
    │   └── src/
    │       ├── config/            # 配置加载
    │       ├── common/            # 错误码、统一响应、校验、日志
    │       ├── db/                # 连接池、迁移器、SQL 迁移文件（001~009）
    │       ├── middleware/        # 鉴权（access + refresh 校验、时钟容忍）、限流
    │       ├── modules/
    │       │   ├── auth/          # 注册/登录/登出/注销 + 刷新令牌轮转 + 修改密码
    │       │   ├── settings/      # v0.4.0：个人信息（/me）与偏好设置（/settings）
    │       │   ├── list/          # 清单
    │       │   ├── task/          # 任务（领域服务 + REST，含子树/级联完成）
    │       │   ├── event/         # 日程（领域服务 + REST + 参数校验 + 冲突）
    │       │   │   ├── recurrence/    # 循环引擎：纯函数展开 + 规则摘要 + 规则类型
    │       │   │   ├── lunar/         # v0.4.0：历法换算 wrapper（农历/节气/节日白名单，隔离第三方库）
    │       │   │   ├── workday/       # v0.4.0：法定工作日判定（整表进程内载入 + 缓存）
    │       │   │   ├── occurrence.service.ts  # 实例虚拟展开、例外覆盖、作用域写操作
    │       │   │   └── sql.ts         # 日程域公共 SQL 片段与单次冲突查询
    │       │   └── chat/          # 会话（单会话 get-or-create / 清除聊天记录）、对话编排（SSE，含 proposal 方案块）、历史卡片云端刷新
    │       ├── llm/               # DeepSeek 适配器、工具定义（含 present_proposal / resolve_lunar_date）、系统提示词（方案优先）
    │       └── tools/             # LLM 工具执行器（参数校验 + 确认门控 + 审计）
    └── web/                       # 前端
        ├── Dockerfile             # 多阶段构建（vite 打包 → nginx 托管 + /api 反代）
        ├── nginx/                 # default.conf.template（SPA 回落、SSE 不缓冲、静态强缓存）
        └── src/
            ├── api/               # HTTP 客户端（静默续期 + 401 重放）与 SSE 消费、settings API
            ├── stores/            # Pinia 状态（chat / conversation 唯一会话、settings 偏好、taskSync / eventSync 脏标记、drawer 抽屉态）
            ├── router/            # 路由与登录守卫（异步恢复：access 失效时先用 refresh 静默续期；含 /calendar/day 与 /chat/:id 旧链重定向；/me、/settings）
            ├── styles/            # Design Token 与全局样式（含 --content-max-width 宽屏中栏、农历/法定语义色）
            ├── utils/             # 时间格式化（含日程区间/日期键）、校验、双凭证（access + refresh）
            ├── components/        # 通用组件（含 AppDrawer 抽屉账号区、AppFAB 浮动入口）
            │   ├── calendar/      # 月网格（月/周双模式 + 农历副字 + 休/班角标）、折叠开关条、RepeatSheet（每周三选一：指定星期/周一至周五/工作日（法定）；每年三选一：跟随首次/公历月日/农历月日）、ScopeSheet、冲突分组弹层
            │   ├── tasks/         # 子任务树/行、进度条、面包屑、父任务选择器、ListFormSheet 清单弹层
            │   └── chat/          # 卡片、冲突块、作用域澄清块、子任务组卡、确认条、MarkdownText（白名单渲染）、ProposalCard（方案卡）、新消息胶囊
            └── views/             # 页面（auth / calendar / tasks / chat / me）
```

---

## 核心设计

### 领域服务，双入口能力对等

`TaskService` 与 `EventService` 分别是任务、日程领域的**唯一入口**：REST 控制器与 LLM 工具执行器都调用同一组领域方法，业务规则只实现一次，因此手动操作与对话操作的结果必然一致（含校验错误码与冲突判定）。循环实例的展开与例外覆盖由 `OccurrenceService` 承载、规则推算由纯函数 `RecurrenceEngine` 承载，二者被 `EventService` 复用。

```
REST 请求 ─                        ┌─→ TaskService  ──→ 递归 CTE / 级联事务 → PostgreSQL
           ├─（同一 Service，规则一致）┤
LLM 工具 ─┘                        └─→ EventService ─┬→ RecurrenceEngine（纯函数展开，无 IO）
                                                    ├→ WorkdayService（法定工作日，整表进程内载入）
                                                    ├→ LunarService（农历换算，纯函数 + 按年缓存）
                                                    └→ OccurrenceService（例外覆盖 / 作用域写）→ PostgreSQL
```

依赖方向固定为单向：`task → event`（删除任务时级联清理其任务日程）、`chat → task/event`、`settings/auth` 独立；日程域只读任务表用于校验与展示，不反向依赖。

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

### 法定工作日历与农历：服务端单点，前端零历法数据

两者都是**服务端计算、随接口下发**，端上不内置任何历法/假日数据，因此月历、日报、详情、对话卡片天然同源：

| 能力 | 数据来源 | 计算位置 | 与循环引擎的关系 |
| --- | --- | --- | --- |
| 法定工作日 | `work_calendar_days` 表（只存偏离默认周历的 `holiday`/`makeup` 特殊日，按国务院公告录入） | `workday.service`：**整表进程内载入**后判定为纯内存操作（避免逐日查库） | weekly 新增 `week_mode=workdays_cn` 候选流：按自然日步进 + 逐日判定（不走"周内取星期"）；未录入年份回退周一~周五 |
| 农历 | `lunar-javascript`（隔离在 `lunar.service` 单一 wrapper 内） | 纯函数 + 按年缓存；对外只暴露 `solarToLunar` / `lunarToSolar` 与白名单节日/节气 | yearly 新增 `by_lunar_month_day` 候选：逐年把农历月日换算为公历日期（大小月回落由换算层处理），其余机制（`occurrence_key`、例外、作用域、90 天扫描）完全复用 |

- 存量规则的**零漂移**保证：两个新模式都是**新增可选字段**，缺省即旧语义——`week_mode` 缺省时仍按 `by_week_days` 解释，`by_lunar_month_day` 缺省时仍按公历月日解释；数据库无结构变更（纯 jsonb 字段扩展）
- 互斥与边界由 `validateRule` 单点拦截（`4011`）：`week_mode` 与 `by_week_days` 互斥、工作日模式 `interval` 固定 1、`by_lunar_month_day` 与 `by_month_day` 互斥且仅 yearly、范围限 1900~2100
- 规则摘要与补充说明由服务端单点产出（如「每个工作日 09:00，长期重复」）；「未公布年份按周一至周五计算」的提示在数据补齐后**自动消失**

### 登录态：access + refresh 双凭证

```
登录/注册 ──→ { access(JWT,2h), refresh(不透明,30天) } ──→ 前端持久化两者
请求前：access 剩余 <10min → 静默 POST /auth/refresh（并发请求共用同一个 Promise，避免轮转重放）
请求中：收到 401 → 刷新一次并重放原请求；仍 401 才清凭证跳登录（带 redirect 与原页提示）
```

| 安全要点 | 落地 |
| --- | --- |
| 只存哈希 | 库中 `refresh_tokens.token_hash` = SHA-256(48 字节随机)，无明文 |
| 轮转链 | 每次使用签发新串并给旧串写 `revoked_at` + `replaced_by` |
| 失窃检测 | 已吊销串被重放 → **吊销该用户全部活跃 refresh** 并 warn 日志（吊销在同一事务内提交后再抛错，避免回滚） |
| 主动失效 | 登出（带 refresh）吊销当前串；注销随用户级联删除；**改密吊销全部旧串并在同一事务内为当前设备签发新对**（本端不掉线、他端下次刷新即失效） |
| 独立限流 | `/auth/refresh` 单独限流（默认 10 次/分钟/IP），失败统一 `1002` 不区分"不存在/过期/已吊销" |

### 助手方案卡：呈现型工具，不绕过任何门控

v0.4.0 把助手从"缺参数就追问"改为"**先给方案、一次确认**"，但方案本身**没有任何副作用**：

```
用户指令 → LLM 调 present_proposal（呈现型工具）
         → 编排器不发 SSE 之外的任何写操作、不落 pending_actions、本轮结束（finish_reason=awaiting_proposal_confirmation）
         → 前端渲染方案卡；「就这么办」发送一条普通用户消息（文本固定），模型按**方案参数逐字**调用真实工具
         → 真实工具照常经过全部服务端门控（冲突 4009 / 危险操作 pending / 作用域澄清 / 4011 校验）
```

- 方案卡状态（`pending/executing/superseded/done`）**仅前端本地维护**，服务端不持久化；历史回看一律渲染为只读折叠摘要
- 硬边界（多候选、对象不存在、时间已过、时间无法换算、危险操作、冲突、越权、超出能力）**仍必须打断**，方案化不得绕过；危险操作因此在方案确认之后还会再过一次系统确认（刻意的双层保护）

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
- 右下角浮动按钮按当前路由分流：日程/任务页 = 打开助手，其余页面（含 `/chat` 自身）隐藏（v0.3.0 移除「新建对话」形态，会话列表已下线）
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
| `proposal` | **（v0.4.0）助手方案卡**：`{proposal_id, title, params[{label,value,defaulted}], note}`；仅呈现、无副作用，确认前不写库 |
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
| POST | `/auth/register` `/auth/login` | 注册 / 登录（返回 `{token, refresh_token, user{nickname}}`） |
| POST | `/auth/refresh` | **（v0.4.0）刷新令牌轮转**：body `{refresh_token}` → 新的一对凭证；失败统一 `1002`；独立限流 |
| POST | `/auth/logout` | 登出（body 带 `refresh_token` 时一并吊销） |
| POST | `/auth/change-password` | **（v0.4.0）修改密码**：body `{old_password,new_password}`；吊销该用户全部旧 refresh，并在响应中返回**当前设备的新凭证对**（本端不掉线） |
| DELETE | `/auth/me` | 注销账号（需 `confirm: true`） |
| GET / PATCH | `/me` | **（v0.4.0）个人信息**：读取 `{id,email,nickname,avatar_initial,created_at}` / 更新昵称（null 或 ≤20 字符） |
| GET / PUT | `/settings` | **（v0.4.0）偏好设置**：`{lunar_enabled, solar_terms_enabled, home_route}`；PUT 半量更新、键白名单（未知键 `1001`）；农历关闭时节气**生效值**为 false 但用户原始偏好被保留 |
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
| GET | `/events/monthly?year=&month=&tz=` | **月视图聚合（v0.4.0 dense）**：返回该月**逐日**数据 `{date, normal, task, recurring, lunar{month_label,day_label,festival,term}, calendar_day{type,name}}`——无日程的日期也带农历与法定角标 |
| GET | `/events/lunar/resolve?lunar_year=&month=&day=&n=&anchor=` | **（v0.4.0）农历 → 公历换算**：`n=1` 返回单个结果（含 `weekday`/`festival`/`clamped`）；`n>1` 返回从指定农历年起、不早于 `anchor` 的最多 n 个候选（年度循环表单预览）；越界 `1001` |
| GET | `/events?date=&tz=` 或 `?date_from=&date_to=&tz=` | 按日 / 日期范围查询（左闭右开，含冲突标注，**循环实例由服务端展开**）；可加 `series_id`、`recurring_only`、`include_cancelled` |
| GET | `/events/series/:id?section=&cursor=` | **循环系列详情**（规则 + 摘要 + 下一次 + 总次数 + 实例分页） |
| GET | `/events/search?keyword=` | 日程搜索（标题/地点/备注 + 关联任务标题；循环系列返回主记录） |
| POST | `/events` | 创建日程（可带 `recurrence` 建循环，含 `week_mode=workdays_cn` 与 `by_lunar_month_day`；`confirm_conflict: true` 用于冲突二次提交） |
| GET/PATCH/DELETE | `/events/:id` | 详情（可带 `occurrence_key` 取实例视角，含 conflicts）/ 编辑（`scope: series\|this\|following` + `occurrence_key`；**v0.4.0 起单次日程可直接补挂重复规则**，按新建系列口径做 90 天冲突扫描）/ 删除（`scope=series` 删整条、`scope=this` 仅取消本次） |
| POST | `/events/:id/restore-occurrence` | **恢复某次已取消的实例**（body 带 `occurrence_key`） |
| GET/POST | `/conversations` | 查询（过渡接口，恒返回 0~1 条）/ **幂等获取唯一会话**（v0.3.0：存在即返回、不存在则创建，body 可省且忽略 `title`） |
| GET | `/conversations/:id/messages` | 历史消息（卡片按云端最新数据刷新） |
| POST | `/conversations/:id/clear` | **清除聊天记录（v0.3.0）**：单事务删除该会话全部消息与待确认动作、标题重置为「新对话」，返回 `{id, deleted_messages}`；会话本身保留 |
| POST | `/conversations/:id/chat` | **发送消息（SSE 流式）** |
| POST | `/conversations/:id/pending-actions/:paId/confirm` `.../cancel` | 确认 / 取消待确认操作（已失效或已被清除 → `3003`） |

> v0.3.0 起每用户只有一个会话，`PATCH /conversations/:id`（重命名）与 `DELETE /conversations/:id`（删除会话）已下线（404）。

完整定义见各版系统设计文档：[MVP §6](docs/mvp/系统设计文档-个人助手MVP.md)、[v0.1.0 §6](docs/v0.1.0/系统设计文档-个人助手v0.1.0.md)、[v0.2.0 §7](docs/v0.2.0/系统设计文档-个人助手v0.2.0.md)、[v0.3.0 §7](docs/v0.3.0/系统设计文档-个人助手v0.3.0.md)、[v0.4.0 §7](docs/v0.4.0/系统设计文档-个人助手v0.4.0.md)。

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
| **006** | **`conversations` 唯一索引 `uniq_conversations_user`** | **v0.3.0 单会话化：存量多会话收敛（保留 `updated_at` 最新者，其余会话的消息按原 id 改挂、跨会话重复 `client_msg_id` 先置空、`tool_invocations` 改挂、`pending_actions` 删除），随后建唯一索引；以「索引是否已存在」为幂等闸门，整体单事务** |
| **007** | **`work_calendar_days`** | **v0.4.0 法定工作日历（CN）：只存偏离默认周历的特殊日（`holiday` 法定放假 / `makeup` 调休补班），主键 `(country, day_date)`，CHECK 约束保证 `holiday` 必带名称；随迁移录入 2025/2026 共 48 行（以国办发明电〔2024〕10 号、〔2025〕7 号为准），全部 `ON CONFLICT DO NOTHING` 幂等；后续年份新增追加迁移即可，不改代码** |
| **008** | **`refresh_tokens`** | **v0.4.0 刷新令牌：`user_id` 级联删除、`token_hash` 唯一（只存 SHA-256）、`expires_at`、`revoked_at` + `replaced_by` 构成轮转链；建用户与到期索引** |
| **009** | **`users.nickname` + `user_settings`** | **v0.4.0 账号设置：昵称列（≤20 字符，可空）；`user_settings` 单行/用户，`payload` jsonb 承载偏好（读时与默认值合并，老用户无行也取默认）** |

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

004~009 全部语句幂等（`IF NOT EXISTS` / `ON CONFLICT DO NOTHING` / 索引存在性闸门），存量业务数据零回填（新增列全为 NULL、新增表为空）；006 只收敛会话归属、不删消息，已在含多会话与重复幂等键的样例库上做过守恒 + 幂等 + 故障回滚演练。**注意：006 会把每用户的多会话合并为 1 条（消息全保留），回滚需手工删除唯一索引、合并形态不可逆。** v0.4.0 的升级路径已在 v0.3.0 快照库上演练：只应用 007/008/009、存量行数前后不变、幂等重放全跳过、存量循环系列展开逐日一致。

`work_calendar_days` 数据维护方式（v0.4.0）：

```sql
-- 只记录"偏离默认周历（周一~周五工作、周六日休息）"的日子，数据量很小
CREATE TABLE work_calendar_days (
  country      CHAR(2)     NOT NULL DEFAULT 'CN',
  day_date     DATE        NOT NULL,
  day_type     VARCHAR(16) NOT NULL,          -- holiday 法定放假 | makeup 调休补班
  holiday_name VARCHAR(30),                   -- holiday 必填（角标与标题条用）
  PRIMARY KEY (country, day_date),
  CONSTRAINT ck_work_calendar_type CHECK (day_type IN ('holiday','makeup')),
  CONSTRAINT ck_work_calendar_name CHECK (day_type = 'makeup' OR holiday_name IS NOT NULL)
);
```

服务端启动时**整表载入进程内存**（判定为纯内存操作，循环展开不逐日查库）；新年度安排公布后新增一份追加迁移（如 `010_work_calendar_2027.sql`）并重启即可，无需改代码。

所有业务查询强制携带 `user_id`，防止水平越权；删除任务对任务日程设 `ON DELETE CASCADE`、对子任务设自引用 `ON DELETE CASCADE` 作为事务之外的兜底（正常路径以服务端单事务为准）。

---

## 测试

| 版本 | 用例文档 | 测试报告 | 结论 |
| --- | --- | --- | --- |
| MVP | [133 项](docs/mvp/测试用例文档-个人助手MVP.md) | [测试报告](docs/mvp/测试报告-个人助手MVP.md) | 不建议直接发布（长上下文指代间歇失败） |
| v0.1.0 | [144 项](docs/v0.1.0/测试用例文档-个人助手v0.1.0.md) | [测试报告](docs/v0.1.0/测试报告-个人助手v0.1.0.md) | 达到发布门槛（P0 100%、P1 97%、0 未修复失败） |
| v0.2.0 | [254 项](docs/v0.2.0/测试用例文档-个人助手v0.2.0.md) | [测试报告](docs/v0.2.0/测试报告-个人助手v0.2.0.md) | 达到发布质量（可执行范围内 P0 100%、P1 100%、17 个缺陷全部修复） |
| **v0.3.0** | [182 项](docs/v0.3.0/测试用例文档-个人助手v0.3.0.md) | [测试报告](docs/v0.3.0/测试报告-个人助手v0.3.0.md) | 通过 106 / 部分 19 / 未执行 57（环境依赖）/ 失败 0；报告期 4 项遗留问题全部修复并复验 |
| **v0.4.0** | **[277 项](docs/v0.4.0/测试用例文档-个人助手v0.4.0.md)** | **[测试报告](docs/v0.4.0/测试报告-个人助手v0.4.0.md)** | **通过 215 / 失败 8 / 部分 9 / 无法验证 2 / 未执行 43；有条件通过**——测试期发现并修复 **5 个缺陷**，失败项集中在「埋点未落地」与「前端包体超预算」 |

v0.4.0 执行方式：**四层**——引擎单元断言（tsx，WC 14 项 + 农历 27 项 + 公历循环回归 11 组）+ 服务级直调（20 项：判定函数、monthly dense、resolve、性能）+ 接口自动化（curl + 回查数据库行，64 项）+ 界面与对话实测（2 个并行浏览器代理，覆盖 HOME/TREE/MD/ANCHOR/PROP 与真实 DeepSeek 对话）+ 迁移升级演练（v0.3.0 快照 → v0.4.0）。关键实测数据：

- **法定工作日展开零错误**：9/28~10/11 → 9/28、9/29、9/30、**10/8**、10/9、**10/10（周六补班）**（避开 10/1~10/7）；春节 9 天窗口含 2/14 与 2/28 两个补班周六；count/until/730 上限/时区归桶/窗口左闭右开全部符合；存量 `[1..5]` 字面规则逐实例零漂移
- **农历换算与循环**：以**官方公告可反推的锚点**对拍（14 个）+ 3 组历法不变式（1990~2040 月长仅 29/30、春节间隔 354~385 天、节气 24 个且间隔 14~16 天）；除夕大月三十/小月廿九、2025 闰六月不产生额外实例、超 2100 候选被跳过；年度循环首次实例语义（正月初一 → 次年春节）正确
- **迁移与升级**：007/008/009 只应用新增表与列，**存量行数前后完全不变**（零回填）、幂等重放 skipped=9、存量系列展开逐日一致；007 行数断言 2025=23（18+5）、2026=25（19+6）
- **缺陷修复复验**：循环实例农历按**实例自身**日期计算（曾在跨年实例显示成 anchor 的农历）、`count` 系列跨未公布年份出回退说明、关农历再开启可恢复用户节气偏好、搜索结果子任务带父级路径、裸农历日期默认年度循环
- **性能**：resolve 0.09ms(n=1)/4.26ms(n=3)、workday 90 天展开 3.01ms、monthly 7.2ms、refresh P95 12.0ms；法定日历判定 2000 次 2.21ms（整表缓存命中）
- **安全**：Markdown XSS 合集（脚本/事件属性/伪协议/svg/表格/图片）全部无害化；resolve 注入 1001 且无 SQL 执行；越权 1004；refresh 爆破限流（第 11 次起 429）且响应不含令牌片段；改密他端失效、JWT 时钟容忍（过期 10s 通过 / 120s 拒绝）
- **界面**：主页 5 项默认折叠为一行且无跳动、手动态保持、重进重算、列表区独立滚动（整页不滚、`overscroll-behavior: contain`）、标题条非 sticky、列表最小高 38dvh；任务首页零子树零行内添加、`0/2` 只读摘要；方案卡「就这么办 → 执行中 → 结果卡」参数逐字一致，冲突双层确认生效；聊天冷启动/刷新均锚定最新，上翻只出「↓ 新消息」胶囊

**遗留门槛**（v0.4.0）：① **前端包体超预算**——markdown-it + dompurify 实测贡献 gzip 54.4KB（预算 25KB），建议上调预算或懒加载 `MarkdownText`；② **埋点清单未落地**——PRD 11.6/SDD 9.2 要求的 12+ 类事件未实现（仅 3 个既有服务端日志事件），需补最小埋点集或正式下调该章要求；③ 真机环境依赖项（微信 WebView 软键盘与页面回收、宽屏 ≥1024px、VoiceOver/TalkBack、HTTPS 抓包）未覆盖；④ v0.3.0 冒烟集尚未复跑。

v0.3.0 执行方式：引擎单元断言（tsx，31 项）+ 迁移/DB 演练（4 个独立库：收敛守恒、幂等复跑、v0.2.0→v0.3.0 升级路径、**故障注入原子性**）+ 接口自动化（curl+jq，41 项）+ **真实 DeepSeek 对话 4 轮** + 浏览器实测（35 项判定）。关键实测数据：

- **yearly 领域正确性 100%**：指定月日本年已过 → 首次落到次年、间隔年、`count` 从首次实例起算、2/29 闰年序列、**2 月 31 日 → 闰年落 2 月 29 日**、窗口左闭右开、730 上限保护、跨时区归桶、4011 三类拦截；daily/weekly/monthly 引擎与摘要文案逐实例零回退
- **迁移 006**：消息总数守恒（10→10 仅改挂）、跨会话重复 `client_msg_id` 去冲突、工具审计改挂、pending 清理、**幂等复跑结果一致**、**故障注入整体回滚**、模拟 v0.2.0 库仅应用 006 并登记
- **对话链路**：模型正确产出 `by_month_day` 并命中冲突门控（未确认不写入），确认后落库 `source=chat` 且卡片带 `first_occurrence_at`；「每年第 N 个周 X」被拒绝且零写入；清除记录后提问走 `list_events` 查库而非回忆
- **UI**：折叠一周与跨月周邻月标记点补齐、日期信息去重、三类 item 直达详情、吸顶滚动、清单弹层全流程、子任务入口收敛与 5 级置灰、`/chat` 单页化与清除记录（危险弹窗默认焦点在「取消」）
- **容器化**：server/web 镜像本地实跑通过（迁移随镜像生效、`/healthz` 探活、SPA 回落、`/api` 反代、**SSE 经 nginx 逐块流出**）

**遗留门槛**（均为环境依赖，非功能缺失）：三端真机（iOS/Android/微信 WebView）、宽屏 ≥1024px、断网与 500 故障注入、性能压测；另有 1 项极低危观测（pending id 传非法 UUID 返回 500）与「前端埋点通道未落地」记录在案。

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
- **当日视图的时间轴 / 当前时间参考线 / 进行中高亮**（v0.3.0 随当日列表页下线，不迁移到主页；当日日程改为「全天分组 + 按开始时间升序」的普通列表）
- **多会话与会话列表**（v0.3.0 起每用户唯一会话；不提供新建/重命名/删除会话，只有「清除聊天记录」）
- **「每年的第 N 个周 X」**（yearly 只支持指定「月 + 日」，这类表达由助手追问具体月日）
- **指定农历闰月**、**按节气名建循环**（如「每年清明」「每年冬至」）、**多个农历月日**——农历只支持「正常月 1~12 × 日 1~30」且**仅作用于「每年」频率**（不作用于每天/每周/每月）；节气与闰月场景由助手如实说明并给替代建议
- **多国家/地区工作日历**：法定日历仅支持中国大陆（`WORK_CALENDAR_COUNTRY=CN`），不做港澳台/海外假日；**不做节假日后台与在线抓取**（以官方公告手工录入、随迁移发布）
- **助手多方案对比**：一次只给一个推荐方案，不提供 2~3 个候选横向对比
- **httpOnly Cookie 凭证与设备管理**：refresh 仍存 localStorage（Bearer 体系延续），不提供按设备踢出/设备列表
- **头像图片上传**（头像为文字首字母）、**邮箱换绑**（邮箱只读）
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
- 生产部署需由网关终止 TLS，全链路 HTTPS；镜像化的前端容器已用 nginx 同源反代 `/api`（关闭 `proxy_buffering` 以支持对话 SSE），生产环境只需在最外层再挂 TLS 终止即可。
- 当前登出黑名单与限流基于**内存**实现，多实例部署时需替换为 Redis。
- **refresh 凭证只存 SHA-256 哈希**（库中无明文），并通过轮转链检测重放（旧串被重放时吊销该用户全部活跃令牌）；`/auth/refresh` 独立限流，失败统一 `1002` 不区分"不存在/过期/已吊销"。
- **助手消息的 Markdown 渲染是本版新增的输出渲染面**：仅白名单标签（h3/h4/加粗/列表/代码/引用/链接等），**原始 HTML 不解析**，图片与表格不渲染，链接仅允许 `http(s)` 并强制 `rel="noopener noreferrer"`，渲染前经 DOMPurify 白名单净化；**用户消息始终按纯文本渲染**。
- 农历与法定日历数据均为公开历法信息，不涉及个人数据；`/events/lunar/resolve` 入参为范围受限整数且参数化查询。
- 限流默认值为 20 次/分钟（登录注册按 IP、对话按用户）；压测或批量测试时可临时通过环境变量提高，**生产请保持默认**。
- 循环规则与子任务参数在入口做**白名单化结构校验**（频率枚举 + 数值上下限 + 星期/月内规则受控取值 + 结束条件互斥 + `week_mode`/`by_lunar_month_day` 枚举与范围），服务端再做语义校验（`4011`：模式与字段互斥、工作日不支持隔周、农历范围 1900~2100）并限制展开与查询规模，避免畸形规则放大计算量；任务日程禁循环由 zod、Service 与 DB `CHECK` 三处一致拦截（`4016`）。