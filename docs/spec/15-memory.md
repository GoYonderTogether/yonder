# 15 用户记忆（memory 插件）

官方独立插件 `memory`（`@yonder/plugin-memory`），为**一个人**维护一个独立于任何 agent 的个人资料库：全部记下来、查得到、按时间线和人生计划形成闭环。不改内核；只用 04 的槽（tools、contexts、triggers、skills）与 `events.on`。不含向量检索、图谱、自动画像管线。

## 1 边界

- 记忆属于**用户（`person:`）**，不属于 agent。根目录由配置指定，**必须**在所有 agent 工作区之外；多个 agent 共用同一份（架构不变量 8 针对 agent 工作区，本根目录在主机上，由插件直接读写）。无 `exec` 的运行文件工具到不了根目录，只能走 `memory_*` 工具；带 `exec` 的配置档仍可绕过，这是 05 §3 已写明的局限，不在这里重复解决。
- 与 03 §2.2 的工作区 `memory/`（agent 自己的手记，14 §6）互不相干：本插件不读不写它。
- 事件仍是唯一事实流（不变量 1）：对话原文留在事件库，本插件只存引用与摘录；记忆文件是可变状态，不是事件。
- 不替模型决定要不要记：采集是确定性的，整理和判断由模型按 skill 做；任何“推断”都不得冒充用户确认。
- 内核不为本插件增加任何字段、槽、命令。

## 2 根目录

```
<root>/
  SCHEMA.md        读写规则（§9），随插件生成，可由用户修改
  log.md           变更日志，只追加（§8.3）
  mine/            用户亲笔；插件从不写入
  raw/YYYY-MM/     原始资料：inbox 处理后的原件与转换文本、agent 提交的资料
  inbox/           待处理文件（用户或渠道附件放入）
  life/            vision.md（长期愿景）、<YYYY>.md（年度）
  timeline/
    YYYY-MM/
      month.md       月文档
      YYYY-Www.md    周文档（一周一个，无日文档）
  me/              now.md、profile.md、mind.md（观念与特质）
  projects/        一个项目一个文件，按需建立；插件不维护其内容
  private/         私密记录（§7）
  archive/         只归档，不删除
  .memory/         manifest.json（已处理文件的 sha256 → raw 路径）、状态
```

- 目录与固定文件在首次启动时按需创建；已存在的用户文件和目录**禁止**覆盖。
- 外部目录（Obsidian 库、agent 的产出目录等）**不复制、不改动**，在配置里登记为只读来源（§6.4）。
- `timeline/YYYY-MM` 的 `YYYY-MM` 取该周周四所在的月份（与 ISO 周年一致）；周从周一开始；日期按配置时区计。

## 3 来源标签与引用

每条记录和每份由插件生成的文件带来源标签 `origin`：

| origin | 含义 |
|---|---|
| `human-written` | 用户亲笔（`mine/`，以及登记为 `human` 的外部目录） |
| `human-said` | 用户在聊天里说的话 |
| `agent` | agent 观察、整理、研究所得 |
| `external` | 他人消息、网页、导入文档 |
| `legacy` | 旧资料，作者未确认（登记目录的默认值，视同假设，不当证据） |

- 每条记录**必须**带来源引用（02 §4.3 的约束）：`(ref: <Ref>; evt:<事件id>)`。`<Ref>` 对对话是发送者 `acct:`，对 `memory_capture` 是调用的 `agent:`，对 inbox 是 `plugin:memory`；`evt:` 仅在有对应事件时出现。
- 派生内容（`me/`、复盘、projects）的每条断言**必须**能追溯到记录或文件；`agent` 的断言是假设，不是证据（§9）。
- 条目 id：`^m` + 毫秒时间戳的 base36 + 2 位随机，作为行尾块 id（Obsidian 通用，也供工具定位）。

## 4 时间线文档

### 4.1 周文档

```
---
week: 2026-W43
range: 2026-10-19..2026-10-25
status: open            # open | reviewed
---
## 本周计划
## 提议
## 决定
## 产出
## 复盘
## 记录流
```

- **记录流必须是最后一节**；插件对它只做文件末尾追加，其余节的修改是读-改-写（§8.2 并发保护）。
- 记录流按天以 `### MM-DD 周X` 小标题分组，换天时自动插入。每天**没有**独立文档。
- 周文档文件名 `YYYY-Www.md` 与 Obsidian Periodic Notes 的默认周格式一致；任务行沿用 Obsidian Tasks 的写法，截止日期用 `📅 YYYY-MM-DD`，使用户在 Obsidian 里打开即可被这些插件识别，不另造格式。
- 本周计划：`- [ ] 文字 ^id`。状态标记 `[ ]` 开放、`[x]` 完成、`[-]` 放弃、`[>]` 延期（行尾 `⟳N` 记延期次数）。
- 提议：模型写入的待确认条目，格式同上。用户确认前**不得**视为计划。
- 决定：每个复杂决定一块，固定五项：`背景 / 选项 / 选择 / 理由 / 复查日`。
- 产出：本周 agent 或流程产出的文档与结果，只放链接（指向 `raw/` 或外部目录）。
- 复盘：模型草拟、用户可改。`status: reviewed` 表示已完成周复盘。

### 4.2 记录流格式

一条记录一行，续行缩进两个空格：

```
- [ ] 14:03 {chat} 正文 (ref: acct:feishu-main:ou_1; evt:ID) ^mk2f9a1
- [x] 14:20 {capture} 正文 (ref: agent:main) ^mk2fa77 → me/now
```

- `{source}` 取 `chat`、`capture`、`inbox`、`material`、`wechat`。
- `[ ]` 未整理；`[x]` 已整理，行尾 `→ 去向` 记录去向（`me/now`、`me/profile`、`me/mind`、`plan`、`decision`、`output`、`project:<名>`、`none`）。
- **正文一个字都不改**，整理只翻转标记并追加去向。用户在 Obsidian 里手动勾选等于自己接管了这条。
- 单条正文超过 `capture.inlineMax` 字符时，全文存为 `raw/YYYY-MM/<id>.md`，记录行只留前 200 字符与 `→ raw/…` 指针。
- 标记就是去重依据：已 `[x]` 的条目重复整理为空操作。

### 4.3 月文档与人生计划

- `month.md`：`## 月目标`、`## 提议`、`## 月复盘`、`## 阶段变化`（状态变化的节点，来自 `me/` 条目的关闭）。
- `life/vision.md`、`life/<YYYY>.md`：自由文本加 `## 提议`。
- 提议→确认流程与周文档一致（§5 `memory_plan`）。

## 5 工具

全部工具名 `memory_*`，参数 TypeBox 校验。读取类需要 `read` + `admin`，写入类需要 `write` + `admin`（沿用 wechat-archive 对私密资料的先例：访客类 readonly/standard 配置档拿不到）。工具返回的外部文本结果带 `externalContent: true`，不进 system，不当指令。

| 工具 | 能力 | 作用 |
|---|---|---|
| `memory_status` | read, admin | 根目录、各来源可用性、转换器与 rg 是否就绪、inbox 积压、未整理条目数与最久一条的年龄、最近错误 |
| `memory_search` | read, admin | 检索（§6.2） |
| `memory_read` | read, admin | 读一个文件或周文档的一段（上限 12000 字符，超出标 truncated） |
| `memory_capture` | write, admin | 记一条；`kind`：`note`（默认，写入记录流）、`material`（agent 资料，存 `raw/` 并在记录流留指针）；`by`：`owner`（主人原话，origin `human-said`）或 `agent`（默认）；可选 `when`（补记到指定日期的周文档）、`private`（写入 `private/`） |
| `memory_plan` | write, admin | `get`；`propose`（写入提议节）；`commit`（见下）；`update`（改任务状态 `done/postponed/dropped/open`） |
| `memory_review` | write, admin | `pending`（列未整理条目）；`organize`（翻转标记并写去向）；`section`（写周/月文档的 `决定 / 产出 / 复盘 / 月复盘` 等节，`append` 或 `replace`）；`close`（周 `status: reviewed`，复盘节为空则拒绝；仍有 `[ ]` 时附警告但允许） |
| `memory_me` | write, admin | `read`；`add`；`supersede`（关旧开新）；`confirm` |
| `memory_import` | write, admin | `source: 'wechat'`：按 §6.1(5) 导入历史，参数 `chat`、可选 `since/until`；重复导入为空操作 |
| `memory_bootstrap` | write, admin | `audit`（§6.6）；`ack`（确认某个 `memory.attention` 的 reason，可带 `snoozeDays`）；`state`（读 `.memory/state.json`） |

- `commit` 与 `confirm`：必须在**由 `owner` 的 `message.in` 触发的运行**中调用，即 `ToolContext.event` 是该事件，其 `from` 经 `identity.account` 解析到配置的 `owner`；被确认的提议必须写于该事件之前（提议与确认至少隔一轮，同一轮里提议后不能自行确认）。该事件的 id 作为确认证据写入条目。`ToolContext.event` 是本次运行的**第一条**输入事件：多条输入因 steer 合并为一次运行时仍以它为准，后到的 owner 消息不能用来确认更早的提议，确认应在新的一轮里进行。不核验语义；节律（cron）触发的运行因此不能自行确认。这是工具的前置条件，不是审批层（不变量 5）。插件不依赖按 id 查询事件（SDK 的 `EventQuery` 没有该字段）。
- `memory_me.add` 标 `confirmed` 时必须带 `evidence`，取下列之一：①当前运行由 owner 的 `message.in` 触发（证据为该事件 id）；②记录流里一条 `{chat}` 记录的条目 id（该记录由插件自己从 owner 的消息确定性写入，不是模型写的；`{capture}` 记录不算）。否则只能标 `inferred`。同样不核验语义。`events.on` 不保证先于运行启动完成，所以运行刚开始时 `{chat}` 记录可能尚未写入：此时只能用①；找不到记录不代表用户没说过，也不得伪造证据。
- `memory_me` 条目格式：`- 内容 {confirmed|inferred} [自 YYYY-MM-DD] (ref: …) ^id`；`supersede` 在原条目追加 `[至 YYYY-MM-DD]` 并移入文件末尾的 `## 历史`，不删除。

## 6 采集与检索

### 6.1 采集入口

1. **对话**：`events.on('message.in')`。仅当发送者账号经 `identity` 关联到配置的 `owner`，且渠道在 `capture.channels` 里（默认空：不采集）时，追加一条 `{chat}` 记录，origin `human-said`。文本为空且无附件的跳过。`capture.attachments` 为真时，附件复制到 `inbox/`（受 `maxAttachmentBytes` 限制，超出只记元数据）。本入口**不**另发事件。
2. **`memory_capture`**：见 §5。
3. **inbox**：触发器 `memory-inbox` 监听 `inbox/`（文件变化加每 `rescanSeconds` 的重扫兜底），大小稳定后处理：忽略点文件与 `.part`、`.crdownload`、`.tmp`；计算 sha256，`manifest.json` 已有则移入 `archive/duplicates/` 并记一行，不重复入库；否则文本类（`.md/.markdown/.txt`）原样，其他类型在配置了 `converter` 时按 §10 的调用约定转换为 `.md`，转换输出先做 Unicode NFKC 规范化再落盘（PDF 抽取常把汉字映射成康熙部首等兼容字符，如“文”变成“⽂”，不规范化则子串检索失败）；转换失败（非零退出、超时、空输出）保留原件并在 `memory_status` 报告；原件移入 `raw/YYYY-MM/<sha256前8位>-<原名>`；追加一条 `{inbox}` 记录（origin `external`）；发出事件 `memory.captured`。
4. **登记目录**：见 §6.4。
5. **微信**：配置 `sources.wechat.chats`，每项 `{ chat, self? }`，`chat` 是 `wechat-context` 的会话 id（形如 `Msg_…`），`self: true` 表示这是用户写给自己的笔记会话（如文件传输助手）。
   - 实时：`events.on('wechat-archive.material')`，`data.chat` 在名单内的每条消息追加一条 `{wechat}` 记录；`self` 的 origin 为 `human-written`，否则 `external`。这要求同时安装并配置 `wechat-archive`（其 `chats` 须包含该会话）；本插件不读取名单外的会话，未配置名单则不采集任何微信内容。
   - 历史：`memory_import` 调用 `wechat-context history --chat <id> --normalized` 分页（与 wechat-archive 同一命令契约，`sources.wechat.cliPath` 缺省取与其相同的位置），按消息时间写入对应周文档；媒体只记元数据与 `url`，不复制文件。
   - 实时与历史共用去重键 `wechat:<chat>:<msgid>`（`manifest.json`）；重复导入为空操作。

### 6.2 检索

`memory_search({ terms: string[], match?: 'any'|'all', zones?, since?, until?, origin?, limit?, includePrivate? })`

- 不建索引。使用 ripgrep 固定参数（`--fixed-strings --ignore-case`，与核心 grep 同一依赖，不经 shell）扫描根目录与登记目录；缺 `rg` 时 `memory_status` 与工具错误给出具体诊断，不做第二套实现。
- `terms` 是字面子串（对中文稳定，不分词）；每个 term 同时按原样与 NFKC 规范化后各搜一次；同义词、改写由模型展开成多个 term。`match: any` 默认。
- 结果按文件聚合，排序：命中的不同 term 数、命中数、日期新者在前。每个文件返回路径（根内相对路径，登记目录为 `<name>:<相对路径>`）、origin、日期、命中行号与前后各一行片段。`limit` 默认 20，最大 100。
- `zones`：`timeline`、`life`、`me`、`mine`、`raw`、`projects`、`archive`，或登记目录名。默认不含 `archive`、`private`；`includePrivate` 必须显式为真。
- 默认忽略 `.git`、`.obsidian`、`node_modules` 与点文件，不跟随符号链接，路径按真实路径校验不得越出根或登记目录。
- 仅文本类文件（`.md/.markdown/.txt`）可检索；其他类型须经 inbox 转换后进入 `raw/`。

### 6.3 `memory.captured` 事件

type `memory.captured`，conv `conv:memory-inbox:default`，data：`{ path, origin, source, sha256?, converted?: boolean }`。仅 inbox 与 `memory_capture(material)` 发出。

### 6.4 登记目录

配置 `roots: [{ name, path, origin }]`，`origin` 取 `human`、`agent`、`external` 或 `legacy`，缺省 `legacy`（作者未确认时不当证据）。只读：参与检索与 `memory_read`，插件**从不**写入、移动、改名其中任何文件。`origin: human` 的目录视同用户亲笔。

### 6.5 启动器

触发器 `memory-bootstrap` 在启动时及每 `bootstrap.checkMinutes` 分钟评估下列条件，满足且不在冷却期时写一条事件 `memory.attention`（conv `conv:memory-bootstrap:default`）。评估与写事件**不调用模型**。

| reason | 条件 |
|---|---|
| `first-run` | `.memory/state.json` 没有 `initialized` |
| `source-new` | 配置里出现尚未审计过的登记目录或微信会话 |
| `source-stale` | 微信归档的最近同步时间（取 `wechat-context status`）距今超过 `bootstrap.wechatStaleHours` 小时：归档同步可能已停（`wechat-context` 的后台轮询连续失败 3 次会自行暂停，不会主动告警） |
| `backlog` | inbox 文件数 ≥ `bootstrap.inboxFiles`，或未整理条目 ≥ `bootstrap.unorganized`，或最久的未整理条目超过 `bootstrap.staleDays` 天 |

- data：`{ reason, audit }`，`audit` 是 `memory_bootstrap(audit)` 的结果。
- 同一 reason 在被 `ack` 之前，每 `bootstrap.cooldownHours` 小时最多一次；`ack` 后按其 `snoozeDays` 静默。状态在 `.memory/state.json`。
- 事件经 agent 的绑定唤醒负责的 agent（通常是主人的日常 agent，由它与用户确认）；没有绑定命中时只记录原因（架构不变量 2）。
- 启动器只负责“发现需要处理并通知”，不创建 agent、不改配置、不开始导入；这些由收到事件的 agent 按 skill `memory-onboarding` 经用户确认后执行。

### 6.6 审计与费用估算

`memory_bootstrap({ op: 'audit', model? })`：统计各区、登记目录、inbox、微信名单与未整理记录的文件数、字节数、字符数；用 `gpt-tokenizer` 的 `o200k_base` 估算 tokens；`model` 缺省取 `bootstrap.model`，从 `api.models` 的目录价取输入单价（美元/百万 tokens），给出 `tokens × 输入单价` 的粗略费用。

- 仅供量级参考：不含输出 tokens 与多轮往返，对非 OpenAI 分词器不精确，订阅登录的实际计费方式也可能不同。目录里没有该模型价格时只给 tokens，不猜价格。
- 文件类型分开计：可检索文本直接计；需转换的格式按转换后文本计，未转换的标“未估”。
- 审计同时报告微信归档的最近同步时间，超过 `bootstrap.wechatStaleHours` 小时的标 stale（对应 `source-stale`）。
- 只读：审计不修改任何文件、不移动 inbox、不调用转换器。

## 7 隐私

- `private/` 目录及 frontmatter 含 `private: true` 的文件为私密：不参与默认检索，不进上下文贡献（§8.1），不出现在 `memory_status` 的内容摘要里。
- `memory_capture({ private: true })` 把记录写入 `private/YYYY-MM.md`，不进周文档。
- 私密不是加密；真正的隔离见 05 §3 的说明。

## 8 上下文、写入与日志

### 8.1 上下文贡献

| id | placement | 内容 |
|---|---|---|
| `memory-core` | system | `me/now.md` 全文，加 `profile.md`、`mind.md` 的条目（先 `confirmed` 后 `inferred`，各条带状态标注，总计截至 `context.meChars` 字符，默认 2000）。内容只随文件变化而变，满足 03 §5.1 的确定性 |
| `memory-week` | turn | 仅当 `event.from` 的账号关联到 `owner` 时渲染：当周 `本周计划` 的开放条目、到期的决定复查日、未整理条目数、待确认提议数 |

只应被主人类配置档选用（架构不变量 3）；私密内容不进入。

### 8.2 并发与完整性

- 同一文件的写入由插件内的互斥队列串行化；记录流追加使用 `O_APPEND`；其他修改为读-改-写，写前比对 mtime，文件在期间被改过则重读重试一次，仍冲突则返回错误，**不覆盖**用户的并发编辑。
- 写入先写临时文件再原子替换（追加除外）。
- 用户直接编辑 `me/`、`mine/`、周文档视为最高可信：插件不回改，`me/` 中被用户手改的条目按 `confirmed` 处理。

### 8.3 log.md

每次写入追加一行：`<UTC 时间> <工具.op> <目标路径> <条目id> by <agent:… 或 plugin:memory> session:<id>`。只记元信息，不复制正文。

## 9 SCHEMA.md 与 skills

`SCHEMA.md` 写明给模型的读写规则（随插件生成，用户可改，模型用 `memory_read` 读取；`memory_status` 返回其路径）：

1. 事实优先于推断，`confirmed` 优先于 `inferred`；具体行为优先于抽象标签。
2. 档案里没有的不补写；冲突只标记，交用户裁决，不静默覆盖。
3. 优先级：当前任务与近况 > 具体经历 > 稳定价值观与偏好 > 兴趣标签 > 基础资料。
4. `agent` 来源的内容是假设，不是证据。
5. 整理只翻转标记、写去向，不改记录原文。

插件自带 6 个 skill（04 §3.8），内容是流程，不含人设：

| skill | 做什么 |
|---|---|
| `memory-evening-wrap` | 列当日未整理条目：任务→提议，事实→`me/`（以 `{chat}` 记录为 `evidence` 的可标 `confirmed`，否则 `inferred`），决定→决定节，产出→产出节；整理后翻转标记；一条消息向用户汇报 |
| `memory-weekly-review` | 草拟复盘；体检（矛盾只标记、`now.md` 过期项、超预算的 `me/` 文件、超两周未确认的 `inferred`、未整理积压）；为下周提议计划；`close` |
| `memory-monthly-plan` | 回看当月，写月复盘与阶段变化，提议下月目标 |
| `memory-onboarding` | 收到 `memory.attention` 后：①向用户转述审计结果（各来源规模、tokens 与粗略费用）；②提出方案（是否创建后台 agent `memory-keeper`、开启哪些节律、是否导入旧目录与微信历史）并**等待用户确认**；③确认后用 `yonder agents` 从预设 `memory-keeper` 创建 agent（14 §4，需 exec），按需配置 cron 作业与绑定，启动导入；④ `ack`。未经确认不得创建 agent、启用节律或开始导入 |
| `memory-onboard-legacy` | 对 `legacy` 登记目录逐篇只读审阅，产出提议：可信的事实→`me/`（`inferred`）、项目→`projects/`、可执行事项→周计划提议；不改原目录；记录每篇的去向，便于用户决定是否归档旧库 |
| `memory-morning-brief` | 汇总当日计划与到期事项，以单条消息发出 |

**调度**交给 cron（14 §2）：每个节律一个 cron 事件作业，经 agent 的绑定进入主人类配置档；作业事件的 data 指明要执行的 skill 名，事件格式见 cron 插件文档。是否开启由用户决定，插件**不**自行创建作业；作业的绑定指向后台 agent `memory-keeper`（若已创建），否则指向日常 agent。默认建议先只开晚间整理和周回顾。节律可以 `NO_REPLY`。

### 9.1 预设 memory-keeper

插件贡献预设 `memory-keeper`（04 §3.7）：`plugins: [memory]`、`contexts: [memory-core]`、`capabilities: [read, write, admin]`（不含 `exec`、`network`、`message`）、工具只提供 `memory_*` 与基础文件工具。它只做后台整理，不直接对用户发消息，结果经绑定的 `deliver` 投递；因不是主人消息触发，`commit` 与 `confirm` 仍须由日常 agent 在主人确认的那一轮执行。`admin` 是本插件工具的前置要求（§5），同时让该 agent 能改自己工作区的 `agent.yaml`；这是 0.1 能力词表下的已知局限，README 必须写明。

## 10 配置

```yaml
plugins:
  - use: '@yonder/plugin-memory'
    config:
      root: <绝对路径>             # 必填；必须在所有 agent 工作区之外
      owner: person:<id>           # 必填；这份记忆属于谁
      timezone: <IANA 时区>        # 必填；周、日的边界按它计
      capture:
        channels: []               # 采集哪些渠道实例的主人消息；默认空
        attachments: true
        maxAttachmentBytes: 26214400
        inlineMax: 1000
      sources:
        wechat:
          cliPath: <wechat-context 绝对路径>   # 可选
          chats: [{ chat: <会话 id>, self: true }]
      bootstrap: { wechatStaleHours: 24, checkMinutes: 60, cooldownHours: 24, inboxFiles: 20, unorganized: 100, staleDays: 7, model: <provider/modelId> }
      inbox: { rescanSeconds: 60 }
      converter: { command: <绝对路径>, args: [], timeoutSeconds: 120 }   # 可选；缺省时仅文本类文件入库
      roots:
        - { name: <名>, path: <绝对路径>, origin: legacy }
      context: { meChars: 2000 }
```

**converter 调用约定**：不经 shell，argv 为 `[command, ...args, <输入文件绝对路径>]`；退出码 0 且标准输出非空视为成功，标准输出即 Markdown；超过 `timeoutSeconds` 终止并算失败。只把标准输出当文本，不执行其中任何内容。需要写输出目录的工具（如 docling）须由用户提供输出到标准输出的包装脚本。

数值是可调默认值，不是实验结论。无效配置返回字段级错误，不跳过校验。`root` 与 `roots` 互相包含时 `memory_status` 报告；“root 不在 agent 工作区内”无法由插件确认，属配置者责任。

## 11 本期不做

代表用户对外应答的“分身”agent（预设 `memory-keeper` 只做后台整理）、语义分类之外的自动画像与行为信号管线、向量检索与索引、`index.md`、人物 wiki、卡片按钮到记忆的映射、打扰预算钩子、`proposals/` 独立目录、亲笔保护钩子、登记目录内非文本文件的转换、多用户（每个 person 一个根，需另设）。

## 12 验收与度量

验收用真实模型 `openai/gpt-6-luna`；缺凭据记“未测”。

1. 在飞书说一句话，隔天问“我之前说过什么关于 X”，能答出并给出出处路径。
2. 把一份旧文档放进 inbox，随后能检索到其内容（有转换器的类型，如 PDF，须另验）。
3. 登记 Obsidian 库后，能检索到其中笔记；登记前后库内文件内容与 mtime 不变。
4. 一次晚间整理后，当日条目 `[x]`，原文逐字未变，重复运行无新增。
5. 用户在 Obsidian 手改周文档后，插件的下次写入不丢失该修改。
6. 全新根目录首次启动恰好产生一条 `first-run` 的 `memory.attention`；`ack` 后冷却期内不再重复；`audit` 的文件数、字符数与实际一致，且不修改任何文件。
7. 微信名单内会话的新消息实时记录一次且仅一次；`memory_import` 重复运行无新增；名单外会话没有任何记录。
8. 登记一个真实 Obsidian 库（`legacy`）并审计后，库内文件字节与 mtime 不变。

上线后的度量（人工抽样，`memory_status` 提供计数）：采集完整度、检索命中率（10 个真实问题，前 3 条命中）、整理率、复盘完成率、计划兑现率与延期分布、节律回应率、用户对 `me/` 与复盘的手工修正率。两周后据此决定哪些能力升级、哪些删除。

## 13 分发与安装

- 插件随主仓库发布（`plugins/memory`，包 `@yonder/plugin-memory`），不另建仓库；主仓库公开，任何人克隆或安装发行版后，用 13 §2.1 的 `yonder plugins add` 加入并写好 `yonder.yaml` 配置即可使用。
- `plugins/memory/README.md` 必须包含：它是什么、不是什么；前置条件（Node、`rg`，可选 converter、可选 `wechat-context` 与 `wechat-archive`）；最小配置；首次启动会发生什么（目录创建、`memory.attention`、onboarding 流程与需要用户确认的步骤）；各 skill 与节律的启用方法（cron 示例，payload 含 `kind: "event"`）；隐私说明（私密、事件库不可擦除、亲笔保护的局限、`admin` 能力的含义）；卸载（删除配置，根目录原样保留）；常见问题。
- 仓库内不含任何个人信息、示例人设或虚构数据。
