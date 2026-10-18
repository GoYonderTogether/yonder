# 02 会话、绑定与身份

## 1. 会话

会话是一段持续的对话上下文。每个 Yonder 会话**一一对应**一个 pi-durable conversation，转录、排队、压缩都由 pi-durable 负责；Yonder 只保存下表这行元数据（表 `y_sessions`）。

| 字段 | 含义 |
|---|---|
| `id` | 等于 pi-durable conversation id（整数） |
| `agent` | 所属 agent；预设会话为 `null` |
| `profile` | 配置档名或预设名；会话创建时确定，之后不变 |
| `mode` | `main` / `persistent` / `ephemeral` / `task` |
| `key` | 同一 agent 内唯一，决定"是不是同一个会话"，见下 |
| `parent` | `task` 会话的发起会话 |
| `version` | 这个会话最近一次运行时的 harness 版本（09 §4） |
| `opened` / `closed` | 时间；`closed` 为空表示仍在使用 |

会话没有"当前回复目标"字段：回复目标跟着输入走（06 §2）。

### 1.1 四种会话方式

| mode | key | 何时关闭 | 用途 |
|---|---|---|---|
| `main` | `main` | 不自动关闭 | 每个 agent 唯一。主人从 CLI、飞书、QQ 来的消息都进这一个，跨渠道连续 |
| `persistent` | 由 `per` 决定（§2.2） | 不自动关闭 | 每个群、每个好友、每个陌生人、每次语音通话（渠道给每通电话一个新的 `conv`）各一个 |
| `ephemeral` | 入站事件 id | 运行结束后关闭 | 每封邮件、每个互不相关的请求：一个事件一个会话 |
| `task` | 发起方的工具调用 id，或 `open` 生成的 id | 运行结束后关闭 | 用预设开出的临时会话（03 §4） |

连贯记忆不靠会话：每次通话、每封邮件都是干净的上下文，跨次的连贯由上下文插件按引用（例如发送者的 `person:`）召回。

### 1.2 并发

- 同一会话同一时间只有一次运行；运行中到达的输入按绑定的 `busy` 设置排队：`followup`（默认，本次答完再单独回答）或 `steer`（插进当前工具轮之后，和本次运行共用一个回答）。这直接使用 pi-durable 的 inbox。
- 不同会话并行。

运行事实和输入回答关系由 pi 持有；恢复先还原事件/submission 关联与结束处理，再启动调度。稳定输入身份避免重启重复提交；取消等待与 abort 分开。具体恢复和终结规则见 10 §3，不另建模型队列。

## 2. 绑定

绑定写在 agent 的 `agent.yaml`（03 §2）里，是一张有序表。内核对每个 agent **独立**求值，取该 agent 第一条命中的绑定；一个事件可以同时进多个 agent。**agent 的会话只能经绑定唤醒**（架构不变量 2）。

内部 `agent` 渠道带 `data.target` 时只允许该目标命中；其他 agent 记 `no-binding`。目标仍须通过自己的绑定，不增加 match 维度。普通渠道不得使用这个字段指定目标。

```yaml
bindings:
  - id: owner                     # 必填，agent 内唯一
    match: { channel: qq-main, from: owner }
    session: main
    profile: owner
  - id: groups
    match: { channel: qq-main, kind: group }
    session: { mode: persistent, per: conv }
    profile: group
    wake: mention
  - id: daily
    match: { type: trigger-cron.fired, conv: conv:trigger-cron:daily-brief }
    session: main
    profile: owner
    deliver: { to: owner, via: feishu-main }
```

### 2.1 match：只有这几个维度

| 维度 | 取值 | 匹配对象 |
|---|---|---|
| `type` | 事件类型，或 `prefix.*`；省略时为 `message.in` | `event.type` |
| `channel` | 渠道实例 id 或其数组 | `conv` 引用里的 channel |
| `kind` | 会话类型或其数组 | `message.in` 的 `data.kind` |
| `from` | `owner` / `known` / `stranger` / `person:<id>` / `acct:<…>`，或其数组 | 发送者，按 §4.2 相对本 agent 解析 |
| `conv` | `conv:` 引用或其数组 | `event.conv` |

所有给出的维度都满足才算命中；数组表示"其一即可"。**没有**正则、表达式或任意字段路径——需要更细的划分时，由渠道插件把它体现为不同的 `kind` 或不同的渠道实例。
渠道实例声明它会产生的 `kind`（04 §3.1），`yonder doctor` 据此检查绑定。别的 agent 经 `agent_ask` 发来的消息走内部渠道 `agent`（`kind: agent`，06 §6），同样由绑定决定收不收、进哪个会话。

### 2.2 session

- `main`
- `{ mode: persistent, per: conv | from | person }`：按会话、按账号、或按人（账号已关联到人时跨渠道共用；未关联时退化为按账号）。key 分别写作 `conv:<ref>`、`from:<acct>`、`person:<ref>`。
- `ephemeral`（`wake` 必须是 `run`）

### 2.3 其他字段

| 字段 | 默认 | 含义 |
|---|---|---|
| `profile` | agent 的 `defaultProfile` | 用哪个配置档（03 §3） |
| `wake` | `run` | `run`：唤醒运行。`write`：只写进会话、不运行、不花 token（旁观）。`mention`：`data.mentioned` 为真时运行，否则按 `write` 处理 |
| `busy` | `followup` | 见 §1.2 |
| `reply` | `auto` | `auto`：最终回复发回这条输入的来源（06 §2）。`none`：不自动回复，只能通过工具主动发送 |
| `stream` | `false` | 渠道支持时流式输出过程（06 §3） |
| `deliver` | 无 | 输入不是来自渠道（如定时触发）时，把结果发给谁（06 §2） |

### 2.4 加载时校验

一个会话只有一个配置档（§1），所以可能落到同一个会话的绑定**必须**用同一个配置档，否则 `agent.yaml` 校验失败：

- 所有 `session: main` 的绑定；
- 所有 `per: person` 的绑定；
- `per: conv` 或 `per: from` 相同的绑定中，`match.channel` 与 `match.kind` 都有交集的（没写的维度视为全部）。

运行时若仍遇到已有会话的配置档与命中绑定不同，该 agent 的路由记为 `dropped: 'profile-mismatch'`，不运行。

## 3. 路由结果

入站事件写入前，内核计算每个 agent 的结果并写进 `event.routes`：

```ts
interface Route {
  agent: string;
  binding: string | null;   // 命中的绑定 id；未命中为 null
  session?: string;         // 进入的会话 id
  wake?: 'run' | 'write';
  dropped?: 'no-binding' | 'agent-disabled' | 'profile-mismatch';
}
```

没有任何 agent 命中时，事件仍然写入，每个 agent 一条 `dropped`。

## 4. 身份映射

### 4.1 数据

| 表 | 字段 | 说明 |
|---|---|---|
| `y_accounts` | `ref`(主键), `person`, `name`, `firstSeen`, `lastSeen` | 内核在每个入站事件上自动登记发送者账号与显示名 |
| `y_persons` | `id`, `name`, `note` | 由人或有 `admin` 能力的 agent 创建 |

账号到人的关联只能显式建立（CLI 或工具 `identity_link`），内核不猜。每次关联或解除都写一条 `identity.link` 事件。

### 4.2 相对 agent 的关系

agent 在 `agent.yaml` 里声明 `owner: person:<id>`。对某个 agent 而言，发送者账号是：

- `owner`：账号关联的人就是该 agent 的 owner；
- `known`：账号关联到了某个人，但不是 owner；
- `stranger`：账号没有关联到任何人。

所以同一个人可以是 A 的 owner、B 的 known——关系是相对 agent 计算的，不存储。

### 4.3 能查到什么

内核工具 `identity_lookup` 返回（类型见 §4.4 的 `Lookup`）：

- 这个账号或人：关联的所有账号、显示名；
- 出现过的会话（来自事件表的 `from`/`conv` 组合，例如在哪几个群发过言）；
- 和哪些 agent 有过会话（来自 `y_sessions` 与 `routes`）。

返回其他 agent 的信息需要调用者具备 `cross-agent` 能力（05 §1）。工具调用时，没有该能力的调用者只能看到自己这个 agent 的那部分。读取另一个 agent 的会话内容用 `session_read`，同样需要该能力。插件经 `api.identity` 调用时不受此限（插件由主人安装，可信）。

### 4.4 接口

供 CLI、插件（`api.identity`）与内置工具使用。人一律用引用 `person:<id>` 表示。

```ts
interface IdentityAPI {
  account(ref: Ref): Promise<AccountInfo | undefined>;
  person(ref: Ref): Promise<PersonInfo | undefined>;
  createPerson(p: { id: string; name: string; note?: string }): Promise<PersonInfo>;
  link(account: Ref, person: Ref): Promise<void>;        // 写 identity.link 事件，linked: true
  unlink(account: Ref): Promise<void>;                   // 写 identity.link 事件，linked: false
  relation(agent: string, account: Ref): Promise<'owner' | 'known' | 'stranger'>;   // §4.2
  lookup(ref: Ref): Promise<Lookup>;                     // §4.3；ref 是 acct: 或 person:
}
interface AccountInfo { ref: Ref; person?: Ref; name?: string; firstSeen: string; lastSeen: string }
interface PersonInfo { ref: Ref; name: string; note?: string; accounts: Ref[] }
interface Lookup { accounts: AccountInfo[]; convs: Ref[]; agents: string[] }
```

〔0.1 不实现〕记忆插件。约束：记忆插件存储的每条记忆必须带一个或多个引用（`person:`、`acct:`、`conv:`、`agent:`），这样任何 agent 都能按人、按群、按 agent 查到并串起来。

## 5. 会话接口

同一套接口供三方使用：CLI、插件（`api.sessions`）、工具（`session_*`）。

- agent 会话（`main` / `persistent` / `ephemeral`）由路由创建；这套接口能列出、查看、中止、关闭它们，但**不能**向它们提交输入——给 agent 的输入一律是事件，走绑定（§2）。需要拿到回复的调用方用 `events.ask`（04 §4）。
- 预设会话（`task`）由 `open` 创建、`submit` 驱动。每次 `submit` 写一条 `session.input` 事件（01 §3）。

```ts
interface SessionsAPI {
  list(filter: { agent?: string; mode?: Mode; open?: boolean }): Promise<SessionInfo[]>;
  get(id: string): Promise<SessionInfo | undefined>;
  open(req: { preset: string; parent?: string; capabilities?: Capability[] }): Promise<SessionInfo>;   // 能力 = 预设 ∩ 发起会话 ∩ capabilities（03 §4）
  submit(id: string, input: Input, opts?: { wait?: boolean }): Promise<RunResult | void>;            // 只接受 task 会话
  abort(id: string): Promise<void>;
  close(id: string): Promise<void>;
  transcript(id: string, range?: { from?: number; limit?: number }): Promise<TranscriptItem[]>;
}
type Mode = 'main' | 'persistent' | 'ephemeral' | 'task';
interface SessionInfo {                // y_sessions 的一行（§1）
  id: string; agent: string | null; profile: string; mode: Mode; key: string;
  parent?: string; version: string; opened: string; closed?: string;
}
interface Input { text: string; attachments?: Attachment[] }
interface RunResult { agent: string | null; session: string; status: 'done' | 'error' | 'aborted' | 'limit'; text: string; reason?: string }
interface TranscriptItem {             // 转录的一条，按 pi 条目 id 升序；from 是起始条目 id
  id: number;
  kind: string;                        // pi 条目类型，如 yonder.message、pi.assistant、pi.tool-result、pi.compaction
  text: string;                        // 模型可见的文字
  tools?: Array<{ name: string; args: object }>;   // assistant 条目里的工具调用
  event?: string;                      // yonder.message 条目对应的事件 id
}
```

`submit` 的 `wait: true` 让调用方拿到最终回复（06 §2 的"返回给调用方"）。内核在插件服务包装或模型调用现场绑定真实调用方身份和上游事件，不允许插件用参数伪造其他调用方；保留 Input.attachments。调用方身份不明时不编造 agent。父会话 id 不作为事件 parent。
