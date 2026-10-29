# PT-P149 状态（2026-10-28）

未交付 `code-intel_ast_grep_replace`；实时检查 `plugins/code-intel` 注册没有该工具。O49 要求按 pi 实现，但卡同时要求预览后外部改动必须拒绝覆盖，不能直接转发上游 apply。

在临时 HOME 中复制本机 pi-lens 4.4.6 并链接已有依赖，实际 MCP `tools/list` 确认名称 `pilens_ast_grep_replace`；必填 `pattern`、`rewrite`、`lang`，可选 `paths`、`insideKind`、`hasKind`、`hasDescendantKind`、`follows`、`precedes`、`apply`、`strictness`、`cwd`。同一临时项目使用现有 `plugins/code-intel/src/lens-mcp.ts` 的真实 MCP 桥分别调用预览和应用：预览 `foo(1)` → `bar(1)` 后外部将文件改为 `foo(2)`，apply 返回 `[APPLIED] 1 replacement(s)`，文件实际变为 `bar(2)`。结果为 1 次预览和 1 次应用，均退出 0；这证明未满足本卡的外部修改拒绝条件，不代表上游承诺了该条件。桥每次调用结束后终止 MCP 子进程；上游 apply 自身重新搜索匹配，仍有匹配即写入，并不比较上次预览的文件内容。

还需补齐可复用的预览版本与写入安全边界：`ToolContext` 没有受保护文件列表，现有运行时 `ToolPolicy` 的路径及保护检查只覆盖核心文件工具名；pi-durable 文件写入队列也不锁定外部进程。须在执行环境内约束实际命中文件的真实路径、保护规则及预览到应用的变更检查，并与现有 edit 可靠性衔接，不能只对入参路径检查或直接执行上游 `--update-all`。

未测：Yonder 工具注册、权限拒绝、取消、T05 缓存及截断、真实模型调用；未改代码、未运行 golden、Biome、tsc 或相关 vitest。本次没有新增依赖，也没有访问主人运行服务或改主人 Yonder home。

2026-10-28 P149r3：增加 `code-intel_ast_grep_replace` 最小闭环，默认预览并保留文件字节快照；apply 按实际文件调用内核写权限检查，确认全部快照未变后经执行环境写入。当前支持 pattern、rewrite、lang、paths 和 strictness；pi-lens 的结构过滤参数、跨进程持久预览和输出缓存待后续实现。文件检查与写入之间仍可能有外部进程竞争，执行环境不提供原子比较写接口。
