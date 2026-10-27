# Yonder Harness 面向人的界面/客户端表面盘点

## 1. 总览

| # | 表面 | 路径 | 技术栈 | 进程形态 | 与内核通信 | LOC(源码) |
|---|---|---|---|---|---|---|
| 1 | CLI/TUI | `packages/cli` | Node + pi-tui 1.3.0 | `yonder` 单进程；`yonder start` 既跑内核又开控制面 | 同进程直调 + Unix socket 控制面 | ~2,850 |
| 2 | 本机控制面 | `packages/core/src/control` | Node net (Unix socket/命名管道) | 由 `yonder start` 托管 | —（它就是内核入口） | 182 |
| 3 | 状态面 | `packages/core/src/status` + `packages/cli/src/status-surface.ts` | 文件发布 | 随 `yonder start` 定时写文件 | 读 `.yonder/status.json` | ~250 |
| 4 | macOS 状态栏 | `packages/macos/YonderStatus.swift` | AppKit | 独立常驻 app，读文件 | 读 `status.json`、`desktop.json` | 310 |
| 5 | macOS 悬浮窗 | `packages/macos/Companion.swift` | AppKit + WKWebView | 由状态栏进程创建（NSPanel） | HTTP 到 ui-companion 服务 | 534 (+130 PowerHelper) |
| 6 | macOS Helper | `packages/macos-helper` | Swift 命令行/特权 Helper | 独立进程 | stdout JSON + AF_UNIX socket | ~1,500 |
| 7 | ui-companion 服务端 | `plugins/ui-companion/src` | Node http | 插件触发器，随内核启动 | 内嵌于内核；写 `renderer.json`/`desktop.json` | 463 |
| 8 | ui-companion 前端 | `plugins/ui-companion/web` | 原生 JS/CSS/HTML | 浏览器/WKWebView 加载 | fetch 同源 HTTP | ~1,850 |
| 9 | channel-cli | `plugins/channel-cli/src/index.ts` | Node net | 随内核启动，监听渠道 socket | ChannelIO 事件 | 133 |
| 10 | channel-card | `plugins/channel-card/src/channel.ts` | Node ws 客户端 | 随内核启动，出站连远端 relay | WebSocket `/ws/device` | 493 |
| 11 | tasks 看板服务 | `plugins/tasks/src/service.ts` | Node http | 插件触发器，随内核启动 | 进程内直接读账本 Store | 142 |
| 12 | tasks 看板渲染 | `plugins/tasks/src/board.ts` | 文本/SVG/PNG | 库函数 | — | 120 |

其它命中 HTTP/WebSocket 的文件（`plugins/channel-feishu`、`channel-qq`、`channel-mcp`、`mcp-client`、`clipboard`、`devices`、`executor`、`web-tools`）是对外部系统的**客户端**，不是面向人的本机界面；其中 `plugins/devices/src/routes.ts` 仅做出站 HTTP/WS 请求校验（routes.ts:2-19），无常驻 web 面。

## 2. 各表面细节

### 2.1 CLI / TUI（`packages/cli`）

- **进程**：`yonder <command>`，一次性或 `yonder start` 常驻（index.ts:707 起 serve control + status + awake）。
- **TUI**（terminal.ts:55 `runTerminal`）：基于 pi-tui/pi-coding-agent 原生组件，支持多会话 watch、会话选择器、预设新建（terminal.ts:517 `newTask`）、队列 pending 展示。与内核通过控制面 `requestControl`/`observeControl`（terminal.ts:29-31、436 `sessions.watch`）。
- **plain-chat**（plain-chat.ts:10）：非 TTY 的行式任务客户端，`sessions.open` → `sessions.watch` → `sessions.submit`，EOF 排空。
- **管理命令**：`plugins/skills/models/inspect/channels/service/update` 等（index.ts:294-410，spec/13 §2）。服务未运行时只读命令回退离线查询 `offlineQuery`（packages/core/src/kernel/home-management.ts:236-260，直接开 `state.db`）。
- **终端渠道客户端**：`chat --channel` 连 `~/.yonder/plugins/channel-cli/<id>.sock`（index.ts:238；endpoint 由 core/src/control/index.ts:26 `cliChannelEndpoint` 生成，Windows 为命名管道）。
- **awake.ts:139** 连接 PowerHelper 的 socket 以维持唤醒。

### 2.2 本机控制面（`packages/core/src/control/index.ts`）

- **传输**：`<home>/.yonder/control.sock` Unix socket（:10）；Windows 命名管道 `\\.\pipe\yonder-control-<sha256(home)>`（:12）。
- **协议**：换行分隔 JSON，一行请求 → `{ok,result|error}` 响应；`observeControl`（:140）在同一连接上首响应后持续推送服务端事件（只读观察流）。**无鉴权**，安全靠 socket 文件/管道权限（spec/09:95-96 承认 Windows 多用户隔离未验收）。
- **宿主**：`packages/cli/src/index.ts:724-841` 是唯一 handler（switch 分发）。

### 2.3 状态面（`.yonder/status.json`）

- `packages/core/src/status/index.ts:48` `createStatusSurface`：每 2s 读内核，事件水位（`kernel.eventWatermark()`）判变，10s 心跳刷新 `observedAt`；原子写 `.yonder/status.json`（snapshot.ts:26-27）。
- 内容：`ready/version/active/agents[]`（cli/status-surface.ts:14-20）——**只读、无命令**。设计意图见文件注释（status/index.ts:33-38）："不做长连接推送，文件读一次是微秒级"。

### 2.4 macOS 状态栏（`packages/macos/YonderStatus.swift`）

- **进程**：独立 AppKit app，每 2s 定时器（:53）。
- **读**：`.yonder/status.json`（:106）驱动菜单 agent 列表与运行状态；`.yonder/plugins/ui-companion/desktop.json`（:57）发现悬浮窗端点并可拉起 Companion。
- **功能**：菜单显示当前/历史交互入口、agent 活动子菜单、power 状态、更新检查、退出（:44）。**只读文件，不发命令**（停止服务是杀进程/`yonder stop` 之外未见）。含 `--check-activity-http` 自测钩子（:258）。

### 2.5 macOS 悬浮窗（`packages/macos/Companion.swift`）

- **进程**：由 YonderStatus 创建的 `CompanionController`/`CompanionPanel`（NSPanel + WKWebView，:146、:170）。
- **通信**：加载 `desktop.json` 里的 `http://127.0.0.1:<port>/<secret>/` 页面（:414-421 强校验 loopback）；每 2s GET `activity-summary` 汇总（:284）渲染原生浮球 dock；WKScriptMessageHandler bridge 传 state/pending。
- **无独立业务逻辑**，完全是 ui-companion web 前端的壳 + 原生活动汇总渲染。

### 2.6 macOS Helper（`packages/macos-helper`）

- **进程**：独立 Swift 可执行（含 launchd 风格 lease/registration 服务，ServiceHost.swift:234、:354-368 AF_UNIX）。
- **通信**：stdout JSON 记录 + 命令行子命令（YonderHelper.swift:139 `emit`）；提供权限探测/申请、AX 桌面窗口枚举、CGEvent 鼠标键盘、guide 弹窗（PermissionGuide.swift）。
- **面向人**：主要是权限引导 UI 与自动化底座；与内核无直接协议，由插件（native-automation/clipboard 等）经执行环境调用。与 status/companion 无重复。

### 2.7 ui-companion 服务端（`plugins/ui-companion/src/service.ts`）

- **进程**：插件触发器 `ui-companion-service`（index.ts:31），随内核启动；监听 `127.0.0.1` 随机端口（:214 `listen(0)`）。
- **鉴权**：URL 内嵌随机 secret 路径（:207 `randomUUID`），Host/Origin 校验（:178-183）；端点写 `renderer.json` / `desktop.json`（0600）供 Companion 发现（:234-249）。
- **端点**（service.ts:176-276）：GET `""`(页面)、POST `board`(订阅看板源)、GET `activity-summary`、GET `board`/`board?id=`(代理 tasks 看板)、GET `state`、POST `answer`。
- **工具**：`ui-companion_present` / `ui-companion_result`（index.ts:33-52），agent 用来向本机人提问并等待真实回答；持久化 `interactions.json`（0600）。
- 活动汇总来自 tasks 看板的 `?view=activity`（service.ts:105-136 fetch 代理）。

### 2.8 ui-companion 前端（`web/app.js` 等）

- 单页原生 JS，三形态：panel（浮动卡）/ inline / notice（#hash 切换）；`state.mjs` 纯函数卡片状态机（beginTask/completeStep）；支持 board/agents 场景（app.js:189-196）、历史步骤、draft 保存（localStorage）。
- 与内核零直连：只 fetch 同源 `state`/`answer`/`board`。

### 2.9 channel-cli（`plugins/channel-cli/src/index.ts`）

- 内核内监听 `<data>/channel-cli/<id>.sock`（:23-30），单客户端（:43），行文本 → `message.in` 事件，支持流式回写与 `\u001e` JSON 输入帧（:57-66）。是 TUI 之外第二个人机终端入口，走**渠道**路径（绑定唤醒）而非控制面。

### 2.10 channel-card（`plugins/channel-card/src/channel.ts`）

- 出站 WebSocket 到远端 relay（默认 `https://yonder.zethai.cn`，:28；`/ws/device` :257，Bearer token :259）；登录码轮询（:33-35）。把手机/远端卡片用户映射为本机 agent 会话。**远程的人机面**，内核侧是普通渠道。

### 2.11 tasks 看板服务（`plugins/tasks/src/service.ts`）

- 插件触发器，`127.0.0.1` 随机端口（:126）；鉴权 = URL path 里的 per-caller UUID token（:30-39 `publish`），拒绝 Origin（:47-52）。
- 端点：`?view=activity`（blocked/review/waitingUser 汇总 :54-83）、`?view=panel`（任务面板 JSON :84-112）、默认 board JSON+text（:113-120）。**只读**；渲染端是 ui-companion 前端与 `board.ts` 的文本/SVG/PNG（board.ts:76-119，供渠道发图）。

## 3. 重复 / 各自为政之处

1. **三套"agent 活动汇总"**：`service.info`（cli/index.ts:759-770 `kernel.terminal.activity()`）、`status.json`（status-surface.ts:14-20 同一函数）、tasks `?view=activity`（service.ts:54-83 从账本另算）。字段结构（agentId + blocked/review/waitingUser + running）相近但来源与 schema 各写一份，Companion.swift:33-92 还有一份 Swift 侧解析/校验。
2. **两套会话观察流**：控制面 `sessions.watch`（SSE 式 JSON 行）与渠道 `stream()`（channel-cli index.ts:107-117）；plain-chat、TUI 各自解析 `TerminalUpdate`。
3. **两个本机 HTTP server**（ui-companion、tasks board）各自实现端口发现（secret path vs token path）、随机端口、`desktop.json`/token URL 约定，无共享 server 框架。
4. **两个终端入口**（TUI 控制面路径 vs channel-cli 渠道路径）语义不同（预设 task 会话 vs 绑定渠道会话），但呈现重复（plain-chat.ts 与 terminal.ts 都有消息流渲染简化版）。
5. **看板有三种渲染**：JSON（service）、text/SVG/PNG（board.ts）、web（ui-companion 前端），同一数据三次投影。
6. 状态传递有**三种机制并存**：文件（status.json/desktop.json/renderer.json）、socket（control.sock、channel-cli sock、PowerHelper socket）、远程 WS（channel-card、devices）。

## 4. 现有控制面 API 完整端点清单

全部在 `packages/cli/src/index.ts:724-841`（serveControl handler），传输为 `<home>/.yonder/control.sock`：

| 方法 | 行号 | 功能 |
|---|---|---|
| `awake.status` | 731 | 电源/唤醒状态 |
| `channels.list` | 732 | 渠道实例列表 |
| `channels.login` | 733 | 渠道登录（start/poll） |
| `release.result` | 734 | 更新/安装结果回传 |
| `sessions.notify` | 735 | 程序通知提交 |
| `management` | 739 | 管理面（agents.*/presets.*/skills.*/plugins.* list/show/create/update/validate/archive/remove/restore，分发见 kernel/home-management.ts:238-236、kernel/management.ts:44-169） |
| `terminal.sessions` | 741 | 终端会话列表 |
| `terminal.presets` | 742 | 预设列表 |
| `terminal.channels` | 743 | 渠道列表（TUI 用） |
| `terminal.queued` | 744 | 队列输入查看/排出 |
| `service.info` | 746 | version/commit/pid/active/agents |
| `terminal.info` | 756 | 单会话运行信息 |
| `sessions.command` | 758 | TUI 命令 |
| `sessions.open` | 759 | 按预设开 task 会话（close: manual/run-end） |
| `sessions.submit` | 768 | 提交输入（busy: followup/steer/interrupt，附件） |
| `sessions.watch` | 781 | 建立观察流（推送 update） |
| `sessions.list` | 795 | 会话列表（filter） |
| `sessions.show` | 796 | 会话+转录 |
| `sessions.abort` | 801 | 中止运行 |
| `sessions.close` | 802 | 关闭会话 |
| `events.query` | 804 | 事件查询 |
| `identity.lookup` / `identity.link` / `identity.unlink` / `identity.person` | 805-812 | 身份映射 |
| `stop` | 813 | 停服务 |

离线只读回退（服务未运行）：`management`、`sessions.list/show`、`events.query`、`identity.lookup`（home-management.ts:236-260）。

其它非控制面 HTTP 端点：ui-companion（service.ts:176-276，6 个）、tasks board（service.ts:44-123，3 个 view）。

## 5. 统一网页客户端（管理常驻 bot 会话 + 临时 task 会话）能力评估

**已具备**：
- 会话枚举与观察：`sessions.list`（filter 可分 open）、`sessions.show`（含转录）、`sessions.watch` 流式观察——常驻与 task 会话同构（kernel 侧统一）。
- 会话生命周期：`sessions.open`（任意预设即临时会话）、`submit`（busy 三态）、`abort`、`close`、`sessions.command`、`terminal.queued/dequeue`。
- 管理面：`management` 覆盖 agents/presets/skills/plugins CRUD。
- 活动汇总：`service.info`/`status.json` 的 agents 活动已按 agent 聚合。
- 已有 web 前端资产与安全模式（loopback + secret path/token）可复用。

**缺失 / 需要补**：
- **无浏览器可用的传输**：控制面是 Unix socket + 行 JSON，浏览器无法直连；需一个 loopback HTTP/WebSocket 网关把控制面方法暴露出去（现在每个插件各造一个 http server，没有统一入口）。
- **无鉴权模型**：控制面靠 socket 权限；HTTP 网关需要新的 token/secret 方案（现有 ui-companion secret-path 和 tasks token 是两套先例但语义不同）。
- **写操作经网页无审批边界**：`sessions.submit`/`management` 写操作目前只面向本机 CLI；spec/13 §2 明确"不另做 Web 控制台"，是规格约束而非技术缺口。
- **观察流断线恢复不完整**：`sessions.watch` 断开即丢流式片段，靠 `sessions.show`/`events.query` 重放（spec/13 §1.3 已声明）；网页长时间挂机需自行做增量对账（`revision`/`observedAt`/`eventWatermark` 可用但无游标端点）。
- **历史会话枚举/搜索**：`sessions.list` 有 filter（home-management.ts:248），但转录检索只有 `events.query`；面向人的搜索/过滤端点（按 agent、渠道、时间、文本）未单独暴露。
- **渠道级状态与登录 UI**：`channels.login` 是命令行轮询交互（qrcodeUrl），网页版需要长轮询/推送封装。
- **活动汇总口径分裂**（§3.1）：统一客户端需选定一个来源（terminal.activity vs tasks activity），否则 bot 阻塞态与 task 面板数字不一致。
- **tasks 面板只读**：网页若要"接管/更新任务"需新增写端点或走 `sessions.submit`/`management`。