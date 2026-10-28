> 证据材料，结论已并入 [design.md](../design.md)

# Yonder Harness 架构审计（事实清单）

## 1. 插件模型（docs/）

来源：`docs/architecture.md`（73 行）、`docs/spec/04-plugins.md`（314 行）、`docs/plugins.md`（365 行）、`docs/spec/11-official-plugins.md`（200 行）。

**插件槽：9 个**（04-plugins.md §3）：`channels`、`tools`、`contexts`、`triggers`、`envs`、`hooks`、`presets`、`skills`、`permissions`（permissions 槽是文末追加章节，未并入"共九个"的正文计数——文档自身口径有一处不一致：§3 首句说"共九个"，但列举正文为 8 个槽 + 文末 permissions 门面）。

**加载器位置**：`packages/core/src/plugins/index.ts:115` `export async function loadPlugins(home, config, services)`。流程：读清单 → 校验 apiVersion → dynamic import entry（:141 附近 `await import(pathToFileURL(...))`）→ configSchema 校验 → setup 注册（`settingUp` 标志阻止 setup 外注册，:150-157）→ 声明与注册比对（`checkRegistrations`，来自 `@yonder/sdk/testing`）→ 启动实例。贡献冲突用 `claim(slot,name,pluginId)` 拒绝重名（:131）。

**清单格式**：写在插件 `package.json` 的 `yonder` 字段（04 §2）：`apiVersion`（当前 1）、`id`（`[a-z][a-z0-9-]*`）、`entry`、`contributes`（槽名→名单）。

**配置**：插件配置在 `yonder.yaml` 的插件条目 `config` 段，按 `configSchema`（TypeBox）校验；渠道/env 实例配置剥离 `type` 后校验再传 `create(id, config)`；密钥写凭据名，经 `api.credentials.get` 读取（04 §3.1）。

**隔离**：明确**没有**进程隔离/沙箱："不提供任意插件代码的进程隔离保证"（04 §3）、"不建立插件进程沙箱，也不承诺任意插件程序错误已获得进程隔离"（11 §1）。约束仅为：只依赖 `@yonder/sdk`、禁止 import pi 包、禁止直接开 SQLite 表、setup 无副作用契约。

**热重载**：**没有代码热重载**。04 §5："插件代码不热重载。插件配置变更需要重启；`agent.yaml`、`presets/` 热重载"。架构不变量 9（architecture.md:52）："配置可热重载，代码不热重载"。

**插件能否贡献 UI / HTTP 路由 / 网页**：**没有对应的插件槽**。SDK 槽表中无 UI/HTTP 槽。但事实上有插件自行起回环 HTTP 服务：
- `channel-mcp`：loopback `/mcp` Streamable HTTP/SSE（plugins.md §04）。
- `ui-companion`：127.0.0.1 随机端口 + 随机路径的网页卡片服务（plugins.md "ui-companion" 节；`plugins/ui-companion/src/service.ts` 有 `createServer`）。
- `tasks`：`plugins/tasks/src/service.ts` 也有 `createServer`（看板/服务页，docs/spec/17-task-ledger.md 配套）。
- macOS 非激活 NSPanel 等原生 UI 由主仓库状态栏宿主承载，插件只发布 `desktop.json`（plugins.md ui-companion 节）。

即：UI/HTTP 都是插件自己实现的自定义 trigger + 服务，不是内核契约能力。

## 2. 包清单（LOC 排除 dist/node_modules/.build，仅 .ts）

### packages/

| 包 | LOC | 外部依赖（package.json dependencies） | 内部依赖 | 说明 |
|---|---|---|---|---|
| `@yonder/core` | 26,470 | @earendil-works/chord, pi-ai, pi-durable, yaml, typebox, proper-lockfile | sdk | 内核：事件/绑定/会话/插件加载/投递/release/runtime |
| `@yonder/cli` | 3,280 | pi-coding-agent, pi-tui | core, sdk | CLI/TUI 客户端 |
| `@yonder/pi-durable` | 25,665 | chord, pi-ai, pi-codemode, photon, diff, typebox | — | vendored pi 会话/任务/文档运行时（`check-file-size.mjs:9` 明确豁免其文件大小规范，"第三方 vendored 源码"） |
| `@yonder/sdk` | 1,152 | pi-ai, pi-durable, typebox, yaml | execution-protocol | 插件 API 类型 + testing 契约 |
| `@yonder/executor` | 2,946 | typebox, ws | execution-protocol | 远程/设备执行端 |
| `@yonder/execution-protocol` | 484 | typebox | — | 多设备执行契约 W0 schema（proposals/multidevice/W0-handoff.md 引用） |
| `packages/macos` | 974 行 Swift（Companion 534 / YonderStatus 310 / PowerHelper 130） | — | — | 状态栏/桌面宿主 |
| `packages/macos-helper` | 7,584 行 Swift 总计（ServiceHost 572、YonderHelper 330 等，含 Tests/patches） | SwiftPM | — | 权限 Helper |

### plugins/（23 个）

| 插件 | LOC | 外部依赖 | 贡献（清单 yonder.contributes） |
|---|---|---|---|
| memory | 3,787 | typebox, yaml, luxon, write-file-atomic, chokidar, proper-lockfile, gpt-tokenizer | 9 工具、2 触发器、1 预设、2 上下文、6 skills |
| channel-feishu | 4,788 | @larksuiteoapi/node-sdk, typebox | 渠道 feishu、5 工具、1 上下文 |
| tasks | 2,480 | @resvg/resvg-js, sdk | 7 工具、1 上下文、2 触发器、1 hook |
| devices | 2,197 | typebox, ws | 9 工具、1 skill、1 触发器 |
| clipboard | 1,692 | sdk | 5 工具、1 hook |
| native-automation | 1,649 | playwright-core, typebox | 2 工具、1 触发器、1 permissions provider |
| browser-skill | 1,608 | typebox | 9 工具、1 skill、1 触发器 |
| channel-github | 1,952 | typebox | 渠道 github、9 工具、1 上下文 |
| ui-companion | 1,352 | typebox | 2 工具、1 触发器 |
| channel-qq | 1,149 | @tencent-connect/qqbot-nodejs, qqbot-connector, proper-lockfile, yaml | 渠道 qq、1 工具 |
| channel-wechat-ilink | 1,118 | silk-wasm, typebox | 渠道 wechat-ilink、3 工具 |
| channel-card | 1,088 | typebox, ws | 渠道 card、1 工具 |
| cron | 1,017 | cron-parser, typebox | 2 工具、1 触发器 |
| wechat-archive | 641 | typebox | 7 工具、1 触发器 |
| hermes-experience | 1,723（.ts+.mjs） | yaml | 8 工具、3 上下文、1 skill、2 预设、1 hook、1 触发器 |
| mcp-client | 512 | @modelcontextprotocol/sdk, typebox | 2 工具、1 上下文、1 触发器 |
| codex-tools | 746 | typebox | 4 工具、1 触发器 |
| web-tools | 359 | @mozilla/readability, linkedom, turndown, typebox | 3 工具 |
| channel-mcp | 366 | @modelcontextprotocol/sdk, typebox, zod | 渠道 mcp（另有 18 个 `server.registerTool` 外部控制接口，非模型工具，见 `plugins/channel-mcp/src/operations.ts:50,156`） |
| media-tools | 255 | typebox | 2 工具 |
| channel-cli | 230 | sdk | 渠道 cli |
| context-files | 28 | sdk | 4 上下文 |
| agent-presets | 54 | sdk | 7 上下文、5 预设 |

注：docs/plugins.md 与实际清单存在漂移——例如 plugins.md §tasks 只列 5 工具，实际 7 个（多了 `tasks_nudge`、`tasks_show`）；§memory 列 `memory_*` 未逐一与 9 个实现对齐；channel-feishu 实际工具含 `channel-feishu_task_card` 在文档中列出但 contributes 顺序不同；channel-mcp 的 18 个 MCP server 工具不在 package.json contributes 中（属协议能力，文档有意区分）。

## 3. packages/core/src 模块地图

| 子目录 | LOC | 职责（据文件名/内容） |
|---|---|---|
| runtime/ | 9,970（72 文件，32 个测试） | pi 适配层：模型链/配额/凭据/执行环境/进程/恢复/转录/权限上下文 |
| kernel/ | 4,134 | 事件分发、绑定、home 管理、终端、peer、管理命令 |
| release/ | 1,514 | 版本、发布检查、服务启停、launcher |
| prompt/ | 1,412 | 系统提示词组装 |
| tools/ | 1,362 | 内置工具（message_send、task_run、session_*、identity_*、grep） |
| delivery/ | 1,340 | 投递 |
| retention/ | 1,021 | 保留策略 |
| config/ | 941 | yonder.yaml/agent.yaml 解析 |
| routing/ | 940 | 绑定路由 |
| plugins/ | 936 | 插件加载器 |
| store/ | 582 | 事件存储 |
| skills/ | 513 | skill 发现索引 |
| sessions/ | 622 | 会话 |
| signals/ | 446 | 信号 |
| control/ | 248 | 控制 |
| status/ | 298 | 状态 |
| 根 | 191 | index.ts、permissions.ts |

**超 400 行源文件**（测试除外）：
- `runtime/index.ts` 1,899（基线备注："待拆分：Runtime 上帝对象"）
- `release/index.ts` 938
- `delivery/index.ts` 659
- `kernel/index.ts` 614
- `tools/index.ts` 524
- `sessions/index.ts` 493
- `store/index.ts` 442
- `plugins/index.ts` 428
（含测试超 400 的还有 delivery.test.ts 454、recovery.test.ts 419）

文件大小治理：`scripts/check-file-size.mjs` 强制 500 行上限，`scripts/file-size-baseline.json` 登记例外（首条即 runtime/index.ts 1,952 行 "待拆分"）。

## 4. docs/ 与 proposals/

**docs/ 行数**（前 15）：plugins.md 365、spec/15-memory.md 333、decisions.md 328、status.md 324、spec/04-plugins.md 314、spec/03-agents.md 243、spec/02-sessions.md 221、reference.md 215、spec/11-official-plugins.md 200、spec/12-terminal-interaction.md 152、spec/09-cli-release.md 149、spec/01-events.md 146、prompts/v5-draft.zh-CN.md 141、spec/07-runtime.md 130、spec/14-execution-capabilities.md 128。spec 共 18 号（15 号有两个文件：`15-memory.md` 与 `15-clipboard-vault.md`，编号冲突）。另有 research/（6 篇）、verification/（38 个文件，含 10 个 release-*.md）、prompts/（4 篇）。

**decisions.md**：42 条 `## ` 条目（编号到 D67，中间跳号且混入无编号条目）。最近 10 条标题：
1. D66 统一任务账本作为官方插件 tasks（2026-10-25）
2. D67 插件可向打开的常驻会话投递系统提醒（2026-10-25）
3. 2026-10-25 渠道实例最小作用域
4. 2026-10-25 Agent 运行概览与固定悬浮入口
5. 2026-10-25 共享权限 API 与薄服务宿主解耦
6. 2026-10-26 Agent 云端头像
7. 2026-10-26 多设备执行 W0
8. 2026-10-27 T63 模型账户选择配置
9. 2026-10-27 模型账号回退与冷却
10. 2026-10-27 官方用量窗口与按槽停用线（另有同日"官方用量主动轮询""转换的 Codex 凭据自动刷新"，实际最近 12 条均为 10-25 至 10-27）

**proposals/**（12 项，均为"提案/待评审"状态，无已采纳标记；采纳路径按 task-ledger/design.md 自述："采纳后……在 docs/decisions.md 记一条"）：

| 提案 | 状态（文件自述） |
|---|---|
| local-model-gateway.md | "提案，供维护者评审"，且 git 状态显示**未跟踪**（??） |
| workbuddy-hub-integration.md | "提案，供维护者评审"，未跟踪（??） |
| task-ledger/design.md | "提案，待维护者批准"——但 D66（2026-10-25）已采纳 tasks 插件，提案文件状态未更新，**文档过时** |
| multidevice/W0 | W0 已由 D66 同日"多设备执行 W0（父会话准入裁定）"采纳，18 号 spec 存在 |
| goal-mechanism、context-keeper | design.md，无状态头标注已采纳；未在 decisions.md 中见对应采纳条 |
| memory/ | g0-report、hardening-report 等过程文档 |
| runtime-efficiency/ | README + checklist |
| task-awake/、unified-client/ | 未在 decisions.md 见采纳记录 |

## 5. 架构问题事实

**a) 同一能力多处实现**
- **文件锁**：`proper-lockfile` 同时是 core（runtime/credentials.ts、release/result.ts、kernel/home-management.ts、kernel/management.ts、kernel/index.ts）与插件（memory/store.ts、channel-qq/setup.ts）的直接依赖——SDK 未提供共享封装。
- **回环 HTTP/WS 服务**：至少 6 处各自 `createServer`/WS（channel-cli、channel-mcp、tasks/src/service.ts、ui-companion/src/service.ts、executor/executor.ts、core/control/index.ts），无共享 loopback 基建。
- **文档计数漂移**：04 §3 "共九个槽" vs 文末 permissions 章节；plugins.md 各节工具清单与 package.json contributes 不完全一致（tasks、memory 等）。
- **spec 编号冲突**：15-memory 与 15-clipboard-vault 共用 15 号。

**b) 平台代码（Swift）**：`packages/macos/`（974 行，Companion.swift 534、YonderStatus.swift 310、PowerHelper.swift 130）与 `packages/macos-helper/`（SwiftPM 包，总计 7,584 行，ServiceHost.swift 572、YonderHelper.swift 330，含 Tests 与 patches）。构建经 `scripts/build-macos.mjs` 接入根 build。

**c) 构建脚本复杂度**
- `scripts/` 35 个脚本 + fixtures，共 4,479 行；其中 10 个 `test-service-host*.mjs`（Node 自写测试框架），另有 Python 脚本 2 个、shell 1 个。
- 根 `build` 链：`check-pi-ai-bundle.mjs && tsc -b && plugins/devices/build.mjs && scripts/build-macos.mjs && plugins/ui-companion/build.mjs`——单一 build 内联 5 步、含插件目录专属构建与 Swift 构建。
- 测试命令分叉：`test`（vitest）与 `test:node`（node --test，仅 scripts/export-model-observations.test.mjs）。

**d) 测试分布**（.test.ts，排除 dist）：core/runtime 32、core/kernel 16、memory 12、channel-feishu 8、cli 6、tasks 6、ui-companion 5、native-automation 5、clipboard 5、channel-github 4、executor 4、core/tools 4、core/release 4、core/prompt 4、core/config 4、根 tests/ 3（device-cli-plugin 396 行、wechat-ilink-diagnostics、wechat）。core 其余子目录（delivery、routing、retention、store、plugins、sessions、skills、signals、control、status）各 ≤4 或无。scripts 有 1 个 node --test 文件。veriication/ 下另有大量 markdown 验收记录（38 个文件），测试事实与验收记录双轨并存。

**e) 未跟踪/备份文件**（git status）
- 备份文件：`packages/core/src/runtime/model-chain.ts.bak-order-20261027`（未跟踪），及 `packages/core/dist/runtime/model-chain.js.bak-order-20261027`；同域 `model-chain.ts`、`model-chain.test.ts`、`model-watch.ts` 有未提交修改。
- 未跟踪目录：`.codegraph/`；未跟踪文件：`proposals/workbuddy-hub-integration.md`。
- 已修改未提交：`.workbuddy-ai/memory/2026-10-27.md`、model-chain 相关 3 文件、`proposals/local-model-gateway.md`。
- HEAD：`0211948 chore(release): 0.2.26102705`。