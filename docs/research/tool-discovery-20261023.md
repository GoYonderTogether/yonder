# 工具发现与上下文参考（2026-10-23）

目标：常驻工具保持少量，折叠完整 schema 后仍能发现能力；中文任务不因词法检索或无关词命中而误选工具。保留现有 pi 的执行、权限、转录、工具加载与压缩职责。

## 实际参考与采用范围

| 项目与源码版本 | 查到的做法 | Yonder 的采用范围 |
|---|---|---|
| [Hermes tool_search_catalog.py](https://github.com/NousResearch/hermes-agent/blob/bf0203a794a07aac3ff764972ab9087baa4e4f4e/tools/tool_search_catalog.py) | 目录可按预算退化为 names-only；BM25 结果必须包含最稀有查询词；长查询至少匹配半数可回答词；精确工具名优先 | 在 Yonder 提示词中列出有效 search 工具名，不加载完整 schema；检索规则在 pi fork 修改后同步，不建第二套执行桥 |
| [OpenCode tool.ts](https://github.com/anomalyco/opencode/blob/bdf757209ff742b8551a4874347edb845241e5bb/packages/core/src/tool.ts) | 保留直接工具，并用 Code Mode execute 和 namespace catalog 承载其他能力 | 确认“目录与完整定义分开”的模式；不引入其 Effect/runtime，现有 pi 已负责调用 |
| [OpenCode compaction.ts](https://github.com/anomalyco/opencode/blob/bdf757209ff742b8551a4874347edb845241e5bb/packages/core/src/session/compaction.ts)、[官方压缩文档](https://dev.opencode.ai/v2/docs/compaction/) | 总结完整当前会话，保留最近约 15k tokens；后续压缩更新 checkpoint，并尽量复用原请求缓存 | 与工具 schema 折叠分开；Yonder 已由 pi 提供 summary + recent tail，不为工具发现改造会话存储或另建压缩器 |
| [Goose extension manager](https://github.com/aaif-goose/goose/blob/main/crates/goose/src/agents/platform_extensions/ext_manager.rs) | 缺能力先看可用扩展的名称、说明和启用状态 | 采用“可发现不等于已展开”的引导；不让 search 自动安装插件或扩大原权限 |
| [Codex tool_search handler](https://github.com/openai/codex/blob/main/codex-rs/core/src/tools/handlers/tool_search.rs)（2026-10-23 读取） | 用英文 BM25 搜索；当前 registry/exposure 先过滤，再对可见结果截取；缓存校验当前来源身份或元数据 | 核对 pi 的候选来自当前 agent.deferred，已经过 extensions、tools、model caller 过滤；不缓存一份越过权限的全局目录，不需要引入 Rust 搜索服务 |
| [Claude tool search](https://platform.claude.com/docs/en/agents-and-tools/tool-use/tool-search-tool) | 延迟完整定义、先发现后调用；支持自建客户端搜索 | 保留 names-only 目录和原生 tool_search；明确加载完成后在下一次模型响应调用，避免同批并行误用。没有接入另一套供应商专用工具协议 |
| [MCP Tools 规范](https://modelcontextprotocol.io/specification/2025-11-25/server/tools) | tools/list 支持分页、动态目录可通知变更，tools/call 使用实际名称/参数 | 本项目 mcp-client 保留两个传输入口，按需 tools/cursor 读取服务目录；不把远端每个工具预先注册成常驻 schema，不存在第二份远端目录缓存需要随本次修复刷新 |

这些模式解决不同层次的问题：OpenCode 的 Code Mode、Goose 的扩展启用不是同一种 tool_search 算法，不能把“参考了项目”当作已照搬且验收通过。精确标识混在自然语言里的优先命中，是针对下面实际故障对现有 Hermes 检索规则的补充。

## 最小实现

- 根据同一份有效工具 catalog，只列 exposure=search 的工具名；未选插件、权限不足、仅常驻工具不冒充折叠能力。
- 无 search 工具时不注入发现指引（包括本机 Hermes 的五工具配置）。清单排序稳定；完整参数定义仍由 pi 原生 tool_search 延迟加载。
- 中文任务先根据目录选择英文工具名，再作精确查询；一般检索使用短英文动作词。不添加自定义同义词表、翻译模型、向量库或第二套工具桥。
- pi fork 对共用 BM25 加入 Hermes 的结果准入规则，防止仅因 list/message/task 等通用词命中无关工具。没有真正匹配时返回空，由目录支持纠正查询。
- 完整的结构化工具标识（含 `_`、`-` 或 `.`）出现在查询中时，同样优先按名命中；额外未知词不遮蔽明确名称。保持完整标识边界，`task_run_extra` 不命中 `task_run`，普通词 `read` 不替代缺失服务的意图。
- 未展开的合法模型工具被误调用时，保持 tool_unavailable、不执行调用；只有实际可搜索的 deferred 工具且当前提供 tool_search 时，结果才提示先精确搜索再调用。未知、无权限、仅 tools 调用方工具不因此获得可加载提示或执行权限。
- 首轮只用组名和提示词的方案保留在本次未发布提交历史与本机备份中；最终方案用完整工具名目录并修正检索实现。

## 验证范围

检查有效目录、权限过滤、精确名称优先、无关结果拒绝、既有工具加载/Code Mode 回归；使用真实 Luna 和中文任务核验发现、只读调用、下一轮恢复常驻集合。原始失败与重试分别记录在本机工具指导备份的验收记录中，不能用重试成功覆盖首轮事实。

## 当天“工具未加载”事件复核

只读 SQLite 快照截至 2026-10-23 06:40:20.294 UTC。当天工具结果中有 4 次 task_run 的 tool_unavailable，来自同一轮加载前调用；同阶段两次包含准确 task_run 名称的长查询返回空，精确单名查询成功。对比请求时的原生 pi.agent 历史，失败时 19 个工具中没有 task_run，成功搜索后的下一请求为 20 个且包含它；没有发现这次运行内已加载工具突然丢失的证据。

共同原因：模型从历史记住工具后跳过加载，错误缺少恢复指引；Hermes 稀有词门槛把未知 subagent 等词设成必需项，误排除了已经明确点名的工具。修复落在 pi 的共享 ranking 与原生调用拒绝分支，Yonder 提示词补齐顺序。没有放宽执行边界、自动补执行四次委派、增加常驻工具、重放历史或改变压缩策略。运行日志中另有网络/渠道诊断与旧输入恢复告警，未将它们混算为工具加载故障。

常驻数包含自动提供的 tool_search：贾维斯 19，维护者配置 11，Hermes 5，default 子任务 10。维护者当前已归档，保留该状态。names-only 清单仍会占少量提示词 token；折叠省去完整 schema，不等于历史和缓存完全零占用。
