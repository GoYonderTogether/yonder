I'll start by exploring the local checkout and fetching the upstream tags.# B2 · pi 上游 v1.4.0 调研（Yonder fork `yonder/1.3` 视角）

调研基线：`/Users/zoran/Documents/github/yonder-pi`，已 fetch 上游 tag `v1.3.0`(71023aec1)、`v1.4.0`(4a080252f)。fork 侧被 harness 引入的提交是 `45014f2a2`（`packages/pi-durable/FORK_SOURCE.json`），不是本地陈旧分支 `yonder/1.3`(eca1f259b)。

## 0 结论

- 上游 v1.4.0 是 **durable 的重大重构版**（+7207/−1318，95 文件），核心是「durable sleep」取代 `TaskRuntime.sleep()`、`defineDoc` 强制 `checkpointWhen`、telemetry 落地、`afterFailedRun`、`Harness.wake()`。这三项直接命中 Yonder fork 的重试/恢复路径。
- 导出面 **只增不删**（`packages/*/src/index.ts` 全部为新增），但类型层有真 breaking。唯一被删除的模块是 `packages/ai/src/utils/pi-user-agent.ts`（`getPiUserAgent()`）。
- 干合并 15 个文件冲突，集中在 `packages/durable/src/harness/{generation,scheduler,harness,types,compaction,inbox,submissions}.ts` 与 `packages/ai` 的 4 个 provider 文件。最硬的是 `generation.ts`（10 处冲突）。
- Fork 的 9 项改动中，**0 项被上游等价实现**；`backgroundAtTokens` 与 `afterFailedRun`/`modelOverrides` 语义相邻但不重叠。真正可缩小 fork 的是 T61 observation（可迁到上游 telemetry）与 `resolveModels`（可对齐上游 `models: Models | (() => Models)`）。
- 升级成本主要不在 pi 本身，而在 harness：5 个 `defineDoc` 需要补 `checkpointWhen`，`fork.test.ts` 硬编码 `version === "1.3.0"`，`sync-pi-durable.mjs` / `bundle-pi-ai.mjs` 硬编码分支名与 `1.3.0` 断言。

## 1 上游 v1.3.0 → v1.4.0 变更

### 1.1 规模

| 包 | 文件 | 增/删 | 性质 |
|---|---|---|---|
| packages/durable | 95 | +7207/−1318 | breaking + 大功能 |
| packages/ai | 88 | +2758/−577 | breaking（1 个模块删除） |
| packages/coding-agent | 78 | +2613/−909 | 功能 + 修复 |
| packages/tui | 13 | +285/−11 | 功能 + 修复，无 breaking |
| packages/agent | 6 | +61/−2 | 新增 `identity` |
| packages/chord | 22 | +2239/−15 | breaking（Context.telemetry） |
| packages/telemetry | 18 | +1811/−248 | breaking（addLink） |
| packages/env | 3 | +13/−4 | 无 CHANGELOG 条目 |
| packages/codemode、mcp | 各 2 | — | 版本号变更 |
| 根 | ~12 | — | `scripts/check-entry-graphs.mjs` 的 `maxFiles` 66→73 |

### 1.2 packages/durable（对本项目影响最大）

Breaking：

- `TaskRuntime.sleep()` **删除**（它会占住一次 invocation、重启后重跑 phase）。替代：`runtime.sleepUntil(until, checkpoint, context)`，或从 `runtime.commit()` 返回 `{ status: "sleeping", until, checkpoint }`。phase 内节奏控制改用 `TaskRuntime.setTimer()`。
- `TaskState` 新增 `sleeping`（含 `until`）；`NextTaskState` 变为 `Extract<TaskState, {status: "running" | "waiting" | "sleeping" | "terminal"}>`。所有 `TaskState`/`TaskGraphState`/`TaskInspection` 的分支处理需要补 case。
- `defineDoc()` / `defineDocFamily()` **强制**每个定义提供 `checkpointWhen`，无默认值；`() => false` 保留「普通变更只算 delta」。签名 `checkpointWhen(value, ops, info: CheckpointInfo): boolean`（`packages/durable/src/documents.ts:89`）。
- SQLite 存储自动迁移到 schema version 2 并重建 task 表；**迁移后的库无法被 1.3.0 打开，无回滚**。
- `ToolExecutionApi` 新增 `now()`，`TaskRuntime` 新增 `sleepUntil()`/`setTimer()`：手写 fake/wrapper 必须补齐。
- 连续 5 次崩溃且未提交新状态的任务会被 park；`settings.restartLimit`（`Infinity` 恢复旧行为）；`TaskInspection` blocked reason 增加 `restart_limit`。

新增（Yonder 可用）：

- `settings.compaction.modelOverrides`，按精确 `"provider/modelId"` 覆盖压缩策略（`types.ts:517-521`，`compaction.ts:261-264`）。
- `settings.afterFailedRun`：`keep`(默认) | `continue` | `withdraw`，作用于 `model_error`/`no_model` 失败的 run 的排队输入（`agent.ts:82`、`generation.ts:406-413`）。
- `Harness.wake()`（`harness.ts:297`）与 `HarnessOptions.onWake`，让宿主可休眠。
- `HarnessOptions.telemetry` → `DURABLE_TELEMETRY_SCHEMA`（准入 span、task phase span、entry/submission 事件、phase-change checkpoint、nested-tool replay；失败分类固定为 `task_faulted`/`task_failed`/`task_orphaned`，诊断截断 500 字符）。
- `onReport(error, info)`，`ReportInfo.type` ∈ session_failed / task_faulted / task_parked / migration_failed / task_outdated / task_error / extension_error / host_error / listener_error（单参 `onReport` 仍可用）。
- `HarnessOptions.identity`（pi-ai `ClientIdentity`）；`HarnessOptions.models` 与 `.settings` 也接受函数（每次使用重新读取）；`api.models` 在 tools/hooks 中变成宿主 `Models` 的 **wrapper**，不再是同一对象。
- `IndexedDbStorage`（新子路径 `./storage/indexeddb`）、`Harness.retryTask(id)`、`TaskRecord.restarts`、`TaskGraphNode.blocked` 增加 `missing_task`/`task_too_old`/`migration_failed`/`restart_limit`。

Changed：生成重试退避、deferred 轮询、压缩重试退避改为 **sleep**（不再占 running phase）；code mode 截止时间改走 Harness 时钟；SQLite 驱动迁到 `@earendil-works/chord/sqlite`（durable 侧继续 re-export 公开名）；`ToolControl.terminate` 类型从 `true` 改为 `boolean`。

### 1.3 packages/ai

Breaking：

- provider 请求选项 `telemetryContext` → `telemetry?: TelemetrySpan`，**无兼容别名**。
- 默认 `User-Agent` 改为 `pi/<version> (<platform>; <runtime>; <arch>)`；`@earendil-works/pi-ai/utils/pi-user-agent` 与 `getPiUserAgent()` **删除**（文件已移除），改用 `formatUserAgent()`。
- `resolveTranscriptTools()` 第二参从 boolean 改为 `TranscriptToolSupport`（`"none"|"additions"|"changes"`）；`TranscriptTools.anchorsAdditions` → `foldedSystemMessages: number`。`getCurrentTools`/`declarationsEqual`/`toToolDeclaration` 仍在。

新增：client identity（`identity` 选项、`createModels({identity})`、`withClientIdentity()`、`formatUserAgent()`、`getIdentityHeaders()`、`mergeClientIdentity()`、`PI_ATTRIBUTION`、`PI_AI_VERSION`）；`AI_TELEMETRY_SCHEMA` + 可选 `pi.ai.request`/`pi.ai.poll` span（duration/token/USD 指标）；`MiniMax-M3.1-Flash`、classifier 图片输入、Grok 4.3/4.5 的 `xhigh`。

修复（与 fork 的 D44 直接相关，均为数据/正则改动、无签名变化）：

- `utils/retry.ts`：状态码不再匹配更长的单词/数字 —— `(?<![a-z0-9])(?:429|500|502|503|504|520|524)(?![a-z0-9])`（#11057）；新增可重试 `upstream.?request.?failed`、`upstream_stream_read_error`、`stream was interrupted`、`http/?2 stream failed`、`request to \S+ failed, reason:`、`stream disconnected before completion`；新增不可重试 `subscription_sharing_workplace_individual_usage_limit_exceeded`。
- `utils/overflow.ts`：任意 HTTP 413 计为上下文溢出（#11016）。

### 1.4 packages/coding-agent

新功能：codemode `models.classify()` 支持图片；Models Configuration 参考文档；压缩/分支摘要改用模型输出上限（不再固定 cap）；codemode 等待空闲 worker 最多 60s、`PI_CODEMODE_MAX_WORKERS` 可提高 2 worker 上限；Rex 终端（OSC 8 / truecolor / inline images）。

Changed：provider 归因头改由 pi-ai client identity 产生（扩展的 `before_provider_headers` 不再看到 OpenRouter/NVIDIA/OpenCode 归因）；`generateSummary()`/`generateSummaryWithUsage()` **忽略** `reserveTokens` 参数，`compaction.reserveTokens` 只控制何时开始压缩。

修复（择要）：压缩「generation hit the token cap」（#9512/#9075）、`pi-ai/models` 子路径对扩展暴露（#11156）、`/compact <instructions>` 被忽略（#11058）、恢复会话/`/tree` 后扩展工具失活（#11062）、截断后孤儿 tool result（#11227）、grep 改 `rg --no-config`（#11203）、并发扩展对话框（#11166）、退出时终端模式（#11170）、未闭合 `$$` 吞表格（#11159）、CJK 粗斜体（#10730）、`@` 补全正则元字符（#10972）。

`packages/coding-agent/package.json` 的 exports 无增删。

### 1.5 packages/tui

Rex 终端检测（`TERM_PROGRAM=rex`）+ OSC 8/truecolor/Kitty 图片；未闭合 `$$`、CJK 粗斜体、退出时同步 `exit` handler 恢复终端模式、`@` 补全正则元字符。**无导出删除**，`package.json` 仅版本号变化。

### 1.6 其它

- `packages/agent`：`AgentOptions.identity` / `Agent.identity`（pi-ai `ClientIdentity`），用于 User-Agent 与 provider 归因。
- `packages/telemetry` breaking：适配器必须实现 `TelemetrySpan.addLink()`；`NOOP_TELEMETRY_CONTEXT` 类型改为 `TelemetrySpan`；`TelemetryContext.metrics`/`.propagation` 需透传。新增 `TelemetryStore`/`StoredSpan`/`StoredTrace` 与 `@earendil-works/pi-telemetry/render` 的 `renderTrace()`。
- `packages/chord` breaking：自定义 `Context` 必须提供 `telemetry: TelemetrySpan`；`withTelemetry()` 接收 span。新增 `./sqlite`、`./sqlite/node`、`./sqlite/cloudflare`、`./telemetry-sqlite`、`./output`。
- `packages/codemode`、`packages/mcp`、`packages/env`：CHANGELOG 无 1.4.0 条目。

### 1.7 导出面总览

子路径导出只有新增：durable `./storage/indexeddb`；telemetry `./render`；chord 5 个。**无子路径删除**。`packages/durable/src/index.ts` 为纯新增（`DEFAULT_RESTART_LIMIT`、`DEFAULT_HARNESS_IDENTITY`、`BlockedReason`、`DURABLE_TELEMETRY_SCHEMA`、`AfterFailedRun`、`CompactionSettings`、`Wake`、`HostCallback`、`ReportFrom`、`ReportInfo`、`ReportTask`、`SetTimer`）。`packages/ai/src/index.ts` 为纯新增（`./utils/identity.ts`、`PI_AI_VERSION`）。

## 2 Fork 增量与去留

### 2.1 提交清单（`git log --oneline v1.3.0..45014f2a`，14 个）

fork 历史是 **squash 的根提交**（`eca1f259b` 无父提交），所以 v1.3.0 不是 fork 的祖先、`git merge-base` 失败；D28/D29/D49/D44 的主体都在这个根提交里。

| # | 提交 | 内容 | FORK.md |
|---|---|---|---|
| 1 | `eca1f259b` | 根提交：fork 基线（v1.3.0 + D28/D29/D49/D44 + pi.model-attempt 主体） | D28/D29/D44/D49 |
| 2 | `5bba5aedf` | 中断的生成用排队输入续跑；`LiveState.run.resumeOnInterrupt`；`answer()` 遇到 pending steer 时把在飞答案记为 `stopReason:"aborted"` 历史并 hand over | D49 |
| 3 | `53056aac2` | run 作用域 model fallback 链持久化到原生 generation（agent/generation/harness/live/types） | model fallback |
| 4 | `586de04e5` | fallback 链也用于压缩请求 | compaction fallback |
| 5 | `3c6d1d161` | 压缩 fallback 策略随请求 checkpoint 固定 | compaction fallback |
| 6 | `2cce1ecc6` | Hermes 工具检索相关性（精确名优先、最稀有词门限、50% 可答词覆盖） | tool search |
| 7 | `25f023969` | `compaction.backgroundAtTokens` 绝对后台压缩阈值 | backgroundAtTokens |
| 8 | `59cfaf093` | 从显式工具名恢复延迟工具发现 | tool search |
| 9 | `f263794ab` | generation/compaction 共用 `modelRecovery`（新增 `model-recovery.ts`） | D44 + modelRecovery |
| 10 | `9060e7fa1` | `NodeExecutionEnv` 的 `localSpawn` 适配器（env/node.ts +168，新测试 380 行） | localSpawn |
| 11 | `a1597be52` | T61：pi-ai 流边界观测（`utils/observation.ts`）+ durable `pi.model-observation`（`harness/model-observation.ts` +255） | T61 |
| 12 | `c84f8e652` | T63：显式凭据绑定 + 每 run `resolveModels`（pi-ai auth/models/providers + durable scheduler/types） | T63 + D28 |
| 13 | `48a50512c` | 保留原生 abort 顺序与已审阅的 observation 元数据 | D49/T61 |
| 14 | `45014f2a2` | 文档：标明需要匹配的 pi-ai 产物 | — |

整体 diff `v1.3.0..45014f2a`：52 文件，+3661/−275。

### 2.2 逐项判定

上游 v1.4.0 的 grep 证据：`beforeAgent`、`RunReceipt`、generation `shouldRetry`、durable `modelFallback`、`localSpawn`、`answer()` 中的 steer-supersede 全部 **0 命中**。

| 修改 | 上游 1.4.0 等价 | 判定 |
|---|---|---|
| D28 `beforeAgent` 宿主回调 | 无（`HarnessOptions.models` 可为函数，但无「agent 解析前、Session 行外」的钩子） | **KEEP** |
| D29 `RunReceiptDoc`（结算与 ending usage 同事务） | 无 | **KEEP** |
| D49 steer 中断 / 显式 interrupt 续跑 | 部分：`afterFailedRun` 只覆盖 `model_error`/`no_model` 的排队输入，不覆盖 steer 消费与「保留 superseded 文本为 aborted 历史」 | **KEEP**（`afterFailedRun` 可对齐其中一段语义，见 §4.4） |
| D44 `shouldRetry` 钩子 | 无（上游只有 pi-ai 的 `x-should-retry` 头） | **KEEP**，但需按 §1.3 的新 retry 正则重新核对分类 |
| model fallback 链（#3） | 无（coding-agent 的 `modelFallbackMessage` 是 CLI 会话级提示，语义不同） | **KEEP** |
| compaction fallback（#4/#5） | 无（`modelOverrides` 是「按模型改阈值」，不是换模型） | **KEEP** |
| `modelRecovery`（#9）+ `pi.model-attempt` | 无 | **KEEP** |
| `localSpawn`（#10） | 无 | **KEEP**（建议上游化，见 §5.3） |
| 工具检索相关性（#6/#8） | 无 | **KEEP**（建议上游化） |
| `backgroundAtTokens`（#7） | 语义相邻：`compaction.modelOverrides` 可按 `"provider/modelId"` 单独设 `backgroundTokens`，但需要枚举模型而非给一个绝对值 | **ADAPT**：生产中在用（`yonder.yaml` 的 `compaction: { backgroundAtTokens: 272000 }`，经 `packages/core/src/config/schema.ts:147` 的 `Record<string, unknown>` 原样透传），不能直接丢；后续可用 `modelOverrides` 替换以少一处 fork |
| T61 observation（#11/#13） | 语义相邻：`AI_TELEMETRY_SCHEMA` 提供请求级 span 与 duration/token/USD 指标，durable telemetry 提供 phase span；但不提供客户端首 token 时间、delta 计数、wire effort 快照 | **KEEP**（中期迁到 telemetry 可显著缩小 fork） |
| T63 显式凭据 + `resolveModels`（#12） | 部分：`HarnessOptions.models` 现可为函数、`identity` 覆盖 User-Agent/归因，但没有「按 run 冻结凭据并绑定实例」的语义 | **KEEP**，其中 `resolveModels` 的包装层可 **ADAPT** 到新的 `models: Models | (() => Models)` |
| `maxAgentDelayMs` | pi-ai 1.3.0 已有，FORK.md 明说不需 fork | 已无负担 |

## 3 干合并冲突

命令：`git merge-tree --write-tree --name-only --merge-base=v1.3.0 v1.4.0 45014f2a` → 结果树 `e42913538f146d3256e712094da1b51a5b70c784`，**15 个冲突文件**（普通 `git merge-tree` 会因 unrelated histories 直接 fatal）。

| 文件 | 冲突块 | 涉及的 Yonder 修改 | 难度 |
|---|---|---|---|
| `packages/durable/src/harness/generation.ts` | 10 | D29 `endRun(...conversationId)` vs 上游 `endFailedRun(tx, runtime, live, failure, ...)`+`prepareFailure`；model fallback/`modelRecovery`/`pi.model-attempt` vs 上游 `createGeneration(..., {submissionIds})` 与 `sleepUntil` | **hard** |
| `packages/durable/src/harness/scheduler.ts` | 5 | `resolveModels` + 惰性 `runtime ??= await this.#runtime(...)` vs 上游 `models: () => Models`、`#phase()` 重构、`get models()` | **hard** |
| `packages/durable/src/harness/types.ts` | 4 | `resolveModels`/`beforeAgent`/`settings` vs 上游 `models: Models \| (() => Models)`、`identity`、`telemetry` | medium |
| `packages/durable/src/harness/harness.ts` | 3 | `beforeAgent` 包装 + `resolveAgent` 内 model fallback vs 上游 `#hostSettings`/`currentModels(options.models, options.identity)`/`#report` 五参 | medium |
| `packages/durable/src/harness/compaction.ts` | 1 | 上游 `return { status: "sleeping", checkpoint, until }` vs fork 改写 retry checkpoint（`observationAttemptNo`/`nextModel`/`totalAttempt`） | medium |
| `packages/durable/src/harness/submissions.ts` | 1 | 上游准入 telemetry span 包裹 vs fork 的 RunReceipt 路径 | medium |
| `packages/durable/src/harness/inbox.ts` | 1 | 上游 `withdrawQueuedInputs(tx, id, reason = "aborted")` vs fork 清 `resumeOnInterrupt` | easy |
| `packages/ai/src/api/anthropic-messages.ts` | 1 | 上游删 `getPiUserAgent` 导入 vs fork 的 `observation.ts` 导入 | easy |
| `packages/ai/src/api/openai-completions.ts` | 1 | 同上 | easy |
| `packages/ai/src/api/openai-responses.ts` | 1 | 上游改 `identity.ts` 导入 vs fork observation 导入 | easy |
| `packages/ai/src/api/google-vertex.ts` | 1 | 上游 `identity.ts` vs fork `hasExplicitCredentials`（T63） | easy |
| `packages/ai/src/models.ts` | 2 | fork `authContext?: AuthContext \| ((providerId) => AuthContext)`（T63）vs 上游 `identity?: ClientIdentity`（相邻行） | easy |
| `packages/durable/CHANGELOG.md` | 1 | 版本段落 | easy |
| `packages/durable/test/harness-generation-recovery.test.ts` | 1 | 恢复测试断言 | easy |
| `scripts/check-entry-graphs.mjs` | 1 | `maxFiles` 66→73（上游）/ 66→67（fork），合并后约 74 | easy |

自动合并干净（无文本冲突，但需人工复核语义）：`packages/ai/src/types.ts`、`utils/event-stream.ts`、`providers/*`（T63 改动区）、`packages/durable/src/env/node.ts`（localSpawn）、`harness/agent.ts`、`harness/live.ts`、`harness/model-recovery.ts`、`harness/model-observation.ts`、`src/index.ts`、其余测试、`FORK.md`。

## 4 Harness 影响

### 4.1 依赖与 pin

- `packages/core/package.json:21-22`、`packages/sdk/package.json:20-21`：`pi-ai`/`pi-durable` = `1.3.0`；`packages/cli/package.json:22-23`：`pi-coding-agent`/`pi-tui` = `1.3.0`；`packages/pi-durable/package.json:138-139`：`pi-ai`/`pi-codemode` = `1.3.0`。全部要改 `1.4.0`。
- 根 `package.json:60` 的 `@earendil-works/pi-ai` 是 `file:./third_party/pi-ai/pi-ai-45014f2a...tgz`，加 `overrides: { "@earendil-works/pi-ai": "$@earendil-works/pi-ai" }`；必须用新 fork commit 重新打包。
- `node_modules` 中 `pi-agent-core`/`pi-mcp`/`pi-codemode`/`pi-telemetry`/`chord` 均为 1.3.0，是传递依赖。harness 源码 **不直接 import `pi-agent-core`**（此前统计到的 39 处来自 vendored `packages/pi-durable`）。

### 4.2 导入符号变化

| 来源 | 符号 | 1.4.0 状态 |
|---|---|---|
| `pi-ai` (114 处, 20 符号) | `AnyModel, Api, AssistantMessage, AuthContext, AuthOperationOptions, Credential, CredentialInfo, CredentialStore, Message, Model, ModelThinkingLevel, Models, Provider, ProviderStreams, clampThinkingLevel, createModels, createProvider, envApiKeyAuth, getSupportedThinkingLevels, isModelType` | 全部保留；`AuthContext` 在 fork 里已被扩成 `AuthContext \| ((providerId) => AuthContext)`（T63），合并后与上游 `identity` 并存 |
| `pi-ai/api/*.lazy` (10) | `anthropicMessagesApi, azureOpenAIResponsesApi, bedrockConverseStreamApi, googleGenerativeAIApi, googleVertexApi, mistralConversationsApi, openAICodexResponsesApi, openAICompletionsApi, openAIResponsesApi, piMessagesApi` | 保留 |
| `pi-ai/providers/all` | `builtinModels, builtinProviders, getBuiltinModel` | 保留 |
| `pi-ai/providers/model-schema` | 6 个 Schema | 保留 |
| `pi-ai/providers/compat-schema` | `ProviderCompatSchema` | 保留 |
| `pi-ai/utils/overflow` | `isContextOverflow` | 保留，行为增强（413） |
| `pi-ai/utils/retry` | `isRetryableAssistantError` | 保留，分类表扩大 |
| `pi-ai/utils/pi-user-agent` | `getPiUserAgent` | **已删除**（harness 代码未直接 import，但 fork 的 4 个 provider 文件在用） |
| `pi-coding-agent` (118 处, 12 符号) | `AssistantMessageComponent, CustomEditor, CustomMessageComponent, ExtensionSelectorComponent, SessionSelectorComponent, Theme, ToolExecutionComponent, UserMessageComponent, copyToClipboard, getMarkdownTheme, initTheme, keyText` | **全部仍在 v1.4.0** |
| `pi-tui` (101 处, 23 符号) | `TUI, Container, Component, Text, Markdown, ScrollView, Spacer, TruncatedText, TuiAltScreen, TuiMouseEvent, AutocompleteSuggestions, CombinedAutocompleteProvider, EditorTheme, TerminalColors, backgroundAnsi, colorToRgb, fuzzyFilter, mixColors, rgbColor, setKeybindings, stripTerminalSequences, truncateToWidth, visibleWidth` | 无删除 |
| `pi-durable` (29 处, 41 符号) + `/env`、`/env/node`、`/images/node`、`/storage/sqlite`、`/storage/sqlite/node`、`/tool-search`、`/tools` | 见 §1.7 | 全部仍存在；`RunReceiptDoc`/`RunReceiptState`/`LocalProcessSpawn` 是 fork 专有，需合并后保留 |

`pi-ai/utils/transcript` 只被 vendored `packages/pi-durable` 使用（`getCurrentTools`、`declarationsEqual`、`toToolDeclaration`），三者 1.4.0 仍在，`resolveTranscriptTools` 签名变化只影响 pi-ai 内部 provider。

### 4.3 必须修改的 harness 代码

1. **5 个 `defineDoc`/`defineDocFamily` 补 `checkpointWhen`**：`packages/core/src/runtime/docs.ts:5` `SessionDoc`、`:42` `RunDoc`、`:91` `ModelBindingDoc`；`packages/core/src/runtime/background.ts:26` `JobDoc`、`:42` `JobPointer`。不补则类型直接报错。
2. `packages/core/src/runtime/fork.test.ts`：`expect(version).toBe("1.3.0")` 需改；同时断言 `dist/harness/live.js` 含 `pi.run-receipt`、`harness.js` 含 `beforeAgent`、`generation.js` 含 `prepareBoundary(tx, conversationId, runtime.settings)` 与 `runtime.hooks.each("shouldRetry"` —— 合并后这些字符串可能变化，需重新校准。
3. 自建 `onReport?: (error: unknown) => void` 有 20+ 调用点（`packages/core/src/runtime/quota-source.ts:286`、`model-watch.ts:26`，配套 `packages/core/src/signals/codes.ts:53`）。上游 `onReport(error, info)` 单参仍可用，**不需要改**，但可利用 `ReportInfo.type` 取代当前的文本匹配分类。
4. `packages/core/src/runtime/index.ts:205` 的 `resolveModels`、`:245` 的 `beforeAgent`、6 处 `RunReceiptDoc` 快照（`:1273/:1446/:1480/:1583/:1606`）、`packages/core/src/runtime/recovery.ts:44/:55` 的 `shouldRetry` 钩子、`hosted-process.ts:6/:49` 的 `LocalProcessSpawn` —— 均依赖 fork API，合并后语义需回归。
5. `scripts/sync-pi-durable.mjs` 硬编码：`ref ?? "yonder/1.3"`、`pkg.version !== "1.3.0"` 抛错、`FORK_SOURCE.json` 里写死 `branch: "yonder/1.3"`、`upstream: "v1.3.0"`、`upstreamCommit: "71023aec..."`。
6. `scripts/bundle-pi-ai.mjs` 硬编码 `artifact.version !== "1.3.0"` 抛错；`scripts/check-pi-ai-bundle.mjs` 断言 `pi-ai` 与 `pi-durable` 必须同 commit、tarball 完整性、lockfile 中**只能有一份** `@earendil-works/pi-ai` 解析。

### 4.4 可复用的 1.4.0 新能力（Yonder 自己实现过的部分）

- **`settings.afterFailedRun`**：Yonder 现在用 D28/D49 的「abort 后续跑排队输入」覆盖类似场景；`model_error`/`no_model` 分支可直接交给上游 `continue`/`withdraw`，减少自定义边界代码。
- **`settings.compaction.modelOverrides`**：可替代 `backgroundAtTokens`，且键名受类型保护（当前 `compaction` 在 `packages/core/src/config/schema.ts:147` 是 `Record<string, unknown>`，拼错会静默失效）。
- **`Harness.wake()` / `onWake` / `setTimer`**：harness 的 cron、background job、服务宿主可据此休眠，而不是自建轮询。
- **durable `telemetry` + pi-ai `AI_TELEMETRY_SCHEMA` + `pi-telemetry/render` 的 `renderTrace()`**：T61 的 `pi.model-observation` 与 `scripts/export-model-observations.mjs`（读 `observation.version`/`observation.timing.*`/`observation.usage.*`）是自建同构能力，中期可迁移并删掉半个 pi-ai fork。
- **`restartLimit` / `Harness.retryTask` / `blocked` 原因**：可替代 harness 的 credential-slot-recovery 之外的自建崩溃循环处理（现状 grep 无 `restartLimit`）。
- **`identity`**：harness 目前只有 `packages/core/src/runtime/quota-source.ts:156` 的 `"User-Agent": "yonder-harness"`（自建 HTTP 客户端，与模型请求无关），模型请求可统一走上游 identity。

### 4.5 同步流程（`scripts/sync-pi-durable.mjs`）

1. `ref = argv[2] ?? "yonder/1.3"`；必须是 `yonder/1.3` 或完整 40 位 commit。可选 `YONDER_PI_SOURCE=<本地 fork checkout>`，此时额外校验 `origin` URL 等于 `https://github.com/GoYonderTogether/pi.git` 且 `rev-parse <ref>` 完全等于 ref。
2. `mktemp` 临时目录 → `git init` → `git fetch --depth=1 <源> <ref>` → `git checkout --detach FETCH_HEAD`。
3. 校验 `packages/durable/package.json` 的 `name === "@earendil-works/pi-durable"` 且 `version === "1.3.0"`，否则抛 `Unexpected fork package/version`。
4. `rm -rf packages/pi-durable`，拷贝 `src`、`CHANGELOG.md`、`FORK.md` + 仓库根 `LICENSE`；重写 `README.md`；`pkg.scripts = { build: "tsc -b" }`、删 `devDependencies`、设 `pkg.files`；生成 `tsconfig.json`（extends `../../tsconfig.base.json`，target/lib es2024，关 `noUncheckedIndexedAccess`/`exactOptionalPropertyTypes`，开 `allowImportingTsExtensions`/`rewriteRelativeImportExtensions`/`inlineSources`）；写 `FORK_SOURCE.json`。
5. 完成时 `rm -rf` 临时目录。

已验证 vendored `packages/pi-durable/src` 与 `45014f2a:packages/durable/src` **逐字节一致**（`diff -rq` 空），同步链路当前是干净的。

## 5 推荐升级方案

### 5.1 分支与顺序

新建 fork 分支 **`yonder/1.4`**。不要用 `git rebase --onto`：根提交是 squash 的，D28/D29/D49/D44 的主体在根里，`--onto` 会把它们当成 base 丢掉。

推荐（保留现有「一个 squash 根 + 若干细化提交」的约定）：

1. `git fetch` 上游 → 在 yonder-pi 生成补丁 `git diff v1.3.0 45014f2a > /tmp/yonder-fork.patch`。
2. `git switch -c yonder/1.4 v1.4.0`，`git apply -3 /tmp/yonder-fork.patch`。
3. 按难度递增解冲突：`ai/src/api/*` 与 `models.ts`（改导入 `formatUserAgent()`、保留 T63 `authContext` 函数形式）→ `durable/src/harness/{types,inbox,harness}.ts` → `scheduler.ts` → `compaction.ts` → `submissions.ts` → `generation.ts` → 测试与 `scripts/check-entry-graphs.mjs`。
4. `generation.ts` 的关键决策：把 fork 的 `endRun(tx, live, conversationId, ...)` 迁到上游 `endFailedRun(tx, runtime, live, failure, ...)` 上（保留 conversationId 语义），把 `runtime.sleep(until, context)` 全部换成 `runtime.sleepUntil(until, checkpoint, context)` 或 `{ status: "sleeping", until, checkpoint }`；`createGeneration` 合并成同时带 `submissionIds`（上游 telemetry）与 `modelRun`（fork）的签名。
5. `npm run check`（`node scripts/biome-check.mjs --write && check:pinned-deps && check:runtime-deps && check:ts-imports && check:entry-graphs && check:install-lock:coding-agent && tsc --noEmit && check:browser-smoke`），再跑定向测试。
6. 提交为单个 fork 根提交并推送 `yonder/1.4`；后续细化提交可再 `git rebase --onto yonder/1.4 <根提交> yonder/1.3` 逐条重放（可选，先合主体更稳）。
7. 回 harness：先改 `scripts/sync-pi-durable.mjs`（ref、version 断言、`branch`/`upstream`/`upstreamCommit`），`node scripts/sync-pi-durable.mjs yonder/1.4`（或 `YONDER_PI_SOURCE=...`）。
8. 用上游产物流重建 pi-ai：`npm run pack:packages`（`scripts/pack-packages.mjs`）→ 改 `scripts/bundle-pi-ai.mjs` 的 `1.3.0` 断言 → `node scripts/bundle-pi-ai.mjs <manifest>` → `npm install --package-lock-only --ignore-scripts && npm ci --ignore-scripts`。
9. 改 harness 代码（§4.3 第 1/2 项）、把 `1.3.0` pin 全部提到 `1.4.0`、评估 `backgroundAtTokens`→`modelOverrides`。

风险点：**SQLite schema v2 迁移不可回滚**，先在副本库上跑一遍 `Harness.open`，确认能接受不可降级。

### 5.2 验证命令（harness 现有脚本）

```
npm run lint                 # biome check . + scripts/check-file-size.mjs
npm run typecheck            # tsc -b --force
npm run build                # 含 check-pi-ai-bundle.mjs → tsc -b → devices/macos/ui-companion
npm test                     # vitest run --exclude '**/dist/**'
npm run test:node            # node --test scripts/export-model-observations.test.mjs
node scripts/check-pi-durable-workspace.mjs
node scripts/check-pi-ai-bundle.mjs
```

重点回归用例：`packages/core/src/runtime/{fork,recovery,fallback,background,credential-slot-recovery,notifications}.test.ts`、`packages/core/src/runtime/boundary.test.ts`、`packages/core/src/config/config.test.ts`。fork 侧定向测试：`node "$(git rev-parse --show-toplevel)/node_modules/vitest/dist/cli.js" --run test/harness-generation-recovery.test.ts`（同理 `harness-compaction`、`harness-inbox`、`env-node-local-spawn`、`search-relevance`、`harness-models-resolver`、`observation`、`provider-observation`）。

### 5.3 建议上游（缩小 fork）

优先级从高到低：

1. `NodeExecutionEnv` 的 `localSpawn` 生命周期适配器（纯通用 seam，FORK.md 已声明「不含宿主特定路径/能力/授权」）。
2. 工具检索相关性规则（精确名优先、最稀有词门限、50% 覆盖下限）。
3. `HarnessOptions.resolveModels` / `beforeAgent` 式的「每 run 绑定模型与 agent 前回调」——上游已有 `models: Models | (() => Models)`，但缺少 per-run 冻结与时机保证。
4. `RunReceiptDoc` 式「结算与 ending usage 同事务」的 receipts。
5. generation `shouldRetry` 宿主分类钩子（上游只有 provider 层 `x-should-retry`）。
6. 把 T61 的 observation 需求拆成可合并的小项（delta 计时/计数、wire effort 快照）并入 `AI_TELEMETRY_SCHEMA`，长期删掉 pi-ai fork。

### 5.4 未核实

- `yonder.yaml` 生产配置里 `backgroundAtTokens` 之外是否还有其它未被 schema 校验的 fork 键（`compaction` 是 `Record<string, unknown>`，只能靠 `docs/spec/07-runtime.md:63` 对照）——**未核实**。
- 上游 `afterFailedRun` 与 Yonder D49「steer 中断后续跑」在生产行为上是否完全一致（只读了类型与注释，未跑行为测试）——**未核实**。
- `bundle-pi-ai.mjs` 依赖的 artifact manifest 是否由 `scripts/pack-packages.mjs` 直接产出（未在 v1.4.0 上实跑）——**未核实**。
- 干合并结果树 `e42913538` 只统计文本冲突；`packages/ai/src/types.ts`、`utils/event-stream.ts`、`providers/*`、`env/node.ts` 虽自动合并，但 T61/T63 的语义正确性需在合并后逐点复核——**未核实**。
- 本次未验证 `1.4.0` 的 `pi-agent-core` 传递依赖是否与 harness 的 39 处（vendored）用法一致。