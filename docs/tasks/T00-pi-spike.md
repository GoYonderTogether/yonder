# T00 验证 pi 能力

**目的**：在写内核之前，用真实模型确认 07 规范依赖的每一项 pi 能力都成立；不成立的，把替代方案写回规范。这是唯一允许改 `docs/spec/07-runtime.md` 的实现任务。

**依据**
- `docs/spec/07-runtime.md:1-92`（全文）
- `docs/spec/02-sessions.md:29-33`（§1.2 并发）
- `docs/spec/05-security.md:33-56`（§3–4）

**路径**：`spike/`（任务结束后删除，只保留结论）、`docs/spec/07-runtime.md`、本文件。

**逐项验证**（每项写一个最小脚本，用 `@earendil-works/pi-durable` 与 `pi-ai` 的当前最新版，记下精确版本号）
1. 用 `auth.json`（pi 格式）里的 ChatGPT OAuth 凭据调用 `chatgpt/gpt-6-luna`；凭据过期时自动刷新并写回文件。用 `models.json` 结构的配置接入一个 OpenAI 兼容端点（DeepSeek）。
2. `Harness.open` + SQLite 存储；同一个 SQLite 文件里能否用前缀 `pi_` 与自建的 `y_` 表共存（07 §2）。
3. `conversation.configure` 设置模型、工具、`modelTools`、`instructions`、`cwd`。
4. 扩展的 `sections` 能读到 conversation 的自定义文档（07 §3 的 `yonder.session`）。
5. `submit` 的 `input` 与 `write`：`write` 带 `model` 时，下一次运行模型能否看到这条消息（07 §3）。
6. `whenBusy: followup` 与 `steer` 行为。
7. 钩子：`beforeTool` 拦截并返回原因；在钩子里或用 `abort()` 结束一次运行，记下哪种可行（07 §5 最后一条）。
8. tool-search：工具在 `tools` 中但不在 `modelTools` 中时，模型能否按需加载。
9. 子会话：工具内创建由工具任务拥有的 conversation，发起方 `abort` 时子会话一并中止。
10. 自动压缩与 `modelOverrides`：构造一个上下文窗口小的模型配置触发一次压缩。
11. `pi.usage` 在一次运行前后的差值能否算出本次运行的用量。
12. 流式事件：能否拿到文本增量和工具开始/结束（06 §3）。
13. 本机 `NodeExecutionEnv`：`read`、`write`、`bash` 工具在指定 `cwd` 下工作。

**产出**
- 本文件末尾"结果"一节：逐项写"成立/不成立 + 用到的确切 API 名 + 版本号"。
- 不成立的项：在 `07-runtime.md` 对应位置改成可行方案，并在 `docs/decisions.md` 记一条。

**验收**：13 项都有结论；07 规范里不再有"由 T00 确定"的字样。

## 问题

（无）

## 结果

版本：`@earendil-works/pi-durable@1.3.0`、`pi-ai@1.3.0`、`chord@1.3.0`；Node 24.21（直接运行 `.ts`）。模型 `openai/gpt-6-luna`（ChatGPT 登录），另用 `deepseek/deepseek-flash` 验证按配置接入。脚本在 `spike/`，已删除。

| # | 结论 | 用到的 API |
|---|---|---|
| 1 | 成立。ChatGPT 用内置 `openai` 供应商的 OAuth；把 `expires` 改成过去后自动刷新并写回文件，access 与 refresh 都被轮换。DeepSeek 用 `createProvider` + `envApiKeyAuth` + `openAICompletionsApi` 按配置接入 | `createModels({ credentials })`、`openaiProvider()`、`provider.auth.oauth.login(…, { getDeviceId })` |
| 2 | 成立。同一文件、同一连接上 `pi_*` 表与 `y_probe` 共存，pi 提交后宿主行仍在 | `openNodeSqliteDatabase`、`SqliteStorage.open(db, { prefix: 'pi_' })` |
| 3 | 成立。`tools=[read,bash]`、`modelTools=[read]` 时模型只看到 read，bash 仍可被工具调用；`instructions`、`cwd` 生效 | `createConversation({ agent })`、`conversation.agent()` |
| 4 | 成立 | `defineDoc`、`init`、section 内 `input.read.snapshot(Doc, conversationId, ctx)` |
| 5 | 成立。`write` 带 `model` 后，下一次运行模型能答出其中内容 | `submit({ type: 'write', entry: { kind, data, model } })` |
| 6 | 成立。`steer` 并入当前运行、与它共享同一个回答；`followUp` 在之后单独回答。取值是 `followUp`（驼峰） | `whenBusy` |
| 7 | 成立。`beforeTool` 的 `block` 原因原样到达模型；`abort()` 结束运行，输入为 `unanswered`/`aborted`。钩子没有直接结束运行的返回值，改用 `afterTool` 返回 `control.terminate`（验证：运行在第 3 次后停止，状态 `done`，最终文字为空）。两种手段都写进 07 §5 | `hook(ToolTask, { beforeTool, afterTool })`、`conversation.abort()` |
| 8 | 成立 | `deferred: true`、`createToolSearchExtension()` |
| 9 | 成立。发起方 `abort` 后子会话没有存活任务；工具响应 `context.abortSignal` 时中止耗时 11 ms，不响应时要等工具自己结束 | `tx.createConversation({ ownership: { kind: 'task', taskId } })`、`api.conversation()` |
| 10 | 成立。把 luna 的 `contextWindow` 改为 9000 后自动产生 `pi.compaction`。**规范更正**：pi-durable 的 `compaction` 设置没有 `modelOverrides`，`modelOverrides` 属于 `models.json` 的供应商层，用来改模型的 `contextWindow` | settings `compaction`、`pi.compaction` 条目 |
| 11 | 成立。`pi.usage` 按 `provider/model` 累计，运行前后取快照即得增量 | `harness.snapshot(UsageDoc, id)` |
| 12 | 成立。有 `message_update`（文字增量）与 `tool_execution_start/end` | `watchEvents()` |
| 13 | 成立。read/write/edit/bash 在指定 `cwd` 下工作 | `NodeExecutionEnv({ cwd })`、`createCodingTools()` |

**写回规范**：`07-runtime.md` 按以上结论重写（存储共用连接、映射表的确切 API、运行上限的结束手段、模型组装规则、凭据与 ChatGPT 登录、`device-id`），不再有"由 T00 确定"。连带更新：测试模型名改为 `openai/gpt-6-luna`（AGENTS.md、decisions D9、tasks/README、T05、03、08）；08 的 home 目录加 `device-id`；T01/T04/T05/T11 的行号与说明；T04 增加 `runtime/db.ts`；decisions 新增 D11、D12。

**偏离规范之处**：无。

**凭据处理**：Yonder 用自己的凭据文件，单独登录 ChatGPT；只复制了 deepseek、siliconflow 两个 API key；没有读写 `~/.ai-being` 中三份配置以外的内容。
