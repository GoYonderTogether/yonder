> 证据材料，结论已并入 [agent-parity.md](../agent-parity.md)

# Yonder 多供应商模型回退调研报告

> 只读调研，未修改任何文件、未提交。所有结论附文件路径与行号；无法核实的地方标注「未核实」。

---

## 0. 结论摘要

1. **「发消息没有回复」的机制已定位**：模型链耗尽后 run 以 `unanswered/model_error` 终止（`packages/pi-durable/src/harness/generation.ts:610-620`），不产生 answer entry，渠道插件无内容可发；core 只把状态写进 `state.activityIssue`（`packages/core/src/runtime/index.ts:1444-1462`），而 `plugins/` 下**没有任何插件读取它** → 用户侧完全静默。近 3 天 594 次 run 中 18 次（3%）走到这条路径。
2. **「回退很慢」的主因是框架缺陷，不是上游慢**：单次请求实测 p50 10s、p99 105s、max 221s（853 次采样，无一次超 240s），但 run 跨度 p90 2072s、p95 6630s。慢在退避串联——`delay = retryDelayMs(policy, attempt)` 用的是**跨模型只增不减的 run 级 attempt**（`packages/pi-durable/src/harness/model-recovery.ts:26`），第 4 个候选模型首次失败就要等 129s，第 5 个等 257s。6 项链光睡觉约 2900s，与实测 1136s/1285s/6630s 同量级。
3. **熔断会把健康的免费池永久钉死**：`ModelWatch.record()` 对「本轮没赢的前序条目」一律 `hold(..., "fallback-used", 600s)`（`packages/core/src/runtime/model-watch.ts:95`），`hold()` 每次重写 `until = now + 600s`（`packages/core/src/runtime/model-health.ts:66-79`）；于是每个新 run 都续期，实测 `model-health.json` 里 gw 三模型 `failures` 累到 14，日志每几分钟刷新一次 `until=now+600`。
4. **配置/上游问题也真实存在**：gw 免费池 3 天内几乎全错（`qwen3.8-omni-flash` 32/32 错、`gemini-3.8/3.7` 22/22 与 26/26），ChatGPT 订阅主模型 `openai/gpt-6.1-sol` 45% 错（39/87，多为 Subscription Sharing 限额），只有付费 `rightapi-glm/glm-5.3-flash` 稳定（508 次 / 27 错）。把 4 个免费模型放在付费兜底之前，等于给每次新消息加 30–60s 学费。
5. **一个便宜的结构性修复点**：pi-ai 的 `ProviderRequestOptions` 本来就支持 `timeoutMs`（`node_modules/@earendil-works/pi-ai/dist/types.d.ts:86-104`），但 yonder 的聊天请求**从不传**（`generation.ts:225-231`），`yonder.yaml` 也没有 `stream` 段可配 → 目前没有任何首包/总超时护栏，只有 10 分钟 SDK 默认。

---

## 1. 现有机制：从一次失败到回退再到恢复的完整路径

### 1.1 组件与职责

| 组件 | 文件 | 职责 |
|---|---|---|
| 链构造 | `packages/core/src/runtime/model-chain.ts:65-120` | 把 `model` + `fallback.accounts` + `fallback.accountModels` + `fallback.models` 展开成 `ChainEntry[]`（`provider/modelId@slot`） |
| 排序/闸门 | `packages/core/src/runtime/model-gate.ts:1-29` | `blocked(entry, stops)` = 健康持有 **或** 配额停线；`order()` 稳定分区 `[...open, ...blocked]` |
| 健康状态 | `packages/core/src/runtime/model-health.ts` | `hold/clear/due/probed`，落盘 `<home>/.yonder/model-health.json`（原子写 0600） |
| 配额窗口 | `packages/core/src/runtime/model-quota.ts` | 解析响应里的 `rate_limits`，`accountKey(provider,slot)` → `usedPercent/resetsAt` |
| 观察与探测 | `packages/core/src/runtime/model-watch.ts` | run 结束后回写健康；每 15s 跑一次 `probe()`（`:42`），对到期条目发最小请求 |
| 注入 pi | `packages/core/src/runtime/index.ts:719-780` | 把 gate 重排后的链写成 pi 的 `model` + `modelFallbacks{models, after}` |
| 失败决策 | `packages/pi-durable/src/harness/model-recovery.ts:16-26` | 纯函数：retry / advance / exhausted + delay |
| 退避计算 | `node_modules/@earendil-works/pi-ai/dist/utils/retry.js:99-102` | `min(baseDelayMs·2^(attempt-1), maxAgentDelayMs)` |
| 错误分类 | `packages/core/src/runtime/recovery.ts:21-40` | `transientModelError()` 经 `shouldRetry` hook 覆盖 pi 的默认分类（`generation.ts:566-575`） |

### 1.2 配置形状（现状）

`packages/core/src/config/schema.ts` 的 `SessionModelsSchema`：

```yaml
model: openai/gpt-6.1-sol
fallback:
  models: [gw/deepseek-v4.1-flash, ...]      # 跨模型回退（pattern ^[^/]+/.+$）
  accounts: { openai: [gpt2] }               # 同模型换账号
  accountModels: { gpt2: { openai/gpt-6.1-sol: openai/gpt-6-luna } }
  after: 3                                    # 每个模型连续失败几次才换
  quotaStopPercent: { gpt2: 50 }
  hold: 600                                   # 冷却秒数（0..86400）
  probe: 60                                   # 探测间隔（15..3600）
```

全局只有 `retry: {maxRetries, baseDelayMs, maxDelayMs}`；本机 `yonder.yaml` **没有** `retry` 段（grep 无命中）→ 走默认 10 次 / 2000ms / 300000ms（`recovery.ts:8-19`）。

### 1.3 失败判定与退避（这是慢的根源）

```ts
// packages/pi-durable/src/harness/model-recovery.ts
const eligible = message.stopReason === "error" && !isContextOverflow(message) && policy.enabled;  // :16
const advance  = eligible && fallback !== undefined && failures >= fallback.after
                 && index < fallback.models.length;                                              // :17
const retry    = eligible && (fallback ? advance || failures < fallback.after
                                        : retryable && attempt <= policy.maxRetries);            // :18-19
const exhausted= eligible && !retry && (fallback !== undefined || ...);                          // :20
return { retry, advance, error, delay: retry ? retryDelayMs(policy, attempt) : 0 };               // :26
```

三个问题一起看：

- **`retry` 在有 fallback 时不看 `retryable`**（`:18`）。yonder 已经把 `retryable` 收窄成 `transientModelError`（4xx/鉴权/额度类为 false，`recovery.ts:21-40`），但这个分类在有回退链时被完全绕过 → 一个 400「订阅共享额度用尽」也要重试 3 次。实测证据（`state.db`，conv 145256）：`openai#gpt2/gpt-6-luna` 三次 `f=1,2,3`，错误文本 `openai#gpt2 API error (400): User subscription sharing cur…`。
- **`delay` 用 `attempt`（任务级），不是 `failures`（模型级）**。`attempt` 是 pi 原生 checkpoint 的尝试计数，跨回退模型只增不减。实测同一 run：

  | 模型 | failures | attempt | retryAt 间隔 |
  |---|---|---|---|
  | openai/gpt-6.1-sol | 1/2/3 | 1/2/3 | 2s / 4s / 8s |
  | openai#gpt2/gpt-6-luna | 1/2/3 | 4/5/6 | 16s / 32s / 65s |
  | gw/qwen3.8-max | 1/2 | 7/8 | **129s / 257s** |

  即链上第 k 个候选的首次失败等待 ≈ `2000·2^(k-1)`，与「模型本身多慢」无关。
- **`after` 把两件事混在一起**：既是「换模型前的最小失败数」，又是「换模型阈值」。`after: 3` 意味着每个模型先自我重试 2 次；对 429 秒回的免费池完全是浪费。

### 1.4 冷却、熔断、恢复条件

- **熔断（hold）**：`model-watch.ts:70-96`。三种情况：
  - run 以 `model_error/no_model` 结束 → 整条链 `hold(reason="model_error")`；
  - 以链首条目完成 → `clear([keys[0]])`；
  - 以第 index 条完成 → `hold(keys.slice(0,index), "fallback-used")`。
- **hold 的语义**：`model-health.ts:66-79` 每次调用都 `until = now + hold`、`probeAt = now + probe`，`failures` 累加。**没有「已失败 N 次后升级为更长冷却」的分级，也没有按错误类别区分**——429 和 500 和 401 都拿同样的 600s。
- **恢复（半开探测）**：`model-watch.ts:100-130`，每 15s 扫 `health.due()`（`until > now && probeAt <= now`），发一条 `ping`（单轮、无工具），`ok = message.stopReason !== "error"` → `clear()`，否则 `probed(60)`（**只推后 probeAt，不延长 until**）。
  - 与 `docs/spec/07-runtime.md`（§6.1 模型健康段）写的「失败把持有延长到 `now + hold`」**不一致**：实现是 `model-health.ts:91-101` 只动 `probeAt`。
  - 实测后果：`model-health.json` 里 `until - probeAt = 36s`，说明探测一直在失败、hold 一直到期又被打回。
- **探测的两个失真**：
  - `maxTokens: 8`（工作区已改为 512，未提交）：推理模型把 8 token 全花在 thinking 上，探针永远空 → 健康模型无法解除 hold（改动注释已写明这一点）。
  - 探针把 429 当「坏掉」：`ok = stopReason !== "error"`，免费池限流时探针必错，hold 永不解除。
- **配额闸门**：`model-quota.ts` 只对设了 `quotaStopPercent` 的槽生效（jarvis 只给 `gpt2` 设了 50），`blocked()` 依赖 `resetsAt`，是唯一「按时间自然恢复」的通路。实测 `model-quota.json` 只有 `openai@gpt2 {usedPercent:0}` 一条。

### 1.5 完整时序（一次真实 jarvis run）

`state.db` conv 145256，2026-10-27 10:40:52 起：

1. 起点 `index=0`，模型 `openai/gpt-6.1-sol`。失败 3 次（2s/4s/8s 退避），`failures=3 ≥ after` → `advance`，`live.run.modelFallback = {index:1, failures:0}`（`generation.ts:604`）。
2. 第 2 条 `openai#gpt2/gpt-6-luna`（`accountModels` 把 sol 换成 luna）。400 错误仍被重试 3 次（16s/32s/65s）→ advance。
3. 第 3 条 `gw/qwen3.8-max`：首败等 129s，次败等 257s。
4. 链继续到 `gw/gemini-3.8-flash`、`gw/gemini-3.7-flash`、`gw/qwen3.8-omni-flash`、`rightapi-glm/glm-5.3-flash`。总 21 次尝试、约 9 分钟，最终 `Model fallback chain exhausted (3 consecutive failures per model): Connection error.`
5. `endRun({status:"unanswered", reason:"model_error"})`（`generation.ts:610-620`）→ 无 answer entry → 渠道无内容可发。
6. `finish()`（`index.ts:1380-1390`）调 `watch.record()` → 整条链 `hold(600s)` → 600s 后重来一遍。

**同一机制的成功路径**（run 最终在第 index 条成功）：`keys.slice(0,index)` 全部 `hold("fallback-used")`。所以「一次成功」也会把前序模型罚站 10 分钟，且每个新 run 续期——这就是 gw 三模型 `failures=14`、日志里 `until` 每几分钟刷新一次的原因（`harness.log` 15:58:23 / 16:05:24 / 16:39:34 / 16:48:26 / 16:49:45 UTC 三连 warn）。

### 1.6 回退时是否丢缓存

- **run 内不丢**：`live.run.modelFallback` 把索引固定在 run 上，`harness.ts:238-239` 每条请求都从同一 index 取模型；`index.ts:730-731` `configure()` 在有 live run 时直接 return，所以运行中链不变。
- **跨 run 必丢**：`generation.ts:816-823` `startRun()` 整体替换 `live.run`，`modelFallback` 归零 → 每条新消息从主模型重来。若主模型与上一轮成功的模型不同（不同 provider / 不同模型 id），prompt cache 前缀不共享，`cacheRead` 归零。
- **重试会污染前缀（次要）**：`recovery.ts:59-72` 在瞬时网络重试时向转录追加 `yonder.runtime-note`（`NETWORK_NOTICE` 文本，user role）→ 该 run 后续请求的前缀变了。有 `networkInterrupted` 去重，每 run 最多一次。
- 目前**没有任何「缓存亲和」概念**：`model-gate.order()` 只看健康与配额，不看「上一次谁成功」「谁便宜」。OpenRouter 用 sticky routing 解决的正是这个问题（见 §4.2）。

---

## 2. 主人尚未提交的改动与两份提案

### 2.1 `git diff`（工作区，未提交）

| 文件 | 改动 |
|---|---|
| `packages/core/src/runtime/model-chain.ts` | 链顺序由 `primary → accounts → models` 改为 `primary → 第一个 fallback model → accounts → 其余 models`：`entries.push(...modelEntries.slice(0,1), ...accountEntries, ...modelEntries.slice(1))`，注释「Preferred order: primary → first fallback model (WorkBuddy) → other accounts (GPT2) → the rest.」 |
| `packages/core/src/runtime/model-watch.ts` | 探针 `maxTokens: 8` → `512`，注释「Reasoning models spend the budget thinking before any visible text: a tiny cap makes every probe an empty completion, so a healthy key can never clear its hold. 07 §6.1.」 |
| `packages/core/src/runtime/model-chain.test.ts` | 用例改名 `"runs the first fallback model before other accounts"`，期望链由 `[sol, openai#gpt3/sol, rightapi-glm]` 改为 `[sol, rightapi-glm, openai#gpt3/sol]` |
| `proposals/local-model-gateway.md` | +191 / −94 |
| `.workbuddy-ai/memory/2026-10-27.md` | 当日记忆 |

未跟踪：`model-chain.ts.bak-order-20261027`、`proposals/workbuddy-hub-integration.md`、`proposals/unified-client/`、`.pi/`。

### 2.2 两份提案的意图

- **`proposals/local-model-gateway.md`**（365 行）：把 `~/Documents/github/freellmapi`（FreeLLMAPI v0.13.2，launchd `com.zoran.freellmapi`，127.0.0.1:3001）当成唯一本机模型网关，yonder 只加一个 `gw` provider（`api: openai-completions`、`authHeader: true`），34 个上游不写进 `yonder.yaml`。明确的分权原则（§3.2）：**同一模型 id 内部的多渠道链/冷却/额度由 freellmapi 负责，模型 id → 模型 id 由 yonder `fallback` 负责**，「同一渠道失败不重试，直接下一个渠道。yonder 侧 SDK 重试已为 0（07 §6.1），不叠加」。§6.1.1 把 15 个 fallback 块统一成 `gw/qwen3.8-max → gemini-3.8-flash → gemini-3.7-flash → qwen3.8-omni-flash → rightapi-glm`，`after: 3`，付费兜底放最后。
- **`proposals/workbuddy-hub-integration.md`**（149 行，未跟踪）：在 freellmapi 之下再挂 `workbuddy2api-hub`（容器 `wb-proxy`，127.0.0.1:8788，多账号 OAuth + 设备指纹 + 签到），铁律「账号池只在 hub 里，模型池只在 freellmapi 里」。已记录一个**假阳性健康检查**：只打 `/v1/models`、不打推理，无账号时推理返回 503 `no usable account for realm 'intl'`。yonder 侧把 `main` 的 owner profile、`presets/simple.yaml`、`presets/default.yaml` 主模型改成 `gw/deepseek-v4.1-flash`。

### 2.3 主人在解决什么

三条同时进行：

1. **降低「先换号」的优先级**：原来同一模型换 ChatGPT 账号排在换模型之前，而 gpt2 账号经常是「订阅共享额度用尽」，白等 100s+。现在先跳到 WorkBuddy 免费池。
2. **修探针死锁**：`maxTokens: 8` 让推理模型的探针永远返回空 → `ok` 判定失效 → 健康模型无法解除 hold。
3. **清理链路**：把两个 gemini 免费模型踢出链（备份 `pre-nogemini-20261027`），只留 deepseek + qwen3.8-max + qwen3.8-omni + rightapi-glm。

**这三条都是对症的，但都没有触及 §1.3 的退避放大和 §1.4 的 hold 续期**——所以改完之后「慢」和「偶发无回复」仍然存在（本次实测数据即改动后的状态）。

---

## 3. 本机实证：为什么「没有回复」

数据源：`~/.local/share/yonder-harness/home/.yonder/state.db`（注意同目录 `home/state.db` 是 0 字节空文件，真库在 `.yonder/` 下），只读 `file:state.db?immutable=1`。时间窗：近 3 天（截至 2026-10-27 14:52 EDT）。

### 3.1 run 结果分布

`pi.run-receipt` 共 **594** 次 run：

| settlement | 次数 | 占比 |
|---|---|---|
| `done` | 569 | 95.8% |
| `unanswered / model_error` | 18 | 3.0% |
| `unanswered / aborted` | 7 | 1.2% |

→ 每 30 条消息约 1 条完全没回复。

### 3.2 失败 run 明细

| 时间(UTC) | agent | profile | 尝试 | 跨度 | 终止原因 |
|---|---|---|---|---|---|
| 09:45 | hermes | default | 13 | 554s | `Model fallback chain exhausted (3 consecutive failures per model): Connection error.`（sol×3 → rightapi-glm×6 → claude-sonnet-5-5×3）|
| 10:40 | — | jarvis | 21 | ~9min | 同上（sol×3 → gpt2/luna×3 → qwen3.8-max×3 → gemini-3.8×3 → gemini-3.7×3 → omni×3 → rightapi-glm×1）|
| 11:31 | main | owner | 52 | 1136s | `429: {"message":"All models exhausted: 1 route checked (1 rate-limited or on cooldown)… Soonest reset ~8h."}` |
| 11:34 | hermes | default | 40 | **6630s** | 同上 429 |
| 14:16 | main | owner | 27 | 1285s | `Connection error.` |
| 14:58 | — | hermes-learn | 1 | 8s | `The ChatGPT user has reached their Subscription Sharing usage limit.` |

### 3.3 尝试次数与耗时

- **单次 attempt**（853 次）：p50 **10s**、p90 40s、p99 105s、max 221s，**无一次 > 240s**。
- **run 跨度**（含成功）：p50 89s、p90 **2072s**、p95 **6630s**、p99 8593s。
- **成功但极慢**：main 09:59 = 82 次尝试 / 2272s；coding 10:11 = 64 次 / 2072s；gpt-senpai 11:03 = 22 次 / **7878s**。

结论：慢不是「上游单请求挂死」，而是**多次失败 × 指数退避**串起来。这也说明「没有超时」目前是潜在风险而非当班主因（但仍应补，见 §5 F6）。

### 3.4 逐模型错误率（3 天内）

| 模型 | 尝试 | 错误 | 错误率 |
|---|---|---|---|
| rightapi-glm/glm-5.3-flash | 508 | 27（+16 aborted） | 5% |
| openai/gpt-6.1-sol | 87 | 39 | **45%** |
| gw/deepseek-v4.1-flash | 82 | 15 | 18% |
| gw/qwen3.8-max | 32 | 28 | **88%** |
| gw/qwen3.8-omni-flash | 32 | 32 | **100%** |
| gw/gemini-3.7-flash | 26 | 26 | **100%** |
| gw/gemini-3.8-flash | 22 | 22 | **100%** |
| openai/gpt-6.1-terra | 12 | 12 | **100%** |

→ 把 3 个 100% 失败 + 1 个 88% 失败的模型排在 5% 失败率的付费模型之前，是**配置问题**（提案里「免费优先」的代价）；而 `gpt-6.1-sol` 45% 的失败率是**上游配额问题**（ChatGPT 订阅共享限额）。

### 3.5 健康文件与日志

`<home>/.yonder/model-health.json`（mtime 12:58 本地）：

```
gw/qwen3.8-max@default         failures=14  reason=fallback-used  until=12:59:45 probeAt=12:59:09
gw/qwen3.8-omni-flash@default  failures=14  reason=fallback-used  until=12:59:45 probeAt=12:59:09
gw/deepseek-v4.1-flash@default failures=5   reason=fallback-used  until=12:59:45 probeAt=12:59:09
openai/gpt-6.1-terra@default   failures=3   reason=fallback-used  until=11:28:19 probeAt=11:29:07
openai/gpt-6.1-sol@default     failures=5   reason=fallback-used  until=11:17:25 probeAt=11:17:23
```

`harness.log` 里同一批 warn 反复出现（15:58、16:05、16:39、16:48、16:49 UTC），`until` 每次都是 `now+600s`。

**这解释了主人感知到的「回退不生效」**：链配了 4 个 gw 模型，但健康闸门把它们排到链尾，实际每次都在用付费的 rightapi-glm；而一旦 hold 到期，又会被重新尝试、再次失败、再次被 hold。用户既看不到「现在在用哪个模型」，也看不到「为什么慢」。

### 3.6 「没有回复」的确切机制

```
模型链耗尽 (generation.ts:610-620)
  → endRun({status:"unanswered", reason:"model_error"})
  → 无 answer entry（appendAssistant 只写 assistant 错误消息，不投递）
  → 渠道插件无内容可发
core 侧: index.ts:1444-1462 只写 state.activityIssue = {code:"model_error", since, runId}
plugins/ 侧: grep "activityIssue" → 零命中
```

`packages/core/src/runtime/ACTIVITY.md` 把 `blocked` 定义为「no current execution and a tracked terminal `activityIssue` exists」——设计上它是**可查询状态**，不是**可播报事件**。所以三个渠道（feishu / qq / wechat）都不会告诉用户「这一轮失败了」。

`index.ts:1468-1486` 对这类 run 只造一个 `runId: "unplaced:<id>"`、`text: ""` 的 `RuntimeRun` 交给 `onRun`——下游即使想播报也没有文本。

**判定**：这不是「回复没送达渠道」，而是**根本没有生成回复，且失败被静默**。

---

## 4. 业界参考

### 4.1 LiteLLM Router

- **三层失败语义分离**（这是最值得抄的部分）：`content_policy_fallbacks`、`context_window_fallbacks`、`fallbacks`（其余错误，含 RateLimitError）——按错误类别走不同的下一跳，而不是一条链兜所有错误。
- **冷却与阈值**：`allowed_fails`（默认 3，一分钟内失败次数超过就冷却）+ `cooldown_time`（默认 5s，`DEFAULT_COOLDOWN_TIME_SECONDS`）；可全局设也可**按 deployment 单独设**，「a flaky third-party endpoint can get a shorter fuse」。
- **按错误类型的重试策略**：`RetryPolicy(AuthenticationErrorRetries, TimeoutErrorRetries, RateLimitErrorRetries, InternalServerErrorRetries, …, DefaultRetries)`，最具体的字段优先；配套 `AllowedFailsPolicy`。
- **冷却作用在 deployment（单个账号/端点）上，不是整个 model group**：「The router isolates failures to specific deployments while keeping healthy alternatives available.」——对应 yonder 应该把 hold 粒度保持在 `provider/model@slot`（现状已如此），但**不要**把「未被选中」当成失败。
- 明确记录了一条与缓存相关的限制：回退到另一个 provider / 另一个 API key 时，**无法解密前序 provider 产出的加密 reasoning**——即回退本身有语义代价，不只是缓存代价。

### 4.2 OpenRouter

- **请求级 `models: [...]` 优先序**：第一个报错自动试下一个；默认**任何错误**都触发（上下文超长、内容审核、限流、宕机）；按最终使用的模型计费。
- **provider routing**：`sort`（price / throughput / latency）、`max_price`、`only`/`ignore`、`allow_fallbacks: false`——把「选哪家 provider」和「选哪个模型」分成两层。
- **缓存亲和（关键参考）**：`provider sticky routing`——「After a request that uses prompt caching, OpenRouter remembers which provider served your request. Subsequent requests for the same model are routed to the same provider, keeping the cache warm.」这正是 yonder 缺的「切回首选时怎么保缓存」的答案：**不是切回主模型，而是切回上一个让缓存热着的那个端点**。

### 4.3 Portkey（可选）

文档目录把 `Fallbacks`、`Automatic Retries`、`Circuit Breaker`、`Request Timeouts` 列为四个独立能力，Circuit Breaker 自述为「Automatically stop routing to unhealthy targets until they recover.」。具体阈值/半开参数**未核实**（未读其正文）。价值在于确认业界把这四件事拆成四个可配项，而不是一个 `after` 数字。

### 4.4 pi-ai 的 provider 抽象（框架已有的能力）

`node_modules/@earendil-works/pi-ai/dist/types.d.ts`：

- `ProviderRequestOptions { headers?, timeoutMs?, maxRetries?, maxRetryDelayMs? }`（`:86-104`，`maxRetryDelayMs` 默认 60000）
- `StreamOptions extends ProviderRequestOptions` 另有 `temperature / maxTokens / transport / cacheRetention / sessionId / websocketConnectTimeoutMs / metadata / samplingParams`（`:106-149`）
- `onProviderStreamEvent?: (data, model) => void | Promise<void>`（`:112`）——只读观测钩子，yonder 已用它读 `rate_limits`（`packages/core/src/runtime/models.ts:206-217`）
- 各 adapter 只在 `options.timeoutMs !== undefined` 时才设 HTTP 超时（如 `dist/api/openai-completions.js:197`、`dist/api/anthropic-messages.js:433`）；未设即 SDK 默认，注释写「OpenAI and Anthropic SDK clients default to 10 minutes」（`:86`）

→ **首包超时、总超时、按请求的重试策略都不需要改 pi-ai，只需要 yonder 把参数传下去。**

### 4.5 对照表

| 能力 | LiteLLM | OpenRouter | Portkey | yonder 现状 |
|---|---|---|---|---|
| 链式回退 | ✅ `fallbacks` | ✅ `models[]` | ✅ | ✅ `modelFallbacks` |
| 按错误类别分流 | ✅ 三类 fallbacks + RetryPolicy | ✅ 默认全触发 | ✅ | ❌ 全链同策 |
| 冷却 | ✅ `allowed_fails`+`cooldown_time`，可按 deployment | ✅ 内部 | ✅ 熔断 | ⚠️ 固定 600s，不分类 |
| 半开探测 | ✅ health check | ✅ | ✅ | ⚠️ 有，但探针失真 |
| 请求超时 | ✅ `request_timeout` | ✅ | ✅ `Request Timeouts` | ❌ 从不设置 |
| 缓存亲和 | ✅ cache-aware routing | ✅ sticky routing | — | ❌ 无 |
| 用户可见状态 | ✅ 错误体带 `model_group` | ✅ `model` 字段回传 | ✅ | ❌ 静默 |

---

## 5. 框架问题清单

### P0（直接造成「无回复」或「极慢」）

**F1 退避用 run 级 `attempt` 而非模型级 `failures`**
- 证据：`packages/pi-durable/src/harness/model-recovery.ts:26` + `pi-ai/dist/utils/retry.js:99-102`；实测 conv 145256 attempt 7→129s、8→257s。
- 影响：链越长越慢；5 模型 × 3 次的纯睡眠 ≈ 2900s，与实测 1136s/1285s/6630s 一致。**这是「回退很慢」的第一因。**
- 改法：`delay = retryDelayMs(policy, failures)`（模型级），或 `advance` 时用固定 200–500ms + 抖动。

**F2 有 fallback 时忽略 `retryable` 分类**
- 证据：`model-recovery.ts:18-19`；实测 400「订阅共享额度用尽」被重试 3 次（16s/32s/65s）。
- 影响：必然失败的 4xx 也烧 100s+；429 被当瞬时错误反复撞（52 次尝试的 run）。
- 改法：`retry = eligible && retryable && (advance || failures < after)`；不可重试错误立即 `advance`，429 读 `Retry-After` / `resetsAt` 后直接跳到下一模型。

**F3 `after` 一个数字兼两职**
- 证据：`schema.ts` `after: int>=1`，语义在 `model-recovery.ts:17-19`。
- 影响：`after: 3` 让每个模型先自我重试 2 次，对免费池（秒回 429）纯浪费。
- 改法：拆成 `retryPerModel`（默认 1）与 `advanceAfter`（默认 1，或按类别）。

**F4 `fallback-used` 罚站 + 每次续期 = 永久熔断**
- 证据：`model-watch.ts:95` `hold(keys.slice(0,index), "fallback-used", 600)`；`model-health.ts:66-79` 每次 `until = now + 600`；`model-health.json` gw 三模型 `failures=14`，日志 5 次 `until=now+600`。
- 影响：主人配的免费链长期被 gate 排到链尾，「配置形同失效」；且把「本轮没赢」与「坏了」混为一谈。
- 改法：只有**真正失败**的条目才 hold；「未尝试」不 hold；hold 时长按错误类别（429→`resetsAt`，5xx→30–60s，4xx/auth→长冷却并标注）。

**F5 探针失真（两个独立缺陷）**
- 证据：`model-watch.ts:111-130`；`maxTokens: 8`（工作区已改 512）；`ok = stopReason !== "error"`；失败只 `probed(60)` 不延 `until`（与 `docs/spec/07-runtime.md` §6.1「失败把持有延长到 now + hold」不一致）。
- 影响：健康模型无法解除 hold；限流模型被当坏模型。
- 改法：探针按错误类别分派；429 不清除也不升级，按 `resetsAt` 定时；探针预算 ≥ 512（已改）。

**F6 没有任何请求超时**
- 证据：`packages/pi-durable/src/harness/generation.ts:225-231` 的 `SimpleStreamOptions` 只设 `maxRetries: 0` + `signal`；`schema.ts` 无 `stream`/`timeoutMs`；全仓 `timeoutMs` 只出现在 codemode/env/types。
- 影响：目前未爆（max 221s），但一次挂死会吃掉整个 run 预算，用户全程无感知。
- 改法：`models.providers.<id>.timeoutMs` + 全局默认；首包超时用 `onProviderStreamEvent` 计时 + `AbortController`（yonder 已在用该钩子）。

### P1（让主人无法理解和干预）

**F7 失败对用户完全静默**
- 证据：`index.ts:1444-1462` 写 `activityIssue`；`grep activityIssue plugins/ packages/sdk/src` 零命中；`index.ts:1468-1486` 交给 `onRun` 的 `text` 为空。
- 影响：主人感知就是「发消息没回复」，无法区分「模型全挂」「配额用完」「渠道断」。
- 改法：见 §6.6。

**F8 gate 重排链与 `record()` 的索引错位**
- 证据：`index.ts:756-757` 交给 pi 的是 `watch.order()` 后的链；`model-watch.ts:52-67` `chainIndex()` 在拿不到 `liveIndex` 时用**未重排**的 `modelChain()` 找下标；`record()`（`:70-96`）也用未重排链。
- 影响：罚站错条目、`failures` 记错对象。
- 改法：把 order 后的链与 run 绑定（写进 `AgentDoc` 或 run 快照），`record` 只读那一份。

**F9 跨 run 无粘滞 / 无缓存亲和**
- 证据：`generation.ts:816-823` 新 run 重置 `modelFallback`；`model-gate.ts` 只按健康+配额排序；无 `cacheRead` 参与的排序。
- 影响：每条新消息都可能撞一个刚挂的主模型（45% 错误率），付出一次冷启动 + 一次缓存全失效。
- 改法：会话级 sticky 窗口（见 §6.5）。

### P2（可延后）

**F10 `configure()` 在有 live run 时静默 return**（`index.ts:730-731`）
- 影响：常驻 Agent 连续消息期间，健康变化不会重新注入链。当前被「每 run 结束都会重新 configure」掩盖，属于隐患。

**F11 每次 run 重建 Models 实例**（`index.ts:264-288`）
- 影响：provider 实例不共享，连接池/keep-alive 复用不了；对延迟的影响**未核实**（未测）。

**F12 `NETWORK_NOTICE` 注入改变前缀**（`recovery.ts:59-72`）
- 影响：每 run 最多一次，代价小，但会打断 prompt cache 前缀。

---

## 6. 目标机制草案

### 6.1 per-agent 回退组合配置形状

保持向后兼容（旧 `models`/`accounts`/`after` 继续可用），新增显式链与按类别策略：

```yaml
model: openai/gpt-6.1-sol
fallback:
  # 有序链：模型 / 账号槽 / 组，逐项尝试
  chain:
    - openai#gpt2/gpt-6-luna          # 同 provider 换号（订阅额度）
    - gw/deepseek-v4.1-flash          # 免费池
    - rightapi-glm/glm-5.3-flash      # 付费兜底
  retry:            # 每个模型自身的重试次数，按类别
    transient: 1    # 5xx / 连接错误
    rateLimit: 0    # 429：不重试，直接换（有 Retry-After 则排到队尾而不是丢弃）
    permanent: 0    # 401/403/400/额度耗尽
  advanceAfter: 1   # 连续失败几次判定「这个模型这轮不行」
  cooldown:         # 与错误类别绑定，替代单一 hold
    rateLimit: reset  # 用 rate_limits.resetsAt / Retry-After，缺失则 300s
    serverError: 60
    timeout: 120
    auth: 3600
  probe:
    interval: 60
    maxTokens: 512
  timeouts:
    firstTokenMs: 20000   # 首包
    totalMs: 180000       # 单请求总时长
  sticky:
    minutes: 15           # 上一次成功的条目在多长时间内优先
```

字段落点：`packages/core/src/config/schema.ts` 的 `SessionModelsSchema`（新增可选键，旧键保持）；`modelChain()` 增加 `chain` 分支；`modelRecovery()` 增加 `retry`/`cooldown` 入参。`docs/spec/07-runtime.md` §6.1 属设计变更，需维护者批准后再改。

### 6.2 健康状态的共享方式

三层，各有明确边界：

1. **进程内（权威）**：`ModelHealth` 单实例（现状 `index.ts:163-176` 已如此）。所有会话、所有 run 共享同一张表——这点现状是对的，问题在写入策略不在共享。
2. **跨进程/重启**：`<home>/.yonder/model-health.json`（现状已有，原子写 0600）。补三件事：
   - 记录 `errorClass`（`rate_limit` / `auth` / `server` / `timeout` / `unknown`），不只是 `reason`；
   - 记录 `attempted: boolean`，区分「试过且失败」与「本轮未尝试」；
   - `failures` 改为**滑动窗口计数**（如最近 10 分钟），而不是只增不减的累计值（现状 14 这个数字已经失去意义）。
3. **对外只读投影**：`Runtime.modelStatus()`（现状 `index.ts:815-840`）补 `health: {key, errorClass, cooldownUntil, source: "run"|"probe"}[]`，让渠道插件和 TUI 能显示「现在哪些模型在冷却、为什么」。**只读，不让插件写**。

不建议做跨机器的共享状态（多机各自本地池，语义不同）；若将来要，另立提案。

### 6.3 首包超时与总超时

- **总超时**：`StreamOptions.timeoutMs`（pi-ai 已支持，`types.d.ts:86-104`）→ 透传到 adapter 的 HTTP 客户端。默认按模型类别给：推理模型 180s，普通 90s。可被 `models.providers.<id>.timeoutMs` 覆盖。
- **首包超时**：pi-ai 没有现成字段，用已有钩子实现——`onProviderStreamEvent` 观测到第一个 `text_delta`/`thinking_delta`/`tool_call` 事件的时间戳，超过 `firstTokenMs` 就 `AbortController.abort()`。yonder 已经在同一个钩子上读 `rate_limits`（`models.ts:206-217`），不需要新机制。
- **失败归类**：abort 归 `timeout`（可重试 1 次、冷却 120s），不归 `model_error`（现状会把整条链罚站）。
- **注意**：`model-watch.ts:125` 的探针已有 30s 独立超时，保持不动。

### 6.4 熔断与半开探测

状态机按 `provider/modelId@slot`：

```
closed  --(N 次同类别失败)-->  open(cooldown 按类别)
open    --(到期)-->            half-open(只发一次探针)
half-open --(成功)-->          closed(清空计数)
half-open --(失败)-->          open(指数退避：60s → 300s → 900s，上限 1h)
```

关键规则（都是对现状的修正）：

1. **只有真正失败的条目才进 open**。「本轮未获胜」不是失败（修 F4）。
2. **冷却时长按类别**：429 用上游给的 `resetsAt`/`Retry-After`；5xx/timeout 短冷却；auth 长冷却并置 `activityIssue`，提示「需要重新登录」。
3. **半开探测不能挡住主流程**：探测中的条目在新 run 里排第 2 位（不是第 1），并带 `firstTokenMs: 8000` 的短超时——成功就在本轮升为首选，失败就立即换、代价 ≤8s。
4. **探针结果要能被真实请求推翻**：用户 run 里某条目成功，立刻 `clear()`（现状 `record()` 已对 `index<=0` 这样做，扩到「任何被实际使用并成功的条目」）。

### 6.5 切回首选时怎么尽量保住 prompt 缓存

按「代价从低到高」四步，全部在 run 边界执行（不在请求中间切换，避免前缀半途变化）：

1. **run 内绝不换**（现状已满足：`generation.ts:580-604` 的索引冻结在 `live.run`）。这本身是最强的缓存保护。
2. **会话级 sticky（新增）**：记住「本会话上一次成功的 `provider/model@slot`」，在 `sticky.minutes` 内优先用它开新 run——而不是机械回到主模型。这正是 OpenRouter 的 sticky routing 思路：缓存热的是**端点**，不是「主模型」这个抽象。
3. **切回主模型前先探针**：主模型冷却到期时，先用一次 8s 短超时探针验证，成功才让下一条新消息从它开始；失败则继续 sticky，不浪费一次冷启动。
4. **保持 `sessionId` 稳定**：`generation.ts:228` 已经在传 `sessionId: await ensureProviderSessionId(...)`；确保回退/切回时**不重建** sessionId（同一 provider 内），否则 provider 侧缓存键会变。
5. **可观测**：把 `pi.usage` 里的 `cacheRead` 计入 `modelStatus()`，让「这次回退多花了多少钱」可查。代价估算：一次跨 provider 回退 ≈ 一次全量 `input` 重算，对 100k 上下文按 `gpt-6.1-terra` 的 $1/M 约 $0.1。

### 6.6 用户可见的状态

三档，都用现有设施，不新增存储：

| 时机 | 呈现 | 数据来源 |
|---|---|---|
| run 开始、首选被冷却 | 一条极短消息或卡片副标题「正在换用 `gw/deepseek-v4.1-flash`」 | `applyConfiguration` 时 `chain[0]` vs `profile.model` 不同即可判定 |
| run 结束、发生过回退 | 「本轮由 `rightapi-glm/glm-5.3-flash` 完成（首选 `openai/gpt-6.1-sol` 额度受限）」 | `pi.model-attempt` + `pi.run-receipt`，已有数据 |
| run 失败（链耗尽） | **必须发**：「模型都不可用（`model_error`），这一轮没有完成。原因：…。要不要换模型重试？」 | `activityIssue`（现状只写不播） |

落地方式：`plugins/channel-*` 读 `Runtime.modelStatus()` / `onRun` 的 `RuntimeRun`（补一个 `modelPath: {attempts, used, fallbacks}[]` 字段），而不是让 core 直接调渠道 API——保持 core 不依赖插件。

**最低成本的止血**：先把「链耗尽」这一条发出去。`index.ts:1444-1462` 已经把 `code/since/runId` 写好了，只缺一个播报方；这能把「静默失败」变成「明确失败」，对主人体验的改善远大于调参数。

### 6.7 落地顺序与验收

1. **P0-a（1 处改动，最大收益）**：`model-recovery.ts:26` 的 `delay` 改用 `failures`。验收：5 模型链的失败 run 跨度从 ~1300s 降到 ≤300s（用真实模型跑一次全挂场景，或读 `pi.model-attempt` 的 `retryAt` 间隔不再出现 129s/257s）。
2. **P0-b**：`retryable` 在有 fallback 时也生效 + 429 不重试。验收：`pi.model-attempt` 中同一模型不再出现 3 条 `action: "retry"` 的 400/429 记录。
3. **P0-c**：`record()` 只 hold 真正失败的条目，冷却按类别。验收：`model-health.json` 不再出现 `reason: "fallback-used"`；健康条目 `failures` 不随无关 run 增长。
4. **P0-d**：`timeoutMs` + 首包超时。验收：构造一个不返回首包的端点，run 在 `firstTokenMs` 内换模型。
5. **P1-a**：失败播报（`activityIssue` → 渠道）。验收：手工把链全部指向一个坏端点，用户在飞书收到一条失败说明。
6. **P1-b**：`chainIndex` 与 gate 顺序统一。
7. **P2**：sticky + `cacheRead` 可观测；Models 实例复用。

每步都遵守 `AGENTS.md`：只改涉及路径、测试用真实模型 `openai/gpt-6-luna`、缺凭据就跳过并写「未测」。

---

## 7. 未核实 / 未测

- **未核实**：渠道侧是否有其他补偿提示（我只确认 `plugins/` 无 `activityIssue` 引用，未逐一读 24 个插件的投递路径）。
- **未核实**：`home/state.db`（0 字节）与 `.yonder/state.db` 的历史关系（推测为旧路径残留）。
- **未核实**：Portkey 熔断的具体阈值/半开参数（只确认功能存在与其一句话描述）。
- **未核实**：freellmapi 的 429 `resetsAt` 来源（`Soonest reset ~8h` 是它自己的估算，未读其源码）。
- **未测**：工作区未提交改动是否通过测试（未运行 `npm test`）；`model-chain.test.ts` 的期望值只做了静态阅读。
- **未测**：`models.providers.gw` 从 `auth.json` 取 key 的真实链路（提案 §6.1 已注明未实跑，但 §3.4 的 508/82 次真实调用说明 gw 确实通了）。
- **未测**：`resolveModels` 每次重建 Models 对延迟的实际影响（F11）。
- **未核实**：`docs/spec/07-runtime.md` 关于「探测失败延长 hold」的表述与 `model-health.ts:91-101` 实现的差异，是设计已更新还是实现漏改——需维护者确认（属设计文档，我不能自行判定）。