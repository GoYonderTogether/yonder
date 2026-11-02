# 管理事实

## 1. 三个目录

- 安装根：`YONDER_INSTALL`，默认 `~/.local/share/yonder/install`。`bin/yonder` 启动 `current` 指向的 `versions/<version>`；正式版本没有 `.git`，不是编辑仓库。`yonder version --json` 的 `source` 是当前 CLI 的代码位置，不一定是开发仓库。
- 数据 home：显式 `--home` 优先，其次 `YONDER_HOME`、包含 `yonder.yaml` 的当前目录，然后是已安装服务的 home；无服务时默认 `~/.local/share/yonder/home`。服务状态与 `service info` 可核对实际运行的 home、版本、commit、pid。
- 开发仓库：由维护任务/agent 配置明确指定，不从安装的 `source` 推断。修改源码、构建成功和切换分支都不会改变服务正在执行的安装版。

home 内：`yonder.yaml` 是插件、模型、服务、执行环境与 agent 注册表；`presets/*.yaml` 是临时任务配置；`skills/` 是共享技能；agent 的工作区由注册表中的 `workspace` 指定，相对路径相对 home。`.yonder/` 保存数据库、凭据、插件数据、附件、日志与控制 socket，不手改事件或会话数据库。运行日志在 `.yonder/logs/harness.log`。

## 2. 配置、权限、身份

所有 YAML 配置 `schema: 1`。agent 工作区必需只有 `agent.yaml`；提示词文件 `SOUL.md`（风格、角色、品味）与 `AGENTS.md`（工作方式与范围）及其他上下文文件由选中的插件贡献。`agent.yaml` 的 `id` 必须等于注册 id，`defaultProfile` 必须存在。`defaults` 提供 profile 默认值，数组整项替换；`tools`、`limits` 按键覆盖。`level` 与 `capabilities` 二选一，profile 指定其中一个会替换 defaults 的这一组。

`readonly` 只有 read；`standard` 有 read/write/exec/network/message；`bypass` 拥有全部能力，还包括 admin/cross-agent。工具先经能力过滤，再受 `plugins`、`tools.offer/search` 选择限制；安装了插件不等于 agent 会使用它。普通文件写入需要 write，修改 agent.yaml、身份关联或其他 agent 需要 admin。**本机 exec 能运行管理 CLI，实际上具有管理权；standard 不是沙箱。** 不通过改配置绕过当前权限。

owner 是 `person:<id>`，不是显示名或渠道账号。账号引用为 `acct:<channel>:<id>`；同一人的账号只有显式关联后才会跨渠道识别。相对于各 agent，发送者分为 owner/known/stranger，绑定据此路由。`yonder.yaml` 的 `identity.persons` 只供初始化，后续用 `identity lookup <ref>`、`identity person <id> <name>`、`identity link <acct> <person>` 或 `identity unlink <acct>`，不靠编辑初始化名单改变现存关系。

飞书接入检查：先核对实例及 `allowedUsers`/`allowedChats` 准入（空数组拒绝全部）；通过可信途径取得并核验该实例的主人 `acct`，在授权内显式 `identity link` 到 person；核对目标 Agent 的 channel、kind、from 绑定；最后真实发消息，分别核对入站事件、路由、运行及回复。过滤前无事件不能证明平台是否投递，不自动信任首个发送者。已有 person 时，配置里追加 accounts 不会自动补关联。`channels list` 的 login 仅表示支持登录操作，不是在线状态；查询 `channel-feishu_status`，connected 或 history complete 也不证明端到端收发。

## 3. 创建常驻 Agent 或 preset

常驻 Agent 有身份、owner、独立工作区和绑定，适合持续接收事件；profile 是同一个 agent 的不同运行配置，不是另一个助理。

使用 `yonder agents list|show <id>` 和 `yonder presets list|show <id>` 查看真实对象。稳定 id 用于绑定和历史，name 是昵称，work 是工作说明；改昵称不改身份、权限或已保存的 SOUL/AGENTS 正文。

`yonder agents create <id> --preset <preset> --file <json>` 从已有 preset 创建。JSON 必须明确提供 `name`、`work`、已有 `owner` 和 `bindings` 数组，可选 `avatarUrl` 设置身份头像、`profile` 覆盖既有 Profile 字段；不给入口时显式写空 bindings，结果 `messageEntry:false` 表示无消息入口。程序生成 agent.yaml 和选中上下文文件，不覆盖既有工作区，不自动安装插件或扩大绑定。

头像统一使用该 Agent 的 `agent.yaml.avatarUrl`：无凭据的公共域名 HTTPS 图片地址，不是本地文件路径。创建或连接新渠道前先 `agents show` 核对已选头像，沿用同一来源；已有 Agent 用只含 `avatarUrl` 的配置补丁更新，不覆盖其模型、权限和绑定。网页 card 渠道在首次登记及约每十分钟同步这个字段，配置保存与网页实际显示分别核验；不需要另建一个网页 Bot 或第二份头像清单。

飞书应用头像仍由飞书自己的设置与发布流程管理，连接渠道不会自动把它回写到本地。若主人已在飞书选定头像且本地尚未配置，可在授权范围内核对其公开图片地址后填入 `avatarUrl`；两边已有不同选择时先确认本次要保留哪张。新建或修改飞书应用时应用本地已选的同一图源，按当前提供的管理工具完成，分别记录头像已保存、应用已发布、渠道已接入和真实收发，不把其中一步当全部同步完成。

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

`sources` 由程序逐字转交当前来源会话中的原消息，不转抄为自己的摘要，也不是跨 Agent 的主人授权证明；`effort` 是本次运行的思考级别，需 admin。没有必要覆盖就省略这个可选参数，`effort: default` 仍算覆盖；能力错误应按指出的字段修正，不重复改写交办文字重试。渠道分身可在实际提供 `parent_ask` 时向同一个 Agent 的主会话提出有限请求，附带的来源身份不等于主人授权；它不是提权按钮。

列出/读取会话的内置工具需要 admin；涉及其他 agent 还需 cross-agent。CLI 是管理面，不是绕过任务授权的借口。委派前明确任务和允许副作用；接纳回执、模型终态、渠道送达分别核对，结果不明先查原事件/会话，不重复投递。

## 5. 模型与非对话服务

用 `yonder models list --home <home> --json` 查实际 provider/modelId，`yonder inspect --agent <id> --profile <name> --home <home> --json` 看选中配置、能力和工具；目录中存在不等于凭据有效或真实调用已成功。model 引用必须为 `provider/modelId`，不能由营销名称猜 ID。改 agent/profile 或 preset 的 model/thinking 可重载；添加 provider 或改端点在 yonder.yaml，需重启。

`models.providers` 复用 pi 的模型配置。同 id 内置 provider 覆盖可沿用它的鉴权和目录，新 provider 配相应协议；不为某个供应商另造运行内核。`yonder login <provider> --home <home>` 为该 home 独立登录；OAuth 会轮换 refresh token，禁止复制 Codex、其他程序或其他 home 的 OAuth 文件。凭据默认 `.yonder/auth.json`（或配置的 credentials 路径），不放进 yonder.yaml、技能、回复或日志。

ASR/TTS/embedding/rerank 等用 `yonder.yaml.services`，不是聊天 model。内核 `api.services.resolve(<能力>)` 按配置顺序返回第一个声明该能力的服务；调用由插件实现。配置了服务不代表已有能调用它的工具；核对已安装插件和真实贡献后再使用。services 的 credential 只引用凭据名。

飞书实例 `secret` 填凭据名称，不填实际 App Secret；由主人在本机用 `yonder credentials set <name> --home <home>` 隐藏录入 api_key，不读取或代填明文。飞书租户 scope 审批不等于用户 OAuth；`channel-feishu_scopes` 不启动或证明用户授权。

## 6. 检查、生效与更新

| 改动 | 真实生效边界 |
|---|---|
| yonder.yaml.agents 注册/归档、agent.yaml、home presets/*.yaml | 约每秒检测，校验成功后供下一次运行使用 |
| 选用上下文（SOUL.md、AGENTS.md 等）、skills | 每次组装提示词读取；技能还受 profile.skills 过滤 |
| yonder.yaml 其余字段、插件装卸、程序代码 | 需要重启；代码不热重载 |

候选配置无效会保留旧配置并记录 `config.reload` 的 ok/errors；当前运行保持原快照。删除仍被未关闭会话引用的 profile/preset 会被拒绝，先明确处理那些会话。`doctor` 检查磁盘配置；`inspect` 包含所选配置及运行快照，不能单凭磁盘内容断言运行已切换。事件过滤语法查版本文档；用 `yonder events --type config.reload --home <home> --json` 查重载结果，用 `--type run.end` 查运行终态，并核对相关 session。插件 add/remove 改唯一加载名单，不自动重启或热卸载，也不删除外部源码和插件私有数据。

`doctor` 是静态配置检查，不解析渠道运行时凭据、不验证连接或消息收发；结合渠道 status 和真实收发验收。

更新前用 `yonder update --check` 查询，检查目标版本和本次授权。普通源码修复不自动授权安装、发布或换掉正式服务。已授权更新时复用既有 update/current/versions 流程；同版本会直接返回未更新，不覆盖安装目录证明代码生效。保留运行 home 与历史；回滚使用明确旧版本的 update。

运行中的 agent 不能依靠自己的 bash 执行 update 并把服务重启造成的断连当成功。已安装的 channel-github 提供 `channel-github_update_schedule` 与 `channel-github_update_status`，仅供配置了 apply 策略与安装/home 边界的管家受限更新配置档，参数为真实 instance/releaseId，重新读取已批准发布的 Release；用实际工具定义提交独立一次性 launchd 更新并查结果。它不是任意版本或任意 Agent 的更新入口；不可用时交给服务外的已授权执行方。更新后重新连接，核对 version 的来源 commit、service info 的运行版本/home/pid 和需要验证的真实能力。查到新版本文件不等于服务已重启成功。

来源：当前安装文档 `spec/02-sessions.md`、`03-agents.md`、`04-plugins.md`、`05-security.md`、`07-runtime.md`、`08-config.md`、`09-cli-release.md`、`10-runtime-guarantees.md`；对应源码 `packages/cli/src/index.ts`、`packages/core/src/config/reload.ts`、`kernel/index.ts`、`tools/index.ts`、`release/index.ts`。文档可用 `yonder docs --list` 发现，不依赖开发仓库存在。


## 7. 用户需求到配置交付

主人说“改成某模型”“负责这个群”“消息都看着但按需回复”“先别说话”时，完成下面这条链。不要把低层 YAML、第二次确认口令或反复重试交给用户。只在目标/影响范围确实不清时问缺失信息。

1. **确定真实对象。** 核对 home、服务版本、原始消息的 Agent/channel/conv 与 owner 关系。 当前运行 profile 取宿主事实；`inspect` 在匹配 home 的本机 Agent 子进程可沿当前 Agent/profile（回执有 inspectionContext），普通终端或没有匹配上下文时省略 `--profile` 查询目标 defaultProfile，不一定代表当前会话。检查当前权限时显式传当前 profile，并核对回执的 profile 字段；不要把群档的权限缺项当主会话缺权限。`agents show` 读取实际绑定及 profiles，`inspect --agent <id> --profile <name>` 核对有效工具/能力/模型。群名称和昵称不是目标或授权证明。
2. **拆开配置维度。** 由谁负责是 Agent 身份；在哪保存历史是 session；用哪个模型和工具是 profile；收到消息、记录、唤醒模型、允许发言与最终投递各有配置。使用实际已选 social 工具查询群策略及路由，工具不在当前可用列表时只用已提供的发现入口，不假装存在。
3. **形成最小补丁。** 私聊与各群可能共用 profile；先列出本次实际影响，尽量更新现有目标 profile，不随意新命名 profile 使开放会话产生冲突。`agents update` 的 profiles/bindings 是配置字段，不是任意 JSON 深合并：按 `agents show` 保留未修改的兄弟字段/绑定，避免只提交一个子项把其他配置替换掉。控制面的 config.get/update 支持可选 profile，省略仍是 defaultProfile；只能在实际提供该管理接口的客户端使用，不虚构 CLI 命令。
4. **先校验再接纳。** 用 `agents validate <id> --file <json>` 校验完整候选，再 `agents update <id> --file <json>` 等待热重载结果，显式带 `--home <home> --json`。无效候选保留旧有效配置；读取具体字段/绑定错误再改，不能为了通过而弱化能力边界。saved 是落盘，accepted 是服务接纳；restartRequired 是另一个事实，不能把重启所需字段说成已热生效。
5. **群参与策略直接办理。** 当前提供 social_update 或 social_group_mode_set 时先 inspect 取得 revision，按主人明确需求显式 dryRun:false 应用并读回。dryRun 可供预览，不要求主人另发“确认”。保留实际 admin、跨 Agent、channelInstances 和可信来源限制。想让同一个 Agent 在工作群接活，沿独立群上下文与已有 parent_ask 交接，不把私人 main 当作完整能力开关。真正要求共用私人主上下文时报告当前支持边界，不擅自改意图。普通消息的批处理窗口读取当前配置，不宣布一个未经核实的统一秒数。
6. **验证具体行为。** 读回有效配置；social.inspect 的历史路由不等于修改后的新消息已通过。按本次目标追踪真实入站 → 目标绑定/session/profile → run.end → delivery.ok 的 message.out。换模型核对下次真实运行与本请求宿主模型事实，发生 fallback 时同时说明首选和实际型号。只读配置检查、doctor 和主动发送一条消息都不能代替整条链。没有新入站就明确“已接纳，端到端未测”，不要制造用户消息或擅自重复发信。
7. **交付并续办。** 报告修改对象、差异、接纳状态、运行/送达证据和未测项。被拒绝要说具体参数/来源/能力，不能把内部运行权限误说成主人不是 admin。后台返回后继续原任务；仍需工作时沿已有后台等待或 task_continue，不以“稍后处理”结束。

群附件已经收到时，优先使用输入给出的 message/index 和实际提供的 conversation_attachment_read；该工具只读当前来源会话中的文本附件，不是任意文件路径接口。图片/二进制解析与文本读取不同。没有提供 reader 或下载失败时报告真实缺口，必要时 parent_ask 附原文来源；不要先让用户把已经收到的文档再贴一遍。

长期 SOUL/AGENTS 记录职责、风格和稳定工作方法；当前模型、配置 revision、平台权限和本轮投递状态从宿主事实查，不另写静态副本造成冲突。对过去失败的调查按 agent/channel/conv/时间关联原请求与最终成功或失败回执，不能拿当前 YAML 或其他机器人的日志作过去的执行证据。


## 8. 按接入场景补齐默认链

主人可能只说“这个群你接管”“每条消息都看着，不一定回”“私聊用 sonnet，群里还是 terra”。这是需求，不要求主人提供配置字段。操作入口取宿主本轮给出的实际 home/Node/CLI；不要依赖工作站 PATH 指向的另一个版本。能力与配置事实查实际对象，方法从本 skill、工具说明和安装文档获取，不让用户重讲操作步骤。

先区分：显式拒绝/禁用/isolated、自定义绑定与策略、可信渠道接入事实、官方默认。前面的条件优先；默认只补当前已获准接入所需的缺件，不覆盖用户明确选择。

- 主人私聊沿已核验身份进入既有 main/profile；身份没映射时先定位账号与已配置 owner，不因熟悉口吻认主人。
- Card 已确认 membership 群沿原生独立群上下文、受限工具、批次/发送与主协助链。QQ群官方 setup 提供扫码主人 DM、群档、群记录、social 批次及 parent 协助；旧链按现有迁移的备份/预览/幂等处理，skip/partial 不等于全链完成。
- 飞书接入以真实 allowedUsers/allowedChats、identity 和显式绑定为准。渠道未提供可信 membership 时，不把任意群自动分给所有 Agent。已有目标群就直接复用其真实 ref，不让用户背 ID；群名不足以确定时才问缺失对象。
- 普通群的既有缺省是硬触发参与，不自动开启自主合批。主人明确要求“都看着，由你判断是否回复”时，将消息接收/记录、实际参与节奏与公开回复分别处理，沿现有策略字段配置并读回；不用“只要 @ 我”偷换目标。普通消息也交模型按批判断时，应配置 `social.conversations[真实群ref].mode: batch` 与 `batch.run: true`，保留既有窗口和用户明确限制。`listen.mode: realtime` 只表示接收方式，不会单独开启模型参与；只改 `mode: batch` 也不够。明确 `batch.run: true` 的普通批次在窗口到期后应进入模型，不再被关键词或未满 count 阈值二次拦截；这不等于逐条回复。配置目录中不同窗口控制不同阶段，不能把渠道窗口和 social 批次窗口混成一个统一秒数。
- 新建非 isolated Agent 有可用 main 且没有自定义 parent-request 路由时，应带精确的同 Agent 主协助默认；分身能力不足就带真实原文交办，负责人核实来源后沿原授权执行，不再让主人去另一个聊天重说。没有 main/自定义冲突则按具体错误补齐，不擅自改身份/权限。
- 私聊与各群共用 model/profile 时先查覆盖关系。用户分别指定模型，修改实际私聊/群的既有 profile；继承全局/defaults 的情况也算在范围内，不能只改一个名为 group 的档位。目标模型从当前模型目录解析，名字不匹配就说明目录缺口，不虚构 provider/id。

错误返回应让你定位对象/字段、真实缺失项和下一步。插件“已安装、已加载、profile已选择、工具已提供、当前调用获准”是五件事；群入口、批次入口、parent入口也不同。按实际缺件修补最小候选，重新 validate/apply/inspect；不要按看到一个错误就重建整个 Agent，更不能为了通过把群档改成 bypass。平台未推送、登录/凭据缺失、外部授权和需要重启时分别报告，自动配置不能替平台授予不存在的权限。
