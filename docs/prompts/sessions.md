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

submit 的接纳回执不是完成结果；实际终态看 run.end 与会话转录。独立任务默认 cwd 是 home；子任务沿父 cwd/env，preset 可指定 env。做代码工作时在任务里明确真实仓库、分支、允许改动和验收，工具在跨仓库时显式选 cwd。不会自动把整个仓库或父历史复制进上下文。

要持续拥有职责、身份和渠道入口，才使用 `yonder agents create <id> --preset default-agent --file <配置.json>`。真实 name/work/owner/bindings 必填；选 Jarvis 模板不会授予额外权限。实际参数以该版本 --help 为准。

## Coding 专化现状与参考

本次正式提供的角色模板是 Jarvis 和普通常驻 Agent；init 的 default 是通用独立任务。Yonder 不会自动装入上游 pi coding-agent 的完整系统提示词。代码执行已有 read/write/edit/grep/bash/process、项目指令读取、隔离任务、真实检查与交付规则；部署者可以为维护 Agent 设置职责，但这不等于已发布独立 coding/plan/review 三种官方预设。

专业化可沿现有 preset 的 instructions、工具/能力选择、skills 和 prompt 段落实现。建议先做 coding（实施并验证）、review（按真实权限只读审查）两种有实际使用方的配置，不新增人格或运行框架。只写“只读”不能限制有 exec 的配置；权限和工具必须同时对齐。常驻维护者的项目职责放自己的 AGENTS，某次修改的仓库与验收放任务，领域工艺再放按需 skill。

已核对两处上游官方资料（2026-10-23）：

- [pi system-prompt.ts](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/src/core/system-prompt.ts)：按实际可用工具生成说明，分开项目指令、技能与可替换提示段。适合继续借鉴其小底座与按能力装配方法；工具名、路径与工具细则要使用 Yonder 现有契约。
- [OpenCode Agents](https://opencode.ai/docs/agents/)：把 Build、Plan、Explore 等任务用途与自定义提示词、模型、权限分别配置。适合借鉴实施与探索/审查的职责区分；它的权限系统、@ 调用、会话键位和自动模式不应照搬成 Yonder 已有能力。

本轮只完成资料核对和分配方式说明，没有据名称新增未验证的 coding 执行器，也没有声称任意模型已经具备同样的代码任务完成率。
