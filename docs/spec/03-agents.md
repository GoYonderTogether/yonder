# 03 Agent、配置档与提示词组装

## 1. 两类执行者

| | 常驻 Agent | 预设 Preset |
|---|---|---|
| 身份 | 有：id、owner、账号、绑定 | 无 |
| 工作区 | 有，一个文件夹 | 无；会话和配置照常记录 |
| 会话 | main / persistent / ephemeral | task |
| 用途 | 长期存在的个人或业务 agent | 给任何 agent 或外部调用方临时用一下：编码、调研…… |

## 2. Agent 工作区

### 2.1 位置

工作区 = **执行环境 + 路径**（05 §4）。home 的 `yonder.yaml` 登记每个 agent：

```yaml
agents:
  - id: main
    workspace: ./agents/main          # 默认执行环境 local
  - id: gpu-coder
    env: gpu-box                      # 工作区在远程环境里，主机上没有这个文件夹
    workspace: /home/me/agents/gpu-coder
```

内核读写工作区一律通过执行环境接口（架构不变量 8）。

### 2.2 内容

```
<workspace>/
  agent.yaml     必需。身份、绑定、配置档、选用的上下文与插件
  SOUL.md        可选（soul-md）。风格、扮演的角色、品味
  AGENTS.md      可选（agents-md）。工作方式、工作范围、执行任务的方式与风格
  skills/        可选。这个 agent 自己的 skill（§6），agent 可以自己写
  memory/        手工按需资料；README说明临时方法，不自动注入或维护
  …              其余文件由选用的上下文贡献声明（04 §3.3），缺失时按声明自动生成
```

- 内核只规定 `agent.yaml`。Agent 自己的提示词只有两份：`SOUL.md`（风格、角色、品味）与 `AGENTS.md`（工作方式与范围），由所选上下文插件贡献；context-files 提供通用文件读取，agent-presets 提供官方起始正文。init 默认选用贾维斯模板。两份同一种语言，随角色而定：默认英文，明确的中文角色设定才用中文；Agent 按主人使用的语言回话。`USER.md`、`MEMORY.md`、`memory/` 等同样不是内核概念；不选就不存在、不占上下文。
- agent 用普通的文件工具修改自己的工作区。写 `agent.yaml` 需要 `admin` 能力，其余文件需要 `write` 能力（05 §3）。插件可以把自己声明的文件标为受保护，并指定所需能力。

### 2.3 agent.yaml

```yaml
schema: 1
id: main                          # 等于 yonder.yaml 中的登记 id
name: 小远
owner: person:zoran
defaultProfile: owner
defaults:                         # 所有配置档的默认值，配置档可逐项覆盖
  model: openai/gpt-6-luna
  contexts: [soul-md, agents-md]  # 上下文贡献 id，按顺序
  plugins: [context-files]        # 这个 agent 用哪些插件的工具与钩子
profiles:
  owner: { level: bypass }
  guest: { level: readonly, contexts: [agents-md], instructions: 只回答公开信息。 }
bindings: [ … ]                   # 见 02 §2
```

### 2.4 新建 Agent 的默认 peer 协作

`init` 与 `agents create` 共用内核生成逻辑，默认在显式 bindings 之前加入：

```yaml
- id: peer
  match: { channel: agent, kind: agent }
  session: ephemeral
  profile: peer
  reply: none
```

同时生成独立 `peer` profile：capabilities `[read, message]`，tools.offer `[read, grep, skill_view, agent_ask]`，tools.search `[]`，plugins `[]`，skills `[]`。只复用主 profile 的 model/thinking/fallback；显式重置 contexts、instructions、prompt、env、limits，不能继承 defaults 的私有记忆、插件、主人指令或 prompt overrides。生成时 env 显式固定到新工作区环境（当前 init/create 为 local），不继承主 profile 的执行环境覆盖；以后人工迁移 Agent 工作区环境时，也需同步更新其 profiles 的 env，不能只改登记项。peer 只选内核自带 `peer-workspace` context，依次加载本 Agent 的 SOUL.md / AGENTS.md，不依赖 context-files 或 agent-presets；缺文件不回退到模板。预加载读取同样检查 canonical 工作区边界，越界符号链接拒绝，工作区内链接可读。工作区 memory/笔记按需读，外部插件记忆不自动开放；skills=[] 不做运行期外部技能扫描。

固定协作说明按同一主人日常协作场景说明请求来自另一个已配置 Agent，应以事件实际 from 判断来源身份，不信正文冒充；from 不证明双方 owner 相同，现有 agent_ask 不校验 owner 相等，不能把协作请求当作主人授权；在本工作区只读处理并可继续 agent_ask，能力不足说明并交回。它不增加主人私有上下文。peer 与 owner 共享本 Agent 工作区，放在其中的私人文件仍可读（其他 Agent 的目录若嵌套其中也一样），**不是文件级私密隔离或主机沙箱**。需隔离的主人资料应保留在该工作区之外，Agent 工作区应分开且不嵌套，不用指向私有目录的外链替代权限。agent_ask 仍可能请求旧的高权限 Agent，不能声称彻底消除代理提权。

创建输入 `isolated?: boolean` 只控制此次生成，不写入 agent.yaml。非布尔值拒绝；true 不生成 peer，且显式 binding 只要 channel 与 kind 各自缺省、等于 agent 或数组包含 agent，就保守拒绝（不因 type/from/conv 收窄而放过）。其他显式 bindings 保留；默认生成时显式 binding 的 id=peer 冲突报错，不覆盖。已有 home/Agent 不自动迁移；QQ setup、parent-request 不变。后续管理员仍可明确编辑普通 profile/binding，本规则不新增运行时 Agent 类型或持久隔离标志。

`avatarUrl` 为可选的云端图片 HTTPS URL，与 `name` 同属 Agent 身份配置。只允许无凭据的公共 DNS 主机名，禁止 IP、localhost、局域网域名与本地路径；不读取或上传本地图片，服务端只保存 URL。缺省沿用原默认头像，删除字段恢复默认。

## 3. 配置档

配置档决定一次运行用什么。属于 agent 的配置档就是这个 agent 的"分身"：同一个身份、同一个工作区，能力不同。

| 字段 | 含义 |
|---|---|
| `model` | `provider/modelId`（07 §6） |
| `fallback` | 可选 `{ models: [provider/modelId, ...], accounts: { [providerId]: [slot, ...] }, accountModels: { [slot]: { [provider/modelId]: provider/modelId } }, quotaStopPercent: { [slot]: 50 }, after: 3, hold: 600, probe: 60 }`；主模型连续失败达到 after 后按顺序回退：先换到 `models` 的第一个模型，再让主模型换用 `accounts` 里列出的其他账号（只对主模型生效），最后按 `models` 顺序换其余模型；`accountModels` 给某个槽换用同 provider 的其他模型（例如额度受限的账号只跑较小模型），对该槽的每个链条目生效，映射到其他 provider 的条目被忽略。`quotaStopPercent` 按槽设官方用量窗口的停用线：账号已用百分比达到该值且窗口未重置时不再被选中（07 §6.1）。成功响应清零计数，最后一个条目也只尝试 after 次。`hold` 秒内被判定不可用的条目不再作为新运行的起点，`probe` 秒在后台探测一次，成功后回到主模型。省略则沿用原生 retry。运行内的失败计数与当前模型限于本次运行。 |
| `thinking` | `off` / `minimal` / `low` / `medium` / `high` / `xhigh` / `max` |
| `credentialSlots` | 可选 `{ [providerId]: slotName }` 非秘密账户选择；defaults → profile → session 按 provider 合并，显式 `default` 覆盖继承；未选择的 provider 使用 default，不改变模型名。同一模型换用其他账号只经 `fallback.accounts` 进入运行内模型链 |
| `level` 或 `capabilities` | 安全级别或显式能力列表（05 §2），二选一 |
| `plugins` | 用哪些插件的工具与钩子 |
| `channelInstances` | 可选渠道实例 id 数组；未配置无限制兼容，`[]` 无实例，显式列表仅名单内；不从 bindings 推导，admin/bypass 不越过 |
| `tools` | `{ offer: [glob…], search: [glob…] }`。`offer`：工具定义常驻在请求里；`search`：通过按需搜索加载（07 §4）。都要先通过能力过滤 |
| `contexts` | 上下文贡献 id，按顺序 |
| `skills` | skill 名的通配列表，默认 `["*"]`（§6） |
| `prompt` | `{ sections?: string[], overrides?: Record<string, string> }`，选择、排序或替换内置段落（§5.5） |
| `instructions` | 追加在系统提示词最后 |
| `env` | 工具在哪个执行环境运行；默认是工作区所在环境 |
| `limits` | 覆盖运行软阈值与重复空转保护：`{ maxTurns, maxMinutes, maxTokens, repeatBlock, repeatStop }`（07 §5） |

未写的字段取 `defaults`，再取内核默认。

内核默认：`model: openai/gpt-6-luna`、`thinking: medium`、`level: readonly`、`plugins: []`、`tools: { offer: ["*"], search: [] }`、`contexts: []`、`skills: ["*"]`、`instructions: ""`、`prompt: {}`；`env` 取工作区环境，`limits` 取 07 §5。数组整项替换；`tools`、`limits`、`prompt` 与 `credentialSlots` 按键覆盖；`prompt.sections` 和 `prompt.overrides` 各自整项替换，不按 id 合并。`level` 与 `capabilities` 是同一组选项，配置档指定任一个就替换 defaults 的这一组，不能把两个来源合并成冲突。其余字段按字段覆盖。通配只支持 `*`（任意字符串）与 `?`（单字符），不引入路径 glob 语言。

## 4. 预设与临时会话

预设是不属于任何 agent 的配置档，放在 `<home>/presets/<id>.yaml`（`id` 取文件名），或由插件贡献（04 §3.7）。字段同 §3，另加必填的 `description`（一句话，会出现在 `task_run` 工具说明里）。SDK 类型：`Preset = Profile & { id: string; description: string }`，`Profile` 即 §3 的字段表。

- 内核工具 `task_run({ preset, task, attachments?, effort?, credentialSlots? })`：用预设开一个 `task` 会话，把 `task` 作为输入，运行结束后把最终回复作为工具结果返回，会话关闭。基于 pi-durable 的子会话所有权，发起方中止时子会话一并中止。
- 子会话默认继承发起方：预设没写 `level`/`capabilities` 就取发起方的能力，写了则与发起方相交；没写的 `tools.offer/search` 取发起方，`plugins` 为发起方所列加预设自己所列。预设只在显式写出时收窄。**禁止**借预设提权。contexts、model、thinking、fallback、credentialSlots、instructions 由预设决定，不继承父会话的模型账户配置或常驻身份；`task_run` 嵌套不超过两层。继承的插件与工具在开会话时固定保存，不因重载扩大。`channelInstances` 取父范围与预设范围交集（undefined 为单位元），创建时保存有效上限；无父则取预设范围，恢复与后续预设重载只能再相交，不放宽。
- `task_run` 的按次 `credentialSlots` 与 `effort` 使用同一既有 admin 能力门槛，不增加权限机制。映射按 provider 覆盖预设自身的选择，与 effort 同级保存在结构化 `session.input.data` 中，重放使用原事件；仅影响该次运行，在运行配置快照前应用，不改写预设或父会话。
- 插件（例如 MCP 服务端渠道）用 `sessions.open({ preset, capabilities })` 打开预设会话、`submit` 驱动；预设没写能力时取 `capabilities`，写了则与之相交，插件应当传入它代表的外部调用方被允许的能力。
- 基础 TUI 的待审核方案（12）：独立任务使用 `sessions.open({ preset, close: 'manual' })`，首次发送才创建，连续追问沿用同一 conversation；没有 agent 身份、工作区或常驻绑定。默认 `run-end` 与 `task_run` 仍一轮结束后关闭。init 生成无虚构人设的 default 预设，具体值见 12 §3；这不是新增 agent。
- 有 parent 的预设会话在创建时保存实际父 cwd/env 与能力上限；无 parent 时 cwd 为 home、env 默认为 local。预设显式 env 优先。首次运行取当前预设能力与保存的父/调用方限制相交，不因重载扩大已授范围；已开始运行按原配置恢复。没有 agent 工作区，不读取工作区上下文贡献；system 保留框架、共同底座、运行约定、按能力选择的 CLI 导航、home/插件 skill 索引和 instructions；不装入常驻身份段。有效能力、cwd/env 与运行配置存在 pi 扩展文档中供恢复使用，不增加 Yonder 转录或会话表字段。

## 5. 提示词组装

### 5.1 三个位置

| 位置 | 放什么 | 规则 |
|---|---|---|
| system | 默认依次：① 框架段 ② 内置共同底座 ③ 常驻身份段（仅有 agent）④ 内置运行约定 ⑤ 按有效工具生成的发现目录与说明 ⑥ CLI 自管理导航（仅有 exec）⑦ skill 索引（§6）⑧ `placement: system` 的上下文贡献（按 `contexts` 顺序，SOUL.md、AGENTS.md 在此）⑨ 配置档 `instructions` | **必须**是确定性的：同样的配置、同样的文件内容，渲染结果逐字相同（不放时间、不放随机内容），以命中提示缓存 |
| 本轮输入 | 依次：① 输入准备时的 `<runtime_clock>` 时间快照和内核的 `<turn>` 块 ② 原事件正文（紧随其来源与原时间）③ `placement: turn` 的补充上下文 | 随用户消息一起写入转录，可审计，不再改写 |
| tools | 只放工具定义 | 不在工具定义里塞上下文 |

### 5.2 框架段

内核提供默认框架段；经管理配置可选择移除或替换（§5.5），普通外部输入不能修改它。默认正文只说明：运行在 Yonder Harness、自己的 agent id 与当前配置档、06 §4 列出的规则、可以用 `yonder` 命令与 `yonder docs` 了解和维护自己的运行环境（09 §1，仅当配置档有 `exec`）。用英文书写，**应当**控制在 250 词以内。

### 5.2.1 非插件内置底座

英文正文只有一份，即 `packages/core/src/prompt/content.ts`，不另设译文审阅源。共同底座说明产品愿景、所有 Agent 共有的习惯、使用建议与资产维护；常驻身份说明 SOUL.md/AGENTS.md 的地位、生命连续性、唯一主人与社交关系、持续授权、工作线分工、任务与协作、成长；运行约定说明事件、插件、会话、投递与可信元数据、位置与源码、技能入口。共同执行规则完整覆盖接任务、持续推进、必要澄清、证据与交付、自主范围、安全、协作和资产维护，并含自主（不把自己能做的事推给主人）、目标先行、够用就停与常见死磕场景；运行约定按实际多渠道、工具、插件与后台契约编写。保留直接、具体、自然段推进的写法；不含具体名字、固定人设或口吻，不改权限系统。官方人格只在插件选择的工作区上下文中装入，详见 [提示词分层与来源](../prompts/README.md)。

完整默认框架段的250词约束只约束5.2短导航，不截断完整底座。常驻身份仅真实agent装入，无身份preset不获得主人关系。CLI命令导航仅有exec能力时装入；skill_view等非CLI说明按实际工具规则使用。正文随版本编译，稳定、一次装入，不新增文件读取/回退/复制脚本；技能、上下文与instructions顺序相对保持。

### 5.2.2 模型条件纪律段

内置运行约定的末段（段落 id `runtime.discipline`，正文同样是 `content.ts` 里的一份静态文本，不超过 200 词）只在配置模型引用的 modelId 完整匹配 `^gpt-\d+(?:\.\d+)?-(?:luna|sol)$`（如 `gpt-6-luna`、`gpt-6.1-sol`）时装入；不按供应商、子串或本轮输入猜测模型，`gpt-6-luna-preview` 这类后缀不匹配。内容要求先简短回应主人、长工具链中不持续沉默、搜索与文件命令显式给路径、以实际执行过的命令/测试/路径结案，task 会话首行用 STATUS。它属于可选段落，显式 `prompt.sections` 未列出时不装入，可在 `prompt.overrides` 中替换；其他模型不装入。运行时间、计数与事件仍只进 `<turn>`，两次不同输入的稳定 system 前缀必须逐字相同。

### 5.3 `<turn>` 块

每个提交的事件都带一个，run/write 都标明原事件 id/type；以下只示意既有消息正文格式：

```
<turn id="事件id" type="message.in" time="2026-10-18T14:03:00+08:00" channel="qq-main" kind="group" conv="conv:qq-main:g:7788">
from: 阿明 (acct:qq-main:10001, known: person:aming)
attachment: 报价单.pdf (application/pdf, 120 KB) file:///…/报价单.pdf
notice: yonder harness updated from 0.1.0 to 0.1.1; details: yonder changelog --from 0.1.0 --to 0.1.1
</turn>
```

- 仅 `wake: run` 增加可信运行事实：当前软件version与home、有效env与cwd、宿主prepared时间/时区/platform。宿主与执行环境分别标明，cwd不冒充远程宿主或工作区；不新增时间轮询。prepared为本次输入准备时刻，不替换事件原时间。这些事实随输入保留，不进入system。
- `attachment:` 每个附件一行。模型支持图片输入时，图片附件不列在这里，而是由内核读取后作为图片块放进同一条用户消息（超出模型 `inputLimits` 的仍按附件列出）；其余附件只列出，由工具处理。`http(s)` 地址由内核下载到 `<home>/.yonder/attachments/` 后改写为 `file://`。
- `notice:` 只在会话的 `version` 与当前版本不同时出现一次（09 §4）。
- 以 `wake: write` 写入的消息只带 `from` 与 `attachment` 行，不带时间以外的环境信息。
- id/type 对 write 同样保留；message.in/session.input 继续使用 text 与附件，其他事件将完整 data JSON 序列化为正文。插件负责原生事实，内核不识别 release 或卡片专用字段。外部名称、附件名按字符串转义为单行，不能通过换行或标记制造框架边界；原事件保持不变（10 §1.1）。
- 提示词、环境、能力与投递均使用本次运行配置；新选中的上下文文件在配置发布前完成必要 scaffold。版本只在输入真正提交后确认，准备失败不能吞掉 notice。

### 5.4 SOUL.md 与 AGENTS.md 模板

context-files 的 `soul-md`、`agents-md` 保持通用文件读取和空模板语义；未经编辑的空模板不注入提示词。

官方插件 `agent-presets` 用现有 contexts 与 presets 槽提供两类常驻 Agent 起始正文：

| 预设 id | SOUL.md 上下文 | AGENTS.md 上下文 | 职责 |
|---|---|---|---|
| `jarvis` | `jarvis-soul` | `jarvis-work` | 默认主 Agent：贾维斯、个人事务入口、主动跟进与团队协调 |
| `default-agent` | `default-agent-soul` | `default-agent-work` | 普通常驻 Agent：自然亲切的个人协作者，围绕配置中的工作范围长期负责 |

两种 preset 只是创建配置的现有入口，不增加 Agent 类型或权限字段。`agents create --preset` 继续要求真实 name/work/owner/bindings。模板不提供虚构经历、用户资料或伪造历史对话；来源中的表达例句仅说明措辞和语气，不作为已发生的事实。不把编程、研究、所有具体专业方法塞进人格。权限沿现有默认值或调用方明确配置。

插件包内 `prompts/<id>/SOUL.md`、`AGENTS.md` 是起始正文的唯一来源；选中上下文后通过既有 scaffold 仅补缺失文件，渲染读取实际工作区文件，用户清空或编辑后不回退到模板。不覆写已有文件，不自动迁移旧 Agent；同一文件只选一个读取贡献，避免与通用 context-files 重复注入。新 init 的 main 选用 jarvis，两份文件仍属于该 Agent，可修改。无身份 task 即使使用这些 preset，也不渲染人格上下文、不读 Agent 工作区。

### 5.4.1 官方任务预设

同一插件提供 `default`（通用任务）、`coding`（实施与验证）、`research`（读取、调查与证据报告）。正文分别为 `prompts/tasks/general.md`、`coding.md`、`research.md`，经 `task-general`、`task-coding`、`task-research` 三个无工作区读取的 system context 加载；专业预设同时选择通用任务 context。渠道分身仍是同一常驻 Agent 的 profile，不新增人格；子任务与独立工作 session 使用同一 preset，只在发起方、历史和关闭方式上不同。

任务不装入常驻人格，不继承父会话全部历史或私人记忆。长期任务由常驻 Agent 负责，任务会话和项目交接资料承接进展；不因任务耗时长而新建 Agent。需要持续职责、关系与独立资产时才创建另一个常驻 Agent，并通过现有绑定交接。专业任务 context 也可显式选入常驻 profile，与其人格并用，不新增运行类型。

三个官方预设只指定模型与上下文，不写 `capabilities`/`tools`，因此继承发起方的全部能力与工具：research 同样可以用 shell、命令行与脚本做调研，只是正文要求它的副作用限于任务本身。独立任务会话（TUI、插件打开且没有发起方）没有可继承的对象，init 生成的 home 预设显式写 read/write/exec/network。预设能力仍与发起方取交集；含 exec 的任务不是文件沙箱。

`research` 插件预设可在仅加载 agent-presets 的 home 阅读已给材料；公开 Web 能力由显式选中的 web-tools 提供。新 init 加载官方 web-tools 并生成选择它的 research home 预设；HTTP fetch 无需搜索凭据，search/extract 仍要求该插件的真实服务凭据。旧 home 不自动装插件或改其预设；同 id home 预设继续覆盖插件预设。task context 可用 contexts 移除，完整自定义正文使用 instructions；内置段落仍按 5.5 配置，不按模型名称自动降级或裁剪。

第三方正文按固定来源与许可保留，逐项记录身份、工具名、执行位置及投递协议的适配。原稿不是工具能力的证据。验证在独立 home/session 进行，不向日用主会话投递验收输入。

### 5.5 小上下文模型与段落配置

用户在 2026-10-23 明确要求全部内置正文可以配置移除、替换或只保留部分。`Profile.prompt` 可用于 agent defaults、各 profile、home preset 与插件 preset；不按模型名猜测长度或自动丢内容。

- 不写 `sections`：按正文目录的默认顺序装入完整内置内容；写 `sections`：只装入列出的稳定 id，按列表顺序；`[]` 关闭全部内置正文，包括框架导航。
- `overrides`：按稳定 id 替换正文；空字符串关闭该段。替换只作用于已选段落，不自动选中它。不支持任意文件读取、脚本或模板插值；自定义文字按字面装入。
- `prompt` 的两个键分别继承 defaults；显式 `sections` 整表替换，显式 `overrides` 整表替换。未知 id、重复选择与非法类型拒绝配置；重载失败保留旧配置。
- resident.* 即便被选择或替换，也只对真实常驻 Agent 生效；cli 仅有 exec 能力时生效。运行能力、绑定、身份和投递仍由代码执行，关闭说明不改变权限。
- 这只控制内置 system 正文。角色/插件上下文用已有 `contexts` 选择并编辑工作区文件，skill 索引用 `skills` 选择，工具定义用 `tools.offer/search` 与 `plugins` 选择，尾部自定义正文用 `instructions`。要极简运行，需同时配置这些来源。
- `<turn>`、实际输入与原生运行计时/恢复事实不是长正文模板，仍按运行协议保留。关闭正文不删除历史转录，也不宣称任意模型会正确完成工具任务。
- 稳定 id 及精简/全自定义配置见 [提示词配置](../prompts/configuration.md)。默认全文行为不变；修改在下一次运行生效，已开始运行使用既有快照。

## 6. Skill

采用 [Agent Skills](https://agentskills.io/specification) 标准，与 pi、Claude Code、Codex、OpenClaw、Hermes 通用：别处的 skill 原样放进来就能用。

**格式**：一个目录，含 `SKILL.md`。frontmatter 的 `name`（小写字母、数字、连字符，不以连字符开头结尾、不连续，≤ 64 字符）与 `description`（必填，≤ 1024 字符）是内核用到的字段；`disable-model-invocation: true` 的 skill 不进索引；其他字段保留不用。格式不合法的 skill 不加载，`yonder doctor` 与日志说明原因。

**来源**（同名时排前者生效，`doctor` 报告被遮蔽的）：

1. agent 工作区的 `skills/`（经执行环境读取）；
2. home 的 `skills/`；
3. 插件贡献（04 §3.8）；
4. 安装代码根目录skills/内置技能。

预设会话没有工作区，使用home、插件及内置来源。目录按 `**/SKILL.md` 递归发现。

**选择**：配置档的 `skills` 通配列表（默认 `["*"]`）；访客类分身可以设为 `[]`。

**索引**：system 第 ⑦ 段（§5.1），按 `name` 排序，每个 skill 只有名字与描述，格式：

```
<skills>
<skill name="pdf-tools">Extract text and tables from PDF files. Use when …</skill>
</skills>
```

索引在每次组装提示词时重新生成（skill 有变化才会改变 system）。索引超过 4000 个估算 token（字符数 ÷ 4）时 `doctor` 警告，内核不截断。

**读取**：内置工具 `skill_view({ name, path? })` 返回 `SKILL.md` 全文，或 skill 目录内的某个文件（`path` 相对 skill 目录，不能越出）。结果开头注明 skill 目录的绝对路径与所在位置（工作区所在执行环境，或主机）。`skill_view` 不需要能力，只能读本配置档选中的 skill；运行 skill 里的脚本仍需 `exec`，且只有脚本所在位置与本次运行的执行环境相同时才可行。

**自己写 skill**：agent 用普通文件工具在工作区 `skills/<name>/SKILL.md` 写入（需要 `write`），下一次运行即进入索引。内核不自动生成、合并或删除 skill；自动整理之类的策略由插件实现。

**与工作流的区别**：skill 是给模型的做事说明，在一次运行里由模型照着做；工作流是跨多次运行、多个 agent 或脚本的编排。0.1 不做工作流，两种做法都有现成接口：模型驱动（skill 写清步骤，模型调用 `task_run` / `agent_ask`），或代码驱动（插件用触发器 + `events.on` + `events.ask`，04 §8）。

## 7. 本地管理补齐

Skills 本地导入/查看/删除、来源与配置诊断的完整边界按 13 §2。发现/遮蔽/profile 选择仍按本页，不增加自动学习引擎、启停数据库或会话中 profile 热切换。

Agent 与预设的热管理、归档与模板创建见 [14 §4](14-execution-capabilities.md)；limits.maxTurns/maxMinutes/maxTokens 是软提醒阈值，见 14 §1。

## 8. 子任务结果

子任务输入附件由调用方显式选择，默认不继承父全部附件；每条附件保留原来源与既有读取范围。task_run 返回包含实际 child session、status、reason、text 和可选 attachments 的结构化正文。ToolResult 可携带显式 attachments，runtime 把这些真实产物引用存入该工具原生结果元数据并在本轮结果中保留；没有产物不造附件，不从自然语言猜路径，不扫描工作区搜集文件。结果引用不自动扩大父调用方权限，读取/发送仍校验；不增加 artifact 数据库。

task 会话最终回复首行必须为 `STATUS: done|partial|blocked`，随后列出实际验证证据（命令、测试、路径）、剩余项，blocked 必须说明准确所需条件。禁止以空文本或字面 `NO_REPLY` 结案；若仍出现，内核只把返回调用方的 text 规范化为 `STATUS: unknown (no report)`，不改变原生运行 status、不增加 outcome。`status: done` 仅表示运行正常结束，STATUS 是模型自述，调用方必须核实后再向主人报告。

`task_run`、`agent_ask` 的工具说明含简报六要素：目标、材料/路径、边界/禁止、完成标准、遇阻停止并报告的条件、回传要求（含 STATUS 首行）；每项工具的新增指引不超过约 120 词，不增加 schema 字段。

## 9. 内置创作与开发技能

发行包含完整上游skill-creator（含许可及引用资源）与简洁yonder-development，默认skills=[*]的所有agent及预设可发现，只有名字描述进入索引，正文仍由skill_view按需加载。显式skills选择/禁用和workspace/home覆盖仍有效，不以“默认”绕过用户过滤。现有本机agent配置中的显式白名单加入这两项，不强制未来配置。

yonder-development提供可工作的建议：默认源码<home>/development/<name>或用户指定路径，普通插件独立git保存，官方代码改动常规fork/branch/PR；运行用隔离home与自身凭据，不覆盖正式launchd。正式程序仅update更新，不在versions/current改源码。用户可选择其他方式；skill不授予push/发布权限，不建立强制工作流或自动创建remote。
