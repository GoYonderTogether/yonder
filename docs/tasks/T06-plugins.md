# T06 插件加载

**依据**：`docs/spec/04-plugins.md:1-144`（全文）、`docs/spec/08-config.md:19-63`（`plugins`、`channels` 配置）

**路径**：`packages/core/src/plugins/`

**必须**
- 解析 `use`（包名或本地目录），读清单，检查 `apiVersion`，导入 entry，调用 `setup(api)`。
- 给每个插件构造 `PluginAPI`（04 §4 的每个成员），注册进内核的各槽注册表。
- 比对声明与注册；同名贡献冲突时报出双方插件 id。
- 生命周期：启动渠道与触发器、反向停止。
- 渠道实例：按 `yonder.yaml` 的 `channels` 把实例 id 与插件对应。
- 插件 `setup` 里联网、开定时器、发事件都应失败并报错。

**禁止**：热重载插件代码；插件访问内核存储的后门。

**验收**：用 T10 的两个插件与若干测试夹具插件（放在 `packages/core/test/fixtures/`，只用于验证加载规则，不含业务内容）覆盖：正常加载、apiVersion 不符、多注册、少注册、重名。

## 问题

（无）
