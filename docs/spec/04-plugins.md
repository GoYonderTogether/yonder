# 04 插件

## 1. 插件与插件槽

- **插件**是发布单位：一个 npm 包或一个本地目录，一个清单，一个版本号。
- **插件槽**是内核定义的接口，不是目录。一个插件可以向多个槽注册多个贡献。例如 QQ 插件可以同时注册两个渠道实例、几件 QQ 专属工具、一个语音通话渠道。
- 贡献不单独定版本，随插件升级。
- 插件只依赖 `@yonder/sdk`（以及它自己需要的库）。**禁止** import pi 的包：插件 API 不随 pi 的实验性接口变动，由内核的 runtime 目录做转换。

## 2. 清单

写在 `package.json` 的 `yonder` 字段里，静态可读，加载代码前就能检查：

```json
{
  "name": "@yonder/plugin-context-files",
  "version": "0.1.0",
  "yonder": {
    "apiVersion": 1,
    "id": "context-files",
    "entry": "./dist/index.js",
    "contributes": {
      "contexts": ["agents-md", "user-md", "soul-md", "memory-md"]
    }
  }
}
```

- `id`：`[a-z][a-z0-9-]*`，全局唯一。`message`、`task`、`session`、`identity`、`agent`、`skill`、`tool` 保留给内核（它们是内置工具名的前缀）。
- `contributes`：槽名 → 贡献名列表。`channels` 与 `envs` 列的是提供者的 `type`（实例由 `yonder.yaml` 配置），其余列贡献的 id 或名字。
- 加载时内核比对实际注册与声明，不一致即拒绝加载，并说明是哪个插件、哪一项。

## 3. 插件槽

共八个：`channels`、`tools`、`contexts`、`triggers`、`envs`、`hooks`、`presets`、`skills`。下面的 TypeScript 就是 `@yonder/sdk` 导出的类型，字段不多不少。

提供者实例配置剥离用于选择提供者的 type 后再校验并传给 create。缺凭据或外部服务未就绪由官方插件返回可诊断状态，不因该依赖终止其他渠道；不提供任意插件代码的进程隔离保证。

### 3.1 channels — 收发消息

```ts
interface ChannelProvider {
  type: string;                        // 如 feishu；yonder.yaml 里 channels.<实例id>.type
  configSchema?: TSchema;              // 实例配置的 schema，加载时校验
  create(id: string, config: unknown): Channel | Promise<Channel>;   // id：实例 id，如 feishu-main
}
interface Channel {
  id: string;
  kinds: string[];                     // 会产生的 message.in kind，如 ['dm','group']
  output: { stream: boolean; attachments: boolean };
  start(io: ChannelIO): Promise<void>;
  stop(signal?: AbortSignal): Promise<void>;
  send(target: Ref, msg: OutMessage, signal?: AbortSignal): Promise<Delivery>; // conv: 发到会话；acct: 由渠道解析为该账号私聊
  stream?(conv: Ref, out: AsyncIterable<OutputPart>, replyTo?: string, signal?: AbortSignal): Promise<Delivery>;   // output.stream 为真时必须实现
}
interface ChannelIO {
  emit(e: EventInput): Promise<YEvent>;
  ask(e: EventInput): Promise<AskResult>;   // 写入并等待它唤醒的运行结束；回复交给调用方，不再发回渠道（06 §2）
}
interface AskResult { event: YEvent; results: RunResult[] }   // 每个被唤醒运行的 agent 一条；只旁观或未命中的 agent 没有
interface OutMessage { text: string; attachments?: Attachment[]; replyTo?: string }   // replyTo：被回复的渠道原生消息 id
interface Delivery { ok: boolean; id?: string; error?: string; uncertain?: boolean }           // id：渠道原生消息 id
```

- 一个插件注册提供者，`yonder.yaml` 的 `channels` 决定开几个实例：同一个 QQ 插件接两个号就是两个实例。实例 id 格式 `[a-z0-9-]+`，`agent` 保留给内核的内部渠道（06 §6）。
- 实例配置里的密钥写成凭据名（例如 `credential: feishu-main`），插件用 `api.credentials.get` 读取（07 §6.2）。
- 渠道只负责把外部消息变成 `message.in`、把输出交到外部。它**不**决定进哪个会话、要不要回复——那是绑定和投递的事（02、06）。
- 外部系统调用 agent 并要拿到返回值（例如 MCP 服务端）时，渠道用 `io.ask`。

### 3.2 tools — 模型可调用的工具

```ts
interface Tool {
  name: string;                        // `<pluginId>_<名字>`，如 qq_send_card；整体须匹配 ^[a-z][a-z0-9_-]{0,63}$
  description: string;
  parameters: TSchema;                 // TypeBox schema（typebox 包）；内核在调用前校验参数
  capabilities: Capability[];          // 需要的全部能力（05 §3），可为空数组
  execute(args: unknown, ctx: ToolContext): Promise<ToolResult>;
}
interface ToolContext {
  agent: string | null;                // 预设会话为 null
  profile: string;
  session: string;
  capabilities: Capability[];          // 本次运行生效的能力
  env: ExecutionEnv;                   // 本次运行的执行环境（05 §4）
  event?: YEvent;                      // 触发本次运行的入站事件
  signal: AbortSignal;                 // 运行被中止时触发；工具必须响应
}
interface ToolResult {
  text: string;                        // 给模型看的结果
  images?: Array<{ mime: string; data: string }>;   // base64
  isError?: boolean;
  attachments?: Attachment[];            // 明确交付的真实产物引用
}
```

工具名只用下划线与连字符，不用点：OpenAI、Anthropic 只接受 `^[a-zA-Z0-9_-]+$`（T02 规划时用 `gpt-6-luna` 验证，带点的名字返回 400）。内核内置工具同样如此：`message_send`、`task_run`、`session_*`、`identity_*`；pi 自带的 `read`、`write`、`edit`、`bash`、`tool_search` 保留原名。配置档里的 `tools` 通配（如 `qq_*`）按这个名字匹配。

注册：`api.tools.register(tool)`。runtime 把它转换成 pi 的工具（07 §3）。工具抛出异常等同于 `isError: true`，异常消息即 `text`。

### 3.3 contexts — 进入提示词的内容

```ts
interface ContextContribution {
  id: string;
  placement: 'system' | 'turn';
  files?: Array<{ path: string; template?: string; scaffold: boolean; protect?: Capability }>;
  render(ctx: RenderContext): string | undefined | Promise<string | undefined>;
}
interface RenderContext {
  agent: string;
  profile: string;
  session: string;
  workspace: { read(path: string): Promise<string | undefined> };   // 相对工作区根；不存在返回 undefined
  event?: YEvent;                      // 仅 placement: turn，当前入站事件
  signal?: AbortSignal;                // 本次有限渲染预算；外部 IO 应响应
}
```

- `files`：贡献要用的工作区文件。`scaffold: true` 时，agent 选用了这个贡献而文件不存在，内核按 `template` 生成；`protect` 指定修改它所需的能力（默认 `write`）。
- `render` 返回 `undefined` 表示本次不贡献内容。`placement: system` 的贡献必须遵守 03 §5.1 的确定性规则，因此拿不到 `event`。
- 只有 agent 或配置档的 `contexts` 列出了的贡献才会被调用（架构不变量 3）。

### 3.4 triggers — 定时、文件变化、Webhook 等事件源

```ts
interface Trigger { id: string; start(io: { emit(e: EventInput): Promise<YEvent> }): Promise<void>; stop(): Promise<void> }
```

触发器产生插件自定义类型的事件（如 `trigger-cron.fired`），`conv` 为 `conv:<triggerId>:<name>`。

### 3.5 envs — 执行环境

```ts
interface EnvProvider { type: string; configSchema?: TSchema; create(id: string, config: unknown): Promise<ExecutionEnv> }
```

`ExecutionEnv` 是 pi-durable 的执行环境接口，由 `@yonder/sdk` 以纯类型重新导出（05 §4）。

### 3.6 hooks — 介入运行

```ts
interface Hook {
  id: string;
  beforeTool?(call: ToolCall, ctx: ToolContext): HookResult<{ block: string } | { args: object }>;
  afterTool?(call: ToolCall, result: ToolResult, ctx: ToolContext): HookResult<{ result: ToolResult }>;
  beforeRequest?(messages: Message[], ctx: ToolContext): HookResult<{ messages: Message[] }>;
}
interface ToolCall { id: string; name: string; args: object }
type HookResult<T> = T | undefined | Promise<T | undefined>;
```

`Message` 是 pi-ai 的消息类型，由 `@yonder/sdk` 以纯类型重新导出。映射到 pi-durable 的同名钩子。内核自带的安全与上限钩子总是最先执行，插件钩子不能放行内核已拦下的调用。审批、审计、沙箱策略这类功能都写成钩子插件。

### 3.7 presets — 预设（数据贡献）

插件可以贡献预设（03 §4），格式与 `presets/*.yaml` 相同：`api.presets.register({ id, ...字段 })`。

### 3.8 skills — skill（数据贡献）

`api.skills.register(dir)`：`dir` 是插件包内的一个目录，其中每个含 `SKILL.md` 的子目录是一个 skill（03 §6）。清单的 `contributes.skills` 列出这些 skill 的 `name`。

## 4. 插件 API

```ts
interface PluginAPI {
  id: string;
  config: unknown;                     // 它在 yonder.yaml 里的 config 段，已按 configSchema 校验
  log: { info(msg: string, data?: object): void; warn(msg: string, data?: object): void; error(msg: string, data?: object): void };
  channels: { register(c: ChannelProvider): void };
  tools: { register(t: Tool): void };
  contexts: { register(c: ContextContribution): void };
  triggers: { register(t: Trigger): void };
  envs: { register(e: EnvProvider): void };
  hooks: { register(h: Hook): void };
  presets: { register(p: Preset): void };
  skills: { register(dir: string): void };
  events: {
    emit(e: EventInput): Promise<YEvent>;
    ask(e: EventInput): Promise<AskResult>;                              // §3.1
    query(q: EventQuery): Promise<EventPage>;                            // 01 §4
    on(type: string, handler: (e: YEvent) => void | Promise<void>): void;   // type 可为 'prefix.*'；见下
  };
  messages: { send(m: { to: Ref; via?: string; text: string; attachments?: Attachment[] }): Promise<Delivery> };   // 全局插件无 owner；传 person:/acct:/conv:，06 §5
  credentials: { get(name: string): Promise<Credential | undefined> };   // 凭据文件里的一项，只读（07 §6.2）
  sessions: SessionsAPI;               // 02 §5
  identity: IdentityAPI;               // 02 §4.4
  services: { resolve(capability: string): Promise<ServiceEndpoint | undefined> };            // 每次读取当前凭据，07 §6.3
  models: Models;                      // pi-ai 的模型集合，纯类型重新导出
  paths: { data: string };             // <home>/.yonder/plugins/<id>/
}
interface PluginModule { setup(api: PluginAPI): void | Promise<void>; configSchema?: TSchema }
```

- `events.on`：事件写入并完成路由之后调用，只观察、不能拦截或修改；同一插件内按事件顺序逐个调用，处理器抛错只记日志。只能在 `setup` 里注册，收到的是进程启动之后写入的事件（之前的用 `query`）。
- `Credential` 是 pi 的凭据类型（`{ type: 'api_key', key, env? } | { type: 'oauth', … }`），由 `@yonder/sdk` 以纯类型重新导出。
- entry 的默认导出是 `PluginModule`。`definePlugin(m)` 原样返回 `m`，只做类型约束；`defineChannel`、`defineTool`、`defineContext`、`defineTrigger`、`defineHook` 同理。
- `defineChannel` 约束 `ChannelProvider`。插件发送使用显式目标，不把全局插件关联到某个默认 agent。
- `Preset` 的字段见 03 §4。
- 插件**禁止**直接打开内核的 SQLite 表或 pi-durable 的存储。

## 5. 生命周期

1. **加载**：读清单 → 检查 `apiVersion` → 导入 entry → 按 `configSchema` 校验插件配置 → 调用 `setup(api)`。`setup` 只能注册，不能联网、不能开定时器、不能发事件。
2. **检查**：比对声明与注册。
3. **启动**：按 `yonder.yaml` 的 `channels`、`envs` 用提供者创建实例（先按 `configSchema` 校验实例配置），再调用渠道与触发器的 `start`。
4. **停止**：反向调用 `stop`。

插件代码不热重载。插件配置变更需要重启；`agent.yaml`、`presets/` 热重载（08 §3）。

setup 无副作用是可信插件的开发契约；内核在 setup 阶段拒绝通过 PluginAPI 发事件、发消息或修改会话/身份。0.1 不拦截 Node 全局网络或定时器，不增加插件沙箱。包名从 home 或当前安装的依赖解析，本地插件目录相对 home；内置 local 环境不需要插件。checkPlugin 与加载器共用注册检查规则。

## 6. 版本

- `apiVersion` 是整数，内核声明它支持的集合；不在集合内的插件拒绝加载，并说明需要哪个版本。当前为 `1`。
- 插件 API 的不兼容变更（包括 01 §5 列出的事件变更）必须提升 `apiVersion`。
- 包版本用 semver。0.x 期间 MINOR 可以不兼容，但必须写迁移说明；1.0 在至少三个真实插件（含一个渠道、一个执行环境）不改接口地跑通后冻结。

## 7. 契约测试

`@yonder/sdk/testing` 提供 `checkPlugin(dir): Promise<string[]>`：读清单、加载、用一个只记录注册的 `PluginAPI` 调用 `setup`、比对声明与注册、检查每个工具都声明了 `capabilities` 且名字以 `<pluginId>_` 开头并符合 §3.2 的格式、检查 `apiVersion` 在支持集合内。返回问题列表，空列表表示通过。每个插件的测试都必须调用它。

## 8. 留给以后的能力用哪个接口

下表是扩展槽的归属。当前批准的官方插件按 11 实现；其余能力仅保留扩展入口。具体供应商能力写插件，只有规范已批准且现有公共契约确实不足的部分才修改 SDK/共享内核。

| 能力 | 用到的接口 | 做法 |
|---|---|---|
| 远程主机、多设备 | `envs`；`yonder.yaml` 的 `envs`；配置档 `env`；工作区 = 执行环境 + 路径（03 §2.1） | 插件实现 pi 的 `ExecutionEnv`（pi-env 已有远程实现可包装）；agent 的工作区可以只在远程 |
| 容器沙箱 | 同上 | `type: container` 的执行环境插件 |
| 审批 | `hooks.beforeTool`（可异步）+ `messages.send` + `events.on` | 调用前给主人发卡片，等卡片按钮事件，再返回放行或 `block`；等待受墙钟上限约束 |
| 记忆 | `contexts`（`placement: turn`，按 `event.from` 的人召回）+ `tools` + `events.on`（摄入消息） | 每条记忆带引用（02 §4.3） |
| 工作流 | `triggers` + `events.on`（如 `run.end`）+ `events.ask` + `sessions`（预设会话） | 代码驱动的编排；模型驱动的编排用 skill（03 §6） |
| 外部经 MCP 调用我们的 agent | `channels` + `io.ask` | MCP 服务端渠道插件；要开放会话管理时把 `api.sessions` 映射成 MCP 工具 |
| 我们调用外部 MCP 工具 | `tools` | 每个 MCP 工具注册为 `<pluginId>_<name>`，配置档用 `tools.search` 按需加载 |
| 语义级防空转、审计 | `hooks` | 钩子插件 |
| 飞书卡片等富消息 | `tools` | 渠道插件自带的工具，如 `feishu_send_card` |

## 9. 本地插件管理补齐

已批准 13 §3.1 的 list/show/add/remove 是本页加载/清单规则的管理入口；yonder.yaml.plugins 仍是唯一加载名单。候选完整校验、存在引用拒绝移除、不自动重启、不删外部源码/私有数据；不增加 enabled 状态表、Hub 或热卸载。

## R0 发送与可省略配置（D34）

PluginAPI.messages.send(request, ctx?: ToolContext) 的可选 ctx 仅供模型工具将实际 execute 上下文原样交回内核。传入时必须是本次 runtime 生成的有效上下文，内核统一执行来源/message、附件 read/真实路径及执行环境检查，发送归属真实 session/agent；不能接受模型提供的伪造上下文。未带 ctx 的可信插件主动发送仍绑定 plugin 身份。

Delivery.uncertain:true 表示副作用可能已发生但无法确认，必须 ok:false；id 可保留已知部分发送身份。明确拒绝是 ok:false 且无 uncertain。内核根据结构化字段保存 unknown，不根据中文错误前缀判定，不自动重发。

插件配置省略时按空对象交给对象 schema 与 setup；schema 中真正 required 的字段仍校验失败，不跳过校验。

## D35 渠道自动回复来源

OutMessage可携带sourceMessageId表示自动回复所回答的原始消息；不等同于显式replyTo。stream既有第三参数表示自动回复源消息，渠道决定引用呈现。CLI命令名字/描述共用SDK静态清单；飞书只执行11明确的已有命令子集，不复制TUI交互或新增任意控制代理。
