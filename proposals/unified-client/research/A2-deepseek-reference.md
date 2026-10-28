> 证据材料，结论已并入 [design.md](../design.md)

# DeepSeek Harness 前端架构调研报告

## 1. 四个 app 概览

| App | 名称 | 角色 | 技术栈 | LOC(ts/tsx) |
|---|---|---|---|---|
| `apps/web` | `@deepseek-ai/dsh-web-frontend` | Web 前端入口：Vite 构建产物 dist/，由 CLI 的 `dsh web` 服务 | Vite ^6.0.0、React ^18.2.0、TS ^6.0.3（`apps/web/package.json`） | 50,482（含依赖注入测试） |
| `apps/desktop` | `@deepseek-ai/dsh-desktop` | Electron 桌面壳，"Electron shell around the complete dsh Web application"（`apps/desktop/README.md:5`） | Electron ^44.0.0 + electron-updater ^6.8.9，无 Tauri；打包脚本为自研 `scripts/package-target.ts`（mac arm64/x64、win x64） | 32,546 |
| `apps/desktop-host` | `@deepseek-ai/dsh-desktop-host` | 桌面私有 Node-mode host 进程（Electron RunAsNode 子进程启动共享 profile runner）：`apps/desktop-host/src/index.ts` 等 8 个文件 | Node + koffi（FFI）、libreoffice-kit | 783 |
| `apps/cli` | `@deepseek-ai/dsh` | CLI：profile 启动、插件管理、配置检查，并内建 `dsh web` 服务器托管 apps/web 的 dist（apps/web/package.json description） | Node CLI，bin `dsh` | 13,880 |

仓库为 pnpm workspace（pnpm@11.7.0，`package.json`），monorepo 还含 `packages/*/*`（~60 组、每组多包）、`native/`、`vendor/`、`website/`、`python/`。

## 2. 一套前端同时服务网页与桌面

**核心事实：桌面与 Web 是同一个 SPA 产物。**
- `apps/desktop/README.md:5`："The desktop application is an Electron shell around the complete dsh Web application… Electron immediately loads the packaged Web entry at `dsh-app://app/`"，即桌面加载的就是 apps/web 构建的前端，通过自定义协议 `dsh-app://` 而非 file:// 或 http://。
- `apps/web/src/main.ts:6,11-14`：同一入口检测 `globalThis.dshDesktopBoot`；桌面存在时走 boot-gate，等待 Host boot injections（`dshDesktopBoot.ready()` 返回 injections 与 streamBaseUrl），否则按纯 Web 启动。无桌面全局时分支完全一致。
- 共享 UI 在 `packages/client/*`：`client-web`（shell/mount）、`ui-primitives`(24k LOC)、`ui-chat`(27k)、`ui-conversation`(25k)、`ui-layout`、`ui-sidebar*`、`ui-settings*`、`ui-dockkit` 等 40+ 包；`apps/web/package.json` 直接依赖这些 workspace 包。
- HTTP 差异仅在端口：桌面默认 19387，Web 默认 3080（`apps/desktop/README.md:9`）。桌面把应用 HTTP 请求经 IPC 转发给已鉴权 Web Host（剥离 `transfer-encoding/connection/keep-alive`，`apps/desktop/README.md:7`）；Web 侧则由 `dsh-host-webserver`（node:http）直接服务（`packages/host/webserver/README.md:11`）。

**桌面壳原生能力**（均在 `apps/desktop/src/`）：
- 托盘：`tray.ts:6` "Windows system tray: the always-present way back to a hidden window"，Tray + 点击唤起窗口 + 退出确认；图标由 `scripts/render-tray-icon.ts` 渲染。macOS 未实现托盘（文件注释明确 Windows）。
- 目录选择对话框（Electron 原生）：`directory-picker.ts`，Web 回落到 Host chooser / browse 模式（README:16）。
- 麦克风权限：`microphone-permissions.ts`（macOS 系统授权，README:31）。
- 应用内嵌浏览器（Platform 文档，WebContentsView + 分区存储）：`web-document.ts`、`platform-view.ts`。
- 全局快捷键：未用 Electron `globalShortcut`（grep 无结果）；是**应用内**快捷键体系 `packages/client/shortcuts`，桌面把绑定持久化到 userData/keybindings.json（`apps/desktop/src/keybindings.ts:19`），插件通过 `ctx.shortcuts` 注册带 desktop/web × 三平台默认值（`packages/client/shortcuts/README.md`）。
- 自动更新：`update-coordinator.ts:6,12` 基于 electron-updater `autoUpdater`；另有 mandatory-update-policy、update-journal、update-overlay 等一整套文件。
- DevTools 快捷键、欢迎窗口、崩溃报告、单实例（`single-instance.ts`）、Windows 布局等。
- 悬浮窗：未发现（无 floating widget 实现）。

## 3. 前后端通信

协议栈分三层：

**a) Typert Remote（统一 RPC 抽象）**：`packages/typert/protocol/src/index.ts:197-207` 提供 `@Remote('name')` / `@Remote({mode:'stream'})` 装饰器，Service 类方法即端点；`packages/typert/generator` 生成客户端 stub。各 controller 用它：
- `packages/api/session-controller/src/index.ts`：Session Remote owner（session list/page/follow/fork/prompt/cancel/rename/search/model-catalog 等，见 import 的 Request/Value 类型，index.ts:40-58）。
- `packages/api/job-controller/src/index.ts:75,90,109`：jobs 的 stream 查询与 `kill`。
- `packages/api/gateway`、`terminal-controller`、`workspace-controller`、`settings-controller`、`account-controller`、`remotes` 同构。

**b) Gateway 载体**：
- HTTP：`packages/client/connection/src/api-path.ts:7` `API_PATH='/api'`，所有 Unary RPC 走 `/api` 前缀；`http-bridge.ts:9-14` 做 node:http ↔ fetch 桥，请求体上限 300MiB。
- WebSocket 多路复用流：`packages/api/gateway/src/stream-protocol.ts:6` `REMOTE_STREAM_MUX_PATH='/api/remote.mux'`，一个 WS 承载所有 Remote stream（含内部 `$events` 事件流与 `$events/result` waterfall RPC，stream-protocol.ts:10-13）；帧类型 ready/emit/waterfall/cancel（stream-protocol.ts:45-70）。心跳 2 次未响应断开（stream-server.ts:44）。
- SSE：未发现；HMR 事件流由 boot/hmr 包走 webserver 注册的 stream（webserver README:11）。

**c) SDK（跨进程）**：`packages/sdk/README.md:9` —— 另一进程通过**换行分隔 JSON-RPC over stdio** 驱动完整 runtime；`protocol/` 定义消息，TS client 启动 `dsh` profile，Python SDK 同协议。

**鉴权与远程访问**：
- 浏览器会话鉴权：`packages/client/connection/src/browser-auth.ts:1-15` 基于 HMAC 签名 cookie（`dsh-auth-` 前缀）+ credential secret，24h 过期，token 可经 `?token=` 查询换取 cookie。
- DNS rebinding / CSRF 防线：`api-request-trust.ts:1-10`，每个 `/api` 请求做 Host/Origin/Fetch-Metadata 绑定校验；远程客户端经 loopback、LAN IP 或声明的 `trustedHosts` 通过同一 fence（注释明确 "Network reachability and authentication stay out of scope… binding policy belongs to the webserver config"）。
- 桌面 IPC：Host 账号凭证只走私有 Node IPC，"Account RPC and the Harness renderer receive no token"（`apps/desktop/README.md`）。

**session / session-query**：`packages/session/*` 是会话持久化与投影（JSONL、多版本格式迁移、telemetry），`packages/session-query/*`（5.1k+4k+3.8k LOC）提供冷读/过滤/游标的会话检索，并被 session-controller 消费（session-controller/src/index.ts:14）；另有 `tool-session-query` 供 agent 使用。**`packages/api`、`host`、`client` 均是包组**，不是单包。

## 4. 主界面信息架构

非路由式 SPA（无 router）：**Slot 注册表 + 面板 id** 架构。

- 三栏壳：`packages/client/ui-layout/src/client/AppFrame.tsx:1-9` — "Three-column shell frame, registered into the built-in 'root' slot… sidebar | center | rightbar"；main slot 按 `activePanelId` 渲染 Conversation 或全局面板（AppFrame.tsx:36-41）。无 URL 路由。
- Slot 核心：`packages/client/ui-slots/src/index.ts:14` `SlotMap` 通过 TS declaration merging 扩展；槽型 single/list/keyed/chain（ui-slots README）。`ui-renderer` 负责渲染安装。
- 会话列表/侧栏：`ui-sidebar`（1.8k）、`ui-sidebar-files/browser/terminal/documentpreview/right`（文档预览 13k）。
- 对话：`ui-conversation`（事件/视图双注册表 + 每会话绑定 + 临时 composer takeover，README:12-18）→ 具体 target 如 `ui-chat`。
- 临时子会话（subagent）：后端 `packages/subagent/*`（child session `header.origin === 'subagent'` 走 subagent 路由，session-controller/src/agent.ts:85）；UI 在 `ui-subagent`（2.7k）与 `ui-trajectory`（14.8k）。
- Jobs：`ui-jobs`（1.4k）查询/终止 stream 端点（job-controller @Remote stream）。
- 审批/交互卡片：`ui-approval`（"answers Host permission requests through the scoped interaction waterfall"，README:5-6，Enter 批准/Escape 拒绝，接管 composer）；`ui-user-questions`（4.8k）提问卡；`interaction/*` 是 Host 侧（user-approval、user-questions、tool-ask-user、permission-presets）。
- 其他面板：`ui-schedule`(18k)、`ui-workspace`(13k)、`ui-goal`、`ui-plan`、`ui-deliverables`、`ui-plugin-manager`(7.9k)、`ui-dockkit`(8.1k)、`ui-settings-*`。

## 5. 插件 / 扩展机制

- 基于 **Cordis** 框架（workspace 内 `@deepseek-ai/cordis`，patches/ 目录有补丁）。
- `packages/boot/plugin-manager`（5.7k）："Enable profile plugins and install, remove or select bundles from the Web sidebar or an agent"（README:5）；Creator 模式 agent 可自装插件。
- `packages/extensions/`：`cordis-client-runner`（客户端侧插件运行）、`cordis-host-runner`（Host 侧）、`tool-cordis`、`ui-cordis`（历史卡片/控制面板，README:5 "New Creator plugins use Plugin Manager"）。
- **插件贡献 UI 的方式**：客户端插件在 `ctx.effect()` 中通过 `ctx.uiSession` / slots API 向 `SlotMap` 注册组件到声明式槽位（ui-slots README "Pair this React-free package with ui-renderer"）；快捷键经 `ctx.shortcuts`；审批类插件经 `ctx.uiSession` 发布待审批请求并接管 composer（ui-approval README:5-6）。bundle 包（`packages/bundle/web-app`、`sdk-app`、`headless` 等）决定哪些插件打包进各目标。
- `packages/hooks/`：Claude Code / Codex 风格 hook 协议（hook-protocol 1.7k + 两个适配器），属模型行为钩子而非 UI。

## 6. LICENSE 与可借鉴部分

- **LICENSE：MIT**（Copyright (c) 2026 DeepSeek，`LICENSE:1,3`），`package.json:5` 同为 MIT；另有 `THIRD_PARTY_NOTICES.md`。商业复用基本无障碍。
- 最可直接借鉴/复用的：
  - `packages/client/connection`（HTTP+WS 双载体 RPC、鉴权 cookie、DNS-rebinding fence，~15k LOC）与 `packages/api/gateway`（多路复用流）；
  - `packages/typert`（装饰器式 typed Remote RPC + 代码生成）；
  - `packages/client/ui-slots` + `ui-renderer` + `ui-layout`（无路由的声明式槽位 UI 组合，零运行时依赖的合并类型核心）；
  - `packages/client/shortcuts`（跨 web/desktop 的命令快捷键体系）；
  - `apps/desktop` 的 boot-injection / `dsh-app://` 加载同一 SPA 的模式、`apps/desktop-host` 的独立 Node host 进程划分；
  - `packages/session-query`、`jobs`、`interaction` 的 Host 侧语义。
- 注意：SDK 消息协议、AGENTS.md/CLAUDE.md 等内部约定同仓可读，但一些 workspace 内包（`@deepseek-ai/cordis`、`libreoffice-kit`、`schemastery`）是自维护 fork/vendor，移植时需一并带走或替换。