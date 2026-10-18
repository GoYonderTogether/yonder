# T02 SDK 类型与契约测试

**依据**
- `docs/spec/04-plugins.md:1-144`（全文）
- `docs/spec/01-events.md:3-85`（事件、引用、内核类型）
- `docs/spec/02-sessions.md:135-151`（§5 会话接口）
- `docs/spec/05-security.md:5-32`（能力与级别）
- `docs/spec/06-delivery.md:26-39`（`OutputPart`）

**路径**：`packages/sdk/`

**必须**
- 导出规范中出现的全部类型：`YEvent`、`EventInput`、`Ref`、`Route`、`Attachment`、`Channel`、`OutMessage`、`Delivery`、`OutputPart`、`ContextContribution`、`RenderContext`、`Trigger`、`EnvProvider`、`Hook`、`Capability`、`Level`、`SessionsAPI`、`SessionInfo`、`IdentityAPI`、`PluginAPI`、`PluginModule`。
- `definePlugin`、`defineChannel` 等只做类型约束的辅助函数。
- 引用的构造与解析函数（`acct()`、`conv()`、`parseRef()`），格式严格按 `01-events.md:23-39`。
- `@yonder/sdk/testing` 的 `checkPlugin(dir)`，行为按 `04-plugins.md:142-144`。

**禁止**：运行时逻辑（除引用解析与 `checkPlugin`）；规范没有的类型字段。

**验收**：`checkPlugin` 对"声明与注册一致"的插件返回空列表，对"多注册""少注册""工具未声明能力""apiVersion 不支持"四种情况分别返回对应错误；引用解析覆盖规范表格里的每种格式。

## 问题

（无）
