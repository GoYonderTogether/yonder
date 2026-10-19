# 功能树补充：CLI、共享命令、Core工具与SDK入口

本文件只核对当前CLI和代码注册；不代表规范中的扩展槽都已有插件实现。完整channel/tool/context/trigger插件清单由主agent按实际8个插件包整理。

## CLI注册命令

`yonder` 在交互TTY无参数时进入日常chat；`help`/`--help`显示命令入口。源码实际列出的顶层命令及已实现子命令如下：

| 英文注册名 | 最小用途 |
|---|---|
| `init` | 初始化一个Yonder home和默认配置。 |
| `login <provider>` | 为指定模型供应商执行交互式登录。 |
| `doctor` | 检查home配置并列出错误或警告。 |
| `start` | 在前台启动harness服务。 |
| `stop` | 请求停止当前home的harness服务。 |
| `chat` | 进入原生TUI，或用`--plain`/`--json`进行非TUI交互；目标可选preset、session或channel。 |
| `sessions list` | 按agent、mode、open条件列出会话。 |
| `sessions show <id>` | 读取会话信息及转录。 |
| `sessions open <preset> [--keep-open]` | 创建预设任务，默认run-end；`--keep-open`创建manual task。 |
| `sessions submit <id>` | 向已有会话提交文本或附件。 |
| `sessions abort <id>` | 中止指定会话运行。 |
| `sessions close <id>` | 关闭指定task会话。 |
| `events` | 按type、from、conv、agent、时间区间或游标查询事件。 |
| `identity lookup <ref>` | 查询账号、人、会话关联。 |
| `identity link <account> <person>` | 关联账号与人。 |
| `identity unlink <account>` | 解除账号关联。 |
| `identity person <id> <name>` | 创建person记录。 |
| `skills` | 查看当前agent/profile的可用技能。 |
| `skills show <name>` | 查看某个技能。 |
| `skills add <directory>` | 为agent添加本地技能目录。 |
| `skills remove <name>` | 移除agent的本地技能配置。 |
| `plugins list` | 列出插件。 |
| `plugins show <id>` | 查看插件信息。 |
| `plugins add <source>` | 从目录或包来源添加插件。 |
| `plugins remove <id>` | 移除插件。 |
| `models list` | 列出模型目录。 |
| `inspect` | 查看指定agent/profile的有效配置。 |
| `version` | 查看版本、安装来源与home信息。 |
| `changelog` | 查询两个版本之间的变更记录。 |
| `docs` | 列出或读取随包文档。 |
| `update --check` | 查询正式Release版本状态。 |
| `update [--to <tag>]` / `update latest` | 安装指定或最新正式版本；可指定repository。 |
| `service install` | 安装home对应的系统服务。 |
| `service uninstall` | 移除系统服务。 |
| `service start` / `stop` / `restart` | 管理已安装服务。 |
| `service status` / `info` | 查看服务状态或运行中进程的版本、commit、home、PID、ready状态。 |
| `completion zsh` / `bash` / `fish` | 输出对应shell的静态命令补全及只读动态候选脚本。 |

常见全局选项为`--home`、`--json`、`--help`；具体参数以CLI usage和各分支解析为准。源码入口：[packages/cli/src/index.ts](../../packages/cli/src/index.ts)。

## TUI slash commands

共享定义在SDK的`chatCommands`；TUI注册9个命令，description原文位于[packages/sdk/src/chat-commands.ts](../../packages/sdk/src/chat-commands.ts)。

| 英文注册名 | 最小用途 | 渠道可用 |
|---|---|---|
| `/new` | 选择预设并开始新的独立任务。 | 否，TUI专用 |
| `/resume` | 从原生会话选择器恢复会话。 | 否，TUI专用 |
| `/session` | 显示当前会话信息。 | 是 |
| `/hotkeys` | 显示或隐藏当前快捷键提示。 | 否，TUI专用 |
| `/channel` | 选择常驻CLI渠道并进入其绑定目标。 | 否，TUI专用 |
| `/skills` | 列出当前会话实际可用的技能。 | 是 |
| `/stop` | 中止当前会话运行。 | 是 |
| `/close` | 关闭manual task。 | 否，TUI专用 |
| `/help` | 显示当前入口可用的slash command。 | 是 |

渠道子集`channelChatCommands`只有`/help`、`/session`、`/skills`、`/stop`。`runChannelCommand`为这些命令写入`channel.command`和`channel.command.result`事件，不调用模型；其他已知TUI命令会明确提示仅适用于终端交互。当前kernel只对配置类型为`feishu`的来源调用该处理器。来源：[packages/core/src/routing/commands.ts](../../packages/core/src/routing/commands.ts)、[packages/core/src/kernel/index.ts](../../packages/core/src/kernel/index.ts)。

## Core内置模型工具

Kernel实际将`createCoreTools()`的7项和`createSkillTool()`的1项交给Runtime，共8个Core工具。注册名来自实现代码，不包括插件工具或管理RPC。

| 英文注册名 | capability | 最小用途 |
|---|---|---|
| `message_send` | 无额外catalog capability | 向明确收件人或渠道发送消息；当前来源的最终回复仍由投递层自动交回。 |
| `agent_ask` | `message` | 通过目标agent的绑定提交问题并等待其答复。 |
| `task_run` | 无额外catalog capability | 以指定preset运行专门任务并返回结果。 |
| `session_list` | `admin` | 列出当前agent会话；跨agent查看还需`cross-agent`。 |
| `session_read` | `admin` | 读取会话转录；跨agent读取还需`cross-agent`。 |
| `identity_lookup` | `read` | 查询本轮发送者的关联账号和会话；查询其他引用还需`admin`。 |
| `identity_link` | `admin` | 显式关联账号与person或解除关联。 |
| `skill_view` | 无额外catalog capability | 读取当前profile已选技能的全文或单个附属文件。 |

工具能力表：[packages/core/src/tools/catalog.ts](../../packages/core/src/tools/catalog.ts)；前7项实现：[packages/core/src/tools/index.ts](../../packages/core/src/tools/index.ts)；`skill_view`实现：[packages/core/src/tools/skill-view.ts](../../packages/core/src/tools/skill-view.ts)；Kernel组装点：[packages/core/src/kernel/index.ts](../../packages/core/src/kernel/index.ts)。插件提供的工具由对应插件注册，不计入这8项Core工具。

## SDK公共入口

包入口`@yonder/sdk`导出`types.ts`中的公共类型、辅助构造器及共享slash command；另有独立的`@yonder/sdk/testing`入口。`PluginModule.setup(api)`是插件加载入口。以下是SDK作者接口，描述契约边界，不单独计为已实现产品功能或具体插件。

| 接口名 | 用途 |
|---|---|
| `ChannelProvider` / `Channel` / `ChannelIO` | 注册消息渠道，声明支持的消息类型、流式/附件能力，接收事件并发送消息。 |
| `Tool` / `ToolContext` / `ToolResult` | 注册带JSON Schema参数和capability要求的模型工具。 |
| `ContextContribution` / `RenderContext` | 向system或turn上下文提供模板文件和动态内容。 |
| `Trigger` | 启停外部触发器，并通过事件入口发出输入。 |
| `EnvProvider` | 创建工具和工作区使用的执行环境。 |
| `Hook` / `ToolCall` / `HookResult` | 在工具调用前后或模型请求前检查并按契约修改/阻止操作。 |
| `Preset` | 注册task可选择的运行配置。 |
| `skills.register(dir)` | 注册技能目录供既有技能发现和按需读取。 |
| `PluginAPI.events` | 发出、询问、查询事件并订阅事件类型。 |
| `PluginAPI.messages` | 通过Core投递层向指定引用发送文本或附件。 |
| `PluginAPI.sessions` / `identity` | 使用Core会话及身份接口。 |
| `PluginAPI.credentials` / `services` / `models` / `paths` | 读取命名凭据、解析服务能力、访问模型目录和插件数据路径。 |
| `PluginAPI.log` | 写入插件info/warn/error日志。 |
| `definePlugin` / `defineChannel` / `defineTool` / `defineContext` / `defineTrigger` / `defineHook` | 保持实现值的静态类型并返回原值，便于编写插件模块。 |
| `parseRef` / `acct` / `conv` / `person` / `agent` / `session` / `plugin` | 解析或构造经过格式校验的实体引用。 |
| `chatCommands` / `channelChatCommands` | 向终端或渠道命令处理共享名称及描述。 |
| `@yonder/sdk/testing`：`readPluginManifest` / `checkPlugin` | 读取插件manifest并在隔离注册collector中核对setup注册与manifest声明。 |

来源：[packages/sdk/src/index.ts](../../packages/sdk/src/index.ts)、[packages/sdk/src/types.ts](../../packages/sdk/src/types.ts)、[packages/sdk/package.json](../../packages/sdk/package.json)。这份SDK接口概览不表示每一种扩展槽在当前8个插件中都有实现。
