# hermes-experience（已弃用别名）

`@yonder/plugin-hermes-experience` 已改名为 [`@yonder/plugin-learning`](../learning/README.md)（插件 id `learning`）。本包只是薄别名：以旧 id `hermes-experience`、旧工具名 `hermes-experience_*` 再导出 plugin-learning 的实现，加载时记一条 deprecation warn，保证现有 `yonder.yaml` 继续可用。`./recipe` 子路径同样转发，绑定旧 id。

数据位置不变：counters 仍在 `<home>/.yonder/plugins/hermes-experience/learning-state.json`，记忆、pending、技能与归档仍在原 scope 目录。

切换到新包的步骤与随 id 变化的配置项见 [plugin-learning README](../learning/README.md#安装与迁移)。不要同时加载新旧两个包。别名不打算长期保留（design §3.4 不做长期 id 别名机制），后续由 `yonder migrate` 收尾。
