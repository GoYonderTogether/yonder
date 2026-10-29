# 前端事实文档（apps/app）

> 这不是规范，也不改设计。这里只记录**当前实现里能读到的事实**：路由是什么、页面由谁渲染、数据从哪个 hook 与哪个协议方法来、哪些状态有证据、哪些只是目标。
> 规范以 `docs/spec/` 为准，目标页面树在维护者私有目录（见文末链接）；两者与实现不一致时，以规范和页面树为目标，以本文和 `state-matrix.md` 为实现证据。

- 证据基线：`10fef489cbf1`（2026-10-29 01:46 -04）。行号会随并行开发漂移，检索时优先用符号名（组件名、方法名、导出函数名）。
- 本目录三份文件：本文件（入口与路由/数据映射）、[state-matrix.md](state-matrix.md)（每页必须覆盖的状态组合）、[review.md](review.md)（Hallmark 静态检查原始结果与适用边界）。
- 私有参考资料（不在本仓库，正文不依赖它们才能读）：`/Users/zoran/Documents/yonder-lead/program/page-tree.md`、`.../program/requirements/FE.md`、`.../program/tasks/FE/T-FE-04.md`、`.../program/tasks/FE/T-FE-10.md`。

## 1. 当前信息架构

一级导航只有三项，加底部头像进「我」（`apps/app/src/shell/routes.ts:3-4`、`apps/app/src/shell/TabBar.tsx:8-12`、`apps/app/src/shell/IconRail.tsx:7-45`）：

| 导航 | tab | 第二列（桌面） | 主区 |
|---|---|---|---|
| 消息 | `chats` | `SessionList`（合并网关会话与 `imports.*` 会话） | `Chat`；社交会话页 `SocialChat` 也归在这里 |
| 通讯录 | `contacts` | `ui/Contacts`（只列本机 Bot） | `ContactDetail`（需要 id）、`CardPage` |
| 工作 | `work` | `WorkList`（上 Bot、下任务分组） | `Chat`；`#/console` 是「工作」下的节点控制台页 |
| 我 | `me` | `Settings`（外壳侧栏，见 §4 矛盾 2） | `Profile`（社交个人页） |

断点三档（phone <640 / tablet 640–1024 / desktop >1024）由 `apps/app/src/shell/useBreakpoint.ts:3-5` 给出，布局去向由纯函数 `frameOf` 决定（`apps/app/src/shell/layoutMode.ts:30-32,60-78`），外壳消费它（`apps/app/src/shell/Shell.tsx:31,67-68`）。

## 2. 路由 → 组件 → 数据 hook → 协议事实

路由是 hash（`#/…`），不引入 react-router；`parse()` 对未知页回落到 `{ tab: "chats" }`（`apps/app/src/shell/routes.ts:24-43`）。公共页在注册表里标 `public: true`，目前恰好是 5 个：`u`、`p`、`g`、`get`、`connect`（`apps/app/src/shell/registry.ts:43-83`，测试锁在 `apps/app/test/registry.test.ts:18-20`）。

| 路由 | 组件（注册表） | 数据 hook / 入口 | 协议事实（网关或社交） |
|---|---|---|---|
| `#/` | 外壳内 `SessionList` + `EmptyPane` | `useSessions`、`useActivity`、`useTail`、`useBotNames`、`useImports`（`apps/app/src/lib/queries.ts:12-88`） | `sessions.list`（read，非 owner 只返回 task）、`activity.summary`（read，2.5s 轮询）、`sessions.transcript`（read，limit 30）、`bots.list`（**owner**，失败静默空表）、`imports.list`（read） |
| `#/s/:id` | `Chat`（`features/Chat.tsx:219`） | `useSession` → `mux.subscribe("sessions.watch")`（`lib/useSession.ts:113-126`）；发送 `Composer` | `sessions.watch`（read，流，resumable）、`sessions.submit`（write）、`sessions.abort`（write）、`sessions.show`（read，include:meta） |
| `#/c/:id` | `SocialChat`（`features/social/SocialChat.tsx:19`） | TanStack Query 直连 `httpApi.resolve("conversation")` → `conversationDetail` → `messages`（`:19-34`） | 社交后端 REST：`/api/resolve/…`、`/api/conversations/…/detail`、`/messages`、`/read`（`api/social/http.ts:36-86`）；**无实时订阅**（`:43` TODO） |
| `#/contacts` | 外壳第二列 `ui/Contacts` | `useSessions`，仅本机 Bot（`ui/Contacts.tsx:7-28`） | 无社交联系人协议；页面明写「契约暂未提供」 |
| `#/contacts/:id` | `ContactDetail`（`features/social/ContactDetail.tsx:11`） | `httpApi.resolve("actor")` → `actors` → `profile` → `devices` | `/api/resolve/actor/…`、`/api/actors`、`/api/profile/:id`、`/api/devices` |
| `#/cards` | `CardPage` → `Wallet`（`features/social/CardPage.tsx:264,376`） | 三个查询：`session`、`cards`、`contacts`（`:266-268`） | `/api/cards`、`/api/contacts` |
| `#/cards/:id` | 同上 `Wallet`，按 id 定位（`:376-388`） | 同上 | 同上 |
| `#/work` / `#/work/:id` | `WorkList`（`ui/WorkList.tsx:191`） | `useSessions` + `useActivity`；新建走 `sessions.open`（`:206`） | `sessions.open`（write，参数只有 `preset`/`close`/`parent`，无节点/工作目录） |
| `#/console` | `ConsoleSwitcher`（`features/console/ConsoleSwitcher.tsx:69`） | `api/nodes.ts` 的 localStorage 节点表 | 打开远程节点只做 `window.open(origin)`，不代理其 RPC；`facts.node` 校验见 §4 矛盾 5 |
| `#/me` | 主区 `Profile`（`registry.ts:38-42`），侧栏 `Settings` | 社交 `httpApi.session` + 网关 `useFacts` | `/api/session`；`capabilities.get` |
| `#/u/:id` | `CardPage → PublicCard`（`CardPage.tsx:106,376-388`） | `resolve("card")` → `card` → `profile` → `session` | 社交公网接口；**不需要网关登录**（外壳层） |
| `#/p/:accountId` | `Profile → PublicProfile`（`Profile.tsx:20-23`） | `resolve("actor")` → `profile` → `session` | 同上 |
| `#/g/:token` | `GroupJoin`（`features/social/GroupJoin.tsx:9`） | `groupPreview`；加入时若未登录先 `createAnonymous`（`:56-59`） | `/api/groups/:token`、`/join`、`/auth/anonymous` |
| `#/get` | `Install`（`features/social/Install.tsx:15`） | `createInvite`（`:18`） | `/api/device/invite`；401 映射「请登录后再获取连接邀请码」（`:29`） |
| `#/connect` | `Connect`（`features/social/Connect.tsx:12`） | `deviceCode(code)` 或 `devices`（3s 轮询）+ `createInvite`（`:23-45`） | `/api/device/code`、`/api/device/confirm`、`/api/devices`、`/api/device/invite` |
| `#/friends/add` | `AddFriend`（`features/social/AddFriend.tsx:10`） | `cards`、`resolve`、`profile`/`card`；扫码用 `BarcodeDetector` + `getUserMedia`（`:52-58`） | `/api/cards`、`/api/friends`、`/api/cards/:id/start` |
| `#/market` | `Market`（`features/market/Market.tsx:1-2`），占位文案 | 无 | 无 |
| 网关登录 | `Login`（`features/Login.tsx:7`） | `login(token)`（`api/client.ts:70`） | `POST /login`（JSON 或表单），换 HttpOnly cookie；429 = 限流，401 = 令牌无效（`server.ts:189-214`） |

网关侧统一约定（`packages/gateway/src/server.ts`）：一元调用 `POST /api/rpc/<method>`（`:242-245`），流式走 `/api/stream` WS，`/login`、`/api/logout` 单独处理（`:189,216`）；未登录时 API 返回 401 `login required`（`:238`），非 API 导航 303 到 `<basePath>login`（`:239`）；其余未知 `/api/*` 返回 404 `unknown endpoint`（`:246`）。鉴权是 cookie，前端不保存令牌（`apps/app/src/api/client.ts:24-35`）。

方法 scope 与是否存在的证据：`capabilities.get`=read（`packages/core/src/control/capabilities-methods.ts:17-18`）；`sessions.list` 对非 owner 过滤成只有 task（`packages/core/src/control/session-methods.ts:57-63`）；`bots.list` / `bots.send`=owner（`packages/core/src/control/bot-methods.ts:16-17,23-24`）；`views.list/data/act/watch` 已注册（`packages/core/src/control/views-methods.ts:38,47,59,78`）；`approvals.*` 与 `update.*` 目前是空表（`packages/core/src/control/approvals-methods.ts:3`、`update-methods.ts:3`），`useApprovals` 无调用方。

## 3. 两套数据面，不要混为一谈

1. **网关面**：同源，`rpc()` 用 `document.baseURI` + `<base href>` 解析（`api/client.ts:30-33,42-66`），cookie 由网关签发；`wsUrl()` 同源（`:85-90`）。范围是会话、任务、Bot、视图、导入、能力事实。
2. **社背面**：`httpApi` 直接 `fetch(`${VITE_SOCIAL_BASE ?? ""}/api${path}`, { credentials: "include" })`（`api/social/http.ts:15-18`）。这个 cookie 是社交后端自己的会话，与网关 cookie 不同域/不同签发方；仓库内没有任何网关社交代理（`server.ts` 只处理上述路径，其余 `/api/*` 404）。`proposals/unified-client/v03-profile-blocker.md` 已把这一点记成阻塞项：前端会把网关 404 显示成「加载资料失败」，无法区分「未登录」与「没有代理」。

因此本仓库里「社交登录态」与「网关登录态」是**两条独立事实**，`App` 的门控只看网关（`App.tsx:15-21`），而社交页各自查 `/api/session`（`Profile.tsx:222-223` 等）。这正是 state-matrix 要把它们拆成两条轴的原因。

## 4. 规范目标与实现证据的差异（要点）

1. **公开路由绕过网关登录，但只绕过外壳门控，不绕过网关本身。** `App` 在 `authed` 判定之前直接渲染 `public: true` 的页面（`App.tsx:23-29`），所以浏览器不会被重定向去粘贴令牌；但页面发出的 `/api/*` 请求仍由网关决定 401/404，静态资源也仍由网关托管。真实网关下「公开页可用」只对社交后端成立，对同源网关接口不成立。
2. **`#/me` 的归属矛盾。** 注册表把 `me` 指向社交 `Profile`（`registry.ts:38-42`），而外壳把 `route.tab === "me"` 渲染成 `Settings` 侧栏（`Shell.tsx:40-41`）。桌面宽屏下主区是社交个人页、侧栏是网关设置；手机/功能页形态下侧栏不渲染（`Shell.tsx:70-82`、`layoutMode.ts:74-78`），设置只能从社交个人页里那个「设置」弹窗进（`Profile.tsx:371-386`）。两个「设置」不是同一套内容：`Settings` 是网关账号/节点/通知/关于/退出，`Profile` 弹窗是社交昵称与社交退出。
3. **能力表已落地但还没有消费方。** `capabilities/facts.ts`、`capabilities/features.ts`、`api/capabilities.ts` 已有（提交 `dea93f8`，T-FE-04），`useFeature` 也在 `api/capabilities.ts:48` 导出；但 `git grep "useFeature("` 在 `apps/app/src` 里只命中定义处，UI 尚未按表隐藏/禁用。顶栏现在只由 `window.__YONDER_SHELL__` 注入决定（`lib/shell.ts:9-11`、`ui/TopBar.tsx:7-9`），不再从节点事实推断——这是相对派单时「未实现」的新事实，是否视为 T-FE-04 完成需维护者确认。
4. **T-FE-10 的交付物已在仓库里。** `features/social/lib/session.ts` 用纯函数把社交会话映射为 unknown/guest/anonymous/human/error 五态（`:14-33`），`Profile` 与 `SocialLogin` 已接（`Profile.tsx:223-245`、`SocialLogin.tsx:19-73`）；`test/socialSession.test.ts` 覆盖映射与表单校验。是否作为卡片的最终验收仍以维护者为准。
5. **`capabilities.get` 的返回与 `NodeFacts` schema 不一致。** schema 要求 `minor`、`node`、`views`、`models`、`remoteSession`、`auth`（`packages/protocol/src/gateway/capabilities.ts:16-51`），处理器只返回 `protocol/kind/version/methods/events/plugins/granted/limits/features`（`capabilities-methods.ts:27-37`）。前端类型按 schema 断言，运行时字段缺失：`api/nodes.ts:122-124` 对 `facts.node?.id` 做兜底并报「节点没有返回 node.id」，即添加远程节点在当前网关上必然失败。网关不校验响应体，所以不会在服务端报错。
6. **动态能力/数据缺失混在一起。** `#/market` 是纯占位文案（`features/market/Market.tsx:1-2`）；右栏 `goal`/`attachments`/`views`/`wake` 面板一律诚实空态并标出缺哪项契约（`ui/PanelBody.tsx:225-237`）；`background` 面板依赖 `views.data` 的 `core.background.<placement>`（`:68,74-85`），它是当前唯一真实消费 views 的地方。
7. **通知只有桌面壳原生一条路。** `NotifyHost` 要求同时有 `__YONDER_SHELL__` 与 `__TAURI_INTERNALS__`，否则直接 return（`features/notify/NotifyHost.tsx:8-20`）；没有 Web Notification、没有 `showNotification`（`public/yonder-sw.js` 只缓存 `assets/`，并旁路 `/api`、`/ws` 与导航，`:9-11,51-57`）；协议里有 `notification` 事件（`packages/protocol/src/gateway/notify.ts:13-17`），但 `activity.watch` 才是当前订阅入口。
8. **PWA 资产存在但路径绑定 `/console/`。** `manifest.webmanifest` 与 `yonder-sw.js` 以脚本所在目录为 scope（`pwa.ts:9-16`），本机 basePath=`/` 与云端 `/console/` 都能注册；但 `UpdateNotice` 固定请求绝对 `/console/version.json`（`ui/UpdateNotice.tsx:9`），在本机根路径下 404，静默不提示。SW 只接管带哈希的 `assets/`，不缓存 HTML，因此不会出现「新版本被旧页面盖住」。

## 5. 目标（页面树）与实现的对应方式

`program/page-tree.md` 的节点用 ✅/🟡/❌ 表达「目标形状的完成度」，本仓库的实现用文件与符号表达「现在有什么」。两边对读时：

- 页面树说 ✅ 的，仍需 `state-matrix.md` 里的状态证据；例如 `FE-R02` 的 IA 是 ✅，但其中的 `#/me` 归属矛盾（§4.2）不在页面树节点里体现。
- 页面树说 ❌ 的，先确认是「没有文件」还是「有文件但没有入口/数据」：`features/social/Contacts.tsx` 有实现，但 `#/contacts` 仍渲染 `ui/Contacts`（`Shell.tsx:22,43`），只有测试直接 import 它；`PlusMenu`、`IdentityQr`、`ViewHost`、`work/NewTask` 有文件但没有任何生产入口。
- 页面树里的 T-FE 卡号是派单编号，不是验收证据。卡片写「只允许改某文件」与仓库实际提交必须以 `git log -- <path>` 对照。

## 6. 本目录的读法

1. 先看本文件的 §2 路由表，确认你要改的页面数据来自网关还是社交后端。
2. 打开 `state-matrix.md`，按页面找到必须覆盖的状态组合；「目标显示」一栏是建议，不是已批准设计，待维护者确认的项在该文 §5 汇总。
3. 动手前读 `review.md`：它记录 Hallmark 静态检查的原始结果、哪些是工具规则、哪些需要人工判断，以及文档驱动的验证循环。不要把静态检查通过当成产品验收。

## 7. 待维护者决定（本文只记录，不自行补设计）

1. 社交后端与网关的关系：同源代理、跨域直连，还是保持两条独立数据面？（影响公开页、`#/me`、所有社交页在真实网关下的可达性。）
2. `#/me` 的单一归属：社交个人页 + 设置弹窗，还是外壳设置侧栏，还是两者明确分工。
3. 能力表（`capabilities/features.ts`）是否成为 UI 可见性的唯一入口；若否，明确它只服务于哪些页面。
4. 通知范围：是否只做桌面壳原生通知；Web Notification / 推送是否进入 0.3。
5. `capabilities.get` 的返回形状：补齐 schema 字段，还是收紧 schema 与前端类型（涉及 `docs/spec/20-stability.md` 冻结的 gateway 方法）。
6. 右栏 `goal`/`attachments`/`wake` 面板是等契约还是先下线入口。
