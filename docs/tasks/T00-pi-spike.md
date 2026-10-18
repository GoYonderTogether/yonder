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
