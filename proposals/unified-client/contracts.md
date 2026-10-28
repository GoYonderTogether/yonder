# Unified Client A/B 接口契约 v1（冻结稿）

> 状态：提案，待维护者批准。冻结 A 线（内核）与 B 线（control 注册表、`packages/gateway`、`apps/app`、macOS 壳）之间的接口。本文不改 `docs/spec/`；落地为 spec 19 时再走设计变更。
> 标记：【已有】代码里存在。【新增·A】内核线实现。【新增·B】应用线实现。【未核实】没读到源码，开工第一步先核。
> 输入：`design.md` §4.1/§4.8/§11，`agent-parity.md` §8，`research/C1-clients.md`，`credentials.md` §6，`packages/cli/src/index.ts:724-841`，`packages/core/src/control/index.ts`，`packages/sdk/src/types.ts`。
> 局限：`design.md` 的 §11 阶段 1 只读到「8 个读/提交方法 + `capabilities.get`」，没找到那 8 个的逐条清单。下面按 §4.1 与 C1 缺口推定（见 §1.3），请 B 线对一下。

## 0. 总则

1. TypeBox 是唯一源，本文的 TS interface 等同于 `Static<typeof Schema>`。`@yonder/gateway/protocol` 只导出 schema 与类型，前端 `import type`。
2. 一元调用走 `POST /api/rpc/<method>`，流式调用走 `GET /api/stream`（WS，单连接多路复用）。本机 control socket 继续存在，同一份注册表，CLI 行为不变。
3. 事件只追加、不改写，客户端必须容忍重复和乱序到达的未知类型（§5）。
4. 凭据值、对话正文不得出现在 `usage.updated`、`context.updated`、`compaction.*`、审批事件里（`agent-parity.md` P8、`credentials.md` §6）。

## 1. 方法注册表

### 1.1 MethodDef

```ts
import type { TSchema } from "@sinclair/typebox";

type Scope = "read" | "write" | "admin";

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
- 新方法：`<域>.<对象>[.<动作>]`，小写点分，域沿用现有（`sessions`、`events`、`channels`、`identity`），新域限 `capabilities`、`models`、`agents`、`attachments`、`activity`、`views`、`approvals`。
- 读：`list`、`get`、`show`。写：动词（`open`、`submit`、`abort`）。流式：以 `.watch` 结尾，且 `stream` 必填。
- 现有 `terminal.*` 是 CLI 终端的内部口径，B 线不依赖，只依赖 `sessions.*`、`activity.*`。
- 默认 scope：纯读 `read`；对会话的提交、中止、选模型 `write`；插件、渠道登录、`stop`、`management` 为 `admin`。远程默认不含 `admin`。

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
| `sessions.show` | read | `{ id: string }` | `{ session: SessionInfo; info: TerminalInfo }` | 已有但要改：现版返回整份 transcript（`index.ts:811-816`），改为不含 transcript。旧形状保留到协议 v2，用 `include?: "transcript"` 兼容 |
| `sessions.transcript` | read | `{ id: string; before?: number; limit?: number }` | `{ items: TranscriptItem[]; hasMore: boolean }` | 新增·A（`kernel.sessions.transcript` 已有，`from/limit` 语义；`before` 倒序翻页要补）【已有底层】 |
| `sessions.watch` | read | `{ id: string; after?: Cursor }` | `{ snapshot: SessionSnapshot; cursor: Cursor }` | 已有但要改：补 `after` + `seq`（§2.3，C1 缺口①） |
| `sessions.submit` | write | `{ id: string; requestId?: string; text: string; attachments?: Attachment[]; busy?: "followup"\|"steer"\|"interrupt" }` | `InputReceipt`（`{ event, session, deduped?: boolean }`） | 已有但要改：加 `requestId` 幂等（C1 缺口②） |
| `sessions.abort` | write | `{ id }` | `Ok` | 已有 |
| `activity.summary` | read | `{}` | `ActivitySummary` | 新增·B（包装 `kernel.terminal.activity()`，`index.ts:759-770` 现为 `service.info.agents`） |
| `activity.watch` | read | `{ after?: Cursor }` | `{ summary: ActivitySummary; cursor: Cursor }` | 新增·B（流式，易失型，见 §2.4） |

```ts
interface SessionSnapshot {          // sessions.watch ready.result，对 SessionUpdate{type:"snapshot"} 的结构化
  session: SessionInfo;
  info: TerminalInfo;                // 沿用 terminal.info 的结果【已有】
  transcript?: { items: TranscriptItem[]; hasMore: boolean }; // 最近一页，窗口大小由服务端定（默认 50）
  model: ModelStatus;                // 见 §3.3
  usage: UsageSnapshot;
  context: ContextSnapshot;
}
interface ActivitySummary {
  running: number; waiting: number;  // 「在跑」「等你回答」：顶栏、托盘、悬浮窗同一个数
  suggestions?: number;
  sessions: { id: string; state: "running"|"waiting"|"idle"|"error"; since: string }[];
}
interface InputReceipt { event: string; session: string; deduped?: boolean }
```

`requestId` 规则：同一 `(session, requestId)` 在 10 分钟内重复提交，返回第一次的 `InputReceipt` 且 `deduped:true`，不入队。服务端存储沿用事件库，不新建表。

#### 阶段 2（选模型、新建、附件、审批、views）

| 方法 | scope | params | result | 状态 |
|---|---|---|---|---|
| `sessions.open` | write | `{ preset: string; close?: "manual"\|"run-end"; parent?: string; agent?: string; model?: ModelRef }` | `SessionInfo` | 已有，扩参（C1 缺口③）；SDK `open` 已有 `parent`，control 层未透传，`agent/model` 为新增·A |
| `sessions.close` | write | `{ id }` | `Ok` | 已有 |
| `sessions.command` | write | `{ id; command: string }` | `string` | 已有；文本命令保留作兼容，UI 不再拼 `/model` |
| `sessions.model.set` | write | `{ id; provider: string; model: string; effort?: string }` | `{ model: ModelStatus }` | 新增·A（结构化替代 `/model`） |
| `models.list` | read | `{ provider?: string }` | `{ providers: { id; models: { id; name; contextWindow: number; reasoning: boolean }[] }[] }` | 新增·A（现只能从 `terminal.info` 或 `/model list` 文本抠） |
| `agents.list` | read | `{}` | `{ agents: { id; name; profile; presets: string[] }[] }` | 新增·A |
| `attachments.put` | write | `POST /api/attachments`，原始字节，头 `Content-Type`、可选 `X-Name` | `{ uri: string; bytes: number; mime: string }` | 新增·B（网关落盘到 home 下附件目录，返回的 `uri` 可直接放入 `submit.attachments`；socket 上不提供） |
| `approvals.list` | read | `{ state?: "pending"\|"all" }` | `{ items: ApprovalCard[] }` | 新增·A（secrets 插件经 views/事件库读出；`credentials.md` §6.2） |
| `approvals.answer` | write | `{ approvalId: string; decision: "approve"\|"deny" }` | `{ state: "answered"; by: string; first: boolean }` | 新增·A；同一 `approvalId` 只生效一次，重复回答 `first:false` |
| `views.list` | read | `{ placement?: "rail"\|"main"\|"companion" }` | `{ views: ViewDocument[] }` | 新增·A（design §4.8；`ViewDocument` 类型归 SDK） |
| `views.watch` | read | `{ placement? }` | 同 `views.list`，流式 | 新增·A |
| `views.act` | write | `{ viewId: string; action: string; input?: unknown }` | `{ document?: ViewDocument }` | 新增·A |
| `events.query` | read | `EventQuery`（sdk `types.ts`：`id,type,from,conv,agent,since,until,after,limit`） | `EventPage` | 已有 |

#### 已有、保持原名、暂不进 B 线前端

`awake.status`（read）、`channels.list`（read）、`channels.login`（admin，用 `connection.signal` 取消）、`release.result`、`sessions.notify`（write）、`management`（admin）、`terminal.sessions/presets/channels/queued/dequeue/info`、`service.info`（read，`local:true`）、`identity.lookup/link/unlink/person`、`stop`（admin，`local:true`）。迁入注册表时 scope 沿用上述标注，行为不变。

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

1. `seq`：每个 `sub` 内单调递增的整数，从 1 起，不保证跨连接连续。`cursor` 由服务端编码，包含节点 epoch（内核启动 id）与事件库水位，客户端续传时原样给回 `after`。
2. 首次订阅不带 `after`：`ready.gap=false`，`result` 含当前快照，之后的 `ev` 都是快照之后的增量。
3. 续传带 `after`：
   - 游标可解析且对应水位仍在事件库内：`gap=false`，`ready` 之后先补发 `after` 之后漏掉的 `ev`（`seq` 接着游标之后的值），再切实时。
   - epoch 不同（内核重启）、水位已被截断或无法解析：`gap=true`。`result` 里给全新快照，客户端丢弃本地增量缓存，以快照为准重建。
4. 客户端去重：按 `(sub, seq)`，也按 `ev.data` 里的事件 id（有则）双重防护；落库内容断线恢复后不重复不丢（`design.md` §11 阶段 1 验收 2）。
5. 游标与 `kernel.terminal.observe` / `eventWatermark()` 的映射【未核实】。A 线开工第一件事读 `kernel.terminal.observe` 与 `events.query`。若映射不成立，允许退化为「总是 `gap:true`」，协议不变；B 线按总是可能 `gap:true` 编码。
6. `activity.watch`、`views.watch` 是易失型（`resumable:false`）：不接受 `after`，每次订阅 `gap:true` 且 `result` 带完整当前状态。事件只用于增量刷新。
7. `sessions.watch` 是可续型（`resumable:true`）。

### 2.4 心跳与背压

- 客户端每 25 秒 `ping`，服务端回 `pong`；60 秒无任何帧，任一端关闭连接。
- 服务端对慢消费者：积压超过 1000 帧或 10 MB，发 `end{reason:"error", error:"slow-consumer"}` 并关闭该 `sub`，客户端用 `after` 重订。不静默丢帧。
- 同一连接最多 64 路 `sub`。

### 2.5 错误

一元调用：HTTP 200 `{ok:true,result}` 或 `{ok:false,error:{code,message}}`，沿用 control 的 `ok/result/error` 形状（`control/index.ts` 的 `{ok:true,result}`、`{ok:false,error}`）。错误码字符串：`unknown_method`、`forbidden`、`invalid_params`、`not_found`、`conflict`、`unavailable`。现有 handler 抛出的纯字符串错误统一映射为 `{code:"error"}`，不得依赖文案。

## 3. 事件目录

约定：`ev.type` 为下表第一列；`data` 形状见下；`session` 字段缺省时表示节点级。所有 `data` 都不含对话正文（`transcript.*` 除外，它就是正文，但只经 `sessions.watch`，不进 `activity.watch`）。【新增】列的字母是实现方，但事件的订阅路由在 B 线。

### 3.1 总表

| type | 订阅于 | 发出方（A 线模块） | B 线消费方 | 状态 |
|---|---|---|---|---|
| `session.update` | `sessions.watch` | `packages/core/src/kernel/terminal.ts` observe（`SessionUpdate`） | 中栏转录、输入框忙闲 | 已有（旧形状原样包装） |
| `session.opened` / `session.closed` | `activity.watch`、`sessions.watch` | `kernel.sessions`（`session.open`/`session.close` 事件，`sdk/types.ts` `SessionOpenData/SessionCloseData`） | 左栏会话列表 | 已有（事件库）；流上投递·新增·B |
| `session.settled` | `activity.watch` | `kernel`（会话空闲或完成）；`design.md` §1.2 称存在性【未核实】 | Bot 建议、托盘 | 新增·A |
| `run.ended` | `sessions.watch` | `run.end` 事件（`RunEndData`） | 顶部状态、用量落账 | 已有（事件库），流上投递·新增·B |
| `transcript.item` | `sessions.watch` | terminal observe 的 `message`/`tool` | 中栏转录 | 已有（等价于 `session.update`，新结构化形态见 3.2） |
| `usage.updated` | `sessions.watch` | `packages/pi-durable/src/harness/usage.ts` 累计后由 `packages/core/src/runtime/index.ts` 转发 | 底栏第 1 段 | 新增·A |
| `context.updated` | `sessions.watch` | `runtime/index.ts` `modelStatus`（`contextTokens`、`contextWindow`） | 底栏上下文占比 | 新增·A |
| `compaction.started` / `compaction.finished` | `sessions.watch` | `packages/pi-durable/src/harness/compaction.ts` | 底栏提示、时间线 | 新增·A |
| `model.changed` | `sessions.watch` | `runtime/index.ts` `modelStatus` 变化 | 底栏右段 | 新增·A |
| `model.fallback` | `sessions.watch` | `packages/core/src/runtime/model-chain.ts` | 底栏黄标、时间线 | 新增·A |
| `todo.updated` | `sessions.watch`、`views.watch` | `plugins/tasks` 或 todo 插件，经 `ctx.invalidate()` | 右栏 todo 树 | 新增·A（形态见 3.4） |
| `subtask.updated` | `sessions.watch`、`activity.watch` | `modelStatus.tasks[]`、`task_run` 句柄 | 编辑区下方委派列表 | 新增·A |
| `background.updated` | `sessions.watch`、`activity.watch` | `process` 工具句柄表 | 右栏后台任务 dock | 新增·A |
| `approval.requested` / `approval.answered` | `activity.watch` | secrets 插件（原事件 `secrets.approval.requested/answered`） | 右栏「等你回答」、审批记录、托盘计数 | 新增·A |
| `views.changed` | `views.watch` | 插件 `ctx.invalidate()` | 右栏、悬浮窗 | 新增·A |
| `notification` | `activity.watch` | `sessions.notify` 与 `SessionNotification` | 通知中心、托盘 | 已有（`SessionNotification`）；节点级投递·新增·B |
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
  state: "fallback" | "recovered";
  from: ModelRef; to: ModelRef;
  reason: "rate_limit" | "quota" | "unavailable" | "error";  // 枚举以 model-chain.ts 实际分类为准，A 线核对后冻结
}
type UsageSnapshot = { self: UsageTotals; children?: UsageTotals; last?: UsageTotals & { cacheHitPct: number } };
type ContextSnapshot = { tokens: number; window: number; percent: number; auto: boolean };
```

阈值颜色（>70% 警告、>90% 错误）由前端定，事件不带。`model.fallback.state:"fallback"` 表示已切到备用，`"recovered"` 表示已回到首选；同一次回退至少各发一次，中间不重复。`model.changed` 与 `model.fallback` 同时发生时顺序固定：先 `model.fallback`，后 `model.changed{cause:"fallback"}`。

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
interface ViewsChangedEv { placement: "rail" | "main" | "companion"; ids: string[]; badge?: Record<string, number> }
interface NotificationEv { id: number; from: string; event: string; text: string; session?: string } // = SessionNotification【已有】
interface CapabilitiesChangedEv { reason: "plugin-reload" | "config-reload" }
```

`views.changed` 只提示哪些 view 变了，前端重取 `views.list`；`badge` 与 `activity.summary` 的计数使用同一源，三个表面显示同一个数。

## 4. capabilities.get：NodeFacts

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
5. 客户端要求 `protocol` 的下限由 `FeatureDef.needs.methods` 隐含表达，另在应用启动检查 `NodeFacts.protocol >= APP_MIN_PROTOCOL`，不满足则提示更新节点并只开放只读。
6. `sessions.show` 去掉 transcript 属破坏性改动，按第 2 条处理：v1 默认仍含 transcript，客户端传 `include:"meta"` 取瘦身形态；v2 起默认瘦身。
7. 协议文档的权威位置：spec 19 初稿与 `@yonder/gateway/protocol` 的 schema；本文冻结期间有冲突以本文为准，需改时先改本文并在 `docs/decisions.md` 记一条（`AGENTS.md` 第 7 条）。

## 6. 实现归属汇总

| 项 | 实现方 | 备注 |
|---|---|---|
| `packages/core/src/control/methods.ts` 注册表与 `MethodDef` | B | 唯一大重构，CLI 行为不变 |
| `packages/gateway`（HTTP/WS、鉴权、游标编码、背压、`attachments.put`） | B | 游标编码依赖 A 的 observe 水位 |
| `capabilities.get`、`activity.*`、`capabilities.changed` | B | 数据来自注册表与现有 `terminal.activity()` |
| `sessions.transcript` 的 `before` 倒序分页、`sessions.watch` 的 `after/seq`、`submit.requestId` | A | 内核 `sessions` / `kernel/terminal.ts` |
| `sessions.model.set`、`models.list`、`agents.list`、`open` 的 `agent/model` | A | `packages/core/src/sessions/index.ts` |
| `usage.updated`、`context.updated`、`compaction.*`、`model.changed`、`model.fallback` | A | pi-durable + `runtime/index.ts` + `model-chain.ts` |
| `todo.updated`、`subtask.updated`、`background.updated`、`session.settled` | A | tasks / process / kernel |
| `approval.*`、`approvals.list/answer` | A（secrets 插件） | 依赖 `credentials.md` S2 |
| `views.*`、`views.changed` | A（SDK 槽）+ B（渲染） | design §4.8，阶段 4 |
| `apps/app` 全部消费端、`useStream` 合并进 TanStack Query 缓存 | B | |

## 7. A 线未完成时 B 线的临时替代

原则：B 线按本文的最终形状写客户端，在 `transport/` 里用适配层把旧接口翻译成目标形状。不写模拟数据（`AGENTS.md` 第 4 条），替代方案都走真实节点。

| 缺的能力 | B 线临时做法 | 退出条件 |
|---|---|---|
| `sessions.watch` 无 `after/seq` | 网关给每路 `sub` 本地编号 `seq`；总是 `ready.gap=true`，每次重订都取 `sessions.show` 对账 | A 交付游标 |
| `submit` 无 `requestId` | 网关在内存按 `(session, requestId)` 做 10 分钟去重，不透传给内核 | A 交付；去重迁到内核 |
| `sessions.transcript` 无 `before` | 用 SDK 已有 `transcript(id,{from,limit})` 取尾页（先读总数再算 `from`），仍用 `sessions.show` 兜底 | A 交付倒序分页 |
| `sessions.show` 含整份 transcript | 前端只取 `session` 字段，忽略 transcript；大会话先接受体积 | v2 瘦身 |
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
2. 游标映射成立与否（§2.3 第 5 条）：A 线开工第一件事核实，结论写回本文。
3. `model.fallback.reason` 枚举与 `model-chain.ts` 实际分类对齐后冻结。
4. todo 数据源（tasks 账本还是独立插件）：影响 `TodoItem.state` 取值，不影响事件名。
5. `approvals.list/answer` 与「审批只走 views.act」二选一：本文两者并列，B 线优先用专用方法，views 版本作为阶段 4 的通用入口。

## 9. 网关线实现说明（新增）

本节记录 gateway 线（`lane/gateway-20261027`）已落地的形状，供 B 线对接；标「新增」的条目是前文没有的方法或约定，需维护者确认。

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
- 游标：`<epoch>:<n>`，epoch 为网关进程内随机值，n 为该会话共享环形缓冲（2000 条，最后一个订阅退出后保留 5 分钟）中的序号。`after` 同 epoch 且仍在缓冲内则补发，否则 `gap:true` 加全新快照。网关重启必然 `gap:true`。§2.3 第 5 条的事件库水位映射未采用。
- `seq` 每个 `sub` 从 1 起；补发的事件也从 1 起编号。

### 9.3 网关 HTTP 与鉴权（新增）

- 配置 `gateway: { enabled?: boolean; port?: number; publicOrigins?: string[]; basePath?: string; accessTokenHash?: string }`。默认端口 7690，占用时递增；只监听 127.0.0.1。`yonder start --no-gateway` 不启动网关。
- `<home>/.yonder/gateway.json`（0600）：`{ port, pid, token, basePath }`，`token` 是一次性启动票据。`yonder ui` 经本机 socket 的 `gateway.ticket`（admin，`local:true`，不经网关）另取一次性票据，打印 `http://127.0.0.1:<port>/?token=<ticket>`。
- `GET <任意页面>?token=` 用票据换 cookie 后 303 到干净地址；`GET /login` 登录页，`POST /login`（表单或 JSON `{token}`）用长期访问令牌换 cookie；`POST /api/logout` 清 cookie。
- cookie `yonder_session`：HMAC 签名，HttpOnly、SameSite=Strict、24 小时、`Path=basePath`，来源是 https 公网地址时加 Secure。票据登录得 `read/write/admin`（`kind:"local"`），访问令牌登录得 `read/write`（`kind:"remote"`）；轮换令牌后旧 remote cookie 失效。
- 校验：`Host` 必须是 `127.0.0.1:<port>`、`localhost:<port>` 或 `publicOrigins` 的 host；有 `Origin` 时必须同源或在 `publicOrigins` 内；`Sec-Fetch-Site: cross-site` 拒绝。失败 403；未登录的 API 401，页面 303 到 `<basePath>login`。RPC 只收 `application/json`（否则 415）。
- 反向代理：nginx 去掉前缀后转发；`basePath`（如 `/console/`）只用于生成 cookie Path、重定向地址，并在 `index.html` 注入 `<base href>` 与 `<meta name="yonder-base-path">`。前端资源用相对路径。
- 响应头：`Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; …; frame-ancestors 'none'`、`X-Content-Type-Options: nosniff`、`Cache-Control: no-store`（静态资源除外）。
- `sessions.submit` 的 `requestId` 去重存于进程内存（10 分钟），重启后失效；§1.3「沿用事件库」未采用。
