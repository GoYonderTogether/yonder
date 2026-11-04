# P4 DSH 连接器与 `@yonder/connect`：验收记录

2026-11-04。执行分支 `feat/dsh-connector`（worktree `/Users/zoran/Documents/worktrees/yonder-dsh-connector`，基于 `feat/bot-network`）。
未 push、未发布 npm、未部署、未截屏、未驱动桌面 UI。`~/.dsh/profiles/desktop`、`~/.dsh/sessions`、`~/.dsh/storages` 未被本任务写入。

## 环境

| 项 | 值 |
|---|---|
| DSH | 0.2.1-rc.5（`dsh --version`） |
| Node / npm | v24.21.0 / 11.19.0 |
| 实验 DSH home | 全部在 `/tmp/dsh-lab-p4*`、`/tmp/dsh-v9*`、`/tmp/dsh-v12*`、`/tmp/dsh-v13` |
| 本地云服务 | `/tmp/p4-cloud`（yonder-cloud-bot-network/server 的工作副本） |
| 真实模型 | 用户本机已配置的 DeepSeek（`deepseek-official / deepseek-flash`），经 `DEEPSEEK_API_KEY` 环境变量传入 DSH，密钥未打印、未落盘 |

## 云端改动（工作副本）

`/tmp/p4-cloud` 是 `/Users/zoran/Documents/worktrees/yonder-cloud-bot-network/server` 的副本，**唯一差异**是
`server/src/devices.ts` 里的 `deviceKinds` 增加 `'harness'`：

```
const deviceKinds = new Set<DeviceKind>(['laptop', 'desktop', 'server', 'cloud', 'harness']);
```

原 worktree 的 `migrations/022-bot-network.cjs` 已把 `devices_kind_check` / `device_codes_kind_check` 放宽到包含
`harness`，但 `devices.ts` 的进程内白名单仍拒绝该 kind，`POST /api/device/start` 返回 `invalid_request`。
这一点属 P2 的范围（设备身份与云端侧），本任务按约定不改那两个仓库，记在报告里。

## V8 安装与配对：通过（本地云 + 隔离 DSH home）

驱动：`/tmp/p4-integration/e2e.mjs`（人类一侧用真实 HTTP 客户端扮演浏览器确认，不是模拟模型）。

| 步骤 | 结果 |
|---|---|
| `@yonder/connect dsh` 选择 profile 并打印实际命令 | `dsh plugin --profile dshlab add /tmp/p4-artifacts/yonder-dsh-connector-0.3.26110302.tgz` |
| 安装器申请设备码并打印确认链接 | `/connect?code=<32 字符>` |
| 人类在浏览器侧确认 | `POST /api/device/confirm` 200 `{name:"zorandeMacBook-Air.local",kind:"harness"}` |
| 安装器退出码 | 0 |
| 令牌落盘 | `/tmp/dsh-lab-p4x/yonder/config.json`，mode `600`，目录 mode `700` |
| 云端出现设备行 | `{"kind":"harness","online":true,"workProtocol":1}` |
| Bot 登记 | `GET /api/devices/:id/agents` 返回 4 个真实 DSH preset Bot（`cordis`、`minimal`、`ptc`、`standard`，key 为 preset id） |
| 工作方法 | `POST /api/devices/:id/work/rpc/sessions.list` → `{ok:true,result:[]}` |

## V9「发给 DSH 一句话」：**未成立**，记录实测

在默认 `standard` preset（`plugin_manager` 关闭）下，给 DSH 的 agent 发送含
`npx -y @yonder/connect dsh`（本地等价：`node /tmp/p4-connect-local/package/dist/cli.js dsh …`）的一句话。实测：

1. **agent 能执行这条命令**：`tool/call name=bash` 出现，参数就是那条命令；没有 Creator preset、没有 `plugin_manager`。
   这是 D3 假设中"能跑"的部分，成立。
2. **命令本身被 DSH 沙箱拒绝**：`dsh plugin … add` 在子进程里写
   `$DSH_HOME/profiles/<p>/package.json.lock`，得到
   `Error: EPERM: operation not permitted, open '…/profiles/lab/package.json.lock'`。
3. **审批流程不介入**：即使 prompt 里明确要求使用越权审批，`approval/request` 听众一次也没有被调用
   （探针记录 `approvals: []`），结果直接是失败。也就是说 fs-sandbox 的写限制不是"问一次就行"，
   而是按 workspace 边界直接拒绝。
4. `npx -y @yonder/connect` 还额外失败于 npm registry（包未发布，按计划不发）。

**结论**：D3 的"让 DSH 自己装"在 0.2.1-rc.5 默认预设下不成立。按计划回退到"用户自己在终端粘贴同一条命令"
（即本任务的 V8 路径：安装器本身完全可用）。要让这条路成立，需要维护者决定是否接受以下之一：
让用户在 DSH 里批准一次工作区外写入（当前沙箱不支持按次解除），或改由 DSH 插件自带安装能力。

## V10 会话与真实模型：通过

同一台本地云 + 隔离 DSH home，经云端真实工作桥：

| 步骤 | 结果 |
|---|---|
| `sessions.open {preset:"standard"}` | 返回真实 DSH session id `session-<uuid>` |
| `sessions.watch` 订阅 | `ready`，`gap:true`，带会话与转录快照 |
| `sessions.submit {text:"Reply with exactly: pong"}` | 接纳 |
| 事件流 | `session.update` 的 `message`（assistant）正文 `pong`，随后 `state running:false` |
| `sessions.transcript` | `[{id:8,kind:"yonder.message",text:"Reply with exactly: pong"},{id:19,kind:"pi.assistant",text:"pong"}]` |
| `sessions.abort` | `{ok:true}` |
| 网页 DM → DSH → 网页 | 网页在主人 DM 发「从网页发给 DSH Bot：请只回复 pong-chat」，DSH 真实模型回复 `{"type":"markdown","text":"pong-chat"}` 回到同一会话 |

期间修正的两个真实缺陷（均已提交）：
- `sessionController.page` 的 `throughSeq` 是必填且不得大于会话游标；缺省会得到空页。
- `sessionController.follow` 的 `assistant-stream` 帧需要单独翻译成流式 `session.update`。

## V12 卸载：通过（残留与调研一致）

全新 profile `/tmp/dsh-v12b`（`--from-default-profile web`），安装→卸载后逐文件对比：

| 残留 | 说明 |
|---|---|
| `profiles/lab/.plugin-manager/logs/operation-*/pnpm.log` | 两行诊断日志（0 字节内容） |
| `profiles/lab/pnpm-lock.yaml` | profile 第一次 pnpm 操作本来就会创建 |
| `profiles/lab/node_modules/@yonder/` 空目录 + `.pnpm` 元数据 | 悬挂链接，`--dump-config` 里 bundle 已不存在，不会加载 |
| `package.json` 的 `"dependencies": {}` 行 | 安装前不存在，卸载后保留空对象 |

`$DSH_HOME/yonder/` 由 `--remove` 清除；`desktop` profile 全程未参与。

## V13 版本不匹配降级：通过

| 场景 | 结果 |
|---|---|
| 安装时 `engines.dsh: ">=0.3.0 <0.4.0"` | `dsh plugin add` 拒绝，回滚 `package.json`/`pnpm-lock.yaml`/`node_modules`，并给出 `allow-version` 命令 |
| 启动时 bundle 声明已改到 `>=0.3.0` | `dsh: skipping profile bundle "@yonder/dsh-connector": … requirements {"engines.dsh":">=0.3.0 <0.4.0"}`，DSH 仍然正常启动并打印 Web URL（`exit=124` 是 40 秒超时终止一个正常服务进程，不是崩溃） |

## 单元与契约测试

`npx vitest run connectors/dsh/test packages/connect/test`：**3 文件 / 44 测试全部通过**。

- `connectors/dsh/test/adapter.test.ts`（15）：帧解析、补收标记、会话/转录投影、事件归约。
- `connectors/dsh/test/protocol.test.ts`（17）：真实 loopback WebSocket 上跑 `/ws/device` 子集、Bot 登记全量对齐、
  投递/ack/去重/不 ack 失败、未确认不重发、五个工作方法与明确 `unsupported`、`sessions.watch` 的 ready/ev/pong/end。
- `packages/connect/test/connect.test.ts`（12）：launcher/profile 探测、安装/卸载命令、bundle 列表、设备码配对、
  0600/0700 与清除。

## 未测

- **真实 `npx -y @yonder/connect dsh`**：包未发布到 npm，只测了等价的本地 tarball/本地 dist 路径。
- **用户 `desktop` profile 里的安装**：该 profile 由 Electron 独占，`dsh plugin` 明确拒绝；未验证 Desktop 自带 CLI。
- **生产云**：未部署，未连 yonderbot.net。
- **Windows / Linux**：只在 macOS arm64 跑过。
- **多会话并发**与长会话压缩：只测了单会话一轮。
- **卡片/图片/文件入站**：连接器如实报"暂不支持"，未做转换。

## 清理

所有 DSH 进程、本地云、临时 PostgreSQL 17、Redis 8 均已停止（`ps` 与 `lsof` 复核为空）；实验目录在 `/tmp` 下。
