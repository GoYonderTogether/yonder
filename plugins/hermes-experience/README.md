# hermes-experience（已弃用别名）

`@yonder/plugin-hermes-experience` 已改名为 [`@yonder/plugin-learning`](../learning/README.md)（插件 id `learning`）。本包只是薄别名：以旧 id `hermes-experience`、旧工具名 `hermes-experience_*` 再导出 plugin-learning 的实现，保证现有 `yonder.yaml` 继续可用。`./recipe` 子路径同样转发，绑定旧 id。`package.json` 标有 `"deprecated": true`。

加载时记一条 warn：`hermes-experience 已弃用，请改用 learning；将在 0.5 移除`。

## 弃用时间表

| 版本 | 状态 |
|---|---|
| 0.3 | 保留别名，加载时 warn |
| 0.4 | 保留别名，加载时 warn |
| 0.5 起 | 移除本包，只能使用 `@yonder/plugin-learning` |

数据位置不变：counters 仍在 `<home>/.yonder/plugins/hermes-experience/learning-state.json`，记忆、pending、技能与归档仍在原 scope 目录。

在 0.5 之前切换到新包：运行 `yonder migrate`，或按 [plugin-learning README](../learning/README.md#安装与迁移) 手动改配置。不要同时加载新旧两个包。
