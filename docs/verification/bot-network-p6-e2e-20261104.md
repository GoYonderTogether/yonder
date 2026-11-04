# Bot 网络 P6：一条真机端到端环路（验收记录）

2026-11-04。worktree `/Users/zoran/Documents/worktrees/yonder-bot-network`（分支 `feat/bot-network`）与
`/Users/zoran/Documents/worktrees/yonder-cloud-bot-network`（分支 `feat/bot-network`）。
未 push、未发布 npm、未部署；无截屏、无桌面操作。浏览器只有本机 headless Chrome（CLI 自带的
`chrome-headless-shell`），走 CDP `Runtime.evaluate`；`~/.dsh/profiles/desktop`、`~/.dsh/sessions`、
`~/.dsh/storages` 全程未被打开或写入。

驱动脚本：`scripts/bot-network/e2e.mjs`（自启动、`finally` 自清理、打印步骤表、失败时退出码非 0）。

```sh
YONDER_CLOUD_CHECKOUT=/Users/zoran/Documents/worktrees/yonder-cloud-bot-network \
  node scripts/bot-network/e2e.mjs
```

## 环境

| 项 | 值 |
|---|---|
| Node / npm | v24.21.0 / 11.19.0 |
| PostgreSQL / Redis | `/opt/homebrew/opt/postgresql@17/bin`（每个临时实例）、`/opt/homebrew/bin/redis-server` |
| 端口 | 云端 47600、网页 47601、DSH 47610/47611（`P6_PORT_BASE` 可改） |
| 临时目录 | `${TMPDIR}p6-e2e-*`（含 PG、Redis、三个设备 home、Chrome profile；默认运行结束即删除，`--keep` 保留） |
| 云端 server | yonder-cloud worktree 的 `server/dist`，`E2E_FIXED_CODE=135790` 只对 `e2e@yonder.test` 生效 |
| 网页 | `apps/app` 的 `VITE_API=http YONDER_APP_BASE=/` 构建产物，`vite preview` 把 `/api`、`/ws` 代理到本地云端 |
| DSH | 0.2.1-rc.5（`dsh --version`） |
| DSH 模型 | 用户本机 `~/Documents/yonder/.yonder/auth.json` 的 `deepseek.key`，**只经 `DEEPSEEK_API_KEY` 环境变量传入**，未打印、未落盘 |
| 云端 Bot 模型 | 真实 `glm-5.3-flash`（`~/.config/yonder/cloud-bot-model.key`） |

## 运行的步骤（最终一轮，退出码 0）

```
PASS 准备隔离目录与凭据 — PG/Redis temp dir, worker key 0600, DSH 密钥 在, 云端模型密钥 在
PASS 启动临时 PostgreSQL 17 与 Redis 8 — initdb + pg_ctl + redis-server（仅回环）
PASS 迁移并启动真实云端 server — http://127.0.0.1:47600
PASS 启动构建好的网页（apps/app + vite preview → 云端） — http://127.0.0.1:47601 → http://127.0.0.1:47600
PASS 账号 A 经真实登录页登录 — actor 6d3e7f3b-…
PASS DSH 隔离 home 与 profile — …/p6-dsh/profiles/p6
PASS 本地打包 @yonder/dsh-connector（未发布 npm，用本地 tarball） — yonder-dsh-connector-0.3.26110302.tgz
PASS 真实安装器 yonder-connect dsh（built packages/connect） — 配对链接 /connect?code=…
PASS 在真实网页里确认 /connect?code=…（人类那一步） — 页面显示设备名「zorandeMacBook-Air.local」并点击允许连接
PASS 安装器完成：设备令牌写入隔离 home（0600） — …/p6-dsh/yonder/config.json mode 600
PASS 启动 DSH（连接器 bundle + 用户已配置的 DeepSeek 模型） — 设备 online、workProtocol=1
PASS DSH 的 Bot 登记在设备上 — cordis、minimal、ptc、standard 四个 preset
PASS 第二台设备：真实 yonder-executor 绑定同一账号（无手工配对）
PASS 第三台设备：真实 Yonder agent host（devices 插件 + card 渠道）
PASS 网页设备列表显示两台设备与真实状态 — 3 台设备，harness 行显示「在线 · 工作台 v1」
PASS 打开一个 DSH 会话（真实 work bridge） — session-27ea3ae4-…
PASS 设备详情列出 DSH 的 Bot 与会话 — 4 个 Bot，会话链接可用
PASS 在网页里打开 DSH 会话、提交输入、看流式输出 — 流式输出里出现「p6-ui-a396ae7f」（1 个 bot 气泡）
PASS 提交一个长任务并在网页里中止该 DSH 会话 — 运行中点了「中止」，忙碌条消失且最终答案未出现
PASS 网页 DM DSH Bot 并收到真实 DeepSeek 回复 — 网页 DM 收到「p6-chat-7ee00b12」
PASS 启动云端 Bot worker（真实 glm-5.3-flash） — Bot 小未
PASS 云端 Bot 用 devices_list 读到执行端设备（真实模型回合） — 51s，回复里出现 P6 Executor 与设备 UUID
PASS 云端 Bot 用 devices_operation 写文件到执行端设备并读回 — 文件内容 p6-cloud-a3f32ac8（写 24s，读回 19s）
PASS 主人在网页 Bot 详情把可操作设备收窄到另一台设备 — 4 台可选，收窄为 harness 设备
PASS 下一次调用：执行端不再有该 Bot 的授权，网页显示真实原因
PASS yonder-connect dsh --remove 卸载连接器 — bundle 从 profile 移除，$DSH_HOME/yonder/ 已清除
PASS 卸载后 DSH 与安装前一致（逐文件对比 + 正常启动） — 残留 30 项：12 项属 23 §5 列举，18 项是 DSH 自身运行状态；DSH 照常启动
27 通过 / 0 失败 / 0 未测
```

同一命令在最终代码上连跑两轮，均 27/0/0、退出码 0。

## 每一步的断言（不是"跑完没报错"）

| 步骤 | 断言 |
|---|---|
| 账号 A 登录 | 真实登录页：`验证码登录` → `邮箱` tab → 固定验证码 → `登录 / 注册`；会话 cookie 从 Chrome 的 cookie jar 取（HttpOnly，JS 读不到） |
| 真实安装器 | 跑 `packages/connect/dist/cli.js dsh --spec <本地 tarball>`；只接受它真正打印的 `/connect?code=…` |
| 人类确认 | 同一 Chrome 打开 `/connect?code=…`，页面显示**主机名**，点「允许连接」后出现「已连接」 |
| 令牌落盘 | `$DSH_HOME/yonder/config.json` 存在且 mode `600`；安装器退出码 0 |
| DSH 上线 | 云端设备行 `kind='harness'`、`online`、`workProtocol=1`，且名字与页面上确认的那台一致 |
| Bot 登记 | `GET /api/devices/:id/agents` 返回 4 个真实 preset |
| 第二台设备 | invite→redeem 拿真实 deviceToken，执行端 `serve` 启动；云端 `executor` 字段出现，**没有**任何手工 `pair approve` |
| 第三台设备 | 真实 `yonder start` home（`devices` + card 渠道）；`channels login card --verify-code` 后上线、workProtocol=1；执行端出现它的云端介绍 grant |
| 设备列表 | 列表里有 harness 与执行端两行；harness 行出现「在线」「工作台 v1」；不用 mock 数据 |
| 设备详情 | 4 个 Bot 名都在；「会话」区有可点的 `/work/device/…` 链接；harness 不显示「执行端未登记」 |
| 会话输入/输出 | 在 work 页的 `textarea[aria-label='消息输入框']` 输入，等 `bubble-bot` 出现并含本次随机标记；还要求"正在回复"消失后才算完成 |
| 中止 | 发一个长任务，在 `[data-testid='abort']` 可点时点它；忙碌条消失，且最终答案**没有**出现在任何 bot 气泡里 |
| 网页 DM | `/c/<conv>` 里发送，`bubble` 里出现随机标记（DSH 真实 DeepSeek 回复） |
| devices_list | 云端 Bot 的回复里同时出现 `P6 Executor` 与该设备的云端 UUID（模型必须真的调了工具） |
| devices_operation | 先 `fs.write`，然后**在宿主机上读 `/tmp` 外的真实文件**确认字节等于写入值，再让 Bot `fs.read` 原样报回 base64 |
| 收窄 | 在 `/contacts/<bot>` 的「可操作的设备」里点「收窄」，只勾 harness 设备，点「只允许选中的设备」；随后 `GET /api/bots/:id/devices` 的 `allowed` 精确等于该 harness 设备 |
| 收窄后拒绝 | 下一次要求写文件时：磁盘上没有新文件、回复没有声称成功、执行端对该 Bot 的生效 grant 已不在 `GET /api/devices/:id/grants` 里 |
| 卸载 | `--remove` 后 bundle 不在 profile 的 bundles 列表；`$DSH_HOME/yonder/` 整个目录被清除；DSH 仍能正常启动；云端该设备不再 online |
| 逐文件对比 | 与安装前快照比对；差异分成「插件管理器/连接器残留（23 §5 列举）」与「DSH 自身运行状态（sessions、storages、`.credentials.yaml`、合成后的 `cordis.yml`）」，其余任何差异判失败 |

## 本轮发现并修掉的真实缺陷

每一处都是真实进程跑出来的，修完都有回归测试。

1. **`packages/local-host/src/kernel/program-tools.ts`（`3c535481`）**：云端 Bot 扇出设备工具时 `ceiling` 里没有
   `resources`，程序入口却合成了一份"只有本机"的资源表；`DeviceController.grants` 把不含目标设备的资源表当作
   "未选择"，于是**每台远端设备都报 `No current device read grant`**，哪怕执行端持有有效 grant。
   现在没有选择就保持没有选择（19 §7/§9 的默认），由执行端决定。
2. **`packages/cloud-host/src/device-tools.ts`（`cee5cdd9`）**：允许表里只要有一台 harness 设备，`tools.catalog`
   的 `unsupported`（23 §1：连接器不提供设备执行）会让整轮目录失败，**其它设备的工具全部消失**。现在跳过
   `unsupported` 的那台，真实失败照常抛出。
3. **`apps/app/src/components/devices/queries.ts`（`6948e5da`）**：设备页从不填充 `workOnline`，设备详情里的会话列表
   走远程 rpc，被 `deviceOnline` 守门挡下，**永远显示「设备暂未连接」**。现在设备查询把真实事实交给工作桥。
4. **`apps/app/src/components/devices/BotDevices.tsx`（`184d0698`）**：收窄复选框的可访问名只有设备名；同一台笔记本的
   harness 设备与执行端同名，键盘/读屏无法分辨要放开哪一台。类型现在进可访问名。
5. **`packages/connect/src/state.ts`（`184d0698`）**：`--remove` 删了文件却留下连接器自己的状态目录；23 §6 要求显式
   断开后不留状态。现在只删空目录，用户自己放进去的文件不会被删。
6. **`scripts/bot-network/e2e.mjs`**：驱动自身的若干缺陷（子进程退出条件、CDP 返回 DOM 节点、把 aria-label 当可见文本、
   中止断言扫到了用户自己的消息）在过程中一并修正。

另：`apps/app/src/App.tsx`、`apps/app/src/components/card/image.ts` 两处 `useTemplate` 是既有 lint 错误，会让
`npm run lint` 退出非 0，随 `053fac74` 修掉。

## 检查集（最终代码）

| 命令 | 结果 |
|---|---|
| `npm run build` | exit 0 |
| `npm run typecheck` | exit 0 |
| `npm run lint`（biome + size + layers） | exit 0（654 个 .ts，基线 0；109 共享模块 / 769 workspace 文件 / 0 上行） |
| `npm test` | **2896 通过 / 0 失败 / 113 跳过**（535 文件通过 / 67 跳过） |
| 云端 `server npm test` | **213 通过 / 0 失败 / 0 跳过** |
| `scripts/bot-network/e2e.mjs` | **27 通过 / 0 失败 / 0 未测**，exit 0（连跑两轮） |

## 未测

- **V9（"发给 DSH 一句话"让 DSH 自己安装）**：P4 已实测不成立（DSH 沙箱按 workspace 边界拒绝 `dsh plugin add`），
  本轮未重测，沿用 P4 结论。安装走的是用户自己在终端粘贴同一条命令。
- **真实 `npx -y @yonder/connect dsh`**：包未发布到 npm，本轮同样用本地 tarball 走同一份 built CLI。
- **V11（DSH Bot 用 devices 工具操作另一台设备）**：spec 23 §1 明确连接器不提供设备执行能力，没有实现路径；
  没有实现（详见 `proposals/bot-network/reports/P6.md`）。
- **Hermes / OpenClaw**（V14）：不属本轮。
- **生产云（yonderbot.net）、Windows、Linux**：只在 macOS arm64 与本地云上跑过。
- **多会话并发、长会话压缩、卡片/图片/文件入站**：只测了单会话。
- **收窄后那一步的拒绝形态**：执行端确实不再持有该 Bot 的生效 grant、磁盘上没有新文件、模型没有声称成功；
  但模型这一轮看到的是"工具不在本轮名单里"，而不是一条 `UNAUTHORIZED` 回执。两者都是真实原因，本轮记录前者。

## 清理

脚本 `finally` 关闭它启动的每个进程（Chrome、DSH、agent host、执行端、worker、云端 server、Redis、PG），并删除临时目录。
复核：`ps` 中没有 `p6-e2e-*`、47600–47620 端口无监听、`${TMPDIR}p6-e2e-*` 目录已删除。
运行前手工调试遗留的进程也已全部停止（见 `proposals/bot-network/reports/P6.md`）。
