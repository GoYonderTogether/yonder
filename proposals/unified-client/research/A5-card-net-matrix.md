> 证据材料，结论已并入 [design.md](../design.md)

# Yonder 矩阵只读调研

调研时间：2026-10-27。全部为读取操作，未修改、未删除、未提交。

---

## 1. GitHub 仓库清单

### 1.1 组织 GoYonderTogether（共 4 个仓库）

| 仓库 | 可见性 | 大小 | 最后推送 | LICENSE | 描述 |
|---|---|---|---|---|---|
| `yonder` | PUBLIC | 5554 KB | 2026-10-27T14:08Z | Apache-2.0 | 常驻 agent 内核，消息即事件 |
| `yonder-web` | PRIVATE | 8279 KB | 2026-10-27T03:33Z | 无 | Yonder 名片网站（Web 应用与部署脚本，私有） |
| `yondermesh` | PRIVATE | 2799 KB | 2026-10-21T01:35Z | 无 | Self-hosted Agent Context Bus（跨设备/CLI 让 agent 互相看见、互相查询、交接任务） |
| `pi` | PUBLIC | 86290 KB | 2026-10-21T02:38Z | — | AI agent toolkit（上游 fork，非自研） |

### 1.2 用户 zoran-xc（`gh repo list --limit 200` 返回 52 个）中与 Yonder/Card/Net/Being 相关者

| 仓库 | 可见性 | 大小 | 最后推送 | LICENSE | 描述 |
|---|---|---|---|---|---|
| `yonder` | PRIVATE | 2716 KB | 2026-10-21T01:21Z | Apache-2.0 | 空描述；内容为公开仓的旧镜像（见 1.3） |
| `AI-Being` | PRIVATE | 82520 KB | 2026-10-17T01:04Z | 无 | 空描述；上阶段总仓（含 `net/`、`web/`、`desktop/`、`ios/`、`plugins/`） |
| `being-net` | PRIVATE | 1349 KB | 2026-10-12T07:07Z | 无 | AI Being network: accounts, relay, web client |
| `being` | PRIVATE | 19539 KB | 2026-10-05T09:35Z | 无 | Being — DeepSeek Harness 插件开发仓库 |
| `yonder-being` | PRIVATE | 3394 KB | 2026-09-29T03:01Z | 无 | Yonder Being: 可持续运行的本地 AI 存在框架 |
| `being-releases` | PUBLIC | 0 KB | 2026-10-02T00:19Z | — | Being macOS installers / release notes / update metadata |
| `yonder` | PRIVATE | 9434 KB | 2026-07-12T08:38Z | 无 | 未至之境 |
| `yonderai-bp` | PRIVATE | 25459 KB | 2026-10-19T08:53Z | 无 | YonderAI BP 源码与演示文稿私有备份 |
| `otherwhere` | PRIVATE | 16482 KB | 2026-10-09T13:26Z | GPL-3.0 | Otherwhere — 共享持久世界 |
| `personal-ai-lab` | PRIVATE | 1725 KB | 2026-10-19T08:53Z | — | 含 `projects/persistent-being`、`docs/persistent-being-*.md` |

`gh api user/orgs` 显示用户加入两个组织：`GoYonderTogether` 与 `Zeth-AI`。`Zeth-AI` 只有 1 个仓库 `zeth-ai`（PRIVATE，85343 KB，2026-09-21），名称与 Yonder/Card/Net/Being 无关；但它对应生产域名 `yonder.zethai.cn`（见 §4.1）。

### 1.3 两个 `yonder` 的关系（事实）

- 本机 checkout `~/Documents/yonder-harness` 配有两个 remote：
  - `origin` → `https://github.com/GoYonderTogether/yonder-harness.git`（PUBLIC）
  - `archive` → `https://github.com/zoran-xc/yonder.git`（PRIVATE）
- `origin/main` 顶点 `0211948 chore(release): 0.2.26102705`（2026-10-27 10:08 -0400）；`archive/main` 顶点 `f3d384a docs: 完成中英文 README…`（2026-10-20 21:21 -0400）。私有仓是 7 天前的历史快照，未含 Card 插件/设备执行契约的后续提交。

---

## 2. 本机 checkout 清单

`~/Documents` 下 `find -maxdepth 4 -name .git` 共 90 余个；按 remote 过滤 `being|card|net` 只命中 2 个自研仓（`yonder-being`、`grok-bot-0.18-reconstructed` 无关项）。其余相关目录：

| 路径 | remote | 分支 | 最后提交 | 未提交 |
|---|---|---|---|---|
| `~/Documents/yonder-harness` | GoYonderTogether/yonder-harness（+archive） | `main` | `0211948` 2026-10-27 10:08 `chore(release): 0.2.26102705` | 8 |
| `~/Documents/yonder-card-web` | GoYonderTogether/**yonder-web** | `zoran/live-dev` | `ce3f4d9` 2026-10-26 23:30 `docs: describe full-stack web and documentation map` | 5 |
| `~/Documents/yonder-hermes-extensions` | 无 remote 输出（仅本地） | `main` | `84def0e` 2026-10-27 08:10 `Merge branch 'feat/hermes-learning-parity-20261025'` | 0 |
| `~/Documents/github/yonder-being` | zoran-xc/yonder-being | `main` | `818e09d` 2026-09-29 11:01 | 0 |
| `~/Documents/Codex/2026-10-26/task/worktrees/yonder-card-multidevice-w0` | GoYonderTogether/yonder-web | `codex/multidevice-w0-20261026` | `ab456a5` 2026-10-26 11:11 `fix(card): bound relay frames before WebSocket parsing` | 0 |
| `~/Documents/Codex/2026-10-26/task-6/card-w3` | GoYonderTogether/yonder-web | detached | `269e75f` 2026-10-26 11:06（同上标题） | 0 |
| `~/Documents/Codex/2026-10-26/task-4/yonder-w1` | 本地 `/…/worktrees/yonder-multidevice-w0` | detached | `98763d9` 2026-10-26 11:41 `feat(executor): bind optional persistent Card relay to daemon` | 0 |
| `~/Documents/Codex/2026-10-26/task/artifacts/linux-full-rc-0.2.26102601-beta.1/repo` | — | `linux-full-rc` | `6362426` 2026-10-26 11:09 | 0 |
| `~/Documents/Codex/2026-10-01/task-14/being-attention` | — | `attention-prototype` | 无提交 | 10 |

- `yonder-card-web` 的 `git worktree list` 共 5 个工作树：主树、`/private/tmp/yonder-card-web-takeover-20261023/worktree`（`yonder/card-web-takeover-20261023`）、`~/.local/share/yonder/home/development/yonder-web-ui-icons-20261027`（`fix/yonder-web-ui-icons-20261027`）、`card-w3`、`yonder-card-multidevice-w0`。
- `yonder-card-web` 分支 `zoran/live-dev` 相对 `origin/main`：**ahead 44 / behind 2**（`git rev-list --left-right --count origin/HEAD...HEAD` → `2 44`）。`main` 分支停在 `931e84c feat: 桌面三栏、通讯录卡包…（0.2.26102301）`。
- `yonder-card-web` 未提交 5 项全部是 `artifacts/avatar-study-2026-10-26/` 下的 PNG/JSON 未跟踪文件。
- `yonder` 未提交 8 项含被改源码：`packages/core/src/runtime/model-chain.ts`、`model-watch.ts`、`model-chain.test.ts`、`proposals/local-model-gateway.md`、`.workbuddy-ai/memory/2026-10-27.md`，以及未跟踪 `packages/core/src/runtime/model-chain.ts.bak-order-20261027`、`proposals/unified-client/`、`proposals/workbuddy-hub-integration.md`、`.codegraph/`。
- **`being-net` 与 `yondermesh` 本机均无 checkout**：`find ~ -maxdepth 5 -type d -name yondermesh` 无结果；`~/Documents` 下无 `being-net` 目录。`AI-Being` 目录已不存在（`ls ~/Documents/AI-Being` → No such file or directory）。
- `~/Documents/_being-archive` 只剩归档：`ARCHIVE-README.md`、`CLEANUP-20261027.md`、`bundles/`（`AI-Being-final-20261027.bundle`、`being-final-20261027.bundle`、`AI-Being-decisions-worktree-20261016.bundle`、`being-merged.bundle`、`being-source.bundle`、`being-ui-nav-staging.bundle`、`being-ui-integration.bundle`）、`data/ai-being-data-20261012-0339.tgz`、`evidence/`、`manifests/`、`misc/`。原 `repos/` 7 个目录已移入 `~/.Trash/Documents-cleanup-20261027/`（`_being-archive/CLEANUP-20261027.md`）。

---

## 3. Card / Net / yonder-hermes-extensions 的职责与栈

### 3.1 Card = `yonder-card-web`（remote 名 `yonder-web`）

职责（`~/Documents/yonder-card-web/README.md:3`）："Yonder 的网页交互服务，包含 React 前端和 Node.js 后端。用户可以通过网页管理名片、联系人和设备，与人或接入的 Agent 对话；Agent 通过 Yonder Harness 的 card 渠道接入。"

- 包名：`package.json:2` = `yonder-card-web`，`server/package.json:2` = `yonder-card-server`；仓库名 `yonder-web`；README 标题 `# Yonder Web`。**四个名字并存**。版本 `0.2.26102301`（`VERSION`、两个 package.json 一致）。
- 前端栈（`package.json`）：React 19.3、react-router 8.5、Vite 8.3、Tailwind 4.3（`@tailwindcss/vite`）、nanostores + `@nanostores/react`、TanStack Query 5.104（含 persist-client/sync-storage-persister）、radix-ui 1.8、lucide-react、react-markdown + remark-gfm、qrcode.react、`@fontsource-variable/geist`。TS 7.0。
- 后端栈（`server/package.json`）：Hono 4.13 + `@hono/node-server` 2.1.3、`pg` 8.23、`node-pg-migrate` 9.0、`redis` 6.3、`ws` 8.22；engines `node >=24 <25`。ESM。
- 数据层：`server/migrations/001-init.cjs` … `009-avatar-url.cjs` 共 9 个迁移（账号/会话、设备-Agent 映射、会话-设备、设备邀请、Agent 公开、卡片 kind/face/collect、群邀请、可读码、avatarUrl）。
- 后端模块（`server/src/`）：`auth.ts`（账号/会话/限流/中间件）、`cards.ts`、`chat.ts`、`devices.ts`、`groups.ts`、`hub.ts`（在线与推送）、`realtime.ts`（两个 WebSocket）、`references.ts`（实体短码解析）、`profile.ts`、`actors.ts`、`config.ts`、`db.ts`、`migrate.ts`、`app.ts`、`index.ts`。
- 部署形态（`deploy/`）：`deploy.sh` / `rollback.sh` / `decommission-old.sh` / `provision-db.sh` / `net.sh` / `dev.mjs` / `dev-remote.sh` / `live-preview.mjs` / `service.template` / `site.conf.template` / `config.sh`。目标：`生产服务器`、`yonder.zethai.cn`、端口 18050、systemd 服务名 `yonder-card`（`deploy/README.md:4`）。环境变量 `DATABASE_URL`、`REDIS_URL`、`PUBLIC_ORIGIN`（`deploy/README.md:25-29`），生产库 `postgresql://yonder_card@127.0.0.1:5432/yonder_card`、`redis://127.0.0.1:6379/7`。本机后端默认 `127.0.0.1:18030`（`README.md:30`）。

### 3.2 Net

两个互不相同的仓都叫"Net"：

- `zoran-xc/being-net`（PRIVATE，2026-10-12）：描述 "AI Being network: accounts, relay, web client"。实际树只有 `apps/server/**`（`src/`：`app.ts`、`network.ts`、`account-voice.ts`、`apns.ts`、`attachments.ts`、`avatars.ts`、`cloud-dashscope.ts`、`provider-vault.ts`、`push.ts`、`settings-cache.ts`、`sharing.ts`、`snapshot-rpc.ts`、`social.ts`；`migrations/001-…018-` 共 18 个）+ `packages/protocol/src/index.ts` + `docs/` + `plan/arch-n1.md` + `evidence/social-spike/*.log`。**没有 web 客户端目录**，与描述不符。
- `GoYonderTogether/yondermesh`（PRIVATE，2026-10-21）：描述 "Self-hosted Agent Context Bus — let your AI agents see each other, query each other, and hand off tasks across devices and CLIs"。本机无 checkout，无法核对内部栈。

### 3.3 `yonder-hermes-extensions`

- 定位：**不是 Card/Net 仓**，是 Yonder Harness 的第三方插件包集合，把 Hermes Agent 的既有能力接到 Yonder 的单一模型/会话循环上（`DESIGN.md:5-11`）。
- 两个独立可加载包：`packages/learning`（记忆/技能）、`packages/hermes-workspace`（显式 home/profile 清单与接管预览）（`DESIGN.md:8-10`）。
- 依赖只有公开 `@yonder/sdk` + Node 内置；`package.json` peerDependencies：`@yonder/core >=0.2.26102103 <0.3.0`、`yaml 2.9.1`；`engines node >=22.19`；版本 `0.1.1`。
- 无 LICENSE 文件；`NOTICE` 说明"private first slice selects no distribution license for our new code yet"，并保留上游 Hermes MIT（`licenses/Hermes-MIT.txt`）与 Yonder SDK Apache-2.0 声明。
- 与 Card/Net 无代码依赖；无 deploy/ 目录。

---

## 4. 与 yonder 的接口

### 4.1 channel-card ↔ Card（`docs/spec/16-card-plugin.md`）

插件 `@yonder/plugin-channel-card`，id `channel-card`，渠道 type `card`（spec 第 1 行）。spec 明确"后端以 `yonder-card-web/server/src/{devices,realtime,chat,cards}.ts` 的真实实现为准"（`docs/spec/16-card-plugin.md:3`）。

端点（同文件）：

| 用途 | 方法/路径 | 鉴权 | 行 |
|---|---|---|---|
| 设备授权开始 | `POST /api/device/start` `{name,kind}` → `{code,url}` | 无 | 8 |
| 设备授权轮询 | `GET /api/device/poll?code=` → pending/used/confirmed，`confirmed` 取一次性 `deviceToken`；未知/过期 = 404 `invalid_code`；码 10 分钟 | 无 | 9 |
| 网页发起邀请 | `POST /api/device/invite` → `{code:"<10位数字>",expiresAt}` | 网页会话，仅人 | 10 |
| 邀请码兑换 | `POST /api/device/redeem` `{code,name,kind}` → `{deviceToken}`；404 `invalid_code`、429 `rate_limited` | 无，有限流 | 11 |
| Agent 登记 | `PUT /api/device/agents` `[{key,name,avatarUrl,note?}]` → `[{key,id}]`，`key` 必须等于 Yonder agent id，按 `(device,key)` 幂等 | `Authorization: Bearer` deviceToken | 18 |
| 消息多路 | 单条 `/ws/device` 连接，`{type:'hello'}` 后按 `agent_cursor` 补收，`{type:'ack',agentId,convId,seq}` | Bearer | 22 |
| DM 建会话 | `POST /api/device/dm` `{agentId,accountId}` → `{convId}`（幂等） | Bearer | 29 |
| 名片草稿 | `POST /api/device/cards` `{agentId,title,markdown,display?}` | Bearer | 35 |

- 默认 endpoint：`https://yonder.zethai.cn`（`docs/spec/16-card-plugin.md:39`、`plugins/channel-card/src/channel.ts:46`、`docs/spec/08-config.md:122`）。
- 令牌私有保存在 `<home>/.yonder/plugins/channel-card/`，目录 0700、文件 0600；绑定服务 origin；HTTP/WS 均用 `Authorization: Bearer`（spec 第 16 行附近）。
- 协议细节：下行 `{type:'message', agentId, convId, convKind:'dm'|'group'|'notice', mentioned, message}`；上行 `{type:'send', ref, agentId, convId, content, replyTo?}`；只有匹配 ref 的 `{type:'sent',ref,message}` 才算接纳，15 秒未确认/断连返回 `{ok:false,uncertain:true}` 且不自动重发（spec 第 23-27 行）。
- 引用嵌入格式：`conv:<instance>:<agentId>:<platformConvId>`、`acct:<instance>:<agentId>:<platformAccountId>`（spec 第 25 行）。
- 渠道 provider 注册 `multiAgent:true`；一个设备连接本实例全部 Agent，不为每个 Agent 单独登录（spec 第 5、20 行）。
- 首版出站仅文本/Markdown，不支持附件与流式（spec 第 31 行）。
- 工具：`channel-card_card_push`，只起草自己的名片，发布只由人在网页完成（spec 第 35 行）。
- 插件实现：`plugins/channel-card/src/channel.ts`（427 行），端点引用在 `:125`（agents）、`:166`（redeem）、`:182`（start）、`:257`（`/ws/device`）、`:368`（dm）、`:413`（cards）；`login` 兼容 CLI `--verify-code`。

### 4.2 Card 的 WebSocket 与账号协议（后端真实实现）

`yonder-card-web/server/src/realtime.ts`：
- `GET /ws`（`requireHuman`，校验 `origin` 必须等于 `deps.origin`）、`GET /ws/device`（`requireDevice` + 设备必须属于该账号）（`realtime.ts:12-25`）。
- 非升级请求返回 426 `{error:'upgrade_required'}`（`realtime.ts:30`）。

`yonder-card-web/server/src/*.ts` 路由全集（`grep app.(get|post|put|patch|delete)`）：
`/api/version`、`/api/auth/{register,login,anonymous,logout}`、`/api/session`、`/api/me`、`/api/cards[/:id][/draft|/publish|/collect|/start|/conversation]`、`/api/actors`、`/api/conversations[/:id/messages|/dm|/group|/read|/detail|/invite|/leave]`、`/api/device/{start,invite,redeem,code,confirm,poll,agents,dm,cards}`、`/api/devices[/:id][/online]`、`/api/contacts`、`/api/friends`、`/api/agents/:id/{online,public}`、`/api/groups/:token[/join]`、`/api/profile/:accountId`、`/api/resolve/:kind/:reference`、`/ws`、`/ws/device`。
会话类型 `ConversationKind` = `dm | group | notice`（`src/api/types.ts:51`）；actor `kind` = human/agent（`src/api/types.ts:10`）。

### 4.3 devices / execution-protocol / executor ↔ Card（`docs/spec/18-device-execution.md`）

- 契约状态：W0 只实现无模型契约与针对性检查；daemon、设备插件、relay、安装、真实配对及 VM 待后续（`docs/spec/18-device-execution.md:3`）。
- 身份：`deviceId` 本地生成 UUID；`principalId` = 控制宿主 Ed25519 公钥 SPKI DER 的 SHA-256 小写 hex；Card 账号/deviceToken/设备名都不是执行主体（第 5-9 行）。
- 配对：离线双端，执行端生成一次性 pairingId/code + 公钥 fingerprint，控制端核对 TLS fingerprint 与执行端公钥 fingerprint，两端各自持久保存后才完成；"配对全过程不依赖 Card、云账号、外部授权服务"（第 13 行）。
- 签名封套：`{algorithm:'Ed25519', keyId, payloadBase64, signatureBase64}`；`RpcRequest` = `{protocol:'yonder.execution',version:1,kind:'request',requestId,principalId,deviceId,issuedAt,expiresAt,method,params}`（第 15、89 行区域）。
- **relay 可见性（关键事实）**：第 24 行——"v1 Card relay 是可见正文的中继。两跳 WSS 防止链路旁观，但 Card 可以解码 payloadBase64；不宣称 E2EE/opaque。端到端签名使 Card 无法修改/伪造已配对端点请求或结果，不能阻止其读取/延迟/丢包/重放。"
- 外层信封：`{protocol:'yonder.execution.relay',version:1,routeId,envelope}`，routeId 不是权限（第 26 行）。
- RPC 方法表（第 33-45 行区域）：`device.describe`、`device.apps.list`、`device.ui.snapshot`、`device.sessions.open/close`、`commands.submit/status/cancel`、`grants.revoke`。
- 错误码冻结 14 个（`INVALID_REQUEST … INTERNAL_ERROR`，第 55 行区域）；`checkpointRestore:'unsupported'` 固定（第 61 行区域）。
- 跨仓共享（第 101 行）："Yonder 是唯一源。Card W3 只复制 relay schema 与 `contract.lock.json` 到 `server/contracts/execution-v1/`… Card 校验外层并转发内层字节，不复制执行授权逻辑。"
- W3 白名单（第 110 行）：Card 的 `server/src/execution-relay.ts`、`server/test/execution-relay.test.ts`、`server/contracts/execution-v1/**`、`server/src/{index,app,realtime}.ts` 接线、`deploy/{site.conf.template,dev-remote.sh,test.mjs}`。
- 模型工具名（第 6 节）：`devices_list / devices_describe / devices_apps / devices_open / devices_observe / devices_execute / devices_status / devices_cancel / devices_close`；管理 CLI `yonder-executor init|serve|pair start|pair approve|pair connect|peers list|grants list|grants revoke`。

实现落点：
- `packages/protocol/`：`src/schema.ts`、`src/index.ts`、`schema/execution-v1.json`、`schema/relay-v1.json`、`scripts/export-schema.mjs`、`README.md`。版本 `0.2.26102510`（spec 第 5 行）。
- `packages/device/src/card-connection.ts`：`CardDaemonConnection`，类注释 "Routing credential only: every incoming request still needs the executor's paired signature/grant."；`POST /api/execution/ticket` `{targetDeviceId}` 取 ticket（`card-connection.ts:66-72`），再以 `Authorization: Bearer` + `x-execution-relay-ticket` 连 `/ws/execution`（`:100-110`）；`maxPayload: 1_400_000`、`perMessageDeflate:false`、`followRedirects:false`；消息必须是 `type:'relay'` + `sourceDeviceId === peerDeviceId` + `Check(RelayFrameSchema, message.frame)`（`:129-136`）；ticket 正则 `^[A-Za-z0-9_-]{43}$`（`:93`）。
- `plugins/devices/src/connections.ts`：`card?: { baseUrl, credential, peerDeviceId }`（`:17`），经 `credentials.get(cardConfig.credential)` 取凭据（`:83`）；路由 `kind: "direct" | "card"`（`transport.ts:20`、`routes.ts:110`）。
- `plugins/devices/README.md:3`：W0 base `0591eae69f45f6973259833e44386a421998b277`；插件"不实现 W1 pairing/daemon/authorization、W3 relay service"。
- **Card 主树尚无 relay**：`~/Documents/yonder-card-web/server/src/` 无 `execution-relay.ts`，`index.ts`/`app.ts`/`realtime.ts` 无 `execution` 引用（`grep` 无命中）。relay 只存在于 worktree `…/yonder-card-multidevice-w0/server/src/execution-relay.ts`（113 行）与 `card-w3`，接线在 `server/src/app.ts:18`、`server/src/realtime.ts:11,34-35,146`。锁文件 `server/contracts/execution-v1/contract.lock.json`：`source.commit = 0591eae69f45f6973259833e44386a421998b277`、`schemaSha256 = d2b734f540c95b8bd9dd7c7abc31efd2693c6bd7ebf69ee51e6d6b0a2fadc39e`、`confidentiality: "relay-readable"`、`publishedNpmPackageRequired: false`。
- worktree relay 的鉴权：`POST /api/execution/ticket` 需 `requireDevice`，校验两端设备同 `owner_id`，ticket 为 32 字节 base64url，Redis 键 `yonder-card:execution-ticket:<sha256>`、TTL 60s（`execution-relay.ts:50-66`）；`GET /ws/execution` 非升级返回 426（`:67`）；连接时 `redis.getDel` 校验 source/owner/session tokenHash 绑定（`:72-84`）；`MAX_RELAY_FRAME_BYTES = 1_400_000`（`:15`）；时间窗 `issuedAt <= now+30s`、`expiresAt > now`、跨度 ≤ 5 分钟（`:38`）。

---

## 5. 前端情况

### 5.1 Card web（`yonder-card-web/src`）

路由（`src/App.tsx:38-58`）：

| 路径 | 组件 |
|---|---|
| `/login` | `pages/Login.tsx` |
| `/u/:id`、`/p/:accountId` | `pages/CardPage.tsx` |
| `/g/:token` | `pages/GroupJoin.tsx` |
| `/get` | `pages/Install.tsx` |
| `/cards/:id?`、`/cards/:id/edit` | `CardsRedirect`（重定向到 Contacts） |
| `/friends/add` | `pages/AddFriend.tsx` |
| `/contacts/:id?` | `pages/Contacts.tsx` |
| `/connect` | `pages/Connect.tsx` |
| `/me` | `pages/Me.tsx` |
| `/`（`ChatShell` 内）、`/c/:id` | `pages/Chat.tsx`（`ChatShell` / `Conversation`） |
| `*` | 内联 404 |

- 全部页面 lazy + Suspense（`App.tsx:9-20`）；`Private` 守卫在 `App.tsx:22-26`（匿名用户访问 `/cards*` 跳登录）。
- 组件目录：`src/components/` 30 项，分三组——通用（`AppBar`、`Shell`、`EmptyPane`、`PageLoading`、`PlusMenu`、`PlusWindows`、`Sandbox`、`Markdown*`、`CardShare`、`CardView`、`IdentityDetail`、`IdentityQr`、`AgentPublicToggle`）、`components/card/`（`CardFace.tsx`、`image.ts`、`themes.ts`）、`components/chat/`（`ChatDetail.tsx`、`AiBadge.tsx`、`AnonHint.tsx`、`DeviceRow.tsx`）、`components/wallet/`（`Wallet`、`DesktopWallet`、`CardStack`、`CardFullscreen`、`ContactList`、`ContactDetail`、`DeviceSheet`、`layout.ts`）。
- `src/ui/` 原语：`Avatar`、`Button`、`Field`、`Logo`、`Toast`、`Window`、`Aura`。
- 状态与数据：`store.ts`（nanostores 会话）、`cache.ts`、`pageCache.ts`、`src/api/{client,http,mock,types,avatarUrl,summary}.ts`；数据源切换在 `src/api/index.ts:5`：`import.meta.env.VITE_API === 'http' ? httpApi : mockApi`（**默认 mock**）。`http.ts:5` 请求走同源 `/api`，401 时派发 `yonder:unauthorized` 事件。
- 样式：单一 `src/styles.css`（197 行，115 处 `--` 令牌）；`DESIGN.md` 规定"颜色、字号、圆角、动效只用 `src/styles.css` 里的令牌"（`DESIGN.md:3`）。
- 已有会话/agent/bot 界面：**有**。`pages/Chat.tsx`（会话与消息）、`components/chat/ChatDetail.tsx`、`components/chat/AiBadge.tsx`（注释："名字后的小「AI」标：Agent 会话与成员用"）、`components/chat/DeviceRow.tsx`、`pages/Me.tsx:79-95`（"我的 Agent" 区块，`contacts.filter(a => a.kind === 'agent' && a.ownerId === s.actor.id)`，空态文案"连接设备后，Agent 会出现在这里"）、`pages/Connect.tsx`（设备授权码确认 + `AddDeviceDialog` 邀请码，`Connect.tsx:14-40`）、`components/AgentPublicToggle.tsx`。
- 品牌资产：`src/assets/brand/`（`yonder-mark.svg`、`yonder-mark-small.svg`、`yonder-tile-ink.svg`、`yonder-tile-small-ink.svg`）+ 独立 `brand/` 目录（`BRIEF.md`、`agent.svg`、`mark.svg`、`preview.html`、`v3/`、`v4/` 含 `a-road/b-bottle/c-slide/d-kite/e-wave/f-recede` 六方案 SVG 与 round1/round2 图）。

### 5.2 与 `plugins/interaction/web` 的重复

- 技术栈不同：`interaction/web` 是**无框架原生 JS + 单文件 CSS**（`app.js`、`panel.mjs`、`state.mjs`、`activity.mjs`、`style.css`、`index.html`，`build.mjs` 把模板、CSS、品牌、脚本内联成单页）；Card web 是 React 19 + Vite + Tailwind。
- **样式令牌是复制关系，且已写在文件头**：`~/Documents/yonder-harness/plugins/interaction/web/style.css:1-2` — "Visual tokens copied from yonder-card-web/src/styles.css at 1c5b692. Keep aligned with its DESIGN.md; this prototype only adapts window layout."
- 品牌是共享单一源：`interaction/build.mjs:14` 读 `root/brand/src/yonder-mark.js`；`brand/README.md:3` — "`src/yonder-mark.js` 是标志几何和角色动效的唯一来源… Web 在构建时直接内联同一源文件，不另建一套 Logo。" 而 Card web 自己另存一套 `src/assets/brand/*.svg` 与 `brand/` 草案目录。
- 组件无共享：`interaction/web/index.html` 用 `<svg><use href="#i-*"/></svg>` 符号表 + `web/assets/lucide/symbols.svg`；Card web 用 `lucide-react` 组件。两边都内联 Geist 字体（`interaction/web/assets/geist-latin-wght-normal.woff2` vs Card 的 `@fontsource-variable/geist`）。
- 品牌/文案同源：`interaction/README.md:3` — "保留 ai-card Web 风格、唯一共享品牌角色、同锚点展开/收起、大区域拖拽与历史回溯"。
- 功能重叠：interaction 有 `agents-view`（Agent 列表）、`board-view`（任务看板）、`history-view`（交互历史）、`task-view`（选择/补充想法）（`web/index.html` 各 `<section>`）；Card web 的 Agent 列表在 `pages/Me.tsx` / `pages/Contacts.tsx`，无看板/交互历史。

---

## 6. 矩阵问题的事实清单

### 6.1 同一能力多仓重复实现

| 能力 | 重复位置 |
|---|---|
| 账号/会话 | `yonder-card-web/server/src/auth.ts`（scrypt + token sha256）；`zoran-xc/being-net/apps/server/src/{app,network}.ts`；`AI-Being/net/**`（已删除本地，见 `server/PLAN.md:8` 引用路径 `~/Documents/AI-Being/net/apps/server/src/app.ts`） |
| relay | Card `server/src/{realtime,execution-relay}.ts`（`/ws`、`/ws/device`、`/ws/execution` 三套）；`being-net` 的 relay；`yondermesh`（"Agent Context Bus"）；`packages/device/src/card-connection.ts` 的执行 relay 客户端 |
| 卡片/名片 | Card `src/components/card/*`、`src/components/wallet/CardStack.tsx`、`server/src/cards.ts`；`AI-Being/web`（旧名片前端）；`yonder/proposals/ai-card/plugin.md`（已被 spec16 声明取代："`proposals/ai-card/plugin.md` 的 Tinode 方案已被取代"，`docs/spec/16-card-plugin.md:3`） |
| 网页端 | `yonder-card-web/src`（React）；`plugins/interaction/web`（原生 JS 单页）；`AI-Being/web`（已删）；`being-net` 描述里的 "web client"（仓内无对应目录） |
| 品牌资源 | `yonder/brand/src/yonder-mark.js` + `brand/assets/{macos,png}`（声明唯一源）；`yonder-card-web/src/assets/brand/*.svg`；`yonder-card-web/brand/{mark,agent}.svg` + `v3/` + `v4/` 六方案；`plugins/interaction/web/assets/lucide/symbols.svg` |
| 状态栏/菜单栏 | `yonder/packages/macos/src/{YonderStatus,Companion,PowerHelper}.swift`；`plugins/interaction/README.md:6` 称构建 `packages/macos/dist/YonderStatus.app`（但 `plugins/interaction/build.mjs` 中 `grep macos` 无命中，只有 web 内联构建）；另有独立仓 `~/Documents/mac-toolkit`（无 remote，含 `Sources/`、`Resources/`、`Tests/`） |
| 设计令牌 | `yonder-card-web/src/styles.css`（197 行，唯一权威）+ `plugins/interaction/web/style.css` 手工复制副本（注明"copied at 1c5b692"） |
| 设备/Agent 映射 | Card `server/src/devices.ts`（`/api/device/agents`）+ `server/migrations/002-device-agents.cjs`；harness `plugins/devices`（W1 `ControllerPairing` 目录 + `device-<UUID>.json`，见 `plugins/devices/README.md:12`）——两套设备身份命名空间，`execution-relay.ts:88` 注释明确："Card device UUIDs and W0 executor device IDs are distinct namespaces." |

### 6.2 仓库命名不一致

- 仓库 `GoYonderTogether/yonder-web` ↔ 本地目录 `yonder-card-web` ↔ 前端包名 `yonder-card-web` ↔ 后端包名 `yonder-card-server` ↔ README 标题 `# Yonder Web`。
- 同一 `yonder` 存在于两个账号（GoYonderTogether PUBLIC / zoran-xc PRIVATE 旧镜像）。
- "Net" 一词对应两个仓：`being-net`（旧）与 `yondermesh`（新），本机都无 checkout。
- 分支名混三套前缀：`zoran/live-dev`、`codex/multidevice-w0-20261026`、`fix/…`、`yonder/…`；harness 侧 `archive/main`、`archive/private-main`、`archive/main-before-rightapi-20261023`、`yonder/{card-plugin,clipboard-vault,runtime-discipline}`。

### 6.3 开源/闭源边界现状

| 仓库 | 可见性 | LICENSE 文件 |
|---|---|---|
| `GoYonderTogether/yonder-harness` | PUBLIC | Apache-2.0（`yonder/LICENSE` 首行 "Apache License Version 2.0"；`package.json:5` `"license": "Apache-2.0"`） |
| `GoYonderTogether/yonder-web` | PRIVATE | 无（`ls yonder-card-web/LICENSE*` → No such file） |
| `GoYonderTogether/yondermesh` | PRIVATE | GitHub API `license: null` |
| `GoYonderTogether/pi` | PUBLIC | 上游 pi 的许可（fork） |
| `zoran-xc/yonder` | PRIVATE | Apache-2.0 |
| `zoran-xc/AI-Being` | PRIVATE | `null` |
| `zoran-xc/being-net` | PRIVATE | `null` |
| `zoran-xc/being` | PRIVATE | `null` |
| `zoran-xc/yonder-being` | PRIVATE | 无（`ls github/yonder-being/LICENSE*` 无） |
| `zoran-xc/being-releases` | PUBLIC | 未核对内容（0 KB） |
| `zoran-xc/otherwhere` | PRIVATE | GPL-3.0 |
| `yonder-hermes-extensions`（无 remote） | — | 无；`NOTICE` 声明"private first slice selects no distribution license for our new code yet" |

事实性后果：harness 的 `docs/spec/16-card-plugin.md:3`、`docs/spec/18-device-execution.md:101` 都指向私有 Card 仓的真实实现/协议锁，公开仓的规格与私有实现形成单向依赖。

### 6.4 废弃仓库是否仍被引用

仍有引用（全部为"迁移来源/参照"性质，非运行时依赖）：

| 引用点 | 内容 |
|---|---|
| `yonder-card-web/server/PLAN.md:8` | "**参照 AI-Being 的 net 后端**（`~/Documents/AI-Being/net/apps/server/src/app.ts`、`network.ts`，`net/test/services.ts`）… 复制写法，不要 import 那个仓库。" —— 指向已不存在的路径 |
| `yonder-card-web/DESIGN.md:9` | 设计参照 "AI-Being（本机 `AI-Being/docs/product/design-principles.md`、`web/src/styles/tokens.css`）" —— 同样指向已删路径 |
| `yonder-card-web/deploy/README.md:45` | 部署脚本"不会触碰 being-net、life-story、invest-agent、其他 nginx 站点及 `/opt/being-mobile/current`" —— 旧 being 站仍在同机 nginx 上 |
| `yonder/plugins/wechat-archive/README.md:3`、`NOTICE.md:1`、`src/source.ts:1` | 迁移自 `AI-Being/plugins/wechat-archive` |
| `yonder/plugins/channel-wechat-ilink/README.md:3`、`NOTICE.md:1`、`src/client.ts:1` | 迁移自 `AI-Being/plugins/wechat-ilink` |
| `yonder/plugins/web-tools/SOURCES.md:7`、`README.md:5`、`docs/spec/11-official-plugins.md:63,65`、`THIRD_PARTY_NOTICES.md:63,74` | 对照 AI-Being（"本机仓库未发现 LICENSE，不直接复制代码"）；不读 AI-Being 登录/密钥文件 |
| `yonder/docs/decisions.md:21,29,140` | D8 沿用 AI-Being 的配置格式；D11 说明 AI-Being 的登录键名/格式对不上；第 140 行记录微信双插件迁移指令 |
| `yonder/HANDOFF.md:25,28,29,34` | 指向 `~/.ai-being/providers.json` 等三份配置；"不要读写 `~/.ai-being` 下除上述三个文件以外的内容" |
| `yonder/docs/verification/wechat-plugins.md:3`、`docs/research/qq-group-participation.md:91` | 迁移/借鉴记录（含 `AI-Being/plugins/voice/agents/voice.md`） |
| `personal-ai-lab/projects/persistent-being`、`personal-ai-lab/docs/persistent-being-*.md` | `personal-ai-lab` 仓内仍有 persistent-being 项目与验收文档 |

运行时残留：
- `~/.ai-being/` 目录仍存在（含 `auth.json`、`beings/`、`current-being`、`daemon.json`、`daemon.token`、`backups/`），以及 `~/.ai-being-dispatch/`、`~/.ai-being-wechat-acceptance/`。
- `~/Documents` 下另有 `yonder-prompt-reference/local-private/AI-Being-Jarvis`（非 git 目录）。
- `AI-Being`、`being`、`being-net`、`yonder-being`、`being-releases` 五个仓在 GitHub 上**均未 archive**（`archived: false`），`being-net` 最后推送 2026-10-12、`AI-Being` 2026-10-17。
- `_being-archive/` 本身不是 git 仓，只有 bundle 与快照，`repos/` 已空（仅 `bundles/`、`data/`、`evidence/`、`manifests/`、`misc/`、`decision-evidence/`）。

### 6.5 其他可直接观察到的事实

- `yonder-card-web/docs/status.md:18`：2026-10-26 后端测试 71 项，"70 通过、1 失败"，失败项 `card conversation is 404 without session, card or DM`（`server/test/card-start.test.ts:70` 期望 404、实际 400，原因待排查）；同段声明"本次未进行浏览器端到端、Harness 联调或生产部署验收"。
- `yonder-card-web/deploy/README.md:1`："待主人审核执行；未连接生产"。
- harness 版本 `0.2.26102705`（`package.json:55`）高于 Card 版本 `0.2.26102301`；Card 主树 `main` 分支提交信息里的版本标记同样是 `0.2.26102301`，而 `zoran/live-dev` 已领先 44 个提交且未合并。
- `yonder-card-web` 的 5 个 worktree 分布在 `/private/tmp`、`~/.local/share/yonder/home/development`、`~/Documents/Codex/2026-10-26/` 三处，其中 `card-w3` 与 `yonder-card-multidevice-w0` 携带 relay 实现而主树没有。