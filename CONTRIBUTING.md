# 参与开发

先读 [docs/index.md](docs/index.md) 和 [docs/architecture.md](docs/architecture.md)。规范在 [docs/spec/](docs/spec/)，是代码的目标：代码与文档不一致时以文档为准；要改设计，先改文档，并在 [docs/decisions.md](docs/decisions.md) 记一条，删掉过时内容而不是追加。当前实现状态与已知缺口见 [docs/status.md](docs/status.md)。

*English summary: read `docs/index.md` and `docs/architecture.md` first; the spec in `docs/spec/` is the target. Run `npm run build && npm run typecheck && npm test && npm run lint` before sending changes. Tests that need a model use a real model, never a mock; without credentials they are skipped and reported as "not tested".*

## 仓库布局

```
packages/
  pi-durable/            MIT fork 的 durable 源码（构建先于 SDK/core）
  sdk/      @yonder/sdk    插件 API 类型、define* 辅助函数、testing/checkPlugin
  bot-definition/ @yonder/bot-definition  宿主无关的 Bot schema、解析与配置求值
  bot-core/ @yonder/bot-core  共享 createBot、路由/会话/投递/提示词/插件注册
  runtime-adapter/ @yonder/runtime-adapter  唯一 pi 运行实现，默认纯入口与 node/postgres 子路径
  local-host/ @yonder/local-host  本机启动、存储/环境、插件解析、控制与管理
  cloud-host/ @yonder/cloud-host  PG 来源/插件存储、统一调度与单进程云端 worker
  cli/      @yonder/cli    yonder 命令与终端界面
  macos/                   macOS 状态栏
plugins/                   官方插件，每个是独立 npm workspace 包，只依赖 @yonder/sdk
skills/                    随发行内置的 skill
```

工具链：Node ≥ 22.19、TypeScript、npm workspaces、vitest、Biome。

## 改动前

1. 任何独立代码仓库，所有改动都直接在主分支上进行，不迁出分支，不建 worktree 或独立环境。同一目录允许 10 到 30 个 Agent 并行，内容大致不重叠即可；重叠时改不同的行，或等 5 到 10 秒再改，顺带提交别人的改动也可以。只有两种情况需要独立环境：特定版本发版时为该版本建发版环境；一批任务完成后，主 Agent 安排检出当时的 commit 做验证，同时开始下一批。主 Agent 不写代码、不改代码文件，只改提示词、规约和文档，落地执行全部交给子 Agent。 只改本次改动涉及的路径；规范没写的行为、命令、字段、配置项不要发明。遇到规范空白或矛盾，记录问题，由维护者决定，不自行补设计。
2. 能复用现有代码、pi、标准库或已装依赖就直接复用。新依赖精确锁版本。
3. 一个逻辑改动一个提交。对外可见的变化记在 `CHANGELOG.md` 顶部的 `## [Unreleased]`。

## 边界（违反即为缺陷）

- 架构不变量见 [docs/architecture.md](docs/architecture.md) 第 5 节，任何时候都不能违反。
- pi 的模型/会话运行包只能在唯一 `packages/runtime-adapter/` 包里 import（默认纯入口与显式 node/postgres 宿主子路径由层级检查单源限定）；`@yonder/sdk` 只能 `import type`（现有 `executionContext(signal)` 的纯取消上下文辅助例外：仅 SDK index 可从 `@earendil-works/chord/context` 导入 `BACKGROUND_CONTEXT`、`withAbortSignal`，不涉及模型/会话运行）。插件只依赖 `@yonder/sdk`，不 import core、pi 或兄弟插件的内部代码。
- `packages/bot-core/src` 按 [architecture §6](docs/architecture.md#6-内核分层与规模预算) 分层，只能依赖本层或更低层（含 `import type`），由 `scripts/check-layers.mjs` 检查；单文件不超过 500 行，由 `scripts/check-file-size.mjs` 检查。两者都在 `npm run lint` 里，基线只减不增。
- `packages/cli/` 可以使用 pi-tui 及 coding-agent 的 UI/主题/键位导出，或按许可提取的界面模块；不得接入 coding-agent 的第二套运行或存储系统，不得自行重设计布局和交互（见 [spec/12](docs/spec/12-terminal-interaction.md)）。
- 不写模拟模型、假数据、示例人设、占位功能。
- 修改 `docs/spec/`、`docs/architecture.md`、`docs/decisions.md` 与 `AGENTS.md` 属于设计变更，需要维护者审核。
- `dist/` 不进仓库（`.gitignore`），`tsc -b` 又是增量的：被中断的构建、手工改过的产物都不会被自动修回来，CLI 随后会加载与源码不一致的 dist（BE-11：`doctor` 报 `does not provide an export named …`）。`npm run build` 走 `scripts/build-tsc.mjs`：`tsc -b` 之后核对产物，把不一致的工程（产物比源码新但内容陈旧、缺模块、缺导出）删掉重建一次，仍不一致才报错；报错时执行 `npm run build:clean`。`npm run check:dist` 可单独复核，不要用旧 dist 冒充本次源码。

## 同步 pi-durable fork

仅 `packages/durable` 内化，来源 [GoYonderTogether/pi 的 yonder/1.3](https://github.com/GoYonderTogether/pi/tree/yonder/1.3/packages/durable)，基于上游 v1.3.0。先在 fork 修改 TypeScript、运行相关上游测试并提交，再在本仓库执行：

```sh
agent-network run -- node scripts/sync-pi-durable.mjs
# 可用完整 40 位 commit 固定重放（不接受缩写 SHA）
agent-network run -- node scripts/sync-pi-durable.mjs <full-commit>
npm install --package-lock-only --ignore-scripts
npm ci && npm run build && npm test
```

本地未 push 的 fork 提交可用 `YONDER_PI_SOURCE=/absolute/fork-checkout node scripts/sync-pi-durable.mjs <完整40位commit>`；脚本核对 checkout 的 origin 是上述 fork 并 fetch 精确已提交对象，仍生成相同 repository/commit provenance，不读取未提交文件。这不代表该 SHA 已在远端发布。

同步前先取当前 `FORK_SOURCE.json` 记录的 commit，逐文件核对现有 `src`；内容、文件集合不同或无法核对时，脚本在删除任何目标文件之前拒绝同步，不提供强制覆盖。核对通过才替换 `packages/pi-durable` 的 src、README、CHANGELOG、FORK、MIT LICENSE，`FORK_SOURCE.json` 记录精确来源。除下述明确任务例外外，不直接修改 vendored 源码。脚本仅转换 workspace 构建元数据：使用根 TypeScript 工具、保留上游编译语义、移除未复制的 benchmark/test 脚本与开发依赖；chord、codemode 等未改依赖继续取 npm，导出路径不变。pi-ai 必须接同一 fork 提交的完整编译 tarball，按下节收进源码发行；不允许新 durable 配旧 npm ai。第三方源码保留上游格式，由 fork 的 Biome 与测试检查；本仓库 Biome 排除该目录。上游测试和大型 fixtures 留在 fork，不复制到本仓库；构建不需要它们。同步后更新 THIRD_PARTY_NOTICES 的 commit 并按影响执行真实模型检查。没有 postinstall 补丁，干净安装不依赖本地 fork checkout。

当前来源已完成overlay归源：旧基础5414b87上的14个anchor工具改动先迁回fork提交 `4e37df84c2929fb46e86b58d7b18a189bf8825d9`，Harness现存93个src文件逐字节核对为0差异后推进基准；随后沿原保护脚本同步来源分组提交 `ec1b66ed370b7d1fa707f49def9127fe2b0df1c2`。durable源码与pi-ai artifact均记录这一完整commit，原anchor功能与断言已迁回fork；对应core消费者测试保留在Harness。今后仍先比较当前记录commit与现存src，禁止强制覆盖、删除保护或直接改vendor。`check-pi-ai-bundle.mjs`核对两个包的commit、唯一resolution和artifact integrity；源逐字节核对仍由同步guard负责。

### 本次共享Bot任务的受控program ToolTask例外

维护者2026-11-02 BRIEF §2.3明确允许修改本仓自有pi-durable，且本轮只允许两个指定worktree，禁止push/访问原checkout。阶段11可直接在packages/pi-durable/src为现ToolTask增加受控program根调用：复用原schema、hooks、durable intent、输出和replay，不合成assistant/user entry或nested parent，不另起运行循环。另允许Harness的Agent解析回调在await beforeAgent完成后读取当时registry.snapshot，供本轮真实动态工具进入首次Agent目录；phase任务定义/执行调度仍保原快照，adapter继续按本run冻结名单/目标/权限求交。环境回调另可接收可选的真实invocation taskId，由scheduler经buildEnv传递，供program在beforeTool前选择该task权限/环境快照；普通conversation级调用不带taskId仍兼容。Generation现有beforeRequest返回值可另带toolsRemoved:string[]，仅为本次provider请求累积删除既有Agent工具，不可增加工具/权限；未提供时原行为不变。只改上述入口、Agent解析、task身份传递与请求工具删除所必需的源码/导出/版本迁移；不改pi-ai artifact、来源base commit、同步/安装/发布脚本或降低保护。

实际文件与验证写入packages/pi-durable/FORK.md及本次verification，明确它是本仓新增overlay而非上游已提交快照。原anchor overlay保留，未来同步保护仍须因未合入fork的差异拒绝覆盖；之后由维护者另行迁回fork，不在本任务访问第三仓或push。

## 打包匹配的 pi-ai fork

Harness 正式发行走 Git tag clone → npm ci → build（见 core release/index.ts）。因此将 pi-ai 编译 tarball 与精确来源、MIT 许可证一并提交到 `third_party/pi-ai/`，无需新 npm scope 或 registry 权限。包仍为其真实上游衍生版本 1.3.0；fork 身份由源码 commit、tarball hash 和 lock integrity 区分，不冒充上游新发行。

在干净 pi fork checkout（HEAD 必须与 durable 的 FORK_SOURCE 相同）中执行 `npm ci --ignore-scripts`；准备受支持 model data 后执行：

```sh
node scripts/pack-packages.mjs --out /absolute/artifacts --offline-model-data
```

这会 clean/build 所有公开包后生成 coherent artifact set。不要用旧 dist 冒充本次源码。再到 Harness：

```sh
node scripts/bundle-pi-ai.mjs /absolute/artifacts/manifest.json
npm install --package-lock-only --ignore-scripts
npm ci --ignore-scripts
node scripts/check-pi-ai-bundle.mjs
node node_modules/typescript/bin/tsc -b packages/pi-durable packages/sdk packages/runtime-adapter packages/bot-core packages/local-host packages/cli --force
```

打包脚本要求 clean、精确同源的 artifact manifest。根 direct dependency 用仓库内相对 tarball 路径，并以 npm `$` override 统一直接/传递依赖；不要把 `/tmp` 或外部 checkout 写入依赖。构建前 guard 检查唯一 ai resolution 与同源 hash。新 tarball、provenance、MIT LICENSE、根 package.json 与 package-lock 必须一起提交。正式 tag 的干净 clone 无需 pi checkout 或本地 artifact 目录；重建 tarball 才需要 fork 构建输入。

## 检查与测试

```sh
npm ci
npm run build && npm run typecheck && npm test && npm run lint
```

默认测试不调用模型。需要模型的用例用真实模型 `openai/gpt-6-luna`，显式启用：

```sh
YONDER_TEST_REAL=1 npm test
```

凭据路径取环境变量 `YONDER_TEST_AUTH`，默认 `<仓库>/.yonder/auth.json`（已被 `.gitignore` 忽略）。凭据只由受信任的运行程序读取，不打印内容。OAuth 每个 home 独立登录，禁止复制其他程序的 OAuth。缺凭据时用例被跳过：记为“未测：缺少凭据”，不要伪装通过。

结果记录要写清楚原始计数（通过/失败/跳过）、失败原因和未测项，不用最新的成功覆盖已发生的失败。

## 许可

Apache-2.0。移植第三方代码时保留来源与许可记录（见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) 和各插件的 NOTICE）。

参与即表示同意遵守 [行为准则](CODE_OF_CONDUCT.md) · By participating you agree to the [Code of Conduct](CODE_OF_CONDUCT.md)。
