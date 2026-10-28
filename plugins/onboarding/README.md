# onboarding

首次运行引导插件 `@yonder/plugin-onboarding`，id `onboarding`（统一客户端 design §5.3）。`init` 的默认发行包加载它，并让管家 agent `main` 选入它和 `tasks`。

- 触发器 `onboarding-start`：启动时若引导未完成、未被主人关闭、该 agent 的默认模型有凭据，且距上次唤醒满 24 小时、累计不到 5 次，写事件 `onboarding.start`（conv `conv:onboarding:<agent>`），由 `main` 的 `onboarding` 绑定唤醒管家。上限保证模型失败时不会每次启动都重试。
- 工具 `onboarding_probe`（read、admin，只读）：经内核 `api.host.status` 读模型、渠道（含随包未启用）、网关、凭据槽（只有是否已配置）、插件，返回有序清单与各项已记录的任务 id。
- 工具 `onboarding_record`（write、admin）：记录某项对应的任务（`{item, task, list}`，list 为 `todo` 或 `tasks`），`{done: true}` 结束引导并写事件 `onboarding.done`，`{dismissed: true}` 记录主人关闭引导。两个工具只服务配置的 agent。
- 技能 `onboarding`：按清单建任务（有会话 todo 工具用它，否则用 tasks 账本），一次问一个问题。

状态保存在 `<paths.data>/agents/<agent>.json`（`tasks`、`done`、`dismissed`、`wakes`、`lastWake`），读改写串行执行，重复调用不会重复建任务；会话 todo 里已删除的任务会重新列入 `needsTask`。配置：`agent`（默认 `main`）、`enabled`（默认 true，设 `false` 完全不唤醒）。
