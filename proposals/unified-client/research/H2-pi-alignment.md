> 证据材料，结论已并入 [design.md](../design.md)

# Yonder 对齐 pi：插件与核心子系统逐项清单

## 一、结论摘要

- **真正需要「照 pi 重构」的只有 8 处**：工具接口的 `promptSnippet/promptGuidelines` → `<rules>` 段、系统提示词按 key 分段、编辑工具族（hashline）、`find`/`ls`、web 正文落盘与分页、browser/codex/mcp 的懒加载与五条路径收口、context-files 加载链、codemode 接线。其余大多是「保留」或「合并」。
- **Yonder 已经比想象中更接近 pi**：`packages/pi-durable/src/harness/prompt.ts` 已实现与 pi `diffSystemPromptSections` 等价的补丁语义（`shown` + `null` 删段 + 顺序变化整段重发）；`process` 工具已等价于 pi-background-tasks；`describeCatalog` 的 `offer/search` 已等价于 pi 的 `deferred` + `tool_search`；`packages/cli/src/vendor/pi-footer.ts` 已是 pi 原版底栏（含 CH%）。
- **最大的一处浪费**：`packages/core/src/runtime/index.ts:508-525` 把所有提示词段**合并成一个 `key:"yonder"`、`tag:false` 的单段**，于是上面那套补丁机制形同虚设——任何一段文字变化都会重发整块 instructions，前缀缓存全废。
- **Yonder 独有的、pi 侧为零的东西**：多渠道（8 个 channel 插件）、身份/peer/委派、事件溯源 kernel、崩溃恢复、模型回退链与配额、memory/SOUL/USER、cron/devices/media/wechat-archive。这些不是「没跟上 pi」，是 pi 根本没有。
- **pi 有而 Yonder 完全没有的能力集中在 9 类**：会话树/分叉/导出、hashline 编辑族、LSP+ast-grep+codegraph、多 Agent 编排（worktree/fanout/council）、模型主动可逆折叠、todo 依赖图、命令级安全网、第二模型顾问、codemode。
- **不建议照抄的两处**：pi-lens 的 7 个常驻工具（Yonder 无 LSP 依赖，收益/成本不成立）、pi-goal-x 的 30+ 文件状态机（与 Yonder tasks/session 语义重叠）。

## 二、口径

- pi 侧基准 = `@earendil-works/pi-coding-agent` 本体（docs/ + dist/）+ `~/.pi/agent/settings.json` 里 13 个插件；生态里没装的包（rpiv-ask-user-question、pi-memory 等）只作旁证，不算「pi 侧对应物」。
- 「照 pi 重构」= 用户能感知的行为、提示词形状、工具契约与 pi 一致；不要求复刻进程结构或代码。
- 规模：**S** 单文件/局部改；**M** 跨 2–3 模块或需改 spec；**L** 新子系统或需重构执行链路。
- 本节所有 `file:line` 均已实际读取；标「（E1）」的来自已有盘点，未在本轮复验。

## 三、packages/core 逐子系统

### 3.1 tools（工具基座与工具集）

- **功能**：`packages/core/src/tools/` 13 个核心工具（`message_send`、`agent_ask`、`parent_ask`、`task_run`、`task_continue`、`session_list`、`session_read`、`identity_lookup`、`identity_link`、`skill_view`、`process` 等）+ 运行期注册的 `read`/`write`/`edit`/`bash`/`grep`/`tool_search`。
- **pi 侧对应物**：`read`/`bash`/`edit`/`write`/`find`/`ls`/`grep`/`codemode`/`tool_search`（core）+ pi-hashline 的 9 个工具；会话/身份/委派类在 pi 侧**无**（pi-subagents 只有 `subagent`/`bg_wait`/`contact_supervisor`）。
- **结论**：**照 pi 重构**（工具契约与编辑族）+ **保留**（会话/身份/委派）。
- **理由**：`packages/sdk/src/types.ts:300-306` 的 `Tool` 只有 `{name, description, parameters, capabilities, execute}`——**没有 `promptSnippet`/`promptGuidelines`**，所以 Yonder 插件无法像 pi 插件那样把「什么时候别用这个工具」写进 `<rules>` 段，只能全部塞进 description。用户能感到的差别：Yonder 的工具说明更长、更爱被误用（例如后台任务轮询），pi 那边这类纪律是独立短条目。
- **补充事实**：`packages/pi-durable/src/harness/types.ts:293-334` 的 `ToolRegistration` 已有 `deferred`、`outputLimits{maxBytes,maxLines,retain}`、`callers`、`replay`；`packages/core/src/runtime/catalog.ts:15-36` 的 `describeCatalog` 用 profile 的 `tools.offer`/`tools.search` glob 产出 `offer|search|capability-denied|not-selected`，与 pi 的 `exposure` + `tool_search` 语义等价。缺的是 SDK 层这三个字段的暴露。
- **缺口**：`find`、`ls` 不存在（`grep` 在 `packages/core/src/runtime/grep.ts:5`）。这直接导致 pi 的 `buildRules` 分支不同：pi 仅在没有 grep/find/ls 时才补 bash 规则，Yonder 永远处于「有 grep」分支。
- **规模**：**M**（加字段 + buildRules + 补 find/ls）；hashline 编辑族另计 **L**。

### 3.2 prompt（系统提示词装配）

- **功能**：`packages/core/src/prompt/index.ts` 的 `systemSections()`（`:131-172`）按 `prompt.sections` id 顺序拼装；`content.ts` 内置段全量约 11.9k tokens（E1）；`contributions()`（`:113-124`）按 `placement: "system" | "turn"` 分发 contexts；`turn` 文本（`:285-305`）把 `<turn>…</turn>` + 用户文本 + turn 段上下文拼进**同一条用户消息**。
- **pi 侧对应物**：`dist/core/system-prompt.js` 的 `buildSystemPromptSections()`（8 段、除 preamble 外都包 `<段名>`）+ `diffSystemPromptSections()` + `buildRules()`。
- **结论**：**照 pi 重构**。
- **理由**：三处用户可感知差异。①**没有段标签**：Yonder 输出是一段连续文本，pi 是 `<tools>`/`<rules>`/`<skills>`/`<project_context>`/`<cwd>` 分块——模型对分块的遵循度更高，且改一段不动其他段。②**补丁粒度丢失**：`packages/core/src/runtime/index.ts:508-525` 把 `options.sections()` 用 `"\n\n"` 拼成一个 `key:"yonder"`、`tag:false` 的单段，而 `packages/pi-durable/src/harness/prompt.ts:28-60`、`:123-141` 明明已实现了「只发变化段、`null` 删段、顺序变化整段重发」——能力在、没接上。③**没有 `<rules>` 段**：pi 恒有 `- Be concise in your responses`、`- Show file paths clearly when working with files` 两条（E1），Yonder 无。
- **另一处该删的**：`prompt/index.ts:141` 的 `runtime.discipline` 只在模型名匹配 `/^gpt-\d+(?:\.\d+)?-(?:luna|sol)$/u` 时注入——这是按模型名硬编码的提示词，pi 侧无对应机制，且该段只存在于 PR #88 分支（agent-parity §12.5）。**建议删除**。
- **规模**：**M**（拆 key 是机械改动；`<rules>` 依赖 3.1 的字段）。

### 3.3 runtime（运行期）

| 子系统 | 功能 | pi 对应物 | 结论 | 规模 |
|---|---|---|---|---|
| compaction | 阈值摘要，摘要小节同 pi 六段，`cacheRetention:"none"`（`packages/pi-durable/src/harness/compaction.ts:186`） | pi `compaction{reserveTokens:16384,keepRecentTokens:20000}` | 保留（已对齐），补尾偏折叠与缓存断点 | M |
| background | `bash` 15s 自动转后台 + `process`（status/log/wait≤15s/write/kill）+ 完成自动通知（`runtime/process.ts:15`、`runtime/background.ts:336-386`） | pi-background-tasks 2.6.10（bg_run/bg_status/bg_logs/bg_kill + `/bg` 命令族 + dock widget） | 保留；只需补 `/bg` 命令族与 widget | S |
| recovery | 崩溃后按事件重放 + 重启通知（`sessions/index.ts:357`、`prompt/index.ts:286-290` 的 version notice） | **无**（pi 单进程、无恢复） | 保留为 Yonder 特色 | — |
| model-chain / quota | 回退链 + 配额排序（`runtime/model-chain.ts:24-26`：`DEFAULT_FALLBACK_AFTER=3`、`HOLD=600s`、`PROBE=60s`；`runtime/index.ts:757-760` `watch.order(...)`） | pi 无（只有 `/scoped-models` 与 `/model` 手选） | 保留为 Yonder 特色 | — |
| effort | `resolveEffort`/`requestedEffort`（`runtime/effort.ts:20,46`） | pi `/thinking` 与 settings `thinking` | 照 pi 重构（暴露 `/thinking`） | S |
| limits / policy / auth / env | 单次运行限额、执行环境、认证 | pi `retry{maxRetries:3,baseDelayMs:2000,maxAgentDelayMs:60000}` | 保留；`retry` 默认值对齐 pi | S |
| codemode | **库在、未接线**：`packages/pi-durable/src/codemode/index.ts` 有导出，全 core/cli 无任何 `codemode` 引用 | pi `codemode{mode:"on",inlineBudget:3000}` | 照 pi 重构（接线） | M |
| attachments / images | 图片输入、附件解码（`runtime/attachments.ts:6,14`） | pi 原生图片输入 | 保留 | — |
| transcript / results / docs / activity / catalog / notifications | 转录视图、结果转换、用量文档、活动聚合、工具目录、通知落盘 | pi 有 usage/footer 但无通知与活动模型 | 保留 | — |

- **关键理由（compaction）**：pi 侧还有两件 Yonder 没有的东西——**尾偏折叠旧工具输出**与**缓存断点/保活**（billion-context 的 `STAGED_COMPRESS_GUIDANCE`、`cacheKeepalive.enabled`，E1）。用户能感到的差别：长会话里 Yonder 压缩一次就把前 20k 重写一遍，pi 那边旧工具输出先被替换成占位、前缀尽量不动，CH% 掉得慢。全仓 grep 无 `cache_control`/`keepalive`，确认为缺口。
- **关键理由（background）**：Yonder 的 `process` 描述里已写「Completion is delivered automatically; inspect only for a dependent step…, not in a polling loop」，与 pi-background-tasks 的 promptGuidelines 是同一套纪律，但 Yonder 只能靠长 description 传达，pi 靠 `<rules>` 段。这是 3.1 缺字段的直接后果。

### 3.4 kernel（内核）

- **功能**：`kernel/index.ts:49` `openKernel()` 组合根；事件溯源 store（`store.events.append` 幂等）、peer 会话、`tick`（`:13` `ticks()`）、terminal、home 初始化与离线管理（`home.js`/`home-management.js`）、workspace 与 skills 检查（`workspace.ts` `inspectSkills`）、observability、delivery。
- **pi 侧对应物**：**无**。pi 是单进程 + JSONL 会话文件，没有事件溯源、没有 peer、没有离线管理面。
- **结论**：**保留为 Yonder 特色**（这是多渠道多 Agent 的地基，pi 侧零对应）。
- **理由**：`plugins/channel-mcp/src/operations.ts:43-50` 已经把这层能力以 15 个 MCP 工具暴露出去（`sessions_open/submit/abort/close/command/get/list/transcript`、`identity_*`、`messages_send`），说明它是真实对外契约，不能按「pi 没有」就砍。
- **规模**：—（不动）。唯一建议：agent-parity §9 拟新增的 `session_send/open/abort/close/trace` 应与 channel-mcp 的 `sessions_*` **共用一份实现**，不要写两套。

### 3.5 sessions（会话）

- **功能**：`sessions/index.ts` 的 `open`(:407)/`close`(:268)/`command`(:115)/`resolveSession`(:101)/`notify`(:389)/`recover`(:357)；`command` 只支持 `model`/`status`/`compact`（`:128`「仅支持 model / status / compact」）。
- **pi 侧对应物**：`/tree`、`/fork`、`/clone`、`/import`、`/name`、`/export`、`/share`、`/copy`。
- **结论**：**照 pi 重构**（补会话树/分叉/导出）+ **保留**（多渠道会话模型）。
- **理由**：`packages/sdk/src/chat-commands.ts:1-19` 的命令集是 new/resume/model/status/compact/session/hotkeys/connect/channel/skills/stop/close/help——**没有 tree/fork/clone/import/export/share/copy/name**；`sessions/index.ts` 也无任何 fork 实现（全仓 `fork` 只出现在 pi-durable 的**文档 fork 语义**里）。用户能感到的差别：pi 里 `/fork` 能从任意一条早前消息开新分支、`/tree` 可以回退重来；Yonder 只能新开会话，历史上下文靠压缩摘要续，回退只能靠重发。
- **规模**：**L**（需要给 store 加分支写入 + `branchSummary` 摘要 + TUI 树视图；pi 的 `branchSummary{reserveTokens:16384,skipPrompt:false}` 也要一并照做）。

## 四、plugins/* 23 个逐项

### 4.1 逐包

**1. tasks**
- 功能：任务账本（create/update/list/…），`tasks-turn` 上下文每轮注入摘要，触发器。
- pi 对应：@juicesharp/rpiv-todo 2.15.0（`todo` 单工具 + `/todos` + `rpiv-todos` overlay + `blockedBy` 依赖图 + 快照写会话分支）+ pi-goal-x 0.34.0（目标/任务树）。
- 结论：**合并**（保留 Yonder 账本存储与跨会话可见性，工具面按 rpiv-todo 重写）｜规模 **M**
- 理由：pi 的 todo 是**单工具 + action 枚举**，Yonder 是一堆细粒度工具，模型选错工具的概率更高；pi 的 `blockedBy` 能表达依赖且成环被拒，Yonder 只能靠文本；pi 的 overlay 让用户一眼看到树，Yonder 只有每轮注入的摘要。另外 pi 的 8 条 guidelines（含「测试失败不得标完成」）在 Yonder 无处安放——需要 3.1 的字段。

**2. memory**
- 功能：9 个工具 + 6 个 skill + 预设 + 上下文（`memory-core`），状态在 `.memory/state.json`（`plugins/memory/src/bootstrap.ts:63,182,196`），后台整理并发 `memory.attention` 事件（`:220-225`）。
- pi 对应：**无**（13 个插件里没有 memory 插件；pi core 只加载 AGENTS.md）。
- 结论：**保留为 Yonder 特色**（吸收 hermes-experience）｜规模 **M**
- 理由：pi 侧的「记忆」就是 AGENTS.md + skills，模型靠 `read` 自己看。Yonder 有检索、有后台整理、有需要主人确认的提案——这是产品差异，不是落后。

**3. hermes-experience**
- 功能：行为/记忆/核心上下文 + 原生技能 + 复盘 + 待确认队列；`plugins/hermes-experience/src/store.mjs:64` 直接写 `MEMORY.md`/`USER.md`，pending 目录 `.hermes-pending`。
- pi 对应：**无**（最接近的是 pi-lens 的 skill 注册 + pi core skills）。
- 结论：**合并进 memory**（删掉独立包）｜规模 **M**
- 理由：它和 memory、context-files 三方写同一批文件：context-files 注入 `MEMORY.md`/`USER.md`，memory 管 `.memory/`，hermes-experience 又写 `MEMORY.md`/`USER.md`。用户能感到的差别是「同一个记忆在不同轮里内容不一致、谁赢取决于插件顺序」。这是最该收敛的一处。

**4. context-files**
- 功能：4 个 `placement:"system"` 上下文——`AGENTS.md`、`USER.md`、`SOUL.md`、`MEMORY.md`，只从 workspace 根读，带 scaffold 模板且未编辑过则不注入（`plugins/context-files/src/index.ts:5-13`）。
- pi 对应：`dist/core/resource-loader.js:116` 的 AGENTS 加载链。
- 结论：**照 pi 重构**（加载链）+ **删除** `memory-md` 段（交给 memory）｜规模 **S**
- 理由：pi 的链是 `AGENTS.override.md > AGENTS.md > AGENTS.MD > CLAUDE.md > CLAUDE.MD`，先放 `<agentDir>/AGENTS.md`，再从 cwd 逐级向上到根 `unshift` 前插（祖先在前、cwd 最后），并用 `findShadowedContextFile()` 去掉嵌套 linked worktree 的重复副本。Yonder 只读 workspace 根一个文件：用户在子目录跑、或仓库里有 `CLAUDE.md`、或用了 git worktree，就完全看不到规则——这是很硬的体感差异。Yonder 的 `USER.md`/`SOUL.md` 是 pi 没有的，保留。

**5. agent-presets**
- 功能：按 preset 定义 prompt 段、工具、插件、能力、渠道作用域。
- pi 对应：pi-subagents 的 `agents/*.md` 定义 + pi core 的 prompt 模板（`~/.pi/agent/prompts/*.md` → `/<文件名>` 命令）。
- 结论：**保留为 Yonder 特色**（借 prompt 模板的「文件即命令」写法）｜规模 **S**
- 理由：pi 没有「preset + 能力 + 渠道作用域」这层，它只有 agent 定义和 prompt 模板。Yonder 的 preset 是权限与渠道边界的载体，不能照搬。

**6. web-tools**
- 功能：`search`（Tavily，count/topic/time_range/include_domains/exclude_domains/depth）+ `extract` + `fetch`（`plugins/web-tools/src/index.ts:111-145`），结果**内联返回**。
- pi 对应：pi-web-access 0.45.0（web_search/source_check/fetch_content/get_search_content + 多供应商 + 结果按 `responseId` 落盘 + 四模式 + YouTube/GitHub/图片）。
- 结论：**照 pi 重构**｜规模 **M**
- 理由：三处体感差异。①pi 的结果**落盘**，长页面用 `get_search_content` 分页取；Yonder 内联返回，一次搜索就吃掉大段上下文，且事后想「再看那页的后半部分」只能重抓。②pi 支持多供应商与 `source_check`，单供应商挂了就没网搜。③pi 默认懒加载、常驻 0 token；Yonder 三个工具常驻。

**7. browser-skill**
- 功能：9 个工具（observe/snapshot/HTML/console/network/screenshot/status 等）+ skill，`spawn` 调 `bsk` CLI 与 `/usr/bin/open`（`plugins/browser-skill/src/index.ts:1,30,44,96`）。
- pi 对应：`~/.pi/agent/skills/browser-skill/SKILL.md`——**只是一个 skill**，零工具、零常驻 description。
- 结论：**照 pi 重构**（降级为 skill + 保留 1–2 个必要工具）｜规模 **M**
- 理由：同一套 `bsk` 能力，pi 侧模型读 skill 后直接用 `bash` 跑 `bsk`；Yonder 常驻 9 个工具 description。用户能感到的差别：Yonder 每轮多付几千 token，且模型更容易「调工具而不读手册」。

**8. native-automation**
- 功能：浏览器 + 桌面自动化（键盘/鼠标/窗口），skill + trigger。
- pi 对应：**无**（codex-computer-use-mcp 走 OpenAI 官方 app，不驱动用户桌面）。
- 结论：**保留为 Yonder 特色**｜规模 —
- 理由：这是主人「接管键鼠」的能力，pi 侧没有对等物。

**9. codex-tools**
- 功能：包装本机 OpenAI Codex Computer Use app。
- pi 对应：codex-computer-use-mcp 0.6.2（10 个 `computer_use_*`，全部 `exposure:"codemode"` + namespace）。
- 结论：**照 pi 重构**｜规模 **M**
- 理由：pi 把这些工具**只放进 codemode 命名空间**（`tools.computer_use_*`），模型看不到 10 条 description，只在写脚本时用；Yonder 常驻。功能相同、上下文成本差一个量级。

**10. mcp-client**
- 功能：连接 MCP server，把其工具挂进会话。
- pi 对应：**pi core 原生 MCP client**（`pi mcp add/list`、`/mcp`、`docs/mcp.md`，支持 stdio/HTTP、bearer-token-env-var、`/mcp` 里改 exposure）。
- 结论：**照 pi 重构**｜规模 **M**
- 理由：pi 是核心能力，有 `pi mcp add` CLI、有 `/mcp` 交互面板、能逐 server 设 exposure 与 enable/disable。Yonder 是插件，配置面更窄，且 MCP 工具默认全常驻。

**11. ui-companion**
- 功能：结构化卡片（present/result）。
- pi 对应：**无**（pi 1.4.0 core 与 dist 全无 `elicit`；rpiv-ask-user-question 未装）。
- 结论：**保留为 Yonder 特色**｜规模 —
- 理由：多渠道场景下卡片是刚需（飞书/Slack/Telegram 各自的卡片形态），pi 无渠道无对应物。

**12. clipboard**
- 功能：5 个工具 + `clipboard-redact` hook（macOS 剪贴板读写与脱敏）。
- pi 对应：**无**。
- 结论：**保留**｜规模 —
- 理由：C2 §5.3 已认定是生态没有的能力。

**13. cron**
- 功能：`cron_manage`/`cron_exec` + trigger（定时起会话/任务）。
- pi 对应：**无**（pi-background-tasks 只做后台执行，不做定时）。
- 结论：**保留为 Yonder 特色**｜规模 —
- 理由：pi 侧没有调度器；常驻 Bot 的「每天早上汇报」靠这个。

**14. devices**
- 功能：9 个工具 + skill + trigger（本机设备能力）。
- pi 对应：**无**。
- 结论：**保留为 Yonder 特色**｜规模 —
- 理由：同上，宿主设备能力。

**15. media-tools**
- 功能：图像生成 + 语音识别。
- pi 对应：**无**。
- 结论：**保留**｜规模 —
- 理由：C2 §5.3 列为生态缺口。

**16. wechat-archive**
- 功能：微信聊天记录归档检索。
- pi 对应：**无**。
- 结论：**保留为 Yonder 特色**｜规模 —
- 理由：数据源本身是 Yonder 独有的。

**17–23. channel-cli / channel-card / channel-feishu / channel-mcp / channel-slack / channel-telegram / channel-wechat**
- 功能：多渠道收发、渠道身份、每轮渠道上下文、卡片渲染；`channel-mcp` 是**服务端**（`plugins/channel-mcp/src/operations.ts:43-50` 暴露 15 个 `yonder-harness` MCP 工具：`sessions_*`、`identity_*`、`messages_send`）。
- pi 对应：**无**（C2：生态里渠道类只占 1.6%，pi 侧为零）。
- 结论：**保留**（这是要留下的核心）；仅把「往模型里送字」的部分按 pi 五条路径收口｜规模 **M**（仅收口部分）
- 理由：pi 的 5 条注入路径是 ①工具 description ②`promptSnippet/promptGuidelines` ③`systemPromptOptions.sections.*` ④`before_agent_start` 返回 `{message}` ⑤自己 `sendUserMessage()`。Yonder 渠道目前主要靠 ④ 的等价物（`placement:"turn"` 的 `<turn>` 块）与拼进用户消息，需要按 agent-parity §3.3 限制「每轮渠道增量 ≤3k」并把状态类文字只走 `placement:"turn"`。`channel-mcp` 的 `sessions_*` 与 agent-parity §9 拟新增的核心 `session_*` 工具应共用实现，否则会有两套语义。

### 4.2 值得单独说明的两条

- **pi 的默认风格是「能力 = skill + CLI」，Yonder 的默认风格是「能力 = 常驻工具」**。同一件事（浏览器、网页、codex、MCP）在 pi 侧常驻成本接近 0，在 Yonder 侧是几千 token 的 description。这不是个别插件的问题，是插件作者的习惯差异；对齐时优先改这条，收益最大。
- **提示词纪律在 pi 侧是独立短条目，在 Yonder 侧只能写进 description**。`packages/sdk/src/types.ts:300-306` 缺 `promptSnippet/promptGuidelines` 是所有插件「话多」的根因。

## 五、pi 有而 Yonder 完全没有的能力

1. **会话树与分叉**：`/tree`、`/fork`、`/clone`、`/import`、`branchSummary`。Yonder 零实现。
2. **导出与分享**：`/export`（HTML/JSONL）、`/share`、`/copy`、`/name`。
3. **hashline 锚点编辑族**：`replace`、`replace_match`、`insert`、`copy`、`move`、`undo_last_change`、`outline`（pi-hashline-edit-pro 7.1.1，28 个 `tool-prompts/` 文件按 description/snippet/guidelines 三件套拆）。Yonder 只有 `edit`（整段替换）。
4. **LSP 与符号导航**：pi-lens 的 `lens_diagnostics`、`read_symbol`、`read_enclosing`、`symbol_search`、`module_report`、`project_report` + 5 个 situational（ast_grep_search/replace/outline、lsp_navigation、lens_diagnostic_mark）+ 40 KiB 结果上限与尾部 `usage tokens=… elapsed-ms=… bytes=… truncated=…`。
5. **代码图谱**：`codegraph_explore`（一次给相关符号原文按文件分组 + 调用路径）。
6. **多 Agent 编排**：pi-subagents 的 worktree 隔离、并行 fanout、review 扇出、council、fleet widget。Yonder 只有 `task_run`/`task_continue` 的串行委派与 2 层深度。
7. **模型主动可逆折叠**：billion-context 的 `compress`/`decompress`/`search_context`/`acp_status` + 三层折叠 + 保护规则（`preserveRecentMessages`=3、`preserveRecentTokens`≈5000、`minCompressRangeChars`≈5000）+ `cacheKeepalive`。Yonder 只有阈值摘要，不可逆、不可检索。
8. **todo 依赖图 + overlay + 分支重放**：`blockedBy`、`pi.appendEntry` 快照。
9. **命令级安全网**：cc-safety-net 的 `pi.on("tool_call")` 前置拦截（bash 命令规则 + 敏感路径 denylist，返回 `{block:true, reason}`）。Yonder 的 `packages/core/src/permissions.ts:4` 只是插件声明式权限注册表，没有执行前拦截缝。**本轮实测**：一条含 `credentials` 路径的 bash 命令被 cc-safety-net 以 `Rule: secret.basename.credentials` 拦下——Yonder 没有这层。
10. **第二模型顾问**：pi-advisor-flow 的 `ask_advisor`/`record_advisor_outcome`（主模型与顾问不同模型、脱敏上下文、adviceId 可追踪）。
11. **目标状态机**：pi-goal-x 的 6+ 工具与 `/goal` 命令树，以及「目标状态不写系统提示词、只在尾部按需追加、`liveRetention` 逐字保留上一轮尾部」的缓存友好设计。
12. **web 正文落盘 + 分页检索 + 多供应商**：`get_search_content`、`source_check`。
13. **codemode QuickJS 沙箱**：Yonder 的 `packages/pi-durable/src/codemode/` 已实现但**未接线**（全 core/cli 无 `codemode` 引用）。
14. **`find` / `ls` 工具**。
15. **prompt 模板**：`~/.pi/agent/prompts/*.md` → `/<文件名>`，支持 `${1:-默认值}` 与 `argument-hint`。
16. **交互式设置面**：`/settings`、`/reload`、`/scoped-models`、`/trust`、`/changelog`、`/quit`，以及主题与键位文件。
17. **容器化执行环境**：`packages/pi-durable/src/env/` 只有 `node.ts`（`id = "node:local"`，`:623`），无 Docker/沙箱后端。
18. **`/thinking` 档位命令**：Yonder 有 `runtime/effort.ts` 但未暴露命令。
19. **`/simplify`**：读 git diff 生成 Principles/Scope/Process 三段并 `deliverAs:"followUp"` 注入。

## 六、用户能直接感受到的 6 个差异

1. **提示词变化就掉缓存**：改一句 `content.ts`，整块 instructions 重发；pi 只重发变的那一段。
2. **长会话压缩不可逆**：pi 能 `decompress` 回原文、能 `search_context` 找旧块；Yonder 压缩完就只剩摘要。
3. **规则文件看不见**：在子目录跑、用 `CLAUDE.md`、用 git worktree，Yonder 的规则会静默丢失。
4. **网页读一半**：Yonder 搜完内容全塞进上下文；pi 落盘后按需分页取。
5. **编辑靠整段替换**：没有锚点、没有 `outline`、没有 `undo_last_change`，改大文件时更容易改错且不好回滚。
6. **后台任务纪律靠长 description**：pi 有独立 `<rules>` 条目明确「不要轮询」，Yonder 只能写在工具说明里。

## 七、建议的实施顺序（按依赖）

**P0（其它一切的前提，先做）**
1. `Tool` 加 `promptSnippet` / `promptGuidelines`，装配 `<rules>` 段（spec 04 §3.2 已获批准）。规模 **S/M**。
2. 提示词按 key 分段：把 `packages/core/src/runtime/index.ts:508-525` 的单段拆成多个 `PromptSection`（`tag:true`），复用 `packages/pi-durable/src/harness/prompt.ts` 已有的补丁语义；同时删掉 `runtime.discipline` 的模型名白名单。规模 **M**。
3. 补 `find` / `ls`；`grep` 输出带锚点。规模 **S**。

**P1（工具面与安全，P0 之后并行）**
4. hashline 编辑族（精简版先上 `replace`/`replace_match`/`insert`/`undo_last_change`/`outline`），配套 guidelines 走 P0-1。规模 **L**。
5. tool_call 前置拦截缝（等价 cc-safety-net：bash 命令规则 + 敏感路径 denylist），挂在工具执行前、`permissions` 之上。规模 **M**。
6. compaction 补尾偏折叠 + 缓存断点，压缩时发事件让底栏 CH% 可见。规模 **M**。

**P2（插件按新契约收口）**
7. `tasks` → rpiv-todo 形态（单工具 + `blockedBy` + overlay + 尾部 `<todo>` 摘要）。规模 **M**。
8. `web-tools` → 落盘 + `get_search_content` + 懒加载。规模 **M**。
9. `browser-skill` / `codex-tools` / `mcp-client` → 降常驻、走 skill 或 codemode 命名空间。规模 **M**。
10. `memory` 吸收 `hermes-experience`；`context-files` 删 `memory-md` 段。规模 **M**。
11. `context-files` 按 pi 的 AGENTS/CLAUDE 加载链（含 worktree 去重）。规模 **S**。

**P3（渠道与内核收口）**
12. 渠道插件：每轮增量 ≤3k，状态类文字只走 `placement:"turn"`；`channel-mcp` 的 `sessions_*` 与核心 `session_*` 共用实现。规模 **M**。
13. codemode 接线（库已有）。规模 **M**。
14. 暴露 `/thinking`、`/name`、`/export`。规模 **S**。

**P4（最大件，单独排期）**
15. 会话树 / `/fork` / `/clone` / `/import` + `branchSummary`。规模 **L**。
16. 模型主动可逆折叠（`compress`/`decompress`/`search_context`）。规模 **L**。

**不建议做**：pi-lens 的 7 个常驻 LSP 工具（Yonder 无 LSP 依赖，收益不成立）、pi-goal-x 的完整状态机（与 tasks/session 语义重叠）、pi-subagents 的 worktree fanout（在 Yonder 的会话模型里没有对应位置，除非先做 15）。

## 八、未验证与边界

- 本轮复验了 Yonder 侧的全部结论（含 `file:line`）。pi 插件的行为细节来自 `proposals/unified-client/research/E1-pi-parity-inventory.md` 与 `C2-plugins.md`，**未在本轮逐个打开 13 个插件的源码复核**；涉及具体阈值（如 billion-context 的 `preserveRecentTokens`≈5000）时按 E1 记录引用。
- 「插件常驻 token 量」是 E1 的实测数字，未在本轮重测；P2-9 的收益估算依赖它。
- 未验证：pi 1.4.0 是否在 provider 层隐式打缓存断点（Yonder 侧确认无显式 `cache_control`）。若 pi 也是隐式，则 P1-6 的「缓存断点」一项范围可缩小。
- 未测：hashline 精简版对编辑成功率的影响（agent-parity §12.5 要求 E5 单独测，模型 `workbuddy/deepseek-v4.1-flash`）。
- 本报告为只读调研，未修改任何文件、未提交。