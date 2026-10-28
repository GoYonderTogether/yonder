# Yonder 统一应用与分发架构：设计文档（第二版）

> 状态：提案，待维护者批准。本文件不改 `docs/spec/`、`docs/architecture.md`、`docs/decisions.md`、`AGENTS.md`；需改的条款见第 10 节。
> 日期：2026-10-27。输入优先级：[research/owner-requirements.md](research/owner-requirements.md) > Opus 决定 D1–D10 > 第一版 > `research/` B1/B2/A1/A2/A4/A5。
> 说明：本文取代已删除的第一版（`design-v1.md`，见 git 历史）；正文里的「第一版」指它。
> 约定：「事实」带路径。「建议」是本文的设计。「未核实」是没读到源码或没运行验证的内容。本版新核对：`plugins/hermes-experience` 与外部包的差异、`plugins/agent-presets/src/index.ts`、`packages/cli/src/index.ts:269,426-438,881`、`packages/cli/src/awake.ts:9-10,70-72`、`packages/core/src/runtime/quota-source.ts:156`、`scripts/` 目录。B1/B2 的数据直接引用，未重跑。

---

## 0. 一页摘要

**目标一句话：** 用户装一个叫 Yonder 的应用，只配模型就能用。应用里有一个会主动帮忙的「管家 Bot」和一个能在本机或远程执行任务的控制台。登录 Yonder 账号后才出现社交功能。除云端后端外全部开源。

**核心决定：**

1. 一个应用，一份前端：`apps/app`（`@yonder/app`），由 Card 前端与统一控制台合并而成。功能是否显示，由「能力清单」决定。清单是纯函数，输入是客户端事实（场景、登录）和节点事实（本机还是远程、方法表、插件、scope）。节点只下发事实，不下发「显示什么」（§1.3、§4.7）。
2. 两种模式共用一个数据面：Bot 模式（personal agent，对应 Card 名片与私信）和控制台模式（会话、任务、设备）。联动靠内核已有机制：绑定唤醒、插件提供能力、agent 选用。Bot 读工作 session 用只读工具，不绕过网关（§1.2）。
3. 闭源只有 `GoYonderTogether/yonder-cloud`（账号、Card 社交服务端、托管 relay）。主仓开源，含协议 `@yonder/protocol` 与参考 relay。依赖单向：云 → 开源（§2）。
4. 命名统一为 Yonder 家族，monorepo 多个 `@yonder/*` 包，CLI 二进制 `yonder`。仓库改名 `GoYonderTogether/yonder`。完整映射与兼容办法见 §3。迁移用一次性 `yonder migrate`，不留长期别名机制。
5. 远程控制先上线，不等 E2EE。最低安全是配对签名、TLS、账号鉴权、scope、审计。经云中转时明示「运营方技术上可读正文」，E2EE 列远期（§4.3）。
6. 默认配置：本机内核与本机插件随包安装，用户只配模型。预置「管家 Bot」。onboarding 由管家按清单逐项排查并建立 task list（§5）。
7. 桌面壳推荐 Tauri 2，内核作为独立 Node 进程（随包 Node 运行时，不用 SEA），先做一次必须通过的 spike；通不过退到 Electron。macOS 现有 Swift 壳在 spike 通过前保留（§4.6）。
8. 分发：保留一条命令安装，同时从 GitHub Releases 提供三平台安装包（§6）。
9. pi 迁到 fork 分支 `yonder/1.4`，作为独立阶段（§7）。
10. 合并与归档按 B1 顺序执行，统一 `archive/<名>-<日期>` tag，并新增 `docs/archive.md` 作为废弃方向索引（§8）。

**相对第一版的变化：**

| 第一版 | 本版 |
|---|---|
| Card web 与控制台不合并（§4.7） | 合并为一个应用，前端一份（D1） |
| 前端放 `apps/web`，只做控制台 | `apps/app`，含社交与控制台 |
| Cloud 档在 E2EE 前不开放远程控制（Q11） | 远程先上线，用告知加最低安全线 |
| macOS Swift 壳保留，跨平台壳 P4 再选 | 现在定：Tauri 2，spike 门控，Swift 过渡 |
| Card 仓改名 `yonder-card` 保留 | 云端部分改名 `yonder-cloud`，前端并入主仓 |
| `@yonder/cloud-protocol` 另立 | 与 `execution-protocol` 合并为 `@yonder/protocol` |
| C 端默认 bundle 偏小，channel-cli/mcp 可选 | 本机可配渠道默认装上，第三方平台渠道随包默认关闭 |
| 无首次体验设计 | 管家 Bot 加 onboarding（§5） |
| 未处理未合并工作、pi 升级 | 第 7、8 节落地为阶段 |

**仍需主人判断的产品问题：** 无。以下是需要主人提供的外部资源，不是产品选择：Apple Developer 账号（签名与公证）、Windows 代码签名证书（或 Azure Trusted Signing）、`GoYonderTogether` 组织下重命名仓库的权限。设计层的待复核项（含「节点」一词歧义）在 §12。

---

## 1. 产品模型

### 1.1 一个应用，三个角色

| 名词 | 定义 | 位置 |
|---|---|---|
| Yonder（应用） | 用户装的东西：内核、网关、前端、默认插件、预置管家 Bot | 一个安装包 |
| 内核节点 | 跑 agent 的 Yonder 实例：配置、模型凭据、会话、插件、事件库、网关。应用连的对象 | `yonder start`；本机或远程 |
| 设备 | 无模型、无 agent，只按配对签名暴露本机工具的执行端（`@yonder/device`，契约 spec 18） | 他机或本机 |
| 表面 | 前端的承载形态：`desktop`、`web`、`mobile`、`tray`、`companion` | 壳、浏览器、状态栏、悬浮窗 |

第一版把「轻客户端」拆给执行节点，本版沿用这个区分，用户文案只出现「设备」。「节点」仅用于开发者文档里的「内核节点」；设备端包名定为 `@yonder/device`，避免歧义（§12 R9）。

### 1.2 两种模式与联动

**Bot 模式：** 每个 Agent 是一个 personal agent，有职能（管家、研究员…），社交侧可见，对应 Card 名片与私信。事实：channel-card 已把 agent 同步为名片（`plugins/channel-card`，spec 16）。

**控制台模式：** 类 WorkBuddy。列会话与任务，开任务，看转录，答提问，管设备与设置。执行位置是本机或远程内核节点。

**联动：** Bot 能看到所有工作 session，并主动提建议、帮整理。内核已有的机制够用，不新增唤醒路径，需要补三样东西：

| 需要 | 做法 | 为何符合不变量 |
|---|---|---|
| Bot 读所有 session | 管家 profile 选入只读工具 `sessions_list` / `sessions_show`（事实：`packages/core/src/tools/catalog.ts` 已有会话类工具，精确名称与能力级别**未核实**）。读他人转录是新能力级别，建议在 spec 05 列为单独 capability，默认只给管家 | #3 插件提供，agent 选用；#5 能力加级别，不加审批层 |
| Bot 在合适时机醒来 | 绑定。两个入口：定时（cron 插件已有）和「session 空闲或完成」事件。后者是否已存在**未核实**；不存在就新增事件类型 `session.settled`，事件只追加，不违反 #1 | #2 只经绑定唤醒 |
| Bot 的建议送达与执行 | 建议走 `interaction` 的 present 卡片（已存在的信任边界交互），用户点同意才由 Bot 调写类工具（`tasks_*`、`sessions.submit` 等）。网关不加确认层 | #5 |

用户可在单个 session 上标记「不让 Bot 读」。落点是 session 元数据，由读取工具过滤，具体字段**未核实**，阶段 4 开工前先读会话元数据结构。

### 1.3 能力清单（数据结构与判断位置）

**缺口：** 同一份前端要跑在 5 个表面、本机与远程节点、登录与未登录三种状态下。若没有统一机制，每个页面各写一套 `if`，会重演第一版指出的「各表面各算一份」。

**结论：纯函数，前端计算，节点只下发事实。**

```ts
type Surface = "desktop" | "web" | "mobile" | "tray" | "companion";
type Scope = "read" | "write" | "admin";

// 客户端自己知道的事实
interface ClientFacts { surface: Surface; account: { signedIn: boolean; id?: string } }

// 节点下发的事实（方法 capabilities.get，scope=read）
interface NodeFacts {
  kind: "local" | "remote";
  protocol: number;                                  // 方法表版本，应用据此判断兼容
  methods: Record<string, { scope: Scope }>;         // 方法注册表的导出
  plugins: { id: string; version: string; views: string[] }[];
  granted: Scope[];                                  // 本次会话被授予的 scope
}

interface FeatureDef {
  id: string;                                        // "console.sessions"、"bot.suggestions"、"social.chat"
  needs: {
    surfaces?: Surface[];
    account?: "signed-in";                           // 不写 = 不要求
    node?: ("local" | "remote")[];
    methods?: string[];                              // 节点必须有这些方法
    plugins?: string[];
    scope?: Scope;
  };
  whenMissing: "hide" | "disabled" | "prompt-login"; // 缺条件时的表现
}
// 判断：visible(feature, client, node) => { state: "show"|"disabled"|"hide"; reason?: string }
```

设计理由：

- 场景和登录状态是客户端知识，节点不知道。节点事实（方法表、插件、scope）是服务端知识，客户端猜不到。所以拆成两份事实，判断放在拥有全部输入的前端。
- 功能依赖「方法存在」而不是「插件名」：`needs.methods` 优先，减少插件改名的牵连，也自然兼容旧版远程节点。
- 隐藏不是授权。网关与方法表按 scope 强制校验（§4.2），清单只管体验，不管安全。
- 不做服务端下发「功能列表」：那会让节点理解前端的功能 id，把前端发布节奏和内核绑死，对远程节点（版本可能不同）尤其不友好。
- 插件的 `views` 贡献自带 `requires`，用同一个判断函数，不另设规则。

默认可见矩阵（节选，阶段 4 落实为 `apps/app/src/capabilities/features.ts` 的一份表）：

| 功能 | desktop/web | mobile | tray | companion | 登录 | 节点 |
|---|---|---|---|---|---|---|
| 会话与任务 | ✓ | ✓ | 仅计数 | ✓ 紧凑 | 否 | 任意 |
| 等你回答 | ✓ | ✓ | 计数 | ✓ | 否 | 任意 |
| 设置、插件、渠道登录 | ✓ | 只读 | ✗ | ✗ | 否 | 本机，或远程且 `admin` |
| 设备管理 | ✓ | 只读 | ✗ | ✗ | 否 | 本机 |
| Bot 建议 | ✓ | ✓ | 计数 | ✓ | 否 | 任意 |
| 名片、联系人、私信 | ✓ | ✓ | ✗ | ✗ | **是** | 与节点无关 |
| 远程节点切换 | ✓ | ✓ | ✗ | ✗ | 是（经云中转时） | — |

### 1.4 关系图

```
 表面（同一份 @yonder/app）：desktop(Tauri) · web · mobile · tray · companion
                    │
        ┌───────────┴────────────┐
        │ NodeClient             │ CloudClient
        │ 本机 loopback 网关      │ yonder-cloud（账号/社交）
        │ 远程：配对签名 + relay   │ 本机时经节点代理，Web 时同源直连
        ▼                        ▼
 内核节点（yonder start）      yonder-cloud（闭源）
 网关 → 方法注册表 ← control.sock/pipe ← CLI/TUI
 内核·绑定·会话·插件·事件库
 管家 Bot 等 agents ──channel-card 出站 WSS──▶ 云
        │ spec 18 签名 RPC
        ▼
 设备（@yonder/device，他机）            依赖方向：yonder-cloud ──▶ @yonder/protocol（开源）
```

两条数据通道（**建议**）：节点数据走 `NodeClient`，社交数据走 `CloudClient`。从本机网关页面访问社交时，由节点用 channel-card 保存的账号凭据代理 `social.*`，浏览器不跨源直连云（避免 CORS 与 cookie 跨域，也避免云 token 进入浏览器 JS）。云托管的 Web/mobile 同源直连云。代理方法的具体设计在阶段 4 做，当前**未核实** channel-card 是否已持有可代理的用户态 token（spec 16 §1 的设备码登录产出的是设备凭据，与「用户会话」是否同一物**未核实**）。这是 §12 R4。

---

## 2. 开源边界与仓库矩阵

### 2.1 边界

闭源的只有「云端后端」：账号、Card 社交服务端、托管 relay 实现、部署脚本。其余全部开源：内核、SDK、CLI/TUI、协议、参考 relay、设备端、全部插件、前端、桌面壳、设计令牌、安装脚本。

理由（主人的论证）：AI 时代闭源前端不构成壁垒；前端开源后用户装上即可用，社区可修可审，这也是 Yonder「核心不依赖云」的前提。

### 2.2 仓库矩阵

| 仓库（目标名） | 可见性 | 职责 | 依赖 |
|---|---|---|---|
| `GoYonderTogether/yonder`（现 `yonder-harness`） | 公开，Apache-2.0 | 全部开源代码 | 第三方、pi fork |
| `GoYonderTogether/yonder-cloud`（现 `yonder-web`，由 `server/`、`deploy/` 演化） | **私有，唯一闭源** | 账号、Card 社交服务端、托管 relay、部署、站点静态托管脚本 | `@yonder/protocol`、`@yonder/app` 发布产物（版本固定） |
| `GoYonderTogether/pi` | 公开 | pi fork，分支 `yonder/1.4` | 上游 |
| `yonder-hermes-extensions` | 本地无 remote | 并回主仓后归档（§2.4） | — |
| `yonder-app`（发行仓） | 不建 | 发行用主仓 `release/` 与 GitHub Actions | — |

不建发行仓：签名密钥放 GitHub Actions secrets，发布节奏与内核一致，没有独立缺口。触发条件沿用第一版（出现闭源发行组件、需要独立更新通道）。

### 2.3 单向依赖的守卫

事实：当前公开 spec 依赖私有实现（`docs/spec/16-card-plugin.md:3` 写「以 `yonder-card-web/server/src/...` 为准」；`docs/spec/18-device-execution.md:101` 指向 Card 协议锁）。

建议：

- `@yonder/protocol` 合并 `@yonder/execution-protocol`（已有 `src/schema.ts` 单一源、`relay-v1.json`、`contract.lock.json` 模式，见 spec 18 §6）与云设备/中转协议（spec 16 已写明的 `/api/device/*`、`/ws/device` 帧）。协议文字以主仓为权威，云按锁文件对齐。
- 主仓 CI 检查「不得出现对 `yonder-cloud` 的路径引用」：`grep -rn "yonder-cloud\|yonder-card-web" packages apps plugins docs --include=*.ts --include=*.json --include=*.md` 只允许 `docs/archive.md` 与迁移说明命中。
- 契约测试对着参考 relay 或回环契约服务器跑（spec 16 §5 已有），不再需要私有仓。真实云联调留在 `yonder-cloud` 的集成作业。

### 2.4 hermes 两份代码的关系（已核实）

| | 外部 `yonder-hermes-extensions/packages/hermes-experience` | 主仓 `plugins/hermes-experience` |
|---|---|---|
| 版本 | 0.1.1（CHANGELOG：本地候选，未发布，`private: true`） | `0.2.26102705`（随主仓统一版本） |
| 源码 | 7 个 `.mjs`，共 64,091 字节 | 同名 7 个 `.mjs`（在 `src/`），共 70,044 字节，另有 `docs/`、`skills/hermes-yonder`、`test/`、`dist/` |
| 内容 | 0.1.1 的 skill frontmatter 校验已在两边都有（`duplicate_skill_frontmatter` 在外部 `skill-store.mjs:70`，主仓 `skill-store.mjs:116`） | 同左 |
| 关系 | 主仓 README 写明「从外部 experience 0.1.1 迁移」，插件 id、工具名、数据路径不变 | 即外部包的纳入版 |

逐文件 `diff` 全部不同，差异规模与格式化（主仓用 Biome 的 tab 缩进）一致。**未核实：** 差异是否仅为格式。该检查是阶段 3 的第一步（`diff` 忽略空白与缩进，或双方都过 Biome 格式化后比对）。

决定：

- **以主仓版为准，改名 `plugin-learning`。** 不是「用外部更新的替换主仓」：两边功能面看起来同为 0.1.1，主仓版带文档、技能和测试，已集成。若归一化比对后外部有主仓没有的改动，用 `git format-patch` 式逐条移植，不整体覆盖。
- **改名的真实代价：** 插件 id 是用户数据的键。受影响：`yonder.yaml` 的 `use` 与 `config.scopes`、agent/profile 选入的工具名 `hermes-experience_*`、运行时状态 `<home>/.yonder/plugins/hermes-experience/learning-state.json`、`.hermes-pending` 与 `.hermes-skill-archive` 目录。处理见 §3.4 `yonder migrate`。
- 与 `plugins/memory`（spec 15）的功能边界要在改名时写清：memory 管事件驱动的记忆整理，learning 管会话后复盘、私有技能与 pending。边界写不清就是命名没做对，这是 §12 R7。
- **`hermes-workspace`（0.1.0，57 行，工具 `hermes-workspace_preview`）：** 只读预览 Hermes 主目录布局，固定源 commit `0eb4f62a…`，无 Hermes 导入、不读凭据。它不是长期功能，是一次性迁移预览，建议并入 `yonder migrate` 的 `hermes` 子步骤（工具化后给管家 onboarding 用），不单独成插件。
- 外部仓库：先推 private remote（B1 §6 指出当前零备份），标 tag `archive/hermes-extensions-20261027`，再 GitHub archive。

---

## 3. 命名与改名映射

### 3.1 原则

参考 pi 生态：一个 monorepo，多个作用域包，CLI 二进制与产品同名。插件以功能命名，不以来源命名。不再使用的对外词：harness、Card Web、Net、being、轻客户端。例外：pi 上游 API 名（`Harness` 类、`pi-durable`）是第三方标识符，保留。

### 3.2 映射表

仓库与目录：

| 旧 | 新 | 备注 |
|---|---|---|
| `GoYonderTogether/yonder-harness` | `GoYonderTogether/yonder` | GitHub 自动重定向旧 URL；本地目录 `~/Documents/yonder-harness` → `~/Documents/yonder` |
| `GoYonderTogether/yonder-web`（本地 `yonder-card-web`） | `GoYonderTogether/yonder-cloud` | 私有；`src/` 前端迁入主仓 `apps/app`，仓内只剩 `server/`、`deploy/` |
| `yonder-hermes-extensions` | 归档 | §2.4 |
| `zoran-xc/yonder-harness`、`AI-Being`、`being`、`being-net`、`yonder-being`、`being-releases`、`yondermesh` | 归档 | §8 |

npm 包：

| 旧 | 新 |
|---|---|
| `@yonder/core`、`@yonder/sdk`、`@yonder/cli` | 不变（cli 的 bin 仍为 `yonder`） |
| `@yonder/execution-protocol` | `@yonder/protocol`（合并云设备与中转协议） |
| `@yonder/executor` | `@yonder/device`（Opus 复核后定，§12 R9） |
| `@yonder/pi-durable` | 不变（上游衍生，保留） |
| 新增 | `@yonder/gateway`、`@yonder/app`、`@yonder/desktop`、`@yonder/design`、`@yonder/relay`（参考 relay） |
| `@yonder/plugin-hermes-experience` | `@yonder/plugin-learning` |
| `@yonder/plugin-ui-companion` | `@yonder/plugin-interaction`（拆分后只剩提问卡工具与存储，服务与页面退役，§4.8） |
| `@yonder/plugin-codex-tools` | 以功能命名（**内容未核实**，阶段 2 读源码后定） |
| 其余插件 | 已按功能或平台命名（`channel-*`、`tasks`、`cron`、`memory`、`web-tools`…），不动 |

二进制与服务：

| 旧 | 新 |
|---|---|
| `yonder-executor` | `yonder device …`（子命令）；保留 `yonder-executor` shim 两个版本 |
| launchd 标签与 helper：`dev.yonder.harness.power`（`packages/cli/src/awake.ts:9,70-72`，路径含 `/Library/PrivilegedHelperTools/…`、`/Library/LaunchDaemons/…`） | `dev.yonder.power` |
| `User-Agent: yonder-harness`（`packages/core/src/runtime/quota-source.ts:156`） | `yonder/<version>` |

运行时目录与环境变量：

| 旧 | 新 | 备注 |
|---|---|---|
| `~/.local/share/yonder-harness/home`（`packages/cli/src/index.ts:269`） | `~/.local/share/yonder/home` | 迁移后在旧路径留符号链接 |
| `<home>/.yonder/`（`awake.json`、`logs`、`plugins/<id>`、`auth.json` 等） | 不变 | 已是产品名 |
| `~/.ai-being/` | 不动 | 用户数据，由主人处理 |
| 环境变量 `YONDER_*` | 不变 | 仓库内无 `YONDER_HARNESS_*`（已 grep）；仅 `YONDER_CARD_ROOT`（3 处，测试用）改 `YONDER_CLOUD_ROOT` |
| 线上域名 `yonder.zethai.cn` | 不改 | 归 Zeth-AI 基础设施 |

文档词汇：`docs/` 与 README 中的「Harness」产品指称改为「Yonder」，「Card Web」改为「Yonder 应用（Web）」，「Net」「being」「轻客户端」不再出现。这属设计变更，见 §10。

### 3.3 `yonder-hermes-extensions` 以外的重复资产（B1 §a 汇总）

| 重复 | 处理 |
|---|---|
| 品牌：`brand/src/yonder-mark.js`、Card 另存 SVG 与草案 | 唯一源 `packages/design/brand/`（`@yonder/design`），Card 副本删 |
| 设计令牌：Card `src/styles.css`（197 行，115 个 `--` 令牌）与 ui-companion `style.css:1-2` 复制 | 令牌随前端并入同仓后直接放 `packages/design/tokens.css`，两处引用 |
| 图标：lucide 子集两份 | `@yonder/design` 一份 |
| pi 多个目录 | 实为 1 仓库加 6 个 worktree（B1 §5/§a），清理见 §8 |
| 同名插件 hermes-experience | §2.4 |
| 4 个 Card 名字（`yonder-web`/`card-web`/`card-server`/`Yonder Web`） | 云端：`yonder-cloud`；前端：`@yonder/app`；不再有「Card Web」 |

前端并入主仓后，令牌「先复制再反转权威」的跨仓步骤不再需要（第一版 §3.6 的麻烦消失）。

### 3.4 兼容与迁移

目标：已有用户升级后不丢数据、不需要手改配置，旧名给出明确提示。

- **`yonder migrate`（新子命令，一次性，幂等，先备份）：**
  1. 若 `~/.local/share/yonder-harness/home` 存在而新路径不存在：`mv` 到新路径，旧路径留符号链接。`yonder service install` 提示重新注册 launchd（服务文件里写死了旧路径，**未核实**其具体字段，阶段 2 读 `yonder-service-host.mjs` 确认）。
  2. 重写 `yonder.yaml` 和 `agents/*.yaml` 中的旧插件 id 与工具名（`hermes-experience` → `learning`，`ui-companion` → `interaction`）；原文件备份为 `*.pre-migrate-<日期>`。
  3. 移动 `<home>/.yonder/plugins/hermes-experience/` → `…/learning/`。`memoryDir` 下的 `.hermes-pending` 等用户目录不动（README 声明 memoryDir 是用户授权的现有目录）。
  4. 打印将要做的操作；加 `--dry-run`。
- **读取兼容期：** 内核启动时若发现旧路径是真实目录（未迁移），仍从旧路径读并提示 `yonder migrate`，保持两个发布版本，之后移除。
- **插件 id：不做长期别名机制。** 缺口只在升级那一刻，由 `migrate` 解决。加载时遇到旧 id 报错明确指向新 id 与 `yonder migrate`。
- **CLI 别名：** `yonder-harness` 保留两个版本的 shim，打印弃用提示后转 `yonder`。
- **npm：** 若旧包名已发布（**未核实**，`plugins add` 的文档暗示可能已发布），对旧包发最后一版并 `npm deprecate`，指向新名。
- **GitHub：** 仓库改名后旧 URL 自动重定向；README 顶部注明改名，不另建占位仓。
- **验收：** §11 阶段 2。

---

## 4. 统一客户端架构

### 4.1 网关与方法注册表（沿用第一版，已按新目标调整）

事实：`packages/core/src/control/index.ts` 是 Unix socket 加行 JSON 传输；唯一 handler 是 `packages/cli/src/index.ts:724-841` 的 switch，手写 `requiredParam`，无 schema 无 scope，依赖 cli 层闭包（`startAwake`/`releaseInfo`/`stop`，`index.ts:703-720`）。

建议：

1. 方法注册表下沉到 `packages/core/src/control/methods.ts`，TypeBox 定义参数与结果，每个方法带 `scope: read|write|admin` 与可选 `local: true`（永不远程）。宿主服务经 `HostCtx` 注入。CLI 行为不变。这是第一阶段的第一步，也是唯一的大重构。
2. `packages/gateway`（`@yonder/gateway`）在内核进程内与 `serveControl` 并列启动，只绑 `127.0.0.1`，把同一份方法表以 `POST /api/rpc/<method>` 与 `GET /api/stream`（WS，单页单连接，多路复用）暴露。`@yonder/gateway/protocol` 子路径只导出 schema 与类型，前端 `import type`，不需要代码生成器。
3. 新增方法 `capabilities.get`（read）：返回 §1.3 的 `NodeFacts`。它直接从方法注册表与插件加载器导出，不另存一份。
4. 活动汇总只留一个口径：`activity.summary/watch` 以 `kernel.terminal.activity()` 为准（`index.ts:759-770`）。
5. 断线续传：`sessions.watch` 带不透明 `after` 游标，`ready` 帧带 `gap` 标志；语义与未核实的游标映射见 [contracts.md](contracts.md) §2.3。
6. Windows：`control.sock` 在 Windows 用命名管道，见 §4.6。

拒绝的备选（理由同第一版）：独立代理进程。它缺 schema 与 scope，多一个需要发现、保活、鉴权的服务；而远程鉴权需要方法级 scope。

### 4.2 本机鉴权（沿用）

- 只绑 loopback；256 位一次性启动 token 写入 `<home>/.yonder/gateway.json`（0600，含端口、pid），换取 HttpOnly 签名 cookie，24 小时。
- 每个请求（含 WS 升级）校验 `Host`、`Origin`、`Sec-Fetch-Site`，写方法只接 `application/json`。
- 严格 CSP（`script-src 'self'`，无内联脚本），`no-store`、`nosniff`。
- 端口固定加 `gateway.json` 持久化（cookie 与 `localStorage` 按源隔离，随机端口会丢 UI 状态）；冲突递增并写回。
- 网关不增加审批层；scope 只管「谁能调这个方法」。
- 桌面壳读 `gateway.json` 取 token 并在 WebView 换 cookie，不经 URL。
- 在网关默认开启之外，增加总开关 `gateway.enabled`，`yonder start --no-gateway` 保证无渠道核心仍可跑（第一版 §2.4 验收不变）。

### 4.3 远程控制（D6：先上线）

事实：spec 18 已有配对模型（Ed25519 公钥交换、核对 TLS 指纹、签名封套含 `principalId/requestId/issuedAt/expiresAt`）；中转 relay 现可解码 `payloadBase64`，spec 18 §1 明说不宣称 E2EE（`docs/spec/18-device-execution.md:24`）；云 ticket 60 秒（`execution-relay.ts:50-66`，仅在 Card worktree，未合主树，B1 §3）。

**最低安全线（上线门槛，缺一不可）：**

| 项 | 要求 |
|---|---|
| 配对签名 | 远程客户端与内核节点按 spec 18 §2 配对，请求逐条签名，带过期和 `requestId`；重放旧请求被拒 |
| TLS | 直连：TLS 加指纹核对。经 relay：客户端到 relay、节点到 relay 均 TLS |
| 账号鉴权 | 经 Yonder 云中转：relay 校验账号 ticket；自建 relay：配对白名单 |
| scope | 远程默认只含 `read` 与会话类 `write`，**不含 `admin`**（插件管理、凭据、`stop`）；`local:true` 方法永不远程；凭据值永不出现在任何方法的返回里 |
| 审计 | 每个远程调用写入事件库的 `gateway.audit` 事件（调用者主体、方法、结果、是否经云），复用「事件只追加」，不新建日志系统 |

控制协议命名空间 `yonder.control` v1，放 `@yonder/protocol`，沿用 execution 的签名封套结构，方法表是会话类方法而非设备方法（第一版理由不变）。

**「中转可读正文」的告知方式（建议）：**

- 首次选择经云中转连接某个节点时，应用弹出一次确认：「此连接经 Yonder 云中转。运营方在技术上能读取传输内容。端到端加密在计划中。」选项：继续、改用直连/自建 relay。同意记录在客户端偏好与节点审计事件里。
- 远程连接期间，节点侧托盘/状态栏显示「远程控制中 · 经云」。直连显示「远程控制中 · 直连」。
- 设置页的「安全」区常驻同一段说明，文字取自同一个源，不各写一份。
- 文档（spec 18、README）写同样的话，不使用「安全」「私密」之类绝对词。

E2EE 列远期：按 spec 18 口径「另行选用成熟端到端加密通道并升级契约」，不自造算法，本文不选型。

**前置条件：** 先把 Card relay（B1 §3 的 W0 worktree，`ab456a5` 等）合入云仓主线（B1 §b 步骤 1–3），再抽出协议。

### 4.4 前端合并方案

事实：Card 前端是 React 19、Vite 8、Tailwind 4、TanStack Query，位于 `~/Documents/yonder-card-web/src`（含 `App.tsx`、`api/`、`components/`、`lib/`、`pages/`、`store.ts`、`ui/`、`styles.css`）；`DESIGN.md` 在仓根。第一版核对到默认数据源为 mock（`src/api/index.ts:5` 的 `VITE_API === 'http' ? httpApi : mockApi`），**本版未重读该文件**。

方案：

1. **前置：** B1 §b 步骤 1–4（`zoran/live-dev` 变基到 `origin/main`、icons、relay W0、owner-console）先在云仓完成，否则要迁的是冲突中的前端。
2. **迁入：** 用 `git subtree add --prefix=apps/app <card 仓> <分支>` 或 `filter-repo` 只保留 `src/`、`public/`、`index.html`、`vite.config.ts`、`DESIGN.md` 的历史后合并（保留 blame）。云仓随后删除这些路径，改依赖 `@yonder/app` 发布产物。
3. **目录结构：**
   ```
   apps/app/src/
     shell/            图标栏、第二列、右栏容器、浮动面板、路由（hash）、表面适配（tray/companion 的紧凑布局）
     capabilities/     ClientFacts 采集、features.ts、visible()
     transport/        NodeClient（本机网关 / 远程 relay）、CloudClient
     features/
       console/        会话、任务、提问卡、活动、设备、设置
       bot/            管家建议、Agent 职能、session 整理
       social/         名片、联系人、私信（原 Card pages/components）
       views/          声明式 views 渲染器（§4.8）
   ```
4. **删除 mock 数据源。** `AGENTS.md` 第 4 条与不变量 10 禁止模拟模型与假数据。`mockApi` 路径随合并删除；社交页在未登录时显示登录入口，不显示示例数据。
5. 状态管理：服务端状态用 TanStack Query，流式增量由 `useStream(method, params)` 合并进缓存，不引入第二个状态库（沿用第一版）。Card 现有的 nanostores 用法（`store.ts`）合并时逐页评估，**未核实**其覆盖面。
6. 聊天气泡与 Markdown：Card 侧（社交消息）与控制台侧（工具调用、流式、转录条目）需求不同，各自实现，共用 `@yonder/design` 的令牌与图标，不预先抽 `@yonder/ui`。
7. 构建产物：`apps/app` 同一份产物同时被三处使用：网关托管（本机）、Tauri 壳内置（桌面）、云仓部署到 `yonder.zethai.cn`（Web/mobile）。区别只在运行时注入的 `ClientFacts.surface` 和传输。

DSH 借鉴不变：只借模式（WS 多路、Cookie 防线、槽位面板），不 vendor 代码。

### 4.5 信息架构（10-28 主人决定）

整体沿用 Card 前端现有的 IA，在其上加「工作」入口和右侧栏，不另起一套布局。

**顶栏。** 只存在于桌面壳（macOS 红绿灯 / Windows 标题栏）。浏览器里不显示顶栏，页面从图标栏和内容区直接开始。节点切换、搜索等原顶栏功能移入第二列顶部与设置。

**第一列：图标栏。** 从上到下：

| 图标 | 入口 | 说明 |
|---|---|---|
| 消息 | 消息 | 社交与 Bot 私信，Card 现有页面；登录后可用 |
| 通讯录 | 通讯录 | 名片、联系人、Bot 名片 |
| 电脑 | 工作 | 工作模式：遥控全部 Bot 与任务，本机或远程节点 |
| 头像（底部） | 设置 | 账号、模型、渠道、设备、节点切换；未登录时显示登录入口 |

手机底部导航与图标栏一一对应：消息 / 通讯录 / 工作 / 我。旧的「消息/任务/设备/我」四个 tab 和三栏布局不再使用。

**工作模式的第二列。** 上方是 Bot 列表，下方是任务列表，沿用 DSH 的会话侧栏做法：

- 分组可折叠；完成的任务自动折叠。
- 每项显示状态与进度（运行中、等你回答、完成、失败）。
- 每个 Bot 既是工作模式里的常驻会话，也是社交里的名片，是同一个实体。
- 「等你回答」与「建议」计数在图标栏、托盘、悬浮窗显示同一个数，来源是 `activity.watch` 与 `views` 的 `badge`。

**右侧栏。** 有开关按钮，可拖动调宽。内容是竖向的卡片栈：

- 每张卡片是一个 tab，内容可以是 todos、goal、子任务、附件，或插件通过 views 槽（§4.8）提供的视图。
- 卡片可拖动排序。布局（开关、宽度、顺序）按会话持久化。

**浮动面板。** 主区域上方可浮出面板：上下文构成与占比、后台任务、子 Agent、Bot 唤醒历史、todos、goal。浮动面板与右栏卡片是**同一个组件**，由 `placement: "floating" | "rail"` 决定落点，不做两套实现。

```text
桌面壳                                                            浏览器（无顶栏）
┌ ● ● ●  Yonder ─────────────────────────────────────────┐   ┌──┬──────────┬──────────────┬────┐
├──┬─────────────┬──────────────────────────────┬────────┤   │消│          │              │卡片│
│消│ Bot         │ 管家 · main            ● 运行中│ ▸ todos │   │息│ 同左     │ 同左         │栈  │
│息│  ◉ 管家 ●   │ …                            │ ▸ goal  │   │通│          │              │    │
│通│  ◉ 研究员   │        ┌ 浮动面板 ─┐          │ ▸ 子任务│   │讯│          │              │    │
│讯│ 任务        │        │ 上下文 62%│          │ ▸ 附件  │   │录│          │              │    │
│录│  ▣ 写周报 ● │        └───────────┘          │        │   │工│          │              │    │
│工│  ▣ 查资料 ✓ │ 输入…  [发送] [停止]           │        │   │作│          │              │    │
│👤│             │                              │        │   │👤│          │              │    │
└──┴─────────────┴──────────────────────────────┴────────┘   └──┴──────────┴──────────────┴────┘
```

- 「社交」相关入口（消息、通讯录）在 `account.signedIn` 为假时显示登录入口，不显示示例数据。
- 选择经云中转的远程节点时触发 §4.3 的告知。
- 前端实现位置见 §4.4 的 `shell/`（图标栏、两列、右栏容器）与 `features/`。

### 4.6 表面统一与桌面壳

所有表面都是同一前端的不同壳或路由：

| 表面 | 形态 | 数据 |
|---|---|---|
| web | 浏览器打开网关 `/` 或云站点 | 网关 / 云 |
| desktop | Tauri 壳加载 `/`（本机网关，或内置资源加 `NodeClient`） | 网关 |
| mobile | 云站点（PWA），仅远程节点 | relay |
| tray | 状态栏菜单：活动计数、等你回答、打开主窗口 | `activity.watch` |
| companion | 悬浮窗：提问卡、进度，`/#/companion` | 网关 |

**桌面壳比较（D8）：**

| 项 | Tauri 2 + 独立内核进程 | Electron + `utilityProcess` 跑内核（DSH 模式） |
|---|---|---|
| 内核归属 | 内核是独立服务（`yonder service install`，launchd/systemd/任务计划），壳只是窗口 | 内核可作为壳的子进程，但 channels 要无界面常驻，仍需独立服务形态，Electron 内嵌的优势用不上 |
| 包体 | 壳约数 MB，加随包 Node 运行时（约几十 MB，数字**未核实**） | 自带 Chromium，数十到上百 MB（**未核实**具体数字） |
| 跨平台 WebView | 系统 WebView（macOS WKWebView、Windows WebView2、Linux WebKitGTK），行为差异需测 | 全平台同一 Chromium，一致性最好 |
| 悬浮窗（非激活） | 窗口配置可设置置顶、无任务栏、`focus:false`；macOS 真正的非激活 NSPanel 靠社区插件或原生桥，**未核实**可用性 | 原生 `BrowserWindow` 能力较全；macOS panel 类型可用 |
| 托盘 | 内置 | 内置 |
| 自动更新 | `tauri-plugin-updater`（更新包需 Ed25519 签名，与系统代码签名独立）；可用 GitHub Releases 的 `latest.json` | `electron-updater`，成熟 |
| 团队技能 | 壳需 Rust，但极薄（窗口、托盘、更新、子进程管理） | 纯 TS |
| 安全面 | 无 Node 集成，前端无法触及本机 API | 需严格 `contextIsolation`，攻击面更大 |

**推荐：Tauri 2，内核独立进程，随包 Node 运行时。**

- 理由 1：内核必须能脱离界面常驻（渠道、cron、Bot 主动建议都要在窗口关闭时工作），所以「壳托管内核」的 Electron 优势不成立，壳越薄越好。
- 理由 2：前端不需要 Node 集成能力，只访问网关；Tauri 把本机攻击面压到最小。
- 理由 3：包体和内存。
- **不用 Node SEA：** 事实：插件通过 `entry: ./dist/index.mjs` 在运行时动态加载（`package.json` 的 `yonder.entry`）；SEA 打包单脚本，与动态加载外部 ESM 插件不匹配（SEA 对 ESM 与外部模块的支持**未核实**，保守起见按不合适处理）。建议随包放一份官方 Node 二进制加预构建的 `dist/` 与 `node_modules`，由壳启动或由服务管理器启动。
- **风险与门控：** Tauri 在悬浮窗非激活、Windows/Linux WebView 行为上的能力**未核实**。因此阶段 6 先做一次 spike（一周量级，验收见 §11），三个硬指标：macOS 非激活悬浮窗、三平台托盘加单实例、sidecar 内核的启动/崩溃拉起。**任何一项不过，改 Electron**（壳逻辑不变，前端无改动，这就是壳要极薄的原因）。

**macOS Swift 壳的去留：**

- 事实：`packages/macos/{Companion,PowerHelper,YonderStatus}.swift`（974 行）做状态栏与悬浮窗，每 2 秒读 `status.json`/`desktop.json`（`YonderStatus.swift:53,57,106`）；`packages/macos-helper`（7,584 行）是权限引导，服务 native-automation。
- 建议：`macos-helper` 不动，与壳选择无关。`packages/macos` 在阶段 1 改为订阅网关（回路径不变）；Tauri spike 通过且悬浮窗达到对等后，在阶段 6 末删除，改用同一个 Tauri 壳。**不并存两个长期的 macOS 壳。**
- `PowerHelper`（防休眠特权助手，launchd 标签 `dev.yonder.power`）是独立的系统服务，改名随 §3.2 做，不属于壳。

签名、公证与自动更新的规格见 [release-ci.md](release-ci.md) §8；已有更新逻辑（`plugins/channel-github/src/update-job.ts`、spec 09 的 `YONDER_INSTALL*`）如何衔接**未核实**，阶段 6 先读 spec 09 与 `yonder-service-host.mjs`。

**Windows control 通道：** `control.sock` 改为命名管道 `\\.\pipe\yonder-<home 哈希>`；Node `net.createServer().listen(pipePath)` 同一套 API，传输层改路径与权限（管道 ACL 限当前用户）。事实：spec 09 95-96 记录 Windows 多用户隔离未验收；壳只用 loopback 网关，不依赖管道，CLI 用管道。

### 4.7 能力清单实现

- 位置：`apps/app/src/capabilities/`（`facts.ts` 采集 `ClientFacts`，`features.ts` 一份功能表，`visible.ts` 纯函数，`useFeature(id)` hook）。
- 节点事实：`capabilities.get`（§4.1），连接建立时拉取一次，插件重载（`views.watch` 或事件）时刷新。
- 版本协商：`NodeFacts.protocol` 低于应用要求的功能返回 `disabled` 加原因「节点版本较旧，请更新」，对远程节点有用。
- 测试：纯函数表驱动测试，输入真实采集的事实对象（来自真实节点调用的录制不算 mock：直接用运行中的节点 `capabilities.get` 结果作输入）。
- 不新增抽象的理由：第一版在各表面各算一份，导致三套活动汇总；这里只有一个判断函数，没有「插件化清单框架」。

### 4.8 views 槽（沿用，更新）

缺口、设计与数据卡片 vs 自带 JS 的取舍不变（第一版 §4.6）：新增第 10 个槽 `views`，声明式 `ViewDocument`（text/markdown/list/board/progress/choice/input/button），`placement: rail|floating|main|companion`，`badge`、`render`、`act`，`ctx.invalidate()` 触发 `views.watch`。`docs/decisions.md:189,195` 的「不加 UI 槽」决定被取代。

更新：

- 每个 view 增加可选 `requires`（同 `FeatureDef.needs` 的子集），由 §4.7 的 `visible()` 判断。
- Bot 的建议是一类 view：`interaction.suggestions`，由管家 Bot 用提问卡工具写入，前端渲染为「建议」卡片，操作经 `views.act`。
- ui-companion 迁移：保留 `present/result` 工具和 `interactions.json` 存储，作为 `plugin-interaction`；删除 `service.ts`、`web/`、`desktop.json`/`renderer.json` 写入与 `build.mjs`。tasks 同样删 HTTP 服务，`board.ts` 渲染保留供 IM 出图。
- 冲突处理沿用 `claim(slot,name,pluginId)`（`packages/core/src/plugins/index.ts:131`）。

---

## 5. 默认配置与首次体验

### 5.1 现状（已核实）

- 预设注册：`plugins/agent-presets/src/index.ts`（54 行）注册任务预设 `default`/`coding`/`research`，以及可创建常驻 agent 的模板 `jarvis`（「个人事务、本机电脑、Agent 协调」）与 `default-agent`。**四个预设里 `model` 都写死为 `openai/gpt-6-luna`**。这与「用户只配置模型」冲突：用户配了别的模型，预设仍指向 luna。
- 提示词在 `plugins/agent-presets/prompts/{jarvis,default-agent,tasks}`。
- `init`：`packages/cli/src/index.ts:426-438`，spec 08 第 10 行写「init 生成 `default.yaml`（基础 TUI 新任务用）与选择 web-tools 的 `research.yaml`」。没有预置常驻 agent。
- 首次使用提示是一行字符串：`packages/cli/src/index.ts:881`「首次使用请运行 yonder init、yonder login openai、yonder service install，然后运行 yonder。」
- **没有名为 onboarding 的插件。** 只有 `plugins/memory/skills/memory-onboarding`（响应 `memory.attention` 事件，逐个询问记忆来源，仅限记忆）。第一版也只提到 `plugins/memory`。因此「改进初始化插件」实际是新增，不是改造；我把它写成缺口。

### 5.2 管家 Bot（预置）

- `init`（及应用首次启动）创建 agent `steward`（展示名「管家」），基于 `jarvis` 模板。它是首个 Bot，在 Card 里对应第一张名片（登录后）。
- 模型：预设不再写死。`model` 省略时取 `yonder.yaml` 的默认模型；找不到则 onboarding 的第一步（见下）。需要改的代码：`plugins/agent-presets/src/index.ts` 四处 `model:` 字面量，及 SDK 对 `model` 可省略的支持（**未核实**当前 preset schema 是否允许省略，阶段 3 先读 `docs/spec/03-agents.md §4`）。
- 管家 profile 选入（遵守 #3 装上不等于生效）：tasks、memory、cron、`sessions_*` 只读工具、interaction（提问卡）、learning（只读，写入需 onboarding 里用户确认）、web-tools。不选入：clipboard、native-automation、wechat-archive 等需 OS 权限或隐私的工具，权限走通后再加。
- 管家的职责说明（`SOUL.md`/`AGENTS.md` 模板）归 `yonder-prompt-design` 技能范围，改动前要读该技能，不在本文展开。

### 5.3 onboarding

**缺口：** 用户装好后只有空白；功能多（模型、渠道、设备、账号、权限），没人带路。

**设计（最小）：**

| 部件 | 内容 | 为何不新增更多 |
|---|---|---|
| 模型步骤（应用内向导，非 agent） | 选提供方、登录（沿用 `yonder login`，`packages/cli`）、发一条真实探测请求验证。这是唯一必须在 agent 之外完成的步骤，因为没有模型 agent 无法运行 | 其余都由管家完成 |
| 插件 `@yonder/plugin-onboarding` | 一个只读工具 `onboarding_probe`（返回清单每项状态：模型、渠道、设备、Card 账号、各 OS 权限、各插件配置）和一个技能 `onboarding`（走查流程）。工具读已有方法（经 `HostCtx`/内核门面），不新增状态存储 | 清单项的真相来源是各子系统本身，插件不复制 |
| 触发 | 首次启动时内核写入事件 `onboarding.start`，由绑定唤醒管家（#2）。完成标记是事件 `onboarding.done`，不是配置文件 | 事件只追加，可审计 |
| task list | 管家用 tasks 插件的账本工具（`plugins/tasks`，D66 已批准）把清单逐项建成任务，用户在看板上看到进度 | 复用 tasks，不另做清单 UI |
| 每项做完 | 管家用提问卡工具提问；用户在应用里点选。涉及系统权限的项（辅助功能、完全磁盘访问）调用 `macos-helper` 的引导 | — |

走查顺序（建议）：模型 → 渠道（本机已默认的）→ 设备（本机，再选择其它）→ Yonder 账号登录 → 权限（按用户想用的功能逐个）→ 可选渠道（微信、飞书、QQ、GitHub，用户选哪个才配置）→ 一次完整任务演示（真实模型）。

不做：向导式 UI 引擎、可配置的清单 DSL。清单就是技能里的有序文本加 `onboarding_probe` 的返回。

### 5.4 默认插件与渠道判断

「默认」分两层：**随包安装且加载**（本机可用）与 **被 agent 选入**（#3）。onboarding 的作用是在用户确认后补第二层。

| 插件 | 默认 | 判断 |
|---|---|---|
| agent-presets、context-files、web-tools、memory、cron、tasks、interaction | 加载 | 开箱体验，体量小，无 OS 权限 |
| learning | 加载，默认只读 | 无 scope 配置时不授权任何 Agent 记忆访问（README），安全 |
| channel-cli | 加载 | D7 本机可配。第一版曾判可选，此处改判：它是终端外第二入口，本机无外部凭据 |
| channel-card | 加载，未登录空闲 | 登录前不联网（spec 16 §5 `setup` 不联网） |
| channel-mcp | 加载但**不监听**，直到用户启用 | 事实：自起 loopback 服务并暴露 18 个控制工具（`plugins/channel-mcp/src/operations.ts:50,156`）。其鉴权方式**未核实**；在确认是 token 鉴权前，默认只装不开端口 |
| mcp-client | 加载，无服务器配置时空闲 | 本机配置项，无外联 |
| devices | W2（守护进程与配对）完成后默认；之前可选 | `plugins/devices/README.md:3` 说明 daemon 与配对未完成，现在默认会给出半成品 |
| clipboard、native-automation、browser-skill、wechat-archive | 随包提供，需用户在 onboarding 授权后启用 | 需 macOS 权限或隐私敏感（wechat-archive 读本机微信记录）；浏览器技能依赖 `bsk` 与扩展 |
| channel-feishu、channel-wechat-ilink、channel-qq、channel-github | 随包提供，默认不启用 | 第三方平台或地区性，由用户选择配置 |
| codex-tools、media-tools | 随包提供，默认不启用 | **内容未核实** |

实现：第一版的「发行 bundle 清单」改为 `distribution/bundles/{core,default,full}.json`。三者只列插件 id 与默认配置；`core` 为空，保证无渠道核心；`default` 是上表；`full` 含全部。复用 `init` 的写入路径，不新增机制。

---

## 6. 分发与安装

保留一条命令安装，同时在 GitHub Releases 提供 Linux、macOS、Windows 安装包（dmg、msi/nsis、AppImage/deb/rpm），云站点使用同一份 `@yonder/app` 产物。产物矩阵、安装脚本、包管理器、版本号规则、签名、更新与回滚的唯一规格在 [release-ci.md](release-ci.md)（§3 产物、§6 安装与更新、§8 多端）。本文只保留与架构相关的两点：

- 一条命令安装与桌面安装包的内核是同一份构建产物，由 GitHub Actions 出包。
- 回滚时 `yonder migrate` 使用的备份允许回到旧版本布局（旧版不会读新路径，符号链接保证旧版仍能找到数据）。

---

## 7. pi 1.4 升级（独立阶段）

事实来源：`research/B2-pi-upstream.md`（terra 正在按此移植，本节只列 Yonder 侧要做的事）。pi 迁到 fork 分支 `yonder/1.4`（基于 `v1.4.0`，保留 fork 的「一个 squash 根加若干细化提交」约定；不用 `git rebase --onto`，因为 D28/D29/D49/D44 的主体在根提交里）。

**前置：** pi 仓 `integration/t61-t63`（45014f2，4 个提交）目前只在本地且主仓是 shallow clone（B1 §5、§c），先推到 `GoYonderTogether/pi` 的 `yonder/1.3` 并转为完整 clone，否则升级的基线本身没有备份。

**harness 侧必改项（B2 §4.3，逐项带位置）：**

1. 5 个 `defineDoc`/`defineDocFamily` 补 `checkpointWhen`：`packages/core/src/runtime/docs.ts:5`（`SessionDoc`）、`:42`（`RunDoc`）、`:91`（`ModelBindingDoc`）；`packages/core/src/runtime/background.ts:26`（`JobDoc`）、`:42`（`JobPointer`）。不补则类型报错。
2. `packages/core/src/runtime/fork.test.ts`：版本断言 `1.3.0` 改；同时校准对 `dist/harness/live.js` 含 `pi.run-receipt`、`harness.js` 含 `beforeAgent`、`generation.js` 含 `prepareBoundary(...)` 与 `runtime.hooks.each("shouldRetry"` 的字符串断言。
3. `onReport` 20+ 调用点（`quota-source.ts:286`、`model-watch.ts:26`、`packages/core/src/signals/codes.ts:53`）：单参仍可用，不需改。
4. 依赖 fork API、合并后需回归：`runtime/index.ts:205`（`resolveModels`）、`:245`（`beforeAgent`）、6 处 `RunReceiptDoc` 快照（`:1273/:1446/:1480/:1583/:1606`）、`runtime/recovery.ts:44/:55`（`shouldRetry`）、`hosted-process.ts:6/:49`（`LocalProcessSpawn`）。
5. `scripts/sync-pi-durable.mjs` 硬编码 `yonder/1.3`、`pkg.version !== "1.3.0"`、`FORK_SOURCE.json` 的 `branch/upstream/upstreamCommit`；全部改 1.4。
6. `scripts/bundle-pi-ai.mjs` 的 `1.3.0` 断言；`scripts/check-pi-ai-bundle.mjs` 要求 lockfile 中只有一份 `@earendil-works/pi-ai`；根 `package.json:60` 的 `file:./third_party/pi-ai/pi-ai-45014f2a….tgz` 需用新 fork commit 重新打包并加 `overrides`。
7. 把所有 `1.3.0` pin 提到 `1.4.0`：`packages/core/package.json:21-22`、`packages/sdk/package.json:20-21`、`packages/cli/package.json:22-23`、`packages/pi-durable/package.json:138-139`。
8. `AGENTS.md` 第 5 条与 spec 12 以「pi v1.3.0 原生界面」为基准，改为 1.4.0（设计变更，§10）。`pi-coding-agent`/`pi-tui` 的 30+ 个导入符号在 1.4.0 全部保留（B2 §4.2）。

**可复用的新能力（建议逐项评估，不一次吃下）：**

| 新能力 | 替代 Yonder 现状 | 优先级 |
|---|---|---|
| `settings.afterFailedRun` | D28/D49「abort 后续跑排队输入」的自定义边界代码；`model_error`/`no_model` 分支 | 中，先对照行为（B2 §5.4 未核实一致性） |
| `settings.compaction.modelOverrides` | `backgroundAtTokens`；`packages/core/src/config/schema.ts:147` 里 `compaction` 是 `Record<string, unknown>`，拼错键静默失效 | 高，收益是类型保护 |
| `Harness.wake()`/`onWake`/`setTimer` | cron、后台作业、服务宿主的自建轮询 | 中，与 Bot 主动建议（§1.2）相关 |
| durable `telemetry`、`AI_TELEMETRY_SCHEMA`、`renderTrace()` | T61 自建 `pi.model-observation` 与 `scripts/export-model-observations.mjs` | 低，中期迁移并缩小 fork |
| `restartLimit`/`Harness.retryTask`/`blocked` | 崩溃循环自建处理 | 低 |
| `identity` | 模型请求 User-Agent 统一 | 低，可与 §3.2 User-Agent 改名合并 |

**风险与回滚：** SQLite schema v2 迁移不可回滚（B2 §5.1）。在用户真实 `state.db` 的**副本**上先跑 `Harness.open` 确认。发布时安装包需写明「升级后不可降级到 0.2 之前的版本」，并在 `yonder migrate` 前自动备份 `state.db`。

---

## 8. 合并、归档与废弃方向

### 8.1 合并顺序（B1 §b，按云仓拆分调整）

| # | 仓库 | 动作 | 依赖 |
|---|---|---|---|
| 1 | card-web | `zoran/live-dev` 变基 `origin/main`（44/2，39 处冲突集中在 `server/src/*`），推 `origin/zoran/live-dev` | 先把本地独有的分支推送备份 |
| 2 | card-web | cherry-pick `887769b`（ui-icons，1 提交） | 1 |
| 3 | card-web | cherry-pick `ce3cb53`、`513d14a`、`ab456a5`（relay W0） | 2；主仓 executor 已有 `card-connection.ts` |
| 4 | card-web | 合 `origin/design/owner-console`（clean，3 文件） | 1 |
| 5 | harness | 合 PR #59 `yonder/proposals-delta`（clean，纯文档） | — |
| 6 | harness | `yonder/default-agent-peer-binding`（30 文件 +798，含 `kernel/peer.ts`），先解 `docs/spec/03-agents.md`、`09-cli-release.md` 冲突 | 5 |
| 7 | harness | `yonder/runtime-discipline` 变基重放（冲突 10 个文件，runtime/delivery 已被 main 大改） | 6 |
| 8 | harness | `yonder/autonomy-prompt` 的 prompt 段落手工重放到现 `content.ts` | NEEDS-OWNER，见下 |
| 9 | harness | 从 `yonder/card-plugin` 捞 `brand/assets/**`、`brand/scripts/build.mjs`、`proposals/ai-card/*`、`proposals/card-studio/*`（31 文件） | — |
| 10 | pi | 推 `integration/t61-t63`（45014f2） | 阶段 7 前置 |

**与统一客户端的顺序约束（新增）：** 步骤 6 改了 `packages/cli/src/index.ts`，而方法注册表重构要改同一文件的 `724-841` 行，所以 5–7 必须在阶段 1 之前完成，避免两边冲突。步骤 8（autonomy-prompt）涉及 prompt 语义，按 AGENTS.md 与 `yonder-prompt-design` 技能由维护者决定是否合入，不在本计划里自动合并。

**未提交工作（B1 §7）：**

- `packages/core/src/runtime/model-chain.ts`、`model-chain.test.ts`、`model-watch.ts` 的三处改动：是行为变更（链路顺序、探针 `maxTokens: 8 → 512`），带测试，意图属主人，按普通提交走：先跑 `packages/core/src/runtime/model-chain.test.ts`，由主人确认后单独提交。
- 未跟踪：`.codegraph/`（49M）加入 `.gitignore`；`model-chain.ts.bak-order-20261027` 移出仓库目录；`proposals/unified-client/` 与 `proposals/workbuddy-hub-integration.md` 按提案提交。
- `proposals/local-model-gateway.md`、`.workbuddy-ai/memory/2026-10-27.md` 提交前核对无明文密钥（只查，不读取值）。
- stash：`stash@{0}` 内容已 100% 在父分支，核对后 drop；`stash@{1}` drop 前人工核对 `plugins/channel-feishu/src/index.ts` 的 3 行差异（`taskCardParameters` 抽取）。

### 8.2 归档规则

- **tag 命名：** `archive/<名>-<YYYYMMDD>`。`<名>` 是分支名把 `/` 换成 `-`；`<YYYYMMDD>` 是分支**最后一次提交日期**，不是归档日，这样名字不随执行日变，可重复推断。例：`yonder/card-plugin`（10-27）→ `archive/yonder-card-plugin-20261027`；`yonder/trim-overbuilt`（10-22）→ `archive/yonder-trim-overbuilt-20261022`。B1 里临时拟的名字（`archive/pre-rightapi-…`）统一改用此规则。
- **tag 必须推到 `origin`**（本地 tag 不算备份），推完再删分支。
- **删分支前置条件：** `git cherry <主线> <分支>` 全为 `-`（已 patch 等价），或已打 tag 并推送。
- **整仓归档：** 先 `git clone --mirror` 或 `git bundle create` 到 `~/Documents/_being-archive/bundles/`，`git bundle verify` 通过，再 GitHub archive（只读、可逆）。不删除任何仓库。

### 8.3 废弃方向清单

| 对象 | 处理 |
|---|---|
| AI-Being、being、being-net、yonder-being、being-releases | 逐个 bundle 加 GitHub archive；being-releases 是公开空仓，同样 archive 防误认为发布源 |
| yondermesh | 主人已定为旧仓、与当前无关；本机无 checkout，用 `git clone --mirror` 取一份（只读网络访问，按 agent-network 技能配置）后 archive，不分析内容 |
| `zoran-xc/yonder`（本地 remote `archive`） | 本地分支 `archive/private-main` 打 tag `archive/private-main-20261020`，GitHub archive，删本地 `archive` remote。独有内容仅旧 pi patch 机制（B1 §1），已被 vendored `packages/pi-durable` 取代 |
| `yonder/trim-overbuilt`、`-r2`、`release/0.2.26102311`、`yonder/release-0.2.26102312`、`archive/main-before-rightapi-20261023` | 打 tag 后删分支。撤回目标已自然消失（B1 §2） |
| `yonder/card-plugin` | 步骤 9 捞出 31 个文件后打 tag 删分支 |
| ALREADY-IN 的 8 个分支与 3 个多余 worktree、`task-4/yonder-w1` 整份克隆 | `git cherry` 确认后删除（B1 §a） |
| pi 的 `/private/tmp/{t61-pi,yonder-integration-pi,yonder-t63-pi}` 三个 worktree、已合入的两个 Documents worktree | `git worktree remove`，确认无未提交改动 |
| `trim-overbuilt`、AI-Being 等遗留文档引用 | 保留为来源记录；Card 的 `server/PLAN.md:8`、`DESIGN.md:9` 死路径改为「已归档，见 `docs/archive.md`」 |

### 8.4 `docs/archive.md`（废弃方向索引）

新增文件，一张表，每行一个废弃对象：

| 列 | 内容 |
|---|---|
| 名称 | 仓库/分支/目录名 |
| 类型 | 仓库 / 分支 / worktree / 方向 |
| 废弃原因 | 一句话，指向 `docs/decisions.md` 条目 |
| 存档位置 | GitHub archived 仓库 URL 或 `archive/…` tag 或 bundle 路径 |
| 最后提交 | sha 与日期 |
| 找回 | 一条可执行命令，如 `git checkout -b restore archive/yonder-card-plugin-20261027` |

文件头注明：「本文件只记录废弃方向，不记录现行设计」，新增归档须在同一次提交里加一行。属 `docs/` 的新增，需维护者批准（§10）。

---

## 9. 架构审计

按对目标的影响排序。保留第一版有效条目并更新；新增条目标「新」。

1. **控制面 handler 在 cli 包。** 事实：`packages/cli/src/index.ts:724-841` 的 switch，手写校验，闭包依赖。影响：网关无法复用。建议：下沉为 core 的 TypeBox 注册表（§4.1）。时机：阶段 1 第一步；前置是 B1 步骤 6 先合。
2. **6 处自起 loopback 服务。** 事实：channel-cli、channel-mcp、tasks/`service.ts`、interaction/`service.ts`、executor、core/control。人面向的只有 interaction 与 tasks。建议：这两处并入网关后退役，其余四处不动。时机：阶段 4。
3. **三套活动汇总。** 事实：`service.info`（`index.ts:759-770`）、`status.json`（`status-surface.ts:14-20`）、tasks `?view=activity`（`service.ts:54-83`），Swift 侧 `Companion.swift:33-92` 还解析一份。建议：以 `kernel.terminal.activity()` 为唯一口径。时机：阶段 1 定义方法，阶段 4 切换各表面。
4. **控制面无鉴权。** 事实：`control.sock` 靠文件权限，Windows 多用户隔离未验收（spec 09 95-96）。建议：网关独立鉴权，socket 不变；Windows 管道用 ACL。时机：阶段 1（网关）与阶段 6（管道）。
5. **观察流断线无游标。** 事实：spec 13 §1.3。建议：`after` 与 `gap`（§4.1）。时机：阶段 1 最小版。
6. **文档漂移与 spec 编号冲突。** 事实：spec 15 有两个文件（`15-memory.md`、`15-clipboard-vault.md`）；spec 04 §3 首句「共九个」与列表不一致；`docs/plugins.md` 与 `contributes` 有差异。建议：新增 `views` 时顺带改槽数；新 spec 用 19 号避开冲突。另立清理任务。
7. **提案无状态。** 事实：12 个提案均无采纳标记，`task-ledger/design.md` 自述「待批准」但 D66 已采纳。建议：提案头加状态字段。本提案按此发布。
8. **Card relay 未合主树，公开 spec 依赖私有实现。** 事实：relay 只在 worktree（`execution-relay.ts`，113 行），`zoran/live-dev` ahead 44。建议：§8.1 步骤 1–3，然后抽 `@yonder/protocol`。时机：阶段 5 前置。
9. **设备身份两套命名空间。** 事实：Card 设备 UUID 与执行设备 ID 分离（`execution-relay.ts:88` 注释、`plugins/devices/README.md:12`）。建议：保持，UI 只做展示层映射并标注来源。
10. **根 build 链。** 事实：`build` 串 5 步，含 devices、Swift、interaction 内联。建议：拆为 `build:ts`、`build:app`、`build:macos`（仅 darwin）、`build:desktop`。interaction 内联步骤随阶段 4 摘除。
11. **runtime 上帝对象。** `packages/core/src/runtime/index.ts` 1,899 行（`scripts/file-size-baseline.json` 登记「待拆分」）。pi 1.4 升级（§7）会碰它，**建议不在本方案内拆**，但升级前先确认测试基线。
12. **品牌与令牌复制。** 随前端并入同仓后消解（§3.3）。
13. **（新）预设写死模型。** `plugins/agent-presets/src/index.ts` 四处 `model: "openai/gpt-6-luna"`，与「用户只配模型」冲突。时机：阶段 3。
14. **（新）Card 前端默认 mock。** 违反 `AGENTS.md` 第 4 条。随合并删除（§4.4）。
15. **（新）本地独有、无远端备份的工作。** card-web 的 `codex/multidevice-w0-20261026` 与 `fix/yonder-web-ui-icons-20261027`、pi T61/T63 四提交、`yonder-hermes-extensions` 整仓（B1 §c）。这是当前最大的丢失风险，阶段 0 第一件事。
16. **（新）插件 id 即用户数据键。** 改名会断配置与状态路径（§2.4、§3.4）。没有迁移就改名会让升级用户静默失去 learning 状态。
17. **（新）`.codegraph/`（49M）未被 `.gitignore`。** 误提交会把二进制索引带进主线（B1 §c）。阶段 0 修。
18. **（新）网关异常拖累内核。** 网关与内核同进程，异常需隔离，并有总开关（§4.1、§4.2）。

---

## 10. 规格与决定变更清单

以下均需维护者批准。批准后先改 `docs/`，在 `docs/decisions.md` 记新条目，删除被取代的内容而不是追加（`AGENTS.md` 第 7 条）。

| 条款 | 现状 | 建议要点 |
|---|---|---|
| `AGENTS.md` 第 5 条 | 「基础 TUI 以 pi v1.3.0 原生界面为唯一基准」 | 改 v1.4.0。补一句：前端与网关不 import pi 包，`packages/core/src/runtime/` 仍是唯一出口；`apps/app`、`@yonder/desktop` 不属于 TUI 范围 |
| `AGENTS.md` 通篇与 `docs/index.md` | 「Harness」「Card」「Net」等词 | 对外词统一为 Yonder（§3.1）；仓库改名后的路径 |
| `docs/architecture.md` §1 | 「除主线外的一切能力都由插件提供」 | 补充：面向人的表面（网关、前端、壳）属于产品层；Bot 联动不新增唤醒路径 |
| `docs/architecture.md` §3 | 缺客户端层 | 新增「网关与客户端」行：传输、鉴权、观察游标，不负责业务逻辑 |
| `docs/architecture.md` §5 | 不变量 1–10 | **不修改。** 在 spec 19 里明确：网关 scope 不是审批（#5）；Bot 读 session 是能力级别（#5），唤醒走绑定（#2），工具由 agent 选用（#3） |
| spec 04 §3 | 「共九个」 | 增加第 10 个槽 `views`，`contributes` 增加 `views`，`requires` 字段；槽数口径改对。`apiVersion` 保持 1（旧内核对未知槽的处理**未核实**） |
| spec 05 | 能力与级别 | 新增能力「读取他人会话转录」，默认仅管家 profile |
| spec 08 | `yonder.yaml` | 新增 `gateway: {enabled, port}`；`distribution/bundles`；默认模型回退规则（预设省略 `model`） |
| spec 09 | 控制端点、安装、更新 | 控制端点增加网关与 `gateway.json`；Windows 命名管道；GitHub Releases 安装包、签名与更新；`yonder migrate`；数据目录改名与兼容期 |
| spec 12 | TUI 基准 v1.3.0 | 改 1.4.0，其余不变 |
| spec 13 §2、§1.3 | 「不另做 Web 控制台、不新增插件槽」；断线无游标 | 管理仍是同一方法表；人用客户端经网关；新增槽须经设计变更并列出 `views`；`after`/`gap` 语义 |
| spec 15 | memory 与 clipboard-vault 编号冲突；memory | 编号另立清理；写明 memory 与 learning 的边界 |
| spec 16 | 「以 Card 真实实现为准」 | 协议在 `@yonder/protocol`，云为其实现之一 |
| spec 18 | 不宣称 E2EE；Card W3 复制 relay schema | 增加远程控制的最低安全线与「中转可读」告知（§4.3）；relay 外层由 `@yonder/protocol` 统一导出；E2EE 列远期 |
| 新增 spec 19 | 无 | 「客户端网关与能力清单」：方法注册表、scope、HTTP/WS 帧、鉴权、`gateway.json`、游标、`capabilities.get`、本机与远程差别 |
| 新增 spec 20 | 无 | 「首次体验」：管家 Bot 预置、`onboarding.start/done`、清单项、默认插件分层。可并入 spec 03/08 以避免文档膨胀，由维护者定 |
| `docs/decisions.md:189,195` | interaction「不改内核或增加 UI 槽」「采用插件自有回环服务」 | 新条目取代，删除旧文 |
| `docs/decisions.md` 新条目 | — | 一个应用、开源边界、命名、远程先行、桌面壳、pi 1.4、废弃方向 |
| 新增 `docs/archive.md` | — | §8.4 |
| `CONTRIBUTING.md` | 工作方式 | 未读；仓库改名后路径与分支命名规则（`archive/<名>-<日期>`）需同步，**未核实**内容 |

---

## 11. 迁移路线

通用约定：验收一律真实运行，禁止 mock。需要模型的步骤用 `openai/gpt-6-luna`，缺凭据标「未测」并写明。浏览器验证用 `web-verify-local-chrome`。每个阶段独立可回滚，不依赖下一阶段才能用。

### 阶段 0：整理与备份（不改产品行为）

范围：先备份再合并再归档。顺序：① 推送本地独有工作（card-web 的两个分支、pi 的 T61/T63、hermes-extensions 建 private remote）；② §8.1 步骤 1–7、9、10；③ §8.2–8.3 打 tag、归档、删已合入分支；④ `.gitignore` 加 `.codegraph/`；⑤ 新增 `docs/archive.md`。

交付物：合并后的主线、`archive/*` tag 集、`docs/archive.md`、已归档仓库。

验收：

1. `git ls-remote --tags origin 'archive/*'` 数量等于归档清单分支数；对每个 tag `git cat-file -t <tag>` 返回 commit。
2. 每个被删分支的 tag 或 `git cherry main <tag>` 可找到内容（抽查 3 个：`archive/yonder-card-plugin-*` 能 `git checkout` 出 `plugins/channel-card`）。
3. `git branch -r --no-merged origin/main`（主仓、云仓、pi 分别）只剩明确保留的分支。
4. `gh repo view GoYonderTogether/<名> --json isArchived` 对每个废弃仓为 `true`；对应 bundle `git bundle verify` 通过。
5. 云仓 `npm ci && npm run build && npm test` 通过；主仓 `npm run lint && npm run typecheck && npm test` 通过（执行后无新失败，对照合并前的基线）。
6. 已合入的分支在合并前后，`proposals/`、`brand/assets` 文件的存在性逐一核对。

回滚：所有操作加 tag，合并用独立提交；整仓归档可在 GitHub 取消 archive。

用户影响：无（主人自己的工作区整理）。

### 阶段 1：最小可用切片（网关加一个会话页）

范围（刻意小）：

- 方法注册表（§4.1 的 8 个读/提交方法 + `capabilities.get`，其余仍走 cli switch，新旧并存一个版本）。
- `packages/gateway`：HTTP/WS、本机鉴权、托管 `apps/app` 静态资源、`gateway.json`。
- `apps/app`：**新建骨架，不并入 Card 前端**。只有一个页面：左侧会话列表，中间转录加输入加中止，顶部活动计数。用 `packages/design` 的令牌（从 Card `src/styles.css` 复制，先有一份）。
- `yonder ui` 命令；`Companion.swift` 在存在 `gateway.json` 时加载网关页面，缺失则回退原行为。
- 根 build 拆出 `build:app`。

不做：提问卡、看板、渠道、设置、社交、`views`、远程、状态栏改造。

交付物：`packages/core/src/control/methods.ts`、`packages/gateway/`、`apps/app/`、spec 19 初稿、测试。

验收：

1. `yonder start` 后，经 `yonder ui` 的 URL 打开页面，会话列表与 `yonder sessions list --json` 深度相等（对拍测试：同一 home 同一时刻，socket 与网关两路结果）。
2. 对一个运行中的会话，页面实时显示流式更新；手动断 WS 再恢复，已落库内容不重复不丢失（`gap:true` 路径各测一次）。
3. 通过页面提交输入，`yonder events query`（或 `events.query`）可见 `session.input` 事件。需要模型的部分用 `gpt-6-luna`，缺凭据标「未测」。
4. 安全负面用例（真实请求）：
   - `curl -s -o /dev/null -w '%{http_code}' -H 'Host: evil.example' http://127.0.0.1:$PORT/api/rpc/sessions.list` → 403
   - 带跨源 `Origin` → 403；无 cookie 访问 `/api/*` → 401；启动 token 第二次使用 → 失败；WS 无 cookie 升级 → 拒绝
   - 响应头含 CSP 与 `nosniff`；`lsof -iTCP -sTCP:LISTEN -P | grep yonder` 只显示 `127.0.0.1`
5. macOS 真机：悬浮窗加载网关页；删除 `gateway.json` 后回退原页面（截图确认）。
6. `yonder chat`、TUI、`yonder sessions …`、`yonder service …` 全部回归（现有测试加一轮手动）。
7. `yonder start --no-gateway` 后不监听 HTTP 端口，`control.sock` 照常。
8. `npm run lint && npm run typecheck && npm test` 无新失败。

回滚：`gateway.enabled: false` 或 `--no-gateway`；`control.sock` 路径全程不变；`Companion.swift` 回退分支；注册表迁移是纯重构，回滚即还原 switch。

用户影响：多监听一个 loopback 端口；CLI/TUI/渠道/插件无变化。

### 阶段 2：命名统一与兼容

范围：§3.2 全部映射；`yonder migrate`；兼容 shim；文档词汇替换（需 §10 批准）；`@yonder/protocol` 合并；`@yonder/device` 改名。

验收：

1. `grep -rIn "yonder-harness" --exclude-dir=node_modules --exclude-dir=.git --exclude-dir=dist .` 仅命中 `docs/archive.md`、迁移说明与 CHANGELOG 历史。
2. 用主人真实 home 的**副本**测迁移：`cp -a ~/.local/share/yonder-harness/home /tmp/yonder-home-old`，执行 `yonder migrate --dry-run` 再 `yonder migrate`，之后 `yonder start`；会话列表、learning 状态、凭据均在；再运行 `yonder migrate` 无变化（幂等）。
3. 旧入口：`yonder-harness --version` 打印弃用提示并转发；旧插件 id 加载报错信息指向新 id。
4. `yonder service install` 后重启，服务带新路径与新 launchd 标签（macOS 真机）；旧 `dev.yonder.harness.power` 助手卸载安装路径验证（需管理员授权，主人在场）。
5. `npm run build && npm test`；`gh repo view` 确认旧 URL 重定向到新名（`curl -sI https://github.com/GoYonderTogether/yonder-harness` 返回 301）。

回滚：`migrate` 的备份与符号链接可反向；包改名在单独提交里，可整体 revert；旧 shim 仍在。

用户影响：升级一次后需运行 `yonder migrate`（升级脚本自动运行并提示）。

### 阶段 3：默认配置、管家 Bot 与首次体验

范围：`plugin-learning`（§2.4，含归一化比对与逐条移植）；`distribution/bundles`；预设不再写死模型；预置 `steward` agent；`plugin-onboarding`；`onboarding.start/done` 事件；渠道默认判断（§5.4）；`hermes-workspace` 并入 `yonder migrate hermes`。

验收：

1. **干净环境首装：** 新用户、空 home，运行一条命令安装，仅配置一个真实模型，`yonder` 启动后管家 Bot 已存在，且开始 onboarding（`events.query` 可见 `onboarding.start` 绑定到 `steward`）。
2. 管家用 `onboarding_probe` 的真实结果建出 task list，看板上能看到各项状态；用户完成「模型」之后各项逐个被走通（真实模型，`gpt-6-luna`；缺凭据标「未测」）。
3. 预设中不含写死模型：`grep -n 'model:' plugins/agent-presets/src/index.ts` 无字面量，或值来自默认模型；改用另一个已配置模型后，新任务用的是该模型（`yonder presets show default`）。
4. `plugin-learning` 的现有测试全部通过（`plugins/hermes-experience/test/*.test.mjs` 改名后），并跑一次 `docs/learning-runtime.md` 的受控原生验收，**不能因改名减少用例**。
5. `yonder.yaml` 中第三方渠道（feishu/wechat/qq/github）默认不启用，`yonder channels list`（或网关 `channels.list`）显示「随包提供，未启用」。
6. channel-mcp 默认不监听（`lsof` 确认），启用后才监听。
7. `init --bundle core` 加 `start --no-gateway` 仍可对话。

回滚：`bundle` 改回 `core`；预设省略模型可恢复写死值；onboarding 插件可移除，管家 agent 保留。

用户影响：新用户零配置体验；老用户升级不自动创建管家（`init` 才创建，或首次启动询问一次），避免擅自改动现有 agent。

### 阶段 4：应用合并、能力清单、views 与 Bot 联动

范围：Card 前端并入 `apps/app`（§4.4）；能力清单；views 槽；`plugin-interaction` 拆分；退役 interaction 与 tasks 的 HTTP 服务；状态栏改为订阅 `activity.watch`；`session.settled` 事件（若不存在）；管家只读会话工具与建议卡。

验收：

1. 未登录与已登录两次启动：未登录时「社交」整块是登录入口且不发云请求；登录后（真实设备码流程，`channel-card`）出现名片与联系人，数据来自真实云后端（`yonder-cloud` 开发环境），源码中不含 mock 数据源（`grep -rn "mockApi" apps/app` 为空）。
2. 能力清单：表驱动测试覆盖 §1.3 矩阵；用 `desktop`/`tray`/`companion` 三种 `surface` 启动同一构建，截图确认显示差异；连接一个版本较旧的节点，受影响功能显示 `disabled` 加原因。
3. 让真实 agent 调用提问卡工具，主窗、悬浮窗、托盘计数一致；任一表面回答后，agent 的 `result` 收到真实回答，其他表面同步清除。
4. 活动汇总数字在三个表面一致（原最易分叉处）。
5. `grep -rn "createServer" plugins/interaction plugins/tasks` 为空。
6. **Bot 联动：** 创建 2 个真实工作 session，其一结束；管家被 `session.settled`（或 cron）绑定唤醒，用 `sessions_list/show` 读取，产出「整理建议」卡片（真实模型）；用户点同意后任务账本中出现整理结果；标记为「不让 Bot 读」的 session 不出现在管家读取结果中。
7. 安全回归同阶段 1，加 `views.act` 的参数校验（超长、类型错误、跨插件冒充 view id）。

回滚：`status.json`/`desktop.json` 兼容期内可回退旧壳逻辑；interaction/tasks 旧服务在窗口结束前保留于历史，不立即物理删除。

用户影响：悬浮窗外观改变；已装用户 `desktop.json` 在窗口期内仍生成；出现社交与 Bot 建议入口。

### 阶段 5：远程控制

范围：`@yonder/protocol` 的 `yonder.control` v1；`packages/relay` 参考实现；远程客户端配对与签名；审计事件；经云中转告知（§4.3）；节点切换；云仓对接。前置：§8.1 步骤 1–4 完成。

验收：

1. 两台真实机器：LAN 直连配对后，从 B 的浏览器/应用控制 A 的会话；经自建 relay 重复；经 Yonder 云中转重复，**且首次经云时弹出告知并在审计里留下同意记录**。
2. 远程调用 `plugins add`、凭据相关、`stop` 被拒（`admin`）；`local:true` 方法被拒。
3. 重放旧请求被拒；过期请求被拒；篡改正文签名失败。
4. 审计事件：`events.query` 能看到每个远程调用的主体、方法、结果、是否经云。
5. 抓包确认：直连与 relay 两段均为 TLS；relay 日志只含帧元数据（不能证明其不可读，因为 TLS 之上无 E2EE，在文档如实记录）。
6. 节点侧托盘显示「远程控制中 · 经云/直连」。

回滚：远程服务单独开关，默认关；撤销配对即断开。

用户影响：默认无变化，需主动配对；首次经云看到告知。

### 阶段 6：桌面壳与分发

范围：Tauri spike；通过后实现 `@yonder/desktop`；三平台安装包；签名/公证；自动更新；Windows 命名管道；删除 `packages/macos` 的 Swift 壳；Homebrew 等分期。

Spike 验收（一周量级，不通过则改 Electron，不进入后续）：

1. macOS：悬浮窗不抢焦点（在其他应用输入时窗口弹出，键盘焦点仍在原应用，真机操作录屏）。
2. macOS/Windows/Linux：托盘图标与菜单、单实例、关闭窗口不退出内核。
3. 壳启动、杀掉内核进程后自动拉起；壳退出不终止服务。

正式验收：

1. 三平台各一台真实机器（或 CI 真机）安装 → 首启 → 配模型 → 管家上线 → 完成一次任务。
2. `spctl -a -vv Yonder.app` 与 `stapler validate`（macOS）通过；Windows `signtool verify`（若已签名）；Linux `minisign -V` 与 `sha256sum -c`。
3. 升级：装旧版再自动更新到新版，数据与 `gateway.json` 保留。
4. Windows：`yonder sessions list` 通过命名管道返回，非本机用户账号无法连接（真实第二账号验证）。
5. 一条命令安装在三平台干净环境各跑一次。

回滚：Swift 壳在 spike 通过且对等验收前保留；安装包按版本留在 Releases；更新通道可暂停。

用户影响：macOS 用户升级后壳替换为 Tauri 版；Windows/Linux 首次有桌面应用。

### 阶段 7：pi 1.4 升级（独立，可在阶段 0 后任意时机开始）

范围：§7。不与阶段 2 同时合入（同改 `package.json`、`scripts/`）。

验收：

1. `npm run lint && npm run typecheck && npm run build && npm test && npm run test:node`；`node scripts/check-pi-durable-workspace.mjs`；`node scripts/check-pi-ai-bundle.mjs`。
2. 重点回归：`packages/core/src/runtime/{fork,recovery,fallback,background,credential-slot-recovery,notifications}.test.ts`、`boundary.test.ts`、`packages/core/src/config/config.test.ts`；pi 侧 `harness-generation-recovery`、`harness-compaction`、`harness-inbox` 等定向测试。
3. 在用户真实 `state.db` 副本上 `Harness.open` 成功（schema v2 不可降级，先验证）。
4. 真实模型端到端一轮对话加一次 abort 后续跑（D49）；缺凭据标「未测」。
5. `sync-pi-durable.mjs yonder/1.4` 后 `diff -rq` vendored 与 fork 源码为空。

回滚：保留 `yonder/1.3` 分支与旧 tarball；`state.db` 升级前自动备份；发布说明写明不可降级。

用户影响：模型调用恢复/重试行为可能有细微变化；升级后不可降级。

---

## 12. 风险与开放问题

风险：

1. **R1 网关在内核进程内，异常会拖累内核。** 缓解：错误隔离、总开关、传输层可替换。
2. **R2 方法注册表重构是全局改动。** 缓解：纯重构先行，对拍 socket 与网关，新旧并存一个版本；B1 步骤 6 先合以避免与 `cli/index.ts` 冲突。
3. **R3 经云中转先于 E2EE 上线。** 云运营方技术上可读正文。缓解：告知、直连/自建 relay 选项、最低安全线（§4.3）。这是主人已接受的取舍，文档不可使用「安全/私密」绝对词。
4. **R4 本机网关页访问社交的数据通道。** 浏览器跨源直连云有 CORS/cookie 问题，节点代理要求 channel-card 持有可代理的用户态凭据，**未核实**设备凭据与用户会话是否同一物。若不是，需要云侧新增用户态授权流程（改闭源仓），可能后移「本机网关内的社交」，Web/mobile 同源直连不受影响。
5. **R5 Tauri 能力未核实。** 非激活悬浮窗、WebView 差异。缓解：spike 门控，失败退 Electron，前端不变。
6. **R6 pi schema v2 迁移不可回滚。** 缓解：副本验证，升级前备份，发布说明。
7. **R7 learning 与 memory 边界。** 两者都管「记忆」。若职责写不清，用户会同时启用两个并冲突。改名前先写边界，必要时在 spec 15 增加一节。
8. **R8 迁移错误会丢用户数据。** 缓解：`--dry-run`、备份、符号链接、幂等；先在副本上演练。
9. **R9 「节点」一词歧义（已决）。** Opus 复核后定：设备端包名为 `@yonder/device`，子命令为 `yonder device`；「内核节点」只在开发者文档里使用，应用里统一叫「设备」。
10. **R10 能力清单与安全混淆。** 隐藏不是授权，所有写方法必须服务端校验 scope（§1.3）。需要在 spec 19 写明并加测试。
11. **R11 阶段 3 的默认插件扩大本机攻击面。** channel-mcp 默认不监听以缓解；其鉴权需先核实。
12. **R12 未提交的 model-chain 改动与归档并行。** 这些是主人当前工作，阶段 0 必须不触碰，只在主人确认后单独提交。

未核实清单：

- `kernel.eventWatermark()` 到转录 revision 的游标映射（§4.1）。
- `session.settled` 类事件是否已存在；`sessions_list/show` 的确切名称与能力级别；session 元数据能否承载「不让 Bot 读」（§1.2）。
- `plugins/hermes-experience` 与外部包的差异是否仅为格式（§2.4）。
- agent-presets 的 preset schema 是否允许省略 `model`（§5.2）。
- channel-mcp 的鉴权方式（§5.4）。
- channel-card 是否持有可代理的用户态 token（R4）。
- Tauri 非激活悬浮窗、WebView 差异；Node SEA 对动态 ESM 插件的支持；包体数字（§4.6）。
- 现有安装/更新逻辑（`YONDER_INSTALL*`、`update-job.ts`、`yonder-service-host.mjs`）如何衔接（§4.6、§6）。
- 旧包是否已发布到 npm（§3.4）。
- spec 04 对未知槽、`checkRegistrations` 的处理（§10）。
- Card `src/store.ts` 的 nanostores 覆盖面；`src/api/index.ts:5` 的 mock 开关（本版未重读，来自第一版核对）。
- `codex-tools`、`media-tools` 内容。
- `CONTRIBUTING.md` 是否需同步改动。
- B2 §5.4 所列 pi 1.4 的 4 项（`yonder.yaml` 中未校验的 fork 键、`afterFailedRun` 与 D49 的一致性、`bundle-pi-ai.mjs` 在 v1.4.0 上的实跑、自动合并文件的 T61/T63 语义）。