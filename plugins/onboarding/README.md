# onboarding

首次运行引导插件 `@yonder/plugin-onboarding`，id `onboarding`（统一客户端 design §5.3）。`init` 的默认发行包加载它，并让管家 agent `main` 选入它和 `tasks`。

- 触发器 `onboarding-start`：每次启动时，若 `main` 还没完成引导，写事件 `onboarding.start`（conv `conv:onboarding:main`），由 `main` 的 `onboarding` 绑定唤醒管家。
- 工具 `onboarding_probe`（read、admin，只读）：经内核 `api.host.status` 读模型、渠道（含随包未启用）、网关、凭据槽（只有是否已配置）、插件，返回有序清单与各项已记录的任务 id。
- 工具 `onboarding_record`（write、admin）：记录某项对应的任务 id，或用 `{done: true}` 结束引导并写事件 `onboarding.done`。
- 技能 `onboarding`：按清单建任务（有会话 todo 工具用它，否则用 tasks 账本），一次问一个问题。

状态保存在 `<paths.data>/agents/<agent>.json`（`tasks` 与 `done`），重复调用不会重复建任务；`done` 后不再唤醒。配置可选 `agent`（默认 `main`）。
