# N06 Computer Use 与 hosted search 连接

**状态**：Codex 已验证官方 app-server 的桌面 MCP 发现与实际应用清单读取；Yonder 适配待 N03 独立登录完成。

**负责人**：Codex 核实本机连接；Yonder maintainer 实现适配。

**依赖**：N03。N00 可提前用已有入口试通；桌面与 hosted search 分别记录可用性。

**功能依据**：11 §3；10 §5。完整条款见 [10](../../spec/10-local-maintenance.md)、[11](../../spec/11-official-plugins.md)，本任务不定义新功能。

## 允许路径

- plugins/codex-tools/
- 根 workspace/锁文件接线、THIRD_PARTY_NOTICES.md
- 本任务获准的外部运行程序安装与插件配置，不复制专有实现到源码

本任务文件、任务总表和必要 CHANGELOG 记录可更新；冻结功能文档仅 N00 的设计方可按批准修改。

## 实现安排

承接 N00 的真实探测，验证可调用后端和实际 app-server 协议，固定一种桌面路径；再由 Yonder 实现插件工具、状态和说明。替代后端仅在原路径真实不可用时选定。按 10 §2.1 安装插件后在 Yonder 中调用，不能把宿主 Codex 的独立调用记作 Yonder 已接通。

## 验证与交付

Yonder 读取获准桌面应用并完成可逆动作；一条真实 hosted search 具有 native webSearch 记录及来源。两项独立记通过/阻塞，桌面通过即可供 N13 使用；任一失败不阻塞 N07/N08/N09/N10。目标仍保留，不能以其他供应商成功代记通过。

记录实际命令、event/session/model、commit/PR 与失败/跳过；Yonder 和 Codex 的贡献分开归属。

## 问题

待实现时记录。当前没有运行通过的声明。

## 结果

尚未开始。

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
