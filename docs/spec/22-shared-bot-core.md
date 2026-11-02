# 22 共享 Bot 核心与云端 Worker

维护者 2026-11-02 授权，BRIEF 为本次实施任务书；本规范定义目标，实际完成程度见 status 与验证记录。

## 1 组合与存储

本机与云端必须共用 Bot 定义 schema/解析、systemPromptParts（含 turn）、路由、会话、投递、工具暴露和运行循环。核心不访问文件系统、进程或宿主 process 事实；HostFacts 由调用方注入。pi 模型/会话包只允许唯一运行时适配层 import，SDK 对这些包只能 import type，插件只依赖 SDK。保留既有 `executionContext(signal)`：仅 SDK index 从 chord/context 使用 `BACKGROUND_CONTEXT` 与 `withAbortSignal` 构造纯取消上下文，不放开其他运行导入。

BotSource 供应 Agent、agent.yaml、presets、prompt 模板、子 Agent、skills 与工作区文件。接口复用 WorkspaceFiles：home 来源含逻辑 root 与文件访问，workspace(entry) 选择 Agent 工作区，templates/skills 提供按既有优先序排列的文件来源。Skill 来源负责 canonical 路径事实，保留本机 symlink 边界；PG 来源使用受租户与 Bot 限定的虚拟路径。共享加载、重载、模板展开及 skill 发现算法均消费这些来源；旧本机离线命令可以保留 fs 兼容入口，但不能复制解析逻辑。定义来源 PG 实现位于 monorepo 的云端宿主包，内置及插件静态资产由宿主提供。本机目录来源与 PostgreSQL 来源使用同一解析器。WorkspaceFiles 的目录实现经 ExecutionEnv；DB 实现为按 bot_id/path 隔离的 bot_files 虚拟工作区。人格、用户资料与记忆仍使用 SOUL.md、AGENTS.md、USER.md、MEMORY.md、memories/*，每个 Bot 独立，不为人格建专用列。

事件、会话、pi 转录/文档、模型健康与工具输出缓存由运行状态存储接口提供：本机继续每 home 单 SQLite 连接，PG 实现按租户和 Bot 隔离。会话与转录仍只归 pi-durable，不能另存一份历史。插件使用 SDK storage.open(root?) 的私有文本文件/文档能力，按插件与宿主租户/Bot 隔离；本机默认保留原 api.paths.data 文件路径与格式，PG 使用 plugin_files 虚拟树，云端官方插件不得裸写宿主文件。memory 已配置个人库 root 保持本机原路径，PG 仅视为当前命名空间内的虚拟树名。tasks 的旧 SQLite 完整事件只读导入，经既有 replay 校验与新存储事务完成后才记标记，不删除旧库；详情见 04。本机与 worker 都由唯一宿主调度器驱动相同插件 tick，保留任务/cron/关注能力，不给云端 Bot 各自留 interval。

无环境使用同一实际NoEnvironment：逻辑路径/工作目录为宿主提供的逻辑值，任何文件或进程操作按ExecutionEnv契约明确不可用，不能偷偷选本机Node环境或伪造操作成功。BotSource和插件私有存储独立于环境，无环境仍读取本机/PG中的定义、人格和记忆。

轻量组合为核心 + 本机存储，完整组合追加本机环境层；零权限本机 Bot 与云端无环境 Bot 使用同一核心路径。本机验收从真实openKernel的environment:none组合进入，使用FS来源/单SQLite；云端使用PG来源/Storage，两者同一noEnvironment与createBot，不以孤立工厂或假内核代替。本次不改安装脚本。新增抽象在本次必须有两个真实使用中的实现，不留占位实现。

## 2 Worker 与消息路径

Worker 位于 yonder monorepo，一个进程服务全部云端 Bot，不为每账号/Bot 起容器或子进程。消息到达才从 PG 激活实例，活跃实例有上限，按 LRU 释放空闲实例；忙碌实例不能被释放。忙状态同时检查实际Runtime pending work、未完成tick及Trigger.busy所反映的执行/持久化/投递；cron launch返回不代表任务结束。忙状态解除必须唤醒等候激活，不新增每Bot轮询。Bot 不各自占用定时器、长连接或文件句柄，定时任务由唯一调度器扫描 PG 触发。插件deadline通过await schedule持久化后才确认操作；LRU detach仅解绑内存实例，不取消PGdeadline，真正取消计划才删除。outbound、去重维护、模型维护与插件tick的实际周期入口都由宿主集中驱动。

空载 RSS ≤150 MB；100 个 Bot 轮流对话、任何时刻最多 20 个活跃时 RSS ≤350 MB。负载脚本以回环模型传输 stub 测资源，再以真实模型跑少量轮次，记录每轮数据库往返。附件仅传引用，不下载大文件，浏览器下行数据量不超过既有消息路径。

输入仍调用真实渠道io.emit→router.emit，保留waiting=false的原自动投递；不用会抑制渠道回复的router.ask。worker在emit前建立当前sourceMessageId的活动处理项，等待共享channel-card的最终send/sent或最终Delivery失败才释放该Bot队列；失败/空答由同一共享delivery的单结果模式处理，外层不竞争补发。尚未进入核心的激活失败由宿主经同一真实send报告。socket中断结束当前活动处理项，server沿既有唯一结果槽写错误。主动deliveryId不冒用用户source槽。

Worker 复用 channel-card、/ws/device 帧和 appendMessage，作为受信任的特殊设备接入；server 不依赖 @yonder 包。服务端 `CLOUD_BOT_WORKER_KEY_FILE` 指向独立的私有 32 字节原始凭据（不是模型 key 文本）；worker 以其 base64url 作为 Bearer 接入同一 /ws/device。hello 后服务端发送 `{type:'bots',bots:[{id,name,ownerId}]}` 完整映射，创建或暂停状态变更用同帧刷新；只包含 enabled 的云端 Bot。输入仍为原 message 帧；响应用户的 send 必带 sourceMessageId（原用户消息 UUID），ref 仅确认。服务端 cloud_bot_turns 按 sourceMessageId 唯一关联结果，并与 appendMessage 同事务完成。cron/关注等程序投递和显式其他目标消息没有原用户消息，此时沿同一 send 使用现有 OutMessage.deliveryId，并按 Bot/投递ID持久去重，不占另一条用户输入的结果槽；不能以通道强制用户来源禁用主动能力。已有 /api/device/dm 同样接受受限 worker 身份，以 DB 中实际 Bot owner 和已有社交/会话规则核验，不伪造设备或用户会话。send 保留合法 replyTo；sourceMessageId 本身不强制引用。普通 HTTP/device 不可写 error。暂停 Bot 的新输入得到真实暂停错误，不派模型；其 online 以 enabled 和共享 worker 在线状态计算。单 server/worker 采用现有 Hub 的进程内在线状态，不据 Redis 广播宣称支持多 server 在线路由。鉴权须把 worker 的服务身份与目标 Bot/owner 关联，不能信任帧内自报租户。default/cloud 且没有 device_id 的 Bot 消息交给 worker；不再返回固定引导或整段转给主人设备。设备自己的 Bot 仍是独立联系人。

旧 runtimes.ts 与 runtime-supervisor.mjs 原样保留，不扩展、不作为云端 Bot 路径。删除范围列入报告供维护者决定。

## 3 提示词与模型

本机与云端使用同一 systemPromptParts 与默认 Bot contexts。createBot默认提供Runtime主系统sections与keys；本机的配置接纳事实可沿原接口追加，不让每个宿主自行补装必需的人格段。默认小未和新建云端 Bot 创建时或首次激活时，从 agent-presets 的既有默认模板生成自己的 SOUL.md 与 AGENTS.md；不新写人设。相同定义经 fs/DB 来源装配的系统提示词逐字相同，仅显式声明的 HostFacts 段允许不同。

云端仅通过已有 prompt.overrides 或 HostFacts 改环境段：运行在云端，无云端目录操作能力；列出当前已连接的设备，说明接入设备可解锁能力；需要设备/客户端时使用卡片工具引导绑定/安装，不只口头描述。

平台唯一模型为 RightAPI `glm-5.3-flash`，base_url 为 `https://api.site/v1`。密钥从运行时环境变量或沿用 *_KEY_FILE 的文件注入，不进入代码、日志、快照、转录或提交。平台每账号每小时模型回复默认上限 30，可配置；以 Bot 的 owner 账号汇总名下所有云端 Bot，匿名访客现有 10 条限制保持。cron/关注等程序派模型也须在实际新运行准入处使用同一平台Redis额度桶，不能只限制HTTP用户输入。server已准入的用户输入不得重复扣额；程序准入沿现有worker渠道身份核验Bot/owner，不信任自报租户，不在worker另设一套计数。合法会话成员的输入沿用既有准入，不因发送者不是 owner 而改为伪引导。

## 4 结构化卡片与错误

SDK OutMessage 支持至少 interactive 结构化内容，channel-card 原样透传。interactive.actions 每个按钮可有自己的 link；渲染使用 actions[i].link ?? content.link，保留旧客户端兼容性。server 校验与两端 MessageContent 类型同步。官方卡片工具接受标题、正文与按钮及应用内链接，本机、云端共用；验收卡片同时包含 /connect 与 /download 两个按钮。两份客户端路由均须可达；cloud旧前端的 /download 复用现有 /get 安装页，不另造页面或安装流程。

MessageContent 增加 `{type:'error',text:string}`，仅服务端或 worker 可写，客户端提交时拒绝。超时、HTTP 状态错误、网络/隧道故障、空回答、超额度、worker 不在线均生成真实中文原因，不含密钥、鉴权头或堆栈。每条用户消息只有一个结果：正常回复或一条错误；错误不进入后续模型历史。worker渠道声明output.singleResult，省略中间流/回退通知；对本轮来源的即时message_send明确失败并指导使用最终回复，不能返回伪发送成功或抢占结果槽。其他目标的主动发送仍按原权限和deliveryId投递。官方卡片工具只准备最终卡片，工具回执不得声称已投递，模型失败时不能先发卡片再吞掉错误。apps/app 使用 role="alert" 与 text-danger 渲染，不套正常气泡；会话列表支持该类型。云端输入框不再声明只能引导；其在线状态以实际 worker 为准，不使用设备 Bot 的“上线后送达”承诺掩盖云端失败。

## 5 远程设备工具

设备上线时发现其插件工具，按当前 owner、scope、能力与 grant 暴露给云端 Bot。通用 tools.call 进入现有 control registry，经 work-bridge/设备执行协议执行并返回结果，不新开通道。离线工具移出列表，调用中断如实报错；未知副作用不自动重放。不得因通用工具入口绕过原权限检查。

## 6 实施门槛

先在未改动的 a6a6c0b5 提交记录完整默认测试与 build 基线。每阶段执行 CONTRIBUTING 的完整 build/typecheck/test/lint（含 layer/size）；build、typecheck、lint 必须通过，测试相对基线不得新增失败。基线已存在的机器原因失败允许保留并如实记录，不阻止推进。模型测试使用真实 gpt-6-luna，云端端到端使用真实 glm-5.3-flash；缺凭据记未测。PG/Redis 仅在本机启动，用后关闭。验证区分源码、默认检查、真实模型、多租户、端到端与资源证据，不能互相替代。

pi-durable 若无法支持同进程多实例与 PG，先改本仓运行实现；否则评估两端共享的更轻循环，均不可行才停止。设备工具为最后阶段，若时间不足可停止并写清完成位置，不留桩。所有 A1–A12 结果及阶段提交、偏离、未测、迁移/环境变量/worker 启动/systemd 草案写入根目录未提交的 REFACTOR-REPORT.md。不得推送、部署或连接生产服务器。
