# 统一客户端与 Yonder 矩阵架构升级：设计任务书

本文件是交给设计 Agent 的输入，汇总主人需求、已确认的方向和调研结论。事实细节见同目录 A1/A2/A4/A5。

## 1. 主人需求（原意整理）

- 做一个类似 DeepSeek Harness 的前端：一个页面同时放常驻 bot（resident agent 会话）和临时 session（task 会话），网页或桌面客户端都能访问，方便坐在电脑前操作和开发。
- 根本痛点：macOS 状态栏、桌面悬浮窗、网页端都是零散实现的，不要再零散地多造一个界面。
- 整体架构、开源方案、插件方案、仓库分布与路径都要审计并升级。
- 核心产品是 yonder-harness + Card + Net 矩阵；AI-Being/being 系列是已废弃的上一阶段方向。
- 产品面向非技术 C 端用户，过去过度追求 pi 式“只留内核”，插件化需要更克制；但对开发者，主仓无渠道的核心又是对的。可能需要多仓组合矩阵（例如现阶段闭源的后端）。
- 现在的 yonder-harness 是“重客户端”（有配置、能配模型）；“轻客户端”应该只作为网络节点 / 可被工具调用的设备节点。它和面向用户的客户端是不是同一个概念？面向用户的客户端如何设计？
- 组网三档：不用云互联、自建云服务互联、用 Yonder 云。Card 是社交平台，也是最早的云服务玩法。

## 2. 已向主人表达的初步方向（可修正，但要给出理由）

- 两条轴分开：节点角色（完整节点：配置+模型+agent+会话；执行节点：只暴露本机工具/设备能力，W0 execution-only 是雏形）vs 界面客户端（只是前端，连本机或经 Net 连远端完整节点）。
- C 端拿到一个产品包：完整节点 + 统一界面 + 默认插件，一次装好，不感知“内核+插件”。
- 插件槽作为开发者扩展机制保留；状态栏、悬浮窗、网页、任务看板等一方表面不再是可选插件，而是内置产品层。
- 一套控制面 API + 一套共享 Web 前端；网页、桌面壳、状态栏、悬浮窗都是它的薄壳或视图；插件通过 UI 贡献槽提供面板/卡片。
- 三层仓库矩阵：开源核心（内核、SDK、执行协议、执行节点）/ 产品发行（统一客户端、默认插件集、安装器）/ 闭源云（Card 社交与账号、Net relay）。
- 组网三档共用一套协议：直连/局域网、自建 relay、Yonder Cloud；relay 是可替换传输层，Card 是建在其上的社交层。

## 3. 调研关键结论

### 3.1 现有表面（A1）
- 控制面：`packages/core/src/control/index.ts`，Unix socket `<home>/.yonder/control.sock`，行 JSON，无鉴权；唯一 handler `packages/cli/src/index.ts:724-841`，方法覆盖 sessions.open/submit/watch/list/show/abort/close、management（agents/presets/skills/plugins CRUD）、channels.list/login、service.info、events.query、identity.*、terminal.* 等。常驻与 task 会话在内核同构。
- 状态栏 `packages/macos/YonderStatus.swift` 只读 `status.json`/`desktop.json`；悬浮窗 `Companion.swift` 是 NSPanel+WKWebView，加载 ui-companion 的 `http://127.0.0.1:<port>/<secret>/`。
- ui-companion（插件）自起 HTTP（secret path + Host/Origin 校验）+ 原生 JS 单页 ~1,850 行；tasks 插件另起只读 HTTP（token path）。
- 重复：3 套 agent 活动汇总、2 套会话观察流、2 个本机 HTTP 服务（鉴权不同）、2 个终端入口、3 种看板渲染、文件/socket/WS 三种状态传递。
- 统一网页客户端缺：浏览器可用传输（HTTP/WS 网关）、鉴权模型、watch 断线续传游标、搜索端点、渠道登录 UI、统一活动口径、任务写端点；`docs/spec/13-observation-and-management.md` §2 规定“不另做 Web 控制台”，需要设计变更。

### 3.2 插件与包（A4）
- 9 个插件槽，无 UI/HTTP 槽，导致 ≥6 处自起 loopback 服务（channel-cli、channel-mcp、tasks、ui-companion、executor、core/control）。无进程隔离，无代码热重载。
- 体量：core 26.5k、vendored pi-durable 25.7k、cli 3.3k、sdk 1.2k、executor 2.9k、execution-protocol 0.5k；Swift macos 1k、macos-helper 7.6k；23 个插件。`runtime/index.ts` 1,899 行待拆。
- 文档漂移：plugins.md 与 contributes 不一致、spec 15 号冲突、提案无采纳状态、task-ledger 提案过时；根 build 串 5 步含 Swift。

### 3.3 DeepSeek Harness 参考（A2，MIT）
- Electron 壳用 `dsh-app://` 加载同一份 apps/web；共享 UI 拆在 packages/client/*。
- 协议：typed Remote RPC；unary 走 HTTP `/api`，所有流共用一条 WS `/api/remote.mux`；HMAC 签名 cookie + `?token=` 换取 + Host/Origin/Fetch-Metadata 防 DNS rebinding/CSRF。
- UI：无路由，Slot 注册表 + 面板 id，三栏（会话侧栏 | 对话 | 右栏）；子会话、jobs、审批卡、提问卡都是槽位面板；插件经 ctx 向 SlotMap 注册组件；bundle 决定各目标打包哪些插件。

### 3.4 Card / Net 矩阵（A5）
- GitHub：GoYonderTogether 有 `yonder-harness`（PUBLIC, Apache-2.0）、`yonder-web`（PRIVATE, 无 LICENSE，即本地 `yonder-card-web`）、`yondermesh`（PRIVATE，“Self-hosted Agent Context Bus”，本机无 checkout）、`pi`（fork）。zoran-xc 下有 `yonder-harness` 私有旧镜像（archive remote）、AI-Being/being/being-net/yonder-being/being-releases 均未 archive。另有组织 Zeth-AI（生产域 yonder.zethai.cn）。
- Card = React 19 + Vite + Tailwind + TanStack Query 前端，Hono + PG + Redis + ws 后端，部署 zeth-root `yonder.zethai.cn`。前端已有聊天、“我的 Agent”、设备连接页；数据源默认 mock（`src/api/index.ts:5`）。四个名字并存：yonder-web / yonder-card-web / yonder-card-server / Yonder Web。
- harness ↔ Card：channel-card（设备码/邀请码 → deviceToken，`/ws/device` 多路消息，`docs/spec/16-card-plugin.md`）；执行 relay `/ws/execution` 只在 Card worktree（`Codex/2026-10-26/task/worktrees/yonder-card-multidevice-w0`），主树未合；relay 对正文可读（spec 18 第 24 行，非 E2EE，签名防篡改）；配对不依赖 Card；Card 设备 UUID 与执行设备 ID 是两套命名空间。
- 公开仓的 spec 16/18 依赖私有 Card 仓实现（单向依赖）。
- “Net”对应两个仓：旧 being-net、新 yondermesh，关系未明。
- 重复：账号（Card / being-net）、relay（Card 三条 WS / being-net / yondermesh）、网页端（Card React / ui-companion 原生 JS）、品牌（harness `brand/src/yonder-mark.js` 声称唯一源，Card 另存 SVG）、设计令牌（ui-companion `style.css` 手工复制自 Card `styles.css`）。
- 废弃仓仍被引用：多为迁移来源说明；Card `server/PLAN.md:8`、`DESIGN.md:9` 指向已删除的 AI-Being 路径；`~/.ai-being/` 运行时目录仍在。

## 4. 设计约束

- 遵守 `yonder-harness/AGENTS.md` 与 `docs/architecture.md` §5 不变量；改动 docs/spec、architecture、decisions 需主人批准，所以设计只以提案形式给出，并列明需要改的规格条款。
- 最小完整方案：新抽象、依赖、配置必须对应当前缺口；不为假想用途加机制。优先复用现有能力（控制面方法、TypeBox schema、ui-companion 安全模式、Card 的 React 设计系统、DSH 可借鉴模式）。
- 面向 C 端：一个安装包，默认可用，少配置；开发者仍能拿到无渠道核心和插件 SDK。
- 安全：网关默认只绑 loopback，有鉴权，防 DNS rebinding/CSRF；远程访问经 Net 必须说明加密与授权边界。
