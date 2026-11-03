# P4 执行报告：DSH 连接器与 `@yonder/connect`

2026-11-04。worktree `/Users/zoran/Documents/worktrees/yonder-dsh-connector`，分支 `feat/dsh-connector`（基于 `feat/bot-network`）。
未 push、未发布 npm、未部署、未截屏、未驱动桌面 UI。未修改 `plugins/devices`、`packages/device`、`packages/protocol`、yonder-cloud 三处（P2 范围）。
详细证据：[docs/verification/p4-dsh-connector-20261104.md](../../../docs/verification/p4-dsh-connector-20261104.md)。

## 提交

| 提交 | 内容 |
|---|---|
| `39832804` | 新增 `connectors/dsh`（`@yonder/dsh-connector` bundle）与 `packages/connect`（`@yonder/connect` 安装器），注册进 workspace 与根 tsconfig，CHANGELOG、README、44 个测试 |
| `f15a2f12` | 修正实测暴露的三个真实缺陷：`sessionController.page` 必填 `throughSeq`、`assistant-stream` 帧翻译、未注入服务不得在 `apply` 里读取 |
| `af158d04` | 验收记录 |

`packages/connect/README.md` 随第二个提交一并落入（第一次提交漏加，第二次 `git add` 目录时补上）。

## 代码形状

```
connectors/dsh/           @yonder/dsh-connector：dsh.bundle + 一段 patch，apply() 起一条出站连接
  src/adapter.ts          唯一依赖 DSH session 形状的翻译层（投影、事件、消息）
  src/index.ts            DSH 插件入口：动态注入 sessionController/agentPresets，仅 tools 是硬依赖
  src/connection.ts       /ws/device 出站连接、指数退避、不回放
  src/bots.ts             Bot 全量登记、消息投递、ack、回复回传
  src/work.ts             sessions.list/open/submit/transcript/abort + sessions.watch 流
  src/event-stream.ts     follow 快照与事件 → session.update
  src/frames.ts           设备通道帧子集解析
  src/state.ts            $DSH_HOME/yonder/{config,state}.json
packages/connect/         @yonder/connect：dsh 探测、bundle 安装/卸载、设备码配对、令牌落盘
```

硬规矩全部落在代码里：不写 `process.env`/`PATH`/`~/.gitconfig`，不装全局命令，不注册任何入站路由（因此也没有无鉴权裸路由），
不读写 `$DSH_HOME/sessions` 或 `storages`，`apply` 不做同步网络等待，连接失败只降级为"只有 `yonder_status` 工具"。
`engines.dsh: ">=0.2.1-rc.5 <0.3.0"`。会话驱动集中在 `adapter.ts` 一个文件。

## 验收结果

| # | 结果 | 证据 |
|---|---|---|
| V8 | **通过** | `@yonder/connect dsh` 装包、申请设备码、浏览器确认、写 0600 令牌；云端出现 `kind:"harness"`、`online:true`、`workProtocol:1` 的设备；4 个 DSH preset 登记为 Bot；`sessions.list` 经真实工作桥返回 |
| V9 | **未成立** | DSH 默认 `standard` preset 下 agent **能**用 bash 执行那条命令（不需要 Creator preset），但 `dsh plugin add` 写 `$DSH_HOME/profiles/<p>/package.json.lock` 被 DSH 沙箱 `EPERM` 拒绝，且 `approval/request` 从未被调用——沙箱按 workspace 边界直接拒，没有"批一次"的路径。按计划回退到"用户自己在终端粘贴同一条命令" |
| V10 | **通过** | 真实 DeepSeek 模型：`sessions.open` → `sessions.watch` ready → `sessions.submit "Reply with exactly: pong"` → 事件流出 assistant `pong` → `sessions.transcript` 读回 → `sessions.abort`。另跑通网页主人 DM → DSH 会话 → 模型回复 `pong-chat` 回到网页同一会话 |
| V12 | **通过** | 全新 profile 安装→卸载，残留仅 `.plugin-manager/logs/*/pnpm.log`、`pnpm-lock.yaml`、`node_modules/@yonder` 悬挂目录，外加 `package.json` 的 `"dependencies": {}` 空行；`$DSH_HOME/yonder/` 由 `--remove` 清除 |
| V13 | **通过** | 安装时 `engines.dsh` 不匹配 → 拒绝并回滚；启动时 bundle 范围不匹配 → `skipping profile bundle …` 且 DSH 正常起服务 |

检查集：`npm run build` 0、`npm run typecheck` 0、`npm run lint` 0（size 649 文件/基线 0，layers 109 共享模块/762 workspace 文件/0 上行）、
`npm test` **2819 通过 / 0 失败 / 113 跳过**（523 文件通过 / 67 跳过，较 P1 基线 2775 增加 44 条本任务测试）、`npm run test:node` 83/0/0。

## 云端侧需要的改动（不属本任务，交 P2 / 维护者）

1. **`server/src/devices.ts` 的 `deviceKinds` 必须加入 `'harness'`。** migration `022-bot-network.cjs` 已把
   `devices_kind_check` / `device_codes_kind_check` 放宽，但进程内白名单仍是
   `['laptop','desktop','server','cloud']`，`POST /api/device/start` 对 `kind:'harness'` 返回 `invalid_request`。
   集成测试是在该 worktree 的副本上补这一行后跑的。
2. `GET /api/devices` 的 `deviceView` 把 kind 直接透出，网页需要按 spec 16 §5 显示"外部 harness"来源；本轮未改网页。
3. 连接器登记的 Bot 是 `PUT /api/device/agents` 的普通设备 Bot，`device_agents.key` 用 DSH preset id。spec 23 §2.2 的全量对齐语义已经满足；
   但如果 P2 引入"执行端身份"，连接器按 spec 23 §1 明确**不上报**，云端不能把它当执行端。

## 未测

- 真实 `npx -y @yonder/connect dsh`：包未发布，只测等价本地路径（tarball / dist）。
- 用户 `desktop` profile 内安装：该 profile 由 Electron 独占，`dsh plugin` 拒绝；未验证 Desktop 自带 CLI。
- 生产云（yonderbot.net）、Windows、Linux、多会话并发、卡片/图片/文件入站转换。
- V11（DSH Bot 用 devices 工具操作另一台设备）：属 P2 的允许表与执行端 grant，本轮连接器按 spec 23 §1 不提供执行方法。

## 环境隔离证明

`~/.dsh/profiles/desktop` 四个文件 md5，任务开始与结束时：

```
139222102b1ba98de7cbf0b3c4fddb4b  cordis.patch.yml   (结束时 036fc2094b51eccf9530cce96673af39)
da08f43320f829ed34ec07c00c4f31e5  cordis.yml
d6a8e1ec3203c17f69a8344018bf1965  package.json
c3c763e9b5873d74f6c8aaf51e62e11a  pnpm-workspace.yaml
```

**`cordis.patch.yml` 的 md5 变了，但不是本任务改的**，时间线可以证明：

| 时间（本地） | 事件 |
|---|---|
| 23:15:22 / 23:15:23 | 用户自己的 DSH Desktop 写入 `profiles/desktop/cordis.patch.yml` 与 `.credentials.yaml` |
| 23:19:05 / 23:19:06 | 用户启动 DeepSeek Harness Desktop（`desktop-host/lib/index.js`，至今在跑），同分钟写入 `profiles/desktop/cordis.yml` |
| 23:27 | 出现 `profiles/headless/`（非本任务创建；我已确认本会话从未执行 `--profile headless`） |
| 23:53:15 | 本任务第一个 DSH 实验目录 `/tmp/dsh-lab-p4` 才创建 |

本任务全程只在显式 `DSH_HOME` 下调用 `dsh`：`/tmp/dsh-lab-p4`、`/tmp/dsh-lab-p4x`、`/tmp/dsh-lab-probe`、`/tmp/dsh-eng-home`、
`/tmp/dsh-v9*`、`/tmp/dsh-v12*`、`/tmp/dsh-v13`。会话记录里唯一未带 `DSH_HOME` 的 `dsh` 调用是 `dsh --version` 与 `command -v dsh`；
实测 `dsh --version` 在空 home 下不写任何文件。中途我在 `~/.dsh-lab-p4` 建过一个实验室 home 测"home 位于用户目录"的场景，
已删除。`~/.dsh/sessions` 里 23:28 / 23:43 的新会话 cwd 是 `/Users/zoran/Documents/Trae-CN/temp_20261103_02`，来自用户的 Desktop 会话，不是本任务。
`~/.dsh/storages` 未被写入。

所有由本任务启动的进程（DSH 实验 profile、本地云、临时 PostgreSQL 17、Redis 8、探针 WS 服务）已全部停止，
`ps` 与 `lsof` 复核无残留；唯一仍在运行的是用户自己 23:19 启动的 DeepSeek Harness Desktop。

## 交维护者的判断项

1. **V9 不成立的处理**：按计划退回"用户自己在终端粘贴一条命令"。若要让"发给 DSH 一句话"成立，需要 DSH 提供按次解除 workspace
   写限制的入口，或让 `@yonder/connect` 能被运行在 `$DSH_HOME` 之外的通道调用——两者都不在本次可改范围。
2. **`kind:'harness'` 的云端白名单**必须由 P2 补进 `devices.ts`，否则生产环境安装会在设备码阶段失败。
3. 连接器把 DSH 的每个 agent preset 登记为一个 Bot（key 为 preset id），显示名 `host` / `host · <preset>`。如果产品希望只登记一个
   代表 Bot，需要 spec 23 §2.2 明确取舍；当前按"该 harness 的全部 agent"实现。
