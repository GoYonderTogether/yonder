# 提示词分层与来源

本轮按 2026-10-23 用户提供的完整 `source/host/runner/system-prompt.ts` 参考稿重构。参考稿是研究材料，里面的工具、产品和安全机制不构成 Yonder 的现有能力。用户已确认“默认 Agent”指普通常驻 Agent。

| 块 | 唯一正文 | 装配 |
|---|---|---|
| 系统内置 | `packages/core/src/prompt/content.ts` | common 全体、resident 仅常驻、runtime 全体、cli 仅 exec；时间与位置仍在 turn |
| 默认主 Agent | `plugins/agent-presets/prompts/jarvis/` | 官方插件 jarvis-soul / jarvis-work 生成并读取工作区 SOUL.md / AGENTS.md |
| 默认 Agent | `plugins/agent-presets/prompts/default-agent/` | 官方插件 default-agent-soul / default-agent-work；真实姓名、主人、职责来自配置 |

系统回答“怎么完成工作、Yonder 怎么运作”；SOUL 回答“你是谁、怎么说话”；AGENTS 回答“你负责什么、如何维持这条工作线”。共同规则只维护一次。正文继续使用直接的第二人称、短标题、具体场景和自然段；保留原稿的完整行为意图，保留来源稿中的措辞对照与解释案例，不机械复制造成矛盾的 API 或重复提醒。Jarvis 延续宅子、钥匙、账本的原有风格。普通 Agent 承接参考稿温暖、敏锐、简洁的交流风格。没有强制粗体首句、固定字数或每次必须拆成多个气泡。

短上下文本地模型可 [按段选择、替换或关闭提示词](configuration.md)，默认全量不变。

常驻、渠道分身、子任务和独立工作 session 的上下文分配与 coding 专化现状见 [会话与专化说明](sessions.md)。

## 全文去向

| 参考稿内容 | Yonder 归属与修正 |
|---|---|
| 默认身份 Grok Bot | 普通常驻 Agent SOUL；姓名来自配置，不带产品身份 |
| 回合节奏、目标/可检查验收、预算提醒、够用即停、先回复、持续同步、结果收口 | common 的 Taking on work / Staying in touch；多步工作合并相关目标并保留验收条件，不为简单请求强制计划；人类任务先回应，内部唤醒按结果价值发言 |
| SendMessage 唯一声音、额外结束消息、用户回复提醒 | runtime 的 Delivery；改为自动最终投递、按绑定流式、跨渠道/附件用 message_send，禁止重复发送 |
| 语气、称呼、代词、emoji、句式 | 两类 SOUL；普通 Agent 友好自然，Jarvis 克制准确；不强制全体同一人格 |
| 回复长度、短讯、多气泡、结构、Markdown、数学和 Mermaid | common 交付 + 两类 SOUL；遵守用户长度要求，具体呈现取渠道，不能保证 KaTeX/Mermaid 渲染 |
| 展示工作、截图、文件、图片与视频 | common 证据 + runtime 附件和浏览器；真实结果引用，不虚构路径，不保证自动转存或视频理解 |
| 不编数据、不编应用菜单 | common Grounding；不加入占位假数据，界面和能力按实际版本核查 |
| 征求决定、真实选项、等待用户 | common Decisions + runtime 交互；普通问题用当前聊天，已选卡片工具可选，关闭/超时不算同意 |
| 线程回复 | runtime 多渠道；尊重原会话与原生引用，不照搬 reply_to 或强制线程策略 |
| 两台机器、附件位置、box/用户电脑 | runtime 执行位置；真实 host/env/cwd，不假定容器、共享登录或每 Agent 独立桌面 |
| Web、MCP、工具升级顺序 | runtime Finding the right tool / Connected services；先已有资料与结构化能力，再公开网页、授权浏览器/桌面 |
| 长命令、后台委派、复活、检查与停止 | runtime 后台和委派；bash/process、15 秒后台、runtime.tool-result、task_continue；无不存在的 Task/CheckSubagent |
| 插件管理、MCP 服务器 | runtime 插件/MCP；本地安装与配置、选用、能力分开，无 Cursor 账户同步或市场承诺 |
| 无 connector 的服务、登录交接、多账户 | runtime Connected services / Browser；只用实际 OAuth/登录能力、核实账号与发信身份，认证失败不扩大访问 |
| box 排障、应用界面地图 | runtime 自管理；yonder docs/doctor/inspect 与真实源码，无虚构手册路径 |
| 匹配用户对外写作风格 | common Writing for someone；读取获准的相关语境，起草和发送分开 |
| Cursor Origin | 不纳入产品专属定义；来源与仓库引用仍要求真实，不猜 URL |
| 仓库改动、CloudAgent、工作池、卡片与跟进 | common 完整交办 + runtime 委派；按可用本机/任务/常驻/插件能力，无禁止本地 checkout 或强制云代理 |
| 自主性、协作范围、等待时不越界 | common Autonomy / Decisions；行动不扩大任务，沿用有效持续授权 |
| 主动性、routine | resident + Jarvis AGENTS；真实信号、一次具体建议、获准后 cron，查重/回收/停止，固定检查优先程序 |
| Auto-review、批准重试参数、审批卡 | common 权限与阻塞；只保留不绕过控制、如实报告，不宣称有第二层内核审批 |
| 安全、凭据 | common；按目标授权，不读取无关秘密，不借命令/浏览器/其他 Agent 提权 |
| 子 Agent 身份与安全段 | runtime Task sessions；无主人身份、结果交调用方，缺必要决定如实交回，使用同一安全底座 |
| Cloud agents 禁用覆盖 | runtime 能力事实；未注册/未选工具不可宣称可用，不引入团队禁用开关 |

## 现有内容的保留与迁移

保留 Yonder 愿景、生命连续性、唯一主人与社交边界、持续授权、工作线划分、技能按需加载和资产维护。旧 Jarvis 文稿移到插件内作为唯一模板；保留来源说明。其通用搜索、执行、记忆和验收约定上移系统；管家职责、团队账本、主动跟进和语气留在模板。旧 v5 草稿属于历史设计，不参与装配。

新 init 创建 Jarvis。普通常驻 Agent 用现有 `agents create --preset default-agent --file ...`，创建文件仍须提供真实 name/work/owner/bindings。既有 Agent 可显式选择模板上下文，但已有 SOUL/AGENTS 不覆盖；模板不是迁移器。用户随后明确授权的正式发版与本机迁移另行完成，结果见 [发布验证](../verification/release-26102305.md)。

2026-10-23 用户进一步明确：本机助理、多仓库、子 Agent 与子进程均须对齐；各插件自己携带排障与使用规则。此次保留并详译原稿的好坏措辞、句式、寒暄、短回复、散文与列表、游戏多线程解释等表达案例。案例只说明写法，不作为用户事实或已执行结果。子任务规则在共同 runtime 及 task_run/agent_ask 工具，子进程在 bash/process；插件细则随各自工具进入模型，不增加全局人格或自动加载。

## 随能力进入的规则

| 入口 | 本轮说明 |
|---|---|
| task_run / agent_ask | 任务交办材料、真实仓库与 cwd、父子责任、无身份限制、自动结果与去重 |
| bash / process | 后台启动、实际句柄、日志诊断、stdin 不等于 Agent 消息、取消不撤销副作用 |
| browser-skill | 已有配套 skill 继续承载完整流程；setup 明确缺 CLI/缺守护进程/扩展断开，session 不是独立机器 |
| codex-tools | 本地 CUA 与 hosted search，不是云编码 Agent；app-server、登录、JS reset 的对应恢复 |
| native-automation | 独立浏览器与本机桌面的差别；启动故障和 OS 权限分别处理 |
| mcp-client | schema 刷新、断线重连、forget 语义、未知写入、多账户与当前 OAuth 限制 |
| media-tools | 生成图与真实照片、实际附件交付、配置/生成/下载/保存阶段诊断与计费重试 |
| cron | 查重、明确目标和时区、无模型任务、运行历史、安静通知、停止失效跟进 |
| channel-feishu / channel-wechat-ilink | 按实际渠道状态排查；飞书卡片与微信收件人 context 各有边界 |
| ui-companion | 本机卡片不保证远端用户可见；真实选项与实际回复，不把关闭/超时当批准 |

插件未选择或工具未提供时，对应描述不进入该运行。无需新建全局排障提示词、自动重装器或人格运行框架。

## 验收

检查真实 init、插件注册与包内文件、两类 Agent 创建和最终 system 组装、无身份 task 隔离、文件修改/清空后不回退、已有文件不覆盖、顺序与确定性。模型行为试跑与源码检查分开记录；不以静态关键词证明语气或自主性改善。实际结果见 [本轮验证记录](../verification/prompt-layers.md)。
