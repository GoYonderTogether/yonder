# 22 共享 Bot 核心与云端 Worker

维护者 2026-11-02 授权，BRIEF 为本次实施任务书；本规范定义目标，实际完成程度见 status 与验证记录。

## 1 组合与存储

本机与云端必须共用 Bot 定义 schema/解析、systemPromptParts（含 turn）、路由、会话、投递、工具暴露和运行循环。核心不访问文件系统、进程或宿主 process 事实；HostFacts 由调用方注入。pi 模型/会话包只允许唯一运行时适配层 import，插件只依赖 SDK。

BotSource 供应 Agent、agent.yaml、presets、prompt 模板、子 Agent、skills 与工作区文件。接口复用 WorkspaceFiles：home 来源含逻辑 root 与文件访问，workspace(entry) 选择 Agent 工作区，templates/skills 提供按既有优先序排列的文件来源。Skill 来源负责 canonical 路径事实，保留本机 symlink 边界；PG 来源使用受租户与 Bot 限定的虚拟路径。共享加载、重载、模板展开及 skill 发现算法均消费这些来源；旧本机离线命令可以保留 fs 兼容入口，但不能复制解析逻辑。定义来源 PG 实现位于 monorepo 的云端宿主包，内置及插件静态资产由宿主提供。本机目录来源与 PostgreSQL 来源使用同一解析器。WorkspaceFiles 的目录实现经 ExecutionEnv；DB 实现为按 bot_id/path 隔离的 bot_files 虚拟工作区。人格、用户资料与记忆仍使用 SOUL.md、AGENTS.md、USER.md、MEMORY.md、memories/*，每个 Bot 独立，不为人格建专用列。

事件、会话、pi 转录/文档、模型健康与工具输出缓存由运行状态存储接口提供：本机继续每 home 单 SQLite 连接，PG 实现按租户和 Bot 隔离。会话与转录仍只归 pi-durable，不能另存一份历史。插件使用 SDK 的私有键值/文档/小文件存储，按插件与租户隔离；本机可以继续在原 api.paths.data 目录落盘，云端官方插件不得裸写宿主文件。

轻量组合为核心 + 本机存储，完整组合追加本机环境层；零权限本机 Bot 与云端无环境 Bot 使用同一核心路径。本次不改安装脚本。新增抽象在本次必须有两个真实使用中的实现，不留占位实现。

## 2 Worker 与消息路径

Worker 位于 yonder monorepo，一个进程服务全部云端 Bot，不为每账号/Bot 起容器或子进程。消息到达才从 PG 激活实例，活跃实例有上限，按 LRU 释放空闲实例；忙碌实例不能被释放。Bot 不各自占用定时器、长连接或文件句柄，定时任务由唯一调度器扫描 PG 触发。

空载 RSS ≤150 MB；100 个 Bot 轮流对话、任何时刻最多 20 个活跃时 RSS ≤350 MB。负载脚本以回环模型传输 stub 测资源，再以真实模型跑少量轮次，记录每轮数据库往返。附件仅传引用，不下载大文件，浏览器下行数据量不超过既有消息路径。

Worker 复用 channel-card、/ws/device 帧和 appendMessage，作为受信任的特殊设备接入；server 不依赖 @yonder 包。鉴权须把 worker 的服务身份与目标 Bot/owner 关联，不能信任帧内自报租户。default/cloud 且没有 device_id 的 Bot 消息交给 worker；不再返回固定引导或整段转给主人设备。设备自己的 Bot 仍是独立联系人。

旧 runtimes.ts 与 runtime-supervisor.mjs 原样保留，不扩展、不作为云端 Bot 路径。删除范围列入报告供维护者决定。

## 3 提示词与模型

本机与云端使用同一 systemPromptParts 与默认 Bot contexts。默认小未和新建云端 Bot 创建时或首次激活时，从 agent-presets 的既有默认模板生成自己的 SOUL.md 与 AGENTS.md；不新写人设。相同定义经 fs/DB 来源装配的系统提示词逐字相同，仅显式声明的 HostFacts 段允许不同。

云端仅通过已有 prompt.overrides 或 HostFacts 改环境段：运行在云端，无云端目录操作能力；列出当前已连接的设备，说明接入设备可解锁能力；需要设备/客户端时使用卡片工具引导绑定/安装，不只口头描述。

平台唯一模型为 RightAPI `glm-5.3-flash`，base_url 为 `https://api.site/v1`。密钥从运行时环境变量或沿用 *_KEY_FILE 的文件注入，不进入代码、日志、快照、转录或提交。平台每账号每小时模型回复默认上限 30，可配置；以 Bot 的 owner 账号汇总名下所有云端 Bot，匿名访客现有 10 条限制保持。合法会话成员的输入沿用既有准入，不因发送者不是 owner 而改为伪引导。

## 4 结构化卡片与错误

SDK OutMessage 支持至少 interactive 结构化内容，channel-card 原样透传。interactive.actions 每个按钮可有自己的 link；渲染使用 actions[i].link ?? content.link，保留旧客户端兼容性。server 校验与两端 MessageContent 类型同步。官方卡片工具接受标题、正文与按钮及应用内链接，本机、云端共用；验收卡片同时包含 /connect 与 /download 两个按钮。

MessageContent 增加 `{type:'error',text:string}`，仅服务端或 worker 可写，客户端提交时拒绝。超时、HTTP 状态错误、网络/隧道故障、空回答、超额度、worker 不在线均生成真实中文原因，不含密钥、鉴权头或堆栈。每条用户消息只有一个结果：正常回复或一条错误；错误不进入后续模型历史。apps/app 使用 role="alert" 与 text-danger 渲染，不套正常气泡；会话列表支持该类型。

## 5 远程设备工具

设备上线时发现其插件工具，按当前 owner、scope、能力与 grant 暴露给云端 Bot。通用 tools.call 进入现有 control registry，经 work-bridge/设备执行协议执行并返回结果，不新开通道。离线工具移出列表，调用中断如实报错；未知副作用不自动重放。不得因通用工具入口绕过原权限检查。

## 6 实施门槛

先在未改动的 a6a6c0b5 提交记录完整默认测试与 build 基线。每阶段执行 CONTRIBUTING 的完整 build/typecheck/test/lint（含 layer/size）；build、typecheck、lint 必须通过，测试相对基线不得新增失败。基线已存在的机器原因失败允许保留并如实记录，不阻止推进。模型测试使用真实 gpt-6-luna，云端端到端使用真实 glm-5.3-flash；缺凭据记未测。PG/Redis 仅在本机启动，用后关闭。验证区分源码、默认检查、真实模型、多租户、端到端与资源证据，不能互相替代。

pi-durable 若无法支持同进程多实例与 PG，先改本仓运行实现；否则评估两端共享的更轻循环，均不可行才停止。设备工具为最后阶段，若时间不足可停止并写清完成位置，不留桩。所有 A1–A12 结果及阶段提交、偏离、未测、迁移/环境变量/worker 启动/systemd 草案写入根目录未提交的 REFACTOR-REPORT.md。不得推送、部署或连接生产服务器。
