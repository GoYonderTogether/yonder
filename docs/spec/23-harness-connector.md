# 23 外部 harness 连接器契约

2026-11-03 主人批准（决策 D2）。连接器把外部 agent 框架注册成云端账号里的一台"设备"和一个 Bot，复用云端已有的设备通道，而不为每个框架新增服务端协议。本规范定义连接器**必须**讲的那一部分协议、安装/卸载与版本降级规则，以及各框架的适配落点；实际完成程度见 [status](../status.md)。规范编号为 23：原计划的 22 已被 [22-shared-bot-core](22-shared-bot-core.md) 占用，两文互不替代。

**不复制 harness 转录。** harness 的会话状态与转录归它自己（架构不变量 4）；本规范只规定云端如何看到并驱动它们，不规定 Yonder 保存第二份会话历史。

## 1 定位与边界

- 连接器是**设备侧客户端**，不是新的云端服务。它主动出站连接云端（`wss://<endpoint>/ws/device`），不监听入站端口，不把 harness 本机端口暴露到公网。
- 云端、网页与 devices 插件不为每个框架分支：一台 `kind='harness'` 设备就是一台设备行（16 §5），它的 Bot 就是经 `PUT /api/device/agents` 登记的普通 Bot 账号。
- 连接器**不**提供设备执行能力：不上报执行端 deviceId 与公钥，不参与 18 的配对、grant 与命令账本，也不注册 `devices_*` 工具。需要跨设备操作时，由该 harness 里的 Bot 通过自身的工具（例如 Yonder 的 MCP 工具或工作桥暴露的工具）另行取得，与连接器无关。
- 连接器不实现模型调用、不代理模型凭据、不代填 owner；Bot 的模型、人格与额度仍归 harness 与云端各自的既有路径。

## 2 必须实现的协议子集

连接器讲的协议没有新增帧类型，全部取自现有设备通道；未列出的帧可以不实现，收到时按未知帧忽略而不是断开。

### 2.1 注册与身份

| 步骤 | 必须行为 |
|---|---|
| 设备绑定 | 用云账号签发的 deviceToken 建立 `/ws/device`；令牌只存 harness 自己的状态目录，权限 0600，不进日志、事件或模型上下文 |
| hello | 连接后发 `{type:'hello'}`；**不上报** `workProtocol` 之外的执行端身份字段，也不上报执行端 deviceId/公钥（16 §5） |
| 工作能力 | 会话方法可用时才在 hello 里宣告 `workProtocol: 1`；不能只因为连上就宣告 |
| 补收 | 服务端按 `agent_cursor` 补收；连接器只在处理完成后发 `{type:'ack', agentId, convId, seq}`，失败不 ack |

### 2.2 Bot 登记

`PUT /api/device/agents` 正文 `[{key, name, avatarUrl}]`，`key` 是连接器为该 harness 内 agent 生成的稳定标识（同一 harness 内不变，规范不约束其格式）。

必须遵守已有的全量对齐语义：**每次上报都是该 harness 当前的全部 agent**；连接器不得增量上报，否则云端会把未上报的旧 key 退役并停用其账号。harness 里 agent 列表变化时，等同步周期或主动重报全量。

### 2.3 消息

- 下行 `{type:'message', agentId, convId, convKind, mentioned, message}`：连接器把它作为输入投递进对应 harness agent 的会话。
- 上行 `{type:'send', ref, agentId, convId, content, replyTo?}`：只有服务端回 `{type:'sent', ref, message}` 才算接纳。15 秒内未确认、断连或已发后取消，一律返回未确认，**不自动重发**。
- 会话内的补收消息正文前加「补收」提示行（16 §3 已定），连接器必须保留该语义，不能把离线期间收到的旧指令当成当前指令。
- Card 的结构化 interactive 内容原样透传；连接器不支持的类型如实报错，不静默降级为纯文本。

### 2.4 工作方法

工作桥沿用 19 §3 的帧：下行 `work.request`（携带 requestId/ownerId/deviceId/method/params），上行 `work.response`；流下行 `work.open` / `work.frame` / `work.close`，上行 `work.event`。连接器必须实现的方法子集：

| 方法 | 语义 |
|---|---|
| `sessions.list` | 列出 harness 自己的会话摘要（id、标题、状态、最近活动时间）；不返回转录正文 |
| `sessions.open` | 打开或恢复一个已有会话，返回句柄；不新建 harness 会话除非方法参数明确要求 |
| `sessions.submit` | 向指定会话投递用户输入；返回接纳事实，不等待模型结束 |
| `sessions.transcript` | 分页读取该会话的转录条目，形状沿用网关既有投影（`TranscriptItem`），只读 |
| `sessions.abort` | 中止当前轮；不删除会话，不中止无关会话 |

事件流：`sessions.open` 后的 `work.open` 订阅该会话的事件；连接器把 harness 的真实事件转成 `work.event` 帧，断线只解除观察、不取消 harness 里的运行。方法名与参数形状沿用网关既有方法（19 §7 的共享控制面），连接器不能自造第二套命名。

连接器**不实现**：`sessions.fork`、会话迁移、跨设备 handoff、设备执行方法（`tools.catalog`/`tools.call`）以外的控制方法。收到不支持的方法以明确错误响应，让调用方看到"不支持"而不是超时。

## 3 harness 侧状态与隔离

- 会话状态、转录与运行循环完全留在 harness；连接器只持有一条到云端的连接、设备令牌和它自己的适配状态。
- 连接器读会话只经 harness 的进程内接口（或该框架官方对外接口），不直接读写 harness 的会话存储文件。
- 连接器状态写在 harness 自己的状态目录下（各框架具体路径见 §5），不写全局配置文件、不改 `PATH`、不写 `~/.gitconfig`、不写环境变量、不装全局命令。
- 入站路由如确实需要暴露给本机浏览器，只能走该框架带鉴权的路由注册（例如 DSH 的 `ctx.connection.fetch`），禁止无鉴权的裸路由。
- `apply`/启动阶段不做同步网络等待；连接失败只降级并如实显示状态，不让 harness 启动变慢或失败。

## 4 版本与降级

- 连接器在包元数据里声明所支持的 harness 版本范围（DSH 用 `engines.dsh`，Hermes/OpenClaw 用各自的 manifest 兼容字段）。
- 版本不满足时，连接器**降级而不是报错**：保留只提供工具或只提供 MCP 的最小形态，让 harness 正常启动、用户看到"版本不兼容"的真实原因；不静默假装已连接。
- 会话驱动方法集中在单个适配文件里，按 harness 版本矩阵测试；harness 升级导致方法签名变化时，只改适配文件，不改连接协议。
- 云端侧对旧连接器：不认识的方法按 §2.4 返回明确错误，不推测兼容。

## 5 各框架适配落点

| 框架 | 形态 | 会话驱动入口 | 状态目录 | 卸载残留 |
|---|---|---|---|---|
| DSH | 进程内 bundle 插件（`dsh.bundle` + 一段 patch） | `ctx.sessionController` 的 create/prompt/follow/cancel | `$DSH_HOME/yonder/` | 悬挂 symlink、lockfile、`.plugin-manager/logs`；由"断开"命令清除状态目录 |
| Hermes | `kind: platform` 平台插件（`plugin.yaml` + `adapter.py`） | 平台适配器 `connect/disconnect/send` 与 gateway 会话接口 | 连接器自管目录 | `hermes plugins remove` 后配置与插件目录为空 |
| OpenClaw | feature 插件（`openclaw.plugin.json` + `package.json#openclaw`） | Gateway 的 `sessions.*` RPC | 连接器自管目录 | `plugins.entries` 留一条 `enabled:false` 空条目 |

三者的共同硬规矩（§3）与降级规则（§4）相同；差异只在落点文件与卸载残留，如实记录，不宣称"零残留"除非实测如此。

## 6 安装与移除

- 安装可以是"让 harness 的 agent 执行一条命令"，但命令本身必须只做：装连接器包、写自己的状态目录、打开浏览器到云端的一次性配对页。它不改全局环境、不装全局命令。
- 配对的这一步等价于 16 §1 的方式二（网页发起邀请），沿用同一邀请码与兑换接口，不新增第二条注册路径。
- 移除必须能回到安装前的 harness 行为：卸载包或移除插件条目后，harness 不再连云端；连接器状态目录由显式"断开"命令清除，不在卸载时自动删用户数据。
- 连接器断开或卸载后，云端设备行与 Bot 按既有退役语义下线，不删除历史消息与账号；重新安装按新设备登记。

## 7 验收边界

- 连接器验收必须覆盖：设备登记、Bot 全量对齐、消息往返、五个会话方法与事件流、断线重连补收、卸载后的真实残留、版本不匹配降级。
- 需要模型的环节使用真实模型（本机 `openai/gpt-6-luna`，harness 使用其自身已配置的模型）；缺凭据记"未测"，不当通过。
- 连接器不得成为绕过 18 配对或 grant 的路径：本规范不提供任何设备执行方法，这一条以"方法集不含执行方法"和对应测试证明。
