# context-keeper：让长期会话上下文保持精简（设计草案）

状态：草案，待维护者批准。本文是提案，不改 `docs/spec/`；采纳后须先改 docs、在 `docs/decisions.md` 记一条（AGENTS.md 第 7 条）。调研基于 `origin/main`（8c02c22）与只读检查的生产配置，未改生产、未重启服务。查不到的写"未知"。

## 0. 结论摘要

1. pi-durable 已有压缩，且**可程序化触发**（`Conversation.compact()`），但 Yonder 的 SDK 与会话接口没有暴露它；触发阈值只取决于 `contextWindow - reserveTokens`，不是固定 token 数。
2. 生产现状比审计时又变了：`yonder.yaml` 现在有 `compaction: { enabled: true, backgroundAtTokens: 272000 }`，其中 `backgroundAtTokens` **不是 pi 的键**（有效键只有 `enabled/reserveTokens/keepRecentTokens/backgroundTokens`），会被原样传入后忽略；而主 agent 模型已改为 `rightapi/claude-sonnet-5-5`，`contextWindow: 1000000`。按公式，它在约 98.4 万 tokens 才压缩，等于从不压缩。
3. 第一期只靠配置即可做到 200k 压缩：按模型覆盖 `contextWindow`（改 `yonder.yaml`，需重启）再配 `reserveTokens`；并把主会话 profile 的 `limits.maxTokens` 调大（`agent.yaml`，热生效）。完整可粘贴片段见 §2。
4. 静默 30 分钟压缩无法仅靠配置。推荐方案 B：官方默认插件 `context-keeper` + 两个最小 SDK 接口（`sessions.context`、`sessions.compact`）。pi 的自动压缩保留为兜底，不另造状态系统。
5. "保任务信息"不能依赖模型自觉：压缩摘要用固定模板，用确定性检查校验结果，缺失即降级并留下事件（§4）。

## 1. 现状事实

### 1.1 pi-durable 的压缩能力

路径均相对 `packages/pi-durable/src/`。

| 事实 | 位置 |
|---|---|
| 程序化触发：`Conversation.compact(instructions, context)`，返回压缩任务 ID。它在会话继续工作时做摘要，摘要经 write submission 放置：会话空闲时立即放置，忙时放到下一个边界，头部已变则结果为 `stale` | `harness/types.ts:663-666`；`harness/harness.ts:107-111`；`harness/compaction.ts:412-445` |
| 手动压缩无视 `enabled` | `harness/types.ts:497` |
| `instructions` 只在手动压缩可传，作为"Additional focus"追加在固定摘要提示词之后；自动（threshold/overflow）压缩没有 instructions | `harness/compaction.ts:352-355`；`harness/compaction.ts:141` 起 `task.input` |
| 钩子 `beforeCompact`：选好范围后、摘要前，可返回 `{decline:true}` 或直接给出 `{summary}`；pi 层钩子，插件不能直接用，只有 `packages/core/src/runtime/` 能接 | `harness/types.ts:798-812`；`harness/compaction.ts:136-142` |
| 事件：`compaction_start`、`compaction_end`（含 `error`）；实时状态 `LiveDoc.compactions` 与 `compactionFailure`；条目类型 `pi.compaction`，`data.reason` ∈ manual/threshold/overflow | `harness/events.ts:94-99`；`harness/live.ts:73-90`；`entries.ts:34`；`harness/types.ts:520-521` |
| 压缩是持久任务（有 checkpoint：select → summarize → retry），重启后恢复；摘要失败按 `retry` 策略退避重试 | `harness/compaction.ts:50-56,185-232` |
| 转录条目不删除：压缩只追加一个 `pi.compaction` 条目，`head` 指向第一条保留的条目，模型上下文从它起算 | `harness/compaction.ts:429-445`；`entries.ts:31-34` |

### 1.2 参数与触发公式

默认值：`enabled: true, reserveTokens: 16384, keepRecentTokens: 20000, backgroundTokens: 32768`（`harness/agent.ts:27-32`）；用户值与默认浅合并（`harness/agent.ts:63`），未知键被保留但无人读取。

| 键 | 含义 | 位置 |
|---|---|---|
| `enabled` | 开关阈值压缩与溢出压缩；手动压缩不受影响 | `types.ts:499-500` |
| `reserveTokens` | 给回答留的空间。阻塞阈值 `blocking = contextWindow - reserveTokens`；同时决定摘要请求的 `maxTokens = min(0.8*reserveTokens, model.maxTokens)` | `generation.ts:354`；`compaction.ts:146-149` |
| `keepRecentTokens` | 摘要后逐字保留的近期上下文大小（近似）；从尾部向前累计估算 tokens，在其后第一个合法切点切开；找不到可压缩前缀则不压缩 | `compaction.ts:257-278` |
| `backgroundTokens` | 后台压缩阈值 `background = blocking - backgroundTokens`；`0` 关闭后台压缩 | `generation.ts:355-357` |

触发规则（`generation.ts:164-185,343-359`）：每次生成请求在 prepare 阶段估算上下文 tokens（取最新 assistant 的 usage 加之后消息的估算，`compaction.ts:314`）。

- `tokens > blocking`：先阻塞压缩再发请求（压缩在这一轮之前完成，运行本身继续，不被取消）。
- `tokens > background`（且没有进行中的压缩）：创建后台压缩，请求照常发出，摘要在下一个边界放置（仍在这次运行中途）。
- 模型返回上下文溢出：溢出压缩后重试一次（`generation.ts:508-530`）。
- 检查点只在"准备下一次模型请求"时；运行结束后会话空闲时**不会**自己检查，所以不存在"静默后压缩"。
- `contextWindow <= 0` 或 `enabled: false` 时不做阈值压缩。

### 1.3 Yonder 侧接线

- `yonder.yaml` 的 `compaction` 键在 schema 里是 `Record<string, unknown>`，不校验键名（`packages/core/src/config/schema.ts:103`）；原样传入 Harness settings（`packages/core/src/runtime/index.ts:148`），在 `Harness.open` 时一次性取值。`yonder.yaml` 其余字段需重启（`docs/spec/08-config.md:89`）。因此 `backgroundAtTokens` 这类拼写错误无声失败。
- 07 §5 写明"模型 contextWindow 继续来自供应商目录，不设置额外人为小上限"（`docs/spec/07-runtime.md:63`）。下面的 contextWindow 覆盖属于合法配置，不改内核，但与这句话的精神有张力，采纳时需要在 07 §5 补一句说明。
- `contextWindow` 能否按模型覆盖：能。`models.providers.<id>.modelOverrides.<modelId>.contextWindow`（schema：`packages/core/src/runtime/model-schema.ts:52,68`；合并：`packages/core/src/runtime/models.ts:127,221-224`），与 pi 的 models.json 同构（`docs/spec/07-runtime.md` §6.1）。id 与内置供应商相同时叠加在内置目录之上，沿用其鉴权。pi-durable 里 `contextWindow` 只被压缩阈值使用（`generation.ts:166`）；Yonder 内核另有展示用途（`kernel/terminal.ts:53,137`、`kernel/home-management.ts:46`），会显示覆盖后的值。
- 内置目录里 `gpt-6-astra`、`gpt-6-luna`、`gpt-6-sol`、`gpt-6.1-sol` 的 `contextWindow` 为 272000（`openai`），`openai-codex` 下的 `gpt-6.1-sol` 为 500000，maxTokens 128000（读自 `node_modules/@earendil-works/pi-ai/dist/providers/data/openai*.json`，随 pi-ai 版本变化）。审计里"约 225K–253K 才压缩"与默认公式吻合：272000-16384=255616，后台起点 222848。
- 生产自定义供应商 `rightapi/claude-sonnet-5-5`、`claude-opus-5-5`、`rightapi-glm/glm-5.3-flash` 的 `contextWindow` 都是 1000000。

### 1.4 limits.maxTokens 是什么

`maxTokens` 不是上下文大小，而是**本次运行**累计的 `input + output + cacheRead + cacheWrite`（`packages/core/src/runtime/limits.ts:140-155`），每个提示词里的缓存读取都算一次；达到阈值只提醒一次（`warnings` 去重，`limits.ts:50-55`），不阻止（14 §1）。默认 200000（`packages/core/src/config/index.ts:54`）。一个 130k 上下文的会话，第二次模型调用就越线，所以对长期主会话是常量噪音（审计：184 条提醒）。上下文压到 200k 以内以后，累计值仍随轮数线性增长，所以这个阈值应按"异常长运行"设，不能与上下文阈值对齐。`agent.yaml` 保存后热生效（`08-config.md:85`）。

## 2. 第一期：立刻可用的配置

### 2.1 `yonder.yaml`（需要重启 service）

思路：阈值是 `contextWindow - reserveTokens`，而模型窗口各不相同（27.2 万与 100 万），全局 `reserveTokens` 不能同时适配（给 100 万窗口设 80 万的 reserve，会让 27.2 万窗口模型每一轮都触发压缩）。所以用 `modelOverrides` 把每个模型的 `contextWindow` 统一压到 224000，全局 `reserveTokens: 24000`，得到阻塞阈值 200000。

把现有的无效 `compaction:` 块整体替换为：

```yaml
compaction:
  enabled: true
  reserveTokens: 24000        # 阻塞压缩阈值 = contextWindow(224000) - 24000 = 200000
  keepRecentTokens: 20000     # 压缩后逐字保留约 2 万 tokens 的近期上下文（pi 默认值）
  backgroundTokens: 40000     # 约 160000 起在后台提前做摘要，到边界再放置
```

并在现有 `models.providers` 下增加（与已有的 `rightapi`、`rightapi-glm` 同级；`rightapi` 与 `rightapi-glm` 条目里已有的 `models:` 定义不用改，`modelOverrides` 叠加在其上）：

```yaml
models:
  providers:
    openai:                              # 内置供应商，沿用其 ChatGPT OAuth 与模型目录
      modelOverrides:
        gpt-6-astra:   { contextWindow: 224000 }
        gpt-6-luna:    { contextWindow: 224000 }
        gpt-6-sol:     { contextWindow: 224000 }
        gpt-6.1-sol:   { contextWindow: 224000 }
    rightapi:
      modelOverrides:
        claude-sonnet-5-5: { contextWindow: 224000 }
        claude-opus-5-5:   { contextWindow: 224000 }
    rightapi-glm:
      modelOverrides:
        glm-5.3-flash:     { contextWindow: 224000 }
```

注意：`openai-codex` 下的 `gpt-6.1-sol` 窗口为 500000，如生产用该供应商要同样加一段 `openai-codex.modelOverrides`；是否在用未知（只读检查 `yonder.yaml` 看到 fallback 写的是 `openai/gpt-6.1-sol`）。合并时保留 `models.providers` 现有内容，只加 `modelOverrides` 键；落盘前先备份 `yonder.yaml`。

### 2.2 `agents/main/agent.yaml`（热生效，下一次运行起）

在 `profiles.owner` 下增加：

```yaml
profiles:
  owner:
    limits:
      maxTokens: 6000000    # 本次运行累计 input+output+cacheRead+cacheWrite；约相当于 150k 上下文下 40 次调用
      # maxTurns: 100       # 保持默认；maxMinutes: 30 保持默认
```

选 6,000,000 的依据：审计里 `main` 主会话平均上下文约 130K（`audit-jarvis.md` §1.3），一次正常运行 8–10 次调用约 1–1.5M；100 次调用（默认 maxTurns 的量级）约 13–15M。6M 让常规运行不触发，仍能对"一次运行拖了几十轮"给出一次提醒。该数是估计值，无法由现有数据严格推出；采纳后看一周内提醒条数再调。

### 2.3 是否要重启、副作用与成本

| 项 | 说明 |
|---|---|
| 重启 | `yonder.yaml` 的 `compaction` 与 `models` 必须重启（08:89）；`agent.yaml` 的 `limits` 不用。重启使提示词缓存整体失效一次，审计也观察到重启后的冷缓存运行（审计 §1.4 第 3、6 项） |
| 压缩丢失什么 | 切点之前的内容被一份 LLM 摘要替代：工具结果在摘要来源里每条截断到 2000 字符，推理（thinking）和系统消息不进来源（`compaction.ts:60-61,357-363`）；近期约 2 万 tokens 逐字保留。转录条目本身不删（§1.1），可用 `session_read` 回看 |
| 成本 | 摘要用本会话的模型，且 `cacheRetention: none`（`compaction.ts` summarize 阶段）：每次压缩把 ≈ 160–180k tokens 的前缀按**未命中缓存**的输入价算一遍。astra 的输入价 $10/百万（审计 §1.3）约 $1.6–1.8/次；`claude-sonnet-5-5` 的价格在代码与审计里都没有，未知。压缩后上下文回到约 40k，之后每轮缓存读取按 40k 而不是 130k+ 计，审计显示主会话成本 79% 是缓存读取，因此通常抵得回，但这是推断，需第 5 节指标验证 |
| 压缩发生在运行中途 | 阈值检查在每次模型请求前，所以单次大任务超过 200k 时会在任务中途压缩，不是等运行结束（pi 无此选项）。这是第一期无法满足维护者要求 (a) 后半句的地方，第二期解决 |
| 压缩次数增多 | 摘要逐次折叠旧摘要（`compaction.ts:72`），审计看到摘要从 9.9K 字符增长到 24.9K 字符；摘要长度上限是 `min(0.8*24000=19200, model.maxTokens)`，对 `rightapi` 模型受 `maxTokens: 16384` 限制 |
| 仅靠配置的缺口 | ① 无静默计时；② 自动压缩不能带 instructions，摘要格式是 pi 固定模板，缺"验收标准"与"外部副作用真实状态"；③ 压缩与"正在跑大任务"的互斥只能靠 pi 的边界语义；④ 没有压缩事件进 Yonder 事件流（pi 内部有 `compaction_start/end`，Yonder 是否转发未知） |

## 3. 缺口设计：静默压缩与复盘

### 3.1 方案比较

| 方案 | 做法 | 优点 | 缺点 |
|---|---|---|---|
| A 内核小改 | 内核为每个会话记空闲计时，到点调 `compact()` | 无新接口；直接用 pi | 把"何时复盘/压缩"的策略放进内核，违反"内核最小"（架构 §3：内核不负责 skill 自动整理策略）；阈值、模板、复盘都要写进内核配置 |
| B 官方默认插件（推荐） | 插件 `context-keeper`：`events.on('run.end')` 起计时，到点读会话上下文规模，空闲则调 `sessions.compact` | 策略在插件，内核只多两个通用接口；与 memory 插件同模式（只用槽与 `events.on`）；可单独关闭 | 需要新增 SDK 接口；插件重启要靠事件重建计时 |
| C 复用 hermes-experience | 用它做复盘与压缩 | 已存在 | 查证后不可用：它没有任何计时或压缩能力，只提供记忆读写工具、skill_store、上下文和提示词引导（`index.mjs`、`guidance.mjs`，全包 231 行，无 `setTimeout`/`events.on`）；它是按 agent 限定的第三方适配（hermes 专用 scope），且不是官方默认。可以借鉴的只有"把可复用流程写进 skill 而不是记忆"的引导，用于第三期 |

推荐 B。理由：满足"官方默认启用的插件、不引入第二套状态系统、内核最小"；内核新增的只是能力（压缩一个会话、查询上下文规模），策略全在插件。

### 3.2 最小的新接口（必须有）

插件不能 import pi（04 §1），而现有 `SessionsAPI` 没有压缩，也没有读上下文规模的方法；agent 会话还不允许 `submit`（02 §5），所以无法用"发一条消息让它自己压缩"绕过（内核里没有压缩类斜杠命令，`grep compaction` 仅命中配置接线）。需要在 `@yonder/sdk` 的 `SessionsAPI`（`packages/sdk/src/types.ts`）增加：

```ts
interface SessionsAPI {
  // …原有方法
  context(id: string): Promise<{
    tokens: number;            // 内核按 pi 的 estimateContext 得到的当前上下文估算（含系统段）
    window: number;            // 该会话当前模型生效的 contextWindow（含 modelOverrides）
    busy: boolean;             // 是否有活动运行或排队输入
    lastCompaction?: { entry: number; at: string; reason: 'manual' | 'threshold' | 'overflow' };
  }>;
  compact(id: string, opts?: { instructions?: string }): Promise<{
    status: 'compacted' | 'nothing' | 'busy' | 'failed';   // nothing：没有可压缩前缀（selectCut 为空）
    entry?: number;            // 新摘要条目 id
    error?: string;
  }>;
}
```

要点：

- 两个方法对 agent 会话与 task 会话都有效（压缩不是输入，不违反"agent 只经绑定唤醒"，也不花一次运行）。
- `compact` 的 `busy` 语义：调用时会话有活动运行 → 直接返回 `busy`，**不排队、不中途放置**。这样"不打断大任务"由接口保证，而不是由插件猜测。内核实现放在 `packages/core/src/runtime/`：读 LiveDoc 判断忙闲，空闲时调 `Conversation.compact`，再等 `compaction_end`/任务 outcome 映射成返回值。竞态：判断为空闲到摘要放置之间若来了新输入，pi 在边界放置或标 `stale`（`submissions.ts:181-244`），摘要只替换更早的内容，保留最近 2 万 tokens，可接受；插件把 `stale` 当作 `busy` 重试。
- `context` 需要读 pi 的 `estimateContext`（`compaction.ts:314`，当前是否从包入口导出：`index.ts` 未见导出，需核实或在 runtime 目录内自行调用）。

可选的 pi-durable fork 改动（不是第二期必需，放第三期决定）：`CompactionPolicy` 增加 `instructions?: string`，自动压缩也拼进"Additional focus"，使 pi 兜底的阈值压缩也带任务模板。`compaction` 配置原样传入，所以不需要改 Yonder schema；改动只在 fork 的 `compaction.ts:141` 附近。改 fork 属于维护者决定。

### 3.3 插件行为

配置段（`yonder.yaml` 的 `plugins[].config`）：

```yaml
- use: "@yonder/plugin-context-keeper"
  config:
    idleMinutes: 30          # 静默多久后触发
    softTokens: 200000       # 运行结束时超过此值立即压缩（等运行结束，不打断）
    minTokens: 40000         # 静默压缩的最小上下文，低于它不值得（pi 无前缀可压时也会返回 nothing）
    retry: { max: 3, backoffMinutes: 30 }
    modes: [main, persistent] # 另含 close:manual 的 task 会话；ephemeral 和 run-end 任务不处理
    review: false            # 第三期启用复盘
```

触发规则：

1. `events.on('run.end')`：取 `data.session`，记 `lastActive`，并重置该会话的静默计时器；此时 `sessions.context` 的 `tokens ≥ softTokens` 且 `!busy` → 立即 `compact`（原因 `soft`）。
2. 其它进入该会话的事件（`message.in` 的 `routes`、`session.input`）同样重置计时器并取消待执行的静默压缩；`context().busy` 为真时一律不动。
3. 计时到点：`busy` 否 且 `tokens ≥ minTokens` 且上一个事件不是 `pi.compaction`（`lastCompaction` 之后确有新条目）→ `compact`（原因 `idle`）。
4. 压缩成功后写一个 `context-keeper.compacted` 事件（`{session, reason, before, after, entry}`）；失败写 `context-keeper.failed`。事件类型以插件 id 开头，符合 01 §3。
5. 与 pi 兜底的关系：pi 自己的阈值压缩保留（防止单次运行撑爆窗口和溢出）。第二期把配置改成 §6 的"兜底"档，使 pi 的阻塞阈值高于插件的 200k，这样常规情况都由插件在运行结束后压缩，pi 只在单次运行失控时中途兜底。

状态与持久化：不新增状态系统。会话是否已压缩来自转录（`lastCompaction` 与之后的条目）；计时器是内存态。重启后在 `setup` 里用 `sessions.list` 找开放会话，用 `events.query({type:'run.end'})` 取每个会话最近一次结束时间，重建计时器；已超过 `idleMinutes` 的立即进入"到点"判断（以重启时刻起算至少再等 1 分钟，避开启动期的恢复运行）。插件只在 `paths.data` 存一个不影响正确性的重试计数；丢失无后果（最坏多重试一次）。

失败与重启语义：
- `failed`：按 `retry` 退避，次数用尽后写一次 `context-keeper.failed` 并停止，直到该会话有新活动；模型不可用、鉴权失败这类失败不重试风暴。
- 压缩任务本身是 pi 的持久任务，服务在摘要中途重启会被 pi 恢复，插件不重复发起（`context().busy` 或 `LiveDoc.compactions` 非空时视为忙）。
- 恢复中的运行（`recovery`）期间 `busy` 为真，不压缩。

与"主进程正在跑大任务"的互斥：以 `busy` 为准，包含活动运行、排队输入和进行中的后台工具任务？——后者是否算忙不确定：背景工具任务属于运行所拥有的子任务，运行未结束则 LiveDoc 仍有 run；已脱离运行的后台 process 不算忙（压缩不影响它们）。该判断需在实现时按 `LiveDoc.run` 核实，列入待决事项 #3。

与 Jarvis 台账（`agents/main/memory/tasks/*.md`）的关系：台账是 agent 自己的工作区手记（14 §6），插件**不读不写它**，也不规定其格式。关系只有两条：（a）压缩摘要模板（§4）的"指针"一节要求写台账文件路径，使压缩后能回到台账；（b）第三期的复盘运行由 agent 自己更新台账。台账仍由 agent 用普通文件工具维护，不引入第二套任务状态（架构不变量 4）。

### 3.4 第三期复盘

静默到点时先"复盘"后"压缩"，但复盘必须是一次真实运行（模型要读台账、核对外部状态），而 agent 只能经绑定唤醒（不变量 2）。做法：

1. 插件 `events.emit` 一个 `context-keeper.checkpoint` 事件（`conv` 为被处理会话的会话引用，`data` 含模板与会话 id）。
2. 在 agent.yaml 的 `bindings` 里增加一条（由内核默认模板或 `yonder init` 加入，需维护者批准）：`match: { type: context-keeper.checkpoint }`，`session: main`，`profile: owner`，`reply: none`。
3. 这次运行的提示词是固定模板（§4.2），要求把目标、验收、已做/未做、外部副作用真实状态写入台账并核对。运行结束后 `run.end.inputs` 含该事件 id，插件据此立刻执行 `compact`（不再等 30 分钟）。
4. 确定性校验：用 `sessions.transcript` 看这次运行的工具调用里是否至少有一次写入 `memory/tasks/` 下文件；没有则写 `context-keeper.degraded` 事件并仍然压缩（压缩不应被模型不听话卡住），不重试复盘。
5. hermes-experience 的 skill_store 思路可作为复盘的一部分：复盘提示词可提示"可复用流程存为 skill"，但那是各 agent 自己选的 skill/工具，不由本插件依赖。

复盘本身有成本（一次完整运行 + 缓存冷读 130k），所以只在 `review: true` 且上下文 ≥ `minTokens` 时做；`reply: none` 避免打扰主人。

## 4. 压缩前保任务信息

### 4.1 为什么不能靠模型自觉

pi 的固定摘要模板（`compaction.ts:72-100`）有 Goal / Constraints / Progress / Key Decisions / Next Steps / Critical Context，覆盖多数需求，但没有"验收标准"，没有"外部副作用的真实状态"，没有"指针"，且自动压缩无法追加 instructions（§1.1）。工具结果还会被截到 2000 字符，长任务里的关键事实可能只在工具结果里。所以：

- 插件触发的压缩（soft/idle/review）用 `compact(id, {instructions})` 传入下面的模板，保证格式。
- pi 兜底触发的压缩没有模板，只能靠 pi 默认模板；这也是尽量让插件先压缩的原因之一，并作为第三期可选的 fork 改动（§3.2）。
- 校验：压缩完成后读 `sessions.transcript` 最后一个 `pi.compaction` 条目文本，检查模板各节标题是否齐全；缺少则写 `context-keeper.degraded` 事件。校验是确定性字符串检查，不用模型判断，也不重做摘要。

### 4.2 摘要模板（作为 `instructions` 传入）

```
Additional focus. Keep the standard summary sections and ALSO make sure these are present
under these exact headings. Write "未知" or "未约定" rather than guessing. Never turn a promise
or a plan into "done".

## 目标
每个进行中的目标一条，尽量保留主人的原话；标注是原话还是你的推断。
## 验收标准
每个目标怎样才算完成；没有约定就写"未约定"，不要自己编。
## 已完成（附证据）
每项带证据：文件路径、命令及结果、事件/PR/任务 id。
## 进行中与未开始
当前正在做什么；下一步的第一个具体动作；在等谁或等什么（含等待的后台任务 id）。
## 关键事实与决定
日期、数字、路径、用户偏好与约束，以及决定的理由；已推翻的做法也要列出以免重复。
## 外部副作用的真实状态
已发送的消息、已创建的 PR/issue、已部署的服务、已启动的进程和定时任务、已改的配置。
每项标：已验证 / 未验证 / 未确认（以及如何确认）。
## 指针
任务台账文件路径（如 agents/main/memory/tasks/…）、相关会话 id、任务 id、PR 链接。
恢复时应先读这些指针，再继续。
```

### 4.3 复盘运行的任务提示（第三期）

固定文本，要求按同一结构把以上内容写入台账：每个未完成任务一个文件（沿用现有 `tasks/*.md` 的命名），先读现有台账再更新，不创建重复文件；对"外部副作用"一项必须用只读手段核对（查 PR 状态、查进程、读配置），不能凭记忆；核对不了就写"未确认"。不要在此运行中开始新工作。

## 5. 风险与验收

### 5.1 风险

| 风险 | 缓解 |
|---|---|
| 压缩后丢细节、任务跑偏 | 模板 + 台账指针 + 保留近 2 万 tokens；degraded 事件；转录条目不删，可 `session_read` |
| 摘要成本（未命中缓存的整段前缀） | 记录每次压缩的 usage（pi 把压缩摘要尝试记入会话用量，`harness/usage.ts:6`）；对比压缩前后的每轮成本 |
| 压缩与新输入竞态 | `busy` 门禁；`stale` 当作忙重试 |
| 重复压缩 | 以 `lastCompaction` 之后是否有新条目判断；`nothing` 不重试 |
| 覆盖 contextWindow 影响展示 | 只改展示值；需要时在 `yonder.yaml` 注释写明原因 |
| 多模型切换（fallback 到窗口更小的模型） | 覆盖对所有常用模型一致设为 224000；新增模型须同步（待决事项 #5） |
| 与 07 §5 "不设置额外人为小上限"冲突 | 采纳时修改该句，说明这是运维可配的压缩阈值，而非内核硬限 |
| `compaction` 键名拼错无声失败（如现状 `backgroundAtTokens`） | 建议另提小改动：为 `compaction` 做键名校验并在 `config.reload` 事件报告未知键（需要维护者批准，不在本提案范围） |

### 5.2 用真实模型验证（不伪造）

测试用 `openai/gpt-6-luna`（仓库 `.yonder/` 里的 ChatGPT 登录），缺凭据则标"未测"。

1. 第一期：用临时 home 配 `contextWindow: 60000`、`reserveTokens: 10000`，让阈值约 5 万；用一个真实会话反复读真实大文件，观察 `compaction_start/end`（reason=threshold）与 `pi.compaction` 条目，核对阈值公式与实际触发点（预期在估算 tokens 超过 `window - reserve` 的下一次请求前）。
2. 第二期：`idleMinutes: 1`、`softTokens` 调小，验证三件事：运行中不压缩、运行结束后立即压缩、静默 1 分钟后压缩；中途发新消息取消待执行压缩；压缩中重启服务后不重复发起。
3. 任务连续性（人工可复核）：给会话一个目标、两条验收标准、三个只出现在工具结果里的事实、一个"已发送但未确认"的外部动作，灌入填充内容触发压缩，然后提问恢复：目标、验收、事实、副作用状态是否一致；对照模板各节存在与否。
4. 第三期：复盘运行写台账的工具调用存在；`degraded` 在故意不给写权限的配置档下被触发。

### 5.3 有效性指标

| 指标 | 取法 | 目标 |
|---|---|---|
| 单次运行最大输入上下文 | `run.end.data.usage` 与会话用量快照；审计 §1.4 同口径 | 主会话 ≤ 约 200k，且 p50 明显低于 130k |
| 每次模型调用平均上下文 | 同审计 §1.3 | 主会话降到 100k 以下（需实测） |
| 压缩次数/天与每次成本 | `pi.compaction` 条目与会话用量 | 次数不爆炸（例如每天几次到十几次），总摘要成本小于节省的缓存读取成本 |
| 阈值提醒条数 | runtime.warning 中 `maxTokens` | 主会话趋近 0 |
| 任务连续性 | 5.2 第 3 项的清单通过率；`degraded` 事件占比 | 通过；`degraded` 极少 |
| 主人侧重复提问/纠偏次数 | 审计 §4 口径人工统计 | 不增加 |

## 6. 分期

### 第一期：配置（立刻，无代码）

- 范围：§2 的两处配置；修正无效键。
- 改动文件：生产 `yonder.yaml`（重启）、`agents/main/agent.yaml`（热生效）。仓库内无代码改动；采纳后在 `docs/spec/07-runtime.md` §5 补注、`docs/spec/08-config.md` 补 `compaction` 键说明与示例（需批准）。
- 测试：§5.2 第 1 项；上线后看 §5.3 的前四个指标。
- 局限：阈值检查在每次请求前，大任务会在运行中途压缩（§2.3）。

### 第二期：静默压缩与运行结束后压缩

- 范围：`sessions.context`、`sessions.compact`；插件 `plugins/context-keeper`（`events.on('run.end')`、计时器、`softTokens`、`idleMinutes`、事件）；配置切换到"兜底档"（`reserveTokens: 24000` 保持，把各模型 `contextWindow` 覆盖提高到约 272000，使 pi 阻塞阈值约 248k；`backgroundTokens: 0` 关闭后台中途压缩）。
- 改动文件：`packages/sdk/src/types.ts`、`packages/sdk/src/testing.ts`（测试替身，不得写假模型）；`packages/core/src/runtime/index.ts` 内新增会话压缩与上下文查询；`packages/core/src/plugins/index.ts` 与 `kernel` 接线；新增 `plugins/context-keeper/`；默认启用清单 `docs/plugins.md`、`docs/spec/04`（会话接口）、`docs/spec/02 §5`、新规范（编号待定）、`docs/decisions.md`、`docs/status.md`。
- 测试：插件单元测试用 SDK 测试替身只测计时与门禁逻辑（不涉及模型）；涉及压缩的验收用真实模型 `gpt-6-luna`（§5.2 第 2 项）；内核接口测试验证 busy 返回、nothing 返回、重启恢复。

### 第三期：复盘整理

- 范围：`review: true` 路径（checkpoint 事件 + 绑定模板 + 校验）；可选的 pi-durable fork 改动（`CompactionPolicy.instructions`）让兜底压缩也带模板。
- 改动文件：`plugins/context-keeper/`；`agent.yaml` 默认绑定模板（`yonder init`/`agent-presets`）；可选 `packages/pi-durable/src/harness/compaction.ts`、`types.ts`、`agent.ts`；文档同上。
- 测试：§5.2 第 3、4 项，用真实模型；`degraded` 路径用无写权限配置档验证。

## 7. 需要维护者决定

1. 采纳第一期配置时，主 agent 模型是 `rightapi/claude-sonnet-5-5`（1M 窗口）：是否接受"把所有常用模型窗口统一压到 224000"这种覆盖（副作用：展示的 contextWindow 变小）；以及是否在运行中途压缩（第一期）可以接受，直到第二期上线。
2. 第二期是否把 pi 阻塞阈值上移到约 248k（运行失控时才中途压缩），还是保持 200k 为硬阈值。前者满足"大任务不被中途打断"，代价是单次运行内上下文可到 248k。
3. `busy` 的精确定义（活动运行、排队输入、已脱离运行的后台任务）。本提案按 LiveDoc.run 判断，需实现时核实。
4. 是否批准 `sessions.context/compact` 作为公共 SDK 接口，以及对 agent 会话开放压缩（不违反不变量 2，但改变了 02 §5 "不能向 agent 会话 submit"周边的措辞）。
5. 是否做 pi-durable fork 的 `instructions` 改动；新增模型时 `contextWindow` 覆盖如何同步（是否做"全局统一软窗口"配置键，如 `compaction.contextTokens`——这需要内核或 pi 改动，本提案不预设）。
6. 复盘运行的默认绑定由谁加（`yonder init` 默认还是 agent 自己配置），以及是否允许 `reply: none` 的内部运行不通知主人。
7. 是否把 `limits.maxTokens` 的口径改为"不含缓存读取"（14 §1 修改）；本提案只给出配置值，不改口径。
