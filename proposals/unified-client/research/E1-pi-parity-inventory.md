> 证据材料，结论已并入 [agent-parity.md](../agent-parity.md)

# E1 · pi 本体 + 13 个插件：完成态一比一复刻清单

- 性质：只读调研（未改动任何已有文件）
- 调研对象：`@earendil-works/pi-coding-agent` 1.4.0 + `~/.pi/agent/settings.json` 中 `packages` 列出的 13 个插件
- 环境：macOS，Node 24.21.0，`~/.pi/agent/npm/node_modules/`
- 提示词原文另存：`proposals/unified-client/research/E1-prompts/<包名>.md`（每个文件开头写 license 与来源文件路径）
- 未联网；下载量取自本地已有 `/tmp/pi-dl.json`

---

## 0. 结论摘要

1. **pi 的系统提示词不是一段文本，而是一个分段拼装器。** `dist/core/system-prompt.js` 的 `buildSystemPromptSections()` 产出 `preamble`（无包裹）、`tools`、`rules`、`docs`、`addendum`、`project_context`、`skills`、`cwd` 八段，除 preamble 外每段包 `<段名>\n…\n</段名>`；扩展通过 `event.systemPromptOptions.sections.<key>` 追加自定义段，`diffSystemPromptSections()` 只把变化段以增量补丁发出（`null` = 删除）。**复刻的真正难点是这套"段 + 补丁"语义，而不是某段文字。**
2. **底栏固定三行**：第 1 行 cwd(+git branch)(+session name)，第 2 行 `↑in ↓out R W CH%` + 上下文占比 + 右侧 `(provider) model • thinking`，第 3 行扩展状态。插件唯一能碰的是第 3 行（`ctx.ui.setStatus(key, text)`，按 key 字典序空格拼接）和编辑器上下方的 `ctx.ui.setWidget(key, lines, {placement})`。
3. **插件把文字送进模型只有 5 条路**：①工具 `description`；②`promptSnippet` / `promptGuidelines`（进 `rules` 段）；③`systemPromptOptions.sections.*`；④`before_agent_start` 返回 `{ message }`（自定义消息）；⑤自己 `sendUserMessage()` 发一条普通 user message。**没有一个是"改 appendSystemPrompt 字符串"**——这是复刻时必须照抄的分层。
4. **`acp_delegate` 不属于 pi-subagents**，它在 `billion-context/dist/agent/pi-native.js`（同包还有 `acp_delegate_cancel`、`acp_delegate_wait`、`acp_status`、`compress`、`decompress`、`search_context`）。pi-subagents 的子 Agent 工具叫 `subagent`（+ `bg_wait`、`subagents_enable`、`contact_supervisor`）。
5. **"KIRO - System Prompt" 没有任何来源文件。** 对 `~/.pi`、`~/.config` 做 `grep -rl` 只命中本次会话自己的 transcript（`~/.pi/agent/sessions/--Users-zoran-Documents--/2026-10-27T16-10-39-342Z_01a17e20-….jsonl`），即该字样来自用户当时输入的提示词本身，不是任何包注入的。
6. **上下文管理是两套并行机制**：pi 自带 compaction（触发式整段摘要）与 billion-context 的 ACP 折叠（模型主动 `compress` 区间）。后者在"该会话模型流量确实走本地 bili 代理"时，用 `session_before_compact` 返回 `{ cancel: true }` **顶掉** pi 的 `threshold`/`overflow` 自动压缩；不走代理时 pi 的压缩照旧生效。
7. **CH（cache hit）与折叠强耦合**：bili 在 Anthropic 线上打 `cache_control` 断点（system 块 + 最多 3 个累积 message 断点），断点"只死于折叠"；所以每做一次 `compress`，被折叠区间之后的缓存前缀就失效，CH 必然掉一段，然后随轮次爬回。
8. 13 个插件 license 全部是 **MIT（12 个）+ ISC（pi-background-tasks）**，无 copyleft、无 AGPL，商用与闭源再分发都不需要额外授权动作。
9. 常驻注入的提示词总量约 **11–12k tokens**（粗估，英文按 ~3.6 字符/token）：pi 本体固定段 ~1.2k、hashline 2.8k、subagents 1.9k、billion-context 1.5k、background-tasks 1.2k、pi-lens 1.1k、rpiv-todo 0.6k、goal-x 0.4k、其余合计 ~0.8k。**这是 C 端默认配置最需要砍的一块。**

---

## 1. 总表

| 包 | 版本 | License | 主要能力（注册面） | 注入提示词估算 | 处置建议 |
|---|---|---|---|---|---|
| pi 本体 | 1.4.0 | MIT | 分段系统提示词、compaction、footer、skills、AGENTS.md、codemode | ~1.2k tok（固定段） | **需转写**（只抄结构与语义，不抄文案） |
| pi-subagents | 0.83.0 | MIT | `subagent`/`bg_wait`/`subagents_enable`/`contact_supervisor`、13 个 agent 定义、2 skills、6 prompt 模板、运行 widget | ~1.9k tok（`full` 模式） | 可直接依赖（企业/长任务），C 端默认关 |
| billion-context | 0.1.208 | MIT | `compress`/`decompress`/`search_context`/`acp_status`/`acp_delegate*`、ACP 折叠代理、缓存保活 | ~1.5k tok | 需转写（代理层逻辑不能直接搬） |
| pi-hashline-edit-pro | 7.1.1 | MIT | 替换 `read`/`grep`，新增 `replace`/`replace_match`/`insert`/`copy`/`move`/`undo_last_change`/`outline`，锚点行号 | ~2.8k tok | **可直接依赖**（收益最大、风险最低） |
| pi-lens | 4.4.6 | MIT | 13 个 LSP/ast-grep 工具 + 4 skills + 底栏 LSP 状态 | ~1.1k tok | 可直接依赖（开发者场景） |
| pi-background-tasks | 2.6.10 | ISC | `bg_run`/`bg_status`/`bg_logs`/`bg_kill`/`bg_delegate`/`bg_result`/`bg_run_pi_attested`、任务 dock、/bg 命令族 | ~1.2k tok | 可直接依赖（需子进程） |
| @juicesharp/rpiv-todo | 2.15.0 | MIT | `todo` 工具 + `/todos` + Todo 树 overlay | ~0.6k tok | **可直接依赖** |
| pi-web-access | 0.45.0 | MIT | `web_enable`/`web_search`/`source_check`/`fetch_content`/`get_search_content`、/websearch /curator /search | ~0.3k tok（懒加载） | 可直接依赖（需网络出口与搜索 key） |
| @henryqw/pi-codegraph | 0.7.3 | MIT | `codegraph_explore` + 隐藏 MCP server + 底栏 `✓ CG` | ~0.2k tok | 可直接依赖（需外部 `codegraph` 二进制） |
| pi-advisor-flow | 0.14.3 | MIT | `ask_advisor`/`record_advisor_outcome`、/advisor 命令族、底栏 advisor 状态 | ~0.2k tok | 可抄（第二模型咨询模式） |
| pi-goal-x | 0.34.0 | MIT | `get_goal`/`create_goal`/`update_goal`/`set_goal_tasks`/`update_goal_task`/草稿工具、/goal 命令树、`context_with_system` 注入 | ~0.4k tok | 需转写（与 Yonder 自身 goal 机制重叠） |
| codex-computer-use-mcp | 0.6.2 | MIT | 10 个 `computer_use_*` 工具，`exposure:"codemode"` + namespace、/computer-use-status | ~0.6k tok（仅 codemode 描述内） | 不适合 C 端（需 macOS + OpenAI 官方签名应用） |
| cc-safety-net | 2.7.0 | MIT | `pi.on("tool_call")` 拦截 bash 与敏感文件；`/cc-safety-net` 命令 | 0 tok（常驻） | **可直接依赖**（安全网，零提示词成本） |
| pi-simplify | 0.2.3 | MIT（包内无 LICENSE 文件） | 仅 `/simplify` 命令，把 diff 拼成一段 user message | 0 tok（按需 ~0.7k） | **可抄**（一段好提示词，无需装包） |

---

## 2. 各包小节

### 2.1 pi 本体（`@earendil-works/pi-coding-agent` 1.4.0，MIT）

**系统提示词拼装**（`dist/core/system-prompt.js`，151 行，全文见 `E1-prompts/pi-core.md`）：

- `normalizeBuildSystemPromptOptions()`：`selectedTools` 默认 `["read","bash","edit","write"]`。
- `buildSystemPromptSections()` 段序：`preamble`（裸文本）→ `tools` → `rules` → `docs` → `addendum`（= `appendSystemPrompt`）→ `project_context` → `skills` → `cwd`，最后拼扩展自定义段。每段（除 preamble）包成 `<段名>\n…\n</段名>`。
- `tools` 段每条是 `- <name>: <toolSnippets[name]>`，末尾固定一句 "In addition to the tools above, you may have access to other custom tools depending on the project."
- `buildRules(selectedTools, toolGuidelines, promptGuidelines)`：先按 `selectedTools` 顺序展开各工具的 guidelines；**当且仅当没有 grep/find/ls 类工具**时补一条 bash/PowerShell 使用规则（这就是 hashline 装上 `grep` 后那条规则消失的原因）；再追加 `promptGuidelines`；最后恒有两句 `- Be concise in your responses`、`- Show file paths clearly when working with files`。
- `renderProjectContext()`：输出 "Project-specific instructions and guidelines:" + 每个文件 `<project_instructions path="…">…</project_instructions>`。
- `diffSystemPromptSections(previous, current)`：段级补丁；`null` 表示删段。这是插件"每轮只发增量"的基础。

**skills 段**（`dist/core/skills.js`，`formatSkillsForPrompt` 278-303）：固定开场 "The following skills provide specialized instructions for specific tasks." + 读文件提示 + `<available_skills><skill><name>…<description>…<location>…</skill></available_skills>`；`MAX_NAME_LENGTH=64`、`MAX_DESCRIPTION_LENGTH=1024`；`disableModelInvocation` 的技能被过滤。技能目录：`<agentDir>/skills`（user）、`<cwd>/.pi/skills`（project），外加各包 `package.json.pi.skills`。

**AGENTS.md**（`dist/core/resource-loader.js:116`）：同目录候选顺序 `AGENTS.override.md > AGENTS.md > AGENTS.MD > CLAUDE.md > CLAUDE.MD`；`loadProjectContextFiles()` 先放 `<agentDir>/AGENTS.md`，再从 cwd 逐级向上到根用 `unshift` 前插 ⇒ 祖先目录在前、cwd 最后；`findShadowedContextFile()` 去掉嵌套 linked worktree 的重复副本。

**compaction 默认参数**（`dist/core/settings-defaults.js`）：`compaction {enabled:true, reserveTokens:16384, keepRecentTokens:20000}`、`branchSummary {reserveTokens:16384, skipPrompt:false}`、`retry {enabled:true, maxRetries:3, baseDelayMs:2000, provider.maxRetryDelayMs:60000}`、`codemode {mode:"on", inlineBudget:3000}`、`cacheWarming:"streaming"`、`tuiMode:"fullscreen"`、`doubleEscapeAction:"tree"`、`defaultProjectTrust:"ask"`。

**footer**（`dist/modes/interactive/components/footer.js`，264 行）与 `dist/core/footer-data-provider.js`（`FooterDataProvider`）见第 3 节。

**codemode**（`docs/codemode.md`）：QuickJS 沙箱里跑 JS，工具用 `exposure: codemode|deferred|hidden` 控制暴露；namespace 的 `description` + `instructions` 进模型；codemode 工具描述里列各工具的 TS 声明，共享 3000 token 预算（`codemode.inlineBudget`）。

### 2.2 pi-subagents 0.83.0（MIT，Nico Bailon，https://github.com/nicobailon/pi-subagents，周下载 631,440）

- **注册面**：工具 `subagent`、`bg_wait`（`src/runs/background/wait-tool.js:41`）、`subagents_enable`（动态开启 loader）、`contact_supervisor`（`src/extension/herdr-pi-bridge.js:97`）；skills `council-mode`、`pi-subagents`；prompt 模板 6 个（`prompts/council.md`、`gather-context-and-clarify.md`、`parallel-cleanup.md`、`parallel-research.md`、`parallel-review.md`、`review-loop.md`）；agent 定义 13 个（`agents/*.md`：claude-code、claude-code-writer、codex-exec、codex-exec-writer、cursor-agent、cursor-agent-writer、delegate、evidence-auditor、oracle、researcher、reviewer、scout、worker）；widget `subagent-async`、`subagent-fleet-status`、`subagent-inspect`。
- **钩子**：`context_with_system`（给 custom 消息包 `<pi_subagents_notice type=… origin="automated message from the pi-subagents extension, not typed by the user">`）、`before_agent_start`（写 `sections.active_subagents` 与 `sections.advertised_subagents`）、`agent_end`、`tool_result`、`agent_start`、`message_start`、`agent_settled`、`session_before_compact`、`session_compact`、`session_start`、`session_shutdown`。
- **关键设计（值得照抄）**：作者明确注释——标记消息必须在 `context_with_system` 里做，**不能用 `context`**，因为改消息列表会让 pi 把中途 system 消息折叠进首条、每轮丢前缀缓存。
- **注入文本**：`SUBAGENT_SAFETY_GUIDANCE`（授权规则）+ `essentials(on)`（`scriptCalls`/`structuredCalls` 二选一 + 管理入口 + 指南入口）+ 可选 `fullDetails(on)`；`toolDescriptionMode` 默认 `"full"`，可 `"compact"`/`"custom"`（读 `<projectConfigDir|agentDir>/subagent-tool-description.md`，支持 `{{fullDescription}}` 等占位符）。**没有 promptGuidelines**，注释写明"授权规则写在 description 里，只说一次"。
- **外部依赖**：`@js-temporal/polyfill`、`acorn`、`jiti`、`undici`、`yaml`；子进程：为每个子 Agent 起独立 `pi` 进程（`runner-peer-loader.mjs`、`runner-peer-preload.mjs`、`workflow-script-worker.cjs`）；支持外部 CLI agent（codex/claude/cursor），需要各自已安装且已认证。
- **价值**：多 Agent 编排、后台运行与唤醒、worktree 隔离、review fanout，是 Yonder "子 Agent"能力的现成实现。
- **风险**：常驻提示词重（~1.9k tok）、能力面极大（missions/schedules/watchdog/panes/lane 等数十个 action）、会起子进程并读取真实模型凭据、agent 定义可被项目内文件覆盖（供应链面）。C 端默认应关闭，仅企业/长任务场景开启。

### 2.3 billion-context 0.1.208（MIT，ranxianglei，https://github.com/ranxianglei/billion-context，周下载 2,144,020）

- **两层结构，必须分开看**：
  1. **工具层**（真正的 pi 扩展，`package.json.pi.extensions = ["./dist/agent/pi-native.js"]`）：`compress`、`decompress`、`search_context`、`acp_status`、`acp_delegate`、`acp_delegate_cancel`、`acp_delegate_wait`；命令 `/acp`、`/acp-fleet`、`/acp-cache`、`/acp-rule`；`before_agent_start` 写 `sections.acp_delegate`；底栏状态 `billion-context-pi-subagents`；widget `billion-context-pi-delegates`（`placement: "belowEditor"`）。
  2. **代理层**：billion-context 本质是本地 HTTP 代理（默认 `127.0.0.1:8787`，`x-acp-session` 头标识会话），在线上请求里追加 `FUNCTION_PROMPT_SECTIONS`（`acpTags` / `tools` / `summariesInContext` 三段）、做 ACP 折叠、打 `cache_control` 断点、可做缓存保活。这些文本**不经过 pi 的 sections 机制**，所以它们在会话里呈现为裸文本段。
- **委托默认策略**（`DEFAULT_DELEGATE_POLICY`）：`enabled:true, forceEnable:false, displayUsage:"separate", maxDepth:2, syncTimeoutMs:300000, idleMs:300000, asyncTimeoutMs:1800000, maxConcurrent:Infinity, notifyIfRead:"skip", fleetShortcut:"ctrl+alt+d"`。配置读 `<home>/.pi/acp.json` 与 `<cwd>/.pi/acp.json`（键 `delegate`/`displayUsage`/`delegatePrompt`/`debug`），env `PI_ACP_DELEGATE_*`。
- **外部依赖**：`mysql2`、`zod`；外部服务：本地代理进程 + `~/.local/share/billion-context/sessions/` 持久化目录；ACP 内核（`acp-kernel`，GitHub ranxianglei/acp-kernel）。
- **价值**：把"上下文压缩"从"整段摘要"变成"模型自己按区间折叠 + 可逆 decompress + 可检索 search_context"，是长会话成本控制的核心。
- **风险**：①它是**明文中间人代理**（本机 loopback，无鉴权，`host` 若配 `0.0.0.0` 即对外暴露）；②`compat.dropFields`/`security.adminRelay` 等开关影响面大；③与 pi 自身 compaction 争夺控制权，行为依赖"流量是否真的走代理"；④提示词注入量大且文案随版本变（`compress.prompts` 改动需要 `acknowledgePromptsRisk`）。

### 2.4 pi-hashline-edit-pro 7.1.1（MIT，RimuruW and Yugimob，https://github.com/YuGiMob/pi-hashline-edit-pro，周下载 17,305）

- **注册面**：替换/新增工具 `read`、`grep`、`replace`、`replace_match`、`insert`、`copy`、`move`、`undo_last_change`、`outline`；命令 `/hashline-config`、`/clear-anchors`；钩子 `session_start`、`session_shutdown`、`model_select`、`before_agent_start`（auto-read-all 时返回 `{ message: { customType, content, display:false } }`）、`message_end`、`turn_end`、`tool_result`。
- **提示词组织**：`tool-prompts/` 下按 `<工具>.md`（description）/`<工具>-snippet.md`（promptSnippet）/`<工具>-guidelines.md`（promptGuidelines，逐行 `- `）三件套拆分，`src/prompts.ts` 的 `GUIDELINE_IDS_BY_NAME` 给每条 guideline 一个稳定 id 用于门控。**这是本次调研里最干净的提示词工程结构，值得直接照抄。**
- **外部依赖**：`diff`、`file-type`、`web-tree-sitter`（+ `src/outline/vendor/wasm`）、`xxhash-wasm`；锚点存储在 `.pi` 侧车文件。
- **价值**：锚点式编辑把"读全文再改"变成"锚点精确定位"，token 与误改率都显著下降；`model-gate` 可对特定模型禁用。
- **风险**：它**替换内置 `read`/`grep`**，会改变 pi 的 `buildRules` 输出（不再补 bash 规则）；锚点失效会导致编辑被拒；`auto-read-all` 默认注入文件内容，可能与用户预期的"按需读"冲突。

### 2.5 pi-lens 4.4.6（MIT，Apostolos Mantzaris，https://github.com/apmantza/pi-lens，周下载 79,180）

- **注册面**：13 个工具——7 个常驻（`lens_diagnostics`、`module_report`、`project_report`、`read_symbol`、`read_enclosing`、`symbol_search`、`effective_config`）+ loader `pi_lens_activate_tools` + 5 个 situational（`ast_grep_search`、`ast_grep_replace`、`ast_grep_outline`、`lsp_navigation`、`lens_diagnostic_mark`，默认不激活，由 loader 调 `pi.setActiveTools` 打开，且明确提示"下一轮才可用"）；skills 4 个（`pi-lens-ast-grep`、`pi-lens-lsp-navigation`、`pi-lens-write-ast-grep-rule`、`pi-lens-write-tree-sitter-rule`）；底栏状态 key `pi-lens-lsp`。
- **提示词纪律**（作者写在 `docs/agent-tools.md`）：工具 description 只放"契约句 + 一个例子"，运行期指导（缓存状态、扫描范围、安全细节）放进**结果**里，"只在实际执行时才付费"。结果统一走 `finalizeToolResult()` 门禁，限 40 KiB（`MAX_RESULT_BYTES`），尾部盖 `usage tokens=… elapsed-ms=… bytes=… truncated=…`。
- **外部依赖**：`@ast-grep/cli`/`@ast-grep/napi`（原生二进制）、`vscode-jsonrpc`、`js-yaml`、`minimatch`、`pidusage`；外部服务：本机语言服务器（gopls/rust-analyzer/clangd/… 共 50+ 种，见 `tools` 名称表）+ 可选 MCP 镜像。
- **价值**：把 LSP 诊断与符号级导航带进 Agent，显著减少"整文件读"与"猜符号"。
- **风险**：常驻工具多、LSP 进程占内存（有 idle eviction 机制）；`lsp_navigation` 结果会被计为 read 以配合 read-guard，语义与 pi 原生不同；原生二进制在部分平台（Termux 等）装不上。

### 2.6 pi-background-tasks 2.6.10（ISC，ismailsaleekh，https://github.com/ismailsaleekh/pi-background-tasks，周下载 43,619）

- **注册面**：工具 `bg_run`、`bg_status`、`bg_logs`、`bg_kill`，以及 `bg_delegate`、`bg_result`、`bg_run_pi_attested` 和 Fusion 系列；命令 `/bg`、`/tasks`、`/bg-tasks`、`/bg-clear`、`/bg-update`、`/jobs`、`/logs`、`/kill`；快捷键 `shift+down` 或 `ctrl+alt+b`（任务 dock，二选一，由 `config.dockShortcut` 决定）、`ctrl+alt+c`；widget `background-tasks`；状态 `background-tasks`。
- **提示词特点**：几乎全部 promptGuidelines 都在防"轮询"——"bg_run 立即返回；完成通知会自动起一轮，不要 sleep/bg_status/bg_logs 去等；把 `<background-task-notification>` 当最终真相，不要用 bg_status 复核"。**这是本次调研里最值得抄的一组行为约束。**
- **外部依赖**：`turndown`；运行时目录 `.pi/tasks/<session-id>-<pid>/`、`.pi/fusion/…`；子进程：直接 spawn 命令或 `pi` 子进程（`bg_delegate`/attested 模式）。
- **价值**：长任务（测试、dev server、构建）不阻塞主循环，且有"完成即唤醒"的模型。
- **风险**：起子进程并写盘；`surviveReload` 有显式拒绝规则（`ReloadSurvivalError`）；`bg_delegate` 子 Agent 只有只读工具；对宿主 shell 策略有侵入（`createShellPolicyGuidanceHandler`）。

### 2.7 @juicesharp/rpiv-todo 2.15.0（MIT，juicesharp，https://github.com/juicesharp/rpiv-mono，周下载 140,707）

- **注册面**：工具 `todo`（action: create/update/list/get/delete/clear）；命令 `/todos`；widget `rpiv-todos`（Todo 树 overlay，`collapse` 键可配）；钩子 `session_start`、`session_compact`、`session_tree`、`session_shutdown`、`tool_execution_end`、`agent_start`。
- **状态机**：`pending → in_progress → completed`，`deleted` 是 tombstone；`blockedBy` 表达依赖（create 时给初值，update 用 `addBlockedBy`/`removeBlockedBy` 增量合并），成环被拒；快照以 custom entry 写入会话分支（`pi.appendEntry`），所以重放/分叉都正确。
- **提示词**：8 条 `promptGuidelines`（何时用、先标 in_progress、完成即标、测试失败不得标完成、4 态机、依赖用法、批量创建、list 默认隐藏 tombstone），可由用户配置 `guidance.promptSnippet/promptGuidelines` 覆盖。
- **价值**：多步任务可见化，是 C 端"用户看得懂 Agent 在干什么"的最低成本手段。
- **风险**：几乎没有。依赖 `@juicesharp/rpiv-config`；i18n 通过可选 `@juicesharp/rpiv-i18n` 动态加载，缺失时回退英文。

### 2.8 pi-web-access 0.45.0（MIT，Nico Bailon，https://github.com/nicobailon/pi-web-access，周下载 934,847）

- **注册面**：`web_enable`（loader，`promptSnippet` 说明"若工具不可用先调它，下一轮出现"）+ `web_search`、`source_check`、`fetch_content`、`get_search_content`；命令 `/websearch`、`/curator`、`/google-account`、`/search`；钩子 `session_start`、`session_tree`、`session_shutdown`、`before_agent_start`（Curator 运行状态重置）、`tool_call`。
- **能力**：多 query 并发搜索（最多 3 个并发）、结果按 `responseId` 落盘供 `get_search_content` 分页/检索；`fetch_content` 支持 readable/raw/answer/extract 四种模式（`fetch.allowedModes`）、GitHub 仓库、图片、YouTube 与本地视频。
- **外部依赖**：大量搜索/抓取供应商适配器（brave、brightdata、crawl4ai、bocha、baizhi、ceramic 等）+ `chrome-cookies`（读取本机 Chrome cookie 做认证）；需要相应 API key 或登录态。
- **价值**：把"搜索 + 抓正文 + 存正文"三段拆开，正文不进上下文，按需分页取——这是控制上下文膨胀的正确做法。
- **风险**：会读本机浏览器 cookie；外网出站；供应商 key 管理；默认懒加载（不激活则 0 成本）。

### 2.9 @henryqw/pi-codegraph 0.7.3（MIT，Henry Wang，https://github.com/HenryQW/pi-harness，下载量本地文件缺失）

- **注册面**：工具 `codegraph_explore`（一次调用返回相关符号的**原文**按文件分组 + 调用路径，`maxFiles` 默认 12）；MCP server `codegraph serve --mcp --path <root>` 以 `exposure: "hidden"` 注册（只为跑文件监听保持索引新鲜，工具本身不暴露）；状态 key 输出 `✓ CG` / `○ CG` / `! CG: setup failed`；钩子 `session_start`、`session_shutdown`。
- **外部依赖**：外部二进制 `codegraph`（`pi.exec("codegraph", ["explore", …])`，`EXPLORE_TIMEOUT_MS` 超时）+ 索引目录。
- **价值**：单次调用替代"多文件 grep + read"，且明确"展示的源码视为已读"。
- **风险**：强依赖外部 CLI 与索引新鲜度；description 里就写了"先跑 `codegraph status .`，索引过期就读实时源码"——说明索引会腐坏；对大仓首次索引慢。

### 2.10 pi-advisor-flow 0.14.3（MIT，Philip Brembeck，https://github.com/philipbrembeck/pi-advisor，下载量本地文件缺失）

- **注册面**：工具 `ask_advisor`（空对象=上下文评审；带 draft=计划/完成评审；`followUpTo` 复用已缓存咨询；`includeTrackedFiles` 补文件）、`record_advisor_outcome`；命令 `/advisor`、`/advisor-manual`、`/advisor-models`、`/advisor-stats`、`/advisor-settings`、`/advisor-off`；状态 `advisor-scout`、`advisor-manual`、`advisor-usage`；钩子 `session_start`、`session_shutdown`、`model_select`、`before_agent_start`、`input`、`tool_call`、`tool_result`、`turn_end`、`agent_settled`；`sendAutomaticGateCall()` 会主动发 "Automatic Advisor loop review" 消息做 loop-gate。
- **机制**：主模型与 Advisor 用不同模型（可配），Advisor 看到的是**脱敏后**的上下文；咨询结果带 `adviceId`，可追踪采纳与验证结果（outcome logging 默认全局关闭）。
- **价值**："第二意见"模式，适合高风险决策；draft 上限 8 KiB 且标注不可信，隐私边界写得清楚。
- **风险**：多一次模型调用（成本）；脱敏规则若漏会外泄；依赖用户正确配置 advisor 模型。

### 2.11 pi-goal-x 0.34.0（MIT，Lucas，https://github.com/tmonk/pi-goal-x，周下载 70,084）

- **注册面**：工具 `get_goal`、`create_goal`、`update_goal`、`set_goal_tasks`、`update_goal_task`、`submit_goal_oracle_advice`，以及草稿期工具（`QUESTION_TOOL_NAME`、`QUESTIONNAIRE_TOOL_NAME`、`PROPOSE_DRAFT_TOOL_NAME`）；命令树由 `GOAL_COMMANDS` 生成，根为 `/goal` 与 `/goal-settings`（`registerCommand(root, …)` + `getArgumentCompletions`）；钩子极多：`context_with_system`、`before_provider_request`、`before_agent_start`、`agent_start`、`message_start`、`turn_start`、`tool_call`、`tool_execution_end`、`turn_end`、`message_end`、`agent_end`、`agent_settled`、`session_start`、`session_before_compact`、`session_compact`、`session_compact_failed`、`session_tree`、`session_shutdown`。
- **关键设计**：目标状态**不写系统提示词**。`registerGoalContext()` 注册 `context_with_system`，在消息列表尾部按需追加 `state` / `counters` 两段，并用 `liveRetention` **逐字保留上一轮已发送的尾部**，保证本请求是上一请求的延长而非替换（前缀缓存友好）；`before_provider_request` 再做 `cacheGoalHistory`。
- **价值**：目标/任务树 + 断点续跑 + 预算控制；"把状态放消息尾而不是系统头"是保住 CH 的正确做法。
- **风险**：状态机极复杂（30+ 文件）、hook 面极广、与 Yonder 自身的 goal 机制功能重叠，直接依赖会打架。**建议只抄它的"尾部注入 + 逐字保留"手法。**

### 2.12 codex-computer-use-mcp 0.6.2（MIT，Thomas Mustier，https://github.com/tmustier/codex-computer-use-mcp，下载量本地文件缺失）

- **注册面**：10 个工具 `computer_use_list_apps`/`get_app_state`/`click`/`perform_secondary_action`/`set_value`/`select_text`/`scroll`/`drag`/`press_key`/`type_text`，全部 `exposure: "codemode"` 且带 `namespace: COMPUTER_USE_NAMESPACE` ⇒ 只在 codemode 脚本里以 `tools.computer_use_*` 出现，不占主工具表；命令 `/computer-use-status`；钩子 `session_start`、`before_agent_start`（检查 codemode 是否激活，未激活就警告）、`agent_settled`、`session_shutdown`。
- **外部依赖**：macOS + **OpenAI 官方签名的 Computer Use 应用**（不是自研实现）；状态目录 `~/.pi/agent/direct-computer-use`（可用 `CODEX_COMPUTER_USE_HOME` 覆盖）；elicitation 时用 `/usr/bin/open` 打开 URL。
- **价值**：把"看屏幕、点按钮"变成结构化工具；namespace 的 `instructions` 把"先 get_app_state、按最新 element_index 操作、动作后再 inspect"写成协议。
- **风险**：**不适合 C 端**——依赖 OpenAI 签名应用、需要辅助功能权限、屏幕内容即隐私、`get_app_state` 默认返回 diff 可能误导模型。企业/内部工具场景可控。

### 2.13 cc-safety-net 2.7.0（MIT，J Liew，https://github.com/kenryu42/cc-safety-net，周下载 72,288）

- **注册面**：**不注册工具、不注入提示词**。`kt(pi)` = `pi.on("tool_call", handler)`，在工具调用前按规则检查 bash 命令与敏感文件读取，命中返回 `{ block: true, reason: … }`；另注册 `/cc-safety-net` 命令（把打包进 dist 的 README 从 `# CC Safety Net` 起整段拼上用户请求作为 user message 发出）。
- **价值**：零提示词成本的安全网，`rm -rf`、`git push --force`、读 `~/.ssh`/`.env` 一类操作在调用前被拦。**C 端必装。**
- **风险**：规则集与 `cc-safety-net` 配置耦合（需外部配置文件）；拦截误报会让 Agent 卡住（reason 会回到模型，模型可改写命令绕过）。

### 2.14 pi-simplify 0.2.3（MIT，MattDevy，https://github.com/MattDevy/pi-extensions，周下载 35,700）

- **注册面**：只有 `/simplify` 命令，无工具、无钩子、无 widget。命令读 git diff 得到变更文件与行号区间，`buildSimplifyPrompt(files)` 拼一段带 Principles / Scope / Process 的提示词，`pi.sendUserMessage(prompt, { deliverAs: "followUp" })` 发出。
- **注意**：`package.json` 声明 MIT，但**包内没有 LICENSE 文件**（其余 12 个包都有）。
- **价值**：提示词本身写得好（"只改列出的行号区间""不为简化而简化""有价值的注释保留"），**可以只抄提示词，不必装包**。

---

## 3. 界面元素对照

| 界面元素 | 来源包 | 渲染位置（文件:函数） | 数据来源 |
|---|---|---|---|
| 底栏第 1 行 `~/Documents/yonder-harness (branch) • session` | pi 本体 | `dist/modes/interactive/components/footer.js` → `FooterComponent.render()`；`formatCwdForFooter()` 把 home 换成 `~` | `sessionManager.getCwd()`、`FooterDataProvider.getGitBranch()`、`sessionManager.getSessionName()` |
| `↑in ↓out R W CH 60.5%/200k (auto)` | pi 本体 | 同上，`render()` 中 `statsParts` 数组；`formatTokens()` 做 k/M 缩写 | `createUsageTotals()` 扫全量会话条目（`usage` / assistant `message.usage` / toolResult `usage` / `branch_summary`、`compaction` 的 usage）；CH = **最新一条 assistant 消息**的 `cacheRead / (input + cacheRead + cacheWrite) × 100`；上下文占比来自 `session.getContextUsage()`，`>90%` 用 error 色、`>70%` warning 色；`(auto)` 来自 `autoCompactEnabled` 设置位 |
| `(provider) model • thinking` | pi 本体 | 同上 `render()` 右半部分 | `state.model.id`、`state.thinkingLevel`（`reasoning` 为假则不显示）、`session.routedModel` 存在时追加 `→ <实际模型>`；`FooterDataProvider.getAvailableProviderCount() > 1` 才加 `(provider) ` 前缀，宽度不够时自动降级 |
| 底栏第 3 行（扩展状态，按 key 字典序空格拼接） | 各插件 | `footer.js` 末尾 `getExtensionStatuses()`；数据入口 `FooterDataProvider.setExtensionStatus()` ← `ctx.ui.setStatus(key, text)` | 见下面四行 |
| `LSP Active: typescript, …` / `LSP ✓` / `LSP Inactive` | pi-lens | `pi-lens/dist/index.js` → `updateLspStatus(setStatus, theme)`，key = `pi-lens-lsp`；`selectLspStatus()` 决定 active/failed；`lens-hide-lsp-status`、`lens-compact-lsp-status` 两个 flag 控制显隐与紧凑形式 | `getLSPService().getAliveServerIds()`、`getFailedLspServerIds()`、`getSessionLanguages()` |
| `sub-agents ↑1.2k ↓340 ($0.0123)`（子 Agent 用量） | billion-context | `dist/agent/pi-native.js` → `updateFooterStatus()`，key = `billion-context-pi-subagents`（`DEFAULT_FOOTER_STATUS_KEY`）；`formatCompactTokens()` 做缩写 | `getDelegateUsage()` 累加所有 delegate 的 `usage`（`input`/`output`/`cost.total`）；仅 `totalTokens > 0` 时显示；`displayUsage: "separate"` 决定与主会话分开计 |
| acp_delegate 运行列表（编辑器下方） | billion-context | `setWidget("billion-context-pi-delegates", lines, { placement: "belowEditor" })`；`REFRESH_MS=500`、`MAX_TASK_LEN=48`、`STALL_WARN_MS=120000`（12 分钟无输出标红） | 运行时 `runningRunsSnapshot`（`state6.delegate` 的 async jobs）；`fleetShortcut`（默认 `ctrl+alt+d`）唤出 `/acp-fleet` |
| 子 Agent 运行 widget（另一套） | pi-subagents | `src/extension/index.js` → `ctx.ui.setWidget(WIDGET_KEY, …)`，`WIDGET_KEY = "subagent-async"`；另有 `subagent-fleet-status`、`subagent-inspect` | `state.asyncJobs`；`src/tui/render.js` 里 `formatUsage(r.usage, r.progress?.model ?? r.model)` 显示每个子 Agent 的用量与轮次（`⟳ N`） |
| Todos 树（编辑器上方/下方 overlay） | @juicesharp/rpiv-todo | `index.ts` + `todo-overlay.ts`，widget key `rpiv-todos`；`PREWARM_DELAY_MS = 2000` 延迟预热；折叠键由 `resolveCollapseKey()` 配置 | `state/store.ts` 的 `getRenderState()`（从会话分支的 custom entry 重放，`replayFromBranch()`）；`selectVisibleTasks()`/`selectTodoCounts()` 过滤 |
| `✓ CG` / `○ CG` / `! CG: setup failed` | @henryqw/pi-codegraph | `extensions/codegraph.ts` → `ctx.ui.setStatus(STATUS_KEY, …)` | `initialize()` 的索引结果 + `codegraph serve --mcp` 是否起来 |
| `advisor-scout` / `advisor-manual` / `advisor-usage` | pi-advisor-flow | `dist/index.js` → `setStatus("advisor-scout" \| "advisor-manual" \| "advisor-usage", …)` | 当前 Advisor 模型、手动模式开关、本会话咨询用量 |
| `bg …`（后台任务 dock 与状态） | pi-background-tasks | `dist/src/extension.js` → `ctx.ui.setWidget('background-tasks', …)`、`ctx.ui.setStatus('background-tasks', lightBlue(label))`；`dockShortcutFooterHint(config.dockShortcut)` 生成底栏提示 | `BackgroundTaskRegistry.allTasks()` / `snapshot()`；`STATUS_INTERVAL_MS = 1000` 刷新；`taskDisplayName()` 生成 2–6 词标签 |

**复刻要点**：底栏只有"一个 stats 行 + 一个扩展状态行"两层可扩展；想让 Yonder 自己的元素出现在 `↑in ↓out …` 同一行，必须改 pi 的 `FooterComponent` 本身（插件做不到）。插件级新增只能进第 3 行或 widget 区。

---

## 4. 上下文管理：pi 自带 compaction 与 billion-context 的共存

### 4.1 pi 自带 compaction

- **触发**：`shouldCompact(contextTokens, contextWindow, settings)` → `contextTokens > contextWindow - settings.reserveTokens`（`dist/core/compaction/compaction.js:173-176`）。默认 `reserveTokens = 16384`，即 200k 窗口在 ~183.6k 时触发；`agent-session.js:417-421` 用 `estimateProjectedContextTokens()` 做同一判断。
- **方式**：`findCutPoint()` 从尾部往前留约 `keepRecentTokens = 20000` token，之前的全部折叠成一条摘要；摘要用 `SUMMARIZATION_PROMPT`，**强制固定小节** `## Goal / ## Constraints & Preferences / ## Progress (### Done / ### In Progress / ### Blocked) / ## Key Decisions / ## Next Steps / ## Critical Context`。已有摘要时用 `UPDATE_SUMMARIZATION_PROMPT` 合并进旧摘要（增量，不重写）。
- **频率**：一次触发一次，整段替换；完成后 `getContextUsage()` 的 `percent` 变为 `null`，底栏显示 `?/200k` 直到下一次 LLM 响应才知道真实用量。
- **缓存**：`completeSummarization()` 明确设 `cacheRetention: "none"` —— 摘要调用本身不复用缓存；但摘要**结果**替换历史后，前缀整体变化，下一轮主请求必然 cache miss。
- **其它**：`branchSummary {reserveTokens: 16384, skipPrompt: false}` 用于分支摘要；`getSummarizationFailure()` 把 `stopReason` 为 `error`/`length` 视为失败（不落半成品摘要）。

### 4.2 billion-context 的 ACP 折叠

- **触发**：三层阈值（`CONFIGURATION.md`）——`compress.maxContextLimit` 默认 `"75%"`（强制 nudge 阈值，越过即立刻提示，绕过 growth gate）、`compress.emergencyThresholdPercent` 默认 `"95%"`（紧急截断超大工具输出）、`compress.nudgeGrowthTokens` 默认 50000（增长门：可折叠区间比基线多 5 万 token 才提示）；另有 `tierNudgeTokens {t1,t2,t3}`（T1 = nudgeGrowthTokens，T2/T3 = ×1.5）做分层蒸馏。
- **方式**：模型主动调 `compress({content: "m00150–m00220 主题\n摘要…"})`，按消息引用区间折叠；折叠分三层（T1 摘要 / T2 蒸馏 / T3 压缩），`decompress({blockId, full?})` 可逆，`search_context({query})` 检索块摘要。保护规则：`preserveRecentMessages`（默认 3）、`preserveRecentTokens`（≈5000）、`minCompressRangeChars`（≈5000 字符）、`protectedTools`（永不折叠的工具）、`neverPreserveRecentTools`（默认 `["decompress","search_context","read","bash"]`）、`protectedLatestTools`（只保护最新一次，如 todo 列表）。
- **频率**：由模型按 nudge 自主决定，可一轮多次；`compress.tiers` 默认开，把折叠成本分摊到多代。
- **与缓存的关系（关键）**：bili 在 Anthropic 线上自己打 `cache_control` 断点（system 块 + 最多 3 个累积 message 断点，"标记只在折叠时消失"）。所以：
  - 每折叠一段，该段之后的所有断点失效 ⇒ **CH 必然掉一段**，然后随轮次慢慢爬回；
  - `STAGED_COMPRESS_GUIDANCE` 因此建议"**尾偏折叠**（只折最近的大块，保住最早的前缀）"，理由写得很直白："大幅重写会急剧改变请求形状，可能触发供应商风控；小步尾偏折叠能保住前缀缓存"；
  - `cacheKeepalive.enabled`（默认 false）在空闲时用 `max_tokens=1` 重放上次请求保温 TTL；`stableSystemAnchor`（默认 false，且**插件模式永不做**）只在纯代理模式下把首见的 system 头部字节固定重发。
- **与 pi compaction 的共存（机制）**：bili 在 pi 模式下注册
  `pi.on("session_before_compact", async (event, ctx) => { if (event.reason !== "threshold" && event.reason !== "overflow") return undefined; if (!await ownsCompaction(ctx, ev.branchEntries)) return undefined; return { cancel: true }; })`
  ——`ownsCompaction()` 判断该会话模型流量是否确实经本地代理。**经代理 ⇒ 取消 pi 的阈值/溢出压缩，由 ACP 接管；不经代理 ⇒ 返回 `undefined`，pi 的压缩照旧。** 也就是说两套机制不是同时跑，而是**按"流量是否被代理"二选一**。
- **注意一个显示陷阱**：底栏的 `(auto)` 只是 `autoCompactEnabled` 这个设置位，**不代表运行时真的会压缩**——被 bili cancel 掉之后底栏仍显示 `(auto)`。复刻时要么让这个位反映真实状态，要么明确它的语义。

### 4.3 给 Yonder 的取舍建议

1. **不要两套都开**。二选一即可，否则阈值判断、摘要格式、缓存策略互相打脸。
2. 若走"模型主动折叠"路线（bili 的做法），必须同时具备：区间引用（`mNNNNN`）、可逆 `decompress`、块摘要检索、尾偏折叠指导、以及"折叠后 CH 会掉"的产品预期管理。
3. 若走"阈值摘要"路线（pi 的做法），把 `reserveTokens` 与 `keepRecentTokens` 暴露成用户可调，并保留 pi 的固定小节结构（Goal/Constraints/Progress/Decisions/Next Steps/Critical Context）——这个结构对下游"继续干活"的可读性明显好于自由发挥。
4. **状态类注入（goal/todo/运行列表）必须放消息尾部并逐字保留上一轮尾部**（pi-goal-x 的 `liveRetention`、pi-subagents 的 `context_with_system`），绝不要每轮重写 system 头。

---

## 5. 结论：哪些能原样依赖、哪些要转写、哪些不适合 C 端

### 5.1 可以原样作为 Yonder 默认插件依赖（风险低、边界清楚）

| 包 | 理由 |
|---|---|
| **cc-safety-net** | 零提示词成本、纯拦截、C 端必需的安全底线 |
| **pi-hashline-edit-pro** | 直接提升编辑精度、提示词组织最规范（三件套 + guideline id）、可对特定模型禁用 |
| **@juicesharp/rpiv-todo** | 单工具 + 单 widget，状态重放正确，用户可感知进度 |
| **pi-lens** | 开发者场景收益大；工具懒激活，非开发者可整体关掉 |
| **pi-background-tasks** | 长任务不阻塞；防轮询的行为约束写得最好 |
| **pi-web-access** | 懒加载，默认 0 成本；正文落盘按需取，是控制上下文的正确姿势 |

### 5.2 可以抄（不要整包依赖，把机制/文案搬进 Yonder）

| 来源 | 抄什么 |
|---|---|
| **pi 本体** | `buildSystemPromptSections` 的八段结构、`diffSystemPromptSections` 的段级补丁、`buildRules` 的"工具在才出规则"、footer 三行布局与 `formatTokens` |
| **pi-simplify** | `buildSimplifyPrompt` 的 Principles/Scope/Process 三段与"只改列出的行号区间"约束 |
| **pi-advisor-flow** | "第二模型 + 脱敏上下文 + adviceId 追踪采纳"的咨询模式；draft 8 KiB 上限与"不可信"标注 |
| **pi-goal-x** | `liveRetention` 的"逐字保留上轮尾部"手法；状态放消息尾而非 system 头 |
| **pi-lens** | "description 只放契约 + 一个例子，运行期指导放结果里"；40 KiB 结果门禁 + usage footer |
| **pi-subagents** | `SUBAGENT_SAFETY_GUIDANCE` 的授权边界措辞；`active_subagents`/`advertised_subagents` 两个结构化段的拆分 |
| **pi-background-tasks** | "完成即唤醒、禁止轮询"那一组 promptGuidelines |

### 5.3 需要转写（机制要，实现不能直接搬）

| 包 | 为什么 |
|---|---|
| **billion-context** | 代理层是明文 loopback 中间人 + 一整套 ACP 内核（折叠/蒸馏/CCR/keepalive），与 Yonder 的会话存储和 provider 层强耦合；能搬的是"区间折叠 + 可逆 + 检索 + 尾偏折叠 + 缓存断点管理"这套**协议设计**，不是它的 HTTP 代理 |
| **pi-subagents** | 能力面过大（missions/schedules/watchdog/panes/lane/外部 CLI agent），且会起子进程读真实凭据；Yonder 若要子 Agent，应按自己的会话模型重写编排层，复用它的安全措辞与段结构 |
| **pi-goal-x** | 与 Yonder 自身 goal 机制功能重叠；30+ 文件的状态机不宜整体移植 |
| **pi 本体 footer / compaction** | 结构照抄，参数与文案必须按 Yonder 产品重定（`(auto)` 语义、摘要小节、CH 展示） |

### 5.4 不适合 C 端

| 包 | 原因 |
|---|---|
| **codex-computer-use-mcp** | 依赖 macOS + OpenAI 官方签名应用 + 辅助功能权限；屏幕内容即隐私；`get_app_state` 默认返回 diff 易误导模型。企业内网/受控设备场景可另议 |
| **pi-advisor-flow**（作为默认） | 每次咨询多一次模型调用与费用；需要用户显式配置 advisor 模型，默认开会让 C 端用户困惑 |
| **pi-subagents**（作为默认） | 常驻 ~1.9k token 提示词 + 子进程 + 凭据，普通用户用不到 |

### 5.5 C 端最小默认集（建议）

`pi 本体（转写）+ cc-safety-net + rpiv-todo + pi-hashline-edit-pro`，其余按能力开关（开发者开 pi-lens，长任务开 background-tasks，需要联网开 web-access）。这样常驻注入从 ~11.5k 降到约 **4.5k tokens**（本体 ~1.2k + hashline 2.8k + todo 0.6k，安全网 0）。

---

## 6. 未做 / 未验证

- 未运行任何插件，全部结论来自源码与文档阅读；"底栏实际显示效果"以本次会话截图式观察为准，未做逐包 A/B。
- 未核对 `~/.pi/agent/settings.json` 之外的运行时配置（`~/.pi/agent/acp.json`、`billion-context.json`、各插件 flag 文件），因此"默认值"均指**包内默认**，不代表本机实际生效值。
- 下载量只覆盖 `/tmp/pi-dl.json` 里有的 10 个包；`codex-computer-use-mcp`、`@henryqw/pi-codegraph`、`pi-advisor-flow` 缺失，未联网补。
- 未读 `auth.json` / `models.json`，未记录任何密钥；provider 与模型 id 也未在报告中展开。
- token 估算按"英文字符数 / 3.6"粗算，未用真实分词器，误差约 ±15%。
