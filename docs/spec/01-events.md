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

进入模型的事件由统一输入准备入口呈现 id、type；message.in/session.input 使用正文与附件，插件自定义事件的完整 data 以 JSON 作为本轮正文，不要求包含 text。外部数据不进入 system，不授予权限，原事件不变；具体格式见 03 §5.3 和 10 §3.1。

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
  target?: string;         // 仅内核 agent 渠道使用：agent_ask 指定的目标 agent id
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
