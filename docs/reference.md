# 功能与注册名参考

本页按当前源码实际注册整理；详细参数以工具schema、[SDK类型](../packages/sdk/src/types.ts)及[CLI源码](../packages/cli/src/index.ts)为准，逐个插件的槽位、事件、工具与边界见[官方插件清单](plugins.md)。

**读法**：plugin ID是包的贡献命名空间；channel type是配置中的渠道类型，实例ID由配置指定；tools.register是模型工具，MCP server工具是外部协议接口；contexts/trigger/events分别是上下文、生命周期触发器、事件订阅，不能混为一个“功能完成数”。每个叶节点说明一个最小操作，不列内部私有函数来冒充额外功能。

## 1. 核心

```text
Yonder Harness
├─ 原生runtime工具
│  ├─ read — 读取当前工作区文件
│  ├─ write — 写入文件
│  ├─ edit — 修改已有文件内容
│  ├─ bash — 在当前执行环境运行命令
│  ├─ grep — 通过rg搜索有权访问的文件
│  ├─ find — 按 glob 查找文件（默认当前目录、最多1000项；遵守 .gitignore，包含隐藏文件；执行环境须安装 fd 或 fdfind）
│  ├─ ls — 列出目录（默认当前目录，含隐藏项，默认最多500项）
│  └─ tool_search — 按需发现配置允许的工具
├─ Kernel实际模型工具
│  ├─ message_send — 向明确人/账号/会话发送消息
│  ├─ agent_ask — 按目标agent绑定提问并等待结果；可用sources由程序逐字引用来源会话里的入站消息，可用effort（需admin）指定本次运行思考等级
│  ├─ parent_ask — 只读分身向所属 Agent 的 main 绑定请求协助
│  ├─ task_run — 使用preset委派原生子任务；同样支持sources原文引用与effort
│  ├─ task_continue — 将已授权的具体下一步持久排入当前会话
│  ├─ session_list — 按权限列出会话
│  ├─ session_read — 按权限读取原生转录
│  ├─ identity_lookup — 查询账号/人物/会话关系
│  ├─ identity_link — 显式关联或解除身份映射
│  └─ skill_view — 读取已选skill正文或资源
├─ 内置skills（不是插件）
│  ├─ skill-creator — 创建/维护技能；辅助Python脚本需要PyYAML
│  ├─ yonder-development — 按主分支并行规约开发、保存与验证
│  ├─ yonder-plugin-debug — 按需执行渠道短任务、查询调用证据及隔离复现
│  └─ yonder-self-management — 目录、配置、身份、委派与更新规约
└─ 核心职责
   ├─ 事件 → 绑定 → 身份/权限 → 原生会话/队列 → 模型/工具 → 投递
   ├─ pi-durable — 独占转录、执行循环、恢复、子会话与压缩
   ├─ Yonder — 配置、事件、来源、上限、上下文组装、插件、投递与安装
   ├─ 统一日志 — 安全JSONL诊断，不新增日志服务
   └─ macOS状态栏 — 状态、检查更新、退出；不是桌面客户端
```

### 后台执行与运行时提醒

```text
内核
├─ bash → 15秒自动后台化，可立即background，完整日志落盘；默认stdin结束，stdin:true开启输入
├─ process → status / log / wait / write / kill，按session隔离；write可附eof:true结束stdin，日志next为累计字符游标
├─ runtime.warning → 时间/轮数/tokens软提醒；子任务也通知父session
├─ runtime.tool-result → 真实后台结果，继续原授权任务
└─ workspace/memory/README.md → 手工记录说明；不自动注入
```

### 不是插件的能力

- `skill-creator`：按需读取技能创建指导及配套资源。
- `yonder-development`：任何独立代码仓库，所有改动都直接在主分支上进行，不迁出分支，不建 worktree 或独立环境。同一目录允许 10 到 30 个 Agent 并行，内容大致不重叠即可；重叠时改不同的行，或等 5 到 10 秒再改，顺带提交别人的改动也可以。只有两种情况需要独立环境：特定版本发版时为该版本建发版环境；一批任务完成后，主 Agent 安排检出当时的 commit 做验证，同时开始下一批。主 Agent 不写代码、不改代码文件，只改提示词、规约和文档，落地执行全部交给子 Agent。
- `yonder-plugin-debug`：从指定入口执行短任务、核对工具/事件/产物并按需隔离复现；不增加插件，沿现有按需读取机制使用。
- `yonder-self-management`：Yonder特有目录、配置、Agent/preset、权限和更新规约；不增加通用编码/GitHub教程。
- 核心运行：pi模型循环、原生队列/回执、会话、身份、权限、绑定及共享投递由core/runtime承担。
- 原生工具：文件读写、Bash、grep及共享message_send/task_run/agent_ask等不重复包装成插件。
- 用户入口：CLI/TUI、安装更新、launchd和状态栏属于产品包，不是额外渠道插件。

## 2. CLI 命令

```text
yonder · CLI
├─ init — 初始化一个Yonder home和默认配置。
├─ login <provider> — 为指定模型供应商执行交互式登录。
├─ credentials set <name> — 在本机TTY隐藏录入一项命名API key，拒绝覆盖，不经模型。
├─ doctor — 检查home配置并列出错误或警告。
├─ start — 在前台启动harness服务。
├─ stop — 请求停止当前home的harness服务。
├─ chat — 进入原生TUI，或用--plain/--json进行非TUI交互；目标可选preset、session或channel。
├─ sessions list — 按agent、mode、open条件列出会话。
├─ sessions show <id> — 读取会话信息及转录。
├─ sessions open <preset> [--keep-open] — 创建预设任务，默认run-end；--keep-open创建manual task。
├─ sessions notify <id> --event <id> --text <text> — 写入带来源的程序通知，不调用模型。
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
├─ update [--to <tag>|latest|beta] — 按指定标签、最新正式版或最新测试版安装；可指定repository。
├─ service install — 安装home对应的系统服务。
├─ service uninstall — 移除系统服务。
├─ service start / stop / restart — 管理已安装服务。
├─ service status / info — 查看服务状态或运行中进程的版本、commit、home、PID、ready状态。
└─ completion zsh / bash / fish — 输出对应shell的静态命令补全及只读动态候选脚本。
```

- agents / presets 管理CLI：模板创建、校验、热更新、归档恢复。
- sessions.notify / sessions notify：原生app-only程序通知，TUI按原时序显示；既不是模型回复，也不是模型输入。

### 聊天斜杠命令

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

管理命令不是模型工具，TUI专用命令不在飞书另造一套。

## 3. SDK 作者接口

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
│  └─ api.hooks.register — 注册 beforeTool / afterTool / beforeRequest / beforeSend（完整消息发送前过滤）钩子
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

- `PluginAPI.version`：提供真实宿主版本。
- `api.events.on` → 程序函数/脚本：已有事件订阅现用于自动更新，不强制经过模型。

## 4. 当前没有的模块

主动记忆引擎、持久PTY、PDF/Office解析、自动PR审核合并均未列为已实现。MEMORY.md文件加载、生命周期trigger、MCP服务端不能冒充这些能力。

BrowserSkill fork（D54）：`browser-skill_bookmarks` 的 tree / move(nodeId,parentId,index?) / create-folder(title,parentId,index?) / remove-empty-folder(nodeId)；`browser-skill_extensions` 的 list / enable(extensionId) / disable(extensionId)。均支持可选 session（仅恰有一个 owned session 时可省略）。插件 config：`bookmarksEnabled`、`extensionsEnabled` 默认 false，不代替主人 popup 授权。

macOS 权限：native-automation_desktop 的 `permissions`/`status` 返回 helper 自身 9 类非提示式探针（含 bundle/path/codeHash、lastCheckedAt、lastRequestedAt、nextStep）。人用 `~/.local/share/yonder/helper/yonder-permissions status | request|guide|watch <kind>`；checkout 演示入口为 `scripts/demo-permissions.sh`，先 `npm run build`。不是 `yonder` 子命令；AI action 不提供授权。FDA/Files & Folders 为 unobservable，详见[验收记录](verification/mac-permissions.md)。

## Clipboard（D53）

| 注册名 | 输入与结果 |
|---|---|
| `clipboard_copy` | from.message(eventId)/file(path,start?,end?)/tool(transcriptId)，返回 open/sealed 元数据 handle |
| `clipboard_paste` | handle + file(path)/consumer(id)/message(target,仅 open)/vault；typed 目的地，不传原文 |
| `clipboard_list` | 当前 session/agent/profile 未过期元数据 |
| `clipboard_drop` | 删除本作用域 handle/Keychain item，历史/已粘贴文件保留 |
| `clipboard_capture` | 一次性隐藏 TTY ticket 与 OWNER 命令，不接受聊天秘密 |
| `clipboard-redact` | afterTool + beforeSend，选中 profile 的精确值过滤；按消息缓冲流式文本 |
| `yonder-clipboard prepare --data <path>` | 显式编译本地 Keychain helper，不改 TCC/生产服务 |
| `yonder-clipboard capture --data <path> --ticket <id>` | 独立 package bin，交互 TTY 隐藏录入；不属于 yonder 核心子命令 |

配置与 raw exec/Keychain ACL 边界见 [插件 README](../plugins/clipboard/README.md) 和 [spec/15](spec/15-clipboard-vault.md)。

## code-intel（可选）

- `code-intel_lsp_navigation`：通过 pi-lens MCP 进行 LSP 导航及能力发现；跨文件写入目前不可用。

- `code-intel_read_enclosing`：按文件和行读取最小包含符号或回调；超长时可选择错误、片段或大纲。

- `code-intel_codegraph_explore`：通过执行环境内 CodeGraph 查询索引的源码与调用关系。
- `code-intel_module_report`：通过 pi-lens MCP 读取模块符号大纲。
- `code-intel_read_symbol`：通过 pi-lens MCP 按文件和符号名或回调句柄读取源码。
- `code-intel_ast_grep_outline`：通过执行环境内 ast-grep 查看文件或目录的语法结构。
