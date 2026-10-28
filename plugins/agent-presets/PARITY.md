# pi 前 50 插件对齐审计

依据 `proposals/unified-client/research/C2-plugins.md`、`E1-pi-parity-inventory.md`、`H2-pi-alignment.md` 与 `agent-parity.md` §2；C2 样本只成功解析 453/1000 个包，scoped 包可能漏排。下表是能力取舍，不表示改写已经实现，也不删除现有插件。

| pi 插件 | 决定 | Yonder 对应与原因 |
|---|---|---|
| billion-context | 改写 | 内核会话压缩已有基础；参考可逆折叠与检索，不引入其 HTTP 代理。 |
| pi-mcp-adapter、pi-mcp-extension | 保留 | `mcp-client` 已覆盖 MCP 客户端，不再引入第二套适配器。 |
| pi-web-access、pi-web-search | 改写 | 保留 `web-tools`，按需参考抓取和分页，不引入 cookie 读取。 |
| pi-subagents | 改写 | 复用内核任务与会话模型，不搬运外部进程、worktree 和 watchdog。 |
| @juicesharp/rpiv-ask-user-question、pi-interview | 保留 | `interaction` 覆盖结构化提问；不复制独立提问系统。 |
| @juicesharp/rpiv-todo、pi-goal-x | 改写 | 对齐 `tasks` 的任务账本；不复制独立目标状态机。 |
| pi-background-tasks | 保留 | 内核 `process` 已有后台句柄，不重做任务运行器。 |
| pi-memory、pi-hermes-memory、gentle-engram | 保留 | `memory` 与 `learning` 分别负责记忆和学习；不新增平行存储。 |
| pi-hashline-edit-pro | 改写 | 参考锚点式编辑与提示结构，按 Yonder SDK 实现。 |
| latchkey | 保留 | `secrets` 是可选凭据能力；不默认启用或复制注入通道。 |
| pi-btw、agent-comms | 改写 | 会话及 Agent 通信沿用 Yonder 路由与权限，不引入独立通信网格。 |
| pi-intercom | 删除 | 调研未核实其具体能力；不据此引入与 Agent 通信可能重复的插件。 |
| pi-web-ui | 保留 | Yonder 自有客户端与渠道承载交互，不引入第二套驾驶舱。 |

Yonder 特色是多渠道聊天：CLI、名片、MCP 及可配置的微信、飞书、QQ、GitHub；第三方渠道随包提供但默认没有实例。
