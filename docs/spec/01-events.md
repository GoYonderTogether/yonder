# 01 事件

## 1. 事件结构

系统里发生的每件事都是一条事件。事件只追加，不修改，不删除。

```ts
interface YEvent {
  id: string;        // 内核分配，按时间可排序，全局唯一
  ts: string;        // 内核分配，ISO-8601 UTC
  type: string;      // 点分小写，见 §3
  parent?: string;   // 因果上游事件的 id
  from?: Ref;        // 谁引起的：acct: / agent: / plugin:
  conv?: Ref;        // 发生在哪个会话（渠道里的会话，或触发器的名字）：conv:
  data: object;      // 该类型自己的内容；内核类型的 data 由 §3 规定
  routes?: Route[];  // 仅入站事件：内核的绑定结果，见 02 §3
}
```

顶层字段只有这些。新增顶层字段属于不兼容变更（§5）。
插件写入事件时交给内核的是 `EventInput = Pick<YEvent, 'type' | 'parent' | 'from' | 'conv' | 'data'>`，`id`、`ts`、`routes` 由内核填。
渠道插件需要的额外信息一律放进 `data`。

进入模型的事件由统一输入准备入口呈现 id、type；message.in/session.input 使用正文与附件，插件自定义事件的完整 data 以 JSON 作为本轮正文，不要求包含 text。外部数据不进入 system，不授予权限，原事件不变；具体格式见 03 §5.3 和 10 §1.1。

## 2. 引用 Ref

引用是指向实体的字符串，形如 `<种类>:<…>`。所有插件在存储涉及实体的记录时**必须**用引用标注实体，这是跨渠道、跨 agent 能互相查到的前提。

| 种类 | 格式 | 例子 |
|---|---|---|
| 账号 | `acct:<channel>:<id>` | `acct:qq-main:10001` |
| 会话（渠道内） | `conv:<channel>:<id>` | `conv:qq-main:g:7788`、`conv:timer:daily-brief` |
| 人 | `person:<id>` | `person:zoran` |
| agent | `agent:<id>` | `agent:main` |
| Yonder 会话 | `session:<id>` | `session:42`（id 即 pi-durable 的 conversation id，整数） |
| 插件 | `plugin:<id>` | `plugin:trigger-cron` |

- `<channel>` 是渠道**实例** id（同一个 QQ 插件接两个号，就是两个实例，如 `qq-main`、`qq-work`），格式 `[a-z0-9-]+`。`agent` 保留给内核的内部渠道：agent 之间对话时，发起方账号是 `acct:agent:<agentId>`，会话是 `conv:agent:<agentId>`（06 §6）。
- `<id>` 由渠道决定，内核视为不透明字符串，但不得含空白；冒号允许出现在 `<id>` 内部。
- 触发器把自己的名字当会话：`conv:<triggerId>:<name>`。

## 3. 内核事件类型

| type | 谁写 | from | conv | data |
|---|---|---|---|---|
| `message.in` | 渠道 | `acct:` 发送者 | 所在会话 | 见 §3.1 |
| `message.out` | 内核 | `agent:` 或 `plugin:` | 目标为 conv: 时填写 | `{ text, attachments?, session?, to?, delivery: { ok, id?, error? } }`；`to` 记录账号或会话目标，插件发送时没有 `session` |
| `run.end` | 内核 | `agent:` | 第一个输入事件的 `conv` | 见 §3.2 |
| `session.open` | 内核 | `agent:` | — | `{ session, mode, key, profile }` |
| `session.close` | 内核 | `agent:` | — | `{ session, reason }` |
| `session.input` | 内核 | 调用方：`agent:` / `plugin:` | — | `{ session, text, attachments? }`：经会话接口直接提交给预设会话的输入（02 §5）；parent 只能是上游事件 id，父会话留在会话元数据 |
| `identity.link` | 内核 | 执行者 | — | `{ account, person, linked: boolean }` |
| `config.reload` | 内核 | — | — | `{ file, ok, errors? }` |
| `routing.social-decision` | 内核 | — | — | `{ agent, reason, revision }`；`parent` 指向原入站事件，revision 是所用 social 配置的 SHA-256 内容版本，reason 为本次判定原因 |

插件自定义类型**必须**以插件 id 开头：`<pluginId>.<name>`，例如 `trigger-cron.fired`、`qq.recall`。插件**禁止**写入上表中的类型，`message.in` 除外（只有渠道写）。

### 3.1 `message.in` 的 data

```ts
{
  kind: string;            // 会话类型：dm | group | call | mail | api，渠道可扩展
  text: string;            // 可为空串（纯附件）
  attachments?: Attachment[];
  mentioned?: boolean;     // 本渠道实例自己的账号是否被 @
  msgId?: string;          // 渠道原生消息 id
  replyTo?: string;        // 被回复的渠道原生消息 id
  name?: string;           // 发送者当前显示名（用于提示词与身份表）
  target?: string;         // 仅内核 agent 渠道或声明 multiAgent:true 的渠道使用：目标 agent id，目标仍须通过自身绑定
  sources?: string[];      // 仅内核 agent 渠道使用：agent_ask 引用的来源事件 id（06 §6.1）
  effort?: string;         // 仅内核 agent 渠道使用：agent_ask 请求的本次运行思考等级（14 §5）
}
interface Attachment { kind: 'image' | 'audio' | 'video' | 'file'; mime: string; uri: string; name?: string; bytes?: number }
```

`uri` 指向内核可读取的位置（`file://` 本机路径，或渠道插件提供的可下载地址）。

### 3.2 `run.end` 的 data

```ts
{
  session: string;
  inputs: string[];                // 本次运行回答的入站事件 id（通常一个；被 steer 并入的也在内）
  status: 'done' | 'error' | 'aborted' | 'limit';
  reason?: string;                 // error / limit 时说明原因
  replied: 'source' | 'caller' | 'deliver' | 'none';   // 见 06 §2
  model: string;                   // provider/modelId
  thinking?: string;               // 本次运行实际使用的思考等级
  effort?: { requested: string; effective: string; reason?: string; inputs: string[] };   // 有委派请求时（14 §5）
  usage: { input: number; output: number; cacheRead: number; cacheWrite: number; cost: number };
}
```

`parent` 指向触发本次运行的事件。工具调用与模型逐轮内容**不**写成事件，它们在 pi-durable 的会话转录里（架构不变量 4）。

## 4. 存储与查询

- 事件存在 home 的 SQLite 文件里，表前缀 `y_`（见 07 §2）。
- 必须建立的索引：`ts`、`type`、`from`、`conv`、`parent`。
- 内核对插件和工具提供查询，所有条件取交集，结果按 `id` 升序（即时间顺序）分页：

```ts
interface EventQuery {
  id?: string;          // 精确事件 ID；与其他条件取交集，参数化查询
  type?: string;        // 精确类型，或 'prefix.*'
  from?: Ref;
  conv?: Ref;
  agent?: string;       // routes 中出现该 agent（命中或 dropped 都算）
  since?: string;       // ISO-8601，含
  until?: string;       // ISO-8601，不含
  after?: string;       // 上一页最后一条的 id
  limit?: number;       // 默认 100，最大 1000
}
interface EventPage { events: YEvent[]; next?: string }   // next：还有下一页时为本页最后一条的 id
```
- "某个账号出现在哪些群""哪些 agent 和某人有过会话"都由事件表回答，不另建关系表（见 02 §4）。

## 5. 兼容规则

- 内核类型的 `data` 新增可选字段：兼容。
- 删除或改名任何字段、改变字段含义、新增顶层字段：不兼容，需升插件 API 版本（04 §6）。
- 插件自定义类型的 `data` 由插件自己负责兼容。

## 渠道命令执行事实

内核为已通过绑定的渠道斜杠命令写channel.command（parent为输入、data含原始事件/会话组成的msgId与command/session），执行及发送结果写channel.command.result。它们不是模型运行，不伪造run.end。命令尝试复用事件落库去重；重启遇到已有尝试不重复执行或重发，只有尝试没有结果时记录为未确认事实，不能宣称成功。旁观输入不执行命令。

### 来源消息时间

message.in.data可选createdAt为原生发送时间的epoch毫秒字符串，msgId为原生消息ID；event.ts始终是Yonder接纳时间，不替代发送时间。模型输入头分别呈现已知的原时间与接纳时间；未知原时间不伪造。恢复originals的时间仍按各原始消息呈现。

## 程序更新完成事实

内核新增 `release.update-result`，不经过模型产生。`data` 为 `{updateId, install, home, repository, beforeVersion?, version?, tag?, commit?, status, verified, service?, error?}`，status 为 verified / failed-or-unknown / restart-required；service 有真实 version/commit/home/pid/ready。只有实际核验吻合才 verified=true。conv 为 `conv:release:<updateId>`。直接 CLI update 与插件作业调用同一 updateRelease，每次实际尝试仅由此公共入口记录完成；同版本未更新不制造完成事件。旧 channel-github.update-result 保留历史兼容，不作为新的程序通知来源。

事件可独立被 Agent 绑定、插件程序订阅或仅记录。绑定 wake:write 不调用模型，wake:run 才调用；插件 events.on 不暗中唤醒模型，不获得外部正文授予的权限。事件账本仍是事实，进程内订阅不是持久任务队列；不承诺回调必执行或 exactly-once。服务不在线时更新完成可写既有事件账本供查询，不新增 outbox/重试平台。

### 任务续办与结果交接

runtime.continuation 由 task_continue 写入，data 含 session、job（稳定原生调用身份）、text、waiting:false；parent 与 conv/routes 保留来源。同 session/job 去重，原生 requestId 为 continuation:<job>。本轮正文标明这是已接纳的原任务下一步，不能只将 JSON 当作展示通知。

agent.result 只投影一个等待输入的原生最终结果，parent 指向该输入，data 含 session/job（该输入 id）、runId/status/reason；正文从原生回执读取，不复制转录。子会话仍有待执行或未交接工作时不记录最终交接。

message.attempt 对普通 send 保存 outgoing 与 from；确定未发送的瞬时失败在 message.out.delivery.retryable 中明确表示。补达调用前写 message.retry（data.attempt 指向原尝试），调用后的回执仍关联原尝试；重启时在途补达没有确认则记 unknown，不能把更早一次安全失败当成最新事实重发。

多 Agent 渠道同一原生消息可分别投给不同 Agent；入站去重身份为渠道实例 + type + msgId + data.target（普通渠道无 target）。保留原生 msgId，不把 Agent 拼入原生 id。

### 社交事件的所有者（CH-01）

`message.in.data.social` 可选，形状为 `{mentions?: {bot?: boolean; owner?: boolean; everyone?: boolean; accounts?: Ref[]}; senderRole?: 'group-owner'|'member'|'unknown'; parentConv?: Ref; nativeKind?: string}`。它只记录受信任适配器提供的原生事实，不从正文或显示名推断。旧 `data.mentioned` 保持 bot mention 含义；新旧矛盾时记诊断且不提升该信号。

`social.batch-ready` 和 `social.policy-change` 是插件事件，只能由 social 插件以自身身份发出；批次包含 `sourceEvents`、`through`、`policyRevision`，策略变更记录实际 actor、sourceEvent、before/after、reason、revision 和 result。核心路由诊断由核心追加事实，插件不得伪写核心事件。原消息、平台重投和合成批次分别记录，历史事件不修改。

`routing.social-decision` 在 reason 为 batch 时可附生效策略快照 policy。social 插件以 `social.batch-read` 记录已处理游标、以 `social.batch-failed` 记录失败；data 包含 agent、through、msgId，parent 关联批次或完成事件。原消息仍是正文来源。

judge 调用前追加 `social.judge-start`，按 agent 和 conv 统计滚动一小时预算；合法结果追加 `social.judge-result`，包含 action、sourceEvents、reason 和批次指针。恢复时已记录结果可继续处理，只有 start 而无结果的批次保留待处理，不重新发起判断。

folded 的 `routing.social-decision` 同样附策略快照；social 定时写入 `social.folded-ready`，记录 agent、through、sourceEvents、policyRevision 和稳定 msgId。该事实只是待整理批次，不表示摘要完成，不推进已读游标；重启按事实恢复定时与去重。

### 主动通知队列（CH-05r3）

`notification.intent` 为内核写入的持久通知意图，`from` 为真实插件，data 为 `{owner, plugin, text, notification, ownerRef}`；`owner` 为真实会话执行者，`notification` 含 kind/key/sourceEvents 及可选 expiresAt，ownerRef 是入队时主人身份。`notification.final` 的 data 含 `intents`（意图事件 ID 数组）、`status`（attempted 或 discarded），attempted 另含 `agent`。插件不能伪造这两类事件。发送前重查执行者、当前能力、主人和目标授权；撤权或过期丢弃。attempted 在投递前持久记录，崩溃后结果未知且不自动重发。无外发目标时写入主人 main 的 app-only 通知，不唤醒模型，不代表外部渠道送达。
