# T06 插件加载

**依据**：`docs/spec/04-plugins.md`（全文）、`docs/spec/08-config.md`（`plugins`、`channels`、`envs` 配置）

**路径**：`packages/core/src/plugins/`、`packages/core/test/fixtures/`

**必须**
- 解析 `use`（包名或本地目录），读清单，检查 `apiVersion` 与保留 id，导入 entry，调用 `setup(api)`；按 `configSchema` 校验插件配置。
- 给每个插件构造 `PluginAPI`（04 §4 的每个成员），注册进内核的各槽注册表（含 `skills` 目录登记）。`sessions`、`identity`、`events`、`messages`、`credentials`、`services`、`models` 的实现由内核其他部分提供：本任务定义 `KernelServices` 接口并据此构造，由 T11 组装内核时传入真实实现。
- 比对声明与注册；同名贡献冲突时报出双方插件 id。
- 渠道与执行环境实例：按 `yonder.yaml` 的 `channels`、`envs` 找到提供者，按其 `configSchema` 校验实例配置后 `create`；`type` 没有提供者时报错。
- `events.on` 的分发器：按注册顺序、每个插件内按事件顺序调用，处理器异常只记日志（04 §4）。
- 生命周期：启动渠道与触发器、反向停止。setup 阶段通过 PluginAPI 发事件、发消息或修改会话/身份时失败；禁止联网和定时器属于插件契约，不增加沙箱或全局拦截。

**禁止**：热重载插件代码；插件访问内核存储的后门。

**验收**：用 T10 的两个插件与若干测试夹具插件（放在 `packages/core/test/fixtures/`，只用于验证加载规则，不含业务内容）覆盖：正常加载、apiVersion 不符、保留 id、多注册、少注册、重名、渠道实例配置不合法、`events.on` 的顺序与异常隔离。

## 问题

（无）
