# Yonder 统一客户端与矩阵架构升级：设计文档

> 状态：提案，待维护者批准。本文件不改动 `docs/spec/`、`docs/architecture.md`、`docs/decisions.md`、`AGENTS.md`；需改的条款见第 6 节。
> 日期：2026-10-27。输入：`proposals/unified-client/research/BRIEF.md`、A1/A2/A4/A5，以及对 `packages/core/src/control/index.ts`、`packages/cli/src/index.ts:700-849`、`plugins/ui-companion/src/service.ts:160-279`、spec 04/13/16/18 的核对。
> 约定：「事实」带路径。「建议」是本文的设计。「未核实」是我没读到源码或没运行验证的内容。本次未使用 codegraph，也未联网。

---

## 0. 一页摘要

目标架构一句话：每台安装了 Yonder 的机器都是一个完整节点，节点内置一个 loopback 网关和一套 React 前端。网页、桌面壳、状态栏、悬浮窗都是同一前端对同一方法表的视图。轻客户端是另一条轴，指只暴露设备能力的执行节点，不是界面。云只提供 Card 社交和 Relay 传输，开源核心不依赖它们。

核心决定（均为建议）：

1. 节点角色和界面是两条轴。完整节点（Full Node）、执行节点（Execution Node）是节点角色。界面客户端（UI Client）只是前端。「轻客户端」一词只指执行节点，C 端文案不使用，因为用户会把「客户端」理解成界面。
2. 内核内放一个网关（新包 `packages/gateway`），由 `yonder start` 拉起，只绑 loopback，鉴权为一次性启动 token 换 HttpOnly 签名 cookie，并做 Host/Origin/Fetch-Metadata 校验。`control.sock` 保留给 CLI，两者共用同一份 typed 方法注册表。
3. 把 `packages/cli/src/index.ts:724-841` 的 switch 下沉为 `packages/core/src/control/` 的 TypeBox 方法注册表，带 scope 标注。这是唯一的大重构，也是 P0 的第一步。
4. 前端只做一份：`apps/web`（React 19 + Vite + TS + Tailwind 4，与 Card 同栈）。ui-companion 的原生 JS 页面和 tasks 的 HTTP 服务在 P1 退役。DSH（MIT）只借模式，不 vendor 代码。
5. 产品层和插件层按五条可判定准则划分（§2.1）。状态栏、悬浮窗、网页、活动汇总、人机交互渲染是内置产品层。插件通过新增的声明式 `views` 槽贡献面板，贡献的是数据卡片，不是 JS 包。
6. 桌面壳：macOS 继续用 Swift 薄壳，改为订阅网关。跨平台壳放到 P4 再定，倾向 Tauri。P0–P3 不引入 Electron。
7. 仓库：不新建发行仓，把发行做成主仓的 bundle 清单。新增两个公开包：`@yonder/design`（令牌、品牌、图标）和 `@yonder/cloud-protocol`（Card 设备协议和 relay 外层，让公开 spec 不再依赖私有实现）。Card 仓统一命名为 `yonder-card`（私有，补专有 LICENSE）。being 系五仓和旧私有镜像 archive，不删除。
8. 组网三档共用 spec 18 的配对和签名模型。Yonder Cloud 的 relay 目前正文可读（`docs/spec/18-device-execution.md:24`），在 E2EE 落地前不开放经 Cloud 的远程控制面（会话转录和输入）。

需要主人拍板的事项（详见各节）：

- Q1：批准新增网关，并修改 spec 13 §2「不另做 Web 控制台」。
- Q2：`views` 槽只支持声明式数据卡片，P0–P3 不允许插件自带 JS。
- Q3：ui-companion 拆分方案（交互工具留作默认插件，服务端、web、`desktop.json` 退役）。
- Q4：`apps/web` 放主仓公开，技术栈 React 19 + Vite + Tailwind 4。
- Q5：桌面壳路线（macOS Swift 保留；跨平台壳 P4 再选）。
- Q6：`@yonder/design` 放主仓并发布，Card 反向依赖。
- Q7：新增公开 `@yonder/cloud-protocol`，重写 spec 16「以 Card 真实实现为准」的措辞。
- Q8：Card 仓改名 `yonder-card` 并加 LICENSE。
- Q9：archive 哪些旧仓（being 系五仓、`zoran-xc/yonder-harness`）。
- Q10：授权只读对比 `yondermesh`（本机无 checkout，需联网）。
- Q11：E2EE 之前不开放经 Yonder Cloud 的远程控制面。
- Q12：C 端默认 bundle 的插件清单。
- Q13：`plugins/hermes-experience` 与 `yonder-hermes-extensions/packages/hermes-experience` 重名，保留哪个。
- Q14：`status.json` / `desktop.json` 的兼容窗口。
- Q15：网关默认开启和端口策略（固定端口还是随机端口加持久化）。

---

## 1. 概念模型

### 1.1 定义

| 名词 | 定义 | 持有什么 | 进程 / 位置 |
|---|---|---|---|
| 完整节点 Full Node | 能独立运行 agent 的 Yonder：配置、模型凭据、agent、会话、插件、事件库、网关 | `yonder.yaml`、凭据、`state.db`、转录（pi-durable） | `yonder start`（`packages/cli` + `packages/core`） |
| 执行节点 Execution Node | 无模型、无 agent 的设备端：只按配对主体的签名请求暴露本机工具和设备能力 | 设备身份（Ed25519）、grant、命令账本、后端 | `yonder-executor`（`packages/executor`，契约 `docs/spec/18-device-execution.md`） |
| 界面客户端 UI Client | 只负责展示和输入的前端，没有业务状态，没有模型凭据。可连本机网关，也可经 Net 连远端完整节点 | 浏览器 cookie、窗口位置等 UI 偏好 | 浏览器页签、桌面壳、状态栏、悬浮窗 |
| 云服务 | Card：账号、社交、名片、聊天（应用层）。Relay/Net：设备间传输（只转发） | 账号、关系、路由信息 | 私有部署（现为 `yonder.zethai.cn`） |
| 组网三档 | ① 无云：直连或局域网；② 自建 relay：开源参考 relay；③ Yonder Cloud：托管 relay 加 Card 账号 | — | 见 §1.4 |

### 1.2 回答主人的问题

**轻客户端和面向用户的客户端是不是同一个概念？不是，要拆开。** 两者回答不同的问题：

- 执行节点回答「这台机器能替 agent 做什么」。它没有界面，不需要用户操作。用户只在配对时见到它一次。它是网络里的被调用方。
- 界面客户端回答「人怎么看和操作 agent」。它没有能力，只展示。
- 一台机器可以同时是完整节点、执行节点和界面客户端。spec 18 已写明 full 发行包含 executor 管理组件，可作为 controller 和 executor（`docs/spec/18-device-execution.md` §5 末段）。因此用同一个词会让用户分不清「我的 Mac 是什么」。

建议的对外话术：

- 「Yonder」是用户装的那个应用。
- 「设备」是被 Yonder 使用的其他电脑或手机，对应执行节点。
- 「窗口」是任意界面客户端。

「轻客户端」仅在开发者文档里作为执行节点的别名出现。

**C 端用户看到的产品形态：** 一个安装包，装好即可用，内部是完整节点加统一界面加默认插件。用户看到：

- 一个主窗口（左边是常驻 bot 和任务，中间是对话，右边是任务和待办面板）。
- 一个菜单栏图标，显示活动状态，点击展开。
- 一个悬浮窗，用来回答 agent 的提问，并显示任务进度。
- 「设备」页，用来添加其他设备，让 Yonder 使用它们。
- 可选的「登录 Card」。

用户不会看到「内核」「插件」「渠道 type」「控制面」。

**开发者看到的：** 仓库是 monorepo（`packages/` + `plugins/`）。无渠道的 `@yonder/core` + `@yonder/sdk` 单独可运行。九个（加本文新增的 `views`）插件槽、`yonder.yaml` 和 CLI/TUI 不变。网关的方法表有文档和 TypeBox schema，开发者可以自己写客户端。开发者可以用 `--bundle core` 初始化，得到一个没有渠道、没有 UI 的内核。

### 1.3 关系图

```
                         ┌──────────────── 界面客户端（可有多个，无状态）────────────────┐
                         │ 浏览器页签   桌面壳(Swift/未来Tauri)   状态栏   悬浮窗      │
                         │   └── 都加载同一份 apps/web（路由：/、/companion、/menu） ──┘
                         └───────────────┬─────────────────────────────────────────────┘
                                         │ HTTP /api/rpc/* + WS /api/stream（同一方法表）
        本机 loopback（cookie）           │            远程（P3，经配对签名）
                                         ▼
 ┌───────────────────── 完整节点 Full Node（yonder start）─────────────────────┐
 │  gateway ─┐                                                                  │
 │           ├─▶ 方法注册表（core/control，TypeBox）◀── control.sock ◀── CLI/TUI│
 │  内核：事件→绑定→会话→运行→投递   插件(channels/tools/views/…)   凭据/配置     │
 │  executor 管理组件（可选）                                                    │
 └────────┬───────────────────────────────┬─────────────────────────────────────┘
          │ spec 18 签名 RPC               │ channel-card（出站 WSS，Bearer）
          ▼                                ▼
   执行节点（他机，无模型）          ┌──── 组网三档（同一套协议）────┐
   packages/executor                │ ① 直连/LAN（TLS 指纹配对）      │
                                    │ ② 自建 relay（开源参考实现）    │
                                    │ ③ Yonder Cloud = Relay + Card   │
                                    └─────────────────────────────────┘
 依赖方向：Card(闭源) ──▶ @yonder/cloud-protocol、@yonder/design(开源)；开源 ──✗──▶ Card
```

### 1.4 组网三档

| 档 | 传输 | 认证 | 谁能读正文 | 现状 |
|---|---|---|---|---|
| ① 直连/LAN | 节点间 TLS，配对时核对指纹 | spec 18 §2 离线双端配对（Ed25519，不依赖云） | 仅两端 | 契约 W0 已有，daemon 和配对待 W1（`docs/spec/18` §1） |
| ② 自建 relay | 节点出站 WSS 到用户自己的 relay | 同上签名加 relay ticket | relay 运营者（自己） | relay 只在 Card worktree（`yonder-card-multidevice-w0/server/src/execution-relay.ts`），主树没有 |
| ③ Yonder Cloud | 同②，relay 由 Card 托管 | 签名加 Card 账号 ticket（60s，`execution-relay.ts:50-66`） | 当前 Card 可解码 payload（`docs/spec/18:24`） | 未合主树 |

关键点：三档只在「怎么连到对方」上不同，请求格式和签名完全相同，所以「共用一套协议」成立。Card 是建在 Relay 之上的社交层，不是传输层的一部分。

---

## 2. 产品层 vs 插件层

### 2.1 判定准则

按顺序判，第一条命中即定：

- **R1 主线必需 → 核心（`packages/core` 等）。** 去掉后「事件→绑定→会话→运行→投递」跑不起来（`docs/architecture.md` §2）。
- **R2 跨表面共享状态，或位于人类信任边界 → 内置产品层。** 同一状态要被 ≥2 个表面同时展示，或者承担「谁在回答/授权」。例如活动汇总、会话观察、待回答的提问卡、网关鉴权。这类不放进插件，因为插件可以不装，装了也可能缺席。
- **R3 一方的开箱体验，通过工具、上下文或触发器赋能 agent → 默认插件。** 保持插件形态（遵守 spec 04 的依赖和隔离约束），由发行 bundle 默认启用。代表：memory、cron、tasks。
- **R4 第三方平台集成、需要特殊 OS 权限或重依赖、实验性、地区性 → 可选插件。** C 端包默认不带，用户或开发者按需添加。
- **R5 属于别的产品或已无维护方 → 移出。**

理由：现在的问题在于 R2 类的东西被当作 R3/R4 做成了可选插件。ui-companion 的 HTTP 服务、tasks 的 HTTP 服务都是人面向的表面，却各自起服务，所以才出现 6 处自起服务和 3 套活动汇总（`docs/` 外的事实见 A1 §3）。R3 的存在保证「插件化需要更克制」不等于「全塞进核心」：能通过现有槽表达的就仍是插件，只是默认启用。

### 2.2 开发者的「无渠道核心」如何保留

- 内核不依赖网关或前端。`@yonder/core` 不 import `@yonder/gateway`。网关反向依赖 core。
- `yonder start --no-gateway`（或 `gateway.enabled: false`）可完全关闭。
- 新增发行 bundle 清单 `distribution/bundles/{core,default,full}.json`，只列插件 id 和配置默认值（不是新机制，只是 `yonder.yaml.plugins` 的预制模板，复用 `init` 的现有写入路径）。`core` 为空列表，`default` 面向 C 端，`full` 面向开发者自用。
- 架构不变量 3「插件装上不等于生效」不变：bundle 只决定加载，agent/profile 的选用仍在 `agent.yaml`。

### 2.3 逐项归属建议

分类：**核心**（R1）、**产品层**（R2）、**默认**（R3，默认插件）、**可选**（R4）、**移出**（R5）。

packages：

| 项 | 归属 | 说明 |
|---|---|---|
| `@yonder/core`、`@yonder/sdk`、`@yonder/pi-durable` | 核心 | 不变 |
| `@yonder/cli` | 核心（客户端） | handler 下沉后只剩 CLI/TUI 与启动编排（3,280 行，A4） |
| `@yonder/execution-protocol`、`@yonder/executor` | 核心（执行节点） | 开源，执行节点唯一来源 |
| `packages/macos`（Swift，974 行） | 产品层 | 状态栏和悬浮窗壳，改为订阅网关 |
| `packages/macos-helper`（Swift，7,584 行） | 产品层（发行） | 权限引导，服务 native-automation，不改 |
| 新增 `packages/gateway` | 产品层 | 网关 |
| 新增 `apps/web` | 产品层 | 统一前端 |
| 新增 `packages/design` | 产品层（共享） | 令牌、品牌、图标 |
| 新增 `packages/cloud-protocol` | 核心（协议） | P3 |

plugins（23 个）：

| 插件 | 归属 | 理由 |
|---|---|---|
| ui-companion | **拆分**：`present/result` 工具和交互存储 → 默认；HTTP 服务、`web/`、`desktop.json` → 移入网关和 `apps/web` | 提问卡是 agent 与人之间的信任边界交互（R2），但工具本身通过工具槽提供（R3）。服务和前端是表面（R2），不该由插件各起一套 |
| tasks | 默认 | 账本、工具、催办留作插件（D66 已批准官方插件）。`service.ts` 的 HTTP 服务退役，看板通过 `views` 槽贡献。`board.ts` 的文本/SVG/PNG 渲染保留，供 IM 渠道出图 |
| channel-cli | 可选 | 只是 TUI 之外的第二个终端入口（A1 §2.9），C 端不需要，TUI 不依赖它。开发者 bundle 带 |
| channel-card | 默认（未登录时空闲） | Card 是最早的云玩法。默认装好，用户点「登录」才联网。`setup` 不联网（spec 16 §5），符合 R3。开发者 `core` bundle 不带 |
| devices | 可选（W2 完成后升为默认） | 现在是 W0 契约加部分实现，daemon 和配对未完成（`plugins/devices/README.md:3`），不宜默认带给 C 端 |
| cron | 默认 | 常见的开箱需求。调度列表后续通过 `views` 贡献 |
| memory | 默认 | 「记得我」是 C 端核心体验。按 spec 15 仍是插件（不进内核），默认启用 |
| agent-presets、context-files | 默认 | 体量极小（54 和 28 行），预设和上下文基础 |
| web-tools | 默认 | 最小的通用检索能力（359 行） |
| mcp-client | 可选 | 高级用户和开发者用 |
| channel-mcp | 可选 | 对外暴露 18 个 MCP 控制工具、自起 loopback 服务（`plugins/channel-mcp/src/operations.ts:50,156`），属于开发者集成，不进 C 端包 |
| channel-feishu、channel-github、channel-qq、channel-wechat-ilink | 可选 | 平台和地区性，发行 bundle 可按地区预置，不进默认 |
| wechat-archive | 可选 | 读本机微信记录，隐私敏感，须显式启用 |
| clipboard、native-automation、browser-skill | 可选 | 需要 macOS 权限或外部程序（browser-skill 依赖 bsk CLI 与浏览器扩展，来自 skills 说明）。C 端可在后续「能力包」里按需开启 |
| codex-tools、media-tools | 可选（未核实内容） | 本次未读其源码，按体量和贡献清单判断为非必需 |
| hermes-experience | **移出待定** | 主仓 `plugins/hermes-experience`（1,723 行）与 `yonder-hermes-extensions/packages/hermes-experience` 同名（A5 §3.3）。未核实二者关系，见 Q13 |

### 2.4 兼顾无渠道核心的检验

验收一条：`yonder init --bundle core` 加 `yonder start --no-gateway`，不加载任何插件仍可 `sessions.open` 一个预设并对话（CLI/TUI 路径）。这就是现在的行为，本方案不得破坏它。

---

## 3. 仓库矩阵与目录布局

### 3.1 目标仓库清单

| 仓库（目标名） | 可见性 | LICENSE | 职责 | 依赖（单向） |
|---|---|---|---|---|
| `GoYonderTogether/yonder-harness` | 公开 | Apache-2.0（已有） | 内核、SDK、CLI/TUI、执行协议和执行节点、默认及可选插件、网关、`apps/web`、`@yonder/design`、`@yonder/cloud-protocol`、参考 relay、macOS 壳、bundle 清单 | 无（只依赖第三方和 pi） |
| `GoYonderTogether/yonder-card`（现 `yonder-web`，本地 `yonder-card-web`） | 私有 | 新增专有声明（All rights reserved），不借用 Apache | Card 前端、后端、账号、Yonder Cloud relay、部署脚本 | `@yonder/cloud-protocol`、`@yonder/design`（版本固定） |
| `GoYonderTogether/yonder-app`（发行仓） | 暂不创建 | — | 安装器、签名、自动更新 | P4 视需要再建，见 §3.4 |
| `GoYonderTogether/pi` | 公开 | 上游许可 | pi fork，不属本次范围 | — |
| `yondermesh` | 私有 | 无 | 未明，见 §3.5 | 待定 |
| `yonder-hermes-extensions` | 本地无 remote | 无（`NOTICE` 声明暂不选许可） | 第三方插件包 | `@yonder/sdk` |

闭源部分不放在公开仓里，也不让公开仓依赖它。云要用开源协议，通过发布出来的包或锁文件引用，方向永远是 云 → 开源。

### 3.2 yonder-harness 目标目录树

```
yonder-harness/
├─ packages/
│  ├─ sdk/  core/  cli/  pi-durable/            # 现有
│  ├─ execution-protocol/  executor/            # 现有
│  ├─ gateway/            # 新 P0：HTTP+WS 网关、鉴权、协议类型子路径 @yonder/gateway/protocol
│  ├─ design/             # 新 P1：@yonder/design 令牌 CSS、brand mark、icons
│  ├─ cloud-protocol/     # 新 P3：Card 设备协议 schema、relay 外层、contract.lock
│  ├─ relay/              # 新 P3：自建 relay 参考实现（无账号，凭配对白名单）
│  └─ macos/  macos-helper/                     # 现有，P1 起订阅网关
├─ apps/
│  └─ web/                # 新 P0：React 前端，构建产物由网关托管
├─ plugins/               # 现有 23 个；ui-companion 瘦身，tasks 去 HTTP
├─ distribution/
│  └─ bundles/{core,default,full}.json          # 新 P1：插件清单模板
├─ brand/                 # 现有；yonder-mark.js 迁入 packages/design 后此处只留资产
├─ docs/  proposals/  scripts/  tests/
```

克制说明：`packages/macos` 和 `macos-helper` 不改名、不搬到 `apps/`（搬迁会改动 `scripts/build-macos.mjs` 和 spec 引用，没有当前缺口）。`apps/` 只放有独立前端构建的可部署物，目前仅 `web`。

### 3.3 要处理的存量

| 对象 | 事实 | 建议 |
|---|---|---|
| `zoran-xc/yonder-harness`（私有旧镜像，本地 remote 名 `archive`） | `archive/main` 顶点 `f3d384a`，比公开仓落后 7 天（A5 §1.3） | 在 GitHub 上 archive（只读，可逆），本地 `git remote remove archive` 前先确认没有独有分支（本地有 `archive/private-main` 等，A5 §6.2，需先核对）。**不删除**。需主人批准（Q9） |
| `AI-Being`、`being`、`being-net`、`yonder-being`、`being-releases` | 五仓均未 archive（A5 §6.4）。本地 bundle 已存于 `~/Documents/_being-archive/bundles/`。`being-releases` 是公开空仓 | 逐个 archive，先确认 `_being-archive` 的 bundle 能 `git bundle verify`。公开空仓 `being-releases` 同样 archive，防止被误认为现行发布源 |
| 对废弃仓的引用 | Card `server/PLAN.md:8`、`DESIGN.md:9` 指向已删路径；harness 内多为迁移来源说明（`plugins/wechat-archive/README.md:3` 等）；`HANDOFF.md:25-34` 指向 `~/.ai-being/` | 迁移来源说明保留（是许可和来源记录）。Card 侧的死路径改写为「已 archive，见 GitHub」。运行时目录 `~/.ai-being/` 不动，用户数据由主人决定 |
| `yonder-web` / `yonder-card-web` / `yonder-card-server` / `Yonder Web` | 四个名字并存（A5 §3.1） | 统一：仓库 `yonder-card`，包名 `@yonder-card/web` 和 `@yonder-card/server`，README 标题 `Yonder Card`。GitHub 改名会保留旧地址重定向。本地目录随后改名。不改线上域名 `yonder.zethai.cn`（属 Zeth-AI 组织的基础设施，未核实归属关系，不在本次范围）。Q8 |
| Card 的 5 个 worktree、`zoran/live-dev` ahead 44 / behind 2 | relay 实现只在 worktree（A5 §4.3） | 与本方案独立，但 P3 之前必须合入主树，见 §5 第 8 条 |
| `yonder-hermes-extensions` | 无 remote、无 LICENSE | 不属矩阵核心。Q13 决定与 `plugins/hermes-experience` 的归属 |

### 3.4 为什么暂不建发行仓

主人方向里的三层是「开源核心 / 产品发行 / 闭源云」。分层是对的，但目前发行层只有两样东西：bundle 清单和 macOS 壳，它们都在主仓、都开源，没有独立的发布节奏或签名密钥。过早拆仓会引入第三套 CI、版本号对齐和跨仓 lock，对应的缺口还不存在。

触发条件（任一出现再建 `yonder-app`）：需要代码签名和公证的密钥管线；需要自动更新通道独立于内核发布；出现闭源的发行组件。在此之前，发行 = 主仓的 `distribution/` + 构建脚本，逻辑层存在，物理仓库不存在。

### 3.5 being-net vs yondermesh：判定办法

事实：`being-net` 实际只有 `apps/server` 加 `packages/protocol`，描述中的 web client 在仓内没有（A5 §3.2）。`yondermesh`（最后推送 2026-10-21，较新）描述为「Self-hosted Agent Context Bus」，本机无 checkout，内部未核实。

判定步骤（只读，需联网，Q10）：

1. 只读 clone `yondermesh`，列出：对外协议、监听端口、有无账号体系、数据模型。
2. 与需求对表。Net（传输）需要：ticket 鉴权、出站长连接、离线游标（spec 16 的 `agent_cursor`）、帧大小限制、不解析正文。
3. 判据：如果它的核心是「agent 互相看见和查询、交接任务」（上下文总线），那是建在传输之上的应用能力，不是传输层，不应占用「Net」这个名字。如果它已实现带 ticket 的 relay，则评估能否作为 Yonder Cloud relay 的实现，此时再决定独立成仓还是并入 `yonder-card`。
4. 在结论之前：Net 不作为独立仓。传输层先以「开源参考 relay（`packages/relay`）加 Card 内私有 relay 模块」两份实现、同一份 `@yonder/cloud-protocol` 契约的形式存在。`being-net` archive。

### 3.6 品牌与设计令牌单一源

事实：`brand/README.md:3` 声明 `src/yonder-mark.js` 是标志唯一来源，但 Card 另存了 SVG 和草案目录（A5 §5.2）。令牌权威在 Card `src/styles.css`（197 行，115 个 `--` 令牌），ui-companion 的 `style.css:1-2` 是手工复制（注明复制自 `1c5b692`）。

建议：令牌和品牌的唯一源放进开源仓的 `packages/design`（发布为 `@yonder/design`），含：

- `tokens.css`（CSS 变量，由 Card `styles.css` 现有令牌原样迁入，不重新设计）。
- `brand/`（`yonder-mark.js` 与导出的 SVG）。
- 图标集（lucide 子集，两边现在各用一份）。

Card 反向依赖该包，ui-companion 副本在 P1 删除。理由：令牌是品牌资产，没有机密，开源无损。它放在已声明为「唯一来源」的仓里，成本最低，方向符合「云依赖开源」。拒绝的备选：独立 `yonder-design` 仓。令牌加品牌加图标总量很小，单独成仓的版本对齐成本高于收益。

迁移顺序要注意：令牌的权威现在在 Card，所以第一步是把 `styles.css` 令牌**复制**进 `@yonder/design` 并让 Card 引用它，之后才能反过来说「harness 是源」。这需要改 Card 仓，是跨仓动作，Q6 一并批准。

### 3.7 公开 spec 依赖私有 Card 实现

事实：`docs/spec/16-card-plugin.md:3` 写「后端以 `yonder-card-web/server/src/...` 的真实实现为准」。`docs/spec/18-device-execution.md:101` 指向 Card 的协议锁。公开仓的规格因此依赖私有仓。

建议：

- 新增公开包 `@yonder/cloud-protocol`（P3），收录 spec 16 已写明的线协议：`/api/device/*` 请求响应、`/ws/device` 帧（`hello`、`message`、`send`、`sent`、`ack`、`error`）、relay 外层信封。schema 用 TypeBox，沿用 `execution-protocol` 的「`src/schema.ts` 单一源加导出 JSON schema 加 `contract.lock.json`」模式（`docs/spec/18` §6）。`execution-protocol` 已经导出 `relay-v1.json`，不重复。
- spec 16 改写为「协议在 `cloud-protocol`；Card 是其一个实现」。协议文字改为 harness 侧权威，Card 按锁文件对齐，与 spec 18 的做法一致（「Yonder 是唯一源」）。
- harness 侧的契约测试对着参考 relay 或回环契约服务器跑（spec 16 §5 已有回环契约服务器测试），不再需要私有仓才能验收。真实 Card 后端联调留在 Card 仓或集成作业里。

不提前做的事：不为「可能的第二个云厂商」抽象 provider 接口，当前只有 Card 一个实现。

---

## 4. 统一客户端架构

### 4.1 网关

**结论：** 在内核进程内新增一个 loopback 网关，用同一份 typed 方法注册表同时服务 HTTP/WS 与 `control.sock`。它替代 ui-companion 和 tasks 各自起的服务（不替代 channel-mcp、channel-cli、executor，它们不是人面向的表面）。

**现状事实：**

- `packages/core/src/control/index.ts` 是 248 行以内的传输层：Unix socket 加行 JSON，`ControlHandler = (request, connection) => Promise<unknown>`，`observeControl` 在同一连接上首响应后持续推送。
- 唯一 handler 在 `packages/cli/src/index.ts:724-841`，是 switch 分发，参数校验用 `requiredParam` 手写，没有 schema，没有读写分级。其中 `awake.status`、`service.info`、`stop`、`release.result` 依赖 cli 层的 `startAwake`/`releaseInfo`/`stop` 闭包（`index.ts:703-720`）。

**为何必须先下沉：** 浏览器不能直连 socket，网关需要同一批方法，但又要 schema 校验和 scope。如果让网关另写一份 switch，就会产生第二份方法表，等于在重复现有的重复问题。

**设计：**

1. 方法注册表（`packages/core/src/control/methods.ts`，新）：

```ts
interface MethodDef<P extends TSchema, R extends TSchema> {
  name: string;                       // 沿用现名：sessions.list、sessions.watch…
  params: P; result: R;               // TypeBox
  scope: "read" | "write" | "admin";  // 网关按 token scope 放行
  local?: true;                       // 仅本机 socket 与本机会话，不经远程（stop、release.result…）
  stream?: StreamDef;                 // watch 类：事件 schema
  handler(ctx: HostCtx, params: Static<P>, conn: ControlConnection): Promise<Static<R>>;
}
```

`HostCtx` 持有 `kernel` 和 cli 层注入的宿主服务（`awake`、`home`、`stop`），解决现在闭包依赖问题。`control.sock` 的 handler 变成 `registry.dispatch`，CLI 行为不变。
2. 前端类型：`@yonder/gateway/protocol` 子路径只导出 TypeBox schema 和 `Static<>` 类型（无 Node 依赖），`apps/web` 以 `import type` 加运行时 `Check` 使用。不需要代码生成器，这点比 DSH 的 typert（装饰器加生成）简单。机器可读的 JSON schema 导出沿用 `scripts/export-schema.mjs` 的模式，供非 TS 客户端使用。
3. HTTP：`POST /api/rpc/<method>`，body `{params}`，响应 `{ok:true,result}` 或 `{ok:false,error:{code,message}}`。方法名与 `control.sock` 完全相同，这就是「同一套方法表」的含义。
4. WS：`GET /api/stream`（升级）。**每个页面一条 WS，多路复用所有流**，帧：

```
client→server  {op:"sub", id, method, params, after?}   {op:"unsub", id}   {op:"ping"}
server→client  {op:"ready", id, result, gap?}  {op:"ev", id, seq, value}  {op:"end", id, error?}  {op:"pong"}
```

DSH 也用一条 WS 承载所有流（`REMOTE_STREAM_MUX_PATH='/api/remote.mux'`，A2 §3），这里借同一思路，帧自己定义。
5. 断线续传：`sessions.watch` 的 `after` 是不透明游标，由服务端用 `kernel.eventWatermark()`（`packages/core/src/status/index.ts:48` 用它判变）加转录 revision 编码。重连时服务端先把游标之后已落库的事件和转录条目回放，然后接实时流。回放不到的（游标过老或未持久的流式片段）在 `ready` 里带 `gap:true`，客户端改为调用 `sessions.show` 全量对账。**这与 spec 13 §1.3 不矛盾**：该条本来就声明「不保证补齐每个未持久流式片段」，游标只是把「靠客户端自己用 `events.query` 重放」标准化。游标与 `eventWatermark` 的精确映射，以及转录有没有可用的 revision，**未核实**，P0 第一件事是读 `kernel.terminal.observe` 与 `events.query` 的实现确认，不通过就退化为 `gap:true` 总是对账（仍可用，只是多一次 `show`）。
6. 网关位置：同进程，`yonder start` 里与 `serveControl` 并列启动（`packages/cli/src/index.ts:723` 附近）。拒绝的备选：独立代理进程，把 HTTP/WS 翻译成 `control.sock` 行 JSON。它的优点是 P0 不用动 core、崩溃隔离。不选它的理由：没有 schema 和 scope（要在代理里再补一遍），多一个需要发现、保活、鉴权的第 7 个自起服务；更关键的是远程鉴权（§4.2）需要方法级 scope，注册表无论如何要建。网关写成「传输适配器」，将来要拆进程只是换传输，不动方法表。风险：网关异常会拖累内核，网关内部必须隔离异常，并有总开关（Q15）。
7. 活动汇总只留一个口径：`activity.summary` / `activity.watch` 以 `kernel.terminal.activity()` 为准（`index.ts:759-770` 的 `service.info` 已用它，`status.json` 同源）。tasks 的 `?view=activity`（blocked/review/waitingUser 明细）作为 `views` 贡献的数据展示，不再另算一份汇总。

**P0 暴露的方法（只读加提交）：** `sessions.list`、`sessions.show`、`sessions.watch`、`sessions.submit`、`sessions.abort`、`terminal.info`、`terminal.presets`、`service.info`。其余按阶段放开。`stop`、`release.result`、`sessions.notify`、`identity.*`、`management`（写）不经网关，直到 P2。

### 4.2 鉴权与安全

**本机（P0）：**

- 只绑 `127.0.0.1`（不绑 `0.0.0.0`），不提供非 loopback 绑定选项。
- 启动时生成 256 位随机 `launch token`，只写入 `<home>/.yonder/gateway.json`（0600，含端口、pid）。启动 URL：`http://127.0.0.1:<port>/?token=<launch token>`，由 `yonder ui` 命令打印或打开。
- 首次访问用 token 换 cookie：`Set-Cookie: yonder-session=<HMAC 签名值>; HttpOnly; SameSite=Strict; Path=/`（不设 `Secure`，因为本机是 http；远程走 TLS 时必须带 `Secure`）。换取后 token 立即作废（一次性），比 DSH 的 24h 可重复 `?token=` 更严（A2 §3：HMAC 签名 cookie 加 `?token=`，24 小时）。cookie 有效期 24h，服务重启后用新的 HMAC 密钥自然失效。
- 每个请求（含 WS 升级）检查：`Host` 必须在 `{127.0.0.1:<port>, localhost:<port>}`；有 `Origin` 时必须与 Host 同源；`Sec-Fetch-Site` 为 `same-origin` 或 `none`；写方法只接受 `Content-Type: application/json`。借鉴 DSH 的 `api-request-trust` 思路（防 DNS rebinding 和 CSRF）和 ui-companion 现有的 Host/Origin 校验（`service.ts:178-183`），不是新发明。
- 响应头：`Cache-Control: no-store`、`X-Content-Type-Options: nosniff`、`Referrer-Policy: no-referrer`（沿用 `service.ts:164` 附近），加严格 CSP：`default-src 'self'; script-src 'self'; connect-src 'self'`，不允许内联脚本。注意这与 ui-companion 现在「build.mjs 把脚本内联成单页」不同，`apps/web` 用 Vite 产出带哈希的外链资源。
- 桌面壳不走 URL token：Swift 壳直接读 `gateway.json`（0600，同用户），用 token 在 WKWebView 里换 cookie。这替代现在读 `desktop.json`（含 secret 路径）。
- 端口：固定端口加 `gateway.json` 持久化（Q15）。理由：cookie 和 `localStorage` 按源（含端口）隔离，随机端口会让每次重启丢失 UI 状态。冲突时递增并写回。

**对「写操作经网页无审批边界」的处理：** 网关不增加审批层。写方法等价于本机用户在 CLI 敲命令，`sessions.submit` 就是 `session.input` 事件，走绑定和权限，遵守不变量 2 和 5。scope 只管「谁能调这个方法」，不管「这次调用要不要再确认」。

**远程（P3，经 Net）：**

- 远程界面客户端是一个配对主体，沿用 spec 18 §2 的配对流程：Ed25519 公钥交换，核对 TLS 指纹，两端各自持久保存。**不依赖 Card 账号**。控制请求用同类签名封套（`principalId`、`requestId`、`issuedAt/expiresAt`）。这是借用封套结构，协议命名空间另起（`yonder.control` v1，放 `cloud-protocol`），因为 `execution` 协议的方法表是设备方法，不是会话方法。只在 P3 才产生这个新协议，P0–P2 不做。
- 远程 token 的 scope 默认只含 `read` 和 `write` 的会话类方法，**不含** `admin`（`management` 写、`plugins add`、`stop`、凭据相关）。`local: true` 的方法永不远程。
- 加密：直连和自建 relay 档，TLS 加签名即可（运营者是用户自己）。**Yonder Cloud 档目前不满足**：relay 可解码 `payloadBase64`，spec 18 明说「不宣称 E2EE」。执行命令还好（签名防篡改，内容敏感度较低），但控制面承载会话转录、用户输入、凭据名，敏感度高得多。
- 分期：P3 先交付直连/LAN 和自建 relay；Yonder Cloud 档的远程控制面在 E2EE 之前不开放，只保留现有 Card 渠道聊天（它本来就是 Card 可见的社交消息）。E2EE 方案按 spec 18 的口径「另行选用成熟端到端加密通道并升级契约」，**不自造算法**，选型本文不做（Q11）。

### 4.3 前端技术选型

**结论：React 19 + Vite + TypeScript + Tailwind 4，`apps/web`，与 Card 同栈。**

理由：

- Card 前端是 React 19 / Vite 8 / Tailwind 4 / TanStack Query（A5 §3.1），令牌和组件习惯一致，设计系统可以共享而不是复制。
- ui-companion 的原生 JS 约 1,850 行，面板、历史、看板、提问都要重做成可组合视图，用无框架方式扩展代价更高。
- 状态管理沿用 Card 的 nanostores + TanStack Query？本文不强制。建议：服务端状态用 TanStack Query（会话列表、show），流式增量用一个小的 `useStream(method, params)` hook 合并进缓存，UI 本地状态用组件 state。不引入第二个状态库，除非 P1 实测不够。

**与 Card 共享什么：** 令牌、品牌、图标（`@yonder/design`，§3.6），可能还有 `Avatar`、`Button`、`Window` 等原语（Card `src/ui/` 有，**是否抽出未核实**，等 `@yonder/design` 稳定后再按需抽，不预先建 `@yonder/ui`）。聊天气泡和 Markdown 渲染两边需求不同（Card 是社交消息，这边有工具调用、流式、转录条目），P0–P2 各自实现。

**DSH（MIT）：借模式，不 vendor 代码。** 借的是：

- 一条 WS 多路复用流（§4.1）。
- Cookie 加 Host/Origin/Fetch-Metadata 防线（§4.2）。
- 无路由的槽位面板组织（§4.4、§4.6）。

不 vendor 的理由：

- DSH 的 `packages/client/connection` 约 15k 行，且与 typert（装饰器 RPC）、cordis（自维护 fork）耦合（A2 §6 提醒需「一并带走或替换」）。
- 我们的方法表已有 TypeBox，不需要 typert。
- 槽位注册表的核心很小（A2 称 ui-slots 为「零运行时依赖的合并类型核心」，行数**未核实**），自写一个 `ViewRegistry` 的成本低于引入并维护他们的 SlotMap 声明合并机制。
- MIT 允许复制，但一旦复制就要维护 `THIRD_PARTY_NOTICES.md` 和同步上游，当前没有收益。若后续决定逐文件借用，须在 `THIRD_PARTY_NOTICES.md` 登记并保留版权声明。

### 4.4 信息架构

一页里组织：常驻 bot、临时 session、任务看板、审批/提问卡、渠道、设备、设置。借 DSH 的「侧栏 | 对话 | 右栏」三栏（A2 §4），无 URL 路由，用面板 id 加 hash（`#/s/<id>`）定位，便于悬浮窗复用同一页。

```
┌────────────────────────────────────────────────────────────────────────────────┐
│ ◉ Yonder   [本机 ▾]  ·  3 个在跑 · 1 个等你                       🔍  ⚙  👤Card │
├───────────────┬──────────────────────────────────────────┬─────────────────────┤
│ 常驻          │ 管家 · main                      ● 运行中 │ ▸ 等你回答 (1)      │
│  ◉ 管家  ●    │ ─────────────────────────────────────── │  ┌───────────────┐ │
│  ◉ 研究员     │ 你  帮我整理本周的待办                    │  │ 要用哪个邮箱？│ │
│ 任务（临时）  │ 管家 好的，我先看一下任务账本…            │  │ (•) a   ( ) b │ │
│  ▣ 写周报 ●   │   ⟡ tasks_show  ✓                         │  │ [ 回答 ]      │ │
│  ▣ 查资料     │   ⟡ web_search  …                         │  └───────────────┘ │
│  ＋ 新任务 ▾  │                                          │ ▸ 任务看板          │
│ ─────────     │                                          │  阻塞 1 复核 0 等待 2│
│ 渠道   ○ 2    │                                          │  · 写周报  进行中   │
│ 设备   ○ 1    │ ┌──────────────────────────────────────┐ │  · 整理账单 阻塞    │
│ 设置          │ │ 输入…      [忙时: 追加▾]  [发送] [停止]│ │ ▸ 活动 / 定时       │
│               │ └──────────────────────────────────────┘ │                     │
└───────────────┴──────────────────────────────────────────┴─────────────────────┘
```

区域与数据来源：

| 区域 | 内容 | 方法 / 来源 |
|---|---|---|
| 左栏「常驻」 | 常驻 agent 会话 | `sessions.list`，按 main/persistent 分组（内核同构，A1 §5） |
| 左栏「任务」 | 临时 task 会话，「新任务」选预设 | `sessions.list`、`terminal.presets`、`sessions.open` |
| 中栏 | 会话转录加输入框，busy 模式（followup/steer/interrupt），中止 | `sessions.show`、`sessions.watch`、`sessions.submit`、`sessions.abort` |
| 右栏「等你回答」 | ui-companion 的 present 卡（提问、选择） | `views` 贡献（§4.6）加 `answer` 动作 |
| 右栏「任务看板」「活动」 | tasks 看板、活动汇总 | `views` 贡献加 `activity.watch` |
| 左下「渠道」 | 渠道实例状态，登录（二维码或设备码链接） | `channels.list`、`channels.login`（P2） |
| 左下「设备」 | 本机执行节点和已配对设备 | P3，设备 UUID 与 Card 设备是两套命名空间，UI 层只给一个列表并标注来源 |
| 设置 | agents、预设、skills、插件、模型 | `management`（P2） |

顶部「[本机 ▾]」是节点切换，用于 P3 连接远端完整节点；P0–P2 只有「本机」。

右栏顶部的「等你回答」置顶并带计数，状态栏和悬浮窗显示的也是这同一个计数。这是 R2 的体现：同一状态多表面共享，来源只有一个。

### 4.5 表面统一

**结论：** 所有表面是同一 `apps/web` 的不同路由或不同壳，数据全部来自网关。

| 表面 | 形态 | 数据来源（改后） | 现在 |
|---|---|---|---|
| 网页 | 浏览器打开 `/` | 网关 | ui-companion 单页（原生 JS）、tasks 只读页 |
| 桌面主窗 | 壳里加载 `/` | 网关 | 无 |
| 悬浮窗 | NSPanel+WKWebView 加载 `/#/companion`（紧凑布局：浮球、提问卡、进度） | 网关 | 加载 ui-companion 页面（`Companion.swift:414-421` 校验 loopback） |
| 状态栏 | 原生 NSStatusItem 菜单 | `activity.watch` WS（`URLSessionWebSocketTask`） | 每 2 秒读 `status.json`/`desktop.json`（`YonderStatus.swift:53,57,106`） |

状态栏和悬浮窗从读文件改为订阅网关，消除「文件、socket、WS 三种状态传递」中的文件那一种。过渡：服务端在兼容窗口内继续写 `status.json` 和 `desktop.json`，Swift 壳优先用 `gateway.json`，缺失才回退读旧文件（Q14）。这也是 P0 的回滚路径。

**桌面壳选型比较：**

| 项 | Swift + WKWebView 薄壳（现状延伸） | Electron | Tauri 2 |
|---|---|---|---|
| 现有资产 | 直接复用 `YonderStatus`/`Companion`/`PowerHelper`，NSPanel 非激活浮窗已实现 | 全部重写；DSH 有托盘和单实例等可参考，但其桌面无悬浮窗（A2 §2 明确未发现） | 全部重写 |
| 包体 | 最小（系统 WKWebView） | 大（自带 Chromium，数十到上百 MB，数字未核实） | 小（系统 WebView），需 Rust 工具链 |
| 跨平台 | 仅 macOS | mac/Win/Linux 一致 | mac/Win/Linux，各平台 WebView 版本不同（行为差异**未核实**） |
| 悬浮窗/非激活窗 | 已有，原生 | 可做，需自己处理各平台 | 能力**未核实** |
| 完整节点打包 | 壳与 Node 节点分开发行，现状如此 | 常见做法是 Electron 内嵌 Node | 需 sidecar 带 Node |
| C 端安装 | 已有 macOS 安装路径（spec 09） | 成熟的自动更新（electron-updater） | 内置 updater |
| 风险 | 无跨平台 | 体积、安全面大 | 团队需新增 Rust 技能 |

**推荐：** 现在不换壳。macOS 继续 Swift 薄壳，工作量只在「数据源改为网关」。理由：现有资产直接可用，悬浮窗的非激活特性是原生才好做的，且 spec 09 明确桌面 Helper 和状态栏仍限 macOS（`docs/architecture.md` §6 末段）。Windows/Linux 的 C 端壳等到真有这些平台的 C 端计划时（P4）再选。届时倾向 Tauri：壳只加载 loopback URL 并承载托盘，不需要 Electron 的 Node 集成能力，体积和攻击面更小。但这是倾向不是结论，需要在目标平台上实测托盘、WebView 版本和 sidecar 打包后再决定（Q5）。不选 Electron 的主要理由：本方案的壳逻辑极薄，不值得带一整个 Chromium。

在没有壳的平台，用户仍然可以用浏览器访问网关，P0 起这条路径就是可用的。

### 4.6 插件 UI 贡献槽

**缺口：** 9 个槽里没有 UI/HTTP 槽，是 6 处自起服务的根因（A4 §1：「UI/HTTP 都是插件自己实现的自定义 trigger 加服务，不是内核契约能力」）。`docs/decisions.md:189` 记录 ui-companion 明确选择「不改内核或增加 UI 槽」，这个决定需要被取代。

**设计：新增第 10 个槽 `views`，声明式。**

清单（`package.json` 的 `yonder.contributes`）：

```json
"contributes": { "views": ["interactions", "board"] }
```

SDK 类型（草案）：

```ts
interface ViewContribution {
  id: string;                                  // 插件内唯一，全局键为 `${pluginId}.${id}`
  title: string;
  placement: "rail" | "main" | "companion";    // 右栏 / 主区 / 悬浮窗
  badge?(ctx: ViewContext): number | undefined | Promise<...>;   // 例：等你回答 (1)
  render(ctx: ViewContext): ViewDocument | Promise<ViewDocument>;
  act?(action: ViewAction, ctx: ViewContext): Promise<void>;     // 用户在卡片上的操作回传
}
// ViewDocument：有限种类的声明式节点
type ViewNode =
  | { t: "text"; text: string } | { t: "markdown"; md: string }
  | { t: "list"; items: ViewNode[] } | { t: "board"; columns: {title:string; items: ViewNode[]}[] }
  | { t: "progress"; value: number } | { t: "image"; ref: AttachmentRef }
  | { t: "choice"; id: string; options: string[] } | { t: "input"; id: string; label: string }
  | { t: "button"; action: string; label: string };
```

要点：

- 插件返回的是数据，前端用自己的组件渲染。渲染器、样式和令牌都是产品层的。插件无法注入 DOM 或脚本，C 端稳定性和安全性由此保证。
- 变更通知：`ctx.invalidate()` 触发网关向订阅者推送 `views.watch` 的新 revision，前端据此重新取。revision 机制同会话观察的游标。
- `act` 的入口是网关方法 `views.act`（scope: write），参数经 `ViewAction` schema 校验。例如提问卡的回答 = 现在的 `POST answer`（`service.ts:208-217` 附近，校验 `{id, answer, step}`）。
- 不变量：槽只提供能力，**agent 是否能使用**与 views 无关；views 仅给人看。不属于工具，因此不进模型。

**声明式数据卡片 vs 插件自带 JS 包：**

| 维度 | 数据卡片（建议） | 自带 JS 包 |
|---|---|---|
| 安全 | 无代码执行面。XSS 面限于 Markdown 渲染（需消毒） | 插件代码进入已认证的页面，等同拥有 cookie 的会话。要 iframe 沙箱加 postMessage 才安全 |
| C 端稳定 | 前端升级不会被插件拖坏 | 插件与前端版本耦合，崩溃面大 |
| 设计一致 | 自动一致 | 靠插件自觉 |
| 表达力 | 有限，复杂可视化不行 | 无限 |
| 与现有约束 | 与「插件代码不热重载」（不变量 9）一致，不新增运行时加载机制 | 引入前端侧的插件加载，需要新的构建和信任模型 |

结论：P0–P3 只做声明式。需要复杂可视化的开发者场景，可在 P4 以后作为「实验、默认关闭」的 `iframe sandbox`（opaque origin，通过 postMessage 调用受限 API）单独提议，不在本方案范围，不为它预留抽象（Q2）。现有两个页面的表达需求（提问卡、看板、历史列表）都落在上面这组节点里：看板数据现在就是 JSON（`tasks service ?view=panel`），提问卡是文本加选择加输入。

**迁移：**

- ui-companion：`interactions.json` 的存储、`present/result` 工具保留；把「当前待答、历史步骤」做成 `views` 贡献 `interactions`（placement `rail` 加 `companion`），回答走 `views.act`。删除 `service.ts`、`web/`、`desktop.json`/`renderer.json` 写入、`build.mjs`（根 `build` 脚本里的 `plugins/ui-companion/build.mjs` 一并摘除）。
- tasks：`service.ts` 删除；账本（`Store`）直接在插件进程内，`render` 取现有 `?view=panel` 的同一份数据；活动汇总明细作为同一 view 的 `badge`。`board.ts`（文本/SVG/PNG）保留。
- 冲突处理沿用 `claim(slot,name,pluginId)`（`packages/core/src/plugins/index.ts:131`），加载时声明与注册比对沿用（`:150-157`）。

### 4.7 与 Card 网页的关系

**结论：不合并成一个前端，也不做第三套。** 两者是不同的产品面：

| | Card web | 统一客户端（`apps/web`） |
|---|---|---|
| 角色 | 云端社交客户端：名片、联系人、聊天、设备授权确认 | 节点控制台：我的 agent、会话、任务、渠道、设备、设置 |
| 在哪 | `https://yonder.zethai.cn`，面向公网 | `http://127.0.0.1:<port>`，只绑本机 |
| 鉴权 | Card 账号会话 | 启动 token 换 cookie，远程时配对签名 |
| 数据 | Card 后端 `/api` | 节点网关 `/api/rpc` |
| 代码 | Card 仓，闭源 | 主仓，开源 |

不合并的理由：鉴权、部署、开源边界都不同。把控制台塞进公网站点会让云持有本机控制入口，违背「云依赖开源，核心不依赖云」，也无法满足无云直连档。

共享的部分：`@yonder/design`（令牌、品牌、图标）、可能的少量原语（Q6）。关系的接缝：

- 控制台的「渠道」或「Card」条目由 `channel-card` 的 view 贡献：显示连接状态、登录链接（`login('start')` 返回的 `qrcodeUrl` 复用为网页确认 URL，spec 16 §1）、已同步的 agent 数。点击在系统浏览器里打开 Card web，不内嵌。
- Card 的「连接设备」页（`Connect.tsx`）依然是设备授权的网页确认端，流程不变。
- 长期是否合成一个「Yonder 应用」（控制台里直接有社交界面），是产品决策，不在本方案。如果主人要，前提是 Card 的聊天组件（`ChatDetail` 等）抽成与数据源无关的共享包。这个前提现在不满足：Card 数据源默认是 mock（`src/api/index.ts:5` 的 `VITE_API === 'http' ? httpApi : mockApi`）。

附带：Card 默认 mock 与 harness 的「不写假数据」规则（`AGENTS.md` 第 4 条、不变量 10）方向不一致。这是 Card 仓自己的问题，本方案只提醒，不处理。

---

## 5. 架构审计

按对本目标的影响排序，共 12 条。不扩大到无关重构。

**1. 控制面 handler 在 cli 包**
- 事实：唯一 handler 是 `packages/cli/src/index.ts:724-841` 的 switch，参数校验靠手写 `requiredParam`，宿主依赖是 `startAwake`/`releaseInfo`/`stop` 的闭包。
- 影响：网关无法复用，会被迫另写第二份方法表。没有 schema，前端无类型，没有读写分级。
- 建议：下沉为 core 的 TypeBox 注册表，宿主服务通过 `HostCtx` 注入（§4.1）。
- 时机：随统一客户端一起做，是 P0 第一步，先做纯重构并用现有 CLI 测试（`packages/cli` 约 6 个测试文件，A4 §5d）保证 `control.sock` 行为不变。

**2. 6 处自起 loopback 服务**
- 事实：channel-cli、channel-mcp、tasks/`service.ts`、ui-companion/`service.ts`、executor、core/control（A4 §5a）。其中人面向的只有 ui-companion 和 tasks，两者鉴权不同（secret 路径与 token 路径，A1 §3）。
- 影响：端口发现、鉴权、`desktop.json` 约定各自一套，攻击面分散。
- 建议：人面向的两处并入网关，后者退役。其余四处不是人面向表面，不动。
- 时机：随统一客户端做（P1）。

**3. 三套 agent 活动汇总**
- 事实：`service.info`（`index.ts:759-770` 的 `terminal.activity()`）、`status.json`（同函数，`status-surface.ts:14-20`）、tasks `?view=activity`（`service.ts:54-83` 从账本另算），Swift 侧 `Companion.swift:33-92` 还有一份解析。
- 影响：bot 阻塞态和任务面板数字可能不一致。
- 建议：以 `terminal.activity()` 为唯一口径，暴露为 `activity.summary/watch`，tasks 明细转成 view 数据。
- 时机：P0 定义方法，P1 切换各表面。

**4. 控制面无鉴权，网关要新增鉴权模型**
- 事实：`control.sock` 靠文件权限，Windows 多用户隔离未验收（`docs/spec/09` 95-96，据 A1 §2.2）。
- 影响：不能把 socket 的信任模型直接搬到 HTTP。
- 建议：网关独立鉴权（§4.2），socket 保持不变。
- 时机：随 P0。

**5. 观察流断线无游标**
- 事实：`sessions.watch` 断开即丢流式片段，靠 `sessions.show`/`events.query` 重放（spec 13 §1.3，A1 §5）。
- 影响：网页挂机后恢复需要自行对账，各表面会各写一套。
- 建议：服务端提供 `after` 游标和 `gap` 标志（§4.1）。
- 时机：P0 做最小版，P1 完善。

**6. 文档漂移与 spec 编号冲突**
- 事实：spec 15 有两个文件（`15-memory.md` 与 `15-clipboard-vault.md`）；spec 04 §3 首句「共九个」与正文 8 个加文末 permissions 不一致；`docs/plugins.md` 的工具清单与 `contributes` 有差异（A4 §2 注）。
- 影响：新增 `views` 槽时槽数口径会再错一次。
- 建议：新增槽时顺带把 spec 04 的槽数改成与列表一致；编号冲突与 plugins.md 对齐另立清理任务，本方案新 spec 用 19 号避开冲突。
- 时机：槽数随 `views` 一起改。编号冲突和 plugins.md 漂移另立。

**7. 提案无状态**
- 事实：12 个提案均无采纳标记，`task-ledger/design.md` 自述「待批准」但 D66 已采纳（A4 §4）。
- 影响：读者分不清哪个是现行。
- 建议：提案头部加状态字段（草案/已采纳/被取代，引用 decisions 条目）。本提案按此格式发布。
- 时机：另立。

**8. Card relay 未合主树，公开 spec 依赖私有实现**
- 事实：relay 只在 worktree（`yonder-card-multidevice-w0/server/src/execution-relay.ts`，113 行）；主树 `server/src/` 无 `execution-relay.ts`，且 `zoran/live-dev` 比 `origin/main` ahead 44（A5 §2, §4.3）。spec 16/18 指向私有实现。
- 影响：P3 的 Cloud 档和自建 relay 都建在它之上。
- 建议：先合 relay 到 Card 主树，再抽 `cloud-protocol`（§3.7）。
- 时机：另立，P3 之前完成。

**9. 设备身份两套命名空间**
- 事实：Card 设备 UUID 与执行设备 ID 是两套（`execution-relay.ts:88` 注释明说；`plugins/devices/README.md:12`）。
- 影响：UI 的「设备」页如果直接合并会把两种东西混为一谈。
- 建议：保持两套，这是设计意图（执行主体不是 Card 账号，spec 18 §1）。UI 只做展示层映射并标注来源，不合并身份。
- 时机：P3 UI 时处理。

**10. 根 build 链**
- 事实：`build` 串 5 步，含 devices 专用构建、Swift 构建、ui-companion 内联构建（`package.json` scripts）。
- 影响：加 `apps/web` 会变成第 6 步，ui-companion 步骤退役时需要摘除。
- 建议：拆为 `build:ts`、`build:web`、`build:macos`（仅 darwin），`build` 组合它们。不重写脚本，只拆分入口。
- 时机：随 P0/P1。

**11. runtime 上帝对象**
- 事实：`packages/core/src/runtime/index.ts` 1,899 行，登记在 `scripts/file-size-baseline.json`，注明「待拆分」。
- 影响：对本方案无阻塞，网关只依赖 kernel 门面，不碰 runtime。
- 建议：不在本方案内拆。
- 时机：另立。

**12. 品牌与令牌复制**
- 事实：`plugins/ui-companion/web/style.css:1-2` 手工复制自 Card，品牌在 Card 另存一套（A5 §5.2）。
- 影响：改一处漏一处。
- 建议：`@yonder/design`（§3.6）。
- 时机：P1（随 ui-companion web 退役）。

---

## 6. 需修改的规格与决定

以下均需维护者批准。建议文本只给要点，批准后再改 `docs/`，并在 `docs/decisions.md` 记新条目、删除被取代的内容。

| 条款 | 现状 | 建议新文本要点 |
|---|---|---|
| spec 13 §2 首段 | 「它们是同一 CLI 管理面，不另做 Web 控制台、配置数据库或新的插件槽」 | 管理命令仍是 CLI 管理面，不增加配置数据库。人用的 Web/桌面客户端经网关调用同一份方法表，不新增方法表之外的能力，不引入第二套审批。「不新增插件槽」改为「新增槽须经设计变更」，并列出 `views`。 |
| spec 13 §1.3 | 观察流断线靠 `show`/`events.query` 恢复，不保证补齐片段 | 增加可选 `after` 游标和 `gap` 标志的语义。仍不保证补齐未持久片段。 |
| spec 04 §3 | 「共九个」，permissions 在文末 | 增加第 10 个槽 `views`，类型见 §4.6。顺带把槽数口径改成与列表一致。清单 `contributes` 增加 `views`。`apiVersion` 是否递增：新增是向后兼容的，建议保持 1（附注：旧内核加载声明了 `views` 的插件的行为**未核实**，需看 `checkRegistrations` 对未知槽的处理）。 |
| 新增 spec 19 | 无 | 「客户端网关」：方法注册表和 scope、HTTP/WS 帧、鉴权（§4.2）、`gateway.json`、游标语义、本机与远程的差别。用 19 号避开 15 号冲突。 |
| spec 08 | `yonder.yaml` 配置 | 新增 `gateway: {enabled, port}`，默认值待 Q15。 |
| spec 09 | 控制端点说明 | 注明 `control.sock` 保留，另增网关入口与 `gateway.json`。 |
| spec 16 | 「后端以 Card 真实实现为准」 | 协议移至 `@yonder/cloud-protocol`，Card 为其实现之一（§3.7）。 |
| spec 18 §6 | Card W3 复制 relay schema | 增加 relay 外层和设备协议由 `cloud-protocol` 统一导出。E2EE 之前 Cloud 档不用于控制面（Q11）。 |
| `docs/architecture.md` §3 | 谁负责什么表缺客户端层 | 新增「网关与客户端」行：负责浏览器可用传输、鉴权、观察游标。不负责业务逻辑。 |
| `docs/architecture.md` §1 | 「除这条主线以外的一切能力……都由插件提供」 | 补一句：面向人的表面（网关、前端、状态栏）属于产品层，不是插件。这是 R2 的依据，是对「过度追求只留内核」的修正，需主人明确认可。 |
| `docs/decisions.md:189,195` | ui-companion「不改内核或增加 UI 槽」「采用插件自有回环服务」 | 新条目取代，记录 `views` 槽和网关，删除过时内容而不是追加（`AGENTS.md` 第 7 条）。 |
| `AGENTS.md` 第 5 条 | 基础 TUI 以 pi v1.3.0 原生界面为唯一基准 | 不冲突：该条约束的是 TUI 和 pi 包的 import 边界。`apps/web` 是另一类客户端，不使用 pi 包。建议在 spec 19 里写明「前端不 import pi 包」，网关同样不 import pi（core 的 runtime 目录仍是唯一出口）。 |

**架构不变量（§5）逐条核对：**

| # | 内容 | 是否受影响 |
|---|---|---|
| 1 | 事件只追加 | 否。网关只调现有方法 |
| 2 | agent 只经绑定唤醒 | 否。`sessions.submit` 即 `session.input` 事件，预设会话本来就显式唤醒 |
| 3 | 插件装上不等于生效 | 否。views 不进模型，bundle 只决定加载 |
| 4 | 会话状态只归 pi-durable | 否。游标用事件水位，不复制转录 |
| 5 | 安全只有一层：能力加级别 | **需注意**。网关 scope 是访问控制，不是第二套工具审批。UI 上的「等你回答」是已有的 `ui-companion_present` 工具的渲染，不新增审批机制。未来审批仍按「写成钩子插件」 |
| 6, 7 | 完成定义、耗时可观察 | 否 |
| 8 | 工作区经执行环境 | 否 |
| 9 | 配置可热重载，代码不热重载 | 否。views 是插件代码，不热重载。前端静态资源随发行更新 |
| 10 | 不写假数据 | 本方案遵守。Card 默认 mock 属另一仓 |

结论：不变量无需修改，但第 5 条需在 spec 19 里明确「网关 scope 不是审批」，防止后续有人往里加确认弹窗。

---

## 7. 迁移路线

通用约定：所有验收用真实运行，不 mock。需要模型的步骤用 `openai/gpt-6-luna`，缺凭据则该步骤标「未测」并写明。浏览器验证用 `web-verify-local-chrome`（本机 Chrome 无头加 CDP）。

### P0：最小切片（网关加只读会话加提交的单页）

范围：

- 方法注册表下沉（仅 §4.1 列出的 8 个方法先迁，其余仍走 cli switch 的 fallback，两者并存一个版本）。
- `packages/gateway`：HTTP `/api/rpc/*`、WS `/api/stream`、鉴权（§4.2 本机部分）、托管 `apps/web` 静态资源、`gateway.json`。
- `apps/web`：一个页面——左侧会话列表（常驻加任务分组）、中间转录加输入框加中止、顶部显示活动计数。
- `yonder ui` 命令：打印（macOS 上可选打开）带 token 的 URL。
- `Companion.swift`：若存在 `gateway.json`，悬浮窗加载 `/#/companion`（P0 版本等同主页面的紧凑样式，无需专用布局），否则回退原行为。
- 根 build 拆出 `build:web`。

不做：提问卡、看板、渠道、设置、状态栏改造、`views` 槽、远程。

交付物：`packages/core/src/control/methods.ts`、`packages/gateway/`、`apps/web/`、`gateway.json`、spec 19 初稿、测试。

验收（真实运行）：

1. `yonder start` 后，浏览器经 `yonder ui` 的 URL 打开，看到真实会话列表，与 `yonder sessions list --json` 内容一致（对拍测试：同一 home，同一时刻，socket 和网关两路结果深度相等）。
2. 对一个正在运行的会话：页面实时看到流式更新，手动断开 WS 再恢复，页面不重复不丢失已落库内容（含 `gap` 路径各测一次）。
3. 通过页面提交输入，会话收到并产生 `session.input` 事件（`events.query` 可见）。需要模型的部分用 `gpt-6-luna`，缺凭据标「未测」。
4. 安全负面用例，全部真实请求：错误 `Host`（如 `evil.example`）→ 403；跨源 `Origin` → 403；无 cookie 访问 `/api/*` → 401；token 第二次使用 → 失败；WS 无 cookie 升级 → 拒绝；响应带 CSP 与 `nosniff`；服务绑定地址仅 `127.0.0.1`（`lsof` 核对）。
5. 悬浮窗：macOS 上真机运行，截图确认加载的是网关页面；删除 `gateway.json` 后回退到 ui-companion 页面。
6. `yonder chat`、TUI、`yonder sessions ...` 全部回归（现有测试加手动一轮）。
7. `yonder start --no-gateway` 后不监听任何 HTTP 端口，`control.sock` 照常。

可回滚：`gateway.enabled: false` 或 `--no-gateway`；`control.sock` 路径全程不变；`Companion.swift` 的回退分支。注册表迁移是纯重构，回滚即还原 cli switch。

对现有用户的影响：默认多监听一个 loopback 端口（Q15 决定默认开关）。CLI、TUI、渠道、插件无变化。

### P1：统一单页，退役零散表面

范围：

- 完整主页面（§4.4）：开任务、关闭、中止、活动汇总（`activity.*`）。
- `views` 槽（SDK、加载器、`views.watch`/`views.act`）及渲染器。
- 迁移 ui-companion 交互卡、tasks 看板为 views。删除两处自起服务和 ui-companion 的 web 与 `build.mjs`。
- 状态栏改为订阅 `activity.watch`；悬浮窗改为专用 `/#/companion` 布局。
- `@yonder/design` 抽出，Card 引用（跨仓，Q6）。删除 `style.css` 副本。
- `distribution/bundles/`。
- spec 04/13/19、decisions、architecture 的文本改动落地。

交付物：上述包与迁移、`docs/` 变更、迁移后的 ui-companion/tasks 清单。

验收：

1. 让真实 agent 调用 `ui-companion_present`，主页面、悬浮窗、状态栏的「等你回答」计数一致；在任一表面回答，agent 的 `ui-companion_result` 收到真实回答；其他表面同步清除。
2. tasks 看板数据与账本（`tasks_show`）一致；活动汇总数字在三个表面一致（原来最容易分叉处）。
3. 停止 `status.json` 写入前，Swift 壳在新旧两种模式下都能显示。
4. `grep` 确认 `plugins/ui-companion` 与 `plugins/tasks` 不再 `createServer`。
5. 令牌变更：改 `@yonder/design` 一处，Card 与 `apps/web` 都跟随。
6. 安全回归同 P0，再加 `views.act` 的参数校验（超长、类型错误、跨插件冒充 view id）。
7. `init --bundle core` 加 `start --no-gateway` 仍可跑通 CLI 对话。

可回滚：`status.json`/`desktop.json` 兼容窗口内可回退到旧壳逻辑（Q14）；ui-companion 旧代码在窗口结束前保留在历史里，不立即物理删除也行，由主人决定。

用户影响：旧悬浮窗外观会变（同一设计令牌，布局重做）。已装用户升级后 `desktop.json` 不再生成（窗口期内仍生成）。

### P2：管理与渠道

范围：设置（agents/presets/skills/plugins/models，`management` 与 `inspect`），渠道列表与登录（`channels.login` 包成推送或长轮询），会话搜索，`events.query` 视图，scope 分级正式启用（`admin` 需本机）。

验收：用页面新增一个真实预设并开任务，`yonder presets` 同步可见；渠道登录用真实 card 设备码流程走通到 `connected`（对着开发用 Card 后端，spec 16 §5 的真实后端联调路径）；`admin` 方法在非本机 scope 下被拒。

回滚：管理写操作可在网关层按 scope 关闭；不影响 CLI。

用户影响：新增入口，旧 CLI 管理命令不变。

### P3：组网（直连、自建 relay、设备）

范围：`@yonder/cloud-protocol`；`packages/relay` 参考实现；远程界面客户端的配对和签名（`yonder.control` v1）；「设备」页；节点切换。Cloud 档远程控制面不开放（Q11）。前置：§5 第 8 条（Card relay 合主树）与 W1 配对完成。

验收：两台真实机器，LAN 直连配对后，从 B 的浏览器控制 A 的会话；经自建 relay 重复一次；relay 日志里能证明它只转发（不能证明其不可读，因为 TLS 之上没有 E2EE，要诚实记录）；远程 token 调 `management` 写被拒；重放旧请求被拒。

回滚：远程服务单独开关，默认关。

用户影响：默认无变化，需主动配对。

### P4：发行与跨平台

范围：Windows/Linux 壳选型实测（Tauri 倾向）；是否建 `yonder-app`（§3.4 触发条件）；安装器、签名、更新；E2EE 方案落地后评估 Cloud 档远程；是否把 Card 的社交界面并入（产品决策）。

验收和回滚在立项时再定，此处不细化，以免为假想需求设计。

---

## 8. 风险与开放问题

风险：

1. **P0 注册表重构是全局性改动**，影响所有 CLI 路径。缓解：先做纯重构，用现有测试和 socket 对拍，通过后才接网关；迁移期新旧并存。
2. **网关在内核进程内**，异常会影响内核。缓解：网关错误隔离、总开关；传输层可替换，需要时拆进程不动方法表。
3. **loopback 服务仍有被本机其他用户或浏览器页面攻击的面**。缓解：一次性 token、HttpOnly cookie、Host/Origin/Fetch-Metadata、严格 CSP。多用户机器的隔离**未验收**，和 `control.sock` 的 Windows 多用户问题同类，需在 spec 19 里如实写。
4. **声明式 views 表达力有限**，开发者可能不满。缓解：节点种类先少后多，P4 再评估沙箱 iframe，不预留抽象。
5. **令牌权威反转需要改 Card 仓**，且 Card `zoran/live-dev` 有 44 个未合并提交，容易冲突。缓解：先合 Card 主树再迁令牌。
6. **Swift 壳订阅 WS** 需要重写数据层。工作量**未估**，P1 开工时先做一次 spike。
7. **Cloud 档在 E2EE 前不开放远程控制**会使「手机远程控制电脑」的卖点延后。这是安全上有意的取舍，需主人接受（Q11）。
8. **DSH 借鉴**依赖我对其公开文档和 A2 报告的理解，没有跑过其代码。实际行数和行为以其源码为准（均为**未核实**项）。

未核实清单：

- `kernel.eventWatermark()` 到转录 revision 的游标映射（§4.1）。
- spec 04 对未知槽、`checkRegistrations` 的处理，决定 `apiVersion` 是否要升（§6）。
- Tauri 在各平台的托盘、非激活窗口、WebView 差异（§4.5）。
- `codex-tools`、`media-tools` 内容；Card `src/ui/` 原语是否可抽（§2.3、§4.3）。
- `plugins/hermes-experience` 与 `yonder-hermes-extensions/packages/hermes-experience` 的关系（Q13）。
- `yondermesh` 内部（Q10，本机无 checkout，需联网）。
- 本地 `archive` remote 上是否有主仓不存在的独有分支（§3.3）。

开放问题已并入摘要的 Q1–Q15，等主人逐项拍板。拍板前，本文不触发任何对仓库、远端或规格的修改。