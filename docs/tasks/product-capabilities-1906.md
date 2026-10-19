# Yonder 1906 产品能力与 Hermes / OpenClaw 全貌对比

> 历史快照。1907现已发布并安装：补充后台process/软阈值、cron、通用MCP客户端、独立自动化与Agent热管理，见[1907结果](execution-capabilities-result.md)。本页不据新代码改写当时的比较和未测，也不表示重新验收了Hermes/OpenClaw。

核对日期：2026-10-19。Yonder 正式版本0.1.2026101906，发布提交3dab0d35ec346ee074a0ef9a51a19eedfb4680b0。比较口径由用户指定为“安装默认能力、体验细节与扩展边界”。Hermes/OpenClaw按本日官方文档核对，不是三产品在同一任务/模型上的实机评分；官方具备的功能也要按凭据、配置与平台条件启用。

## 1. 判断

Yonder已经有完整的“接任务→工具执行→持久会话→交付结果”主链；这台Mac配置后的贾维斯可以实际接任务，哦鲸鲸有项目维护职责。日常读写文件、命令、网页和飞书互动的基础形态确实接近。

但“这台已配置的Mac”不能替代“陌生用户刚安装”。安装引导、长期记忆、定时任务、后台进程/PTY和通用MCP客户端是明确差距；其中后四项不是按钮或文案细节，是尚未提供的功能板块。不能据此声称三者已经同等完整、同等稳定或有相同任务成功率。

## 2. 三层必须分开

| 层次 | Yonder当前实际内容 |
|---|---|
| 新用户init默认 | 一个内部id=main的Agent、一个default临时任务preset、CLI渠道和context-files；登录模型、启动服务后可用原生文件/命令/grep/任务工具。不会自动复制本机飞书、GitHub、两个具名Agent或媒体凭据 |
| 本机已配置 | 贾维斯/main（Luna）、哦鲸鲸/maintainer（Sol）；CLI、MCP服务端、飞书人生管家、GitHub项目渠道；浏览器、Computer Use桥接、Web工具；程序更新通知；macOS常驻与状态栏 |
| 已随包但本机未启用 | media-tools图片生成/ASR，未加载到正式home且services为空。已有源码插件+真实免费API证据，不等于贾维斯当前能直接用媒体工具 |

1906包含9个官方插件包，本机加载8个；共29个插件模型工具中本机加载27个，实际可见还由profile权限/offer/search选择决定。计数不包含原生文件/命令等工具，也不把MCP19个外部操作算成本机模型工具。已有6个上下文贡献并不等于6个记忆能力。

## 3. 产品现在能做什么

| 工作板块 | 可以实际交给它的工作 | 现有限制 |
|---|---|---|
| 日常管家 | 从飞书或裸yonder给贾维斯发任务，在同一个主会话中追问、补充和中止 | 同一CLI渠道实例一次一个客户端；不等于多窗口任意同时发送 |
| 本机开发 | 读写/编辑文件、rg检索、运行命令、用已有preset委派子任务，查原始工具与会话结果 | 无专用持久process/PTY管理工具；长任务仍受当前运行上限，不会默认无限自续 |
| 网页工作 | 用BrowserSkill操作已配置浏览器、观察/截图/表单与标签页；Web搜索与正文提取 | 扩展/守护服务、登录态与权限必须就绪；全部38个浏览器动作未逐项真实验收 |
| 桌面操作 | 通过codex-tools桥接可用的本机Computer Use工具 | 依赖宿主工具、系统授权和会话状态，不是Yonder自带独立跨平台桌面驱动 |
| 飞书 | 私聊/群消息、历史上下文、附件与卡片/流式、主动发送、引用/艾特、共享help/session/skills/stop | 完整线程/媒体/断网/执行中插话矩阵未全部验收，部分由用户选择日用反馈 |
| 维护本项目 | GitHub issue准入→哦鲸鲸处理→提交commit/PR；Codex审查合并 | 已有单链实证，不是任意仓库零配置、无人监督持续自动合并 |
| 程序自动化 | 插件订阅原始事件后直接调用函数/明确脚本；可发外部通知或内部session通知，不调用模型 | 已有SDK入口，不是让普通用户一句话就建立任意脚本流水线的可视化产品 |
| 版本管理 | 正式Release按授权策略程序升级，核对版本/提交/home/pid/ready，程序发送通知；下次对话可看到新版事实 | 本轮一次真实1905→1906已过；其他失败/崩溃/升级组合不因此自动通过 |
| Skills | 发现索引、按需读取、本地导入/查看/删除、creator指导创作，用户可选择技能 | 没有广泛内置专业技能市场或自动复盘学习引擎 |

## 4. 官方插件与职责

| 注册名 | 本机状态 | 一句话功能 |
|---|---|---|
| channel-cli | 已加载 | 接入本地终端消息，连接常驻Agent |
| context-files | 已加载 | 按选择读取AGENTS/USER/SOUL/MEMORY文件，不自动记忆提炼 |
| channel-mcp | 已加载 | 让外部Agent通过19个MCP操作控制Yonder，不是连接任意外部MCP服务器 |
| browser-skill | 已加载 | 提供BrowserSkill浏览器工具、连接诊断与资源清理 |
| codex-tools | 已加载 | 桥接本机Codex/ChatGPT工具，包括可用的Computer Use与搜索 |
| web-tools | 已加载 | 搜索、网页提取与有界fetch，依赖可用服务/桥接配置 |
| channel-github | 已加载 | issue/PR工具、发布监听、程序更新通知及新版上下文 |
| channel-feishu | 已加载 | 飞书收发、历史/流式/媒体卡片及来源上下文 |
| media-tools | 随包未加载 | 调用已配置SiliconFlow图片/ASR服务并返回实际产物 |

贾维斯当前5个skill：browser-skill（插件提供）、skill-creator、yonder-development、yonder-plugin-debug、yonder-self-management（后四个内置）。只注入索引，全文按需读。哦鲸鲸的显式白名单保留原选择并追加self-management，未强行开启其他技能。没有为了编码/GitHub堆一套通用教程。

## 5. 刚安装的默认体验

以下以完成各自标准引导/必要授权为前提；下载二进制不等于所有渠道/服务都已配置。

| 体验 | Yonder | Hermes官方路径 | OpenClaw官方路径 |
|---|---|---|---|
| 安装到首轮对话 | 源码构建→update→init→独立登录→服务；命令明确，但缺少完整交互向导 | 安装器和setup/model向导，CLI/TUI可选 | 安装/引导探测可用模型连接，经用户选择与实际回复核验后开启Dashboard |
| 人的入口 | 原生pi TUI、飞书、状态栏；没有Web聊天控制台/桌面聊天客户端 | CLI/TUI，另有Desktop安装入口 | Web Control UI、TUI及可选平台应用 |
| 模型/工具配置 | YAML+models/inspect/doctor；部分配置热加载 | model/tools/setup交互入口 | onboarding/configure及工具profile/策略 |
| 角色开场 | 产品init只有最小空段模板；本机另设贾维斯/哦鲸鲸 | 提供人格/SOUL与工作区配置能力 | 自动准备身份/行为等工作区模板，支持角色来源 |
| 渠道接入 | 这台Mac已接飞书/GitHub；陌生用户需配置插件、实例、身份和绑定 | gateway setup指导接消息平台 | channels/onboarding按平台引导，仍需各平台授权 |

依据：[Hermes Quickstart](https://hermes-agent.nousresearch.com/docs/getting-started/quickstart/)、[OpenClaw Onboarding](https://docs.openclaw.ai/start/wizard)、[OpenClaw个人助理设置](https://docs.openclaw.ai/start/openclaw/index.html)。这说明差距主要是安装配置被产品化的程度，不是别人无需任何模型账号或平台凭据。

## 6. 日常任务中的细节差异

| 真实场景 | Yonder当前体验 | 对照产品具备的进一步能力 | 差距性质 |
|---|---|---|---|
| “明天早上提醒我” | 没有cron插件；GitHub的30秒轮询只负责GitHub，不是通用定时器 | Hermes cron；OpenClaw automations/cron可保存调度与运行记录 | 缺完整板块 |
| “以后都记住我的偏好” | 同会话/压缩历史和选中的文件可保留信息，模型可主动编辑文件；无专用长期记忆提炼/检索 | Hermes持久记忆/复盘机制；OpenClaw默认memory-core、检索与内存整理机制 | 缺完整板块 |
| “上个月另一个任务说过什么” | 会话列表、事件筛选、指定转录可查；无专用跨会话全文/语义检索 | Hermes会话检索；OpenClaw会话/记忆检索工具 | 目前需要更多手工查找 |
| “启动开发服务器，继续改代码” | 有Bash，但无可持续poll/log/write/kill的专用进程句柄 | 两者都提供后台进程管理；Hermes还明确支持PTY交互 | 开发体验明显不足 |
| “连接这个MCP服务” | 现有是别人控制Yonder的MCP服务端；Codex桥接不等于通用客户端 | 两者有配置外部MCP服务及认证/工具选择入口 | 缺客户端板块 |
| “读取PDF，语音和我对话” | 附件是传输基础，不等于文档解析；ASR随包未启用，未实现完整录音/播放/TTS/视频流程 | Hermes文档/语音工具；OpenClaw PDF、媒体/语音能力按服务配置 | 服务和交互链都未齐 |
| “用某个skill” | 自然语言让模型按需skill_view，/skills列目录；无自动/skill-name命令 | Hermes与OpenClaw有更丰富技能命令/目录、管理与生态 | 本地能力接近，发现/管理体验有差距 |
| “开一个独立维护助理” | 可以配置常驻Agent或preset；注册尚需重启，热CRUD/模板创建方案未实现 | Hermes profile/Bot路径；OpenClaw agents add及角色/绑定辅助 | 已有底层，但管理产品未完成 |
| “检查数据，没变化就别叫AI” | 插件程序订阅与脚本路径已实测；无通用任务创建界面 | Hermes no_agent脚本cron及wakeAgent门控；OpenClaw hooks/命令或脚本调度 | 同方向，普通用户配置体验仍薄 |
| “把不可信代码放隔离环境跑” | 当前本机exec不是沙箱；env槽不等于容器实现 | Hermes可选Docker/SSH等后端；OpenClaw有工具策略/沙箱配置 | 实际隔离能力缺失，不能用权限级别冒充 |

资料：[Hermes cron](https://hermes-agent.nousresearch.com/docs/user-guide/features/cron/)、[Hermes memory](https://hermes-agent.nousresearch.com/docs/user-guide/features/memory/)、[Hermes tools/process](https://hermes-agent.nousresearch.com/docs/user-guide/features/tools/)、[Hermes MCP](https://hermes-agent.nousresearch.com/docs/user-guide/features/mcp/)、[Hermes skills](https://hermes-agent.nousresearch.com/docs/user-guide/features/skills/)。

[OpenClaw automations](https://docs.openclaw.ai/automation/cron-jobs)、[OpenClaw memory](https://docs.openclaw.ai/concepts/memory)、[OpenClaw exec/process](https://docs.openclaw.ai/tools/exec)、[OpenClaw MCP](https://docs.openclaw.ai/tools/mcp)、[OpenClaw skills](https://docs.openclaw.ai/tools/skills)、[OpenClaw multi-agent](https://docs.openclaw.ai/concepts/multi-agent)、[OpenClaw hooks](https://docs.openclaw.ai/automation/hooks)。上述功能存在不代表默认全部开启、免费、无依赖或本次已实际验收过。

## 7. 架构和扩展边界

Yonder的取向：pi负责模型循环/转录；核心负责事件、绑定、身份、权限与投递；插件提供业务；skill放有价值的领域指导。程序动作可以绕过LLM，但不能伪造Agent运行、扩大权限或直接改会话数据库。可查询事件、工具转录、更新回执及发送Delivery，便于判断“接纳/运行/送达”分别发生了什么。

这不是Yonder独有能力。Hermes已有脚本不唤醒模型的cron，OpenClaw已有程序hooks和脚本/命令自动化；不能把这次修正包装成别人没有的领先特性。

Yonder本轮没有把每个差距立项。cron/记忆/角色哲学仍按用户原安排后置；热Agent管理单列方案不算已实现。减少通用coding skill冗余是用户确定的取舍，不是必须靠追数量补齐的缺陷。

## 8. 用户实际感受的结论

- “让它现在替我做一项有工具可用的任务”：可以开始用，不需要先补通用编码skill。
- “像管家一样过几天还自动记得、按时主动做、长进程随时接回来”：仍有上述实质缺口。
- “别人下载也和这台Mac一样顺手”：还缺安装/授权/插件/角色配置的引导闭环，不能把Codex配置过的环境当成开箱默认。
- “是否一样聪明/稳定/省钱”：当前没有同模型同任务基准，不能据功能清单下结论；模型、提示词、工具反馈和任务环境都会影响体验。

原Hermes对照历史保存在hermes-capability-comparison.md，原失败/未测不改为通过。发行、正式配置及无模型通知证据见release1906-result.md。
