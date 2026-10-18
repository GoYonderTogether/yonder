# T02 SDK 类型与契约测试

**依据**
- `docs/spec/04-plugins.md`（插件槽、`Tool`、`ChannelProvider`、`PluginAPI`、`PluginModule`、契约测试）
- `docs/spec/01-events.md`（`YEvent`、`EventInput`、引用、内核事件 data、`EventQuery`/`EventPage`）
- `docs/spec/02-sessions.md`（`Route`）、`145-199`（`IdentityAPI` 与会话接口的类型）
- `docs/spec/03-agents.md`（`Profile` 字段、`Preset`）、`121-151`（skill 格式，供 `checkPlugin`）
- `docs/spec/05-security.md`（能力与级别）
- `docs/spec/06-delivery.md`（`OutputPart`）
- `docs/spec/07-runtime.md`（`ServiceEndpoint`）

**路径**：`packages/sdk/`

**必须**
- 导出上述规范里以 TypeScript 写出的全部类型，字段与规范逐字一致：`YEvent`、`EventInput`、`EventQuery`、`EventPage`、`Ref`、`Route`、`Attachment`、`ChannelProvider`、`Channel`、`ChannelIO`、`AskResult`、`OutMessage`、`Delivery`、`OutputPart`、`Tool`、`ToolContext`、`ToolResult`、`ToolCall`、`ContextContribution`、`RenderContext`、`Trigger`、`EnvProvider`、`Hook`、`HookResult`、`Profile`、`Preset`、`Capability`、`Level`、`Mode`、`SessionsAPI`、`SessionInfo`、`Input`、`RunResult`、`TranscriptItem`、`IdentityAPI`、`AccountInfo`、`PersonInfo`、`Lookup`、`ServiceEndpoint`、`PluginAPI`、`PluginModule`。内核事件的 data（01 §3 的每一行）各导出一个类型。
- 纯类型重新导出：pi-ai 的 `Message`、`Models`、`Credential`，pi-durable 的 `ExecutionEnv`，typebox 的 `TSchema`。`package.json` 依赖 `@earendil-works/pi-ai`、`@earendil-works/pi-durable`（1.3.0）、`typebox`（1.3.27，与 pi-ai 相同），源码里对它们**只允许** `import type`。
- `definePlugin`、`defineChannel`、`defineTool`、`defineContext`、`defineTrigger`、`defineHook`：原样返回参数，只做类型约束。
- 引用函数：`acct(channel, id)`、`conv(channel, id)`、`person(id)`、`agent(id)`、`session(id)`、`plugin(id)`、`parseRef(ref)`，格式严格按 `01-events.md:24-40`。
- `@yonder/sdk/testing` 的 `checkPlugin(dir)`，按 `04-plugins.md:212-215`；支持的 `apiVersion` 集合为 `[1]`；`contributes.channels`/`envs` 与注册的提供者 `type` 比对；`contributes.skills` 与 `skills.register` 目录中 `SKILL.md` 的 `name` 比对（frontmatter 用 `yaml@2.9.1` 解析）。

**禁止**：运行时逻辑（除引用函数与 `checkPlugin`）；规范没有的类型或字段；值形式 import pi 或 typebox。

**验收**（`vitest`，不需要模型）
- `checkPlugin` 对"声明与注册一致"的插件返回空列表；对下列情况各返回一条指明插件与项目的错误：多注册、少注册、工具未声明 `capabilities`、工具名不以 `<pluginId>_` 开头或不符合格式、`apiVersion` 不支持、插件 id 是保留字、声明的 skill 与目录里的不一致。测试插件放在 `packages/sdk/test/fixtures/`，是可加载的真实小插件，不是模拟对象。
- 引用函数覆盖 01 §2 表格的每种格式，以及 `<id>` 内含冒号、`<channel>` 不合法、`<id>` 含空白。
- `npm run build && npm run typecheck && npm test && npm run lint` 通过。

## 问题

2026-10-18 主 agent 源码审查已完成；本任务的当前评估、实现缺口及设计问题见 [第一轮源码审查](review-first-pass.md)。保持原验收状态；以下为第一轮原记录，不代表审查后全部问题已解决。

（无）

## 结果（第一轮，已实现待验收）

- 导出冻结规范的 SDK 类型、八种内核事件 data、六个原样返回的 define 辅助函数和 Ref 构造/解析函数；pi 与 typebox 均为纯类型引用。
- 实现 `@yonder/sdk/testing` 的 `checkPlugin`；加载器可复用 `readPluginManifest`、`createRegistrationCollector`、`checkRegistrations`，共用清单、贡献、工具与 skill 检查，不重复执行 setup。检查器仅登记贡献，不运行渠道或模型。
- 依赖精确声明为 pi-ai/pi-durable `1.3.0`、typebox `1.3.27`、yaml `2.9.1`。yaml 用于规范要求的 skill frontmatter 解析；锁文件由主 agent 统一更新。
- 实际检查：`npm run build`、`npm run typecheck` 通过；`npx vitest run packages/sdk/test/contracts.test.ts` 为 1 文件、1 测试通过；定点 `npx biome check --write packages/sdk/src packages/sdk/test packages/sdk/package.json` 通过。首次构建发现 ExecutionEnv 不从 pi-durable 根入口导出，已改为其 `/env` 纯类型入口；首次 lint 的格式和导入顺序已修正。
- 未测：原验收全部异常夹具、完整测试与全仓 lint 留第二轮；本轮最小检查覆盖引用合法/非法输入、define 原样返回、真实插件加载和声明缺项错误。未调用模型，无设计偏离。
