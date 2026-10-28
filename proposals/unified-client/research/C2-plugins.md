> 证据材料，结论已并入 [design.md](../design.md)

# 插件生态前 50 调研：pi 与 DeepSeek Harness 对 Yonder 官方默认插件体系的参考

> 口径与局限先说明，后面所有结论都以此为前提：
> - **pi 侧数据**：`https://registry.npmjs.org/-/v1/search?text=keywords:pi-package&size=250&from=0..750`（取 1000 条）＋ `https://api.npmjs.org/downloads/point/last-month/<pkg>`（近 30 天，区间 2026-09-27 至 2026-10-26，见任一响应的 `start`/`end` 字段）。命令经 `~/.local/bin/agent-network run --`。
> - **样本局限（重要）**：搜索结果 `total=12892`（即 npm 上带 `pi-package` 关键字的包总数），我只按相关性顺序取了前 1000 条；下载量解析成功 **453/1000**。失败原因已定位：批量接口对 scoped 包（`@scope/name`）返回 HTTP 400（`curl 'https://api.npmjs.org/downloads/point/last-month/@hypabolic/pi-hypa,billion-context'` → 400），逐个补查时又被限流（`error code: 1015`）。因此**前 50 榜对 scoped 包可能漏排**，凡 scoped 包的位次都算「下限值」。未核实项我会标注。
> - **DeepSeek Harness 侧**：`~/Documents/deepseek-harness-src` 只读扫描 `packages/*/*/package.json`（316 个包）。**没有任何下载量/排名依据**，原因见 §3。
> - 所有仓库文件均未修改。

---

## 1. pi 生态：机制先说清，再谈榜

### 1.1 pi 的「插件」就是 npm 包

| 事实 | 出处 |
|---|---|
| 包用常规目录 `extensions/ skills/ prompts/ themes/`，无 manifest 也能被发现 | `docs/packages.md:47-55` |
| 显式清单字段为 `"pi": { extensions, skills, prompts, themes }`，路径相对包根、支持 glob 与排除 | `docs/packages.md:57-72` |
| `keywords: ["pi-package"]` 是**进入 Pi 官方 gallery（pi.dev/packages）的唯一条件**；`pi.image`/`pi.video` 提供预览 | `docs/packages.md:74` |
| 宿主自带包（`@earendil-works/pi-ai`、`pi-agent-core`、`pi-coding-agent`、`pi-tui`、`typebox`）必须写进 `peerDependencies: "*"`，**不得**进 `dependencies`，否则出现重复类/注册表 | `docs/packages.md:84-90` |
| 包身份按「npm 包名 / git URL 去 ref / 本地绝对路径」去重，防重复加载 | `docs/packages.md:127` |
| 设置里可按资源类型裁剪：`[]` 全关、`!pattern` 排除、`+path` 精确包含 | `docs/packages.md:105-119` |
| 扩展的集成点：事件、工具（`:245`）、工具暴露与动态启用（`:265,297`）、工具渲染（`:303`）、**MCP 服务器（`:307`）**、上下文与会话变更（`:324`）、状态（`:337`）、UI 与模式（`:357`） | `docs/extensions.md` 目录 |

**结论（用于 §6 规范）**：pi 生态的「插件」粒度是**能力包**，一个包可同时贡献工具＋技能＋提示模板＋主题＋UI，这与 Yonder 的 `yonder.contributes`（tools/skills/presets/contexts/channels/hooks/triggers/permissions，见 `plugins/*/package.json` 的 `yonder` 字段，格式见 `docs/spec/04-plugins.md:19-30`）是同构的。差别在：pi 用**资源目录约定**，Yonder 用**显式 contributes 声明**（`docs/spec/04-plugins.md:233` 要求 `checkPlugin` 比对声明与实际注册）。

### 1.2 pi 近 30 天下载量前 50（按 `downloads/point/last-month` 降序）

| # | 包 | 月下载 | 做什么 | 类别 |
|---|---|---|---|---|
| 1 | billion-context | 2,144,020 | 上下文压缩代理，跨 pi/Codex/Claude Code 通用，长会话 | 记忆/上下文 |
| 2 | pi-mcp-adapter | 1,447,560 | MCP 适配器扩展 | MCP |
| 3 | pi-web-access | 934,847 | 网页搜索、URL 抓取、GitHub 克隆、PDF、YouTube 理解 | 搜索/网页 |
| 4 | pi-mcp-extension | 650,490 | MCP 客户端扩展，连任意 MCP server | MCP |
| 5 | pi-subagents | 631,440 | 单 agent 委派与脚本化多 agent 工作流 | 会话/多 agent |
| 6 | @juicesharp/rpiv-ask-user-question | 220,314 | 结构化提问卡（选项式而非自由文本） | 会话/交互 |
| 7 | openwiki | 176,683 | 用文档 agent 生成并维护代码库 Wiki | 文档/知识 |
| 8 | @juicesharp/rpiv-todo | 140,707 | 模型可见的 todo 浮层，跨 /reload 与压缩存活 | 会话/任务 |
| 9 | @dietrichgebert/ponytail | 104,317 | 「懒资深工程师」方法论技能包 | 技能/方法论 |
| 10 | @langfuse/pi-observability-plugin | 99,879 | 把 prompt/轮次/生成/工具调用追踪到 Langfuse | 可观测 |
| 11 | @plannotator/pi-extension | 99,594 | 交互式计划评审与批注 | 会话/评审 |
| 12 | context-mode | 90,015 | MCP 上下文压缩（宣称省 98% 窗口），沙箱代码执行 | 记忆/上下文 |
| 13 | @langchain/langsmith-pi-extension | 88,004 | LangSmith 追踪 | 可观测 |
| 14 | pi-lens | 79,180 | 实时 LSP/格式化/lint/结构化分析反馈 | 代码质量 |
| 15 | pi-powerline-footer | 76,419 | Powerline 状态栏 | UI |
| 16 | pi-claude-bridge | 72,503 | 用 Claude Code（Agent SDK）当模型提供方 + AskClaude 工具 | 模型/桥接 |
| 17 | cc-safety-net | 72,288 | 拦截破坏性命令与密钥文件访问（多宿主通用 hook） | 安全 |
| 18 | pi-web-search | 71,967 | 各家原生 web search（Gemini/xAI/OpenAI/Anthropic/DeepSeek） | 搜索 |
| 19 | pi-goal-x | 70,084 | `/goal` 目标规划、持久进度、独立完成审计 | 会话/目标 |
| 20 | bigpowers | 60,807 | 73 个 agent 技能的方法论合集 | 技能/方法论 |
| 21 | @gotgenes/pi-permission-system | 56,054 | 权限策略执行 | 安全/权限 |
| 22 | @narumitw/pi-usage | 55,437 | 各家用量、限额、重置时间、余额 | 模型/用量 |
| 23 | pi-cc-extensions | 52,988 | Claude Code 风格 TUI 输出与实用工具 | UI |
| 24 | @companion-ai/feynman | 51,561 | 开源研究 agent（文献综述、实验） | 研究 agent |
| 25 | pi-memory | 45,546 | 语义检索式记忆（日志/长期记忆/草稿） | 记忆 |
| 26 | pi-background-tasks | 43,619 | 持久后台 shell 任务、只读委派 agent | 会话/任务 |
| 27 | confluence-cli | 42,661 | Confluence 页面读写 CLI | 渠道/文档 |
| 28 | @agimon-ai/log-sink-mcp | 40,800 | 日志汇聚 MCP server | MCP/日志 |
| 29 | pi-simplify | 35,700 | 复查近期改动的一致性/可维护性 | 代码质量 |
| 30 | pi-btw | 33,988 | `/btw` 并行侧聊 | 会话 |
| 31 | pi-intercom | 31,743 | agent 之间互通（描述被 banner HTML 覆盖，**内容未核实**） | 多 agent 通信 |
| 32 | pi-cache-optimizer | 28,238 | 提高 prompt/KV 缓存命中率，页脚缓存统计 | 上下文/缓存 |
| 33 | pi-fireworks | 24,770 | Fireworks AI 提供方 | 模型/提供商 |
| 34 | pi-hermes-memory | 24,392 | 持久记忆 + 会话搜索 + 密钥扫描，SQLite FTS5 | 记忆 |
| 35 | glimpseui | 23,490 | 跨平台 WebView 微 UI 窗口，双向 JSON 通信 | UI |
| 36 | pi-provider-litellm | 23,045 | LiteLLM 代理提供方 | 模型/提供商 |
| 37 | pi-prompt-template-model | 22,740 | 提示模板与模型选择器 | UI/模板 |
| 38 | agent-simple-english | 22,360 | 技术英语 lint（CLI + 宿主适配） | 文本质量 |
| 39 | gentle-pi | 22,287 | ODD 开发流程（子 agent、TDD 证据、原生评审） | 工作流 |
| 40 | gentle-engram | 21,567 | 跨会话/压缩持久记忆（本地或云） | 记忆 |
| 41 | pi-fireworks-quota | 21,265 | Fireworks 余额/用量命令 | 模型/用量 |
| 42 | pi-interview | 20,170 | 交互式访谈表单 | 会话/表单 |
| 43 | agent-comms | 18,986 | 跨宿主 agent 通信网格（房间/私信/在线状态，TCP） | 多 agent 通信 |
| 44 | pi-agent-browser-native | 18,909 | 把 agent-browser 暴露为原生工具 | 浏览器 |
| 45 | pi-hashline-edit-pro | 17,305 | 锚点式 read/replace/insert/grep 工具 | 代码编辑 |
| 46 | latchkey | 16,633 | 给 curl 注入 API 凭据的 CLI | 凭据 |
| 47 | pi-antigravity | 16,495 | Antigravity / Cloud Code Assist 提供方 | 模型/提供商 |
| 48 | pi-coralbricks-provider | 15,916 | CoralBricks 提供方（DeepSeek V4.1 Flash） | 模型/提供商 |
| 49 | pi-web-ui | 14,458 | 浏览器驾驶舱：chat/代码/文件/终端/Git 一页 | UI/Web 控制台 |
| 50 | projectops | 13,966 | GitHub 项目管理模板安装器（CI/版本/发布/技能） | 工程 |

前 50 合计月下载 8,208,207；第 50 名门槛 13,966。第 51–60（`pi-otel` 13,131、`pi-markdown-preview` 13,029、`@brainervirus/workit-pi` 12,605、`pi-gauntlet` 12,226、`pi-zentui` 12,061、`pi-zhipu-usage` 12,038、`pi-coding-agent-test` 11,831、`pi-goal-list-loop-audit` 11,714、`pi-until-loop` 11,650、`pi-ask-user` 11,047）。

**榜面结构观察（事实）**：头部极度集中——第 1–5 名占前 50 总量的 **73%**（6.0M/8.2M），第 1 名单包 2.14M。前 50 里「基础设施类」（MCP 适配、搜索、上下文压缩、记忆）远多于「业务能力类」。

---

## 2. pi 生态分类统计

| 类别 | 数量 | 占比 | 成员 |
|---|---|---|---|
| 会话/任务/目标/评审 | 8 | 16% | pi-subagents, rpiv-ask-user-question, rpiv-todo, pi-goal-x, pi-background-tasks, pi-btw, pi-interview, plannotator |
| 模型/提供商/用量 | 7 | 14% | pi-claude-bridge, pi-fireworks, pi-provider-litellm, pi-fireworks-quota, pi-usage, pi-antigravity, pi-coralbricks-provider |
| 记忆/上下文/缓存 | 6 | 12% | billion-context, context-mode, pi-memory, pi-hermes-memory, pi-cache-optimizer, gentle-engram |
| 代码质量/编辑/LSP/工程 | 5 | 10% | pi-lens, pi-simplify, pi-hashline-edit-pro, projectops, agent-simple-english |
| UI/终端/Web 控制台 | 5 | 10% | pi-powerline-footer, pi-cc-extensions, glimpseui, pi-prompt-template-model, pi-web-ui |
| 搜索/网页/知识库 | 4 | 8% | pi-web-access, pi-web-search, openwiki, confluence-cli |
| MCP/工具桥 | 3 | 6% | pi-mcp-adapter, pi-mcp-extension, log-sink-mcp |
| 安全/权限/凭据 | 3 | 6% | cc-safety-net, pi-permission-system, latchkey |
| 可观测 | 2 | 4% | langfuse, langsmith |
| 多 agent 通信 | 2 | 4% | pi-intercom, agent-comms |
| 技能/方法论 | 2 | 4% | ponytail, bigpowers |
| 研究/工作流 agent | 2 | 4% | feynman, gentle-pi |
| 浏览器 | 1 | 2% | pi-agent-browser-native |

（分类由我按包描述人工归类；脚本初分类把 11 个归「其他」，见 `/tmp/cat.py` 运行结果。）

**可迁移的读法**：pi 生态的高下载包几乎都在补「宿主缺的基础设施」——上下文、MCP、搜索、记忆、权限、用量、可观测。**没有一个高下载包是「社交/IM 渠道」**（唯一的 `confluence-cli` 是文档工具，不是消息渠道）。这与 Yonder 的重心（渠道＋任务＋记忆）正好互补。

---

## 3. DeepSeek Harness 生态：有插件机制，无市场、无排名

### 3.1 机制（已核实）

| 事实 | 出处 |
|---|---|
| 插件体系基于 cordis：依赖 `@deepseek-ai/cordis`、`cordis-plugin-loader`、`cordis-plugin-timer` | `packages/boot/plugin-manager/package.json:68-69,90-91,98` |
| `@deepseek-ai/dsh-plugin-manager`：「从 Web 侧栏或 agent 启用 profile 插件、安装/移除/选择 bundle」，通过**包管理器（pnpm）与 registry 检查**执行安装 | `packages/boot/plugin-manager/README.md:3-11` |
| 分发单位是 **bundle**（profile 补丁层），不是单插件：`packages/bundle/{base,web-app,acp-app,sdk-app,sdk-minimal,headless}` | `ls packages/bundle` |
| 应用面：`apps/{cli,web,desktop,desktop-host}` | `ls apps` |
| 工作区共 **316 个包**（`packages/*/*/package.json` 计数） | 脚本统计 |
| 包无 `keywords` 字段（抽查 `plugin-manager` 为 `None`），**没有 npm 上的可发现性标记** | `packages/boot/plugin-manager/package.json` |

**结论**：DSH 的插件是**仓内 monorepo 包 + npm 私名分发 + bundle 组合**，安装面靠 pnpm 与 registry 检查，**没有公开的插件市场、没有 gallery、没有下载量**。因此题目要求的「按排名取前 50」在本生态**不可得**，排名依据缺失（不是我没找到：全仓 `grep -rn "marketplace\|插件市场" docs packages/*/README.md` 无命中；`docs/architecture.md` 也无 registry 地址）。

### 3.2 316 个官方包按能力归类（脚本统计，含「其他」说明）

| 类别 | 数量 | 占比 | 代表包 |
|---|---|---|---|
| 会话/任务/计划/审批 | 50 | 15.8% | `dsh-session-*`(26)、`dsh-goal`、`dsh-plan`、`dsh-jobs`、`dsh-schedule`、`dsh-user-questions`、`dsh-user-approval`、`dsh-workflow` |
| 代码/执行工具 | 50 | 15.8% | `dsh-tool-*`(24)、`dsh-shell`、`dsh-bash`/`pwsh`、`dsh-sandbox`、`dsh-fs`、`dsh-lsp`、`dsh-terminal`、`dsh-computer-use` |
| UI/交互（Web 客户端） | 43 | 13.6% | `dsh-client-ui-*`（chat、conversation、layout、dockkit、goal、jobs、plan、plugin-manager、permission-presets、schedule、model-selection…） |
| 平台/宿主基础设施 | 46 | 14.6% | `dsh-host-*`、`dsh-api-*`(9)、`dsh-typert`、`dsh-boot-*`、`dsh-sdk-*`、`dsh-hmr`、`dsh-plugin-manager` |
| 文件/附件/交付物 | 18 | 5.7% | `dsh-attachment*`、`dsh-file-*`、`dsh-client-ui-deliverables`、`dsh-spill`、`dsh-document`、`dsh-office-to-pdf` |
| 模型/提供商/用量 | 17 | 5.4% | `dsh-llm-*`(8)、`dsh-deepseek-*`、`dsh-token-meter`、`dsh-client-ui-model-selection` |
| 搜索/网页/抓取 | 15 | 4.7% | `dsh-web-*`、`dsh-browser-use`、`dsh-search*` |
| 浏览器 | 6 | 1.9% | `dsh-browser-use`、`dsh-experimental-computer-use-cua-driver-native` |
| 渠道/集成（ACP/MCP/webhook） | 6 | 1.9% | `dsh-acp`、`dsh-mcp`、`dsh-webhook`、`dsh-cordis-*` |
| 记忆/上下文/压缩 | 6 | 1.9% | `dsh-compaction*`(4)、`dsh-context`、`dsh-output-retention` |
| 通知/提醒/反馈 | 3 | 0.9% | `dsh-feedback`、`dsh-client-ui-message-feedback` |
| 其他（agent/prompt/skill/workspace/凭据/诊断） | 56 | 17.7% | `dsh-agent*`(8)、`dsh-skill*`(4)、`dsh-system-prompt`、`dsh-workspace*`、`dsh-credentials`、`dsh-guard`、`dsh-runtime-diagnostics` |

**对 Yonder 有直接参考价值的 20 个（按我的判断，非排名）**：`dsh-session-controller`、`dsh-api-session-controller`、`dsh-client-ui-conversation`、`dsh-client-ui-plugin-manager`、`dsh-plugin-manager`、`dsh-config-editor`、`dsh-hmr`、`dsh-goal`、`dsh-plan`、`dsh-schedule`、`dsh-user-questions`、`dsh-user-approval`、`dsh-client-ui-approval`、`dsh-compaction`、`dsh-token-meter`、`dsh-sandbox`、`dsh-attachment`、`dsh-client-resources`、`dsh-client-shortcuts`、`dsh-client-locale`。

**与 Yonder 的结构差异（事实→推断）**：DSH 把「会话控制器 / API 控制器 / 客户端 UI」拆成三个包，`dsh-client-ui-*` 有 43 个；Yonder 的对应物是内核 `packages/core` 加插件 `ui-companion`/`tasks` 的渲染器。**推断**：DSH 的拆法适合「一个前端要装配 40+ 个可选界面块」的形态，而这正是 `design.md:452-464`（views 槽）想解决的问题——Yonder 若采纳 views 槽，DSH 的 `client-ui-*` 命名与粒度是现成的参照。

---

## 4. 两边合计：能力类占比（50 + 316）

| 类别 | pi 前 50 | DSH 316 | 合计占比（366） |
|---|---|---|---|
| 会话/任务/计划 | 8 | 50 | 15.8% |
| 代码/执行 | 5 | 50 | 15.0% |
| UI/交互 | 5 | 43 | 13.1% |
| 平台/宿主基础 | 1 | 46 | 12.8% |
| 记忆/上下文 | 6 | 6 | 3.3% |
| 模型/提供商/用量 | 7 | 17 | 6.6% |
| 搜索/网页 | 4 | 15 | 5.2% |
| 文件/附件 | 0 | 18 | 4.9% |
| MCP/工具桥 | 3 | 6 | 2.5% |
| 浏览器 | 1 | 6 | 1.9% |
| 渠道/集成 | 0（pi 侧无消息渠道） | 6 | 1.6% |
| 安全/权限/凭据 | 3 | 3（含 credentials/guard） | 1.6% |
| 可观测/诊断 | 2 | 4 | 1.6% |
| 多 agent 通信/技能/方法论 | 6 | 8（subagent 8） | 3.8% |
| 通知 | 0 | 3 | 0.8% |
| 其他 | 9 | 56 | 17.8% |

（两边口径不同：pi 是「按下载量选出的头部」，DSH 是「仓内全集」，所以 DSH 的占比反映**它自己拆得多细**，不代表用户需求。可比的是「哪些类别在两边都出现」——会话/任务、代码执行、UI、记忆、搜索、MCP、模型提供商在两边都成立，是真实需求类。）

---

## 5. 对照 Yonder 现有 23 个插件

Yonder 现状（`plugins/*/package.json` 的 `yonder.contributes`，逐包核对）：

| 插件 id | 贡献 | 生态对应 | 覆盖判断 |
|---|---|---|---|
| agent-presets | presets 4 个 + contexts 7 个 | pi: 无直接对应（pi 用 prompts 目录）；DSH: `dsh-agent-preset` | 已覆盖，但 `design.md:475` 指出 4 个预设把 `model` 写死 `openai/gpt-6-luna` |
| browser-skill | 9 个 tools | pi: `pi-agent-browser-native`(18,909)、`@onkernel/browser-loop`；DSH: `dsh-browser-use` | 已覆盖 |
| channel-card | channels card + push 工具 | 两边都无（生态无社交渠道） | Yonder 独有 |
| channel-cli | channels cli | pi: 无（TUI 是宿主内置） | Yonder 独有，合理 |
| channel-feishu | channels feishu + 5 tools | 两边都无 | Yonder 独有 |
| channel-github | channels github + 7 tools | pi: 无渠道，但有 `gh` 类工具包；DSH: 无 | 部分对应（工具面像 pi 的 GitHub 工具，渠道面独有） |
| channel-mcp | channels mcp（自起 loopback，18 个控制工具） | DSH: `dsh-mcp`；pi: `pi-mcp-extension` 是**客户端**方向 | 已覆盖（方向相反，见 §5.2） |
| channel-qq | channels qq | 两边都无 | Yonder 独有 |
| channel-wechat-ilink | channels wechat-ilink + 3 tools | 两边都无 | Yonder 独有 |
| clipboard | 5 tools + hook `clipboard-redact` | pi: 无（`latchkey` 16,633 只做凭据注入）；DSH: 无 | Yonder 独有（macOS 限定） |
| codex-tools | 4 tools + trigger | pi: `pi-claude-bridge`(72,503) 是同类思路的 Claude 版 | 已覆盖（方向对应） |
| context-files | contexts agents-md/user-md/soul-md/memory-md | pi: 无对应包（宿主内置 AGENTS.md）；DSH: `dsh-agent-instructions`、`dsh-system-prompt` | 已覆盖 |
| cron | 2 tools + trigger | pi: 无（`pi-background-tasks` 43,619 是近似物）；DSH: `dsh-schedule` | 已覆盖 |
| devices | 9 tools + skill + trigger | pi: 无；DSH: `dsh-computer-use`、`dsh-api-terminal-controller` | Yonder 独有（`design.md:500-520` 标注 daemon 与配对未完成） |
| hermes-experience | 8+ tools（记忆读写/技能库/复盘/refine） | pi: `pi-hermes-memory`(24,392)、`gentle-engram`(21,567)、`pi-memory`(45,546) 同类 | 已覆盖（且比 pi 侧多「静默会话后复盘」） |
| mcp-client | 2 tools + context + trigger | pi: `pi-mcp-extension`(650,490)、`pi-mcp-adapter`(1,447,560) | **已覆盖且是生态第一需求类** |
| media-tools | 2 tools（出图/转写） | pi: 无头部对应；DSH: `dsh-experimental-speech-to-text` | 已覆盖 |
| memory | 9 tools + 2 triggers + presets | pi: 记忆类前 50 里 6 个 | 已覆盖（Yonder 的 Markdown 方案与 `pi-memory` 同类） |
| native-automation | 2 tools + permissions + trigger | pi: `pi-agent-browser-native`；DSH: `dsh-computer-use` | 已覆盖 |
| tasks | 7 tools + context + 2 triggers + hook | pi: `rpiv-todo`(140,707)、`pi-goal-x`(70,084)、`pi-background-tasks`(43,619)；DSH: `dsh-goal`/`dsh-plan`/`dsh-jobs` | 已覆盖（Yonder 的账本形态比 pi 的 todo 更重） |
| ui-companion | 2 tools + trigger | pi: `glimpseui`(23,490)、`pi-web-ui`(14,458)；DSH: `dsh-client-ui-*` | 已覆盖 |
| web-tools | 3 tools（search/extract/fetch） | pi: `pi-web-access`(934,847)、`pi-web-search`(71,967) | 已覆盖 |
| wechat-archive | 7 tools + trigger | 两边都无 | Yonder 独有 |

### 5.1 Yonder 已覆盖的类（有对应生态需求的）
任务/会话（tasks、cron、agent-presets）、记忆（memory、hermes-experience）、浏览器（browser-skill、native-automation）、搜索（web-tools）、MCP（mcp-client）、代码（codex-tools）、UI（ui-companion）、渠道（channel-*）、文件/上下文（context-files）、媒体（media-tools）。

### 5.2 缺的高需求类（生态里下载量高、Yonder 没有独立插件）

| 缺的类 | 生态证据 | Yonder 现状 | 推断的影响 |
|---|---|---|---|
| **上下文压缩/缓存** | `billion-context` 2,144,020（榜第一）、`context-mode` 90,015、`pi-cache-optimizer` 28,238 | 无插件；`docs/spec/10-runtime-guarantees.md` 可能有内核级策略但**未核实**是否有压缩插件 | 长会话成本与稳定性缺口最大的一类 |
| **权限/安全策略** | `cc-safety-net` 72,288、`pi-permission-system` 56,054 | 有 `capabilities` 与 `permissions` 贡献（`native-automation` 用），但没有独立的策略插件 | 与 `design.md:73-128`「隐藏不是授权」互补 |
| **用量/配额可见性** | `pi-usage` 55,437、`pi-fireworks-quota` 21,265、`pi-zhipu-usage` 12,038 | 只有内核 `quota-source.ts`（`design.md:1` 提到 `packages/core/src/runtime/quota-source.ts:156`） | 用户看不到「这个月花了多少」 |
| **可观测/追踪** | `langfuse` 99,879、`langsmith` 88,004、`pi-otel` 13,131 | 无 | 面向开发者/排障，C 端可选 |
| **结构化提问/审批卡** | `rpiv-ask-user-question` 220,314、`plannotator` 99,594、`pi-interview` 20,170 | `ui-companion` 的 present 卡片可承载，但**没有专门的提问卡工具**（`design.md:452-464` 计划加 `interaction.suggestions`） | 与 `design.md` §5.3 onboarding 直接相关 |
| **计划/目标** | `pi-goal-x` 70,084、`plannotator` 99,594 | `tasks` 是账本，不是目标规划 | 中需求 |
| **多 agent 协作/通信** | `pi-subagents` 631,440、`pi-intercom` 31,743、`agent-comms` 18,986 | 有 `plugins/agent-presets` 的 jarvis 协调模板，但无 subagent 工具 | 中需求，Yonder 的绑定唤醒是另一条路 |
| **凭据注入/密钥代理** | `latchkey` 16,633、`cc-safety-net`（拦密钥文件） | 有 credentials 接口（`web-tools` README 提 `credential: tavily`） | 低 |

### 5.3 Yonder 有、生态里没有对应需求的（不要按「生态热度」砍）
- 4 个第三方渠道插件（feishu / wechat-ilink / qq / github）与 `channel-card`、`channel-cli`：pi 前 50 里**零个消息渠道**，DSH 只有 ACP/MCP/webhook。这是 Yonder 的产品差异点，不是冗余。
- `clipboard`、`wechat-archive`、`devices`：本机隐私与设备控制，两边生态都没有（DSH 有 `computer-use` 但非同类）。
- `media-tools`：pi 前 50 无媒体包（`feynman` 是研究 agent）。

**反向提醒**：Yonder 有 8 个渠道类插件（23 个里的 35%），而生态里渠道类占比 1.6%。**推断**：Yonder 的插件体系重心在「连接人」，pi 在「增强编码」。官方默认集不该照抄 pi 的头部榜。

---

## 6. 建议：Yonder 官方插件三档清单

分档沿用 `design.md:500-520` 已核实的判断（那里已给出 `distribution/bundles/{core,default,full}.json` 的落点），我在此基础上按 §1–§4 的生态证据补三项：**上下文压缩、用量可见性、提问卡**。

### 6.1 第一档：默认启用（随包安装且加载，无需用户配置）

| 插件 | 理由（生态依据） |
|---|---|
| agent-presets | 开箱体验的最小集；需先修 `model` 写死问题（`design.md:475`） |
| context-files | 零外联，决定 agent 行为的基础上下文 |
| memory | 记忆是 pi 侧第 3 大类（6/50，占 12%），且 Yonder 用 Markdown 无外部依赖 |
| tasks | 会话/任务是两边生态的最大类（15.8%）；Yonder 已有 D66 批准 |
| cron | 主动性的唯一来源（`design.md:57-71` 的「绑定唤醒」依赖它） |
| web-tools | 搜索是 pi 头部刚需（`pi-web-access` 934,847，第 3 名）；仅需一个 Tavily 凭据引用 |
| channel-cli | 无外部凭据的第二入口（`design.md:511`） |
| channel-card | 登录前不联网（spec 16 §5），是 Bot 模式的产品前提 |
| mcp-client | MCP 是 pi 生态第一需求（前 5 名占 2 个，合计 2.1M 下载），无服务器配置时空闲 |
| interaction（由 ui-companion 改名，见 §6.4） | 提问卡是 pi 侧第 6 名（220,314）；onboarding 与 Bot 建议都靠它 |
| **plugin-context-budget（新增）** | 补 §5.2 第一缺口：上下文压缩/缓存。参照 `billion-context` 的定位（压缩而非截断），先做「超阈值摘要 + 缓存友好前缀」，不做跨宿主代理 |

**不建议默认**：`learning`（`design.md:508` 已定「加载但默认只读」——我同意，但它不属于「启用」而属于「装上待授权」，归第二档更准确）。

### 6.2 第二档：随包安装、默认关闭（用户在一次授权/配置后启用）

| 插件 | 理由 |
|---|---|
| learning | 无 scope 时不授权任何记忆访问（README），装上但等授权 |
| browser-skill | 依赖 `bsk` CLI + 浏览器扩展（README 明确「不装浏览器引擎」），需用户装外部件 |
| native-automation | 需辅助功能/录屏权限，`permissions: ["native-automation"]` |
| clipboard | macOS 权限 + 隐私（剪贴板内容可能含密钥，`clipboard-redact` hook 说明风险已知） |
| wechat-archive | 读本机微信记录，隐私敏感 |
| devices | `plugins/devices/README.md:3` 说明 daemon 与配对未完成（W2），半成品不该默认开 |
| channel-mcp | 自起 loopback 并暴露 18 个控制工具（`plugins/channel-mcp/src/operations.ts:50,156`），鉴权方式**未核实**，默认不开端口（同 `design.md:513`） |
| channel-feishu / channel-wechat-ilink / channel-qq / channel-github | 第三方平台或地区性，需用户自己配凭据 |
| codex-tools / media-tools | 需外部账号（Codex 登录态、SiliconFlow 凭据）；**内容未核实**（同 `design.md:517`） |
| **plugin-usage-meter（新增）** | 用量/余额可见性（`pi-usage` 55,437 证明需求），但只在用户配了计费型提供商后有意义 |
| **plugin-permission-policy（新增）** | 参照 `cc-safety-net`(72,288) + `pi-permission-system`(56,054)：拦截破坏性命令与密钥文件读取。Yonder 有 `capabilities` 分级，缺「策略文件」这一层；默认关，避免与 scope 机制重复执法 |

### 6.3 第三档：可选安装（不进 bundle，用户在插件页装）

| 插件 | 理由 |
|---|---|
| hermes-experience | 精选记忆/复盘/原生技能，属进阶体验；pi 侧同类 3 个包合计 91,505 下载，说明是细分需求 |
| **plugin-subagents（新增）** | `pi-subagents` 631,440（第 5 名）是 pi 生态最重的「多 agent」需求；Yonder 有绑定唤醒，但缺显式委派。作为可选，避免默认引入调度复杂度 |
| **plugin-observability（新增）** | `langfuse` 99,879 + `langsmith` 88,004 + `pi-otel` 13,131，面向开发者排障，C 端默认关 |
| **plugin-plan（新增）** | 计划/目标（`pi-goal-x` 70,084、`plannotator` 99,594）；与 tasks 账本区分：tasks 记「做什么」，plan 记「为什么这么排」 |
| **plugin-credential-broker（新增）** | 参照 `latchkey`(16,633)：把凭据注入限定在受控 argv/env，替代散落的凭据引用；等 credentials 接口稳定后再做 |
| **plugin-skill-pack（新增）** | 参照 `ponytail`(104,317)/`bigpowers`(60,807)：方法论技能包，纯 Markdown 零风险，适合做「官方推荐但不默认」 |

### 6.4 清单与命名规范（对齐 pi 的 manifest 实践）

**命名（事实依据 + 建议）**：

1. **npm 名**：`@yonder/plugin-<id>`，`<id>` 全小写连字符，与 `yonder.id` 完全一致。现状 23 个插件已符合（`plugins/*/package.json` 的 `name` 与 `yonder.id` 一一对应）。pi 侧同类做法是 `name` 即包名、无 scope 强约束（`docs/packages.md:61`），Yonder 的 scope 更严，保持。
2. **插件 id = 工具名前缀**：`docs/spec/04-plugins.md:233` 要求工具名以 `<pluginId>_` 开头并由 `checkPlugin` 校验；实测 `browser-skill_setup`、`channel-feishu_card`、`tasks_open` 均符合。**不要**改成 `yonder.tasks.open` 这类点分名——会与 `contributes.permissions` 的 `<插件ID>.<局部ID>` 规则（`04-plugins.md:289`）冲突。
3. **加可发现性关键字**：pi 用 `keywords: ["pi-package"]` 进 gallery（`docs/packages.md:74`）。Yonder 现在**没有任何 keywords**（23 个 package.json 全部无 `keywords` 字段，已核对）。建议加 `"keywords": ["yonder-plugin", "yonder"]`，为将来插件页/市场留一个零成本的检索维度。
4. **manifest 字段分层**：保留 `yonder.apiVersion/id/entry/contributes`（`04-plugins.md:19-30`，`apiVersion` 是整数、不兼容变更必须提升，`04-plugins.md:227-228`）；**新增可选 `yonder.tier: "default" | "bundled" | "optional"`** 与 `yonder.requires: { permissions?, credentials?, bins? }`。理由：三档清单现在只能写在 `distribution/bundles/*.json` 里，插件自己不知道自己的档位；写进 manifest 后 `checkPlugin` 可顺带校验「声明了 tier=default 但 requires.bins 缺失」这类矛盾。这是新增机制，须在 `design.md` §10 变更清单里登记。
5. **宿主自带包必须 peer**：pi 明确禁止把宿主包写进 `dependencies`（`docs/packages.md:88-90`，理由是重复类/注册表）。Yonder 对应物是 `@yonder/sdk`——23 个插件里是否都已写成 peer，**未核实**（只读了 package.json 的 `yonder` 字段）。建议在 `checkPlugin` 加一条同义检查。
6. **bundle 文件即档位真相**：`distribution/bundles/{core,default,full}.json`（`design.md:519`）与 `yonder.tier` 必须一致；加一个测试读两者比对，避免双份真相。

---

## 7. 未核实与风险清单

1. **pi 前 50 的 scoped 包位次**：453/1000 解析成功，scoped 批量接口 400 + 单查限流（`error code: 1015`）。榜内 12 个 scoped 包的下载量是实查值，但**可能有 scoped 包被漏掉**；要补全需对 547 个 scoped 包逐个查询（约 10 分钟，带退避）。
2. **`pi-intercom` 的功能**：npm 描述字段被 banner HTML 占满，只能从 keywords 推断为 agent 间通信，**内容未核实**。
3. **Yonder 是否有内核级上下文压缩**：只确认了 `quota-source.ts:156`（`design.md:1` 引用），未读 `packages/core` 的 compaction 相关实现，所以 §5.2 的「缺」是「缺独立插件」，不等于「缺能力」。
4. **`channel-mcp` 的鉴权方式**：`design.md:513` 已标未核实，我未复核。
5. **DSH 的第三方插件是否存在公开分发**：只确认了 pnpm + registry 检查的机制（`packages/boot/plugin-manager/README.md:5`），未确认是否有公开 npm 上的第三方 cordis 插件，故「无排名依据」的结论限定在「官方仓内 + 公开市场」两个口径。
6. **`docs/spec/11-official-plugins.md` 只读了目录**（`grep -n '^#'`），其 15 节内容（BrowserSkill、Tavily、GitHub、飞书、微信、QQ）与我的分类一致，但未逐节核对默认开关。
