# T11 CLI 与本地控制接口

**依据**：`docs/spec/07-runtime.md:13-17`、`104-106`（锁与控制接口）、`docs/spec/08-config.md:1-19`、`docs/spec/02-sessions.md:133-184`

**路径**：`packages/cli/`、`packages/core/src/control/`

**命令**（只做这些）
- `yonder init [dir]`：生成 home、`yonder.yaml`、一个 agent（`SYSTEM.md` 模板、`agent.yaml`，绑定 CLI 私聊到主会话）。
- `yonder login <provider>`：按 07 §6.2 调用 pi-ai OAuth 登录（含本 home 的 `device-id`），写入凭据文件。
- `yonder doctor`：校验配置与插件，包括绑定的 `kind` 是否在渠道声明内，并说明 05 §3 关于 `exec` 的限制。
- `yonder start`：前台运行 harness，持有锁，开控制接口。
- `yonder chat [--agent id]`：接入运行中进程的 CLI 渠道。
- `yonder sessions [list|show <id>|close <id>]`
- `yonder events [--type --from --conv --since --limit]`
- `yonder identity [lookup <ref>|link <acct> <person>|unlink <acct>]`

**验收**：在一个新目录 `init → login → start → chat` 跑通一次真实对话；`start` 运行时另开终端执行 `sessions`、`events` 能查到这次对话。

## 问题

（无）
