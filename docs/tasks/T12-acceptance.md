# T12 0.1 端到端验收

**依据**：`docs/architecture.md:52-64`（不变量）及各任务的验收。

**在一个由 `yonder init` 生成、`yonder update` 安装的 home 里，用真实模型完成并记录**
1. CLI 私聊进主会话；重启进程后继续同一会话。
2. 两个 CLI 实例分别绑定为 owner 与 stranger，各自进入不同配置档，stranger 看不到写工具。
3. 主会话里两个渠道实例几乎同时发消息，各自的回答回到各自的渠道。
4. owner 在 CLI 里要求"发到我的另一个渠道"，`message_send` 送达，产生 `message.out`。
5. 主 agent 用 `task_run` 调一个编码预设，在临时目录里写一个文件并返回结果。
6. 第二个 agent 只绑定内部渠道 `agent`；主 agent 用 `agent_ask` 问它并拿到答复。
7. 一个 skill 放进 home 的 `skills/`，模型按描述用 `skill_view` 读取并照做；agent 自己写的 skill 在下一次运行出现在索引里。
8. 一次触发 5 次相同工具调用的运行以 `limit` 结束并向来源说明。
9. `identity_lookup` 能查到第 2 步的两个账号分别和哪个 agent、哪个会话有过交互。
10. 修改 `agent.yaml` 引入一个错误：配置保持旧版本、产生 `config.reload` 失败事件；改回后自动生效。
11. 用临时仓库里的两个本地标签做一次 `update`：服务重启，下一条消息的 `<turn>` 带版本通知，`yonder changelog` 能输出变化。

**产出**：本文件末尾"结果"一节，逐条写命令、输出摘要、事件 id；`CHANGELOG.md` 的 `[Unreleased]` 整理为 `[0.1.0]`。标签 `v0.1.0` 由设计方审阅后打。

## 问题

（无）
