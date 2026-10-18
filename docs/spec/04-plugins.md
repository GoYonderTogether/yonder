# 04 插件

## 1. 插件与插件槽

- **插件**是发布单位：一个 npm 包或一个本地目录，一个清单，一个版本号。
- **插件槽**是内核定义的接口，不是目录。一个插件可以向多个槽注册多个贡献。例如 QQ 插件可以同时注册两个渠道实例、几件 QQ 专属工具、一个语音通话渠道。
- 贡献不单独定版本，随插件升级。

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

- `id`：`[a-z][a-z0-9-]*`，全局唯一。
- `contributes`：槽名 → 贡献名列表。贡献名由配置决定的（例如渠道实例 id 来自用户配置）写 `["*"]`。
- 加载时内核比对实际注册与声明，不一致即拒绝加载，并说明是哪个插件、哪一项。

## 3. 插件槽

共七个。接口用 TypeScript 写在 `@yonder/sdk` 里，这里只列语义。

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
```

渠道只负责把外部消息变成 `message.in`、把输出交到外部。它**不**决定进哪个会话、要不要回复——那是绑定和投递的事（02、06）。

### 3.2 tools — 模型可调用的工具

工具就是 pi-durable 的工具定义，外加 Yonder 必需的元数据：

```ts
api.tools.register(tool, { capabilities: ['read'] });   // 05 §3
```

工具执行时可经 `yonderContext(api)` 取得当前 agent、配置档、会话、能力、执行环境与本轮入站事件。

### 3.3 contexts — 进入提示词的内容

```ts
interface ContextContribution {
  id: string;
  placement: 'system' | 'turn';
  files?: Array<{ path: string; template?: string; scaffold: boolean; protect?: Capability }>;
  render(ctx: RenderContext): string | undefined | Promise<string | undefined>;
}
```

- `files`：贡献要用的工作区文件。`scaffold: true` 时，agent 选用了这个贡献而文件不存在，内核按 `template` 生成；`protect` 指定修改它所需的能力（默认 `write`）。
- `render` 返回 `undefined` 表示本次不贡献内容。`placement: system` 的贡献必须遵守 03 §5.1 的确定性规则。
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

`ExecutionEnv` 就是 pi-durable 的执行环境接口（05 §4）。

### 3.6 hooks — 介入运行

```ts
interface Hook {
  id: string;
  beforeTool?(call, ctx): { block: string } | { args: object } | undefined;
  afterTool?(call, result, ctx): { result } | undefined;
  beforeRequest?(messages, ctx): { messages } | undefined;
}
```

映射到 pi-durable 的同名钩子。内核自带的安全与上限钩子总是最先执行，插件钩子不能放行内核已拦下的调用。审批、审计、沙箱策略这类功能都写成钩子插件。

### 3.7 presets — 预设（数据贡献）

插件可以贡献预设（03 §4），格式与 `presets/*.yaml` 相同。

## 4. 插件 API

`setup(api)` 收到的对象：

| 成员 | 用途 |
|---|---|
| `id`、`config`、`log` | 本插件 id、它在 `yonder.yaml` 里的配置段、日志 |
| `channels / tools / contexts / triggers / envs / hooks / presets .register()` | 注册贡献 |
| `events.emit / events.query` | 写入插件自定义事件、查询事件（01 §4） |
| `sessions` | 会话接口（02 §5） |
| `identity` | 账号、人、关联、查询（02 §4） |
| `services.resolve(capability)` | 取得非对话类服务的端点与凭据：asr、tts、embedding、rerank……（07 §6.3） |
| `models` | pi-ai 的模型集合，供插件自己调用模型 |
| `paths.data` | 本插件私有的数据目录（`<home>/.yonder/plugins/<id>/`） |

插件**禁止**直接打开内核的 SQLite 表或 pi-durable 的存储。

## 5. 生命周期

1. **加载**：读清单 → 检查 `apiVersion` → 导入 entry → 调用 `setup(api)`。`setup` 只能注册，不能联网、不能开定时器、不能发事件。
2. **检查**：比对声明与注册；校验插件配置（插件可导出 TypeBox schema）。
3. **启动**：调用渠道与触发器的 `start`。
4. **停止**：反向调用 `stop`。

插件代码不热重载。插件配置变更需要重启；`agent.yaml`、`presets/` 热重载（08 §3）。

## 6. 版本

- `apiVersion` 是整数，内核声明它支持的集合；不在集合内的插件拒绝加载，并说明需要哪个版本。
- 插件 API 的不兼容变更（包括 01 §5 列出的事件变更）必须提升 `apiVersion`。
- 包版本用 semver。0.x 期间 MINOR 可以不兼容，但必须写迁移说明；1.0 在至少三个真实插件（含一个渠道、一个执行环境）不改接口地跑通后冻结。

## 7. 契约测试

`@yonder/sdk/testing` 提供 `checkPlugin(dir)`：读清单、加载、调用 `setup`、比对声明与注册、检查工具都声明了能力。每个插件的测试都必须调用它。
