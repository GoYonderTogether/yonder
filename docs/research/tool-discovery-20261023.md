# 工具发现与上下文参考（2026-10-23）

目标：常驻工具保持少量，折叠完整 schema 后仍能发现能力；中文任务不因词法检索或无关词命中而误选工具。保留现有 pi 的执行、权限、转录、工具加载与压缩职责。

## 实际参考与采用范围

| 项目与源码版本 | 查到的做法 | Yonder 的采用范围 |
|---|---|---|
| [Hermes tool_search_catalog.py](https://github.com/NousResearch/hermes-agent/blob/bf0203a794a07aac3ff764972ab9087baa4e4f4e/tools/tool_search_catalog.py) | 目录可按预算退化为 names-only；BM25 结果必须包含最稀有查询词；长查询至少匹配半数可回答词；精确工具名优先 | 在 Yonder 提示词中列出有效 search 工具名，不加载完整 schema；检索规则在 pi fork 修改后同步，不建第二套执行桥 |
| [OpenCode tool.ts](https://github.com/anomalyco/opencode/blob/bdf757209ff742b8551a4874347edb845241e5bb/packages/core/src/tool.ts) | 保留直接工具，并用 Code Mode execute 和 namespace catalog 承载其他能力 | 确认“目录与完整定义分开”的模式；不引入其 Effect/runtime，现有 pi 已负责调用 |
| [OpenCode compaction.ts](https://github.com/anomalyco/opencode/blob/bdf757209ff742b8551a4874347edb845241e5bb/packages/core/src/session/compaction.ts)、[官方压缩文档](https://dev.opencode.ai/v2/docs/compaction/) | 总结完整当前会话，保留最近约 15k tokens；后续压缩更新 checkpoint，并尽量复用原请求缓存 | 与工具 schema 折叠分开；Yonder 已由 pi 提供 summary + recent tail，不为工具发现改造会话存储或另建压缩器 |
| [Goose extension manager](https://github.com/aaif-goose/goose/blob/main/crates/goose/src/agents/platform_extensions/ext_manager.rs) | 缺能力先看可用扩展的名称、说明和启用状态 | 采用“可发现不等于已展开”的引导；不让 search 自动安装插件或扩大原权限 |

## 最小实现

- 根据同一份有效工具 catalog，只列 exposure=search 的工具名；未选插件、权限不足、仅常驻工具不冒充折叠能力。
- 无 search 工具时不注入发现指引（包括本机 Hermes 的五工具配置）。清单排序稳定；完整参数定义仍由 pi 原生 tool_search 延迟加载。
- 中文任务先根据目录选择英文工具名，再作精确查询；一般检索使用短英文动作词。不添加自定义同义词表、翻译模型、向量库或第二套工具桥。
- pi fork 对共用 BM25 加入 Hermes 的结果准入规则，防止仅因 list/message/task 等通用词命中无关工具。没有真正匹配时返回空，由目录支持纠正查询。
- 首轮只用组名和提示词的方案保留在本次未发布提交历史与本机备份中；最终方案用完整工具名目录并修正检索实现。

## 验证范围

检查有效目录、权限过滤、精确名称优先、无关结果拒绝、既有工具加载/Code Mode 回归；使用真实 Luna 和中文任务核验发现、只读调用、下一轮恢复常驻集合。原始失败与重试分别记录在本机工具指导备份的验收记录中，不能用重试成功覆盖首轮事实。
