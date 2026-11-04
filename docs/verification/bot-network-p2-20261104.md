# Bot 网络 P2：设备身份、云端介绍配对、允许表与 grant 撤销（真实进程验收）

日期：2026-11-04。只改两个 worktree（`yonder-bot-network`、`yonder-cloud-bot-network`），分支 `feat/bot-network`。无 push、部署、npm 发布、截图或桌面操作；未触碰 `/Users/zoran/Documents/yonder` 与 `/Users/zoran/Documents/yonder-cloud`。本页按实际执行记录，原始命令与计数见文末。

## 环境

| 项 | 值 |
|---|---|
| Node | v24.21.0 |
| PostgreSQL | `/opt/homebrew/opt/postgresql@17/bin`（每个验收脚本自建临时实例） |
| Redis | `/opt/homebrew/bin/redis-server`（同上） |
| 云端 checkout | `YONDER_CLOUD_CHECKOUT=/Users/zoran/Documents/worktrees/yonder-cloud-bot-network` |
| 模型 | `openai/gpt-6-luna` 本机无凭据，相关用例仍 skip（**未测**）；本轮 V2–V6 不需要模型 |

## 真实进程验收（`scripts/bot-network/verify.mjs`）

一条命令跑完 V2、V3（后端部分）、V4、V5、V6：真实临时 PG/Redis、真实云端 server、两个隔离设备 home + 各自真实 `yonder-executor` 进程（收件箱连接）、两个真实 kernel controller home（`devices` 插件走云端发现）。脚本在 `finally` 关闭全部进程与数据库，临时目录删除。

```
$ YONDER_CLOUD_CHECKOUT=/Users/zoran/Documents/worktrees/yonder-cloud-bot-network \
  node scripts/bot-network/verify.mjs
V2 ok: two devices, no manual pairing, remote listing accepted
V3 ok: narrowed Bot lost the excluded device
V4 ok: cross-account listing, writing and relaying are refused
V5 ok: online and offline owner revocations both reach the executor
V6 ok: manual-only refuses cloud pairing, manual pairing still starts
bot-network acceptance: all executed V-criteria passed
```

| 验收 | 断言 | 结果 |
|---|---|---|
| V2 | 同账号两台设备都不做手工配对：controller 的 `workspaces` 出现对方的云端 UUID，并经执行端返回真实远程目录 | 通过 |
| V3（后端） | 把 Bot 收窄到一台设备后，被排除设备从 controller 视图消失；直接对该设备的调用被执行端拒绝 | 通过 |
| V4 | 另一账号读写 Bot 允许表 404、读该设备 grant 404、经 `/api/devices/:id/relay` 404；其设备列表不含主人设备 | 通过 |
| V5 | 主人在线撤销后下一次读取不再出现该设备；离线撤销返回 `pending:true`，重连后执行端收到并回执 | 通过 |
| V6 | `pairing policy --set manual-only` 持久化；该执行端对云端介绍返回签名 `UNPAIRED`，不新建 grant；同一 home 的 `pair start` 仍正常 | 通过 |

开发过程中的真实失败按顺序保留（均已在代码中修正，不是放宽断言）：

1. `Execution HTTP status 403`——插件用设备令牌读 `GET /api/devices`（人类接口）。改为新增的设备凭据接口 `GET /api/device/devices`。
2. `Execution HTTP status 400` / `WRONG_TARGET`——收件箱把所有 relay 帧都交给 `device.introduce`。改为只对 `device.introduce` 走声明校验，其余走既有已配对路径。
3. `UNAUTHORIZED`——引入的 grant 根是 `/var/...`，执行端报告的是 `/private/var/...`。执行端默认根改为 canonical 路径。
4. `commands.submit` 前 `UNAUTHORIZED`——命令与 session 查找用了云端 UUID。改为上行用执行端 deviceId、对外结果递归改回云端 UUID。
5. controller 只看到 `local`——grant 列表里的 `deviceId` 仍是执行端 id，被 `ControllerController.grants` 过滤。同样由递归改名修复。
6. 收窄后整次发现超时——被拒绝的介绍没有签名回答。改为签名 `ok:false`（`UNPAIRED`/`UNAUTHORIZED`/`GRANT_REVOKED`/`UNSUPPORTED_OPERATION`）。
7. 撤销后下一次刷新又签回同一 grant——“主人撤销优先于重复介绍”未实现。执行端记录 `revokedBots`，云端重述允许表后才清除。
8. 云端主人视图不更新——执行端在 grant 变化后没有上报。收件箱订阅 `onGrantsChanged`。

## 组件与单元检查

| 命令 | 结果 |
|---|---|
| `npx vitest run packages/device/test/introduce.test.ts` | 6 通过 / 0 失败 |
| `npx vitest run packages/device/test plugins/devices/test` | 72 通过 / 2 跳过（跳过项是需要 `YONDER_W1_ROOT`+`YONDER_CARD_ROOT` 的旧跨仓测试） |
| `npm run build`、`npm run typecheck` | exit 0 |
| `npm run lint`（biome + size + layers） | exit 0；645 个 .ts，size 基线 0；109 共享模块 / 750 workspace 文件，0 上行依赖 |
| `npm test` | **2788 通过 / 0 失败 / 113 跳过**（521 文件通过 / 67 跳过，64.81 秒） |
| `npm run test:node` | 83 通过 / 0 失败 |
| 云端 `server npm test` | **211 通过 / 0 失败 / 0 跳过**，22 suites，51.90 秒 |
| 云端 `npm run build` / `typecheck`（根与 server） | exit 0 |
| 云端 `npm run deploy:test` / `market.test.mjs` / `chat-render.test.tsx` | 19/0、13/0、3/0 |
| 云端 `npm run version:check` | `0.2.26102301` |

## 未测

- 真实 `openai/gpt-6-luna`：本机无 `YONDER_TEST_AUTH` 与 `.yonder/auth.json`，相关用例 skip，**未测**。
- 云端 Bot（worker）用真实 GLM 经 `tools.catalog`/`tools.call` 调另一台设备：本轮只验证了允许表对 worker 路径的交集与拒绝码（单测级），**未跑真实模型回合**。
- 网页端（P3）：设备详情、Bot 可操作设备、撤销按钮都不在本轮，契约形状见 `proposals/bot-network/reports/P2.md`。
- 安装版 `yonder-executor` 实际落盘：只加了启动器与单测，**未在真实安装上执行一次更新**。
- Windows 启动器与 `kind='harness'` 的真实连接器（P4/P5）。
- 生产 2 核 2 GB 上 PG/Redis/worker 共存。

## 本轮实现边界

- 执行端仍是唯一授权判定点：介绍声明只证明“同一主人”，能力、目标、动作与根由执行端决定；未知动作/目标整条拒绝。
- 允许表只决定“云端愿意介绍哪个目标”，执行端据此撤销或重发 grant；模型与网页不能填写权限。
- grant 摘要是只读展示副本，不参与授权；`grants.list` RPC 仍只给已配对 principal 自己的 grant。
- 手工离线配对流程与既有 `--card-config` 数组保持不变；新增“无 `peerDeviceId` 的条目＝收件箱”。
