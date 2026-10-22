# memory 插件：Codex 执行任务书

目标：按 [docs/spec/15-memory.md](../../docs/spec/15-memory.md) 实现官方插件 `plugins/memory`（`@yonder/plugin-memory`）。规范是目标；本任务书只规定做事顺序与汇报方式。

## 开工前必读

1. [AGENTS.md](../../AGENTS.md)、[CONTRIBUTING.md](../../CONTRIBUTING.md)、[docs/architecture.md](../../docs/architecture.md) 第 5 节不变量。
2. [docs/spec/04-plugins.md](../../docs/spec/04-plugins.md)（槽与 PluginAPI）、[01](../../docs/spec/01-events.md)、[05](../../docs/spec/05-security.md)、[14 §2 cron](../../docs/spec/14-execution-capabilities.md)。
3. 范本：`plugins/wechat-archive`（私密资料工具与权限）、`plugins/cron`（package.json 清单、触发器、README 写法）、`plugins/context-files`（上下文贡献）。

## 硬规则

- 只改 `plugins/memory/` 与 `plugins.md` 的 memory 条目；**不改** `docs/spec/`、`docs/architecture.md`、`docs/decisions.md`、`AGENTS.md`、内核、SDK。规范没写或互相矛盾处，写进 `proposals/memory/open-questions.md`，该工作包暂停并汇报，**不自行补设计**。
- 插件只依赖 `@yonder/sdk`；不 import core、pi 或兄弟插件。新依赖精确锁版本，说明用途。
- 不写模拟模型、假数据、示例人设。测试用临时目录里的真实文件系统；需要模型的验收用真实模型 `openai/gpt-6-luna`，缺凭据记“未测”。
- 在新分支上工作（不在 main）；一个逻辑改动一个提交；不 push、不打 tag、不合并，PR 留给我审。
- 工作区里 `proposals/ai-card/` 有别人的未提交改动，不要碰。
- 每个工作包结束都跑 `npm run build && npm run typecheck && npm test && npm run lint`，并调用 `@yonder/sdk/testing` 的 `checkPlugin`。

## G0 调研与事实核对（先于编码，产出 `proposals/memory/g0-report.md`）

逐条核对规范依赖的事实，写“已核实 / 与规范不符 / 未能核实”。不符的先记录，**全部核对完再一并汇报**；只有让后续工作包根本无法进行的才立即停下：

1. SDK 实际类型：`events.on('message.in')` 能否拿到发送者 `acct:`；`api.identity` 能否把 acct 解析到 `person:`（owner 核验用）。（`events.query` 无 id 筛选已核实，规范 §5 已改为用 `ToolContext.event`。）新增核对：`ToolContext.event` 在“多条输入合并为一次运行”（busy=steer）时指向哪一条；`events.on` 的 handler 与运行启动的先后是否有保证。
2. `ContextContribution`（turn）里 `event.from` 的形态；system 贡献拿不到 `event` 是否属实。
3. `Trigger` 的 `start(io)`、`io.emit`、`conv:<triggerId>:<name>` 约定；`api.paths.data`；`api.skills.register(dir)` 的目录约定。
4. cron 事件作业的 payload 实际形状，以及它如何经 agent 绑定唤醒主人类配置档。
5. 本机 `rg` 是否可用，核心 grep 工具如何定位 rg（复用同一方式，不另造）。
6. 文档转换命令（只在隔离的临时虚拟环境里安装，不装进全局）：评估 `markitdown`（MIT）与 `docling`（MIT）各一条真实 PDF、一条 docx 的转换结果与安装方式，选一个作为 README 里的推荐 `converter`；不把安装写进插件 setup（setup 不得有副作用）。**状态：第一轮 G0 因下载过慢未完成，无转换结果**；WP4 的转换验收若仍装不上，如实记“未测：缺转换器”，文本类（md/txt）路径不受影响。调用约定见规范 §10。
7. 对中文的真实检索：用含中文的临时文件验证 `rg --fixed-strings --ignore-case` 命中与行号。
8. 在用户真实 Obsidian 库上做只读扫描试验前，**先问我库路径**；未经确认不要访问用户目录。

## 工作包（按顺序，每包一个提交，包内写测试）

G0 已通过（见 [g0-report.md](g0-report.md)）：规划方已补测转换器——markitdown 0.1.9 可用（标准输出协议，中文 docx/PDF 正确），docling 可用但很重。本任务书的 WP 顺序与验收如下。

| WP | 内容 | 验收 |
|---|---|---|
| 1 | 包骨架、清单（`contributes` 与实际注册一致）、配置 schema（规范 §10 全部字段）、`memory_status`、首次启动创建 §2 的目录与 `SCHEMA.md`（已存在文件不覆盖；创建发生在触发器 start，不在 setup） | `checkPlugin` 通过；根目录与登记目录互相包含被 status 报出；已有文件字节不变 |
| 2 | 周/月文档引擎：路径与 ISO 周规则（周四定月）、记录流末尾 `O_APPEND`、整理标记翻转、节写入、mtime 并发保护、原子替换、互斥队列、`log.md`；`memory_capture`（note/material/private/when/by） | 并发追加不丢行；用户中途改文件后写入不覆盖；超长正文落 `raw/`；原文逐字不变 |
| 3 | `memory_search`（rg 固定参数、term 原样加 NFKC 双搜、聚合排序、zones/since/until/origin/private）、`memory_read`；登记目录只读检索 | 中文子串命中；康熙部首文本能被普通汉字 term 命中；越界路径与符号链接被拒；登记目录前后字节与 mtime 不变 |
| 4 | `message.in` 采集（owner 核验、渠道白名单、附件复制）、`memory-inbox` 触发器（稳定性判断、sha256 去重、manifest、converter 调用约定、转换产物 NFKC、`memory.captured`） | 重复文件不重复入库；转换失败保留原件并在 status 可见；非 owner 消息不被记录；用 markitdown 实测 PDF/docx/中文文件 |
| 5 | `memory_plan`、`memory_review`、`memory_me`，含确认核验（`ToolContext.event` 须为 owner 的 `message.in` 且晚于提议；`confirmed` 的 `evidence` 规则见规范 §5）、`supersede` 关旧开新、`close` 规则 | cron 触发的运行里 `commit/confirm` 被拒；无有效 `evidence` 时 `confirmed` 的 add 被拒；整理幂等；`[ ]/[x]` 翻转只改标记 |
| 6 | 微信来源（`wechat-archive.material` 实时、`memory_import` 回填、`wechat:<chat>:<msgid>` 去重）；启动器 `memory-bootstrap`、`memory_bootstrap`（audit/ack/state）、审计与费用估算（`js-tiktoken` 精确版本、`api.models` 的目录价）；预设 `memory-keeper` | 先向我要 `wechat-context` 的可用性确认，**只用名单内会话**；实时与回填同一消息只记一次；`first-run` 恰好一条且 ack 后不重复；审计数字与实际一致且只读 |
| 7 | 上下文 `memory-core`/`memory-week`（私密排除、owner 判断）、6 个 skill、`SCHEMA.md` 正文、README（规范 §13 要求的全部内容；cron 示例 payload 必须含 `kind: "event"`）、`docs/plugins.md` 条目由“规范已定，未实现”改为实际状态 | 真实模型验收规范 §12 的 1–8 条；未跑的标“未测” |

## 不属于你的事（不要做）

- 不发布、不打 tag、不改正式版 launchd 服务、不修改正式 home 的 `yonder.yaml`、不安装到正式版。安装与发布由我与维护者另行执行。
- 不访问、不修改用户的 Obsidian 库 `life-steward` 与微信归档数据，除非某个 WP 的验收明确要求，并且只读。验收用库须先问我路径与许可。
- 微信回填只能用名单内会话；名单由配置给出，不得自行扩大。

## 汇报格式

每个工作包结束汇报：做了什么（文件列表）、检查命令的原始计数（通过/失败/跳过）、**已验证**与**仅实现未验证**分开列、与规范不符或规范空白的清单、下一包是否可以开始。不要用最新的成功覆盖已发生的失败。
