# 管理事实

## 1. 三个目录

- 安装根：`YONDER_INSTALL`，默认 `~/.yonder-harness`。`bin/yonder` 启动 `current` 指向的 `versions/<version>`；正式版本没有 `.git`，不是编辑仓库。`yonder version --json` 的 `source` 是当前 CLI 的代码位置，不一定是开发仓库。
- 数据 home：显式 `--home` 优先，其次 `YONDER_HOME`、包含 `yonder.yaml` 的当前目录，然后是已安装服务的 home；无服务时默认 `~/.local/share/yonder-harness/home`。服务状态与 `service info` 可核对实际运行的 home、版本、commit、pid。
- 开发仓库：由维护任务/agent 配置明确指定，不从安装的 `source` 推断。修改源码、构建成功和切换分支都不会改变服务正在执行的安装版。

home 内：`yonder.yaml` 是插件、模型、服务、执行环境与 agent 注册表；`presets/*.yaml` 是临时任务配置；`skills/` 是共享技能；agent 的工作区由注册表中的 `workspace` 指定，相对路径相对 home。`.yonder/` 保存数据库、凭据、插件数据、附件、日志与控制 socket，不手改事件或会话数据库。运行日志在 `.yonder/logs/harness.log`。

## 2. 配置、权限、身份

所有 YAML 配置 `schema: 1`。agent 工作区必需只有 `agent.yaml`；提示词文件 `SOUL.md`（风格、角色、品味）与 `AGENTS.md`（工作方式与范围）及其他上下文文件由选中的插件贡献。`agent.yaml` 的 `id` 必须等于注册 id，`defaultProfile` 必须存在。`defaults` 提供 profile 默认值，数组整项替换；`tools`、`limits` 按键覆盖。`level` 与 `capabilities` 二选一，profile 指定其中一个会替换 defaults 的这一组。

`readonly` 只有 read；`standard` 有 read/write/exec/network/message；`bypass` 拥有全部能力，还包括 admin/cross-agent。工具先经能力过滤，再受 `plugins`、`tools.offer/search` 选择限制；安装了插件不等于 agent 会使用它。普通文件写入需要 write，修改 agent.yaml、身份关联或其他 agent 需要 admin。**本机 exec 能运行管理 CLI，实际上具有管理权；standard 不是沙箱。** 不通过改配置绕过当前权限。

owner 是 `person:<id>`，不是显示名或渠道账号。账号引用为 `acct:<channel>:<id>`；同一人的账号只有显式关联后才会跨渠道识别。相对于各 agent，发送者分为 owner/known/stranger，绑定据此路由。`yonder.yaml` 的 `identity.persons` 只供初始化，后续用 `identity lookup <ref>`、`identity person <id> <name>`、`identity link <acct> <person>` 或 `identity unlink <acct>`，不靠编辑初始化名单改变现存关系。

## 3. 创建常驻 Agent 或 preset

常驻 Agent 有身份、owner、独立工作区和绑定，适合持续接收事件；profile 是同一个 agent 的不同运行配置，不是另一个助理。

使用 `yonder agents list|show <id>` 和 `yonder presets list|show <id>` 查看真实对象。稳定 id 用于绑定和历史，name 是昵称，work 是工作说明；改昵称不改身份、权限或已保存的 SOUL/AGENTS 正文。

`yonder agents create <id> --preset <preset> --file <json>` 从已有 preset 创建。JSON 必须明确提供 `name`、`work`、已有 `owner` 和 `bindings` 数组，可选 `profile` 覆盖既有 Profile 字段；不给入口时显式写空 bindings，结果 `messageEntry:false` 表示无消息入口。程序生成 agent.yaml 和选中上下文文件，不覆盖既有工作区，不自动安装插件或扩大绑定。

`yonder agents update <id> --file <json>` 合并 Agent 配置字段；`agents validate <id> --file <json>` 只校验不保存。`presets create|update|validate <id> --file <json>` 复用现有 preset 字段，创建必须有 description。JSON 文件不得包含秘密；管理 RPC 与 CLI 共用校验。命令显式带 `--home <home> --json` 便于查看 saved/valid/accepted。`accepted:true` 表示运行服务已接纳，不代表真实模型成功执行；离线保存返回 `accepted:false`。

`yonder agents archive <id>`（remove 同义）保留注册、目录、历史且不接新输入；`agents restore <id>` 重新校验后恢复。默认 main 保留日常入口，不能归档。归档后既有运行及已接纳输入继续自然完成，不自行中止任务。`presets remove <id>` 不能删除仍被开放会话引用的 preset。无 true delete/purge。

注册、agent 与 preset 候选一起校验后热发布，管理命令等待实际发布结果；失败保留完整有效旧状态并给出错误。已有开放会话保护 workspace/env/profile；不做后台目录迁移。其他 yonder.yaml 配置（插件/provider/服务等）仍须重启。

Agent 输入一律经绑定。内部助理消息需目标绑定允许 `channel: agent`、`kind: agent`；发送者为 `acct:agent:<调用方id>`，按目标 owner 的身份关系计算 from。没有匹配绑定就不会运行；不要为“让它能收到”而扩大所有陌生人的入口。main 的所有绑定必须使用同一 profile，已有会话不能通过更换绑定偷偷换 profile。

preset 没有身份、owner、工作区或绑定：在 `<home>/presets/<id>.yaml` 写 `schema: 1`、必填 `description` 和 profile 字段，id 来自文件名。新增/修改 preset 可自动重载；无父会话的任务默认 cwd=home，子任务沿用父 cwd/env（preset 显式 env 优先），不读取某个 agent 的 SOUL.md/AGENTS.md，也不渲染 agent 工作区上下文贡献；任务角色与要求写在 preset 的 instructions。不要为了临时任务新建常驻 Agent。

官方 `agent-presets` 插件提供 `jarvis` 与 `default-agent` 两种常驻起始模板，使用前先核对已加载预设。已有个体文件不因切换模板自动覆盖。短上下文模型可用 `prompt.sections` 选择、排序或关闭内置段落，用 `prompt.overrides` 替换；人格上下文、skill 和工具列表仍分别由 contexts/skills/tools 控制，详见 `yonder docs prompts/configuration.md`。

## 4. 委派与会话

- 一次性子任务：`task_run({ preset, task, attachments?, sources?, effort? })` 等待结果，返回 session/status/text 等事实，运行结束后关闭；父运行中止会中止子任务。能力始终是 preset 与发起方的交集，不能提权。
- 已存在的常驻助理：`agent_ask({ agent, text, sources?, effort? })`，需要 message 和调用方 agent 身份。预设会话不能调用；禁止调用形成环；目标仍须命中自己的绑定。它不是创建 Agent 的工具。
- 连续任务：`yonder sessions open <preset> --keep-open` 创建 manual task，然后 `sessions submit <id> --text <text>`；默认返回输入回执，**不代表模型完成**。`sessions show <id>` 看会话元数据与转录，运行终态还应核对对应 run.end。`abort` 中止工作但保留 manual 会话；`close` 中止未完成工作并关闭、保留历史。退出 TUI 或观察断连不会关闭任务。
- `sessions submit` 只驱动 task，不能给常驻 agent 会话直接塞输入。`yonder chat --session <id>` 续聊 task；`yonder chat --channel <instance>` 经渠道绑定联系常驻 agent。裸 `yonder` 在 TTY 优先选择 CLI 渠道；显式 `yonder chat` 默认独立任务。

`sources` 由程序逐字转交当前来源会话中的原消息，不转抄为自己的摘要；`effort` 是本次运行的思考级别，需 admin。渠道分身可在实际提供 `parent_ask` 时向同一个 Agent 的主会话提出有限请求，附带的来源身份不等于主人授权；它不是提权按钮。

列出/读取会话的内置工具需要 admin；涉及其他 agent 还需 cross-agent。CLI 是管理面，不是绕过任务授权的借口。委派前明确任务和允许副作用；接纳回执、模型终态、渠道送达分别核对，结果不明先查原事件/会话，不重复投递。

## 5. 模型与非对话服务

用 `yonder models list --home <home> --json` 查实际 provider/modelId，`yonder inspect --agent <id> --profile <name> --home <home> --json` 看选中配置、能力和工具；目录中存在不等于凭据有效或真实调用已成功。model 引用必须为 `provider/modelId`，不能由营销名称猜 ID。改 agent/profile 或 preset 的 model/thinking 可重载；添加 provider 或改端点在 yonder.yaml，需重启。

`models.providers` 复用 pi 的模型配置。同 id 内置 provider 覆盖可沿用它的鉴权和目录，新 provider 配相应协议；不为某个供应商另造运行内核。`yonder login <provider> --home <home>` 为该 home 独立登录；OAuth 会轮换 refresh token，禁止复制 Codex、其他程序或其他 home 的 OAuth 文件。凭据默认 `.yonder/auth.json`（或配置的 credentials 路径），不放进 yonder.yaml、技能、回复或日志。

ASR/TTS/embedding/rerank 等用 `yonder.yaml.services`，不是聊天 model。内核 `api.services.resolve(<能力>)` 按配置顺序返回第一个声明该能力的服务；调用由插件实现。配置了服务不代表已有能调用它的工具；核对已安装插件和真实贡献后再使用。services 的 credential 只引用凭据名。

## 6. 检查、生效与更新

| 改动 | 真实生效边界 |
|---|---|
| yonder.yaml.agents 注册/归档、agent.yaml、home presets/*.yaml | 约每秒检测，校验成功后供下一次运行使用 |
| 选用上下文（SOUL.md、AGENTS.md 等）、skills | 每次组装提示词读取；技能还受 profile.skills 过滤 |
| yonder.yaml 其余字段、插件装卸、程序代码 | 需要重启；代码不热重载 |

候选配置无效会保留旧配置并记录 `config.reload` 的 ok/errors；当前运行保持原快照。删除仍被未关闭会话引用的 profile/preset 会被拒绝，先明确处理那些会话。`doctor` 检查磁盘配置；`inspect` 包含所选配置及运行快照，不能单凭磁盘内容断言运行已切换。事件过滤语法查版本文档；用 `yonder events --type config.reload --home <home> --json` 查重载结果，用 `--type run.end` 查运行终态，并核对相关 session。插件 add/remove 改唯一加载名单，不自动重启或热卸载，也不删除外部源码和插件私有数据。

更新前用 `yonder update --check` 查询，检查目标版本和本次授权。普通源码修复不自动授权安装、发布或换掉正式服务。已授权更新时复用既有 update/current/versions 流程；同版本会直接返回未更新，不覆盖安装目录证明代码生效。保留运行 home 与历史；回滚使用明确旧版本的 update。

运行中的 agent 不能依靠自己的 bash 执行 update 并把服务重启造成的断连当成功。已安装的 channel-github 提供 `channel-github_update_schedule` 与 `channel-github_update_status`，仅供配置了 apply 策略与安装/home 边界的管家受限更新配置档，参数为真实 instance/releaseId，重新读取已批准发布的 Release；用实际工具定义提交独立一次性 launchd 更新并查结果。它不是任意版本或任意 Agent 的更新入口；不可用时交给服务外的已授权执行方。更新后重新连接，核对 version 的来源 commit、service info 的运行版本/home/pid 和需要验证的真实能力。查到新版本文件不等于服务已重启成功。

来源：当前安装文档 `spec/02-sessions.md`、`03-agents.md`、`04-plugins.md`、`05-security.md`、`07-runtime.md`、`08-config.md`、`09-cli-release.md`、`10-runtime-guarantees.md`；对应源码 `packages/cli/src/index.ts`、`packages/core/src/config/reload.ts`、`kernel/index.ts`、`tools/index.ts`、`release/index.ts`。文档可用 `yonder docs --list` 发现，不依赖开发仓库存在。
