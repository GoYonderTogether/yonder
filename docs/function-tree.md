# 全量功能与注册名树

日期：2026-10-19。按当前源码实际注册整理，供正式发行查看；注册存在不表示全部真实场景通过。详细参数以工具schema、[SDK类型](../packages/sdk/src/types.ts)及[CLI源码](../packages/cli/src/index.ts)为准。

**读法**：plugin ID是包的贡献命名空间；channel type是配置中的渠道类型，实例ID由配置指定；tools.register是模型工具，MCP server工具是外部协议接口；contexts/trigger/events分别是上下文、生命周期触发器、事件订阅，不能混为一个“功能完成数”。每个叶节点说明一个最小操作，不列内部私有函数来冒充额外功能。

源码当前12个官方插件，4种具体渠道、35个插件模型工具、7个上下文贡献、5个生命周期trigger、1个插件skill目录；MCP另有19个外部协议工具，Browser7工具内含38个动作。数量来自manifest与实际实现，SDK的8个槽不等于8种插件都已实现。

## 1. 核心与用户入口

```text
Yonder Harness
├─ 原生runtime工具
│  ├─ read — 读取当前工作区文件
│  ├─ write — 写入文件
│  ├─ edit — 修改已有文件内容
│  ├─ bash — 在当前执行环境运行命令
│  ├─ grep — 通过rg搜索有权访问的文件
│  └─ tool_search — 按需发现配置允许的工具
├─ Kernel实际模型工具（8）
│  ├─ message_send — 向明确人/账号/会话发送消息
│  ├─ agent_ask — 按目标agent绑定提问并等待结果
│  ├─ task_run — 使用preset委派原生子任务
│  ├─ session_list — 按权限列出会话
│  ├─ session_read — 按权限读取原生转录
│  ├─ identity_lookup — 查询账号/人物/会话关系
│  ├─ identity_link — 显式关联或解除身份映射
│  └─ skill_view — 读取已选skill正文或资源
├─ 内置skills（不是插件）
│  ├─ skill-creator — 创建/维护技能；辅助Python脚本需要PyYAML
│  ├─ yonder-development — 建议隔离目录、Git保存和可审查交付；用户可不采用
│  ├─ yonder-plugin-debug — 按需执行渠道短任务、查询调用证据及隔离复现；随1905内置
│  └─ yonder-self-management — 目录、配置、身份、委派与更新规约；1906内置并已安装
└─ 核心职责
   ├─ 事件 → 绑定 → 身份/权限 → 原生会话/队列 → 模型/工具 → 投递
   ├─ pi-durable — 独占转录、执行循环、恢复、子会话与压缩
   ├─ Yonder — 配置、事件、来源、上限、上下文组装、插件、投递与安装
   ├─ 统一日志 — 安全JSONL诊断，不新增日志服务
   └─ macOS状态栏 — 状态、检查更新、退出；不是桌面客户端
```

```text
yonder · CLI
├─ init — 初始化一个Yonder home和默认配置。
├─ login <provider> — 为指定模型供应商执行交互式登录。
├─ doctor — 检查home配置并列出错误或警告。
├─ start — 在前台启动harness服务。
├─ stop — 请求停止当前home的harness服务。
├─ chat — 进入原生TUI，或用--plain/--json进行非TUI交互；目标可选preset、session或channel。
├─ sessions list — 按agent、mode、open条件列出会话。
├─ sessions show <id> — 读取会话信息及转录。
├─ sessions open <preset> [--keep-open] — 创建预设任务，默认run-end；--keep-open创建manual task。
├─ sessions notify <id> --event <id> --text <text> — 写入带来源的程序通知，不调用模型（1906）。
├─ sessions submit <id> — 向已有会话提交文本或附件。
├─ sessions abort <id> — 中止指定会话运行。
├─ sessions close <id> — 关闭指定task会话。
├─ events — 按type、from、conv、agent、时间区间或游标查询事件。
├─ identity lookup <ref> — 查询账号、人、会话关联。
├─ identity link <account> <person> — 关联账号与人。
├─ identity unlink <account> — 解除账号关联。
├─ identity person <id> <name> — 创建person记录。
├─ skills — 查看当前agent/profile的可用技能。
├─ skills show <name> — 查看某个技能。
├─ skills add <directory> — 为agent添加本地技能目录。
├─ skills remove <name> — 删除受管理技能目录副本，保留原来源。
├─ plugins list — 列出插件。
├─ plugins show <id> — 查看插件信息。
├─ plugins add <source> — 从目录或包来源添加插件。
├─ plugins remove <id> — 移除插件。
├─ models list — 列出模型目录。
├─ inspect — 查看指定agent/profile的有效配置。
├─ version — 查看版本、安装来源与home信息。
├─ changelog — 查询两个版本之间的变更记录。
├─ docs — 列出或读取随包文档。
├─ update --check — 查询正式Release版本状态。
├─ update [--to <tag>] / update latest — 按指定标签或最新版本标签安装；可指定repository。
├─ service install — 安装home对应的系统服务。
├─ service uninstall — 移除系统服务。
├─ service start / stop / restart — 管理已安装服务。
├─ service status / info — 查看服务状态或运行中进程的版本、commit、home、PID、ready状态。
└─ completion zsh / bash / fish — 输出对应shell的静态命令补全及只读动态候选脚本。
```

```text
chatCommands · TUI
├─ /new — 选择预设并开始新的独立任务。 [否，TUI专用]
├─ /resume — 从原生会话选择器恢复会话。 [否，TUI专用]
├─ /session — 显示当前会话信息。 [是]
├─ /hotkeys — 显示或隐藏当前快捷键提示。 [否，TUI专用]
├─ /channel — 选择常驻CLI渠道并进入其绑定目标。 [否，TUI专用]
├─ /skills — 列出当前会话实际可用的技能。 [是]
├─ /stop — 中止当前会话运行。 [是]
├─ /close — 关闭manual task。 [否，TUI专用]
└─ /help — 显示当前入口可用的slash command。 [是]
```

飞书仅使用四个共享命令：`/help`、`/session`、`/skills`、`/stop`；双斜杠转义按普通消息处理。管理命令不是模型工具，TUI专用命令不在飞书另造一套。

## 2. 官方插件展开树

### channel-cli

```text
channel-cli
├─ package
│  └─ @yonder/plugin-channel-cli
├─ channels.register
│  └─ type="cli" · dm · Unix socket；同实例一次一个通道客户端
├─ events.on
│  └─ 无
└─ 内部功能（不是额外注册名）
   ├─ 接收 — 从Unix socket接收文本或分帧输入，生成带本地账号/会话来源的消息事件
   ├─ 多行输入 — 将一帧多行文本作为一条输入提交
   ├─ 发送 — 向连接中的终端交付文字或流式输出片段
   ├─ 生命周期 — 启动时监听socket，停止时关闭连接并清理本插件socket
   └─ 连接边界 — 每实例同一时刻接纳一个通道客户端，不能把全局单服务解释成无限并发CLI连接
```

### context-files

```text
context-files
├─ package
│  └─ @yonder/plugin-context-files
├─ contexts.register · placement=system
│  ├─ agents-md — 按选择读取AGENTS.md，提供工作规则
│  ├─ user-md — 按选择读取USER.md，提供用户资料
│  ├─ soul-md — 按选择读取SOUL.md，提供agent行为设定
│  └─ memory-md — 按选择读取MEMORY.md，提供已存文本
├─ events.on
│  └─ 无
└─ 内部功能（不是额外注册名）
   └─ 文件准备 — 仅为选中的上下文按现有模板补初始文件
```

### channel-mcp

```text
channel-mcp
├─ package
│  └─ @yonder/plugin-channel-mcp
├─ channels.register
│  └─ type="mcp" · loopback HTTP /mcp · Streamable HTTP/SSE
├─ events.on
│  └─ 无
└─ MCP server.registerTool（外部控制接口，不是模型tools.register）
   ├─ channel-mcp_events_emit — 接纳事件并返回事件标识，不等待模型执行
   ├─ channel-mcp_events_ask — 提交事件并等待绑定运行的原生结果
   ├─ channel-mcp_events_query — 按条件分页读取事件账本
   ├─ channel-mcp_sessions_list — 筛选并列出持久会话
   ├─ channel-mcp_sessions_get — 读取指定会话元数据
   ├─ channel-mcp_sessions_open — 按已有preset打开会话
   ├─ channel-mcp_sessions_submit — 向preset会话提交输入，并按参数等待或立即返回
   ├─ channel-mcp_sessions_watch — 被动观察已有运行进度，观察连接断开不取消任务
   ├─ channel-mcp_sessions_abort — 显式取消会话运行及相应排队输入
   ├─ channel-mcp_sessions_close — 关闭指定会话
   ├─ channel-mcp_sessions_transcript — 分页读取原生转录条目
   ├─ channel-mcp_identity_account — 读取渠道账号身份
   ├─ channel-mcp_identity_person — 读取统一人物身份
   ├─ channel-mcp_identity_lookup — 按已知标识查询身份映射
   ├─ channel-mcp_identity_relation — 读取身份关系
   ├─ channel-mcp_identity_createPerson — 创建统一人物记录
   ├─ channel-mcp_identity_link — 在权限允许时建立账号与人物映射
   ├─ channel-mcp_identity_unlink — 在权限允许时解除身份映射
   └─ channel-mcp_messages_send — 通过共享投递入口向指定人、账号或会话发送消息及附件
```

### browser-skill

```text
browser-skill
├─ package
│  └─ @yonder/plugin-browser-skill
├─ tools.register
│  ├─ browser-skill_setup
│  │  ├─ status — 检查bsk、守护服务和扩展连接状态
│  │  ├─ start-daemon — 启动本地浏览器守护服务
│  │  └─ guide — 提供扩展安装与配置引导，按明确选项打开页面
│  ├─ browser-skill_session
│  │  ├─ start — 为当前agent会话建立浏览器会话
│  │  ├─ stop — 结束本会话拥有的浏览器会话
│  │  └─ list — 列出归属当前agent的浏览器会话
│  ├─ browser-skill_page
│  │  ├─ navigate — 将当前页面导航到指定URL
│  │  ├─ back — 返回上一页
│  │  ├─ forward — 前进到下一页
│  │  ├─ reload — 重新加载当前页
│  │  ├─ wait — 等待页面导航达到指定状态
│  │  └─ wait-for-element — 等待指定页面元素出现
│  ├─ browser-skill_inspect
│  │  ├─ observe — 读取可操作的页面观察结果
│  │  ├─ snapshot — 读取页面结构快照
│  │  ├─ html — 读取目标页面HTML
│  │  ├─ screenshot — 生成页面截图
│  │  ├─ console — 读取页面控制台记录
│  │  └─ network — 读取页面网络记录
│  ├─ browser-skill_interact
│  │  ├─ click — 点击指定页面目标
│  │  ├─ fill — 填写指定输入框
│  │  ├─ select — 设置选择控件的选项
│  │  ├─ press — 发送按键
│  │  ├─ hover — 将指针移到指定目标
│  │  ├─ wheel — 执行滚轮操作
│  │  ├─ scroll-to — 滚动到指定目标
│  │  ├─ focus — 聚焦目标元素
│  │  ├─ blur — 取消目标元素焦点
│  │  ├─ resize — 调整浏览器窗口尺寸
│  │  ├─ emulate — 设置已有浏览器模拟参数
│  │  └─ request-help — 请求用户协助处理当前浏览器步骤
│  ├─ browser-skill_tabs
│  │  ├─ list — 列出可用标签页
│  │  ├─ create — 创建标签页
│  │  ├─ select — 选择工作标签页
│  │  ├─ close — 关闭指定标签页
│  │  ├─ borrow — 按现有协议借用用户标签页
│  │  └─ return — 归还借用的标签页
│  └─ browser-skill_file
│     ├─ upload — 向页面上传指定文件
│     └─ download — 取得页面触发的下载产物
├─ skills.register
│  └─ browser-skill — BrowserSkill使用指导，按需读取
├─ triggers.register
│  └─ browser-skill-cleanup — 启停时清理归属浏览器资源；不是cron
└─ events.on
   └─ session.close — 清理该会话拥有的浏览器资源
```

### codex-tools

```text
codex-tools
├─ package
│  └─ @yonder/plugin-codex-tools
├─ tools.register
│  ├─ codex-tools_status — 发现本机CUA说明与schema，报告可用入口
│  ├─ codex-tools_js — 通过本机CUA执行应用发现、界面读取、截图或操作
│  ├─ codex-tools_js_reset — 清空JS绑定，保留已经发生的应用操作
│  └─ codex-tools_search — 调用本机Codex hosted search并返回来源和原生证据
├─ triggers.register
│  └─ codex-tools-lifecycle — 管理本插件app-server资源生命周期
└─ events.on
   └─ run.end — 释放当前run的JS绑定与连接
```

### web-tools

```text
web-tools
├─ package
│  └─ @yonder/plugin-web-tools
├─ tools.register
│  ├─ web-tools_search — 调用Tavily检索公开网页并返回来源
│  ├─ web-tools_extract — 调用Tavily抽取指定URL的正文
│  └─ web-tools_fetch — 执行有界HTTP GET并处理支持的文本、HTML、JSON或Markdown
└─ events.on
   └─ 无
```

### channel-github

```text
channel-github
├─ package
│  └─ @yonder/plugin-channel-github
├─ channels.register
│  └─ type="github" · kind=issue — 接收issue/评论，向issue交付回复
├─ tools.register
│  ├─ channel-github_status — 读取仓库、准入条件与更新策略状态
│  ├─ channel-github_read_issue — 读取issue正文和全部评论，拒绝把PR当issue
│  ├─ channel-github_comment — 向获准issue发送可追踪评论
│  ├─ channel-github_repository — 读取克隆地址、默认分支及可选分支头
│  ├─ channel-github_create_pr — 为已推送分支创建或复用指定head/base的PR
│  ├─ channel-github_read_pr — 读取PR元数据、文件补丁、提交和检查状态
│  ├─ channel-github_read_release — 读取真实Release及其更新适用信息
│  ├─ channel-github_update_schedule — 依获准策略启动固定仓库/版本的服务外更新作业
│  └─ channel-github_update_status — 读取作业回执与实际服务版本核验
├─ 外部输入 / 发出事件
│  ├─ issue/comment轮询 → message.in — 按准入与水位接纳消息
│  ├─ Release轮询 → channel-github.release — 只接收真实发行对象
│  └─ 更新作业回收 → channel-github.update-result — 报告服务外作业与实际版本结果
├─ events.on
│  └─ 无；轮询不是通用cron
└─ 内部功能（不是额外注册名）
   ├─ Issue轮询 — 按配置仓库、账号/标签和分页水位接收issue及评论，发出 message.in，抑制自身评论回环
   ├─ Release轮询 — 以首次基线略过旧发行，发现真实GitHub Release后发出 channel-github.release
   ├─ 更新回收 — 在启动/轮询时读取本插件独立更新作业结果，发出 channel-github.update-result
   └─ 渠道发送 — 通过统一投递向指定issue交付评论
```

### channel-feishu

```text
channel-feishu
├─ package
│  └─ @yonder/plugin-channel-feishu
├─ channels.register
│  └─ type="feishu" · dm/group — 官方SDK WebSocket；随Yonder启停
├─ tools.register
│  ├─ channel-feishu_status — 查询连接、机器人身份、补收及渲染状态
│  ├─ channel-feishu_history — 分页查询获准会话或线程的指定时间区间历史
│  ├─ channel-feishu_message — 通过共享投递发送文字或多媒体，并可指定原生replyTo
│  └─ channel-feishu_card — 发送原生自定义或模板卡片，并可指定原生replyTo
├─ contexts.register
│  └─ channel-feishu.conversation · placement=turn — 当前来源全参与者背景，与待处理输入分离
├─ events.on
│  ├─ message.in — 跟踪路由与最新气泡，维护收到反应
│  ├─ run.end — 清理终结/取消/失败遗留Typing
│  └─ channel.command.result — 清理非模型命令反应
├─ 外部订阅 / 发出事件
│  ├─ im.message.receive_v1 → message.in — 原生消息接纳
│  ├─ card.action.trigger → channel-feishu.card-action — 认证按钮回调，不自动授权
│  ├─ 工具卡片发送 → channel-feishu.card-sent — 保留卡片及原生消息关联
│  └─ 连接ready回调 → 历史补收 — 生命周期回调，不是额外事件总线
└─ 内部功能（不是额外注册名）
   ├─ 接收解析 — 解析文字、富文本、图片、文件、音频、视频和卡片消息
   ├─ 恢复补收 — 按固定截止时间、水位与原生ID补收可访问的已知会话消息
   ├─ 连续分批 — 只合并同会话、同发送者、同线程的连续输入
   ├─ 会话背景 — 提供全参与者历史及确认送达的本机器人回复，与待处理输入分开
   ├─ 同一主会话 — 通过核心身份和绑定让owner的CLI与飞书接入同一main
   ├─ 默认准入 — 其他私聊/群聊依配置的受限权限接收，不在插件内复制主人权限系统
   ├─ 流式卡片 — 按CardKit协议开始、更新并结束流式输出
   ├─ 收到反应 — 接纳后标记Typing，开始回复或终结时移除
   ├─ 条件引用 — 新气泡打断来源关系时按现有策略引用，工具显式replyTo保持有效
   ├─ 艾特内容 — 支持飞书原生消息/卡片的at标记，实际提醒效果仍须客户端验收
   ├─ 共享命令 — 复用核心help/session/skills/stop及双斜杠转义，不另设飞书命令系统
   └─ 统一日志 — 使用共享脱敏结构化日志定位接收、运行和投递
```

### media-tools（1906随包，本机未加载）

```text
media-tools
├─ package: @yonder/plugin-media-tools
├─ tools.register
│  ├─ media-tools_image_generate — 调用已配置硅基模型生成单图，立即转存工作区并返回附件
│  └─ media-tools_audio_transcribe — 读取有权访问的音频，经已配置硅基ASR返回识别文本
├─ services.resolve(image/asr) — 复用现有端点、模型清单和凭据引用
└─ 没有TTS/视频工具，没有新增skill、channel、trigger或模型循环
```

真实API图片/ASR已验证；1906已带该包，本机仍只加载原8插件且services为空，不能将已安装包当作已配置能力。

## 3. SDK作者接口树

以下是已有API契约；没有具体贡献的env/hook/preset槽不计为当前额外插件。工具调用仍经统一能力/级别与来源限制，不能从API名称推断无限权限。

```text
@yonder/sdk · PluginAPI
├─ channels
│  └─ api.channels.register — 注册渠道类型工厂
├─ tools
│  └─ api.tools.register — 注册模型工具
├─ contexts
│  └─ api.contexts.register — 注册上下文贡献
├─ triggers
│  └─ api.triggers.register — 注册生命周期触发器
├─ envs
│  └─ api.envs.register — 注册执行环境工厂
├─ hooks
│  └─ api.hooks.register — 注册生命周期钩子
├─ presets
│  └─ api.presets.register — 注册任务预设
├─ skills
│  └─ api.skills.register — 注册技能目录
├─ events
│  ├─ api.events.emit — 持久化并分发事件
│  ├─ api.events.ask — 发出需等待回答的事件
│  ├─ api.events.query — 分页查询持久事件
│  └─ api.events.on — 订阅指定事件类型
├─ messages
│  └─ api.messages.send — 经共享投递链发送消息并返回投递结果
├─ sessions
│  ├─ api.sessions.list — 按条件列出会话
│  ├─ api.sessions.get — 读取会话元数据
│  ├─ api.sessions.open — 按preset打开任务会话
│  ├─ api.sessions.submit — 提交输入，选择排队或steer及是否等待结果
│  ├─ api.sessions.abort — 取消会话当前运行
│  ├─ api.sessions.close — 关闭任务会话
│  ├─ api.sessions.transcript — 分页读取原生转录
│  └─ api.sessions.observe? — 可选订阅会话增量并返回取消订阅函数
├─ identity
│  ├─ api.identity.account — 读取账号信息
│  ├─ api.identity.person — 读取人物信息
│  ├─ api.identity.lookup — 查询实体关联
│  ├─ api.identity.relation — 判断指定agent与账号的身份关系
│  ├─ api.identity.createPerson — 创建人物记录
│  ├─ api.identity.link — 关联账号与人物
│  └─ api.identity.unlink — 解除账号人物关联
├─ credentials
│  └─ api.credentials.get — 读取命名凭据，禁止写入转录或日志
├─ services
│  └─ api.services.resolve — 解析配置的服务能力端点
├─ log
│  ├─ api.log.info — 记录信息日志
│  ├─ api.log.warn — 记录警告日志
│  └─ api.log.error — 记录错误日志
├─ api.models — pi提供的模型目录/鉴权接口
├─ api.paths.data — 插件私有数据目录
├─ definePlugin / defineChannel / defineTool / defineContext / defineTrigger / defineHook — 类型辅助构造器
├─ parseRef / acct / conv / person / agent / session / plugin — 校验和构造实体引用
└─ @yonder/sdk/testing.readPluginManifest / checkPlugin — manifest与实际注册核对
```

具体渠道协议：`ChannelProvider.create` → `Channel.start/stop/send`、可选`stream`，输入经`ChannelIO.emit/ask`。具体模型工具：`Tool.name/parameters/capabilities/execute`。上下文：`ContextContribution.id/placement/render`。trigger：`Trigger.id/start/stop`。扩展入口为`PluginModule.setup(api)`，不是第二套模型循环或数据库。

## 4. 当前没有的模块

cron插件、主动记忆引擎、通用MCP客户端、持久PTY/进程管理、PDF/Office解析、自动PR审核合并均未列为已实现。MEMORY.md文件加载、生命周期trigger、MCP服务端不能冒充这些能力。

## 5. 实际证据和范围

- [逐项插件说明](plugins.md)：附实现路径和能力边界。
- [现状总账](tasks/current-status.md)、[P轮结果](tasks/finishing-result.md)：源码、自动检查、独立安装、真实使用分别记录。
- [Hermes对比](tasks/hermes-capability-comparison.md)：后置和不做范围。
- 用户决定将视频播放、真实断网、执行中才发送插话等剩余飞书场景留给日常使用反馈；这些是主动跳过，不写成已通过，也不阻塞本次发行。

## E轮补齐（1906已安装）

- SDK PluginAPI.version：提供真实宿主版本。
- events.on → 程序函数/脚本：已有事件订阅现用于自动更新，不强制经过模型。
- release.update-result：CLI及插件作业共用的程序更新完成事实。
- channel-github.release-availability：从已核实缓存提供可升级版本，turn选用，不在聊天联网。
- releases.notifyUpdates：显式启用程序通知，沿用目标与未知不重发语义。
- sessions.notify / sessions notify：原生app-only程序通知，TUI按原时序显示；既不是模型回复，也不是模型输入。

原E轮检查见[实现结果](tasks/event-driven-actions-result.md)，正式安装及程序飞书通知见[1906记录](tasks/release1906-result.md)。


## 1907 新增执行单元

```text
内核
├─ bash → 15秒自动后台化，可立即background，完整日志落盘
├─ process → status / log / wait / write / kill，按session隔离
├─ runtime.warning → 时间/轮数/tokens软提醒；子任务也通知父session
├─ runtime.tool-result → 真实后台结果，继续原授权任务
├─ agents / presets 管理CLI → 模板创建、校验、热更新、归档恢复
└─ workspace/memory/README.md → 手工记录说明；不自动注入
plugins
├─ cron
│  ├─ cron_manage / cron_exec → create/get/list/update/enable/disable/delete/run/history
│  └─ cron trigger → at / every / cron + timezone / window / count / missed / concurrency
├─ mcp-client
│  ├─ mcp-client_stdio / mcp-client_http → connect/disconnect/status/forget
│  │  └─ tools/call/resources/read/templates/prompts/prompt/instructions
│  ├─ mcp-instructions → 按选择给出已连接server的外部来源信息
│  └─ mcp-cleanup / session.close → 关闭连接和自有子进程
└─ native-automation
   ├─ native-automation_browser → status/navigate/snapshot/click/fill/press/select/screenshot/evaluate
   │  └─ tabs/new-tab/select-tab/close-tab/back/forward/reload/close
   ├─ native-automation_desktop → status/snapshot/screenshot/move/click/drag/type/key
   └─ native-automation-cleanup / session.close → 等待自有浏览器/进程退出
```

上述注册名与实际验收分开，见[1907结果](tasks/execution-capabilities-result.md)。
