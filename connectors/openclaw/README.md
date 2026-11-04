# @yonder/openclaw-connector

OpenClaw 的 Yonder 连接器 feature 插件，契约见 `docs/spec/23-harness-connector.md`。

它以一个 OpenClaw **feature 插件**的形态运行：启动后开一条**出站**连接到你 Yonder 账号的
`/ws/device`，把本机 OpenClaw 的 agent 登记成你的 Bot，并经本机 Gateway WebSocket
（与 CLI / Control UI 同一条 RPC 面）把 OpenClaw 自己的会话暴露给网页。
不监听任何端口、不复制转录，会话状态仍归 OpenClaw 自己。

## 安装

```sh
npx -y @yonder/connect openclaw
```

安装器会：用 `openclaw plugins install` 装入本插件（非交互 flags）；向云端申请设备码并打开
浏览器确认；把设备令牌写到 `~/.openclaw/yonder/config.json`（0600）。重启 gateway 后生效。

卸载：

```sh
npx -y @yonder/connect openclaw --remove
```

## 行为与边界

- 状态只在 `~/.openclaw/yonder/`：`config.json`（端点与设备令牌）与 `state.json`
  （Bot ↔ 会话映射、投递游标）。不改 `PATH`、不写环境变量、不装全局命令；
  不直接读写 OpenClaw 的 SQLite 会话存储。
- 会话驱动只经本机 Gateway WebSocket 的官方 RPC（`sessions.list` / `chat.send` /
  `chat.history` / `sessions.abort`），集中在 `src/sessions.ts` 一个适配文件。
- 连接失败只降级：gateway 正常启动，插件只提供 `yonder_status` 工具，并如实说明未连接。
- 不提供设备执行方法（`tools.*`）。
