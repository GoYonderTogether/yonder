> 证据材料，结论已并入 [design.md](../design.md)

# Yonder fork 已移植到 pi v1.4.0 并推送

**Commit:** `6da2e0ec7`，已推送到 `origin yonder/1.4`（v1.4.0 之上单个提交，57 个文件，+3712/−305）。`git diff v1.4.0 --stat` 里没有多余文件，也没有残留冲突标记。

## 各项修改的处理

| 修改 | 处理 | 对接的 1.4 API |
|---|---|---|
| D28 beforeAgent | 保留 | `agent.ts` / `harness.ts` / `submissions.ts`；`admitSubmission` 在 1.4 返回对象，compaction 里改取 `.id` |
| D29 RunReceiptDoc | 适配 | `defineDocFamily` 必须声明 `checkpointWhen`，已加 `() => true`；`endRun` 改为 async 并带 `conversationId` |
| D49 steer / interrupt | 保留 | `run.resumeOnInterrupt` 沿用 1.4 的 `LiveState`；最终边界在 `answer()` 里先消费 steer |
| D44 shouldRetry | 保留 | `model-recovery.ts` 与 1.4 的 `sleepUntil` 共用 |
| 模型 fallback 链 | 适配 | 1.4 的 `sleepUntil` 会结束当前调用。恢复时由 host 重新解析 run 冻结的模型绑定（`harness-models-resolver.test.ts` 8/8） |
| Compaction fallback + `backgroundAtTokens` | 适配 | 1.4 新增了 `compactionPolicy(settings, model)` 做按模型合并，它丢掉了 `backgroundAtTokens`。我在合并里补回，修好了 1 个失败测试 |
| `pi.model-attempt` | 保留 | |
| `pi.model-observation`（T61） | 保留 | 在 `generation.ts` 里由 `observeModelAttempt` 调用；`packages/ai` 的 `utils/observation.ts` 负责 provider 侧 |
| T63 显式凭据 + `resolveModels` | 保留 | `packages/ai` 的 `auth/*`、`models.ts`、各 provider |
| `NodeExecutionEnv.localSpawn` | 保留 | `env/node.ts`，`LocalProcessSpawn` 导出 |
| tool-search 相关性 | 保留 | `search.ts` |
| 被丢弃的修改 | 无 | |

## 关键冲突决定

我接手时，冲突标记已由上一位 agent 清理完，只剩索引里的 UU 状态。下面是我复核后的结论，没有重新解决冲突。

- **generation.ts**：保留 Yonder 的 `observeModelAttempt` 包装和 fallback / shouldRetry 流程，叠加在 1.4 的 `sleepUntil` 退避上。
- **scheduler.ts**：以 1.4 的重写（+820 行）为底，只叠加 Yonder 的 interrupt 与 fallback 改动。
- **compaction.ts**：采用 1.4 的 `sleeping` + `sleepUntil` 重试，叠加 Yonder 的 fallback 链和 `backgroundAtTokens`。
- **submissions.ts**：配合 1.4 的 `admitSubmission` 新返回值。

## 测试修改

沿用 1.3 fork 的先例：`chat-support.ts` 里的 `transcriptEntries` 过滤掉 `pi.model-observation`，测试用 `import { transcriptEntries as allEntries }`。

- **用先例 helper 的文件**：`harness-input-entries`、`structured`、`tools`、`tools-recovery`、`inbox`。
- **`harness-events`**：在事件过滤里排除 observation 的 `entry_appended`，并加了一行说明注释。
- **`harness-input-entries`**：`entry_appended` 的查找限定为 `chat.message`，`pi.model-attempt` 也一并过滤。
- **inbox 里的 "Session line" 超时**：这不是 sleep/wake 或 interrupt 的 bug。观察结束的 commit 现在排在 `onYield` 之前，原测试在答案出现前就占住了 line，把这个 commit 堵死了。我改成在 `onYield` 钩子里占住 line，仍然验证"边界 commit 排队期间切换 followUpMode"。断言没有削弱。
- **没有放宽任何行为断言。**

## 命令与结果

| 命令 | 结果 |
|---|---|
| `npm run check` | 通过 |
| `./test.sh`：durable | 1384 通过 / 4 跳过 |
| `./test.sh`：agent、tui 等 | 579、223（3 跳过）、55 等全部通过 |
| `packages/env` 在 `npm run build:daemon` 后 | 85 通过 / 2 跳过 |
| `./test.sh`：ai | 1476 通过，1 失败：`cache-retention.test.ts` |
| `./test.sh`：coding-agent | 2712 通过，1 失败：`mcp-command.test.ts` |

**这两个失败不在 Yonder 改动范围内**（这些测试文件相对 v1.4.0 没有改动）：

- **`cache-retention.test.ts`**：`MODELS.opencode[...]` 里有模型是 undefined。`opencode*.json` 里已经没有 `deepseek-v4-flash`，是从线上目录拉下来的数据漂移。
- **`mcp-command.test.ts`**：期望 `ENOENT`，本机得到 `EACCES`，是本机 PATH 环境差异。

另外，`packages/ai` 的 `src/providers/data` 原本是旧数据（被 gitignore），导致 8 个 ai 测试失败。我跑了 `npm run hydrate-model-data` 刷新后，这 8 个失败消失。

## Yonder harness 升级到 1.4 需要做的修改

- **beforeAgent / shouldRetry**：签名没变。`shouldRetry` 失败的详情文案是 `Model retries exhausted (N retries): …`。
- **RunReceiptDoc**：`endRun` 现在是 async，自定义调用方要 `await`，并传入 `conversationId`。
- **`defineDoc` / `defineDocFamily`**：1.4 要求每个文档定义必须带 `checkpointWhen`（`harness-inbox` 里的测试 `Marker` 也因此补了）。host 里自定义的文档都要补。
- **`resolveModels`**：1.4 的 `sleepUntil` 会让调用结束。恢复时 host 必须重新解析 run 冻结的模型绑定，不能依赖内存里的 `Models`。
- **`LocalProcessSpawn`**：用法不变，参见 `FORK.md` 对应章节。
- **事件流**：`pi.model-observation` 会作为 `entry_appended` 事件出现。host 的 UI 或转录逻辑需要过滤它，也要过滤 `pi.model-attempt`。
- **SQLite schema**：1.4 改了 `storage/sqlite/migrations.ts` 和 `schema.ts`，新增了 IndexedDB 存储。**未核实**：Yonder 的旧库是否能直接迁移。我没有拿真实的 1.3 库做过迁移测试。

## FORK.md

`packages/durable/FORK.md` 已在同一个提交里，基线写作 v1.4.0。

## 风险（均未核实）

- 上面说的 SQLite 旧库迁移。
- 与 `pi-ai` fork 产物版本的配对：只同步 durable 不完整，FORK.md 里已写明。
- `check-entry-graphs.mjs` 有 10 行预算调整，我只确认 check 通过，没有逐行核对必要性。
- 没有在真实 Yonder harness 里跑过集成。