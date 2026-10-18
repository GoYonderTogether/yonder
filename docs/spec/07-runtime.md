# 07 运行时：与 pi 的对接

> T00 验证了 pi 1.3.0 的基础接口；本轮新增配置、上限与恢复契约由 N 任务验证，不能把 T00 的证据扩张为全部新功能已通过。

## 1. 对接边界

- 依赖：`@earendil-works/pi-ai`、`@earendil-works/pi-durable`、`@earendil-works/chord`。版本**锁定到精确版本**，升级单独成一个变更。
- pi-durable 1.3.0 使用本仓库可审核的最小补丁（D28、D29）：调度器解析 agent/model 前调用宿主 `beforeAgent`；单运行 abort 由 pi 原生 final 边界接续排队输入；运行终结在同一原生事务保存运行回执。补丁来源为 npm 1.3.0、官方 `earendil-works/pi/packages/durable`；保留版权，不复制运行循环。安装时应用固定补丁，版本或补丁不匹配直接报错，不静默跳过。
- 只有 `packages/core/src/runtime/` 可以 import 这些包。其他内核代码只用 runtime 目录导出的 Yonder 自己的类型。唯一例外：`@yonder/sdk` 以 `import type` 重新导出少数类型（04 §3.5、§3.6、§4）。
- pi-durable 标注为实验性。runtime 目录的测试必须覆盖本文用到的每一个 pi 能力，升级 pi 时先跑这组测试。
- 不使用完整 pi coding-agent 的运行循环、SessionManager、会话文件与配置格式。终端界面按 12（已批准，待实现）统一沿用 pi v1.3.0；仅 `packages/cli/` 可使用 pi-tui 及 coding-agent 的 UI/主题/键位导出或按许可提取的 UI 模块，不另设计布局和交互。这是界面依赖的明确边界，不允许 CLI import 模型/会话运行包或启动另一套 agent runtime。
- pi 的每个异步调用都带 chord 的 `Context`；取消看 `context.abortSignal`。工具与钩子**必须**响应它，否则中止要等工具自己结束。

## 2. 存储

- 一个 home 一个 SQLite 文件：`<home>/.yonder/state.db`，用 Node 内置 `node:sqlite`。
- 打开方式：`openNodeSqliteDatabase(path)` 得到一个连接，pi 用 `SqliteStorage.open(db, { prefix: 'pi_' })`；Yonder 的 `y_` 表**用同一个连接对象**读写（它为所有操作排队）。**禁止**对同一文件再开第二个连接。runtime 目录向内核导出这个连接的 Yonder 接口（`exec / run / get / all / transaction`）。
- 一个 home 同一时间只由一个 harness 进程打开（pi-durable 不做跨进程锁；Yonder 用 `<home>/.yonder/lock` 文件保证）。CLI 的其他命令通过本地控制接口（§8）与运行中的进程交互。

## 3. 映射

| Yonder | pi-durable |
|---|---|
| 一个 home | 一个 `Harness`（`Harness.open(storage, { models, registry, settings, env, onReport })`） |
| 会话 | 一个 conversation（`harness.createConversation({ ownership: { kind: 'ownerless' }, agent, init })`）；Yonder 元数据存在 `y_sessions`，并在 conversation 文档 `yonder.session`（`defineDoc`，`scope: 'conversation'`）中存 `{ agent, profile }`，由 `init` 在创建的同一次提交里写入 |
| 配置档 | `conversation.configure({ model, thinkingLevel, extensions, tools, modelTools, instructions, cwd })`；实际开始运行时取配置并固定，运行内模型/权限/env/提示/投递使用同一份。排队输入在开始时取新配置，恢复的已开始运行沿用原配置（10 §4） |
| 框架段、`SYSTEM.md`、上下文贡献 | 扩展 `yonder.core` 的 `section`，按 03 §5.1 的顺序；section 用 `input.read.snapshot(SessionDoc, input.conversationId, ctx)` 读 `yonder.session` |
| 插件工具与钩子 | 每个插件一个扩展 `plugin:<id>`，配置档选用的插件才进入 `extensions`。SDK 的 `Tool`（04 §3.2）转为 `defineTool({ name, description, parameters, execute })`：`ToolResult.text`/`images` → `output` 的文字与图片块，`isError` 原样；`ToolContext` 由 `yonder.session`、本次运行的能力、`api.env`、触发事件和 chord `context.abortSignal` 组成。SDK 的 `Hook` 转为 `hook(ToolTask | GenerationTask, …)`，`ToolCall` 取自 pi 的 `{ id, name, arguments }` |
| 安全钩子、上限钩子 | 扩展 `yonder.core` 的 `hook(ToolTask, …)` 与 `hook(GenerationTask, …)`，`yonder.core` 最先安装 |
| `wake: run` | `submit({ type: 'input', content, entry: { kind: 'yonder.message', data: { event } }, whenBusy })`；`content` 是 `<turn>` 块 + turn 贡献 + 正文的文字块，加上图片附件的图片块（03 §5.3） |
| `wake: write` | `submit({ type: 'write', entry: { kind: 'yonder.message', data: { event }, model: [{ role: 'user', content, timestamp }] } })`。下一次运行模型能看到；会话忙时排到下一个边界 |
| `busy` | `followup` → `whenBusy: 'followUp'`；`steer` → `whenBusy: 'steer'`（插进当前工具轮之后，与本次运行同一个回答） |
| `task_run` | 子会话：工具声明 `replay: 'safe'`，在 `api.commit` 里先按 `tx.scanConversations({ ownerTaskId: api.taskId }, 1)` 找已有子会话，否则 `tx.createConversation({ ownership: { kind: 'task', taskId: api.taskId } })`；输入带 `requestId: task:<taskId>`。发起方中止时子会话一并中止 |
| 执行环境 | `HarnessOptions.env({ conversationId, cwd, read })`，按 `yonder.session` 找到配置档的 `env`，本机为 `new NodeExecutionEnv({ cwd })` |
| 用量 | conversation 文档 `pi.usage`（`UsageDoc`，按 `provider/model` 累计）；开始快照与原生运行回执中的结束快照之差记入 `run.end`，不在等待结果返回后读取可能已含 successor 的最新总量 |
| 流式 | `watchEvents(harness, conversationId, ctx)`：`message_update` 的 `changes` 含 `text_delta`，`tool_execution_start` / `tool_execution_end` 给出工具起止；内核据此生成 06 §3 的片段 |

### 3.1 恢复与唯一事实来源

事件落库与 pi 提交使用稳定关联，pi 的 entry/submission/回答关系及原生运行回执是运行事实；Yonder 只保存必要的事件关联及配置快照，不复制转录或建第二条队列。启动时先恢复关联与终结观察，再调用调度恢复；Harness.open 本身不等于已开始调度。活跃观察者及时释放，终结和投递按 10 §3 执行。相同事件到同一会话不能因重启被重复提交。

原生运行回执按 conversation 与该轮第一条实际 submission 标识，每轮只保存一份：实际 inputs、原生 settlement（回答引用或失败原因/详情）与结束时 usage 快照。回执与该轮 submissions 终结在同一原生事务中写入，然后清除旧 run、接续 successor；正常回答、中止、模型失败与 scheduler 故障使用同一终结点。回执只供读取和恢复，不调度、不重试、不保存对话正文；开始配置与预算仍由既有 Yonder RunDoc 保存。没有回执的旧历史如无法由已有事实确定，明确报告不可确定，不猜分组或重放副作用。

## 4. 工具暴露

- 配置档 `tools.offer` → `modelTools`（定义常驻）；`tools.search` → 工具在 `tools` 中、定义带 `deferred: true`、不在 `modelTools` 中，并选用 pi-durable 的 `createToolSearchExtension()`；模型调用 `tool_search` 后由 pi 写入 `modelTools.add`。
- 两者都先经过能力过滤（05 §3）。
- 弱模型或语音场景用少量 `offer`；工具多的常驻 agent 用 `search`；编码场景以 `bash` 为主、命令用法写进上下文。三种方式都只是配置，内核不区分场景。

## 5. 运行上限

运行上限内置在内核，因为"运行一定会结束"是框架的保证（架构不变量 7）。默认值宽松，按配置档可调；更细的防护（例如语义级的重复检测）写成钩子插件。

| 上限（配置档 `limits` 的键） | 默认 | 手段 |
|---|---|---|
| 每次运行的模型轮数（`maxTurns`） | 100 | 按真实模型轮次计数，达到上限禁止下一轮请求；拒绝/无效工具不绕过，不依赖 afterTool 一定被调用 |
| 每次运行的墙钟时间（`maxMinutes`） | 30 | 内核计时，到时中止 pi 当前 generation task；排队输入继续由原生边界处理 |
| 连续相同的工具调用（同名且参数相同；`repeatBlock`、`repeatStop`） | 第 3 次拦下并提示模型换方法；第 5 次结束运行 | repeatBlock 起阻止；达到 repeatStop 时在该次副作用执行前终止 |

- 触发任一上限，`run.end.status = limit`，原因记在 `run.end.data.reason`，并按 06 §2 向来源说明停在了哪里。`terminate` 结束的运行在 pi 里是 `done` 且最终文字为空，`abort()` 结束的是 `unanswered`/`aborted`——是不是上限由内核自己记录，不靠 pi 的状态判断。
- 已开始运行的配置、计数和终止原因按 pi 扩展记录恢复，不让重启重新获得无限预算。取消传播到模型、工具、渲染和附件 IO；排队等待与模型运行时间分开。具体有限预算与恢复行为见 10 §3–4。
- `beforeAgent` 只在原生调度调用中使用；runtime 以 pi 本轮第一条 submission 为身份，在选择模型前固定配置并启动预算，同轮后续工具/模型请求读取该快照。它不为只读查看启动任务。限额只中止本轮；用户显式会话 abort 仍使用 `conversation.abort()`，同时撤销该会话排队输入。
- 上下文：使用 pi-durable 的自动压缩。`yonder.yaml` 的 `compaction`（`enabled`、`reserveTokens`、`keepRecentTokens`、`backgroundTokens`）原样传给 settings。按模型的差异来自模型自己的 `contextWindow`（§6.1，内置模型用 `modelOverrides` 改）。供应商报"上下文过长"时由 pi-durable 压缩后重试一次。不设人为的小上下文上限。
- 单个工具结果过长时的截断使用 pi-durable 自带的截断；供应商重试使用 settings 的 `retry`。

## 6. 模型、凭据与服务

### 6.1 模型

- 启动时注册 pi-ai 的全部内置供应商（`builtinProviders()`）。内置模型直接引用，例如 `openai/gpt-6-luna`。
- `yonder.yaml` 的 `models.providers` **原样**采用 pi 的 `models.json` 结构（`baseUrl`、`api`、`headers`、`authHeader`、`compat`、`models[]`、`modelOverrides`），语义与 pi 相同：
  - id 与内置供应商相同：在内置供应商上叠加——沿用它的鉴权（含 OAuth）与模型目录，`baseUrl`/`headers`/`compat` 覆盖，`models` 新增或替换同 id 模型，`modelOverrides` 按模型 id 改字段（例如 `contextWindow`）。
  - 其他 id：新建供应商，`createProvider({ id, auth: { apiKey: envApiKeyAuth(id, []) }, models, api })`；`api` 按名字取 pi-ai 的 `api/<api>.lazy` 实现（一张"协议名 → 实现"表，按协议而非按厂商）；模型缺省的字段取 pi `models.json` 的默认值。
- 任何 OpenAI 兼容、Anthropic 兼容的端点都只靠配置接入，**禁止**为单个供应商写适配代码。
- 模型引用写作 `provider/modelId`。

### 6.2 凭据

- 凭据文件采用 pi 的 `auth.json` 格式（`{ <provider>: { type: 'api_key', key } | { type: 'oauth', … } }`），键是供应商 id；路径由 `yonder.yaml` 的 `credentials` 指定，默认 `<home>/.yonder/auth.json`，权限 `0600`。密钥只放在这里，不写进 `yonder.yaml`。
- 实现 pi-ai 的 `CredentialStore`（`read`、`list`、`modify`、`delete`），复制 pi coding-agent 的 `FileAuthStorageBackend`（`proper-lockfile` 文件锁，MIT）并在 `THIRD_PARTY_NOTICES` 记录。OAuth 刷新在 `modify` 里进行并写回文件。
- ChatGPT 订阅：使用 pi-ai 内置 `openai` 供应商的 "Sign in with ChatGPT" OAuth。`yonder login <provider>` 调用 `provider.auth.oauth.login(interaction, { getDeviceId })`，`getDeviceId` 返回本 home 固定的 UUID（存于 `<home>/.yonder/device-id`，首次登录时生成）。
- 插件只能经 `api.credentials.get(name)` 只读地取一项凭据（渠道、服务的密钥都这样存取），不能写。
- OAuth 刷新会轮换 refresh token（T00 已验证）。**禁止**复制其他程序的 OAuth 凭据；每个 Yonder home 单独登录。API key 可以复制。

### 6.3 非对话服务

ASR、TTS、embedding、rerank 等不经过 pi-ai。`yonder.yaml` 的 `services` 列出端点：

```yaml
services:
  - id: siliconflow
    protocol: openai-compatible
    baseUrl: https://api.siliconflow.cn/v1
    credential: siliconflow          # auth.json 里的键
    capabilities:
      asr: { models: [FunAudioLLM/SenseVoiceSmall] }
      tts: { models: [FunAudioLLM/CosyVoice2-0.5B], voices: [alex] }
      embedding: { models: [Qwen/Qwen3-Embedding-8B] }
```

内核只负责存与解析，调用由插件完成：

```ts
interface ServiceEndpoint { id: string; protocol: string; baseUrl: string; apiKey?: string; models: string[]; voices?: string[] }
```

`await api.services.resolve('asr')` 按 `services` 的顺序返回第一个声明了该能力的服务（`models`、`voices` 取自该能力，`apiKey` 取自 `credential` 指向的当前 api_key 凭据），没有则返回 `undefined`；不缓存凭据。

## 7. 模型能看到的工具结果

pi-durable 的工具结果原样进入转录。Yonder 内置工具（`message_send`、`task_run`、`session_*`、`identity.*`）的结果必须简短、结构化，失败时给出可执行的原因。被 `beforeTool` 拦下的调用，模型看到的是 `Tool call blocked: <原因>`。

## 8. 本地控制接口

运行中的 harness 在 `<home>/.yonder/control.sock` 提供本地接口，CLI 的会话、身份、事件查询类命令与停止进程都经由它；没有运行中的进程时，查询类命令以只读方式直接打开存储。普通协议是一行一个 JSON 请求、一行一个 JSON 响应。渠道 chat 连接 channel-cli 插件自己的套接字；12 的任务 chat 方案使用控制接口驱动 task，并在独立连接观察真实会话状态与输出，不启动第二个 harness 或打开运行中数据库。观察不是等待者，不改变投递；断连不 abort，恢复依据原生转录与事实。订阅确认、关联、终态与目标查询详见 12 §7，均属已批准新增设计。当前验收平台为 macOS，Windows 命名管道以后定义并验证。
