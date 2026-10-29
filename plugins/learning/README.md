# learning

可选的官方 SDK 插件 `@yonder/plugin-learning`。在明确授权的 Agent/profile scope 内，提供精选记忆、静默会话后复盘、私有原生技能及支持文件、pending 管理和显式 `/refine` 工具。它是 Hermes 体验的 Yonder-native 适配，不是 Nous Research 官方发行，不运行 Python 或第二套模型循环。

## 安装与迁移

主仓库 `npm ci && npm run build` 会构建本 workspace；发行安装器从 tag 构建时也包含它。`yonder plugins add @yonder/plugin-learning` 可发现包，未配置 scope 时不授予任何 Agent 记忆访问。插件安装不等于 profile 选入。

本包由 `@yonder/plugin-hermes-experience` 改名而来（设计见 `proposals/unified-client/design.md` §2.4、§3.2）。旧包现为弃用别名：它以旧 id `hermes-experience`、旧工具名 `hermes-experience_*` 再导出本插件并在加载时记一条 warn，所以未改动的 `yonder.yaml` 仍可加载。不要同时加载新旧两个包（contexts/presets/skill id 相同，会报 contribution conflict）。

从旧包切到本包时，在 `yonder.yaml` 原有插件项中把 `use` 改为 `@yonder/plugin-learning`，保留 `config.enabled` 和每项 `config.scopes`（`agent`、`profiles`、绝对 `memoryDir`、`skillDir`、`learning`、`memory`、`user`、`writeMode`）不变。插件 id 是用户数据键，下列项随之变化，需手工或待 `yonder migrate`（§3.4）处理：

- profile 的 `plugins` 里 `hermes-experience` 改为 `learning`；`tools.offer` 里 `hermes-experience_*` 改为 `learning_*`。
- counters/dedup 从 `<home>/.yonder/plugins/hermes-experience/learning-state.json` 变为 `<home>/.yonder/plugins/learning/learning-state.json`；不搬运时计数从零开始，不影响记忆和技能本身。
- 不变：上下文 `hermes-memory`/`hermes-core`/`hermes-behavior`、技能 `hermes-yonder` 与 `hermes-learned-*`、preset `hermes-study`/`hermes-learning-review`、memoryDir 下 `MEMORY.md`/`USER.md`/`.hermes-pending`、skills 同级 `.hermes-skill-archive`。旧包保存的技能 provenance owner `hermes-experience` 仍被视为本插件所有，可继续编辑与归档。

- `memoryDir` 仍为原授权的现有目录；没有复制、导入或移动。
- `skillDir` 如配置，必须为 memoryDir 的同级 `skills`，并与该 resident 原生 workspace/skills 对齐；只写 `hermes-learned-*` 私有技能。
- 默认 readonly；只有明确 `writeMode: exclusive-yonder` 才允许写记忆，不兼容 Hermes Python 同时并写。
- 代码按 Harness 原生更新/服务生命周期生效；不自动重写现有 Agent/profile、记忆、技能或 credentials。

首次选择时，在目标 profile 选入插件 `learning`、上下文 `hermes-memory`/`hermes-core`（`hermes-behavior` 可选）以及技能 `hermes-yonder`；学习 scope 配 `learning: true` 和对齐的 skillDir，并选入原生 `hermes-learned-*`。`dist/recipe.mjs`（包子路径 `@yonder/plugin-learning/recipe`）提供显式安装准备所用的 `runtimeProfile`/`registration`，不会自己应用配置或生成居民身份。配置值由实际 Agent 与现有路径决定，本包不携带用户数据或示例人设。

与 `plugins/memory`（spec 15）的边界：memory 负责事件驱动的记忆整理；本插件负责会话后复盘、私有技能与 pending 提案。

## 工具与后台权限

前台工具是 `learning_memory_read`、`memory_edit`、`skill_store`、`memory_pending`、`refine`（各名均有 `learning_` 前缀）。只向目标 profile offer 所需的这些工具及原生 `skill_view`，不要把内部 review 工具 offer 给 resident。

内部 `learning_review_memory_read`、`review_memory_edit`、`review_skill_store` 仅供插件自己创建且仍持有效 grant 的无身份 `hermes-learning-review` task；直接打开该 preset 不会获权。复盘固定 Sol/high、read/write、专用三个工具，无 shell、通用文件写入、消息或派发能力。`hermes-study` 是单独只读学习 preset。

真实用户输入每 10 turn 到期记忆复盘；每个符合条件且完成的授权前台用户回合触发技能复盘，等待前台安静 15 秒。前台抢占先撤 grant 再取消。自动新增记忆直接保存，破坏性修改静默进入 pending；前台及可信显式 `/refine` 不加这层等待。新技能由 Harness 原生索引发现，通过 `skill_view` 按需读取正文和支持文件，没有第二套 scanner。完整 API、取消/去重/重启语义及差异见 [Learning runtime](docs/learning-runtime.md)、[Learning store API](docs/learning-store-api.md) 和实际教学技能。

完整停用应从目标 profile 移除插件、相关 contexts 和 skills 选择；`enabled: false` 拒绝插件 I/O，但不会替你移除原生独立选择的技能或历史转录。

可选 `config.review.toolCallThreshold`（正整数，默认 8）：前台用户回合累计的工具调用数达到该值才排队一次静默技能复盘，记忆复盘仍按 10 次用户输入。

## 构建、回归、受控原生验收

```sh
npm ci
npm run build
npm run typecheck
npm test -- plugins/learning --maxWorkers=1
npm run lint
node plugins/learning/scripts/accept-learning-controlled.mjs
npm pack --workspace @yonder/plugin-learning --ignore-scripts
```

JS 模块由 TypeScript project reference（allowJs、不机械改写实现）真实输出到 `dist/*.mjs` 与 `.d.mts`；manifest、exports、打包 files 与原生 loader 共同指向构建产物。assets、教学 skill、NOTICE 和文档都在包内。

`test/*.test.mjs` 是 Vitest 原生发现的回归：原外部 57 项中的 52 项 experience 存储/学习/注册测试完整迁入（改名时随 `plugins/hermes-experience/test` 一并迁到本目录，用例未减少）；workspace metadata 1 项、独立库 provision 3 项不属于本插件，未带入；旧独立库 peer/version 1 项被官方 manifest/version/asset 契约替代。测试数据使用隔离 tmpdir，不访问正式 scope。

受控脚本启动真实 `openKernel`，以测试专用本地 HTTP 协议 fixture 驱动 10 次用户输入→自动静默复盘→实际 memory/skill/support 文件→**同一个 kernel** 新会话原生发现/读取/使用，并检查普通 child 无授权请求与 16 请求硬上限。它只验证协议/权限/产物，不宣称真实 Sol 判断。默认按官方 npm 包名加载；`YONDER_TEST_HERMES_PLUGIN` 可指向解包的发行 artifact 作同样验收。保留实际 evidence/result.json 与失败结果，不拿外部旧 evidence 冒充本次结果。

`/refine` 的渠道 slash 路由由 core 的单独变更处理，本插件不绕过 trusted attended 条件。此分支未修改 core/routing；主渠道及正式模型/安装验收由整合发布者完成。

## 来源与许可

迁入源 experience 0.1.1：`cf40886c8160f16a42698fb8bfd22327ad87aac6`。Hermes 学习策略精确 source pin：`4dcef215cfe41bd2d02c2d1dad6e257a18101216`；较早行为段落 pin：`0eb4f62a8b35ff3b0454a8dbdbd3a7b55a6849b0`。上游 MIT 正文保留于 [Hermes-MIT.txt](assets/Hermes-MIT.txt)，符号及适配说明见 [NOTICE](NOTICE) 与 [SOURCES.md](assets/SOURCES.md)。本仓库新增适配贡献沿用 Apache-2.0。没有引入 workspace 审计插件、外部 repo root、fixtures、备份、.dev 或 credentials。
