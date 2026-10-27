# 07 运行时：与 pi 的对接

## 1. 对接边界

- 依赖：`@earendil-works/pi-ai`、`@earendil-works/pi-durable`、`@earendil-works/chord`。版本**锁定到精确版本**，升级单独成一个变更。
- pi-durable 1.3.0 来自 MIT fork `GoYonderTogether/pi` 的 `yonder/1.3` 分支，源码同步到 workspace `packages/pi-durable`，保留包名、版本与全部导出路径。D28/D29/D44 的 beforeAgent、abort 接续队列、原子运行回执与 shouldRetry 是 fork 源码提交；不再安装时打补丁。仅 durable 内化，其 chord、pi-ai、codemode 及其他 pi 包仍锁定上游 npm 版本。同步命令和来源 commit 见 CONTRIBUTING 与包内 FORK.md。
- Yonder 宿主源码只有 `packages/core/src/runtime/` 可以 import 这些包。其他内核代码只用 runtime 目录导出的 Yonder 自己的类型；`@yonder/sdk` 以 `import type` 重新导出少数类型（04 §3.5、§3.6、§4）。`packages/pi-durable` 属于 pi 实现自身，其内部上游 imports 随 fork 保留，不构成宿主的第二个适配入口。
- pi-durable 标注为实验性。runtime 目录的测试必须覆盖本文用到的每一个 pi 能力，升级 pi 时先跑这组测试。
- 不使用完整 pi coding-agent 的运行循环、SessionManager、会话文件与配置格式。终端界面按 12 统一沿用 pi v1.3.0；仅 `packages/cli/` 可使用 pi-tui 及 coding-agent 的 UI/主题/键位导出或按许可提取的 UI 模块，不另设计布局和交互。这是界面依赖的明确边界，不允许 CLI import 模型/会话运行包或启动另一套 agent runtime。
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
| 配置档 | `conversation.configure({ model, thinkingLevel, extensions, tools, modelTools, instructions, cwd })`；实际开始运行时取配置并固定，运行内模型链/权限/env/提示/投递使用同一份；当前模型只能在该快照的 fallback 链内按 §6.1 切换。排队输入在开始时取新配置，恢复的已开始运行沿用原配置（10 §2） |
| 框架段、内置底座、上下文贡献 | 扩展 `yonder.core` 的 `section`，按 03 §5.1 的顺序；section 用 `input.read.snapshot(SessionDoc, input.conversationId, ctx)` 读 `yonder.session` |
| 插件工具与钩子 | 每个插件一个扩展 `plugin:<id>`，配置档选用的插件才进入 `extensions`。SDK 的 `Tool`（04 §3.2）转为 `defineTool({ name, description, parameters, execute })`：`ToolResult.text`/`images` → `output` 的文字与图片块，`isError` 原样；`ToolContext` 由 `yonder.session`、本次运行的能力、`api.env`、触发事件和 chord `context.abortSignal` 组成。SDK 的 `Hook` 转为 `hook(ToolTask | GenerationTask, …)`，`ToolCall` 取自 pi 的 `{ id, name, arguments }` |
| 安全钩子、上限钩子 | 扩展 `yonder.core` 的 `hook(ToolTask, …)` 与 `hook(GenerationTask, …)`，`yonder.core` 最先安装 |
| `wake: run` | `submit({ type: 'input', content, entry: { kind: 'yonder.message', data: { event } }, whenBusy })`；`content` 是 `<turn>` 块 + turn 贡献 + 正文的文字块，加上图片附件的图片块（03 §5.3） |
| `wake: write` | `submit({ type: 'write', entry: { kind: 'yonder.message', data: { event }, model: [{ role: 'user', content, timestamp }] } })`。下一次运行模型能看到；会话忙时排到下一个边界 |
| `busy` | 缺省 `steer` → `whenBusy: 'steer'`；显式 `followup` → `whenBusy: 'followUp'`；`interrupt` → `whenBusy: 'interrupt'`。steer 在工具轮后合并，在生成中取消旧回答并继续同一运行；interrupt 也取消工具。原生 steeringMode/followUpMode 均配置 all |
| `task_run` | 子会话：工具声明 `replay: 'safe'`，在 `api.commit` 里先按 `tx.scanConversations({ ownerTaskId: api.taskId }, 1)` 找已有子会话，否则 `tx.createConversation({ ownership: { kind: 'task', taskId: api.taskId } })`；输入带 `requestId: task:<taskId>`。发起方中止时子会话一并中止 |
| 执行环境 | `HarnessOptions.env({ conversationId, cwd, read })`，按 `yonder.session` 找到配置档的 `env`，本机为 `new NodeExecutionEnv({ cwd })` |
| 用量 | conversation 文档 `pi.usage`（`UsageDoc`，按 `provider/model` 累计）；开始快照与原生运行回执中的结束快照之差记入 `run.end`，不在等待结果返回后读取可能已含 successor 的最新总量 |
| 流式 | `watchEvents(harness, conversationId, ctx)`：`message_update` 的 `changes` 含 `text_delta`，`tool_execution_start` / `tool_execution_end` 给出工具起止；内核据此生成 06 §3 的片段 |

### 3.1 恢复与唯一事实来源

事件落库与 pi 提交使用稳定关联，pi 的 entry/submission/回答关系及原生运行回执是运行事实；Yonder 只保存必要的事件关联及配置快照，不复制转录或建第二条队列。启动时先恢复关联与终结观察，再调用调度恢复；Harness.open 本身不等于已开始调度。活跃观察者及时释放，终结和投递按 10 §1 执行。相同事件到同一会话不能因重启被重复提交。

原生运行回执按 conversation 与该轮第一条实际 submission 标识，每轮只保存一份：实际 inputs、原生 settlement（回答引用或失败原因/详情）与结束时 usage 快照。回执与该轮 submissions 终结在同一原生事务中写入，然后清除旧 run、接续 successor；正常回答、中止、模型失败与 scheduler 故障使用同一终结点。回执只供读取和恢复，不调度、不重试、不保存对话正文；开始配置与预算仍由既有 Yonder RunDoc 保存。没有回执的旧历史如无法由已有事实确定，明确报告不可确定，不猜分组或重放副作用。

## 4. 工具暴露

- 配置档 `tools.offer` → `modelTools`（定义常驻）；`tools.search` → 工具在 `tools` 中、定义带 `deferred: true`、不在 `modelTools` 中，并选用 pi-durable 的 `createToolSearchExtension()`；模型调用 `tool_search` 后由 pi 写入 `modelTools.add`。
- 两者都先经过能力过滤（05 §3）。
- 弱模型或语音场景用少量 `offer`；工具多的常驻 agent 用 `search`；编码场景以 `bash` 为主、命令用法写进上下文。三种方式都只是配置，内核不区分场景。

## 5. 时间、用量与停止

内核按配置档limits记录运行进度；时间、轮数和tokens是软提醒，不负责判断任务已经完成，见[14 §1](14-execution-capabilities.md)。

| 键 | 默认 | 行为 |
|---|---|---|
| maxTurns | 100 | 达到实际模型轮数后提醒一次，不阻止下一轮 |
| maxMinutes | 30 | 到达墙钟阈值后提醒一次，不中止正在执行的工具或模型 |
| maxTokens | 200000 | 本运行累计新输入与输出tokens（不含缓存读写）达到阈值后提醒一次 |
| repeatBlock | 3 | 相同工具与参数重复时拒绝继续重复，要求换方法 |
| repeatStop | 5 | 连续重复空转停止，run.end.status=limit，reason=repeatStop |

- 长工具15秒转入pi原生后台任务；process支持状态、日志、等待、stdin及取消。正常process观察/等待不当作重复副作用空转。完成后继续原任务，取消不会反向唤醒模型。
- 子任务的软提醒同时写入父session；只在正常模型请求读取时间事实，不为软提醒启动额外模型循环。显式abort/close/shutdown和真实供应商限制保留。
- 会话/任务状态只使用pi-durable；后台执行记录不复制模型转录。恢复不能安全重放的调用标为中断，不假装恢复成功。
- 上下文使用pi-durable自动压缩。compaction的enabled/reserveTokens/keepRecentTokens/backgroundTokens/backgroundAtTokens原样传给settings；模型contextWindow继续来自供应商目录。可选 backgroundAtTokens 限定开始后台压缩的绝对 token 用量，与模型实际窗口分开；实际开始点取它与原生后台阈值的较小值，不推迟小窗口模型的压缩，backgroundTokens 为 0 时仍禁用后台压缩。真实上下文过长遵循pi压缩恢复。

## 6. 模型、凭据与服务

### 6.1 模型

- 启动时注册 pi-ai 的全部内置供应商（`builtinProviders()`）。内置模型直接引用，例如 `openai/gpt-6-luna`。
- `yonder.yaml` 的 `models.providers` **原样**采用 pi 的 `models.json` 结构（`baseUrl`、`api`、`headers`、`authHeader`、`compat`、`models[]`、`modelOverrides`），语义与 pi 相同：
  - id 与内置供应商相同：在内置供应商上叠加——沿用它的鉴权（含 OAuth）与模型目录，`baseUrl`/`headers`/`compat` 覆盖，`models` 新增或替换同 id 模型，`modelOverrides` 按模型 id 改字段（例如 `contextWindow`）。
  - 其他 id：新建供应商，`createProvider({ id, auth: { apiKey: envApiKeyAuth(id, []) }, models, api })`；`api` 按名字取 pi-ai 的 `api/<api>.lazy` 实现（一张"协议名 → 实现"表，按协议而非按厂商）；模型缺省的字段取 pi `models.json` 的默认值。
- 任何 OpenAI 兼容、Anthropic 兼容的端点都只靠配置接入，**禁止**为单个供应商写适配代码。
- 模型引用写作 `provider/modelId`。

配置档的 `fallback` 映射到 pi 原生 agent 的模型链与失败阈值。pi 在分类模型错误的同一事务中保存运行内模型索引、连续失败计数及重试 checkpoint；不重交输入、不重放已完成工具。所有模型 error（含鉴权、配额）计数；上下文超限沿用压缩、aborted 不回退。模型链耗尽保留真实错误。回退项与主模型相同或彼此重复时在配置给 pi 前剔除，剩下为空就等同未配置回退，沿用原生 retry（最多 10 次、退避至 5 分钟），因此临时断网不会在 3 次失败后直接停止；`yonder doctor` 对这种配置告警。给人看的停止提示不含供应商原始错误：网络类写成“网络连接中断，这一轮没有完成”，其余截断显示原因。聊天与摘要请求的 SDK 重试统一设为 0，每次请求由原生 checkpoint 计数和退避，避免 SDK 隐式重试叠加；未配置回退时仍按 retry 配置与 shouldRetry 分类处理。聊天与压缩共用 pi 的失败决策（错误分类、次数、退避、回退和耗尽提示），宿主通过同一 shouldRetry 分类函数提供策略。压缩任务在 checkpoint 固定模型链与阈值，摘要请求按相同阈值回退；阻塞压缩同步该轮运行的模型索引，后续生成继续使用成功的回退模型。手动压缩不修改正在生成的模型。

失败尝试以无 model 正文的 `pi.model-attempt` entry 记录任务、操作类型、模型、次数、错误、后续动作及退避时间/目标模型，与重试 checkpoint 或终态同事务提交；不注入对话上下文，不新增队列。压缩耗尽提示包含重试或回退耗尽原因及最后错误，原历史保留。

**模型健康与冷却。** 运行结束后按本次链的实际结果更新健康状态：以非链首条目完成，说明前面的条目在本轮不可用；以 `model_error`/`no_model` 结束，说明整条链不可用。被判定不可用的条目在 `hold` 秒（默认 600）内不作为新运行的起点：链仍按配置展开，只把被持有的条目移到健康条目之后，条目之间顺序不变；全部被持有则保持原顺序。状态按 `provider/modelId@slot` 记在 `<home>/.yonder/model-health.json`（原子写，0600），跨会话与重启保留，不写转录、不计入用量。后台每 `probe` 秒（默认 60，最小 15）对尚未到期的被持有条目发一次最小请求：单轮、无工具、不落库；成功立即清除持有，下一次运行回到主模型；失败把持有延长到 `now + hold`。探测走正常鉴权（可能刷新 OAuth），不发消息、不唤醒模型循环；进程关闭时停止计时器。

**官方用量窗口。** 供应商在正常响应里带回账户的用量窗口（`rate_limits`：`used_percent`、`window_minutes`、`resets_at`）。运行时在供应商事件上只读地取这份数据，按 `provider@slot` 记在 `<home>/.yonder/model-quota.json`，取 5 小时窗口（`window_minutes` 最接近 300 的那个），窗口重置时间缺失时按窗口长度推算。配置档 `fallback.quotaStopPercent` 给某个槽设停用线：已用百分比达到该值且窗口未重置时，该账号不参与链条排序的前半段（与失败持有同样只移到链尾）。这份数据先由正常响应只读刷新；某个槽被 `fallback.quotaStopPercent` 设线时，运行时每 60 秒向官方用量接口查一次（2026-10-27 用户批准，见 decisions），未设线时不发额外请求，接口请求本身不发起模型调用。停用与恢复都由窗口的 `resets_at` 决定，不靠探测。

### 6.2 凭据

- `default` 槽继续使用原凭据文件，不迁移或改写已有 provider 与 named secret。凭据文件采用 pi 的 `auth.json` 格式（`{ <provider>: { type: 'api_key', key } | { type: 'oauth', … } }`），键是供应商 id；路径由 `yonder.yaml` 的 `credentials` 指定，默认 `<home>/.yonder/auth.json`，权限 `0600`。密钥只放在这里，不写进 `yonder.yaml`。
- 实现 pi-ai 的 `CredentialStore`（`read`、`list`、`modify`、`delete`），复制 pi coding-agent 的 `FileAuthStorageBackend`（`proper-lockfile` 文件锁，MIT）并在 `THIRD_PARTY_NOTICES` 记录。OAuth 刷新在 `modify` 里进行并写回文件。
- ChatGPT 订阅：使用 pi-ai 内置 `openai` 供应商的 "Sign in with ChatGPT" OAuth。`yonder login <provider>` 调用 `provider.auth.oauth.login(interaction, { getDeviceId })`，`getDeviceId` 返回本 home 固定的 UUID（存于 `<home>/.yonder/device-id`，首次登录时生成）。
- 插件只能经 `api.credentials.get(name)` 只读地取一项凭据（渠道、服务的密钥都这样存取），不能写。新增渠道或服务密钥由人在本机运行 `yonder credentials set <name> --home <dir>`（09 §2）：隐藏输入、不经模型、控制接口或聊天，只创建 `api_key`，拒绝覆盖；Agent 不得代为录入或读取明文。
- OAuth 刷新会轮换 refresh token（已验证）。**禁止**复制其他程序的 OAuth 凭据；每个 Yonder home 单独登录。API key 可以复制。

模型账户槽通过 `credentialSlots: { provider: slot }` 选择，不改模型名；未列出的供应商使用 `default`，现有跨供应商 fallback 保留。同一模型换用其他账号只经 `fallback.accounts` 进入本次运行的模型链：运行时为每个被列出的槽注册只读别名供应商 `<provider>#<slot>`，别名只出现在链和运行快照里，不写进 `yonder.yaml`、不改变配置里的模型名。`fallback.accountModels` 按槽替换模型，让额度受限的账号在同一角色上跑较小模型；替换只允许同 provider，跨 provider 的映射被忽略。仍不使用全局 activeSlot 或 ALS，也不按请求轮换。按 provider 合并及 preset/按次规则见 03。运行快照冻结选择，生成、压缩、deferred poll/cancel 和模型工具使用独立绑定的 Models 与供应商工厂。

非 default 凭据存于 `<authPath>.slots/<provider>/<slot>.auth.json`，目录 0700、文件 0600、strict 安全写与跨进程锁；独立 `<slot>.meta.json` 保存 version 1 非秘密来源描述、账号 generation 与删除墓碑。槽名/provider 限小写字母数字、`_`、`-`，禁止路径穿越、保留危险键和大小写碰撞。未知、被删除或未配置的命名槽必须失败，不能借用 default/ambient 身份。每个槽独立锁，旧 default 的供应商与 named secret 仍共用原 auth 文件锁。

登录默认 create-only，覆盖须 `--replace`。网络流程在锁外，提交在锁内核对 generation；remove/replace 改变账号 generation，refresh 不改变。迟到登录不得复活已删或替换账号。取消等待不写入；刷新一旦开始继续保存轮换结果，沿用 pi 原有保护。list/status 仅白名单元数据，不解析秘密来源、不刷新、不输出 URL/code/token。env-ref 描述只存变量名，不存变量值。

命名槽的 stored key、OAuth、env-ref 与 Cloudflare 完整配置必须屏蔽 ambient 身份回落；Vertex 只接受显式绝对凭据文件、project/location。当前命名 AWS 模式支持显式 bearer/static credentials，profile/default chain 由于 SDK chain 不能证明隔离而明确拒绝，不能报告为已支持；default 原行为不变。后续 profile-only 设施另行验证，不新建进程隔离平台。

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

运行中的 harness 在 `<home>/.yonder/control.sock` 提供本地接口，CLI 的会话、身份、事件查询类命令与停止进程都经由它；没有运行中的进程时，查询类命令以只读方式直接打开存储。普通协议是一行一个 JSON 请求、一行一个 JSON 响应。渠道 chat 连接 channel-cli 插件自己的套接字；12 的任务 chat 使用控制接口驱动 task，并在独立连接观察真实会话状态与输出，不启动第二个 harness 或打开运行中数据库。观察不是等待者，不改变投递；断连不 abort，恢复依据原生转录与事实。订阅确认、关联、终态与目标查询详见 12 §7。当前验收平台为 macOS，Windows 命名管道以后定义并验证。
