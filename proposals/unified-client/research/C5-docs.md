> 证据材料，结论已并入 [design.md](../design.md)

# Yonder 文档体系调研报告（只读）

调研对象：`/Users/zoran/Documents/yonder-harness`，HEAD `0211948`（2026-10-27，`chore(release): 0.2.26102705`）。所有命令只读执行；未修改、未提交、未推送任何文件。参照仓：`/Users/zoran/Documents/github/yonder-pi-1.4`（pi 1.4）、`/Users/zoran/Documents/github/opencode`。设计目标：`proposals/unified-client/design.md`。

## 0. 结论（先看这 8 条）

1. **文档不缺，缺的是分层与单一来源。** 全仓 190+ 个 md：`docs/` 70 个（1.1M）、`proposals/` 27 个、`plugins/` 58 个、根目录 10 个。问题不是覆盖率，而是同一事实有 2–3 份副本（`docs/plugins.md` 与 `docs/spec/11-official-plugins.md` 覆盖同一批 23 个插件；`docs/prompts/README.md` 与 `docs/prompts/v5-draft.zh-CN.md` 重叠）。
2. **`docs/` 不只是文档，它是运行时 API。** `packages/core/src/release/index.ts:122-149` 的 `readDocs()` 把安装目录下 `docs/` 递归列举，默认入口 `docs/index.md`；`yonder docs --list` 会把 `verification/`、`research/`、`evidence/*.json` 一起暴露给用户和 agent。任何"把内部记录挪走/归档"的决定都必须先考虑这条链路，且 `docs/index.md` 不能删。
3. **已知 4 个问题全部核实成立**，另有 6 个新发现（见 §2）：`docs/index.md` 漏列 `spec/15-memory.md`（memory 规范从文档地图不可达）、`docs/status.md` 有两个 H1 且泄漏本机绝对路径、`docs/spec/04-plugins.md:35` 的"共九个"与 §3 结构不符、`docs/spec/16-card-plugin.md:3` 引用已删除的 `proposals/ai-card/plugin.md` 与外部仓路径。
4. **改名面比预期小但很散。** 随仓库发布的文档里 `yonder-harness` 96 处 / 34 个文件、`Yonder Harness` 21 处 / 14 个文件、`AI-Being` 15 处 / 11 个文件；`Card Web`/`Yonder Net`/`轻客户端` 在现行文档中已是 0 处（只活在 `proposals/`）。真正麻烦的是 22 个 `docs/verification/*.md` 里的路径与命令。
5. **对照 pi：根 README 只做门面，深度文档跟随代码位置。** pi 根目录没有 `docs/`，`packages/coding-agent/docs/` 下 33 篇、`packages/chord/docs/` 3 篇，每包都有 `README.md` + `CHANGELOG.md`（共 108 个 md）。opencode 把文档做成 MDX 站点（`packages/web/src/content/docs`，33 篇 + 20 种语言，`docs-locale-sync.yml` 同步）。
6. **对照 opencode：治理文件是开源仓库的硬门槛。** opencode 有 `.github/CODEOWNERS`、`TEAM_MEMBERS`、3 个 issue 模板 + PR 模板、约 30 个 workflow；yonder 有双语 issue/PR 模板和 1 个 CI job，缺 CODEOWNERS、依赖更新、文档检查。
7. **本仓库没有任何文档自动化检查。** `npm run lint` = `biome check . && node scripts/check-file-size.mjs`（`package.json` scripts）。实际已积累 7 处断链 + 2 处非链接死引用 + 1 处 spec 编号冲突 + `docs/index.md` 漏文件——都是机器可查的。
8. **建议的落地顺序**（与 design.md §11 阶段 0 对齐）：先做零风险清理（删 HANDOFF.md、移 `docs/verification/`、修 7 处断链、补 `docs/index.md`），再加 CI 检查脚本，最后才做需要维护者批准的结构性合并（`plugins.md` 合并、spec 重编号、README 重写）。

## 1. 盘点

行数用 `wc -l`，日期用 `git log -1 --format=%cs`。"状态"里"现行"指内容与代码/规范一致且仍在被引用。

### 1.1 根目录（10 个 md + LICENSE）

| 文件 | 行 | 最后提交 | 用途 | 读者 | 状态 |
|---|---|---|---|---|---|
| `README.md` | 129 | 2026-10-22 | 产品门面：定位、Quick start、日常命令、安全模型、文档索引 | 用户 | 现行；5 处 `yonder-harness` |
| `README.zh-CN.md` | 127 | 2026-10-20 | 同上中文版，章节一一对应 | 用户 | 落后英文版 2 天，非逐行同步 |
| `AGENTS.md` | 9 | 2026-10-20 | 仓库内 agent 的 7 条硬规则（读序、边界、无 mock、pi 只在 `packages/core/src/runtime/` 引入、设计变更须批准） | agent | 现行；第 5 条（pi v1.3.0）与第 7 条（docs 清单）待改 |
| `CLAUDE.md` | 1 | 2026-10-20 | 单行 `@AGENTS.md` 转发 | agent | 现行 |
| `CONTRIBUTING.md` | 95 | 2026-10-26 | 仓库布局、边界、pi-durable/pi-ai fork 同步、检查命令、许可 | 开发者 | 现行；**纯中文**，OSS 门面缺口 |
| `SECURITY.md` | 61 | 2026-10-20 | 支持版本、漏洞上报、漏洞判定（中英双语） | 用户 + 维护者 | 现行 |
| `CODE_OF_CONDUCT.md` | 47 | 2026-10-20 | 行为准则（英中） | 全员 | 现行 |
| `CHANGELOG.md` | 550 | 2026-10-27 | 63 个 `## [版本]` + `## [Unreleased]`，Keep-a-Changelog 风格，中文，含 `### Verification` 段 | 用户 + 维护者 | 现行但体量失控 |
| `THIRD_PARTY_NOTICES.md` | 93 | 2026-10-26 | pi-durable / pi-coding-agent / TUI fork 与插件依赖声明 | 维护者 | 现行 |
| `HANDOFF.md` | 60 | 未跟踪 | 早期交接文档 | 本机 agent | **过时且误导**（§2.4） |

`LICENSE` = Apache-2.0（11358 字节）。`.github/`：`ISSUE_TEMPLATE/{bug_report,feature_request}.yml`（双语，bug 含 version/platform 必填）、`pull_request_template.md`（5 项检查，含"改设计先改 docs"、"无 mock"、"CHANGELOG Unreleased"）、`workflows/ci.yml`（单 job `macOS typecheck, build, test, lint`）。缺 CODEOWNERS、dependabot、FUNDING。

### 1.2 `docs/` 顶层（6 个）

| 文件 | 行 | 最后提交 | 用途 | 读者 | 状态 |
|---|---|---|---|---|---|
| `index.md` | 45 | 2026-10-26 | 文档地图，三层渐进披露（architecture → spec/01–18 → plugins/prompts/reference/decisions/status） | 用户/开发者/agent | 现行；**漏 `spec/15-memory.md`**；写"当前版本 0.1"（实际 0.2.26102705） |
| `architecture.md` | 73 | 2026-10-26 | 主线（事件→绑定→会话→运行→投递）、pi/内核/插件三层职责、11 个概念、10 条不变量、范围边界 | 开发者/agent | 现行；缺"网关与客户端"层（design §10 要求新增） |
| `decisions.md` | 328 | 2026-10-27 | D1–D67 决策记录（决定/理由/代价）+ 若干无编号日期条目 | 维护者/agent | 现行；顺序错乱、取代标记仅 4 处 |
| `plugins.md` | 365 | 2026-10-26 | 23 个官方插件逐节（包名/贡献/功能/边界） | 用户/开发者 | 现行但**编号已坏**、与 spec/11 重复 |
| `reference.md` | 215 | 2026-10-22 | 核心能力、CLI 命令、聊天斜杠命令、SDK 作者接口、当前没有的模块 | 用户/开发者 | 现行；"SDK 作者接口"节与 `packages/sdk/src/types.ts` 是否逐条一致**未核实** |
| `status.md` | 324 | 2026-10-27 | 现实与规范的差距、"已实现/已验证"用词定义、未关闭验收清单 | 维护者/agent | 现行但混入发布日志，**双 H1**，含本机绝对路径 |

### 1.3 `docs/spec/`（19 个文件，编号 01–18，15 号重复）

| 文件 | 行 | 日期 | 主题 | 状态 |
|---|---|---|---|---|
| `01-events.md` | 146 | 10-24 | 事件、引用 | 现行 |
| `02-sessions.md` | 221 | 10-25 | 会话、绑定、身份映射 | 现行 |
| `03-agents.md` | 243 | 10-27 | agent、配置档、预设、skill | 现行 |
| `04-plugins.md` | 314 | 10-25 | 插件槽与 SDK 类型 | 现行；"共九个"与 §3 结构不符（§2.6） |
| `05-security.md` | 78 | 10-25 | 能力 + 级别 | 现行 |
| `06-delivery.md` | 114 | 10-25 | 投递 | 现行 |
| `07-runtime.md` | 130 | 10-27 | pi 适配边界 | 现行 |
| `08-config.md` | 128 | 10-25 | `yonder.yaml` | 现行；缺 `gateway` 段（design §10） |
| `09-cli-release.md` | 149 | 10-27 | CLI、安装、更新、控制端点 | 现行 |
| `10-runtime-guarantees.md` | 64 | 10-23 | 运行保证 | 现行 |
| `11-official-plugins.md` | 200 | 10-25 | 官方插件逐条 | **重复**（与 `plugins.md`） |
| `12-terminal-interaction.md` | 152 | 10-23 | TUI 交互 | 现行；基准 v1.3.0 → 1.4（design §10） |
| `13-observation-and-management.md` | 65 | 10-20 | 观察与管理 | 现行；"不另做 Web 控制台"将被网关取代 |
| `14-execution-capabilities.md` | 128 | 10-25 | 执行能力与后台边界 | 现行 |
| `15-clipboard-vault.md` | 42 | 10-22 | 剪贴板与 Keychain（D53） | 现行；**编号冲突** |
| `15-memory.md` | 333 | 10-24 | 用户记忆库（memory 插件） | 现行；**编号冲突且不在 index 地图** |
| `16-card-plugin.md` | 43 | 10-26 | 名片渠道（channel-card） | 现行；引用已删目录与外部仓路径 |
| `17-task-ledger.md` | 94 | 10-25 | 任务账本 | 现行 |
| `18-device-execution.md` | 121 | 10-26 | 多设备执行 W0 契约 | 现行（契约已写、实现未完） |

全部为中文（CJK 行数：01=84、02=104、03=127、04=134、15-memory=212）。

### 1.4 `docs/prompts/`、`docs/research/`、`docs/verification/`

| 目录 | 内容 | 读者 | 状态 |
|---|---|---|---|
| `prompts/` 4 个 | `README.md` 78（提示词分层与来源）、`configuration.md` 100、`sessions.md` 61、`v5-draft.zh-CN.md` 141 | 维护者/agent | 前 3 个现行；`v5-draft` 是草稿且 3 处断链 |
| `research/` 6 个 | chrome-extension-install 49、default-agent-peer-binding-design 61、mac-permission-guidance 95、qq-group-participation 125、tool-discovery-20261023 39、vault-kernel 48 | 维护者 | 2 篇已落地（D63、D57）却仍在 research；其余为决策依据 |
| `verification/` 35 个 md + `evidence/` 7 个 JSON（532K / 108K） | 10 个 `release-*.md` + 25 个特性验收（最大 `service-host-owned-cleanup-20261025.md` 432 行） | 维护者 | **孤儿**：不在 `docs/index.md` 地图内，但被 `yonder docs --list` 列出 |

### 1.5 `packages/`、`plugins/`、`skills/`、`proposals/`

- `packages/`：`pi-durable/{README 3,FORK 99,CHANGELOG 150}`、`execution-protocol/README 11`、`executor/README 53`、`core/src/runtime/ACTIVITY.md 40`。**`core`、`cli`、`sdk`、`macos`、`macos-helper` 五个包完全没有 README**（`ls packages/core/*.md` 为空）。
- `plugins/`：20 个 `README.md`（`channel-cli`、`channel-mcp`、`context-files` 三个**没有**），7 个 `NOTICE.md`，3 个 `SOURCES.md`，另 35 个附属 md（`memory/README.md` 240 行最大，是唯一带 "English summary" 行的文档之一）。
- `skills/` + `.agents/`：13 个 md；`skills/skill-creator/SKILL.md` 引用 `references/{redlining,ooxml}.md` 均不存在。
- `proposals/`：27 个 md，**仅 15 个被 git 跟踪**（`unified-client/` 全目录与 `workbuddy-hub-integration.md` 未跟踪）；最大 `unified-client/design.md` 885 行、`runtime-efficiency/README.md` 456 行、`local-model-gateway.md` 365 行。

## 2. 已知问题核实（4 项成立 + 6 项新发现）

### 2.1 spec 15 编号冲突（成立）

`docs/spec/15-memory.md`（333 行，2026-10-24）与 `docs/spec/15-clipboard-vault.md`（42 行，2026-10-22）共用 15 号。`design.md:645` 已记录并建议"新 spec 用 19 号避开冲突"。

引用面（`grep -rIn '15-memory'`）：`docs/architecture.md:73`、`docs/spec/04-plugins.md:244`、`docs/spec/02-sessions.md:171`、`docs/spec/14-execution-capabilities.md:3,98`、`plugins/memory/README.md:3,240` 等 11 处。引用 `15-clipboard-vault` 的只有 4 处：`docs/index.md:26`、`docs/reference.md:215`、`docs/spec/04-plugins.md:159`、`plugins/clipboard/README.md:5`。

**建议**：保留 `15-memory.md` 为 15（引用多、篇幅大），把 `15-clipboard-vault.md` 改为 **21**（design.md §10 已把 19/20 预留给"客户端网关"和"首次体验"），同步改上述 4 处引用。改 4 处 < 改 11 处。

### 2.2 `plugins.md` 与 `contributes` 漂移（部分成立，另有更严重的结构问题）

- **编号已坏**（`grep -n '^##' docs/plugins.md`）：出现两个 `## 04`（`04 channel-mcp`、`04 browser-skill`），缺 `13`；`微信归档与 iLink`、`Clipboard / Keychain（D53）`、`channel-card`、`ui-companion`、`agent-presets`、`hermes-experience`、`tasks`、`devices` 共 8 节**无编号**。`docs/spec/11-official-plugins.md` 同样混乱（`## 微信双插件`、`## 15. QQ 官方机器人渠道`、`## UI Companion 交互窗口`）。
- 漂移本身：`design.md:645` 与 `proposals/unified-client/research/A4-plugin-arch.md` 记录"`docs/plugins.md` 的工具清单与 `contributes` 有差异"。我抽查 `memory` 一节（`docs/plugins.md:41-47`）写"工具 `memory_*`"，源码实际注册 9 个（`memory_bootstrap`、`memory_capture`、`memory_import`、`memory_me`、`memory_plan`、`memory_read`、`memory_review`、`memory_search`、`memory_status`）——用通配符掩盖了差异，**逐插件核对未核实**。
- 更严重的是**双份来源**：`docs/plugins.md`（365 行）与 `docs/spec/11-official-plugins.md`（200 行）覆盖同一批 23 个插件，粒度不同、编号都坏。

### 2.3 proposals 无状态标记（成立，比已知更严重）

27 个文件中只有 6 个带状态头：`context-keeper/design.md`、`goal-mechanism/design.md`、`local-model-gateway.md`、`runtime-efficiency/README.md`、`task-ledger/design.md`、`unified-client/{design.md,design-v1.md}`、`workbuddy-hub-integration.md`（8 个文件、6 种措辞）。其余 19 个无标记，包括 `proposals/memory/*`（5 个）、`proposals/multidevice/*`（2 个）、`task-awake/README.md`、`goal-context-time-design.md`、`unified-client/research/*`（11 个）。

另：`design.md`（885 行）与 `design-v1.md`（749 行）并存，v1 **未标"已被取代"**，且 `design-v1.md` 未跟踪（`git status` 显示 `proposals/unified-client/` 整目录未跟踪）。

### 2.4 `HANDOFF.md` 引用 `~/.ai-being`（成立，但不污染公开仓库）

`HANDOFF.md` 60 行：称"仓库里只有文档、LICENSE 与账本文件，没有代码"（实际是完整 monorepo）、指向不存在的 `docs/tasks/`（T00/T01/T02 任务制）、指向私有仓 `github.com/zoran-xc/yonder-harness`、引用 `~/.ai-being/{models,auth,providers}.json` 7 处。`.gitignore` 第 4 行是 `HANDOFF.md`，`git ls-files HANDOFF.md` 为空——**它不在仓库里**，只污染本机 agent 的判断。处理：直接删，有效内容并入 `docs/status.md`。

### 2.5 新发现（6 项）

1. **`docs/index.md` 漏列 `spec/15-memory.md`**：表中只列 `spec/15-clipboard-vault.md`（`docs/index.md:26`），而 5 个文档引用 memory 规范 → memory 从"文档地图"不可达。同时写"当前版本 0.1"（`docs/index.md` 表头），实际 `package.json` version = `0.2.26102705`。
2. **`docs/status.md` 双 H1**：第 1 行 `# 多设备执行 W0–W5 隔离集成（2026-10-26）` + 大段发布记录，第 7 行才是 `# 项目状态`。第 3 行含本机绝对路径 `/Users/zoran/Documents/Codex/2026-10-26/task/multidevice-handoff-2026-10-26.md`——**本机路径进了公开仓库**。
3. **`docs/spec/04-plugins.md:35`**："共九个：channels、tools、contexts、triggers、envs、hooks、presets、skills、permissions"，但 §3 只有 `3.1`–`3.8` 八个小节，`permissions` 落在文末 `## 统一权限门面（permissions 槽）`（第 285 行）。design §10 要求补第 10 个槽 `views` 时一并改口径。
4. **`docs/spec/16-card-plugin.md:3`** 引用 `yonder-card-web/server/src/{devices,realtime,chat,cards}.ts` 与 `proposals/ai-card/plugin.md`——后者所在目录**已不存在**（`ls proposals/` 无 `ai-card`），前者改名后应变 `yonder-cloud/server/...`。
5. **7 处断链**（自写脚本遍历所有非 `node_modules` md）：`CHANGELOG.md` → `RELEASE-LOCATION-READY.md`；`docs/prompts/v5-draft.zh-CN.md` → `jarvis/{SOUL,AGENTS,SOURCES}.md`（3 处，实际在 `plugins/agent-presets/prompts/jarvis/`）；`plugins/native-automation/README.md` → `../../HANDOFF-LOCATION.md`；`skills/skill-creator/SKILL.md` → `references/{redlining,ooxml}.md`（2 处）。
6. **`docs/` 会把内部记录当产品文档发出去**：`readDocs` 递归 `walk`（`packages/core/src/release/index.ts:125-137`），`yonder docs --list` 会列 `verification/…`、`research/…`、`verification/evidence/*.json`。而 `docs/verification/evidence/service-host-command-final-20261025.json` 里含 `/Users/zoran/.local/share/yonder-harness/...` 的进程快照。

## 3. 参照：pi 与 opencode 的布局

| 维度 | pi（`yonder-pi-1.4`，118k stars，MIT） | opencode（`bdf7572`） | yonder 现状 |
|---|---|---|---|
| 根 README | 206 行英文；logo + Discord/npm 两个 badge；一句话定位 → Getting started（curl 安装）→ Run with Nix → **Packages 表** → Permissions & Containerization → Contributing → Development → 构建/供应链/社区 → License | 114 行；logo 图 + 3 badge + **23 种语言切换条** → Installation（7 种包管理器）→ Desktop App → Agents → Documentation（外链网站）→ Contributing → Building on OpenCode → 社区 | 129 行 + 127 行中文；结构接近，但 Documentation 只有 6 行表格且全部指向中文 spec |
| 根目录治理文件 | `AGENTS.md` 125、`CONTRIBUTING.md` 102、`SECURITY.md` 87、`LICENSE`；**无 CODE_OF_CONDUCT、无根 CHANGELOG** | `AGENTS.md` 189、`CONTRIBUTING.md` 112、`SECURITY.md` 47、`CHANGELOG.md` 610、`STATS.md` 217；无 CODE_OF_CONDUCT | 全有（含 CODE_OF_CONDUCT 与根 CHANGELOG）；`CONTRIBUTING` 纯中文 |
| 深度文档位置 | **`packages/<pkg>/docs/`**：coding-agent 33 篇、chord 3、durable 1、env 2；根目录无 `docs/`；`packages/coding-agent/docs/index.md` 是入口，按"开始用/定制/自动化/参考/安全"分流 | **`packages/web/src/content/docs/`**：33 篇英文 MDX + 20 种语言各 31 篇，`deploy-www.yml` 发布、`docs-locale-sync.yml` 同步 | 根 `docs/`（运行时入口，不能挪）+ 5 个包无 README |
| 每包文档 | 每包 `README.md` + `CHANGELOG.md`（108 个 md） | 30+ 包各有 README | 只有 3 个包有 README |
| `.github/` | `APPROVED_CONTRIBUTORS`、4 个 issue 模板、18 个 workflow（issue-gate、pr-gate、npm-audit、nix） | `CODEOWNERS`、`TEAM_MEMBERS`、3 个模板 + PR 模板、约 30 个 workflow | 2 个模板 + PR 模板 + 1 个 CI job |
| 文档检查 | `issue-gate.yml` 控制准入 | `docs-locale-sync.yml` 保证多语言一致 | **无** |

三条可直接借鉴：

1. **README 只做门面**：pi 的 README 206 行里没有一条协议细节，全部链接到 `packages/coding-agent/docs/*`；yonder README 已接近这个形状，需要把"Documentation"表格改成按读者分流（见 §6）。
2. **文档跟随代码**：pi 用 `packages/<pkg>/docs/` 就近维护；yonder 因 `yonder docs` 必须保留根 `docs/`，但应补 `packages/{core,cli,sdk}/README.md`，把"这包负责什么、不许做什么"写在包旁边。
3. **治理文件是门槛**：opencode 的 `CODEOWNERS` + `TEAM_MEMBERS` 解决了"谁能批设计变更"；yonder 的等价物只写在 `AGENTS.md:7` 一句话里，外部贡献者看不到。

## 4. 改名影响面（`yonder-harness` → `yonder`）

统计范围：随仓库发布的文档 = 根目录 md + `docs/` + `packages/` + `plugins/` + `skills/` + `brand/`（不含 `proposals/`、`node_modules`）。

| 词 | 命中数 | 文件数 | 主要位置 |
|---|---|---|---|
| `yonder-harness` | 96 | 34 | `package.json:2,54`；`docs/status.md` 6；`docs/spec/09-cli-release.md` 3；`plugins/channel-github/README.md` 5；`docs/verification/` **22 个文件**；`README.md` 5 |
| `Yonder Harness` | 21 | 14 | README 中英各 5；`docs/architecture.md:3`（"Yonder Harness 是一个常驻的 agent 内核"）；各 spec 首句 |
| `Harness`（其余单独出现） | 34 | — | `docs/spec/11`、`plugins/*/README`、`CODE_OF_CONDUCT.md` |
| `AI-Being` | 15 | 11 | `docs/decisions.md` 3、`docs/spec/11-official-plugins.md` 2、`THIRD_PARTY_NOTICES.md` 2、`plugins/{wechat-archive,web-tools,channel-wechat-ilink}/` 5、`docs/verification/wechat-plugins.md` 1、`docs/research/qq-group-participation.md` 1（另 `HANDOFF.md` 7 处，未跟踪） |
| `card-web` | 3 | 3 | `docs/spec/16-card-plugin.md:3`、`docs/decisions.md:240`、`plugins/ui-companion/README.md:48` |
| `Card Web` / `Yonder Net` / `轻客户端` | 0 | 0 | 只存在于 `proposals/unified-client/*`（未跟踪） |

按目录分布（含 `harness` 的文件）：`docs/verification/` 22、`plugins/` 14、`docs/spec/` 9、根目录 7（README、README.zh-CN、CONTRIBUTING、SECURITY、CODE_OF_CONDUCT、CHANGELOG、THIRD_PARTY_NOTICES）、`skills/` 4、`docs/` 顶层 4、`packages/` 1、`docs/research/` 1。

代码层（不在"文档"口径内，但必须同批改，均已核实）：

- `package.json:2` `"name": "yonder-harness"`、`:54` `"repository": ".../yonder-harness"`。
- `packages/cli/src/awake.ts:9` `powerSocket = "/var/run/dev.yonder.harness.power.sock"`、`:70` `/Library/PrivilegedHelperTools/dev.yonder.harness.power`、`:71` `/Library/LaunchDaemons/dev.yonder.harness.power.plist`。
- `packages/core/src/runtime/quota-source.ts:156` `"User-Agent": "yonder-harness"`。
- `packages/cli/src/index.ts:269` `join(homedir(), ".local/share/yonder-harness/home")`。
- `plugins/codex-tools/src/app-server.ts:86` `clientInfo: { name: "yonder-harness", title: "Yonder Harness", version: "0.1.4" }`（版本号也停在 0.1.4）。
- `plugins/channel-mcp/src/operations.ts:43` `new McpServer({ name: "yonder-harness" })`。
- `plugins/native-automation/test/permissions.mjs:44,51` 与 `docs/verification/evidence/*.json` 里的 `.local/share/yonder-harness/...` 路径。

**建议的分批**：(a) 纯文档批——README 两份、`docs/spec/09`、`docs/status.md`、`plugins/*/README`，一次提交；(b) 验收记录批——`docs/verification/` 22 个文件里的命令与路径（属历史记录，改路径会失真，建议**不改正文**，只在文件头加一行"路径为改名前记录"，并把整个目录移出 `docs/`）；(c) 代码批——按 design §3.2 与 §11 阶段 2 统一做，含兼容期符号链接。

## 5. 目标文档树

约束前提：`yonder docs` 只能读 `docs/` 内部（`packages/core/src/release/index.ts:143` 抛 `Document path must stay inside docs/`），默认入口 `docs/index.md`，且 `docs/` 随安装包落地 → **`docs/` 保留为"随产品发布、agent 可读"的唯一文档根**，内部记录移出去。

```
yonder/
├─ README.md                 # 用户门面（英文，~130 行，见 §6）
├─ README.zh-CN.md           # 逐节对应，CI 校验标题一致
├─ CONTRIBUTING.md           # 开发者：布局/边界/检查/许可（补英文摘要）
├─ SECURITY.md               # 已具备，双语
├─ CODE_OF_CONDUCT.md        # 已具备
├─ CHANGELOG.md              # Keep a Changelog；Verification 段移到 verification/
├─ THIRD_PARTY_NOTICES.md    # 已具备
├─ AGENTS.md                 # agent 入口（9 条 → 改名后同步，保持 ≤15 行）
├─ LICENSE
├─ .github/                  # + CODEOWNERS、dependabot.yml、workflows/docs.yml
├─ docs/                     # ★ 随安装包发布，`yonder docs` 的根，agent 可读
│  ├─ index.md               # 唯一入口：按读者分流的表（必须覆盖 docs/ 下每个文件）
│  ├─ quickstart.md          # 新增：安装 → 首次对话 → 第一个 Bot（从 README 拆出）
│  ├─ architecture.md        # 内核主线 + 不变量 10 条（+ 网关/客户端层一行）
│  ├─ spec/01…21             # 契约；编号唯一；15=memory，21=clipboard-vault
│  ├─ plugins.md             # 官方插件清单（合并 spec/11，唯一来源）
│  ├─ plugin-dev.md          # 新增：写插件（spec/04 §3 + 现有 README 提炼）
│  ├─ sdk.md                 # 新增：SDK 作者接口（从 reference.md §3 拆出）
│  ├─ reference.md           # CLI / 斜杠命令 / 注册名参考
│  ├─ decisions.md           # D1..Dn，单序编号 + 取代标记
│  └─ prompts/               # 提示词分层 3 篇（删 v5-draft）
├─ verification/             # ← 从 docs/ 移出：验收记录 35 md + evidence/（不随 docs 暴露）
├─ research/                 # ← 从 docs/ 移出：6 篇调研（已落地的降级为历史）
├─ proposals/                # 提案：每个文件统一 5 行状态头（§5.3）
├─ brand/                    # 已具备
├─ packages/*/README.md      # 补 core、cli、sdk、macos、macos-helper
└─ plugins/*/README.md       # 补 channel-cli、channel-mcp、context-files
```

### 5.1 按读者分层

| 层 | 文件 | 谁写 | 读者 |
|---|---|---|---|
| 用户 | `README*`、`docs/quickstart.md`、`docs/plugins.md`、`docs/reference.md`、`CHANGELOG.md` | 产品维护者 | 普通用户、潜在贡献者 |
| 开发者 | `CONTRIBUTING.md`、`docs/architecture.md`、`docs/plugin-dev.md`、`docs/sdk.md`、`packages/*/README.md`、`plugins/*/README.md` | 各包作者 | 外部贡献者 |
| 维护者 | `docs/spec/*`、`docs/decisions.md`、`docs/status.md`、`verification/`、`research/`、`proposals/`、`SECURITY.md` | 维护者（需批准） | 维护者、审计 |
| agent | `AGENTS.md`、`CLAUDE.md`、`docs/index.md`、`docs/spec/*`、`skills/` | 维护者 | 仓库内运行的 agent |

### 5.2 必须长期维护的"wiki 型"文件与规则

| 文件 | 更新触发 | 规则 | 检查 |
|---|---|---|---|
| `docs/index.md` | 任何 `docs/` 文件增删 | 表必须覆盖 `docs/` 下每个 md；版本号与 `package.json` 一致 | CI 脚本比对 `readDocs` 列表 |
| `docs/spec/*` | 契约变更 | 编号唯一、只增不改号；被取代的条款**删除**而非追加（`AGENTS.md:7`）；改动须在 `decisions.md` 记一条 | 编号唯一性检查 |
| `docs/decisions.md` | 每个设计变更 | 单序编号；被取代标"已被 Dxx 取代"；无编号的日期条目一律编号或并入相邻条目 | 编号连续性检查 |
| `docs/plugins.md` | 插件增删/贡献变化 | 唯一来源；插件 README 只写实现细节；编号连续 | 编号连续性 + 与 `contributes` 抽样比对（手动，季度） |
| `README.md` / `README.zh-CN.md` | 对外能力变化 | 两版章节一一对应，英文优先 | CI 比对 `^##` 标题数量 |
| `CHANGELOG.md` | 每个版本 | Unreleased 必须存在；每版本 Added/Changed/Fixed；验收细节移 `verification/` | PR 模板已有条目 |
| `AGENTS.md` | 边界或基准变化 | ≤15 行，只写硬规则 | 人工 |

### 5.3 proposals 生命周期（补上缺失的状态机）

统一文件头 5 行：

```
状态：草案 | 提案（待批准） | 已批准 | 已落地（见 spec/NN） | 已被取代（见 …）
日期 / 批准人 / 落地位置 / 相关 D 条目
```

规则：`已落地` 的提案从 `proposals/` 移入 `research/`（作为决策依据）；`已被取代` 的移入 `proposals/archive/` 并在首行写明取代者；`docs/archive.md`（design §8.4 要求新增）记录废弃**方向**（仓库/分支/worktree），与 proposals 的"文档状态"分开。

## 6. 建议的 README 大纲

目标 ~130 行，英文为主、中文镜像逐节对应。与现状的差异标 `+`（新增）`~`（改写）。

```
[logo]  [CI badge] [latest release badge] [Apache-2.0 badge]        ← 5 行
# Yonder                                                          ← ~ 去掉 Harness
一句话：Yonder 是你的个人 Agent——任何消息都是事件，交给指定的 agent
和会话处理，结果回到原来的地方。                                      ← 3 行

## What you can do today          +（按 design §1.2 两条线：Bot 社交 / 工作台）
  - 在飞书、微信、QQ、GitHub、名片页和你的 agent 说话
  - 在一个应用里看所有 agent 的会话、任务和后台工作
  - 让它维护自己的运行环境（有 exec 时可用 yonder CLI 与 yonder docs）   ← 10 行

## Install                        ~（macOS 服务安装 + 平台状态如实标注）
  curl … | sh / npm i -g @yonder/cli；macOS 服务安装；
  Linux/Windows 标"契约已写、安装未验收"（对齐 docs/status.md）          ← 12 行

## First run                      +（yonder init → 管家 Bot → 第一个渠道）
## Everyday commands              ~（保留现有表格）
## How it works                   ~（事件→绑定→会话→运行→投递，一张 ASCII 图）
## Extend                         +（插件 / skill / 主题 / SDK 四条入口，
                                     链 docs/plugin-dev.md、docs/sdk.md）
## Security model                 ~（能力 + 级别一层；Keychain；不沙箱；链 SECURITY.md）
## Documentation                  ~（★ 改成按读者分流的表，见下）
## Project status                 +（Developer preview、当前版本、平台矩阵）
## Contributing                   ~（链 CONTRIBUTING.md、AGENTS.md、CODE_OF_CONDUCT.md）
## License and acknowledgements   ~（Apache-2.0 + THIRD_PARTY_NOTICES.md）
```

`## Documentation` 表（替代现在的 6 行 spec 列表）：

| 我想… | 看这里 |
|---|---|
| 装上并用起来 | `docs/quickstart.md` |
| 知道有哪些命令和插件 | `docs/reference.md`、`docs/plugins.md` |
| 写一个插件 | `docs/plugin-dev.md`、`docs/sdk.md`、`packages/sdk/README.md` |
| 理解内核怎么工作 | `docs/architecture.md`、`docs/spec/` |
| 知道为什么这样设计 | `docs/decisions.md` |
| 知道现在做到哪了 | `docs/status.md` |
| 让 agent 自己查文档 | `yonder docs --list`、`yonder docs <path>` |

## 7. 删除 / 归档 / 合并清单

| 对象 | 处理 | 理由 | 需批准 |
|---|---|---|---|
| `HANDOFF.md`（60 行，未跟踪） | **删除** | 内容全错（称"没有代码"）、引用已删的 `docs/tasks/`、私有仓、`~/.ai-being` 7 处；`git ls-files` 为空 | 否 |
| `docs/prompts/v5-draft.zh-CN.md`（141 行） | **删除**（或移 `proposals/archive/`） | 文件名即 draft，3 处断链，内容已被 `docs/prompts/README.md` + 插件内提示词取代 | 否 |
| `docs/verification/`（35 md + 7 JSON，532K+108K） | **移出** `docs/` → 仓库根 `verification/` | 内部验收记录不该被 `yonder docs --list` 暴露；含本机路径与进程快照 | 是（改 `docs/index.md` 属设计变更） |
| `docs/research/`（6 篇） | **移出** → 仓库根 `research/` | 同上；2 篇已落地的（D63、D57）降级为历史依据 | 是 |
| `docs/spec/11-official-plugins.md`（200 行） | **合并**进 `docs/plugins.md`，原文件删除或改为 3 行索引 | 两份同一批 23 个插件、编号都坏 | 是 |
| `docs/spec/15-clipboard-vault.md` | **改号** → `21-clipboard-vault.md`，改 4 处引用 | 与 15-memory 冲突；memory 引用面更大 | 是 |
| `docs/decisions.md` 的无编号日期条目（≥12 条） | **合并/编号**；置顶的 D57 归位到 D 序列 | 现顺序：D57 置顶、D55 在 158 行、D47 在 171 行；取代标记仅 4 处 | 是 |
| `docs/status.md` 第 1–6 行（W0–W5 发布记录 + 本机路径） | **移出**到 `verification/`，删除本机绝对路径 | 双 H1、路径泄漏 | 否（纯清理） |
| `proposals/unified-client/design-v1.md`（749 行） | **标"已被 `design.md` 取代"**并移 `proposals/archive/` | 两版并存无取代标记 | 否 |
| `proposals/*` 无状态头的 19 个文件 | **加 5 行状态头**（§5.3） | 无法判断哪些还有效 | 否 |
| 5 处断链（`CHANGELOG`→`RELEASE-LOCATION-READY.md`、`v5-draft`→`jarvis/*`×3、`native-automation`→`HANDOFF-LOCATION.md`、`skill-creator`→`references/*`×2） | **修复** | 见 §2.5.5 | 否 |
| `packages/{core,cli,sdk,macos,macos-helper}/README.md` | **新增** | 对照 pi 每包一份 | 否 |
| `plugins/{channel-cli,channel-mcp,context-files}/README.md` | **新增** | 3 个插件无任何文档 | 否 |
| `docs/archive.md` | **新增**（design §8.4 已给表结构） | 废弃方向索引 | 是 |

## 8. 落地顺序（与 design.md §11 阶段 0 对齐）

1. **零风险清理（不需批准）**：删 `HANDOFF.md`、删 `docs/prompts/v5-draft.zh-CN.md`、修 7 处断链、删 `docs/status.md` 第 1–6 行的本机路径、给 `docs/index.md` 补 `15-memory.md` 与版本号。
2. **加检查脚本（先有栅栏再搬东西）**：`scripts/check-docs.mjs`，0 依赖，四条断言——(a) 相对链接目标存在；(b) `docs/spec/*` 编号唯一；(c) `docs/index.md` 覆盖 `docs/` 下全部 md；(d) 禁用词表（`yonder-harness`、`Yonder Harness`、`AI-Being`、`Card Web`、`Yonder Net`、`轻客户端`）命中即失败。挂进 `npm run lint`（与现有 `scripts/check-file-size.mjs` 同一模式）。
3. **搬家（需维护者批准，一次提交）**：`docs/verification/` → `verification/`、`docs/research/` → `research/`，同步改所有引用。
4. **合并与重编号（需批准）**：`spec/11` 并入 `plugins.md`；`15-clipboard-vault` → `21`；`decisions.md` 编号归位；`proposals` 状态头。
5. **改名（design §11 阶段 2）**：文档批 + 代码批分开提交，按 §4 的三批走。
6. **README 重写 + 包 README 补齐 + `.github/CODEOWNERS`**：在改名之后做，避免写两遍。

## 9. 未核实

- `docs/reference.md:128-193`（"SDK 作者接口"）与 `packages/sdk/src/types.ts` 的逐条一致性——未逐条比对。
- `docs/plugins.md` 每个插件的工具清单与源码 `contributes` 的逐项差异——只抽查了 `memory`（用通配符掩盖，未发现明确错误），其余 22 个插件未核对。
- `CONTRIBUTING.md` 内容在 design §10 里标为"未读、未核实"，我读了结构与章节（仓库布局/改动前/边界/fork 同步/检查/许可），但"仓库改名后路径与分支命名规则需同步"的具体条目未逐句核。
- 公开仓库的 GitHub 元数据（`gh repo view`）：public、`hasWikiEnabled=true`（wiki 为空）、`hasDiscussionsEnabled=false`、`hasIssuesEnabled=true`、`isSecurityPolicyEnabled=true`、license apache-2.0、topics `[agent-runtime, ai-agent, plugins, typescript]`、0 star、最新 release `v0.2.26102701`（2026-10-27）。仓库描述仍是 "A resident agent kernel… Developer preview."，未含改名后的产品表述。
- 迁移到 `apps/app` 的 Card 前端文档量（`/Users/zoran/Documents/yonder-card-consolidate`）：除 `node_modules` 外 35 个 md、约 2.9k 行（`docs/` 15 篇、`DESIGN.md` 85、`server/PLAN.md` 131、`deploy/` 2 篇、`brand/BRIEF*.md` 3 篇、`artifacts/` 6 篇），需在阶段 4 单独做一次"哪些进 `apps/app/docs`、哪些进 `verification/`"的分诊——本轮未逐篇判定归属。