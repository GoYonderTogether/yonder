# 提示词如何分配给 Agent 与工作会话

系统底座描述共同做事与表达方式；人格是选中的上下文；专业任务是 preset 或 profile 的配置。它们沿同一个运行内核组合，不为每一种名称启动另一套 Agent 引擎。

## 实际分配

| 对象 | 身份与历史 | 本轮提示词与上下文 | 发起方式 |
|---|---|---|---|
| 主 Agent / 普通常驻 Agent | 自己的 id、owner、workspace；可有 main、persistent、ephemeral 会话 | 系统共同+常驻+运行段，所选角色文件、技能、工具、instructions；历史取实际会话 | 渠道事件命中 binding；或 agents create 从官方模板创建 |
| 渠道分身 | 同一个 Agent 的另一个 profile/会话；不因此新增人设 | 按 binding 指定 profile 选择模型、工具、contexts；可以不加载 SOUL/AGENTS，群聊历史按会话边界隔离 | 渠道消息、观察或合批事件；受限分身可用 parent_ask 向自己的 main 请求协助 |
| task_run 子任务 | 无常驻身份与个人 workspace；独立转录 | 系统共同+运行段、所选 preset 的模型/工具/技能/上下文/instructions，加任务、显式附件和 sources 原文；没有父会话全部历史 | task_run；权限是 preset 与调用方的交集；父取消管理子生命周期；结果交父处理 |
| 独立一次性工作任务 | 无常驻身份；独立会话 | 与子任务相同的 preset 装配，但没有父会话 | chat --preset 或 sessions open；默认工作结束关闭 |
| 连续独立工作 session | 无常驻身份；保留该任务自己的多轮历史 | 每轮按相同 preset 和实际运行快照装配，继续本会话历史 | sessions open --keep-open；submit/chat --session 继续；显式 close 结束 |
| bash 子进程 | 不是 Agent，没有额外人格或模型上下文 | 收到实际命令、cwd、环境、stdin；process 只管理句柄与日志 | bash/background；完成结果回原会话 |

main 不是权限级别，channel 不是另一个人的身份，profile 不是另一个常驻 Agent，preset 也不是常驻身份。是否有 SOUL/AGENTS 由 contexts 决定；常驻系统段仍只在实际 agent 身份存在时装入。

跨渠道同一主人可路由到 main；独立群/联系人可以用 persistent per-conv。历史是否共用来自 binding/session，不能靠复制一段提示词改变。渠道说明与可见能力由实际选中的插件和工具提供。parent_ask 收到的是来源受限请求，主会话仍按真实授权判断能否处理，结果返回分身后才决定是否适合对群公开。

## 创建与继续工作

在实际 home 下，以下命令沿现有 CLI，不创建常驻 Agent：

```sh
yonder chat --preset default --home <home>
yonder sessions open default --keep-open --home <home> --json
yonder sessions submit <返回的session-id> --text "继续当前任务" --home <home> --json
yonder chat --session <返回的session-id> --home <home>
yonder sessions close <返回的session-id> --home <home> --json
```

submit 的接纳回执不是完成结果；实际终态看 run.end 与会话转录。独立任务默认 cwd 是 home；子任务沿父 cwd/env，preset 可指定 env。做代码工作时在任务里明确真实仓库、允许改动和验收，工具在跨仓库时显式选 cwd。任何独立代码仓库，所有改动都直接在主分支上进行，不迁出分支，不建 worktree 或独立环境。同一目录允许 10 到 30 个 Agent 并行，内容大致不重叠即可；重叠时改不同的行，或等 5 到 10 秒再改，顺带提交别人的改动也可以。只有两种情况需要独立环境：特定版本发版时为该版本建发版环境；一批任务完成后，主 Agent 安排检出当时的 commit 做验证，同时开始下一批。主 Agent 不写代码、不改代码文件，只改提示词、规约和文档，落地执行全部交给子 Agent。不会自动把整个仓库或父历史复制进上下文。

要持续拥有职责、身份和渠道入口，才使用 `yonder agents create <id> --preset default-agent --file <配置.json>`。真实 name/work/owner/bindings 必填；选 Jarvis 模板不会授予额外权限。实际参数以该版本 --help 为准。

## 三套官方任务预设

| preset | 任务正文 | 默认工具和能力 |
|---|---|---|
| default | task-general：任务边界、原始材料、推进、连续工作与交付 | read/grep/write/edit/bash/process/skill_view；read/write/exec/network |
| coding | task-general + task-coding：理解调用链、最小完整修复、真实检查、Git 与交付 | 同 default；不自动赋予消息、管理或递归委派 |
| research | task-general + task-research：原始资料、搜索、证据、比较、引用 | read/grep/skill_view 和选中的 web-tools；read/network，无 shell、写文件或发消息 |

新 init 加载 web-tools，并给 research 选中该插件。已安装 agent-presets 的旧 home 不会因为缺少 web-tools 而失效：插件原始 research 只选 agent-presets，可读取已提供的本地材料；需要联网时显式加载并选择 web-tools。公开 URL fetch 不需要搜索凭据；search/extract 需要实际配置的 Tavily 命名凭据。工具已注册不等于已认证或已成功使用。

```sh
yonder chat --preset coding --home <home>
yonder sessions open research --keep-open --home <home> --json
```

task_run 选择同一个 default/coding/research。子任务按父权限交集运行，不能凭编码预设获取父会话没有的写入/执行能力；调用方需要提供真实仓库、目标、允许改动、来源和验收。连续独立 session 用同一 preset，靠会话历史续作；不会自动继承主 Agent 的全部聊天或长期记忆。不按名称自动降级模型，也不新增“常驻子 Agent”层级。

如确有长期职能，创建普通常驻 Agent，在其 profile 的 contexts 保留 default-agent-soul/default-agent-work，再显式加入 task-general 与 task-coding 或 task-research。它仍是原有姓名、职责和工作区的同一个 Agent。渠道分身沿 binding 选择 profile 和会话；任务正文不会把它变成另一人格。需要只读代码审查时，使用只读工具/能力配置；有 exec 的 coding 不构成只读沙箱。

## 参考和复用范围

主要对标 OpenCode 的任务提示词与工具选择方式，结合 Ponytail 的完整工程取舍方法；调研正文改编 CopilotKit OpenMuse 的 worker/search 指令。原文、固定版本、MIT 许可和逐项改编记录随 [agent-presets/SOURCES](../../plugins/agent-presets/prompts/SOURCES.md) 打包。没有移植任何上游运行器、权限系统或第二套会话存储。

OpenDot 的本机助理方向可参考，但其全部操作可撤销、固定连接器调用等约定不符合当前 Yonder；Digger 的同名 OpenMuse 未查到可复用许可，仅作架构比较，未复制提示词。来源正文不自动注入，实际只加载当前选中的 task context。

[配置说明](configuration.md) 展示关闭、替换正文和小上下文配置；官方预设不覆盖 home 下同名自定义文件。实际验证记录见 [任务预设验收](../verification/task-presets.md)。
