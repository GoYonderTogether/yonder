# P5 Hermes 与 OpenClaw 连接器：验收记录

2026-11-04。执行分支 `feat/harness-connectors`（worktree `/Users/zoran/Documents/worktrees/yonder-harness-connectors`，基于 `feat/bot-network` → P4 的 `feat/dsh-connector`）。
未 push、未发布 npm、未部署、未截屏、未驱动桌面 UI。未修改 `plugins/devices`、`packages/device`、`packages/protocol`、yonder-cloud 三处（P2 范围）。
上一轮被限流中断的产物（`/tmp/p5-oc-home`、`/tmp/p5-hermes-home`、`/tmp/p5-spike-home`、`/tmp/p5-spike-gw.log`）只做参考，已按要求删除。

## 提交

| 提交 | 内容 |
|---|---|
| `e3cc78ed` | `connectors/hermes`：Hermes 平台插件（plugin.yaml + `register(ctx)`），设备协议子集、五个工作方法、事件流 |
| `ff4d29e2` | `packages/connect` 增加 `hermes`、`openclaw` 子命令（安装、设备码配对、0600 令牌、`--remove`） |
| `521ffc67` | `connectors/openclaw`：OpenClaw feature 插件，本地 Gateway WebSocket 驱动会话 |
| `244da8b7` | Hermes 实测缺陷修复：hello 宣告、配对端点、系统代理旁路 |
| `3eced438` | OpenClaw 实测缺陷修复：bundled `ws` 客户端、握手应答直读、真实 CLI flags |

## 代码形状

```
connectors/hermes/           Python 平台插件（drop-in 到 ~/.hermes/plugins/yonder-connector/）
  platform_adapter.py        注册面：ctx.register_platform + check_fn/validate_config；出站 send
  adapter.py                 唯一依赖 Hermes 会话 API 的翻译层（spec 23 §4）：api_server REST + 网关事件归约
  bots.py / work.py / connection.py / frames.py   设备协议子集（Python 版，与 DSH 帧兼容）
connectors/openclaw/         OpenClaw feature 插件（npm-pack 或本地路径安装）
  sessions.ts                唯一依赖 OpenClaw RPC 形状的翻译层
  gateway.ts                 本地 Gateway WebSocket 客户端（connect 握手、challenge、事件分发）
  connector.ts / bots.ts / work.ts / frames.ts / state.ts   设备协议子集
packages/connect/            hermes / openclaw 子命令：drop-in 复制或 `openclaw plugins install`、配对、0600 令牌、--remove
```

硬规矩落点：状态只在 `<HERMES_HOME>/yonder/` 与 `<OPENCLAW_STATE_DIR>/yonder/`（0600/0700）；
不写 PATH/环境变量/`~/.gitconfig`，不装全局命令，不注册任何入站路由；
`apply`/服务启动不做同步网络等待；会话驱动集中在单个适配文件；无设备执行方法（`tools.*` 不在 `capabilities.get` 的方法表里）。

## 环境

| 项 | 值 |
|---|---|
| Hermes | v0.22.6（`~/.hermes/hermes-agent`，隔离 home `/tmp/p5-hermes-home`） |
| OpenClaw | 2026.10.10（`--port 19789`、token auth、隔离 state `/tmp/p5-openclaw-home`） |
| 本地云服务 | `/tmp/p5-cloud`（yonder-cloud-bot-network 全仓副本，commit `7d6c6ce`，`kind:'harness'` 已在白名单） |
| 存储 | 隔离 PostgreSQL 17（:15432）+ Redis（:16379），迁移 `022`/`023` 全部跑过 |
| 模型 | 无凭据（见"未测"） |

## V8 等同验证（安装与配对）：通过

- 设备码流程（`/api/device/start` → 浏览器确认 → `/api/device/poll`）在 `kind:'harness'` 下真实走通（两个框架各一台）。
- Hermes：drop-in 目录 `~/.hermes/plugins/yonder-connector/`，`plugins.enabled` 加入后网关启动即注册；
  网关日志 `✓ yonder connected`；云端设备 `online:true, workProtocol:1`；
  `GET /api/devices/:id/agents` 返回真实 profile Bot（`default`）。
- OpenClaw：`openclaw plugins install <tgz> --force --accept-capabilities`（16 插件含 yonder-connector），
  网关启动后服务 `yonder-connector` 注册 `yonder_status` 工具；云端设备 `online:true, workProtocol:1`，
  Bot `main`（actor name `OpenClaw`）登记成功。
- 令牌落盘 0600、目录 0700（Hermes/OpenClaw 各自的 `yonder/config.json`）。

## V10 等同验证（会话驱动）：通过（除模型腿）

经云端真实工作桥（`/api/devices/:id/work/rpc/*` + `/ws/work` 订阅）：

| 步骤 | Hermes | OpenClaw |
|---|---|---|
| `sessions.list` | `{ok:true,result:[...]}`（真实 profile 会话） | `{ok:true,result:[...]}`（真实 agent:main 会话） |
| `sessions.open` | 创建 `api_<ts>` 会话返回句柄 | 创建 `agent:main:dashboard:<uuid>` 返回句柄 |
| `sessions.submit` | 接纳（`POST /v1/runs`）；无模型凭据时 Hermes 如实报 `RuntimeError: Hermes is not connected to any AI provider yet`，OpenClaw 如实报 `No route-compatible authentication source is configured for openai` | 同左（真实错误，未造假回复） |
| `sessions.transcript` | 读回条目（用户轮有内容；模型轮因无凭据未持久化） | 读回 `[{id:1,kind:"yonder.message",text:"Reply with exactly: pong"}]` |
| `sessions.abort` | `{ok:true}` | `{ok:true}` |
| watch 流 | `READY gap:true` + 真实快照（`/ws/work` 订阅） | `READY gap:true` + 转录条目 |
| 网页 DM → harness | `[Yonder 私聊 · P5] …` 投递进真实 Hermes 会话（标题 `Yonder · default`），游标记录、ack | `[Yonder 私聊 · …]` 投递进 `agent:main:dashboard:dc63e79e…`，`state.json` 记录 Bot↔会话映射与游标 |

## V12 等同验证（卸载残留）：通过

| 框架 | 残留 | 说明 |
|---|---|---|
| Hermes | drop-in 目录被 `hermes plugins remove`（或删除目录）移除后 `plugins/` 无残留；`config.yaml` 的 `plugins.enabled` 行需手动移除（Hermes 行为：enable 写入的清单行不由 remove 删除） | 调研（03 §8.4）即如此；连接器状态目录由 `--remove` 清空 |
| OpenClaw | `plugins.entries` 留一条 `{"enabled": false}` 空条目；`extensions/yonder-connector/` 目录被删；`openclaw.json` 的 `plugins.allow` 无新增 | 与调研（03 §1.3）一致："最轻可移除形态"的全部代价就是这条 JSON |
| 卸载后 | OpenClaw 重启加载 15 插件（安装时 16）——插件不再加载、云端设备按退役语义下线 | `--remove` 同时清空 `yonder/`（config.json + state.json） |

## 版本不匹配降级（V13 等同）：通过

- Hermes：`plugin.yaml` 声明 `requires_hermes: ">=0.22.0"`；`hermes plugins doctor` 校验；
  版本不满足时 Hermes 以 "requires hermes …" 跳过插件，网关正常启动（spec 23 §4 的降级路径，Hermes 自带）。
- OpenClaw：`package.json#openclaw.compat.pluginApi: ">=2026.9.1"` + `minHostVersion`；
  install/registry 阶段强制。`connectYonder` 对未配对/无效 endpoint 只降级为 `yonder_status` 工具（真实状态文案），不让网关失败。

## 实测暴露并已修复的缺陷

1. **Hermes hello 从未发出**（`244da8b7`）：Python `CloudConnection` 没有 onOpen 钩子，云端一直显示离线。
   修复：on_open 回调在每次（重）连上发 `{type:"hello", workProtocol:1}`。
2. **Bot 登记打到错误端点**（`244da8b7`）：`put_agents` 用了插件配置 endpoint（默认公网），配对指向本地云时 Bot 登记到 yonderbot.net 得 401。
   修复：以 `config.json` 的配对端点为准。
3. **macOS 系统代理劫持 loopback**（`244da8b7`）：urllib 默认 opener 走系统代理（clash），本地云请求被代理转发。
   修复：云端客户端与 api_server REST 读取显式 `ProxyHandler({})`。
4. **OpenClaw 全局 WebSocket 不支持 headers**（`3eced438`）：undici 的 `WebSocket` 忽略选项包，无法带鉴权头。
   修复：两条连接（云端 + 本地网关）改用 OpenClaw 自带的 `ws` 包。
5. **握手死锁**（`3eced438`）：pump 在 `request("connect")` 返回后才启动，而 hello-ok 应答要由 pump 读。
   修复：`request()` 直接在同一条 socket 上读应答，其余帧走 `dispatch`（事件到连接器，其他 res 解各自的 pending）。
6. **`--no-prompt` 不存在**（`3eced438`）：`openclaw plugins install/uninstall` 的真实非交互形式是
   `--force --accept-capabilities`（uninstall 只有 `--force`）。安装器已改为真实 flags。

## 检查集

- `npm run build` / `npm run typecheck` 0。
- `npm run lint`：biome 报告的 16 个 error 全部位于本任务未触碰的 `tests/workbench-remote.test.ts` 与
  `apps/app/src/App.tsx`（基线前已有；`git log` 证明最后改动在本任务之前）。新增文件 0 error；
  size 0 文件超限、layers 无上行依赖。
- `npm test`：**2850 通过 / 0 失败 / 113 跳过**（525 文件通过 / 67 跳过；P4 基线 2819 → +31）。
  其中本任务新增：Hermes 37（24 单元 + 13 协议）+ OpenClaw 16 + connect 安装器 15（12 基线 + 15 新，总数 27）。
- `npm run test:node` 83/0/0；`npm run version:check` 通过（0.3.26110302）。
- Python 侧测试：`connectors/hermes/.venv-test/bin/python -m pytest test/unit.test.py test/protocol.test.py`
  37 通过（测试 venv 在 `.gitignore` 内，不影响发布；用 uv 从 `pyproject.toml` dev 组创建）。

## 未测

- **模型腿（真实回复往返）**：Hermes 隔离 home 无任何 provider 凭据；CONTRIBUTING.md 规定的测试凭据
  `YONDER_TEST_AUTH`（`.yonder/auth.json`）是 Yonder 自己的 OAuth，规则明确"OAuth 每个 home 独立登录，
  禁止复制其他程序的 OAuth"，不能复制进 Hermes/OpenClaw 的 home。因此 V10 的"真实模型回复回到网页"
  一环未测；已实测到真实提交进 harness（两边的真实 provider 错误都如实回传，未造假回复）。
  阻塞点：需要在一个隔离 harness home 里完成一次该框架自己的 provider 登录（交互式）。
- **真实 `npx -y @yonder/connect hermes|openclaw`**：包未发布 npm，只测了等价本地路径（dist 与 tarball）。
- **Hermes 的 gateway hooks、`trusted_inbound`**：按任务要求未使用、未启用。
- **Hermes Desktop / OpenClaw macOS app 里的安装**、Windows、Linux：只在 macOS arm64 跑过。
- **多会话并发**与长会话：单会话单轮；卡片/图片/文件入站在两侧都如实报"暂不支持"并 ack（协议行为已测，
  转换本身按 spec 23 §2.3 如实报错而非降级为纯文本——未做富媒体转换）。
- **Hermes `hermes plugins enable` 的 CLI 形式**：在有运行中网关的机器上会等待宿主锁（20 分钟观察未返回），
  安装器改为直接写 `plugins.enabled`（Hermes 文档的 drop-in + enable 路径），CLI enable 未作为安装器依赖。

## 环境隔离与清理

- 全程使用隔离 home：`/tmp/p5-hermes-home`、`/tmp/p5-openclaw-home`（均已删除）；真实 `~/.hermes`、
  `~/.openclaw` 未被写入（Hermes 网关以 `HERMES_HOME` 环境变量启动，OpenClaw 以 `OPENCLAW_HOME`/`OPENCLAW_STATE_DIR`）。
- 本地云 `/tmp/p5-cloud`（含隔离 PG 17 :15432、Redis :16379）已全部停止并删除。
- 上一轮遗留 scratch（`/tmp/p5-oc-home`、`/tmp/p5-hermes-home`、`/tmp/p5-spike-home`、`/tmp/p5-spike-gw.log`）已删除。
- 终检 `pgrep -fl "openclaw|hermes"` 为空；18430/15432/16379/19789/8642 无监听。
