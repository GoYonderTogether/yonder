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

- `channels`/`envs` 实例配置里的 `type` 是提供者选择字段；规范未说明它是否也传入提供者的 `configSchema` 和 `create`。当前实现剥离 `type` 后校验并传入配置对象，第二轮确认该约定。

## 结果（第一轮，已实现待验收）

- 新增 `loadPlugins(home, config, services)`：从 home 解析本地插件或包名（home 优先，当前安装依赖回退），读取清单、导入 entry、校验插件配置并且只调用一次 `setup`；复用 SDK 的 `readPluginManifest`、`createRegistrationCollector`、`checkRegistrations`。
- 构造完整 `PluginAPI`，记录八个槽；拒绝 setup 阶段通过 API 写事件/消息/会话/身份，并拒绝 setup 后注册贡献或事件监听。跨插件同槽同名冲突报出双方 id。渠道与执行环境实例按 type 查提供者并验证配置后创建；内置 `envs.local` 留给 runtime。
- `KernelServices.messages.send(message, pluginId)` 将当前插件 id 交给内核发送服务，T11 接入 `delivery.sendPlugin(id, msg)`，使 `message.out.from` 能记录为 `plugin:<id>`；SDK 的公开 `PluginAPI.messages.send(message)` 类型保持不变。
- 返回实例 channels/envs、按插件分组的 tools/hooks、contexts/presets、skillDirs，以及按序 `start`、反序 `stop`、按注册顺序 `observe`。事件监听器按精确类型或 `prefix.*` 匹配；单个处理器报错仅记录日志并继续。
- 实际检查：`npm run build` 通过；`npx vitest run packages/core/src/plugins/index.test.ts` 通过（1 文件、1 测试），使用 T10 两插件检查加载、通道实例创建、上下文登记和 local 环境旁路。测试未调用的服务方法均抛错，未以假成功结果代替实现。
- 原定各类插件错误夹具、实例 schema 失败、生命周期次序与事件观察异常隔离等复杂验收留第二轮；本轮未接入 T11 服务组装。
