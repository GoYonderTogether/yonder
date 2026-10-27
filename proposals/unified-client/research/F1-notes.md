# 跟着数据走的笔记：Yonder 只读调研报告

调研范围：仓库 `/Users/zoran/Documents/yonder-harness`（`origin/main` 工作树），外部资料联网核对（文末列核实状态）。未修改任何文件。

## 0. 结论先行

1. **现有代码里没有"给实体挂一段备注"的位置。** 唯一带 note 的实体是 `y_persons.note`（`packages/core/src/store/index.ts:70`），但它只能由配置或 CLI 写入（`packages/core/src/config/schema.ts:153-159`、`packages/cli/src/index.ts:182-189`），`identity_lookup` 的返回里**没有 note**（`packages/core/src/tools/index.ts:470-505`），也不会进任何上下文。
2. **memory 插件是"按时间线记账"，不是"按实体挂笔记"**：存储是按周/按月的 Markdown + 追加记录流，检索是 ripgrep 字面扫描，没有主键、没有实体索引（`docs/spec/15-memory.md:167-180`）。实体（`acct:`/`conv:`/`person:`）只以**行内引用文本**出现在记录里（`plugins/memory/src/ingest.ts:97`、`plugins/memory/src/wechat.ts:111`、`plugins/memory/src/capture.ts:50`）。
3. **推荐方案 A**：在 memory 插件里加一个"按实体键控的笔记区"（`entities/<type>/<id>.md`，frontmatter 带实体 ref），复用同一套存储、检索、隐私和上下文贡献；**不要**新开第二个存储闭环（方案 B 的代价见 §3.4）。
4. **两个必须先解决的硬约束**：
   - `RenderContext`/`ToolContext`/`SessionInfo` 都**没有 model 字段**（`packages/sdk/src/types.ts:330-337`、`:305-317`、`:176-187`），所以"选模型时注入模型备注"今天做不到，只能靠 `sessions.command(id, "model")` 解析文本（`packages/core/src/sessions/index.ts:114-200`）这种脏办法。
   - `docs/decisions.md:106`（D41）写着"memory 仅手工目录，**不引入记忆引擎或自动注入**"。任何自动注入都是设计变更，按 `AGENTS.md` 第 7 条须维护者批准 + 在 `docs/decisions.md` 记一条。

## 1. Yonder 现状

### 1.1 memory 插件存什么

规范：`docs/spec/15-memory.md`。定位是"为**一个人**维护一个独立于任何 agent 的个人资料库"，明确"不含向量检索、图谱、自动画像管线"（`:3`）。

- 归属与边界（`:7-13`）：记忆属于 `person:`，不属于 agent；根目录**必须**在所有 agent 工作区之外，多 agent 共用；与 03 §2.2 的工作区 `memory/` 手记互不读写。
- 根目录结构（`:13-37`）：`SCHEMA.md`、`log.md`、`mine/`（用户亲笔，插件不写）、`raw/YYYY-MM/`、`inbox/`、`life/`、`timeline/YYYY-MM/{month.md,YYYY-Www.md}`、`me/{now,profile,mind}.md`、`projects/`、`private/`、`archive/`、`.memory/`。
- 来源标签 → origin 映射在 `plugins/memory/src/records.ts:1-11`（chat/said→human-said、capture/material→agent、inbox→external、wechat-self/wechat）。
- 记录流格式（`:82-110`）：`- [ ] HH:MM {source} 正文 (ref: …) ^m<id>`，`^id` 是整理标记的锚点。
- 本期明确不做（`:310`）：分身 agent、向量检索与索引、`index.md`、**人物 wiki**、卡片按钮映射、多用户（每 person 一个根）。

### 1.2 怎么存

- 纯文件，无数据库：`plugins/memory/src/store.ts`（按文件串行队列 + lockfile + 原子替换 + mtime 冲突重试），`log.md` 只追加（`docs/spec/15-memory.md:237`）。
- 写入即"追加一行到当周文档的记录流末尾"，不是 upsert（`plugins/memory/src/capture.ts:75-95`）。
- 检索无索引：`rg --fixed-strings --ignore-case`，中文不分词，靠模型把同义词展开成多个 term（`docs/spec/15-memory.md:167-180`）；zone 白名单在 `plugins/memory/src/retrieval.ts:168`、`:182-193`。
- 隐私：`private/` 与 frontmatter `private: true` 默认不检索、不进上下文（`docs/spec/15-memory.md:214-218`）。

### 1.3 怎么注入上下文

两处贡献，都在 `plugins/memory/src/contexts.ts`：

| id | placement | 内容 | 位置 |
|---|---|---|---|
| `memory-core` | system | `me/now.md` 全文 + `profile.md`/`mind.md` 条目（confirmed 先于 inferred），总预算 `context.meChars` 默认 2000 字符 | `contexts.ts:78`、`docs/spec/15-memory.md:226` |
| `memory-week` | turn | 仅当 `event.from` 关联到 `owner` 时渲染：本周计划开放条目、到期决定复查、未整理数 | `contexts.ts:94`、`docs/spec/15-memory.md:227` |

可见范围靠配置：`owner`（`^person:.+$`）、`allowedAgents`、`allowedSourceConversations`（`plugins/memory/src/config.ts:13-15`）。
渲染入口是内核，不是插件：`packages/core/src/prompt/index.ts:83`（`renderContext`）、`:105`（`contributions`），只有 `agent/profile/session/workspace/event/signal` 传给插件。

**关键事实：`memory-core` 与 `memory-week` 都不看"当前会话是哪个群/哪个人"，只按 owner 身份判断。** 这正是"进群注入该群备注"缺的那一环。

### 1.4 Agent 用什么工具读写

规范表在 `docs/spec/15-memory.md:117-131`，注册在 `plugins/memory/src/index.ts:93-165`：

`memory_status`、`memory_capture`（note/material、by owner|agent、when、private）、`memory_search`、`memory_read`、`memory_plan`、`memory_review`、`memory_me`（add/supersede/confirm）、`memory_import`（wechat）、`memory_bootstrap`。
另有预设 `memory-keeper`（`plugins/memory/src/index.ts:156`）：只有 read/write/admin，无 exec/network/message。

`memory_me` 的 `supersede`（关旧开新）是现有唯一的"防过期"机制，作用域只有 `me/*.md`（`docs/spec/15-memory.md:129`、`:149`）。

### 1.5 身份/联系人体系

- 表：`y_accounts(ref, person, name, firstSeen, lastSeen)`、`y_persons(id, name, note)`（`packages/core/src/store/index.ts:69-70`，规范 `docs/spec/02-sessions.md:127-128`）。
- 关联只能显式建立，每次写 `identity.link` 事件（`docs/spec/02-sessions.md:130`）；实现 `store.identity()` 在 `packages/core/src/store/index.ts:343-420`（`createPerson:363`、`link:373`、`unlink:393`、`lookup:412`）。
- SDK：`IdentityAPI`（`packages/sdk/src/types.ts:212-220`）含 `createPerson({id,name,note?})`；`PersonInfo` 带 `note?`（`:228`）；`Lookup` 只有 `accounts/convs/agents`（`:234`）。
- 工具：`identity_lookup`（`packages/core/src/tools/index.ts:470`，返回不含 note）、`identity_link`（`:508`）。
- 规范已经要求"每条记忆必须带 `person:`/`acct:`/`conv:`/`agent:` 引用"（`docs/spec/02-sessions.md:171`）——**引用是有的，按键查回来是没有的**。

### 1.6 渠道会话 id 形态

- 引用语法：`packages/sdk/src/index.ts:11-30`（`acct|conv:<channel>:<id>`、`person|agent|session|plugin:<id>`）。
- 形态表：`docs/spec/01-events.md:33`（`conv:<channel>:<id>`）、`:39`（`<channel>` 是渠道**实例** id，如 `qq-main`/`qq-work`）、`:41`（触发器 `conv:<triggerId>:<name>`）。
- 实例：QQ `conv:<id>:group:<gid>` / `conv:<id>:c2c:<uid>`（`plugins/channel-qq/src/channel.ts:70`）；飞书 `conv:<instance>:<chat_id>`（`plugins/channel-feishu/src/channel.ts:543`）；微信归档 `conv:wechat-archive:Msg_<hex>`（`plugins/wechat-archive/src/archive.ts:423`，ID 正则 `:100`）。
- **已有先例**：wechat-archive 在自己的 SQLite 里存每个会话的元数据 `{chat, displayName, chatType: p2p|group|official, lastTimestamp, messageCount, coverage}`（`plugins/wechat-archive/src/archive.ts:101-115`）。这是"conv 上挂元数据"的唯一现存实现，但它是插件私有库，别的插件读不到。

### 1.7 模型配置里有没有挂备注的位置

没有。

- `ModelDefinitionSchema`（`packages/core/src/runtime/model-schema.ts:25-43`）字段：`id/name/api/baseUrl/reasoning/thinkingLevelMap/input/inputLimits/cost/promptCache/contextWindow/maxTokens/samplingParams/.../headers/compat`——无 note/description。
- `ModelOverrideSchema`（`:44-59`）、`ProviderConfigSchema`（`:60-68`，`name/baseUrl/api/headers/compat/authHeader/models/modelOverrides`）同样没有。
- 校验：`packages/core/src/runtime/models.ts:253-257` 用 `Errors(ProviderConfigSchema, raw)`，`Type.Object` 未设 `additionalProperties: false`，**多写的 `note:` 键能通过校验但没人读**——所以"顺手加个 note"不会报错，但也不会出现在任何地方，属于静默失效，比报错更坏。
- 配置层 `models.providers` 在 `packages/core/src/config/schema.ts:127` 是 `Record<string, Unknown>`，真校验发生在 runtime。
- 回退链：`packages/core/src/runtime/model-chain.ts:6`（`FallbackChainConfig`）、`:24`（`DEFAULT_FALLBACK_AFTER = 3`）、`:29`（`splitModelRef`）、`:65`（`modelChain`）。
- 会话选模型：`/model <provider/model> [fallback…] | effort | after | reset | list`（`packages/core/src/sessions/index.ts:114-200`），改模型要 admin（`:121`）。

### 1.8 小结：缺口在哪

| 需求 | 现状 | 缺口 |
|---|---|---|
| 给某个微信群/联系人挂一段短文 | 无 | 无实体主键的笔记存储 |
| 进入某会话时自动带上该会话的备注 | `memory-week` 只看 owner，不看 conv | 缺"按 `event.conv`/`event.from` 取实体笔记"的 turn 注入 |
| 选模型时带上模型备注 | 无 | 缺 `model` 在 RenderContext/ToolContext |
| 检索某实体的全部笔记 | 只能 `memory_search` 字面搜 `conv:…`，命中"记录行"而非"笔记" | 缺按键查、缺 upsert 语义 |
| 用户查看/编辑 | 只能读文件或走 `memory_read` | 缺界面（TUI 命令/卡片） |

## 2. 别人的做法

| 系统 | 笔记挂在什么上 | 怎么进上下文 | 怎么防过期/冲突 |
|---|---|---|---|
| Claude Code | 项目（git 仓库）；`CLAUDE.md` 人写、auto memory 机器写 | 每次会话加载；auto memory 只注入 `MEMORY.md` 前 200 行或 25KB | 人写 vs 机写分层；`/memory` 可审阅编辑；超限写回报错逼精简 |
| Codex | 仓库 `AGENTS.md` + `~/.codex/memories`（`MEMORY.md`/`memory_summary.md`） | 启动加载 | 指令与记忆分离 |
| ChatGPT | 用户（saved memories）+ 历史对话 | 自动挑选相关记忆进对话 | 用户可查看/编辑/删除；"引用聊天历史"开关 |
| mem0 | `user_id`/`agent_id`/`run_id` + metadata + 抽出的实体 | 请求前 `search` 取回，应用自己拼进 prompt | 抽取默认**只追加**（不静默改写旧事实），纠正走显式 update/delete；向量+关键词+实体三路召回 |
| Letta / MemGPT | agent 的 memory block（`label/description/value/limit`）+ archival 向量库 | block **常驻**上下文（XML 包裹）；archival 必须工具检索 | block 有字符上限；archival 对 agent 近乎只读（开发者才能改删） |
| Zep / Graphiti | 实体-关系-事实三元组（episode 为来源） | 混合检索（向量+BM25+图）后注入 | **双时间模型 + 事实失效**：旧边不删，标记失效，支持时点查询 |
| OpenClaw | agent 工作区文件：`USER.md`、`MEMORY.md`、`memory/YYYY-MM-DD.md` | `MEMORY.md` 会话启动加载；日记默认不注入，走 `memory_search`/`memory_get` | `USER.md` 要求"observed-date + active/superseded"，**原地 supersede，不追加矛盾条目**；"action-sensitive memory"必须写清适用条件与失效条件；dreaming 扫描把日记蒸馏进 `MEMORY.md` |
| 微信 / Telegram | 联系人备注、微信群备注；Telegram 另有"联系人备注"（仅自己可见，显示在对方简介下，API `contacts.updateContactNote`） | 打开会话/资料页时显示 | 纯人工维护，无自动过期；Telegram 群只有简介/置顶，没有"群备注" |
| Obsidian | 笔记文件本身；frontmatter（properties）可写任意键（如 `contact::`） | 不自动注入（除 Dataview 类插件查询） | backlink 靠反向链接天然形成"谁引用了这个实体"；无过期机制 |

要点（各 1–3 句）：

- **Claude Code**：把"人写的规则"和"机器写的学习"分成两套文件，机器那套按项目目录隔离、只注入一个索引文件（`MEMORY.md` 前 200 行/25KB），细节留在主题文件里靠工具读——这是"注入预算"最干净的实现。https://code.claude.com/docs/en/memory
- **Codex**：`AGENTS.md` 是给人和工具共用的指令文件，记忆放在 `~/.codex/memories` 的 `MEMORY.md` + `memory_summary.md`（OpenClaw 的导入文档记录了这些确切路径）。https://github.com/openclaw/openclaw/blob/main/docs/concepts/memory.md
- **ChatGPT**：显式"保存的记忆"与"参考聊天历史"两条通道，用户能在设置里逐条看、改、删；注入由平台挑，用户不可编程控制。https://openai.com/index/memory-and-new-controls-for-chatgpt/
- **mem0**：写入是"抽取→去重→嵌入→实体抽取"，新版默认**只做 ADD**，纠正必须显式 update/delete；检索按 `user_id/agent_id/run_id` 强制作用域，避免跨用户串味。https://docs.mem0.ai/core-concepts/memory-types
- **Letta/MemGPT**：core memory（block）常驻且带字符上限，archival memory 是向量库、必须工具检索且 agent 不能随便改删；这是"常驻一小块 + 检索一大库"的经典分工。https://docs.letta.com/guides/agents/memory-blocks 、https://docs.letta.com/guides/agents/archival-memory
- **Zep/Graphiti**：以 episode 为来源建实体图，边带双时间戳，事实变了就**失效而不是删除**，因此能回答"当时是什么"；防冲突靠这个模型而不是靠提示词。https://help.getzep.com/graphiti/getting-started/overview
- **OpenClaw**：全部是工作区 Markdown，`USER.md` 明确规定"偏好变更时原地 supersede，不要追加互相矛盾的活跃条目"，并引入"action-sensitive memory"概念（写清何时可以照做、何时失效、谁授权）；没有"给某个群/某个联系人挂备注"的实体笔记。https://github.com/openclaw/openclaw/blob/main/docs/concepts/memory.md
- **微信/Telegram**：备注是纯人写的、附着在联系人/群这个实体上、在打开会话时自然出现在眼前——"跟着数据走"的产品原型，但没有自动注入、没有过期、没有冲突处理，也没有给 Agent 用的接口。https://telegram.org/blog/comments-in-video-chats-threads-for-bots （微信无官方文档可引，属产品行为）
- **Obsidian**：frontmatter/properties 让任意笔记带上结构化字段（`type: contact`、`chat: Msg_…`），backlink 让"引用过这个实体的笔记"自动聚拢；查询要靠 Dataview 类插件，Obsidian 本身不注入。https://help.obsidian.md/properties 、https://help.obsidian.md/plugins/backlinks

横向三条结论：

1. **成功的实现都只有一个存储**，靠"键 + 引用"覆盖不同实体，而不是每个实体一套表；多个存储 = 多套闭环（Yonder 明确要避免的）。
2. **常驻的一定是短索引/短笔记，长的必须检索**（Claude Code 25KB 上限、Letta block limit、OpenClaw bootstrap budget）——直接决定了备注的长度上限。
3. **防过期靠结构不靠提示词**：supersede（OpenClaw）、失效边（Graphiti）、显式 update/delete（mem0）。Yonder 现有的 `memory_me.supersede` 是同一思路的最小版本。

## 3. 候选数据模型

### 3.1 两方案共用的字段

| 字段 | 说明 | 约束建议 |
|---|---|---|
| `entity` | 主键：`{type}:{id}`，type ∈ `conv` / `acct` / `person` / `provider` / `model` / `agent` | 直接复用 `parseRef`（`packages/sdk/src/index.ts:11-30`），不新造 id 语法；`model` 用 `provider/model` |
| `body` | 正文 | 单条 ≤ 400 字符（约 150–250 token 中文），超出要求拆条或落 `raw/` |
| `by` | `owner` / `agent` / `import` | 与现有 `by: owner|agent` 对齐（`docs/spec/15-memory.md:126`） |
| `updated` | 更新时间（ISO） | 写入即更新；不改历史，改正文时保留 `history` 一行摘要 |
| `status` | `active` / `superseded` / `expired` | 学 OpenClaw 的 active/superseded，别用删除 |
| `scope` | 可见范围：`agent:<id>` 列表或 `owner-only` | 复用 memory 现有 `allowedAgents`（`config.ts:14`） |
| `private` | 私密标记 | 复用现有 `private/` 语义（`docs/spec/15-memory.md:214`） |
| `source` | 来源证据：`evt:<id>` / `msg:<id>` | 与记录流 `(ref: …)` 同构 |

### 3.2 方案 A：memory 插件内新增"实体笔记区"（推荐）

- 存储：`<root>/entities/<type>/<safe-id>.md`，每实体一个文件；frontmatter 存 §3.1 字段，正文是若干条 `## <updated> <by> <status>` 短段落。
- 检索：沿用 `memory_search` 加一个 `zone: entities` 与 `entity:` 过滤参数；不新建索引（`rg` 扫目录已经够用，`retrieval.ts:168` 的 zone 白名单加一项即可）。
- 工具：新增 `memory_note`（`get` / `set` / `append` / `supersede` / `list`），`entity` 必填；`memory_status` 里报"实体笔记条数、最久未更新"。
- 注入：新增第三个上下文贡献 `memory-entity`（placement `turn`），在渲染时按 `event.conv`（群/会话）→ 再按 `event.from`（人）顺序取 active 笔记，拼成一段；预算 300–600 字符，超预算按"更新时间新者优先"截断并在段首标注条数。
- 边界：`memory-core`/`memory-week` 不动；实体笔记**不写记录流**（不污染时间线），但每次写入在 `log.md` 记一行（`docs/spec/15-memory.md:237`）。

### 3.3 方案 B：独立 `notes` 插件（SQLite 实体键 + 事件追加）

- 存储：`plugins/notes` 自己的 SQLite（照 `plugins/tasks/src/store/{append,project,query}.ts` 的追加式事件 + 投影，`docs/spec/17-task-ledger.md:9-13`），主键 `(entity, id)`，`events` 表存 set/supersede/expire。
- 检索：SQL `WHERE entity = ?`，加可选 `LIKE`；不需要 rg。
- 注入：自己的 turn 贡献；工具 `notes_get/set/list`。
- 优点：查询精确、天然支持"多设备同步/审计"（事件流）、不受 memory 文件格式约束。
- 代价：与 memory 并列的第二套存储 → 两套隐私规则、两套可见范围、两套备份/同步、用户要在两个地方找笔记；memory 已有的 `private/`、`allowedAgents`、`log.md`、检索全部要重写一遍。

### 3.4 对比

| 维度 | A：memory 内的实体笔记区 | B：独立 notes 插件 |
|---|---|---|
| 新存储 | 无（同一根目录、同一 SCHEMA） | 有（SQLite + 事件 + 投影） |
| 与现有 memory 边界 | 清晰：时间线 vs 实体，各管一摊 | 模糊：用户要判断"这条该记哪" |
| 检索 | rg 字面（中文稳定，无排序智能） | SQL 精确 + LIKE |
| 注入成本 | 一个 turn 贡献，改 `contexts.ts` 一处 | 一个 turn 贡献，新插件 |
| 隐私/可见范围 | 直接复用 `private/` + `allowedAgents` | 全部重做 |
| 同步/备份 | 跟着 memory 根目录走（文件） | 插件 data 目录，需单独同步 |
| 实现量 | 小（1 个工具 + 1 个 zone + 1 个贡献） | 中（新插件骨架 + 存储 + 测试） |
| 主要风险 | 文件数增长（每实体一文件）、并发写（已有 store 队列可复用） | 第二套闭环，违反"多一个存储就多一套闭环"的初衷 |

### 3.5 推荐：A，分两步走

1. **第一步（不碰 SDK）**：实体笔记区 + `memory_note` 工具 + `memory-entity` turn 贡献，键覆盖 `conv`/`acct`/`person`。这已经满足"进某个群聊注入该群备注、进某个私聊注入该人备注"。
2. **第二步（要改 SDK，需批准）**：给 `RenderContext`（`packages/sdk/src/types.ts:330-337`）加 `model?: {provider, id}`，才能做"选模型时注入模型备注"。在拿到这个字段之前，模型备注只能"写进去、按需 `memory_note get model:<p>/<m>` 读"，不能自动注入。
3. **不要做**的事：不要给 `ProviderConfigSchema` 加 `note`（`model-schema.ts:60`）当存储——`yonder.yaml` 是管理员配置、改完要重启、Agent 工具碰不到，用户改备注等于改配置文件。

注入时机与预算（建议写进规范）：

| 触发 | 注入什么 | 预算 |
|---|---|---|
| 进入会话（`event.conv` 命中某 `conv:` 实体） | 该会话的 active 笔记（最多 3 条） | ≤ 300 字符 |
| 首次出现该发送者（`event.from` 关联到 `acct:`/`person:`） | 该人的 active 笔记（最多 3 条） | ≤ 300 字符 |
| 选模型/查模型（第二步） | 该 `provider/model` 的笔记（最多 2 条） | ≤ 200 字符 |
| 显式 `memory_note get` | 全部 active 笔记 | 由工具返回值控制（沿用 `memory_read` 的 12000 字符上限） |

## 4. 闭环问题清单

| 环节 | 具体问题 | 建议 |
|---|---|---|
| 创建 | 谁触发？Agent 自己觉得"这个群有规矩"就写，还是只在用户说"记一下"时写？ | 默认 Agent 可写但必须带 `source: evt:<id>`；用户口述的走 `by: owner`。写入不进记录流，只进 `log.md` |
| 更新 | 同一实体已有 3 条笔记，第 4 条进来怎么办？ | 同实体上限（如 5 条）+ `supersede` 语义；超限时工具直接报错要求先合并（学 Claude Code 的"写回被拒"） |
| 合并 | 两条笔记说的是同一件事（一次用户口述 + 一次 Agent 观察） | 提供 `memory_note merge <ids>`，合并后旧的标 `superseded` 并保留一行指针；不自动合并（自动合并必然要模型判断，属于"推断"，违反 `docs/spec/15-memory.md:11`） |
| 过期 | 群规则变了、模型供应商换了 | `status: expired` + `expires` 可选日期；注入时过滤 expired；`memory_status` 报"最久未更新"，像现有的 `bootstrap.staleDays`（`plugins/memory/src/config.ts`） |
| 删除 | 用户要求彻底删掉 | 物理删除文件里那一段 + `log.md` 留一行删除记录（不含正文）；`private/` 的笔记不进上下文贡献 |
| 用户查看/编辑 | 界面在哪？ | 三个入口：① `yonder` TUI 加 `memory note <entity>` 子命令（`docs/spec/13-observation-and-management.md:63-64` 的 CLI 家族）；② 卡片/渠道里给一条"备注"按钮（现有 `channel-card` 插件的投影思路）；③ 直接改 Markdown 文件（Obsidian 打开根目录即可，frontmatter 天然可读） |
| 多设备同步 | 笔记跟着谁走？ | 方案 A 天然是文件：跟着 memory 根目录同步（Obsidian/iCloud/git 都行）；方案 B 需要单独同步插件 data 目录。注意 memory 根目录要求在工作区之外（`docs/spec/15-memory.md:9`），同步冲突靠 `store.ts` 的 mtime 检测 |
| 隐私 | 群备注里可能有"这个人是老板的小号"这类信息 | 复用 `private: true`：不进上下文贡献、不进默认检索、不进 `memory_status` 摘要（`docs/spec/15-memory.md:214-218`）；`scope` 限制到具体 agent，避免所有 Bot 都能看到 |
| 跨 Bot 可见性 | 群 A 的 Bot 与群 B 的 Bot 是否共享同一份群备注？ | 默认按 `allowedAgents` 共享（memory 已经是多 agent 共用一份根目录），敏感实体用 `scope` 收窄 |
| 与事件库的关系 | 备注不是事件，会不会违反"事件是唯一事实流"（不变量 1） | 备注是**可变状态**，与 memory 文件同级；每次变更在 `log.md` 与（可选）`memory.captured` 事件里留痕，正文留在文件 |
| 设计变更审批 | 自动注入本身与 D41 冲突 | 先改 `docs/spec/15-memory.md`（新增一节"实体笔记"），在 `docs/decisions.md` 记一条，替换掉 D41 那句"不自动注入"的表述，再动代码 |

## 5. 核实状态

已实际抓取并读过正文：`code.claude.com/docs/en/memory`、`docs.letta.com/guides/agents/memory-blocks`、`/archival-memory`、`/context-hierarchy`、`docs.mem0.ai/core-concepts/memory-types`、`help.getzep.com/graphiti/getting-started/overview`、`raw.githubusercontent.com/openclaw/openclaw/main/docs/concepts/memory.md` 与 `/concepts/user-model.md`、`telegram.org/blog/comments-in-video-chats-threads-for-bots`。

未能抓取（引用时只写链接、不引述原文）：`openai.com`（403）、`help.openai.com`（403）、`core.telegram.org`（TLS 失败）、`help.obsidian.md`（页面为 JS 渲染，仅 2.7KB 空壳）、`github.com/getzep/graphiti`（TLS 失败）、`docs.openclaw.ai`（TLS 失败，改用 GitHub raw）。

Yonder 侧全部结论来自仓库内文件与行号，可直接复核；`plugins/memory` 的测试与实现细节按源码，未运行测试（只读调研）。
## 主 Agent 裁定（10-27）

- 采用方案 A：在 memory 插件里新增实体笔记区，并新增 `memory_note` 工具。
- 第二步批准：给 SDK 的 `RenderContext` 加上 `model?: {provider, id}`，这样换模型时可以注入该模型的备注。
- D41「不自动注入」被部分替代。实体备注会按上文表格的预算自动注入，日志式记忆仍然只能手工读取。这一条写进 decisions。
- 实施归 A 线，排在 agent-parity P4 会话工具之后。实现按 §3.5 执行，不另写设计文档。
