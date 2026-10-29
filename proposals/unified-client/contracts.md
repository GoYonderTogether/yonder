# Unified Client A/B 接口契约 v1（冻结稿）

> 状态：提案，待维护者批准。v1.1 增补 §11–§17，protocol 仍为 1（兼容已有传输，统一未实现的提案形状）。冻结 A 线（内核）与 B 线（control 注册表、`packages/gateway`、`apps/app`、macOS 壳）之间的接口。本文不改 `docs/spec/`；落地为 spec 19 时再走设计变更。
> 标记：【已有】代码里存在。【新增·A】内核线实现。【新增·B】应用线实现。【未核实】没读到源码，开工第一步先核。
> 输入：`design.md` §4.1/§4.8/§11，`agent-parity.md` §8，`research/C1-clients.md`，`credentials.md` §6，`packages/cli/src/index.ts:724-841`，`packages/core/src/control/index.ts`，`packages/sdk/src/types.ts`。
> 局限：`design.md` 的 §11 阶段 1 只读到「8 个读/提交方法 + `capabilities.get`」，没找到那 8 个的逐条清单。下面按 §4.1 与 C1 缺口推定（见 §1.3），请 B 线对一下。

## 0. 总则

1. TypeBox 是唯一源，本文的 TS interface 等同于 `Static<typeof Schema>`。`@yonder/protocol` 只导出 schema 与类型，前端 `import type`。
2. 一元调用走 `POST /api/rpc/<method>`，流式调用走 `GET /api/stream`（WS，单连接多路复用）。本机 control socket 继续存在，同一份注册表，CLI 行为不变。
3. 事件只追加、不改写，客户端必须容忍重复和乱序到达的未知类型（§5）。
4. 凭据值、对话正文不得出现在 `usage.updated`、`context.updated`、`compaction.*`、审批事件里（`agent-parity.md` P8、`credentials.md` §6）。

## 1. 方法注册表

### 1.1 MethodDef

```ts
import type { TSchema } from "@sinclair/typebox";

type Scope = "read" | "write" | "admin" | "owner";

interface MethodDef<P extends TSchema = TSchema, R extends TSchema = TSchema> {
  name: string;               // 见 §1.2 命名规则
  scope: Scope;               // 网关与 socket 都强制校验；隐藏不是授权
  params: P;
  result: R;                  // 流式方法：ready 帧里的 result
  stream?: StreamDef;         // 有则为流式方法，只能经 WS（socket 上沿用旧 update 行）
  local?: true;               // 永不远程（凭据、stop、service.*）
  transport?: "json" | "http-binary"; // 默认 json；attachments.put 为 http-binary
  since: number;              // 引入时的协议版本（§6）
  deprecated?: { since: number; use: string };
  handler(params: Static<P>, ctx: HostCtx, signal: AbortSignal): Promise<Static<R>>;
}

interface StreamDef {
  event: TSchema;             // ev 帧 data 的联合类型
  resumable: boolean;         // 是否支持 after 游标（§2.3）
}

// 宿主服务注入，替代 cli 层闭包（index.ts:703-720 的 startAwake/releaseInfo/stop）
interface HostCtx { kernel: Kernel; home: string; principal: Principal; releaseInfo(): Promise<ReleaseInfo>; stop(): void }
```

注册表位置：`packages/core/src/control/methods.ts`【新增·B】。`serveControl` 的 handler 改为查表分发。未迁移的方法保留在 cli switch，新旧并存一个版本（`design.md` §4.1）。

### 1.2 命名规则

- 现有方法保持原名，一律不改。
- 新方法：`<域>.<对象>[.<动作>]`，小写点分，域沿用现有（`sessions`、`events`、`channels`、`identity`），新域包括 `capabilities`、`models`、`agents`、`attachments`、`activity`、`views`、`approvals`；本次增补 `workspaces`、`notifications`、`suggestions`、`update`（§13/§16/§17）。
- 读：`list`、`get`、`show`。写：动词（`open`、`submit`、`abort`）。流式：以 `.watch` 结尾，且 `stream` 必填。
- 现有 `terminal.*` 是 CLI 终端的内部口径，B 线不依赖，只依赖 `sessions.*`、`activity.*`。
- 默认 scope：纯读 `read`；对会话的提交、中止、选模型 `write`；插件、渠道登录、`stop`、`management` 为 `admin`。远程不含 `admin`；Bot 会话另需独立的 `owner`，`approvals.answer` 需 `owner`（§14）。

### 1.3 方法清单

公共类型：

```ts
type Mode = "main" | "persistent" | "task" | string;           // 沿用 SDK Mode【已有】
type SessionInfo = import("@yonder/sdk").SessionInfo;          // sdk types.ts:176-190【已有】
type TranscriptItem = import("@yonder/sdk").TranscriptItem;    // sdk types.ts【已有】
type Attachment = import("@yonder/sdk").Attachment;            // {kind,mime,uri,name?,bytes?}【已有】
type Ok = { ok: true };
```

#### 阶段 1（B 线首批，推定的 8 个加 `capabilities.get`）

| 方法 | scope | params | result | 状态 |
|---|---|---|---|---|
| `capabilities.get` | read | `{}` | `NodeFacts`（§4） | 新增·B（从注册表与插件加载器导出） |
| `sessions.list` | read | `{ filter?: { agent?: string; mode?: Mode; open?: boolean } }` | `SessionInfo[]` | 已有（`index.ts:806`） |
| `sessions.show` | read | `{ id: string; limit?: number; before?: string; full?: boolean }` | `{ session: SessionInfo; items: TranscriptItem[]; nextBefore?: string }` | v1.1 目标见 §17；既有 include/transcript 兼容待定，见 §5 |
| `sessions.transcript` | read | `{ id: string; before?: number; limit?: number }` | `{ items: TranscriptItem[]; hasMore: boolean }` | 新增·A（`kernel.sessions.transcript` 已有，`from/limit` 语义；`before` 倒序翻页要补）【已有底层】 |
| `sessions.trace` | read | `{ id: string; after?: string }` | `{ events: YEvent[]; next?: string }` | 只读账本扫描；每页扫描 100 条，过滤后空页仍可有 next。仅返回明确关联本会话的事件；unknown 通过 attempt 的 session 关联；沿用会话可见权限。 |
| `sessions.watch` | read | `{ id: string }`（续传 after 在 sub 帧上） | `SessionSnapshot`（新快照；成功续传沿用 `null`）；cursor 在 ready 帧上 | 既有传输见 §9.2；增补事件见 §15 |
| `sessions.submit` | write | `{ id: string; requestId?: string; text: string; attachments?: Attachment[]; busy?: "followup"\|"steer"\|"interrupt" }` | `InputReceipt`（`{ event, session, deduped?: boolean }`） | 已有但要改：加 `requestId` 幂等（C1 缺口②） |
| `sessions.abort` | write | `{ id }` | `Ok` | 已有 |
| `activity.summary` | read | `{ since?: string }`（ISO 时间） | `ActivitySummary` | 过滤与可见性见 §14/§17 |
| `activity.watch` | read | `{}` | `ActivitySummary`；cursor 在 ready 帧上 | 易失型，见 §2.3；节点事件见 §15 |

```ts
interface SessionSnapshot {          // sessions.watch ready.result，对 SessionUpdate{type:"snapshot"} 的结构化
  session: SessionInfo;
  info: TerminalInfo;                // 沿用 terminal.info 的结果【已有】
  transcript?: { items: TranscriptItem[]; hasMore: boolean }; // 最近一页，窗口大小由服务端定（默认 50）
  model?: ModelStatus;               // 见 §3.3/§17，无数据源则省略
  usage?: UsageSnapshot;
  context?: ContextSnapshot;
}
interface ActivitySummary {
  running: number; waiting: number;  // 「在跑」「等你回答」：图标栏、托盘、悬浮窗同一个数
  suggestions?: number;
  sessions: { id: string; state: "running"|"waiting"|"idle"|"error"; since: string }[];
}
interface InputReceipt { event: string; session: string; deduped?: boolean }
```

`requestId` 规则：同一 `(session, requestId)` 在 10 分钟内重复提交，返回第一次的 `InputReceipt` 且 `deduped:true`，不入队。既有实现存于进程内存，重启失效（§9.3）；本卡不新增存储机制。

#### 阶段 2（选模型、新建、附件、审批、views）

| 方法 | scope | params | result | 状态 |
|---|---|---|---|---|
| `sessions.open` | write | §13 扩参（preset/agent、model、workspace/cwd、title/prompt、close/parent、requestId） | `{ session: SessionInfo; model?: ModelStatus; deduped?: boolean }` | §13 为目标；既有返回 SessionInfo 的兼容待定，见 §5 |
| `sessions.fork` | write | `{ id: string, at: integer }` | `SessionInfo` | 独立 task 在可见节点之后创建分叉；已执行的副作用不回滚 |
| `sessions.tree` | read | `{ id: string }` | `{ id: string, parent?: string, at?: integer }[]` | 同一独立 task 分叉族；不包含转录正文 |
| `sessions.close` | write | `{ id }` | `Ok` | 已有 |
| `sessions.command` | write | `{ id; command: string }` | `string` | 已有；文本命令保留作兼容，UI 不再拼 `/model` |
| `sessions.model.set` | write | `{ id: string; model: ModelRef }` | `{ model: ModelStatus }` | 新增·A（结构化替代 `/model`） |
| `models.list` | read | `{ provider?: string }` | `{ providers: { id; models: { id; name; contextWindow: number; reasoning: boolean }[] }[] }` | 新增·A（现只能从 `terminal.info` 或 `/model list` 文本抠） |
| `agents.list` | read | `{}` | `{ agents: { id; name; profile; presets: string[] }[] }` | 新增·A |
| `attachments.put` | write | `POST /api/attachments` 原始字节，`Content-Type`、`X-Name`、`X-Session` | `AttachmentRef`（§17） | HTTP 别名；校验会话归属，socket 不提供 |
| `approvals.list` | read | `{ state?: "pending"\|"all" }` | `{ items: ApprovalCard[] }` | 新增·A（secrets 插件经 views/事件库读出；`credentials.md` §6.2） |
| `approvals.answer` | owner | `{ approvalId: string; decision: "approve"\|"deny" }` | `{ state: "answered"; by: string; first: boolean }` | 新增·A；同一 `approvalId` 只生效一次，重复回答 `first:false` |
| `views.list` | read | `{ placement?: Placement; session?: string }` | `{ views: ViewDecl[] }` | §11，placement 为 rail/floating/page |
| `views.watch` | read | `{ placement?: Placement; session?: string }` | 同 `views.list`，流式 | §11，易失型 |
| `views.act` | ViewDecl.actScope（默认 write，不低于 write） | `{ viewId: string; action: string; input?: unknown; session?: string }` | `{ content?: ViewContent }` | §11/§14 |
| `events.query` | read | `EventQuery`（sdk `types.ts`：`id,type,from,conv,agent,since,until,after,limit`） | `EventPage` | 已有 |

#### 已有、保持原名、暂不进 B 线前端

`terminal.templates`（read，`{ id?: string, preset?: string }` → 模板名称与说明，按会话或草稿预设过滤）、`awake.status`（read）、`channels.list`（read）、`channels.login`（admin，用 `connection.signal` 取消）、`release.result`、`sessions.notify`（write）、`management`（admin）、`terminal.sessions/presets/channels/queued/dequeue/info`、`service.info`（read，`local:true`）、`identity.lookup/link/unlink/person`、`stop`（admin，`local:true`）。迁入注册表时 scope 沿用上述标注，行为不变。

## 2. 流帧协议

### 2.1 传输

WS 路径 `GET /api/stream`，文本帧，每帧一个 JSON。单页单连接，多路复用，每路用客户端生成的 `sub`（字符串，连接内唯一）。本机 socket 的旧形状 `{type:"update", session, update}`（`index.ts:796`、`control/index.ts:140` 的 `observeControl`）原样保留，网关负责在 WS 侧把它转为 `ev` 帧。

### 2.2 帧类型

```ts
type Cursor = string;                 // 不透明；客户端只存、只回传，不解析

// 客户端 → 服务端
type ClientFrame =
  | { t: "sub";   sub: string; method: string; params: unknown; after?: Cursor }
  | { t: "unsub"; sub: string }
  | { t: "ping";  n?: number };

// 服务端 → 客户端
type ServerFrame =
  | { t: "ready"; sub: string; gap: boolean; cursor: Cursor; result: unknown }
  | { t: "ev";    sub: string; seq: number; cursor: Cursor; type: string; ts: string; data: unknown }
  | { t: "end";   sub: string; reason: "closed" | "unsub" | "error" | "forbidden" | "shutdown"; error?: string }
  | { t: "pong";  n?: number };
```

`ready.result` 就是该方法的 `result`（如 `SessionSnapshot`）。`method` 必须是 `stream` 非空的方法，否则 `end{reason:"error"}`。`scope` 在 `sub` 时校验，不足则 `end{reason:"forbidden"}`。

### 2.3 游标与 gap 语义

1. `seq`：每个 `sub` 内单调递增，从 1 起；重订后的补发也从 1 起编号。`cursor` 沿用 §9.2 的既有环形缓冲游标，不使用事件库水位。
2. 首次订阅不带 `after`：`result` 含当前快照。加载快照期间有事件到达则 `gap:true`，这些事件仍在 ready 后投递；客户端需容忍与快照重复（§9.2）。
3. 续传带 `after`：同 epoch 且仍在缓冲内则补发，`ready.result=null`；否则 `gap:true` 并取全新快照。客户端丢弃旧增量缓存，以新快照重建。
4. 客户端在同次订阅内按 `(sub, seq)` 去重；事件 id 存在时也按 id 去重。重订不能拿上一订阅的 seq 判断新事件。
5. 缓冲保留、上限与重启后的 gap 沿用 §9.2，不承诺环形缓冲之外的续传。
6. `activity.watch`、`views.watch` 是易失型（`resumable:false`）：不接受 `after`，每次订阅 `gap:true` 且 `result` 带完整当前状态。事件只用于增量刷新。
7. `sessions.watch` 是可续型（`resumable:true`）。

### 2.4 心跳与背压

- 客户端每 25 秒 `ping`，服务端回 `pong`；60 秒无任何帧，任一端关闭连接。
- 服务端对慢消费者：积压超过 1000 帧或 10 MB，发 `end{reason:"error", error:"slow-consumer"}` 并关闭该 `sub`，客户端用 `after` 重订。不静默丢帧。
- 同一连接最多 64 路 `sub`。

### 2.5 错误

一元调用：成功 HTTP 200 `{ok:true,result}`；权限不足 HTTP 403 `{ok:false,error:{code:"forbidden"}}`（§14），其他方法错误 HTTP 200 `{ok:false,error:{code,message}}`，沿用 control 的 `ok/result/error` 形状（`control/index.ts` 的 `{ok:true,result}`、`{ok:false,error}`）。错误码字符串：`unknown_method`、`forbidden`、`invalid_params`、`not_found`、`conflict`、`unavailable`。现有 handler 抛出的纯字符串错误统一映射为 `{code:"error"}`，不得依赖文案。

## 3. 事件目录

约定：`ev.type` 为下表第一列；`data` 形状见下；`session` 字段缺省时表示节点级。所有 `data` 都不含对话正文（`transcript.*` 除外，它就是正文，但只经 `sessions.watch`，不进 `activity.watch`）。【新增】列的字母是实现方，但事件的订阅路由在 B 线。

### 3.1 总表

| type | 订阅于 | 发出方（A 线模块） | B 线消费方 | 状态 |
|---|---|---|---|---|
| `session.update` | `sessions.watch` | `packages/core/src/kernel/terminal.ts` observe（`SessionUpdate`） | 中栏转录、输入框忙闲 | 已有（旧形状原样包装） |
| `session.opened` / `session.closed` | `activity.watch` | `kernel.sessions`（`session.open`/`session.close` 事件，`sdk/types.ts` `SessionOpenData/SessionCloseData`） | 左栏会话列表 | 已有（事件库）；流上投递·新增·B |
| `session.settled` | `activity.watch` | `kernel`（会话空闲或完成）；`design.md` §1.2 称存在性【未核实】 | Bot 建议、托盘 | 新增·A |
| `run.ended` | `sessions.watch` | `run.end` 事件（`RunEndData`） | 顶部状态、用量落账 | 已有（事件库），流上投递·新增·B |
| `transcript.item` | `sessions.watch` | terminal observe 的 `message`/`tool` | 中栏转录 | 已有（等价于 `session.update`，新结构化形态见 3.2） |
| `usage.updated` | `sessions.watch` | `packages/pi-durable/src/harness/usage.ts` 累计后由 `packages/core/src/runtime/index.ts` 转发 | 底栏第 1 段 | 新增·A |
| `context.updated` | `sessions.watch` | `runtime/index.ts` `modelStatus`（`contextTokens`、`contextWindow`） | 底栏上下文占比 | 新增·A |
| `compaction.started` / `compaction.finished` | `sessions.watch` | `packages/pi-durable/src/harness/compaction.ts` | 底栏提示、时间线 | 新增·A |
| `model.changed` | `sessions.watch` | `runtime/index.ts` `modelStatus` 变化 | 底栏右段 | 新增·A |
| `model.fallback` | `sessions.watch` | `packages/core/src/runtime/model-chain.ts` | 底栏黄标、时间线 | 新增·A |
| `todo.updated` | `sessions.watch` | `plugins/tasks` 或 todo 插件，经 `ctx.invalidate()` | 右栏 todo 树 | 新增·A（形态见 3.4） |
| `subtask.updated` | `sessions.watch` | `modelStatus.tasks[]`、`task_run` 句柄 | 编辑区下方委派列表 | 新增·A |
| `background.updated` | `sessions.watch` | `process` 工具句柄表 | 右栏后台任务 dock | 新增·A |
| `approval.requested` / `approval.answered` | `activity.watch` | secrets 插件（原事件 `secrets.approval.requested/answered`） | 右栏「等你回答」、审批记录、托盘计数 | 新增·A |
| `views.changed` | `views.watch` | 插件 `ctx.invalidate()` | 右栏、悬浮窗 | 新增·A |
| `notification` | `activity.watch` | `sessions.notify` 与 `SessionNotification` | 通知中心、托盘 | 已有（`SessionNotification`）；节点级投递·新增·B |
| `social.policy-change` | —（只进事件库，未上流） | `packages/core/src/kernel/social.ts` `options.record`（`from: plugin:social`） | 暂无（审计事实） | 已有（CH-06r3，形状见 §15.3） |
| `capabilities.changed` | `activity.watch` | 插件重载（`config.reload` 事件，`ConfigReloadData`） | 前端重拉 `capabilities.get` | 新增·B |

### 3.2 会话生命周期与 transcript

```ts
type SessionUpdateEv = { type: "session.update"; data: import("@yonder/sdk").SessionUpdate };
// 已有，不重塑。B 线用 SessionUpdate.type 分派：snapshot|message|tool|state|error|end|inbox|notification

interface SessionLifecycleEv { session: string; mode: Mode; profile: string; reason?: string } // opened/closed
interface RunEndedEv {
  session: string; runId?: string;
  status: "done" | "error" | "aborted" | "limit";
  model: string; thinking?: string;
  usage: { input: number; output: number; cacheRead: number; cacheWrite: number; cost: number }; // 同 RunEndData.usage
}
```

`transcript.item` 与 `session.update{message|tool}` 在 v1 里是同一信息的两种投影。v1 只发 `session.update`，B 线只消费它。`transcript.item` 保留名字，留给 v2 在分页读与流上共用同一形状。

### 3.3 usage、context、compaction、model

```ts
interface UsageTotals { input: number; output: number; cacheRead: number; cacheWrite: number; cost: number }
interface UsageUpdatedEv {
  session: string;
  scope: "self" | "children";            // 子 Agent 汇总单独一条，仅 token>0 时前端显示
  totals: UsageTotals;                   // 会话累计
  last?: UsageTotals & { cacheHitPct: number }; // 最近一条助手消息；cacheHitPct = cacheRead/(input+cacheRead+cacheWrite)
}
interface ContextUpdatedEv {
  session: string;
  tokens: number; window: number; percent: number; // 0-100
  auto: boolean;                                    // 压缩策略 enabled
}
interface CompactionEv {                            // started / finished
  session: string;
  kind: "auto" | "manual" | "background";
  before: number; after?: number;                   // tokens；started 无 after
  ms?: number; ok?: boolean;                        // finished
}
interface ModelRef { provider: string; model: string; thinking?: string }
interface ModelStatus extends ModelRef { contextWindow?: number; routedTo?: ModelRef } // routedTo：路由命中时的实际模型
interface ModelChangedEv { session: string; from?: ModelRef; to: ModelStatus; cause: "user" | "route" | "fallback" | "recover" }
interface ModelFallbackEv {
  session: string;
  inputs?: string[];                                 // 实际运行输入事件 ID；旧事件可缺省
  state: "fallback" | "recovered";
  from: ModelRef; to: ModelRef;
  reason: "rate_limit" | "quota" | "unavailable" | "error";  // §17 固定枚举；超时归 unavailable
}
type UsageSnapshot = { self: UsageTotals; children?: UsageTotals; last?: UsageTotals & { cacheHitPct: number }; lsp?: { name: string; state: string } };
type ContextSnapshot = { tokens: number; window: number; percent: number; auto: boolean; parts?: { name: string; tokens: number }[] };
```

阈值颜色（>70% 警告、>90% 错误）由前端定，事件不带。`model.fallback.state:"fallback"` 表示已切到备用，`"recovered"` 表示已回到首选；同一次回退至少各发一次，中间不重复。`model.changed` 与 `model.fallback` 同时发生时顺序固定：先 `model.fallback`，后 `model.changed{cause:"fallback"}`（恢复时为 `cause:"recover"`）。

### 3.4 todo、子任务、后台任务

```ts
interface TodoItem { id: string; text: string; state: "todo" | "doing" | "done" | "cancelled"; parent?: string; order: number }
interface TodoUpdatedEv { session: string; done: number; total: number; items: TodoItem[] } // 全量替换，前端只展示前 10，余者 +N more

interface SubtaskRow {
  id: string; session: string;                // 子会话 id
  label: string; state: "running" | "waiting" | "done" | "error" | "aborted";
  startedAt: string; lastOutputAt?: string;   // 前端用 lastOutputAt 判断 120s 无活动告警，不另设事件
}
interface SubtaskUpdatedEv { session: string; rows: SubtaskRow[] }   // 全量替换，服务端 500ms 合并

interface BackgroundRow { id: string; label: string; state: "running" | "exited"; exitCode?: number; startedAt: string }
interface BackgroundUpdatedEv { session: string; rows: BackgroundRow[] }
```

三者都用「全量替换」语义，不做 diff，因此丢帧后以任何一条最新事件或快照为准，对 `gap` 天然健壮。todo 的数据源是 `plugins/tasks` 账本还是独立 todo 插件，由 A 线在 `agent-parity.md` 的 rpiv-todo 评估后定；事件形状不变。

**落库与事件的原子性（`model.fallback`、`todo.updated`）。** pi-durable 的 `commit` 只覆盖它自己的文档，事件库是另一套写入，两者不能放进同一事务。因此采用「同一持久步骤写欠条，事后投递」：状态变更（todo 列表、回退状态）与待发事件的 JSON 在同一次 `commit` 里写入 `yonder.session` 文档的 `outbox`；之后调用 `onTodo` / `onModelFallback`（写事件库并推给 `sessions.watch` 订阅者），投递完成再提交移除这几条。进程在两步之间崩溃时，`Runtime.recover()` 启动时对每个会话重发遗留的 `outbox`。语义是至少一次：崩溃发生在「已投递、未移除」之间会重复一条；两种 payload 都是全量/状态替换（见上），重复无害，客户端仍按事件 id 或最新一条为准。重启后重发的事件没有在线订阅者，只进事件库。

### 3.5 审批（`credentials.md` §6）

```ts
interface ApprovalCard {
  approvalId: string;
  level: "L2";                               // L3 直接 block，不出卡
  library: string; ref: string; field?: string;   // 只引用 ref，永不含值
  sink: string; reason?: string;             // 一句话，显示在卡片上
  session?: string; requestedAt: string; expiresAt: string;
  state: "pending" | "approved" | "denied" | "timeout";
  answeredBy?: string;                       // "app" | 渠道名 | "auditor"
}
type ApprovalRequestedEv = { card: ApprovalCard };
type ApprovalAnsweredEv  = { approvalId: string; state: "approved" | "denied" | "timeout"; answeredBy: string; first: boolean };
```

对应事件库中的 `secrets.approval.requested/answered`（`credentials.md` §3 末），网关把它们更名为 `approval.*` 投递，对插件内部事件名不做改动。回答幂等按 `approvalId`，任一处先答先生效，其余处卡片刷成「已由 X 回答」。同步等待最长 120 秒，超时返回 `pending` 并经绑定续跑（`credentials.md` 复核 2），事件不变，仍是 `approval.answered{state:"timeout"|…}`。

### 3.6 views、通知

```ts
interface ViewsChangedEv { placement: "rail" | "floating" | "page"; ids: string[]; badge?: Record<string, number> }
interface NotificationEv { id: number; from: string; event: string; text: string; session?: string; conv?: string; channel?: string } // SessionNotification 的扩展（§16）
interface CapabilitiesChangedEv { reason: "plugin-reload" | "config-reload" }
```

`views.changed` 只提示哪些 view 变了，前端重取 `views.list` 与受影响的 `views.data`（§11）；`badge` 与 `activity.summary` 的计数使用同一源，三个表面显示同一个数。

## 4. capabilities.get：NodeFacts

以下为基础字段；v1.1 合并 §12 的 NodeFactsAddendum。features/limits 按字段扩展，保留已有成员；kind 与 auth.kind 同源。

```ts
interface NodeFacts {
  protocol: number;                                   // 本文版本号，见 §6；低于应用要求则 feature 返回 disabled「节点版本较旧」
  kind: "local" | "remote";
  version: { yonder: string; commit: string | null }; // 来自 service.info 的 releaseInfo
  methods: Record<string, { scope: Scope; stream?: true; local?: true; since: number }>; // 注册表导出
  events: string[];                                   // 本节点会发的事件 type 列表，前端据此决定是否显示 footer 各段
  plugins: { id: string; version: string; views: string[]; tools?: string[] }[];
  granted: Scope[];                                   // 本次连接被授予的 scope
  limits: { maxSubs: number; attachmentMaxBytes: number; transcriptPage: number };
  features: { requestIdDedupe: boolean; resumableWatch: boolean }; // 事实，不是 UI 功能
}
```

规则：只报事实，不报「显示什么」。`methods` 与 `plugins` 直接从注册表与插件加载器导出，不另存。前端用 `needs.methods` 判断，不依赖插件名（`design.md` §1.3）。连接建立拉取一次；收到 `capabilities.changed` 后重拉。`local:true` 方法在远程连接的 `methods` 里不出现。

## 5. 版本与兼容

1. 协议版本号是整数 `protocol`，本文为 `1`。放在 `capabilities.get`、HTTP 响应头 `X-Yonder-Protocol`、WS 握手 query `?v=`。
2. 同一主版本内只增不删：新增方法、新增可选参数、新增结果字段、新增事件类型、新增枚举值都允许。删除、改名、改类型、收紧必填一律需要升 `protocol`，旧语义保留至少一个发布版本，并在 `MethodDef.deprecated` 里标明。
3. 客户端必须：忽略未知 `ev.type`、未知字段、未知枚举值（按「其他」显示，不报错）；`seq` 不连续不报错。
4. 服务端必须：忽略未知请求字段（不当作错误）；缺省的可选参数取旧行为。
5. 客户端按 §12 依次检查 `NodeFacts.protocol >= APP_MIN_PROTOCOL`、methods、features、events，不以插件名推断。
6. §13/§17 固定 sessions.open/show 的目标形状；基线已实现 open 返回 SessionInfo、show 返回 transcript 或 include:"meta" 形态（§9.2），不是未实现提案。两者与目标结果存在兼容差异，过渡方式待主 Agent 定稿，不能按本卡直接删除既有返回字段或宣称兼容已验证；protocol 本卡仍为 1。
7. 协议文档的权威位置：spec 19 初稿与 `@yonder/protocol` 的 schema；本文冻结期间有冲突以本文为准，需改时先改本文并在 `docs/decisions.md` 记一条（`AGENTS.md` 第 7 条）。

## 6. 实现归属汇总

| 项 | 实现方 | 备注 |
|---|---|---|
| `packages/core/src/control/methods.ts` 注册表与 `MethodDef` | API | 唯一大重构，CLI 行为不变 |
| `packages/gateway`（HTTP/WS、鉴权、游标编码、背压、`attachments.put`） | API | 沿用 §9.2 的缓冲游标 |
| `capabilities.get`、`activity.*`、`capabilities.changed` | B | 数据来自注册表与现有 `terminal.activity()` |
| `sessions.transcript` 的 `before` 倒序分页、`sessions.watch` 的 `after/seq`、`submit.requestId` | A | 内核 `sessions` / `kernel/terminal.ts` |
| `sessions.model.set`、`models.list`、`agents.list`、`open` 的 `agent/model` | API + CORE | API 注册方法，CORE 提供会话/运行能力（§17） |
| `usage.updated`、`context.updated`、`compaction.*`、`model.changed`、`model.fallback` | A | pi-durable + `runtime/index.ts` + `model-chain.ts` |
| `todo.updated`、`subtask.updated`、`background.updated`、`session.settled` | A | tasks / process / kernel |
| `approval.*`、`approvals.list/answer` | CORE（生产者）+ API（方法/映射） | 接线待定，见 §17 |
| `views.*`、`views.changed` | CORE（SDK 槽）+ API（方法/数据层）+ FE（渲染） | §11/§17 |
| `apps/app/src/api` 数据层与流缓存 | API | §17；其余呈现归 FE |

## 7. A 线未完成时 B 线的临时替代

原则：B 线按本文的最终形状写客户端，在 `transport/` 里用适配层把旧接口翻译成目标形状。不写模拟数据（`AGENTS.md` 第 4 条），替代方案都走真实节点。

| 缺的能力 | B 线临时做法 | 退出条件 |
|---|---|---|
| `sessions.watch` 无 `after/seq` | 网关给每路 `sub` 本地编号 `seq`；总是 `ready.gap=true`，每次重订都取 `sessions.show` 对账 | A 交付游标 |
| `submit` 无 `requestId` | 网关在内存按 `(session, requestId)` 做 10 分钟去重，不透传给内核 | A 交付；去重迁到内核 |
| `sessions.transcript` 无 `before` | 用 SDK 已有 `transcript(id,{from,limit})` 取尾页（先读总数再算 `from`），仍用 `sessions.show` 兜底 | A 交付倒序分页 |
| `sessions.show` 含整份 transcript | 既有形状见 §9.2；目标分页形状见 §17，兼容方式待定（§5） | 主 Agent 定稿后 API-09 落地 |
| `usage.updated` | 用 `run.end` 事件（`RunEndData.usage`）每次运行结束累加；运行中不显示实时值 | A 交付 |
| `context.updated`、`model.changed` | 轮询 `terminal.info`（含 `model`）每 3 秒；上下文占比暂不显示 | A 交付 |
| `compaction.*` | 不显示；时间线暂缺压缩条目 | A 交付 |
| `model.fallback` | 不显示；`run.end.model` 与会话选择的模型不一致时前端自行标黄 | A 交付 |
| `models.list`、`sessions.model.set` | 模型选择器只读：显示 `terminal.info` 的当前模型；切换通过 `sessions.command` 发 `/model …` 文本（兼容路径） | A 交付 |
| `sessions.open` 缺 `agent/model` | 只用 `preset` | A 交付 |
| `todo.updated` / `subtask.updated` / `background.updated` | 右栏用 `activity.summary` 的 sessions 列表与 `terminal.queued` 代替；不显示 todo 树 | A 交付 |
| `approval.*` | 审批只走渠道卡片（`credentials.md` S1–S5 期间的现状）；apps/app 轮询 `events.query {type:"secrets.approval.requested"}` 每 5 秒，显示只读列表 | A 交付 `approvals.*` |
| `views.*` | 右栏不渲染 views；阶段 1 范围本就不含 | 阶段 4 |
| `notification` 节点级流 | 订阅 `sessions.watch` 内的 `session.update{type:"notification"}`，只覆盖已订阅会话 | B 交付 `activity.watch` |
| `activity.watch` | 轮询 `service.info.agents`（`index.ts:759-770` 同源）每 2 秒 | B 自己交付 |

## 8. 未决项（交维护者）

1. `design.md` §11 阶段 1 的 8 个方法逐条清单与 §1.3 推定是否一致。
2. 游标使用既有环形缓冲（§9.2），事件库水位方案未采用；本次扩展沿用现有 seq/cursor。
3. `model.fallback.reason` 已按 §17 固定，生产者由 CORE 对齐，API 不发明新枚举。
4. todo 数据源（tasks 账本还是独立插件）：影响 `TodoItem.state` 取值，不影响事件名。
5. 审批专用方法与 views 共用状态，外部形状按 §17；kernel/插件接线仍待定（Q03），不假设服务已存在。

## 9. 网关线实现说明（新增）

本节记录 gateway 线（`lane/gateway-20261027`）已落地的基线形状，供 B 线对接；§11–§17 是后续目标，不代表本卡已实现；标「新增」的条目是前文没有的方法或约定，需维护者确认。

### 9.1 新增方法：导入 pi 会话（只读）

| 方法 | scope | params | result | 状态 |
|---|---|---|---|---|
| `imports.list` | read | `{ cwd?: string; limit?: number }`（默认 200，最大 5000） | `{ dir: string; total: number; sessions: ImportSummary[] }`，按修改时间倒序 | 新增 |
| `imports.show` | read | `{ id: string; offset?: number; limit?: number }`（默认 500） | `ImportShow` | 新增 |

目录默认 `~/.pi/agent/sessions`，递归读取 `**/*.jsonl`；`yonder.yaml` 的 `imports.piSessionsDir` 可改（支持 `~`，相对路径按 home 解析）。`id` 是目录内的相对路径；越出目录或不存在返回 `not_found`。只读，不写 pi 文件。

```ts
interface ImportSummary { id: string; sessionId?: string; cwd?: string; started?: string; modified: string;
  bytes: number; messages: number; title: string; model?: string }
type ImportItem = { id: string; ts?: string } & (
  | { kind: "user"; text: string }
  | { kind: "assistant"; text: string; model?: string; stopReason?: string }
  | { kind: "thinking"; text: string }
  | { kind: "tool_call"; callId: string; name: string; args: unknown }
  | { kind: "tool_result"; callId: string; name?: string; text: string; isError?: boolean }
  | { kind: "compaction"; summary: string; tokensBefore?: number }
  | { kind: "system"; text: string }
  | { kind: "event"; event: string; text?: string; data?: unknown }   // model_change、thinking_level_change、custom 等
  | { kind: "unknown"; type: string; raw: unknown });                  // 未知条目原样带出，不报错
interface ImportShow {
  summary: ImportSummary; total: number; offset: number; hasMore: boolean; items: ImportItem[];
  todo: ImportTodo | null;          // 最后一次 todo 工具结果（details.tasks）的快照；无 todo 调用为 null
  usage: { totals: UsageTotals; assistantMessages: number; byModel: Record<string, UsageTotals & { messages: number }> };
  issues: { line: number; message: string }[];   // 无法解析的行
}
interface UsageTotals { input: number; output: number; cacheRead: number; cacheWrite: number; cost: number }
interface ImportTodo { items: { id: string; text: string; state: "todo"|"doing"|"done"|"cancelled"; order: number;
  description?: string; activeForm?: string; blockedBy?: string[] }[]; done: number; total: number;
  source: { entry: string; ts?: string } }
```

pi 的 todo 是平铺列表加 `blockedBy`，没有父子字段；「树」由前端按 `blockedBy` 呈现。`deleted` 映射为 `cancelled`，不计入 `total`。

### 9.2 已实现的流与游标（新增）

- `sessions.watch`：`ev.type = "session.update"`，`data` 为原 `SessionUpdate`（与 control.sock 的 `update` 字段相同）。`ready.result = { session, info, transcript }`；§1.3 `SessionSnapshot` 里的 `model/usage/context` 暂未给出（A 线事件落地后补）。
- `activity.watch`：`ev.type = "activity.summary"`，`data` 为 `ActivitySummary`（`sessions[].since` 暂未给出）；易失型，每次 `gap:true`。
- 游标：`<epoch>:<n>`，epoch 为网关进程内随机值，n 为该会话共享环形缓冲（2000 条，最后一个订阅退出后保留 5 分钟）中的序号。缓冲同时按条数（2000）和字节（8 MiB）限界，先超者丢最旧。`after` 同 epoch 且仍在缓冲内则补发，否则 `gap:true` 加全新快照。网关重启必然 `gap:true`。§2.3 第 5 条的事件库水位映射未采用。
- 快照与游标的原子性：`ready.cursor` 在取快照前确定，快照本身不带修订号或水位，无法按序号裁剪。因此首次订阅（含无法续传的重订）若在加载快照期间已有事件到达，`ready.gap=true`（客户端以快照为准对账），这些事件仍在 `ready` 之后投递（可能与快照重复，客户端须容忍重复）。加载期间的事件队列上限 1000 条；溢出则丢弃队列、`gap=true`，并尽量从环形缓冲按 `cursor` 之后补发。
- 全局限额：同时最多 32 个 WebSocket（超出 503）、64 个共享 feed（超出订阅得 `end{error:{code:"unavailable"}}`）；订阅尚在启动时 `unsub` 或断线，feed 不留泄漏。
- `seq` 每个 `sub` 从 1 起；补发的事件也从 1 起编号。

### 9.3 网关 HTTP 与鉴权（新增）

- 配置 `gateway: { enabled?: boolean; port?: number; publicOrigins?: string[]; basePath?: string; accessTokenHash?: string; trustProxy?: boolean }`。默认端口 7690，占用时递增；只监听 127.0.0.1。`yonder start --no-gateway` 不启动网关。
- `<home>/.yonder/gateway.json`（0600）：`{ port, pid, token, basePath }`，`token` 是一次性启动票据。`yonder ui` 经本机 socket 的 `gateway.ticket`（admin，`local:true`，不经网关）另取一次性票据，打印 `http://127.0.0.1:<port>/?token=<ticket>`（回环地址同时在 `/` 与 `<basePath>` 下提供页面和 API）。
- URL 只接受一次性票据：`GET <任意页面>?token=<ticket>` 换 cookie 后 303 到干净地址；URL 里的长期访问令牌一律不认（会进代理日志）。长期访问令牌只能用 `POST /login`（请求体 JSON `{token}`，登录页表单同样走请求体）换 cookie；`GET /login` 是登录页；`POST /api/logout` 清 cookie。
- 登录失败按对端限流（每分钟 10 次，最多记 1024 个对端）：对端是 socket 远端地址；仅当配置 `gateway.trustProxy: true` 且连接来自回环时取 `X-Forwarded-For` 第一跳（默认 false，防伪造）。回环连接携带有效一次性票据时不受限流，本机恢复始终可用。
- 已建立的 WebSocket 随凭据失效：连接记录登录身份与 cookie 到期时间，到期或每个入站帧发现过期即以 4401 关闭；`ui token --rotate` 后网关（1 秒内）以 4401 关闭所有 remote 套接字。非对象/缺少字符串 `t` 的帧以 1003 关闭。
- cookie `yonder_session`：HMAC 签名，HttpOnly、SameSite=Strict、24 小时、`Path` 与请求挂载路径一致（经去前缀代理或 `<basePath>` 访问时为 `basePath`；回环 Host 直连 `/` 时为 `/`），来源是 https 公网地址时加 Secure。票据登录得 `read/write/admin/owner`（`kind:"local"`），访问令牌登录得 `read/write`（`kind:"remote"`）；轮换令牌后旧 remote cookie 失效。
- 校验：`Host` 必须是 `127.0.0.1:<port>`、`localhost:<port>` 或 `publicOrigins` 的 host；有 `Origin` 时必须同源或在 `publicOrigins` 内；API 与写请求带 `Sec-Fetch-Site` 且不是 `same-origin` 时拒绝。失败 403；未登录的 API 401，页面 303 到 `<basePath>login`。RPC 只收 `application/json`（否则 415）。
- 反向代理：nginx 去掉前缀后转发；`basePath`（如 `/console/`）只用于生成 cookie Path、重定向地址，并在 `index.html` 注入 `<base href>` 与 `<meta name="yonder-base-path">`。前端资源用相对路径。回环 Host（`127.0.0.1`/`localhost`）的请求既可在 `/` 也可在 `<basePath>` 下访问，后者由网关去掉前缀；经代理的请求须转发公网 Host，否则会被当作回环直连并得到 `Path=/` 的 cookie。
- 响应头：`Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; …; frame-ancestors 'none'`、`X-Content-Type-Options: nosniff`、`Cache-Control: no-store`。
- `sessions.submit` 的 `requestId` 去重存于进程内存（10 分钟），重启后失效；§1.3「沿用事件库」未采用。

## 10. 控制台作为渠道：与常驻 Bot 对话（新增）

控制台是一个内置渠道 `console`（内核内置，不是插件；`channels.console` 保留，配置它会报错）。内置 `console` 出现在 `LoadedPlugins.channels` 里（投递按渠道 id 查找，需要它），但没有插件归属，不进入 `plugins.list` 的 `instances`，也不会被 `start()` 启动。它复用现有渠道/账号/绑定模型，不另开唤醒路径（架构不变量 2）。

- **对端**：已认证的控制台用户即主人，账号 `acct:console:owner`，会话引用 `conv:console:<agent>`。内核启动时若该账号未关联，则关联到首个 Bot 的 `owner` 人（`from: owner` 由此成立）。
- **绑定（零配置）**：`gateway.enabled` 不为 `false` 时，每个有 `session: main` 绑定（`wake` 不是 `write`）的非归档 Agent 在加载时获得一条内存绑定 `{id: "@console", match: {channel: console, kind: dm, from: owner}, session: main, profile: <该 main 绑定的 profile>}`，不写盘。profile 取自既有 main 绑定以满足 02 §2.4。内置绑定用保留 id `@console`，用户绑定一律不被过滤；`agent.yaml` 里任何绑定若 id 为 `@console`，配置校验报错。`agent.yaml` 里显式写了 `channel: console` 的绑定则不注入，以显式为准。
- **会话语义**：进入该 Agent 唯一的 `main` 会话，与 CLI、飞书、QQ 同一会话、同一记忆（02 §1.1）。控制台观看共享的 main 会话是有意设计：主人能看到自己 Bot 的全部对话。回复走正常投递，已在会话记录里；前端用 `sessions.watch` 看回复，不需要新流。主动消息（message_send / 插件发送）发往控制台对端时，渠道 `send` 不再静默确认，而是把消息写成该 Bot main 会话的通知事件（`sessions.notify` 同机制），`sessions.watch` 可见；找不到打开的 main 会话时返回发送失败。主动发送按「owner 最近活跃账号」选目标时，除非本轮输入来自控制台，否则不会选中控制台账号。
- **不支持**：斜杠命令（`onCommand` 只对 `config.channels` 里的渠道生效）、渠道级流式。

| 方法 | scope | params | result |
|---|---|---|---|
| `bots.list` | owner | `{}` | `{ bots: { agent: string; name: string; work?: string; session?: string; channels: string[]; sessionsOverview: number }[] }`，`session` 是已打开的 main 会话 id，尚无则省略。只含 owner 等于**节点 owner** 的 Bot；channels/sessionsOverview 为 §17 增补目标 |
| `bots.send` | owner | `{ agent: string; text: string; requestId?: string }` | `{ event: string; session: string; deduped?: boolean }`，`session` 即 `sessions.watch` 的 id |

为什么不扩展 `sessions.submit`：它只接受 task 会话（spec 02 §5），Bot 输入必须经渠道与绑定。`bots.send` 把一条 `message.in` 交给 `console` 渠道，由 Agent 自己的绑定决定是否接收；无绑定、归档、`profile-mismatch` 时抛错（`Bot X did not accept the message (<dropped>)`），未知 Agent 或不属于节点 owner 的 Agent 抛 `Unknown bot`。`requestId` 在 `bot:<agent>` 下按 10 分钟去重，同 `sessions.submit`。

**节点 owner**：一个节点只有一个 owner，取首个控制台 Bot 的 `owner`。`bots.list` / `bots.send` 只覆盖 owner 与之相同的 Bot；其他 owner 的 Bot 被排除，每个启动时记一条 warn 日志。多 owner 需多个节点。

**scope `owner`**：`Scope = read | write | admin | owner`。本机票据登录（`kind: local`）含 `owner`；远程访问令牌登录默认**不含**，需在 `yonder.yaml` 设 `gateway.remoteOwner: true` 才授予（默认 false，重启生效）。无 scope 时网关对 HTTP RPC 返回 403 `{ok:false,error:{code:"forbidden"}}`（此前 forbidden 也是 200，现统一为 403）；WS 订阅沿用 `end{reason:"forbidden"}`。`capabilities.get.methods` 与 `granted` 只列出本连接持有 scope 的方法。**远程隔离**：Bot 对话（所有非 task 会话，含共享 main 会话）额外要求 `owner` scope：`sessions.list` 只向无 `owner` 的连接返回 task 会话，`sessions.show/transcript/watch/abort/close` 对非 task 会话返回 forbidden（HTTP 403；WS `end{reason:"forbidden"}`，共享 feed 对每个订阅者单独检查）。因此远程令牌在未开 `gateway.remoteOwner: true` 时看不到也碰不到 Bot 对话。task 会话保持原有 read/write 行为。

**基线已知缺口（实现待后续 API 卡补齐；目标隔离规则见 §14）**：无 `owner` scope 的远程令牌（默认）虽看不到 Bot 会话（上文 sessions.* 隔离），但仍可经 `events.query`（按事件过滤，不按会话）读取、经 `sessions.notify`、`sessions.command` 和 `terminal.info`（按会话 id）作用于 Bot 对话。`events.query` 需按事件所属会话/渠道过滤，超出本片范围；其余三个需复用 `guardSession`。

### §11 views.*（插件视图槽，D3）

```ts
type Placement = "rail" | "floating" | "page";
type BuiltinViewId = "todos" | "goal" | "subtasks" | "attachments" | "context" | "background" | "subagents" | "wakes";

// 插件在 core 的 views 槽里声明；内置视图由 core 自己声明（id 为 BuiltinViewId）
interface ViewDecl {
  id: string;                     // 内置用 BuiltinViewId；插件用 "<pluginId>.<name>"，全节点唯一
  plugin: string;                 // 内置为 "core"
  title: string;
  placement: Placement;
  scope: "session" | "node";      // session：随当前会话变；node：与会话无关
  data?: string;                  // 取数方法名，默认 "views.data"；必须是 read 方法
  icon?: string;                  // lucide 图标名，未知则前端用默认
  order?: number;                 // 同 placement 内升序，默认 100
  actions?: string[];             // 可选 action 白名单
  actScope?: Scope;               // views.act 需要的 scope，默认 "write"
  needs?: { methods?: string[] };
}

type ViewContent =                // 插件视图只能返回这几种，前端不执行插件代码
  | { type: "markdown"; text: string }
  | { type: "list"; items: { id: string; title: string; subtitle?: string; state?: "todo"|"doing"|"done"|"error"|"info"; actions?: { id: string; label: string; danger?: boolean }[] }[] }
  | { type: "kv"; rows: { k: string; v: string }[] }
  | { type: "choice"; prompt: string; options: { id: string; label: string }[]; multi?: boolean }
  | { type: "input"; prompt: string; placeholder?: string; secret?: false }   // 不得收集密钥，secret 恒为 false
  | { type: "builtin"; id: BuiltinViewId; payload: unknown };                // payload 形状见 §3.3/§3.4/§15

interface ViewData { viewId: string; rev: number; content: ViewContent; badge?: number }
```

| 方法 | scope | params | result |
|---|---|---|---|
| `views.list` | read | `{ placement?: Placement; session?: string }` | `{ views: ViewDecl[] }`（只含本连接有权限、且 `needs.methods` 全满足的视图） |
| `views.data` | read | `{ viewId: string; session?: string }` | `ViewData`；`scope:"session"` 的视图缺 `session` 返回 `invalid_params`；未知 viewId 返回 `not_found` |
| `views.watch` | read | `{ placement?: Placement; session?: string }` | 流式，易失型（§2.3 第 6 条）；ready.result 同 `views.list`；事件 `views.changed` |
| `views.act` | 取 `ViewDecl.actScope`（默认 write） | `{ viewId: string; action: string; input?: unknown; session?: string }` | `{ content?: ViewContent }` |

- `views.changed` 的 data 沿用 §3.6 `ViewsChangedEv`，placement 取值改为 Placement。前端收到后重取 `views.list` 与受影响 viewId 的 `views.data`。
- 内置视图的 `views.data` 返回 `{type:"builtin", id, payload}`，payload 就是对应事件的最新全量：todos→`TodoUpdatedEv`，subtasks→`SubtaskUpdatedEv`，background→`BackgroundUpdatedEv`，context→`ContextSnapshot`，wakes→`WakeUpdatedEv`，goal→`GoalUpdatedEv`（§15），attachments→`{ items: AttachmentRow[] }`，subagents→`SubtaskUpdatedEv`。
- 插件视图的 `data` 若不是默认的 `views.data`，该方法必须以 `viewId`/`session` 为参数并返回 `ViewData`。
- 错误：视图声明冲突（重复 id）在插件加载时报错，不进 `views.list`。

#### 主 Agent 裁定 10-28

- 插件在 setup 时用 `ctx.views.register(decl, provider)` 注册；provider 签名保持 §17，不带 ctx 参数，通过 setup 的 ctx 闭包访问宿主。
- 插件 ctx 新增 `invalidate(ids?: string[], badge?: number): void`。省略 ids 表示该插件全部视图；ids 只能引用该插件自己声明的视图，否则抛错。按 placement 分组发 `views.changed {placement, ids, badge?}`；同一 tick 的调用用 microtask 合并。badge 沿用 §3.6 的 Record<string, number>，传入的数值应用于本次失效的各 id。
- `ViewDecl.actions?: string[]` 为可选 action 白名单；未声明则不限制。action 必须匹配 `^[a-z0-9][a-z0-9_.-]{0,63}$`。
- input 只能为 undefined、null 或普通 JSON 对象；存在 input 时 JSON.stringify 后的 UTF-8 字节数不超过 16384。违反任一 action/input 规则返回 `invalid_params`，不调用 provider。

### §12 capabilities.get 增补（NodeFacts v1.1）

在 §4 的 `NodeFacts` 上新增（全部为事实，不含 UI 决定）：

```ts
interface NodeFactsAddendum {
  minor: number;                                   // 本文增补版本，v1.1 为 1；protocol 仍为 1
  node: { id: string; name: string };              // 多节点客户端区分来源（API-R20）
  views: ViewDecl[];                               // 同 views.list 无参结果，免一次往返
  models: { select: boolean };                     // 是否支持 sessions.model.set / models.list
  remoteSession: {
    create: boolean;                               // 本连接能否 sessions.open
    modes: Mode[];                                 // 本连接能创建的 mode（远程默认只有 ["task"]）
    agents: string[];                              // 可指定的 agent id（agents.list 同源）
    workspaces: boolean;                           // 是否有 workspaces.list 可用
  };
  features: {                                      // 追加到 NodeFacts.features
    attachments: boolean;                          // attachments.put 可用
    notifications: boolean;                        // notifications.* 可用
    approvals: boolean;                            // approvals.* 可用
    suggestions: boolean;                          // suggestions.* 可用
  };
  limits: { attachmentMaxBytes: number };          // 不再恒为 0；不可用时为 0 且 features.attachments=false
  auth: { kind: "local" | "remote"; owner: boolean };
}
```

- `events` 数组补全：本节点会发的所有 type（含 §15 的 `wake.updated`、`goal.updated`、`suggestion.created`），前端据此决定显示哪些底栏段和右栏卡。
- `plugins[].views` 填该插件声明的 viewId。
- 前端判定顺序：`protocol >= APP_MIN_PROTOCOL` → `methods` 中有无所需方法 → `features` → `events`。不得按插件名判断。

### §13 远程创建与管理会话

沿用 `sessions.open`（不新增 `sessions.create`），扩参并补管理方法：

| 方法 | scope | params | result |
|---|---|---|---|
| `workspaces.list` | read | `{}` | `{ roots: { id: string; label: string; path?: string }[] }`；远程连接不返回 `path`（只给 id 与 label） |
| `sessions.open` | write | `{ preset?: string; agent?: string; model?: ModelRef; workspace?: string; cwd?: string; title?: string; prompt?: string; close?: "manual"\|"run-end"; parent?: string; requestId?: string }` | `{ session: SessionInfo; model?: ModelStatus; deduped?: boolean }` |
| `sessions.rename` | write | `{ id: string; title: string }`（title 1–80 字符） | `Ok` |
| `sessions.search` | read | `{ query: string; mode?: Mode; limit?: number }`（limit 默认 20，最大 100） | `{ items: { session: SessionInfo; title?: string; snippet?: string }[] }` |
| `sessions.abort` / `sessions.close` | write | 已有，不变 | `Ok` |

规则：
1. `preset` 与 `agent` 至少给一个；都给时 `agent` 必须是该 preset 允许的 agent，否则 `invalid_params`。
2. `workspace` 取 `workspaces.list` 的 id，远程连接只能用它；`cwd`（绝对路径）仅 `kind:"local"` 连接可用，远程传 `cwd` 返回 `forbidden`。两者都缺则用 preset 默认工作目录。
3. 远程连接只能创建 `mode:"task"`；创建 persistent/main 需要 `owner` scope（§14）。`capabilities.get.remoteSession.modes` 如实反映。
4. `prompt` 给出则创建后立即作为首条输入提交（等价于 open 后 `sessions.submit`，同一 `requestId` 幂等）。
5. `requestId` 对 `(principal, requestId)` 10 分钟内幂等，重复返回第一次结果并带 `deduped:true`。
6. `title` 缺省由服务端按首条输入生成；`sessions.rename` 只改显示名，不改 id。
7. 事件：成功后节点级发 `session.opened`（§3.1），`activity.watch` 订阅者可见。
8. agent 侧的会话管理工具（CORE 实现）与这些方法同一实现，不另起口径。

### §14 scope 与隔离规则

1. 四级：`read` ⊂ `write` ⊂ `admin`，`owner` 独立（说「以主人身份对 Bot 说话/看 Bot 对话」）。本机票据：全部四级；远程访问令牌：`read`+`write`，`gateway.remoteOwner:true` 时加 `owner`；`admin` 永不给远程。
2. 会话分类：`task`（mode 为 task）与 `bot`（其余 mode，含共享 main）。bot 类会话的所有读写需要 `owner`（§10 已有，本条把规则推到所有入口）。
3. 所有按会话 id 或按事件过滤取数的方法必须过同一个 `guardSession`：`sessions.*`、`terminal.info`、`sessions.command`、`sessions.notify`、`events.query`（按事件所属会话/渠道过滤，无 `owner` 时只返回 task 会话事件）、`views.data/act`（session 参数）、`approvals.*`、`attachments.*`（附件属于会话时）。
4. 流订阅（`sessions.watch`、`views.watch`、`activity.watch`）：`sub` 时校验一次；`activity.watch` 对无 `owner` 的连接，`ActivitySummary.sessions` 只含 task 会话，计数同样只算 task。
5. `local:true` 方法（`stop`、`service.*`、`gateway.ticket`、凭据读取）永不出现在远程 `capabilities.get.methods`。
6. 新方法默认 scope：读 `read`、对 task 会话写 `write`、对 Bot 说话 `owner`、插件/渠道登录/改配置 `admin`；`approvals.answer` 需要 `owner`；`views.act` 取视图声明的 `actScope`，但不得低于 `write`。
7. 违反：HTTP 403 `{ok:false,error:{code:"forbidden"}}`；WS `end{reason:"forbidden"}`。不得用 404 伪装不存在，除非该会话对本连接本就不可见（`sessions.list` 里没有）才返回 `not_found`。
8. 日志与审计：`approvals.answer`、`views.act`、`sessions.open` 记 principal.id 与 requestId，不记正文。

### §15 扩展事件载体与补充事件

1. 内核/插件产生的会话级事件（`usage.updated`、`context.updated`、`compaction.*`、`model.*`、`todo.updated`、`subtask.updated`、`background.updated`、`wake.updated`、`goal.updated`）统一用 `SessionUpdate{type:"event", name:string, data:unknown}` 进入 `kernel.terminal.observe`；网关在 `sessions.watch` 上转成 `ev{type:name, data}`（`seq/cursor` 沿用现有缓冲）。不认识的 `name` 丢弃并计数（网关只转发 协议里冻结的事件名；主 Agent 裁定 10-28：未知 carrier 丢弃）。
2. 节点级事件（`session.opened/closed/settled`、`notification`、`approval.*`、`suggestion.created`、`capabilities.changed`）在 `activity.watch` 上以 `ev{type:name}` 投递。
3. 新增事件形状：

```ts
interface WakeRow { id: string; at: string; source: "channel" | "cron" | "voice" | "manual" | "other"; channel?: string; from?: string; summary?: string }
interface WakeUpdatedEv { session: string; rows: WakeRow[] }          // 最近 20 条，全量替换
interface GoalUpdatedEv { session: string; goal: null | { text: string; state: "active"|"paused"|"done"|"abandoned"; steps?: { text: string; done: boolean }[]; updatedAt: string } }
interface AttachmentRow { id: string; uri: string; name?: string; mime: string; bytes?: number; at: string; from?: "user" | "agent" }
interface SocialPolicyEv { mode?: "direct"|"record"|"mention"|"batch"|"folded"|"mute"; batch?: { count?: number; delaySeconds?: number; maxMessages?: number; maxBytes?: number; run?: boolean }; minIntervalSeconds?: number; signals?: Record<string, "record"|"consider"|"respond">; keywords?: string[]; quiet?: { timezone: string; start: string; end: string }; foldedEverySeconds?: number; judge?: { preset: string; maxCallsPerHour?: number } }
interface SocialPolicyChangeEv { actor: string; sourceEvent?: string; before: SocialPolicyEv; after: SocialPolicyEv; reason: string; revision: string; result: "applied" | "rejected" }   // social.policy-change：插件审计事实，成功与拒绝都记录
```
   `wake.updated`、`goal.updated` 与 §3.4 三者同为全量替换语义。
   `social.policy-change` 只追加进事件库（`from: plugin:social`），当前没有任何 watch 流投递它；字段以 `packages/protocol/src/gateway/social.ts` 的 `SocialPolicyChangeEvSchema` 为准。

### §16 通知偏好与建议卡

```ts
type NotifyLevel = "all" | "mentions" | "mute";   // 默认 all；mute 仍累计未读，只是不推送/不震动
```

| 方法 | scope | params | result |
|---|---|---|---|
| `notifications.prefs.get` | read | `{}` | `{ default: NotifyLevel; conversations: Record<string, NotifyLevel>; sources: { default: "yaml" \| "runtime"; conversations: Record<string, "yaml" \| "runtime"> } }`，key 为会话引用（`conv:<channel>:<id>` 或 session id） |
| `notifications.prefs.set` | write | `{ conv: string; level: NotifyLevel \| "mention" \| null }`（null 删除该项运行时覆盖；`conv:"*"` 改默认值） | `Ok` |
| `suggestions.list` | read | `{ session?: string }` | `{ items: Suggestion[] }` |
| `suggestions.act` | write | `{ id: string; action: "accept"\|"dismiss" }` | `{ state: "accepted"\|"dismissed"; first: boolean }` |

```ts
interface Suggestion { id: string; session: string; by: string; kind: "organize" | "nudge" | "followup"; title: string; body: string; createdAt: string; state: "pending"|"accepted"|"dismissed" }
interface SuggestionCreatedEv { suggestion: Suggestion }
```

- yaml 通知配置为节点启动时读取的初始默认值；运行时偏好存放在节点 home 的 `state.db`，覆盖 yaml，设置后立即生效，节点内跨设备一致。`get` 返回合并结果及每项来源；未配置的内建 `all` 标为 yaml。`mention` 和 `mentions` 读入后统一为 `mentions`。社交（Card 云）会话的免打扰仍由 Card 后端存，见 API-R17。
- `notification` 事件（§3.6）可带 `session?: string`、`conv?: string`、`channel?: string`；节点按生效偏好和免打扰判定后发送，客户端可在当前会话抑制系统通知。


### §17 跨部门消费形状与实现归属（本卡写入 contracts.md 的正文）

本节统一已有提案冲突，不新增功能域。§3.3 的既有类型优先；API-02 是第 1 波共享 schema 唯一写者。API 的后续方法卡使用这些类型，FE/CORE/DIST 不自定同名类型。

| 消费方 | 固定契约 | 提供卡 |
|---|---|---|
| CORE-01/04/05/06、FE-13 | §11 ViewDecl / ViewData / ViewContent；裸内置 id；插件 id 带前缀；board 用 list，progress 用 kv，按钮用 list.actions；禁止 ViewDocument 第二套变体 | API-01/02/05/16 |
| FE-12、CORE-23 | §13 sessions.open；ModelRef 为 {provider,model,thinking?}；workspace 是目录 id，cwd 仅 local；不可自造 sessions.create | API-07/28 |
| FE-19、CORE-24/35 | UsageUpdatedEv/ContextUpdatedEv/CompactionEv 完整沿用 §3.3；CH=cacheRead/(input+cacheRead+cacheWrite)，分母零不显示；compaction.started/finished，失败为 finished{ok:false} | API-02/10/22 |
| CORE-07/09、FE-19 | ModelChangedEv、ModelFallbackEv 沿用 §3.3；恢复用 model.fallback{state:"recovered"}，不另设 model.recovered；reason 沿用 rate_limit/quota/unavailable/error，超时归 unavailable | API-02/11 |
| CORE-01/19、DIST-03 | SessionSettledEv={session:string,status:"idle"\|"done"\|"error"\|"aborted"}；节点流 activity.watch；同一运行只发一次 | API-02/13 |
| CORE-09 | reply.failed：{session:string,notice:string,willRetry:boolean}，notice 非空中文且不含敏感正文 | API-02/11 |
| FE-15/20 | SessionUpdate 与 TranscriptItem 保留 SDK 形状，消息可选 channel/fromName；thinking 块与正文分开，不另造 kind 与真实 SDK 冲突；bots.list 增 channels:string[]、sessionsOverview:number | API-02/09/19/21 |
| FE-09/17 | NotifyLevel=all/mentions/mute，旧 mention 仅迁移输入；mute 仍计未读，不系统通知/震动；notification 在 §3.6 形状上增 session?/conv?/channel? | API-18/23/24 |
| CORE-17、FE 审批调用 | ApprovalCard 沿用 §3.5；approvals.list({state?:"pending"\|"all"})→{items:ApprovalCard[]}；answer({approvalId,decision:"approve"\|"deny"})→{state:"answered",by:string,first:boolean}，scope=owner；事件 approval.requested/approval.answered（不叫 resolved） | API-20 |
| FE 附件/语音 | attachments.put 是 HTTP 别名：POST /api/attachments 原始字节，Content-Type/X-Name/X-Session；结果 AttachmentRef={uri:string,bytes:number,mime:string,name?:string}，直接填 SDK Input.attachments；GET 同源 uri 校验归属；不返回无 uri 的独立 id | API-14/23 |
| CORE-19、FE-23 | §16 Suggestion；suggestions.list/act 与 view 共享状态，accept/dismiss；主 Agent 已裁定 snooze 推迟，本版只定 accept/dismiss | API-21/23 |
| FE-04、DIST-05/12 | window.__YONDER_SHELL__?: "desktop"\|"mobile"；不注入表示 Web；?shell 值同一白名单；客户端壳不属于 NodeFacts，不使用 facts.shell；平台外观本地检测 | API-15 |
| DIST-19、FE-18 | UpdateState={state:"idle"\|"checking"\|"downloading"\|"ready"\|"applying"\|"failed",current:string,latest?:string,progress?:number,error?:string}；update.status({})→UpdateState；update.download({})→UpdateState；update.apply({})→{ok:boolean,hint?:string}；三方法 local:true，read/admin/admin；download 内先检查版本，apply 必须点击 | CORE-26、API-26 |
| FE-22 | 使用既有 todos builtin view 展示管家 onboarding 清单（TodoUpdatedEv），不新增 onboarding RPC；24 小时/5 次仅前端显示规则 | CORE-20、API-28 |

`KernelViews`（CORE-01 提供、API-05 调用）：list({placement?,session?})→ViewDecl[]；data(viewId,session?)→ViewData；act(viewId,action,input?,session?)→{content?:ViewContent}；watch({placement?,session?})→异步 ViewsChangedEv 流；API 调用前按 principal/guardSession 过滤。SDK `api.views.register(decl,provider)` 的 provider.data(session?)→ViewData、provider.act(action,input?,session?)→{content?:ViewContent}；invalidate 发 §3.6 的 ViewsChangedEv。data 方法名缺省 views.data，不创建网关内第二套注册表。

快照与流：sessions.show({id,limit?,before?,full?})→{session:SessionInfo,items:TranscriptItem[],nextBefore?:string}，limit 默认 50，full 仅 local；sessions.watch ready.result 沿用已有快照并加可选 model/usage/context。已有 SessionInfo/SessionUpdate/ActivitySummary/ApprovalCard 与 §3.3/3.4 的形状直接引用，不复制改名；ActivitySummary 的 session 过滤前后计数一致。activity.summary({since?:string}) 的 since 为 ISO 时间，仅过滤会话列表的最后活动时间，其他汇总不得带出隐藏会话。

流排序只用 §2 的 (sub,seq)/cursor，不增通用 rev；ViewData 自有 rev 不外推到 usage/work。views.changed 只在 views.watch；节点级通知在 activity.watch。事件实际生产者为 CORE-01/07/09/24/35；API-02 只校验映射，缺生产者不得宣称端到端通过。ContextSnapshot 可选 parts:{name:string,tokens:number}[]；UsageSnapshot 可选 lsp:{name:string,state:string}；无数据源则省略、不伪造 LSP Active。

前端数据层导出（API-03/16/17/22/23/24/25/28）：rpc/openStream/qk、useCapabilities/useFeature/useHasMethod、useViews/useViewData/useViewAction、useSessionState/useFooterStats/useTodos/useWakes/useGoal、useNotifyPrefs/useSetNotifyLevel、useApprovals/useAnswerApproval、uploadAttachment、useSuggestions/useActSuggestion、useSocialAuth/useSocialConversations/useContacts、useNodes/useActiveNode/addNode/removeNode、useSessionCatalog/useOpenSession/useOnboarding、useUpdateState/useDownloadUpdate/useApplyUpdate（API-26）。社交后端来源已按 Q01 确认为 GoYonderTogether/yonder-cloud（本机 ~/Documents/yonder-card-web，服务端 server/src）；本卡只定契约形状，不修改服务端。社交 ApiClient 与类型原样来自该 Card 参考源（API-17），登录态只有 API-24 持有；FE 文件中的 hook 只能做展示组合。

审批/建议的 kernel 与插件接线位置待定，由主 Agent 落精确接口/文件再派 API-20/21，不能凭空假设 ctx.kernel.approvals/suggestions 已存在。Tauri 原生 updater 桥接不冒充网关 update.*，按 Q05 待定。

其余待定项：Q02 三平台 CI 修复范围、Q04 voice 协议与原生常驻（交 API-27）、Q06 pi 1.4 成对产物与 host 调用点、Q07 多服务器目标与设备边界。它们不阻塞本卡，不在此猜测接口。

契约核对遗留：API-09 的 ready.result 草案使用 items/running/streaming，而本卡 §17 要求沿用既有快照（§9.2）；具体过渡形状待主 Agent 定稿，与 §5 的 sessions.open/show 兼容差异一起处理。CORE-19 卡中旧 snooze 要求按本轮 Q03 裁定推迟，不进入本版契约。

### CH-01 社交控制面契约（主 Agent 代批；运行接线待 CH-06）

以下 TypeBox 仅定义可选增量，不表示方法已经注册。gateway 对请求未知字段保持既有兼容；静态配置仍依 config 校验。Ref 与 revision 为非空字符串，时间为 ISO 8601；具体 Ref 存在性和 channelInstances 在加载或调用时检查。

```ts
import { Type } from '@sinclair/typebox';
const NonEmpty = Type.String({ minLength: 1 });
const Ref = NonEmpty;
const Revision = NonEmpty;
const Quiet = Type.Object({ timezone: NonEmpty, start: Type.String({ pattern: '^([01][0-9]|2[0-3]):[0-5][0-9]$' }), end: Type.String({ pattern: '^([01][0-9]|2[0-3]):[0-5][0-9]$' }) }); // IANA，start != end，可跨午夜
const Action = Type.Union([Type.Literal('record'), Type.Literal('consider'), Type.Literal('respond')]);
const Batch = Type.Object({ count: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })), delaySeconds: Type.Optional(Type.Integer({ minimum: 1, maximum: 3600 })), maxMessages: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })), maxBytes: Type.Optional(Type.Integer({ minimum: 1024, maximum: 65536 })) });
const Policy = Type.Object({
  mode: Type.Optional(Type.Union(['direct', 'record', 'mention', 'batch', 'folded', 'mute'].map(Type.Literal))),
  batch: Type.Optional(Batch), minIntervalSeconds: Type.Optional(Type.Integer({ minimum: 1, maximum: 3600 })),
  signals: Type.Optional(Type.Object({ botMention: Type.Optional(Action), ownerMention: Type.Optional(Action), groupOwner: Type.Optional(Action), everyone: Type.Optional(Action), keyword: Type.Optional(Action) })),
  keywords: Type.Optional(Type.Array(Type.String({ minLength: 1, maxLength: 64 }), { maxItems: 32 })), quiet: Type.Optional(Quiet),
  foldedEverySeconds: Type.Optional(Type.Integer({ minimum: 300, maximum: 86400 })),
  judge: Type.Optional(Type.Object({ preset: NonEmpty, maxCallsPerHour: Type.Optional(Type.Integer({ minimum: 1, maximum: 60 })) }))
});
const Mapping = Type.Object({ subject: Ref, agent: NonEmpty, profile: NonEmpty });
const Patch = Type.Composite([Policy, Type.Object({ mappings: Type.Optional(Type.Array(Mapping)) })]);
const InspectParams = Type.Object({ agent: NonEmpty, conv: Ref, event: Type.Optional(NonEmpty) });
const InspectResult = Type.Object({ policy: Policy, sources: Type.Record(Type.String(), Type.String()), revision: Revision, capabilityGaps: Type.Array(Type.String()), routeReason: Type.String(), cursor: Type.Optional(Type.String()), nextAt: Type.Optional(Type.String({ format: 'date-time' })) });
const UpdateParams = Type.Object({ agent: NonEmpty, conv: Ref, expectedRevision: Revision, patch: Patch, reason: NonEmpty, dryRun: Type.Optional(Type.Boolean({ default: true })) });
const UpdateResult = Type.Object({ before: Policy, after: Policy, affected: Type.Array(Ref), revision: Revision });
const ResumeParams = Type.Object({ agent: NonEmpty, conv: Ref, expectedRevision: Revision, through: NonEmpty });
const ResumeResult = Type.Object({ accepted: Type.Boolean(), revision: Revision });
const BatchReady = Type.Object({ sourceEvents: Type.Array(NonEmpty), through: NonEmpty, policyRevision: Revision });
const PolicyChange = Type.Object({ actor: NonEmpty, sourceEvent: Type.Optional(NonEmpty), before: Policy, after: Policy, reason: NonEmpty, revision: Revision, result: Type.Union([Type.Literal('applied'), Type.Literal('rejected')]) });
const NotificationIntent = Type.Object({ kind: Type.Union(['progress', 'decision', 'digest', 'failure'].map(Type.Literal)), key: NonEmpty, sourceEvents: Type.Array(NonEmpty), expiresAt: Type.Optional(Type.String({ format: 'date-time' })) });
```

| 方法 | scope | params | result |
|---|---|---|---|
| `social.inspect` | read（当前会话；跨会话 admin，跨 Agent 加 cross-agent） | InspectParams | InspectResult |
| `social.update` | admin（跨 Agent 加 cross-agent） | UpdateParams | UpdateResult |

SDK/插件另提供 `social.resume`（ResumeParams → ResumeResult，同 update 权限），不新增控制面 resume 方法。dryRun 默认 true；只允许修改既有策略和已配置 judge/映射，不修改 owner、身份 link、capabilities 或新增授权。每次更新校验、比较 revision、原子替换；失败保留旧配置。两个 `social.*` 事件是插件事件，核心路由诊断由核心追加，不能伪写。

错误沿用既有协议：scope_denied → `forbidden`（403，`data.reason`），revision_conflict → `conflict`（`data.currentRevision`），unsupported_kind → `invalid_params`（`data.kind`）。gateway 使用对象错误；control.sock 现有 `error` 字符串不变，细节只能通过可选旁路字段承载。CH-06 实现时贯通并测试。CH-01 不注册占位方法，因此 registry/protocol golden 当前无此方法增量，注册后同步更新 golden。

### O51 IMP-02 配置键增补（只增不改）

以下键都是可选新增；旧配置照常加载，缺省值由 `parseYonderConfig` / `parseAgentConfig` 补齐（`packages/core/src/config/`）。读这些键的运行逻辑由后续卡实现（IMP-13 预算、IMP-15 判定与快照、IMP-16 标签、IMP-17 闸门接入、IMP-19/25/26 外人额度与能力）。

`yonder.yaml`：

| 键 | 缺省 | 说明 |
|---|---|---|
| `models.chain` | `[workbuddy, rightapi-glm/glm-5.3-flash]` | 兜底链，条目为 provider 或 provider/model |
| `models.priceCapPerMTokenYuan` | `0.6` | 按量付费模型输入、输出单价（元/百万 token）都不得超过 |
| `budget.tokens` / `maxMinutes` / `maxWakeups` | `tokens: 0`（不限），另两项不设 | 三者同时生效 |
| `budget.overBudget` | `record` | `record` 只记录显示，`stop` 中断 |
| `outsiders.ownerShareDailyTokens` | `500000` | 主人分享给外人的每日合计；可为 0，或 `500K`、`2M` 写法（1M = 1,000,000，用 `tokenAmount()` 换算） |
| `outsiders.perPersonDailyTokens` | `3000000` | 每个外人每日上限，登录后才计入 |
| `outsiders.requireLoginForQuota` | `true` | |
| `outsiders.guestMaxRounds` | `3` | 访客（未登录）最多轮数 |
| `outsiders.guestPerQrDailyTokens` / `guestPerSourceDailyRounds` | 不设 | 防批量开访客的上限（IMP-19 定值） |
| `outsiders.capabilities` | `[chat, web_search, public_docs]` | 外人能力白名单 |
| `outsiders.publicDocs` | `[]` | 主人标记为公开的资料 |
| `defaults.channelPolicy` | `open` | 未配白名单的渠道：`open` 放行走外人额度，`closed` 只放主人与白名单 |

`agent.yaml` 的 `social`（整块缺省时不补，消费者用 `socialDefaults` 兜底）：

| 键 | 缺省 |
|---|---|
| `listen.mode` | `realtime`（全部接收；另有 `batch`、`mention`、`digest`） |
| `listen.realtime` | `quietSec: 15`、`maxWindowSec: 120` |
| `listen.batch` | `windowSec: 300`、`keyRules: [owner, link, image]` |
| `listen.digest` | `windowMin: 15`（可选 30）、`minMessages: 5` |
| `listen.mention.strong` | `true` |
| `tags.value` / `tags.rhythm` | `medium` / `normal`；枚举 `high|medium|low` 与 `low|normal|high`；会话策略里的 `tags` 逐群覆盖 |
| `judge.model` | `cheap`（模型槽名或 provider/model） |
| `snapshot.enabled` | `true` |
| `botGate` | `windowMin: 15`、`threshold: 3`、`history: 3` |

### §18 工作台（W01）

来源：`yonder-lead/program/fe/WORK-UX.md` 第三轮。只增不改（spec/20）。全部【新增·A】，后端未实现前前端如实空态。

**session 增补字段**（`SessionInfo` 的可选扩展，旧客户端忽略）：

```ts
interface SessionWorkbenchFields {
  owner?: { kind: "owner" | "bot"; id: string };   // 谁发起；缺省视为 owner。Bot 发起的任务默认只挂在 Bot 下
  archivedAt?: number;                              // 毫秒时间戳；有值 = 已完成（归档由人或有权限者触发，不自动归档）
  needsOwner?: { reason: string; since: number };   // Bot 递上来；有值则进「需要你」组
  title?: string;                                   // 小模型命名（≤12 字），§13 sessions.rename 改过即锁定
  channels?: string[];                              // 该对话来源渠道 id；≥2 个前端才显示渠道标识
  parent?: string;                                  // fork 来源会话 id，最多两层；第三层 fork 返回 invalid_params
  pinned?: boolean;                                 // 置顶 = 长期任务，永不归档提示
}
```

**方法**

| 方法 | scope | params | result | 说明 |
|---|---|---|---|---|
| `sessions.archive` | write | `{ id }` | `Ok` | 设 `archivedAt`；幂等。Bot 会话需 `owner` scope（§14） |
| `sessions.unarchive` | write | `{ id }` | `Ok` | 清 `archivedAt`；幂等 |
| `sessions.pin` / `sessions.unpin` | write | `{ id }` | `Ok` | 设/清 `pinned`；幂等 |
| `sessions.rename` | write | 已有（§13） | `Ok` | 不新增 |
| `bots.overview` | owner | `{ bot: string }` | `{ channels: { id: string; label: string; kind: string; lastActiveAt?: number }[]; sessions: { session: SessionInfo }[] }` | 渠道列表 + 该 Bot 的子会话（含 `parent` 指向 main）。未知 Bot 或非节点 owner 的 Bot：`not_found`（同 `bots.send`） |

以上 `sessions.archive` / `unarchive` / `pin` / `unpin`、`sessions.rename`（§13）与 `bots.overview` 均为只增不改（add-only）：不修改既有方法的 scope、参数与返回形状。主 Agent 代批 10-29。已实现：`packages/core/src/control/session-methods.ts`、`packages/core/src/control/bot-methods.ts`，`session.updated` 经 `sessions.watch` 的 §15 carrier 转发。

- 错误码：未知会话 `not_found`；无权限 `forbidden`；`parent` 超两层 `invalid_params`。
- `sessions.list` 默认不含已归档；`filter` 增加可选 `archived?: boolean`（true 只返回已归档）和 `pinned?: boolean`。
- 事件：沿用 §15 carrier，`SessionUpdate{type:"event", name, data}`。新增事件名 `session.updated`（data：`{ id; patch: Partial<SessionWorkbenchFields> }`），节点级由 `activity.watch` 转发，会话级由 `sessions.watch` 转 `ev{type:"session.updated"}`。不认识该名的客户端丢弃。`needsOwner` 出现时额外走 §16 通知。

**工具**（agent 侧，与上述方法同一实现，不另起口径，§13 第 8 条）

| 工具 | 谁能用 | 参数 | 效果 |
|---|---|---|---|
| `session_archive` | Bot；持有 `session.manage` 的会话 | `{ id?: string }`（缺省当前会话） | 等同 `sessions.archive`；Bot 只能归档自己名下会话，否则 `forbidden`。「需要你 14 天」由 Bot 询问后调用它 |
| `session_hand_up` | Bot 名下会话 | `{ reason: string }` | 设 `needsOwner{reason, since}`，发 `session.updated` 与通知；主人处理后清除并回到 Bot 名下 |
| `bot_ask` | 基础会话（无人设） | `{ bot: string; question: string }` | 向 Bot 提问并返回答复；不改变会话归属 |
| `bot_request` | 基础会话 | `{ bot: string; action: string; detail: string }` | 向 Bot 申请/请其协助操作；Bot 侧按自身审批策略处理，结果返回 |
| `bot_attach` | 基础会话 | `{ bot: string }` | 把当前会话挂为该 Bot 子会话（设 `parent` 为其 main），获得询问主会话的权限；仅主人授权后生效，否则 `forbidden` |

- 权限：这组工具只对基础会话与上表所列会话开放，不进入外人（outsiders）能力白名单；`bot_*` 目标 Bot 必须属于节点 owner，否则 `not_found`。
- 与 scope 的关系：不新增 Scope 值。工具执行时按调用者所属主体检查同名方法所需 scope（archive/pin = write，Bot 会话 = owner）；`session.manage` 是会话授权位，不是 `Scope`。
- 错误码沿用 `forbidden` / `not_found` / `invalid_params`；Bot 未接收 `bot_ask`/`bot_request` 时返回 `Bot X did not accept the request (<reason>)`（同 `bots.send` 口径）。
- `bots.list` 的 `channels` / `sessionsOverview` 即 `bots.overview` 的汇总。
- 已实现（主 Agent 代批 10-29）：`packages/core/src/tools/workbench.ts`，能力表在 `packages/core/src/tools/catalog.ts`，`packages/core/src/runtime/catalog.ts` 的 `explicitOnly` 让 `tools.offer` 的通配符不覆盖这五个工具（只有写出完整名字才启用）。落地偏差：`session.manage` 目前没有对应字段，`session_archive` 以「调用者自己的会话，或自己名下 Bot 的会话」为授权判据；审批项尚未实现（`approvals-methods.ts` 为空），`bot_request` 以 `kind:"dm"` 消息把 `{action, detail}` 交给目标 Bot，由它按自身策略处理并返回答复；`bot_attach` 只改 `parent`，基础会话本身即主人会话，视为已授权。

**实现归属**：A 线内核（会话字段、方法、工具、事件、小模型命名）；B 线 gateway 注册方法与事件转发；apps/app 在后端未实现前对新字段显示空态，dev 原型可用 mock 层并标 `// PROTOTYPE:`。

### §19 市场（MK00）

来源：`yonder-lead/program/market/MARKET-PLAN.md`（D1–D5）。只增不改（spec/20）。服务端是 yonder-cloud `server/`（Hono + PostgreSQL + Redis，与联系人、名片同账号体系）；Bot 侧是 `plugins/market`，只经下列云端 REST 读写。实体字段对齐伙伴 `src/market/types.ts`（yonder-card-web `origin/main` 74f62ea），不同处在「与伙伴草案的差异」列出。本节只定形状，不表示接口已实现；实现归属 MK02（云端）、MK04（插件）、MK03（前端）。

#### 19.1 实体

```ts
type ListingKind = "item" | "service" | "request" | "idea" | "job";        // 同伙伴
type Category = "数码好物" | "生活方式" | "创意服务" | "技能与陪伴" | "户外出行"; // 同伙伴；新增类目只增不改
type ListingStatus = "active" | "paused";                                   // 替代伙伴的 paused?: boolean
type Actor = "human" | "agent";                                             // 访问者类型，仅用于 metrics

interface Listing {
  id: string;                      // 服务端生成 uuid
  kind: ListingKind;
  category: Category;
  title: string;                   // 1..80
  description: string;             // 1..4000
  price: number;                   // ≥0，单位元；0 表示面议/免费，由 unit 说明
  unit: string;                    // ≤16，如 "" | "/次" | "/小时"
  images: string[];                // 0..9 个 URL；见 19.5。替代伙伴单个 image
  imagePosition?: string;          // CSS object-position，原样保留
  sellerId: string;                // 账号 id；服务端写入，客户端不可传
  seller: string;                  // 展示名，服务端从账号取，不是创建入参
  sellerRole: string;              // ≤32，卖家自填
  location: string;                // 城市名或 "线上"
  tags: string[];                  // ≤10 个，每个 ≤24
  facts: { label: string; value: string }[]; // ≤12 项
  delivery: string;                // ≤200
  missing: string[];               // 待确认事项，≤10
  agent: boolean;                  // 发布者有 Bot 代为沟通
  discoverable: boolean;           // 缺省 true；false 时不进搜索，仅凭 id 可读
  status: ListingStatus;
  createdAt: number;               // 毫秒
  updatedAt: number;
  metrics: ListingMetrics;         // 仅卖家本人可见完整值；他人只见 saves、likes
  mine?: boolean;                  // 由服务端按调用者算出，不存储
  saved?: boolean; liked?: boolean; // 同上，仅登录用户
}
interface ListingMetrics {
  humanViews: number; agentViews: number;   // 按天去重后的累计，见 19.4 metrics
  shortlists: number;                       // 被收藏次数（= saves 数）
  likes: number;
  inquiries: number;                        // 收到询问的会话数
}

interface Inquiry {                // 一个帖子 × 一个询问者 = 一个会话（伙伴按帖子聚合，这里加上询问者维度）
  id: string; listingId: string;
  title: string;                   // 创建时帖子标题快照
  sellerId: string; seller: string;
  askerId: string; asker: string;
  messages: InquiryMessage[];      // 列表接口不含，详情接口含
  lastMessage: InquiryMessage;
  unread: number;                  // 调用者视角
  createdAt: number; updatedAt: number;
}
interface InquiryMessage { id: string; senderId: string; actor: Actor; body: string; createdAt: number } // body 1..2000

interface SearchBrief {            // 同伙伴，frequency 改为机器值
  text: string;                    // 1..500
  category: Category | "any";
  budget: number;                  // ≥0；0 = 不限
  location: string;                // "any" 或城市
  priority: "best" | "price" | "local";
}
interface WatchTask {              // 伙伴的 AgentTask
  id: string; ownerId: string;
  title: string;                   // ≤22，缺省取 text 首句
  brief: SearchBrief;
  frequency: "hourly" | "daily" | "manual";
  active: boolean;
  botId?: string;                  // 执行任务的 Bot；缺省 = 主人在 Bot 侧选定的那个
  checkedAt: number;               // 上次检查，0 = 未检查
  seenIds: string[];               // 已提示过的 listing id，服务端保留最近 200 个
  createdAt: number;
}
interface Save { listingId: string; createdAt: number }   // 联合键 (accountId, listingId)
interface Like { listingId: string; createdAt: number }   // 同上
// compare：账号下至多 4 个 listingId 的有序集合，不是独立实体。
```

与伙伴草案的差异（D2 允许）：`image`→`images[]`；`paused`→`status`；`mine` 由服务端算；`metricSource:'sample'` 不入契约，演示数据只在 dev 原型模式存在；`Inquiry` 增加询问者与 `actor`；`frequency`/`priority`/`category:'不限'` 改机器值，展示文案由前端映射；`Match`（score/reasons/tradeoff）不是实体，搜索只返回排序后的 Listing，解释由 Bot 在对话中给出，前端若要展示规则匹配留在 `// PROTOTYPE:`。

#### 19.2 通用约定

- 路径前缀 `/api/market`；JSON；时间为毫秒整数；分页用 `?limit=1..50`（缺省 20）+ `?cursor=`（不透明字符串），响应 `{ items, nextCursor?: string }`。
- 错误沿用 yonder-cloud 现有形状：HTTP 状态 + `{ "error": "<code>" }`。码：`invalid_request`(400，字段非法或缺失；`message` 可选，不含用户输入原文) | `unauthorized`(401，未登录) | `forbidden`(403) | `verify_required`(403，匿名访客尝试写操作，与现有 `guestMaxMessages` 同口径) | `not_found`(404，含「不是你的」资源，不泄露存在性) | `conflict`(409，如对比已满、重复任务) | `payload_too_large`(413) | `rate_limited`(429，带 `Retry-After`) | `rate_limit_unavailable`(503，Redis 不可用时拒绝而不是放行)。
- 同源与 CSRF：非 GET 请求沿用现有 origin 检查，Bot 用 Bearer 不受 cookie 约束。

#### 19.3 鉴权主体

| 主体 | 凭据 | 权限 |
|---|---|---|
| 访客（未登录，或匿名账号） | 无 / 匿名会话 | 只读：listings 列表与详情。无 saves/likes/compare/inquiries/watch-tasks/metrics 读写；浏览计数按 human 记（19.4）。匿名账号的写操作返回 `verify_required` |
| 登录用户（human） | 网页会话 cookie | 读全部公开内容；创建/修改/暂停自己的帖子；询问；saves/likes/compare/watch-tasks 仅本人 |
| Bot（agent） | 现有设备令牌（`kind='device'`），绑定主人账号 | 以主人代表身份调用，权限不超过主人；所有写入与浏览带 `actor:"agent"`。见下 |

Bot 规则：服务端从会话类型判定 `agent`，客户端不能自报；Bot 的 `sellerId`/`askerId` 就是主人账号 id，消息上 `actor:"agent"` 让对方看见这是代发。Bot 只能调用 19.4 标注「Bot」的接口；其余（saves、likes、compare）返回 `forbidden`。「对外联系、发布、承诺价格前先问主人」是 Bot 侧工具约束（19.7），云端不做替代审批，但会限流（19.6）。

#### 19.4 REST 接口

「谁」列：访=访客可调；人=登录用户；Bot=设备令牌可调。

**listings**

| 方法 路径 | 谁 | 说明 |
|---|---|---|
| `GET /listings` | 访 人 Bot | 查询参数：`q`（空格分词，全部命中标题/描述/标签/卖家/城市）、`kind`、`category`、`city`、`min`、`max`（价格，`min>max` 返回 `invalid_request`）、`sort=relevance\|newest\|price_asc\|price_desc`（缺省 relevance）、`mine=1`（仅自己，需登录，含 paused）、`limit`、`cursor`。只返回 `status=active` 且 `discoverable≠false` 的他人帖子。结果项不含 `metrics` 明细（只含 `likes`、`shortlists`），自己的帖子含完整 |
| `GET /listings/:id` | 访 人 Bot | 他人 `paused` 帖子返回 `not_found`；`discoverable=false` 凭 id 可读。**记一次浏览**（见 metrics） |
| `POST /listings` | 人 Bot | body 为 Listing 去掉 `id/sellerId/seller/status/createdAt/updatedAt/metrics/mine/saved/liked`；返回完整 Listing，`status="active"`。Bot 创建的帖子 `agent` 强制 true |
| `PATCH /listings/:id` | 人 Bot | 仅卖家本人；可改上述可写字段；`kind` 不可改（`invalid_request`）。非本人 `not_found` |
| `POST /listings/:id/pause` / `/resume` | 人 Bot | 仅卖家本人；设 `status`；幂等 |

不提供物理删除：下架 = pause。账号删除时由云端级联清理（MK02 定）。

**inquiries**（按帖子聚合会话）

| 方法 路径 | 谁 | 说明 |
|---|---|---|
| `GET /inquiries` | 人 Bot | 当前账号参与的会话（作为询问者或卖家），按 `updatedAt` 倒序，分页；不含 messages。`?listingId=` 过滤。`?role=asker\|seller` 过滤 |
| `GET /inquiries/:id` | 人 Bot | 参与者可读，含 messages（按 createdAt 升序，分页 `limit` 默认 50）；读取即把调用者 `unread` 清零 |
| `POST /listings/:id/inquiries` | 人 Bot | body `{ body }`。同一 (帖子, 询问者) 已有会话则追加消息，否则新建；返回 Inquiry。不能询问自己的帖子（`forbidden`），不能询问 paused 帖子（`not_found`） |
| `POST /inquiries/:id/messages` | 人 Bot | body `{ body }`；卖家回复或询问者追问；返回新消息 |

消息推送沿用云端既有 realtime 通道，事件名 `market.inquiry.message`（payload：`{ inquiryId, message }`），只发给会话两个参与者。

**saves / likes / compare（仅本人，仅登录用户，Bot 不可用）**

| 方法 路径 | 说明 |
|---|---|
| `GET /saves` · `PUT /saves/:listingId` · `DELETE /saves/:listingId` | 列出（返回 Listing，已 paused 的仍列出并带 `status`）· 添加（幂等）· 取消（幂等）。添加他人 paused 帖子 `not_found` |
| `GET /likes` · `PUT /likes/:listingId` · `DELETE /likes/:listingId` | 同上；不能点赞自己的帖子（`forbidden`） |
| `GET /compare` · `PUT /compare/:listingId` · `DELETE /compare/:listingId` | 有序，最多 4 个，超出 `conflict`；`GET` 返回 Listing 数组 |

**watch-tasks（找东西任务）**

| 方法 路径 | 谁 | 说明 |
|---|---|---|
| `GET /watch-tasks` | 人 Bot | 仅本人；分页 |
| `POST /watch-tasks` | 人 Bot | body `{ brief, frequency, title?, botId?, active? }`；每账号最多 20 个，超出 `conflict` |
| `PATCH /watch-tasks/:id` | 人 Bot | 可改 `brief/frequency/title/botId/active`；非本人 `not_found` |
| `DELETE /watch-tasks/:id` | 人 Bot | 幂等 |
| `POST /watch-tasks/:id/check` | 人 Bot | 用任务的 brief 执行一次搜索，返回 `{ items: Listing[] }` = 未在 `seenIds` 中的新结果，并把它们写入 `seenIds`、更新 `checkedAt`。**服务端是「是否已提示」的唯一状态**，插件的 cron 只负责定时调用它 |

匹配规则：云端 `GET /listings` 与 `check` 共用同一个服务端搜索（`q` + category + city + `budget` 为价格上限硬限制 + priority 排序）。关键词规则不进契约；MK02 实现时以 PostgreSQL 全文检索或等价手段，实现细节不属本契约。

**metrics**

| 方法 路径 | 谁 | 说明 |
|---|---|---|
| `GET /listings/:id/metrics` | 人 Bot | 仅卖家本人，返回 `ListingMetrics` + `daily: { day: "YYYY-MM-DD", humanViews: number, agentViews: number }[]`（最近 30 天，按服务端 UTC 日） |

浏览计数没有独立写接口，由 `GET /listings/:id` 在服务端记录（客户端不能刷）：
- 类型：Bot 设备令牌 → `agent`；其余（含访客、登录用户网页）→ `human`。
- 去重：同一「访问者键」同一天同一帖子只记一次。访问者键 = 登录/Bot 为账号 id（Bot 与主人的 human 浏览**分开计**，因为 actor 不同）；访客为 IP 的哈希（不存原始 IP）。
- 卖家看自己的帖子不计。`agentViews` 仅以服务端记录的 Bot 访问为准（D2）。

#### 19.5 图片

- 现状：云端没有通用上传接口，网关侧 `uploadAttachment` 属会话附件，不用于市场。本契约**不新增上传接口**。
- `images` 项只接受：`https://` 外链 URL，或内置图路径（以 `/market/` 开头，指向前端随包静态资源）。其他协议（`data:`、`http:`、`javascript:`、`file:`）一律 `invalid_request`。单个 URL ≤ 500 字符。云端不抓取、不转存外链。
- 前端伙伴版允许把本地图片转 data URL 存 localStorage，那是 dev 原型行为，不进云端。上传能力需要时另开契约（云端存储与审核策略待维护者定，见未决项）。

#### 19.6 限流

沿用云端 `rateLimit`（Redis 窗口计数，超限 429 + `Retry-After`，Redis 不可用 503），按账号 id 计；访客按 IP。写类 Bot 与主人**共用**同一账号额度，另对 Bot 单独更紧：

| 范围 | 登录用户 | Bot |
|---|---|---|
| 读（listings 列表/详情，每分钟） | 120 | 60 |
| `POST /listings`（每小时） | 10 | 3 |
| `PATCH`/pause/resume（每小时） | 60 | 20 |
| 发询问消息（每分钟 / 每天） | 10 / 100 | 3 / 30 |
| 对同一帖子新开询问（每天） | 20 帖 | 5 帖 |
| watch-task `check`（每分钟） | 10 | 10 |
| 其余写（saves/likes/compare/watch-tasks，每分钟） | 60 | 不可用 |
| 访客读（每分钟，按 IP） | 60 | — |

数值为首版起点，MK02 可调整但须同步本表。匿名账号写操作先返回 `verify_required`，不进入额度。

#### 19.7 plugins/market 工具

插件只经 19.4 的 REST 与云端交互，使用设备令牌；未登录云端或令牌缺失时，工具返回 `not_signed_in`（由 `error` 字段给出，不抛异常）。工具名与参数 schema 如下（TypeBox，`Optional` 表示可选）。**description 文案不在本节定**，由提示词设计流程另写。

```ts
import { Type } from "@sinclair/typebox";
const Kind = Type.Union(["item","service","request","idea","job"].map(Type.Literal));
const Cat  = Type.Union(["数码好物","生活方式","创意服务","技能与陪伴","户外出行"].map(Type.Literal));
const Id   = Type.String({ minLength: 1, maxLength: 64 });

const MarketSearch = Type.Object({                       // → GET /listings
  q: Type.Optional(Type.String({ maxLength: 200 })),
  kind: Type.Optional(Kind), category: Type.Optional(Cat),
  city: Type.Optional(Type.String({ maxLength: 32 })),
  min: Type.Optional(Type.Number({ minimum: 0 })), max: Type.Optional(Type.Number({ minimum: 0 })),
  sort: Type.Optional(Type.Union(["relevance","newest","price_asc","price_desc"].map(Type.Literal))),
  limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 50, default: 10 })),
  cursor: Type.Optional(Type.String()),
});
const MarketGet = Type.Object({                          // → GET /listings/:id（带 Bot 浏览计数）
  id: Id, includeInquiries: Type.Optional(Type.Boolean({ default: false })), // true 且为卖家本人时附带 GET /inquiries?listingId=
});
const MarketPublish = Type.Object({                      // → POST|PATCH /listings、pause/resume
  action: Type.Union(["create","update","pause","resume"].map(Type.Literal)),
  id: Type.Optional(Id),                                  // update/pause/resume 必填
  listing: Type.Optional(Type.Object({                    // create 必填 kind/category/title/description/price/location；update 只传要改的
    kind: Type.Optional(Kind), category: Type.Optional(Cat),
    title: Type.Optional(Type.String({ minLength: 1, maxLength: 80 })),
    description: Type.Optional(Type.String({ minLength: 1, maxLength: 4000 })),
    price: Type.Optional(Type.Number({ minimum: 0 })), unit: Type.Optional(Type.String({ maxLength: 16 })),
    images: Type.Optional(Type.Array(Type.String({ maxLength: 500 }), { maxItems: 9 })),
    sellerRole: Type.Optional(Type.String({ maxLength: 32 })),
    location: Type.Optional(Type.String({ maxLength: 32 })),
    tags: Type.Optional(Type.Array(Type.String({ maxLength: 24 }), { maxItems: 10 })),
    facts: Type.Optional(Type.Array(Type.Object({ label: Type.String(), value: Type.String() }), { maxItems: 12 })),
    delivery: Type.Optional(Type.String({ maxLength: 200 })),
    missing: Type.Optional(Type.Array(Type.String(), { maxItems: 10 })),
    discoverable: Type.Optional(Type.Boolean()),
  })),
  ownerApproved: Type.Boolean(),                          // 必须为 true，见下「主人确认」
});
const MarketInquire = Type.Object({                      // → POST /listings/:id/inquiries | POST /inquiries/:id/messages | GET /inquiries
  action: Type.Union(["send","reply","list","read"].map(Type.Literal)),
  listingId: Type.Optional(Id),                           // send 必填
  inquiryId: Type.Optional(Id),                           // reply/read 必填
  body: Type.Optional(Type.String({ minLength: 1, maxLength: 2000 })), // send/reply 必填
  ownerApproved: Type.Optional(Type.Boolean()),           // send/reply 必须为 true；list/read 不需要
});
const MarketWatch = Type.Object({                        // → /watch-tasks 及 check
  action: Type.Union(["create","list","update","delete","check"].map(Type.Literal)),
  id: Type.Optional(Id),                                  // update/delete/check 必填
  brief: Type.Optional(Type.Object({
    text: Type.String({ minLength: 1, maxLength: 500 }),
    category: Type.Union([Cat, Type.Literal("any")]),
    budget: Type.Number({ minimum: 0 }), location: Type.String({ maxLength: 32 }),
    priority: Type.Union(["best","price","local"].map(Type.Literal)),
  })),
  frequency: Type.Optional(Type.Union(["hourly","daily","manual"].map(Type.Literal))),
  active: Type.Optional(Type.Boolean()),
  title: Type.Optional(Type.String({ maxLength: 22 })),
});
```

结果统一 `{ ok: true, ... }` 或 `{ ok: false, error: <19.2 错误码 | "not_signed_in" | "approval_required"> }`；`market_search` 返回 `{ items, nextCursor? }`，其余返回对应实体。

**权限**（工具级，沿用 spec 的能力模型，不新增 Scope）：

| 工具 | 能力 | 需要主人确认 |
|---|---|---|
| `market_search` / `market_get` | `network` + 云端已登录 | 否（只读；会记一次 `agentViews`） |
| `market_watch` | 同上 | `create`/`update`（改 brief、改 `active`）要；`list`/`check`/`delete` 不要 |
| `market_inquire` | 同上 | `send`/`reply` 要；`list`/`read` 不要 |
| `market_publish` | 同上 | 全部 action 要 |

不对外人（outsiders）开放：这五个工具不在 `outsiders.capabilities` 白名单内，外人会话里不可见（D5、§18 同口径）。

**主人确认（D5）**：对外联系（`market_inquire` 的 `send`/`reply`）、发布（`market_publish` 的 `create`/`update`/`pause`/`resume`）、含价格或承诺（帖子 `price`、询问/回复正文里出现价格、折扣、「我愿意以…买/卖」类表述）的操作，Bot 必须先把完整待发内容（目标帖子、正文、价格）交给主人，得到明确同意后才可调用，并传 `ownerApproved:true`。工具层规则：
1. `ownerApproved` 缺失或为 false 时，工具**不调用云端**，直接返回 `{ ok:false, error:"approval_required" }`。
2. 一次同意只覆盖当次展示的那条内容；内容改动、换帖子、换收件人都要重新问。
3. 不做支付、担保、物流；Bot 不得代主人下单或付款，也不得承诺云端以外的交付。
4. `ownerApproved` 只是 Bot 自述，云端不校验；真正的约束是提示词与 19.6 的 Bot 限流。需要强制审批时走 §3.5 审批事件，接线位置待定（见 19.9），本节不假设 `ctx.kernel.approvals` 已存在。

**找东西任务的执行（D4）**：`market_watch` 的 `create` 在云端建任务后，插件向 `cron` 插件登记一个 preset 作业（按 `frequency`：hourly=每小时、daily=每天；manual 不登记；作业归创建者 Agent，timezone 取主人时区）。到点作业调用 `POST /watch-tasks/:id/check`；返回非空时在 Bot 主对话发一张结果卡片（标题 + 每条 title/price/location/链接），**只通知主人，不自动联系卖家**。`update(active:false)`、`delete` 同步停用或删除对应 cron 作业。云端任务与 cron 作业不一致（如 cron 已被删）时以云端为准，插件在下次 `list` 时重建缺失作业。

**views 面板**（MK04 范围，形状沿用 §11）：`market` 视图至少展示「我的发布」「收到的询问（未读数）」「找东西任务」；数据取自 19.4，不另设后端。

#### 19.8 迁移说明

- localStorage 键 `yonder-market-demo:v1:<账号>` 下的数据（14 条 `metricSource:'sample'` 演示帖子、本地 saves/likes/compare/inquiries/tasks）**不迁移到云端**：既无真实卖家，也不是用户创建的内容。这些数据只在 dev 原型模式下读取，代码须标 `// PROTOTYPE:`。
- 生产模式不读、不写该键，也不主动清除（保留用户文件）。同一浏览器里的旧键可能残留，无副作用。
- 前端 `store.ts` 切换到 19.4 的接口（MK03）；dev 原型模式与生产模式的开关沿用 apps/app 现有的原型开关，不新增配置键。
- 云端无历史数据可导入；首批真实帖子由用户发布产生。

#### 19.9 未决项（交维护者）

1. 图片上传：是否由云端提供存储（对象存储、大小与格式、内容审核），还是长期只支持外链与内置图。
2. 工具层的 `ownerApproved` 是否升级为内核审批（§3.5）以强制执行；需主 Agent 先定审批接线。
3. 限流表（19.6）具体数值是否沿用首版起点。
4. 帖子内容审核与举报（不在 MK00 范围，伙伴版也没有）。
5. `request`/`idea`/`job` 类帖子在 `check` 搜索中的范围：伙伴匹配只返回 `item`/`service`；本契约 `GET /listings` 不按 kind 过滤，`check` 缺省只搜 `item`/`service`，是否放开待定。

**实现归属**：MK02 云端表与接口（真实 PostgreSQL 测试）；MK04 `plugins/market`（含 cron 登记与 views）；MK03 前端；工具 description 文案由提示词设计流程补充。
