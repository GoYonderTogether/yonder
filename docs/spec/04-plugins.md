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

- `id`：`[a-z][a-z0-9-]*`，全局唯一。`message`、`task`、`session`、`identity`、`tool` 保留给内核（它们是内置工具名的前缀）。
- `contributes`：槽名 → 贡献名列表。贡献名由配置决定的（例如渠道实例 id 来自用户配置）写 `["*"]`。
- 加载时内核比对实际注册与声明，不一致即拒绝加载，并说明是哪个插件、哪一项。

## 3. 插件槽

共七个：`channels`、`tools`、`contexts`、`triggers`、`envs`、`hooks`、`presets`。下面的 TypeScript 就是 `@yonder/sdk` 导出的类型，字段不多不少。

### 3.1 channels — 收发消息

```ts
interface Channel {
  id: string;                          // 实例 id，如 qq-main
  kinds: string[];                     // 会产生的 message.in kind，如 ['dm','group']
  output: { stream: boolean; attachments: boolean };
  start(io: { emit(e: EventInput): Promise<YEvent> }): Promise<void>;
  stop(): Promise<void>;
  send(conv: Ref, msg: OutMessage): Promise<Delivery>;
  stream?(conv: Ref, out: AsyncIterable<OutputPart>): Promise<Delivery>;   // output.stream 为真时必须实现
}
interface OutMessage { text: string; attachments?: Attachment[] }
interface Delivery { ok: boolean; id?: string; error?: string }           // id：渠道原生消息 id
```

渠道只负责把外部消息变成 `message.in`、把输出交到外部。它**不**决定进哪个会话、要不要回复——那是绑定和投递的事（02、06）。

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
interface EnvProvider { type: string; create(id: string, config: unknown): Promise<ExecutionEnv> }
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

## 4. 插件 API

```ts
interface PluginAPI {
  id: string;
  config: unknown;                     // 它在 yonder.yaml 里的 config 段，已按 configSchema 校验
  log: { info(msg: string, data?: object): void; warn(msg: string, data?: object): void; error(msg: string, data?: object): void };
  channels: { register(c: Channel): void };
  tools: { register(t: Tool): void };
  contexts: { register(c: ContextContribution): void };
  triggers: { register(t: Trigger): void };
  envs: { register(e: EnvProvider): void };
  hooks: { register(h: Hook): void };
  presets: { register(p: Preset): void };
  events: { emit(e: EventInput): Promise<YEvent>; query(q: EventQuery): Promise<EventPage> };   // 01 §4
  sessions: SessionsAPI;               // 02 §5
  identity: IdentityAPI;               // 02 §4.4
  services: { resolve(capability: string): ServiceEndpoint | undefined };                      // 07 §6.3
  models: Models;                      // pi-ai 的模型集合，纯类型重新导出
  paths: { data: string };             // <home>/.yonder/plugins/<id>/
}
interface PluginModule { setup(api: PluginAPI): void | Promise<void>; configSchema?: TSchema }
```

- entry 的默认导出是 `PluginModule`。`definePlugin(m)` 原样返回 `m`，只做类型约束；`defineChannel`、`defineTool`、`defineContext`、`defineTrigger`、`defineHook` 同理。
- `Preset` 的字段见 03 §4。
- 插件**禁止**直接打开内核的 SQLite 表或 pi-durable 的存储。

## 5. 生命周期

1. **加载**：读清单 → 检查 `apiVersion` → 导入 entry → 调用 `setup(api)`。`setup` 只能注册，不能联网、不能开定时器、不能发事件。
2. **检查**：比对声明与注册；按 `configSchema` 校验插件配置。
3. **启动**：调用渠道与触发器的 `start`。
4. **停止**：反向调用 `stop`。

插件代码不热重载。插件配置变更需要重启；`agent.yaml`、`presets/` 热重载（08 §3）。

## 6. 版本

- `apiVersion` 是整数，内核声明它支持的集合；不在集合内的插件拒绝加载，并说明需要哪个版本。当前为 `1`。
- 插件 API 的不兼容变更（包括 01 §5 列出的事件变更）必须提升 `apiVersion`。
- 包版本用 semver。0.x 期间 MINOR 可以不兼容，但必须写迁移说明；1.0 在至少三个真实插件（含一个渠道、一个执行环境）不改接口地跑通后冻结。

## 7. 契约测试

`@yonder/sdk/testing` 提供 `checkPlugin(dir): Promise<string[]>`：读清单、加载、用一个只记录注册的 `PluginAPI` 调用 `setup`、比对声明与注册、检查每个工具都声明了 `capabilities` 且名字以 `<pluginId>_` 开头并符合 §3.2 的格式、检查 `apiVersion` 在支持集合内。返回问题列表，空列表表示通过。每个插件的测试都必须调用它。
