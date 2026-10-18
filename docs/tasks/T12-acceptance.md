# T12 0.1 端到端验收

**依据**：`docs/architecture.md:49-61`（不变量）及各任务的验收。

**在一个由 `yonder init` 生成的 home 里，用真实模型完成并记录**
1. CLI 私聊进主会话；重启进程后继续同一会话。
2. 两个 CLI 实例分别绑定为 owner 与 stranger，各自进入不同配置档，stranger 看不到写工具。
3. owner 在 CLI 里要求"发到我的另一个渠道"，`message_send` 送达，产生 `message.out`。
4. 主 agent 用 `task_run` 调一个编码预设，在临时目录里写一个文件并返回结果。
5. 一次触发 5 次相同工具调用的运行以 `limit` 结束并向来源说明。
6. `identity_lookup` 能查到第 2 步的两个账号分别和哪个 agent、哪个会话有过交互。
7. 修改 `agent.yaml` 引入一个错误：配置保持旧版本、产生 `config.reload` 失败事件；改回后自动生效。

**产出**：本文件末尾"结果"一节，逐条写命令、输出摘要、事件 id。全部通过后打 `v0.1.0` 标签。

## 问题

（无）
