# N06 Computer Use 与 hosted search 连接

**状态**：已实现（待安装验收）；本地 SDK/真实 app-server 检查通过，尚未计作安装版 Yonder 验收。

**负责人**：Codex 核实本机连接；Yonder maintainer 实现适配。

**依赖**：N03。N00 可提前用已有入口试通；桌面与 hosted search 分别记录可用性。

**功能依据**：11 §3；10 §5。完整条款见 [10](../../spec/10-local-maintenance.md)、[11](../../spec/11-official-plugins.md)，本任务不定义新功能。

## 允许路径

- plugins/codex-tools/
- 本任务文件

共享 root workspace/锁文件/notices、总表、安装配置与运行服务由 Codex 整合，本会话不写。冻结功能文档不改。

## 实现安排

### 2026-10-18 经 Codex 审查的实现方案

本轮独立工作树 `/Users/zoran/.codex/worktrees/yonder-codex-tools/yonder-harness`，分支 `zoran/yonder-codex-tools`，基线 `b7f2951`。Codex 审查后已授权产品实现和一个中文本地 commit。后续实现范围收窄为 `plugins/codex-tools/` 与本任务；前述共享 workspace、锁文件、总表、CHANGELOG、安装配置及运行服务均由 Codex 整合，不由此会话修改。

**固定路径**：只接已经实测的官方本机 `codex app-server` stdio；使用原有 Codex home/登录态，不读取凭据文件、不调用 token 导出、不复制服务 app/缓存插件、不装第二驱动。浏览器默认归 N07。Yonder 仍由 pi 驱动模型循环，app-server 只承担桌面 MCP 与一次性 hosted search。开发 agent 使用获准 `openai/gpt-6.1-sol`；hosted search 固定已验证 `gpt-6-luna`，返回真实模型身份。

#### SDK 注册与输入

`definePlugin` 的 `setup` 仅通过 `api.tools.register(defineTool(...))` 注册下列静态工具，并注册一个资源收尾 trigger `codex-tools-lifecycle`（start 不启动进程，stop 释放本插件持有的进程）及 `run.end` 观察器。清单 `apiVersion:1 / id:codex-tools` 精确声明这些 tools/triggers；无需 SDK 改动，也不做 setup 时动态联网发现。

| 工具 | 参数（object，additionalProperties:false） | 能力与用途 |
|---|---|---|
| `codex-tools_status` | `{}` | `exec`；懒启动/initialize、临时桌面线程、分页 `mcpServerStatus/list(detail:full)`，只返回 CUA 服务的实际 tools/description/inputSchema 与发现状态；不运行 UI 动作，也不把发现当成系统权限已就绪 |
| `codex-tools_js` | `{code:string, title?:string(min:1,max:80), timeout_ms?:integer(min:1)}` | `exec`；逐字段保留已发现的 `cua_repl.js` 参数，调用前确认该线程仍有相应工具；不暴露任意 server/tool 选择，不借 readOnlyHint 把任意 JS 注册为只读工具 |
| `codex-tools_js_reset` | `{}` | `exec`；仅映射 `cua_repl.js_reset`，清除 REPL 绑定、不关闭用户应用，不自动重放动作 |
| `codex-tools_search` | `{query:string(min:1)}` | `exec, network`；固定用途的 native hosted search，不接受自由模型、cwd、config、工具集或任意 developerInstructions |

工具描述写清：先 status 取得真实上游使用说明；首次 js/每次 reset 后只执行上游要求的一个入口（如 `await cua.getState();` 或 `let app = await cua.getApp(bundleId);`），读完返回文档后再操作。应用发现、AX 树、截图、click/typeText/pressKey/scroll 直接由同一持久 REPL 的真实 `cua` API 提供，不另建一套动作 DSL。保留上游首次文档和后续错误/局部 inventory errors；默认不转焦点，每次动作后读最新 AX/截图再决定下一步；前台授权/飞书动作仍依赖当前任务明确授权。`exec` 是本机程序能力，与 bash 相同不是沙箱，不复制第二套 agent 权限判定。

#### 一个连接的所有权、取消与结果

- 最小所有权单位为一个活跃 Yonder run：按 `ctx.session` 保存一个懒创建的 app-server 连接/子进程，在该 run 的所有桌面与搜索调用之间复用；不同活跃 run 不共享可变 CUA REPL，避免取消某 run 时杀掉另一 run。不是“一工具一进程”，也不另建桌面/搜索双 transport。`run.end` 按其 session 释放；插件 trigger.stop 兜底收尾全部持有资源。当前 SDK 没有 PluginModule.stop，故使用已有 trigger 生命周期，不加 core 钩子/全局 process 监听器。
- 进程通过固定 argv `agent-network run -- codex app-server` 启动，cwd 是本插件创建的临时空工作目录，不是项目工作树。保留现有 Codex 登录环境，不新设 CODEX_HOME。initialize 的 clientInfo 标为 Yonder、experimentalApi:true，然后 initialized。Node child_process/readline 实现小型按 id 分派的 stdio 请求；无 shell 拼接、重试、驱动回退或全量配置日志。
- 同一连接上保留一个 ephemeral 桌面线程（跨当前 run 的 js 调用保留变量）；每次搜索创建独立 ephemeral 搜索线程。所有 requests 在写入前检查 `ctx.signal`，以 session 隔离通知；搜索在 turn/start 之前安装收集器，先缓冲该 thread 的早到通知，拿到 turnId 后绑定过滤，合并 item/completed 与最终 turn.items（按 item.id 去重），不丢失早完成事件。不能将另一个 thread/turn 的完成当成本次结果。
- 普通 RPC 30 秒；桌面 js 采用上游默认 30 秒/显式 timeout_ms，但不超过当前 run 的取消边界；搜索总预算 90 秒，覆盖初始化/配置检查/执行，不逐步重置预算。搜索在 turn/start 尚未回复时取消，按官方 startup-interrupt 契约发送 `turn/interrupt {threadId,turnId:""}`；取得 id 后用实际 turnId。收尾另有独立短预算，等待终态/关闭，不用已 abort 的 signal 阻断清理。
- MCP 直调没有已证实的服务端取消 RPC；本地取消不得伪称动作未发生。取消/超时/transport 断开使本 run 连接作废：停止接纳后续写入，拒绝全部 pending，关闭拥有的 app-server、等退出，必要时仅对自己持有的子进程做有界终止。不杀用户共享 CUA service，不 reload 全局 MCP，不自动恢复或重放动作。返回“动作结果未知，需重新观察”；后续显式调用建立新连接并重新读状态，不能继续使用旧变量。
- 正常完成搜索后 `thread/unsubscribe` 释放临时线程；run 收尾再释放桌面线程、关闭 stdin/子进程、移除监听器/定时器、删除自己创建的临时目录。不对 ephemeral thread 调 archive（已知 no rollout found）。unsubscribe 失败保留诊断并关闭该 run 自有连接，不伪造清理成功。
- 子进程 error/exit、stdout 非法协议、RPC error 与 MCP isError 都结算 pending/返回真实错误；服务端 approval/elicitation 请求明确拒绝，不挂起等待，也不自动授权。日志只含方法、阶段、退出码和去敏错误，不打印 config/read 原文、环境或 stderr 全量内容。
- `content[].text` 顺序合并到 ToolResult.text（注明官方 CUA 来源）；`content[].image {mimeType,data}` 映射为现有 `images:[{mime,data}]`，不把 base64 塞进 text；structuredContent 保留 JSON 文本，不丢 isError。其他非文本块显式标注原类型/可用 URI，不自行读取任意本地路径或抓取图片 URL。仅解析当前协议必要的 MIME/data 字段，缺失返回错误，不堆通用图片/未来块验证器；实际 screenshot block 仍待安装验收。

#### 用途受限搜索：复用已证实机制，不靠提示词声称隔离

1. 在同一连接受信任代码里 `config/read(cwd, includeLayers)`，仅提取配置 MCP 的名称/必要策略字段，不交给模型、不写全量日志。复用 probe2 的逐项 `mcp_servers.<name>.enabled=false`，不把 mcp_servers 整块替换成无 transport 的对象（第一次探测已经失败）。本机已验证原生路径按点分段而不识别 TOML 引号：只接纳字母/数字/下划线/连字符名称，遇到路径分隔字符明确阻塞，不能生成失效覆盖。
2. 搜索线程使用 probe2 已验证的功能关闭项：apps/artifact/browser/computer/code_mode/shell/unified_exec/plugins/hooks/skills/memories/multi_agent/goals 等来源关闭，agents/orchestrator MCP 与 skills 关闭，project docs/environment context 关闭，`web_search:live` 且 standalone_web_search:false；同时显式 `environments:[] / dynamicTools:[] / baseInstructions:"" / approvalPolicy:never / sandbox:read-only`。使用本机已验证配置，不扩展未来能力、通用 policy 或 attestation 框架；真实托管要求导致拒绝时保留原生错误，不绕过策略。
3. 每次启动后分页核验 `mcpServerStatus/list(threadId)`，MCP tool 数必须为 0；异常/重复游标、无效响应均失败，不开始模型 turn。桌面线程可用不代表搜索线程也应拥有 CUA。
4. thread/start 固定已验证 `gpt-6-luna`；不增加 model/list 门禁或自由模型配置。developerInstructions 固定“只用 native hosted web search，简洁回答并带来源”，query 只作为 user text。依据 thread/start 实际 model/modelProvider 返回所用模型，不伪造选择结果。
5. 成功门槛同时为 completed、非空回答、至少一个真实 `webSearch` item、原生结果含实际来源 URL。返回 provider、实际模型、threadId/turnId、原生 action/queries/results、回答与来源；外部文本明确是不可信来源。观察到 commandExecution/fileChange/MCP/delegation 等非搜索工具 item 则立即中断并报用途违规；不得返回普通模型回答冒充搜索、不得静默改走 Tavily。

**已有原生证明**：probe2 thread `01a14f1f-63fe-78c2-8025-1d4b3b23ec24`，turn `01a14f1f-7857-7861-8a8c-59ee49316556`，实际 `gpt-6-luna / completed / mcpToolCount:0`；itemTypes 仅 userMessage/webSearch/agentMessage，原生 results 含 `https://openai.com/index/unlocking-the-codex-harness/` 等官方来源。它证明本机协议与当前账号路径可用，不证明插件、Yonder 安装验收已通过。

#### 文件、依赖、source 检查与安装后验收

- `plugins/codex-tools/package.json`、`tsconfig.json`：沿现有插件包结构；运行依赖仅 `@yonder/sdk:0.1.4`、已安装的 `typebox:1.3.27`。stdio JSON-RPC 用 Node 标准库，不引入 MCP SDK、Codex SDK、OAuth 或第二驱动依赖。
- `src/index.ts`：固定工具/schema、setup 注册、run.end/trigger 收尾；`src/app-server.ts`：小型专用连接与 pending/通知/取消；`src/computer-use.ts`：发现/实际 MCP 调用/结果图片映射；`src/search.ts`：固定受限配置、native turn 收集与来源门槛。`src/*.test.ts` 就近最小检查；`README.md` 记真实本机依赖、上游入口及故障/权限引导。若摘取上游代码，在对应文件保留 OpenClaw 来源 commit/许可注释；共享 notices 的必要更新只提交信息给 Codex。
- source 检查：`npx tsc -b plugins/codex-tools`；`npx vitest run plugins/codex-tools/src/`；`npx biome check plugins/codex-tools/src/`。至少执行 checkPlugin（setup 不 spawn/联网、清单吻合）、参数拒绝、纯 MCP 图片/isError 映射、无 native search/无来源不得成功；早到通知/去重在真实协议链路中检查。纯结构性输入检查不编造模型/桌面返回；生命周期、取消与权限用真实 app-server 验证，不写假模型或成功占位。
- Codex 整合 root workspace/锁文件和安装接线，从服务外构建/更新后，安装版 Yonder 的获准开发 profile 真实发现工具 → CUA getState 列出获准应用 → getApp/AX/截图 → 在专用测试对象执行并撤销一次输入/选择等可逆动作 → 重新观察确认。截图必须进入 Yonder ToolResult.images/真实模型，不以日志中的路径代替。
- 同一安装版经 `codex-tools_search` 发出当前信息查询，保存 Yonder event/session/model、工具转录、实际 app-server thread/turn/model、MCP=0、native webSearch/results 和可打开来源证据；检查连接复用、取消搜索、取消 CUA 后不重放、run.end/服务 stop 无本插件自有进程残留。桌面/搜索独立判定；无登录、拒绝权限、服务未就绪、模型不可用分别记录，不主动撤销现有权限制造失败场景。

**参考阅读**：OpenClaw @ `cafa09e50556e08c2a04a670f16ac815482c5489` 的 web-search、bounded-turn、thread-requests、computer-use-service 全文，以及必要调用链 web-search-provider.runtime → ephemeral-turn、computer-use-readiness、native-mcp-app、thread-mcp-attestation；不采用其认证迁移、服务 app 安装/同步、客户端租约平台、自动 repair/retry。Hermes @ `0eb4f62a8b35ff3b0454a8dbdbd3a7b55a6849b0` 仅核对 `tools/computer_use/cua_backend_session.py` 的资源所有权与副作用结果未知边界，不采用备用 CLI/恢复重放。OpenCode @ `214fb7fdbab9ad13773629839f1178382400cf97` 仅核对 `packages/core/src/tool/runtime.ts` 与 `packages/schema/src/tool.ts` 输入/错误/interrupt 契约，不移植 Effect 工具执行框架。已完整核对本工作树 SDK/注册检查、插件 loader 生命周期和 runtime 工具/图片/AbortSignal 适配；`tasks/README.md` 实际位置为 `docs/tasks/README.md`。

## 验证与交付

Yonder 读取获准桌面应用并完成可逆动作；一条真实 hosted search 具有 native webSearch 记录及来源。两项独立记通过/阻塞，桌面通过即可供 N13 使用；任一失败不阻塞 N07/N08/N09/N10。目标仍保留，不能以其他供应商成功代记通过。

记录实际命令、event/session/model、commit/PR 与失败/跳过；Yonder 和 Codex 的贡献分开归属。

## 问题

当前没有 Yonder 插件运行通过的声明。与已验证探测相比真正剩余的点：

- 桌面发现不等于 AX/截图/输入权限就绪；真实 screenshot 结果形状、图片进入 Yonder 模型、专用测试对象的可逆交互与焦点效果待测。程序缺失、服务不可达、明确系统权限拒绝、普通调用失败须按真实信号区分；未知原因保留 unknown，不把任意异常都归为缺权限。授权由用户完成后再次真实读取确认，插件不自动改系统权限。
- 探测采用独立短进程，尚未验证同一 Yonder run 的连接复用、不同线程 CUA REPL 隔离、取消 start 竞争、MCP 直调取消的副作用不确定性、thread/unsubscribe 及 stop 无泄漏。连接隔离若实测不成立，报告证据给 Codex，不自行增加桌面驱动/调度器。
- probe2 的 MCP=0 与 native webSearch 已证实；安装后的受限线程配置与取消仍待真实验收，不将事后 item 检查冒充事前沙箱。
- 浏览器 Missing required Codex turn metadata 是已知不支持边界，归 N07；N06 不伪造 session_id/turn_id 绕过。安装整合、服务外更新与最终真实验收由 Codex 放行后进行。

## 结果

### 2026-10-18 实现与 source 检查（Yonder maintainer 执行）

- 新增独立插件包，四工具、真实 CUA 文本/图片/isError 映射、用途受限 Luna 搜索、按 session/run 懒连接所有权、run.end/trigger.stop 收尾；同 session 并发调用返回明确 busy，不并发争用持久 REPL。不同 session 自有连接；无重试、自动修复、备用驱动或 OAuth 读取。
- 依赖缺失，实际执行 `npm ci --offline` 成功（236 packages，audit 0 vulnerabilities；npm 保留 3 项 install-scripts 未覆盖警告）；没有修改锁文件或根包。
- `npx tsc -b plugins/codex-tools` 成功；`npx vitest run plugins/codex-tools/src/` 最终 **1 文件、6 tests passed / 0 failed / 0 skipped**；局部 `npx biome check plugins/codex-tools/src/ plugins/codex-tools/package.json plugins/codex-tools/tsconfig.json` 最终 7 文件通过。首次 Biome 有 10 项格式/import 错误及 4 项非空断言警告，已修复，不削弱检查。
- 真实协议首次：本插件 AppServer initialize、CUA discovery 和 `await cua.getState();` 成功，返回真实文档/应用状态文本 26942 字符、isError:false；没有前台动作、截图、输入或权限修改。搜索首次失败于引号配置路径 `mcp_servers."workbench"` 的 invalid transport；根因为 app-server 配置路径不采用 TOML 引号语义，已修正为 probe2 已验证的简单名称逐项路径，对不支持的特殊名称显式拒绝。保留此失败，不记为原生搜索成功。
- 修复后真实 hostedSearch completed，实际 gpt-6-luna、1 native webSearch、官方来源；thread `01a14f54-82e5-7501-8e96-450f5583cacb` / turn `01a14f54-9325-7e63-b798-f059adb4e4dd`。启动前 MCP 工具数为 0 是代码强制门槛，未读取/打印登录凭据。
- 再从真实 SDK 注册器取得工具 execute，复用同一 session/连接调用 status → js/getState → search；搜索 thread `01a14f59-111d-7570-b447-a1132b2c9a8b` / turn `01a14f59-2559-7ea2-aff6-9f82c0b1c8d8`，模型 gpt-6-luna、1 native webSearch，来源 `https://developers.openai.com/siwc/token-sharing-open-source/codex-app-server`。随后 run.end 观察器及 trigger.stop 收尾完成，探测 Node 正常退出。这是隔离 SDK/协议检查，session 标签 `n06-sdk-protocol-check`，不是安装版 Yonder event/session 验收。
- 独立真实取消：等待 app-server `turn/started` 立即 abort，返回 `N06 explicit protocol cancellation`，没有成功结果；interrupt/unsubscribe 后关闭自有连接。未执行 CUA 副作用取消、截图图片进入真实 Yonder 模型或强制终止服务测试。
- 代码/依赖接线交 Codex：根 workspaces/tsconfig references/lock 纳入 `plugins/codex-tools`；运行依赖仅 `@yonder/sdk:0.1.4` 与已安装 `typebox:1.3.27`。参考 OpenClaw MIT 的来源 commit/文件已在 search.ts 与 README 标注；没有搬入上游模块或专有程序，根 notices 的整合由 Codex 处理。
- 尚未安装验收：Yonder 模型自身发现并调用工具、获准 app AX/截图及可逆动作、真实图片送入模型、系统权限拒绝/再授权、桌面动作取消后观察、服务停止边界。没有 push、发布或更新承载本会话的服务。


### 本机原生连接探测（2026-10-18，Codex 执行）

- 使用当前 codex-cli 0.160.1 的官方 generate-json-schema 核对协议；独立 app-server initialize → ephemeral thread/start → mcpServerStatus/list(detail:full)，发现 cua_repl.js/js_reset。没有复制专有程序、OAuth 或修改全局 Codex 配置。
- 同一连接调用 mcpServer/tool/call(server:cua_repl, tool:js, code:await cua.getState())，isError:false，返回真实本机应用清单。可调用后端为既有官方 CUA；未开发备用桌面驱动。证据 /tmp/yonder-n06-appserver.json、/tmp/yonder-n06-cua-call.json。线程 01a14ef4-a62a-7421-8e4e-206c53b3dab3；只读调用，没有模型请求。
- 原生 getState 的应用清单成功，浏览器部分报告 Missing required Codex turn metadata: session_id, turn_id。这不是浏览器已接通的证明；默认浏览器仍由 N07 的 BrowserSkill 完成。Yonder 的实际应用读取、截图与可逆动作尚未执行。
- 对未产生 rollout 的 ephemeral 线程执行 thread/archive 返回 no rollout found；关闭了本次 app-server 子进程，没有残留常驻探测进程。实现时直接释放这种临时连接，不把 archive 错误伪装成功。

### 受限搜索连接核对

- Codex 尝试以现有 app-server/OpenAI 登录态创建只允许 hosted search 的临时线程，不复制 OAuth；关闭 shell/插件等额外来源并核对 MCP 工具面。第一版 thread config 将 mcp_servers 作为仅含 enabled:false 的整块对象覆盖，原生解析拒绝（invalid transport in mcp_servers.code-review），搜索尚未发出。正在核对现有配置服务器与注入服务器的区别及逐项覆盖方式，不以空工具结果或 CLI 既有成功冒充本次 app-server 搜索通过。
- 第二次先由官方 config/read 在受信任进程内仅提取配置服务器名称（node_repl/workbench/codegraph/wechat-context，不输出配置值），使用逐项 enabled 覆盖，关闭 orchestrator MCP/skills 和其他原生执行来源。启动后 mcpServerStatus/list(threadId) 证明搜索线程 MCP 工具数为 0；没有修改全局配置或新建/复制 OAuth。
- 原生 gpt-6-luna 搜索实际 completed，条目只有 userMessage/webSearch/agentMessage；webSearch 保留原生 action/queries/results 与官方来源 URL。thread=01a14f1f-63fe-78c2-8025-1d4b3b23ec24，turn=01a14f1f-7857-7861-8a8c-59ee49316556。证据 /tmp/yonder-n06-search-appserver.json、/tmp/yonder-n06-search-probe2.mjs；返回来源包括 https://openai.com/index/unlocking-the-codex-harness/ 。临时线程、子进程和工作目录已释放。
- 本次仅是 Codex 完成的官方连接探测；plugins/codex-tools 尚未实现，不能记为安装版 Yonder 的桌面/搜索工具验收。适配时复用同一 app-server 连接并按线程限制用途，不搬入 OpenClaw 的认证迁移、调度器或备用驱动。


### N00 前置探测（2026-10-18）

- 宿主 cua.getState 成功返回实际应用/浏览器清单，没有前台交互；尚未通过 Yonder/插件调用。
- 现有 Codex 登录下，codex --search exec --json --ephemeral --sandbox read-only --model gpt-6-luna 实际完成一次 native web_search，结果返回公开官方文档 URL；临时证据 /tmp/yonder-hosted-search-probe.jsonl。进程退出码 0，伴随既有 chronicle/SessionEnd 配置警告，不是搜索失败。
- 两项仅证明已有宿主入口可调用；安装版 Yonder 的真实接线和授权边界仍属 N06。

### C2 接收补齐（2026-10-18，Codex Sol）

- 复用原 Yonder 提交 e067930，保留其测试文件及全部历史证据，本轮未运行或新增测试。
- 完整阅读 app-server 传输、CUA 图片转换、运行生命周期及 hosted search 调用链；补明确状态分类、空 JS 拒绝及 native 来源 HTTP(S) 校验/去重。保持单一官方桌面后端，不读取 OAuth。
- 图片通过 SDK images 原字段传递；取消搜索走原生 interrupt，桌面未知副作用不自动重放；run.end/stop 释放本轮拥有的连接。
- 状态：实现未验收。本轮没有模型、桌面、搜索或授权真实调用。原 Yonder 提交及其原检查记录保留，不冒充本轮验证。根 workspace/lock/project references 交主 agent 接线。
