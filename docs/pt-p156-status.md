# PT-P156 项目报告状态（2026-10-28）

尚未交付 `code-intel_project_report`。实时检查 `plugins/code-intel` 的工具注册，未发现该工具；P001 的可选 code-intel 插件已经存在。pi-lens 4.4.6 文档描述 `project_report` 使用缓存 review graph，冷缓存返回 `available:false` 并后台构建，超过 `maxProjectFiles` 的项目记录跳过结果，后续调用不重复构建；`limit` 默认 10，`focus` 只重排，`view: compact` 返回文本。

实现 Agent 报告：本机 pi-lens 4.4.6 原安装缺少 peer `@earendil-works/pi-tui`；临时复制并链接现有 peer 和 typebox 后，`tools/list` 握手成功，名称为 `pilens_project_report`，schema 为 `cwd`、`limit`（number）、`focus`、`view`（default 或 compact）。此为代理实测记录，尚未独立复核。P159 的真实后端握手和冷索引检查命令及原始结果见 [PT-P159 状态](pt-p159-status.md)。当前 `plugins/code-intel/src/lens-mcp.ts` 每次响应后终止 MCP 子进程；P159 冷索引实测三次均返回 `available:false/building`。`ExecutionEnv.exec` 目前没有持久双向 stdin，现有 MCP 客户端是其他插件内部实现，不能跨插件导入。项目报告需要选定执行环境内共享 MCP 连接、后台构建生命周期和取消契约；不能另建脱离 T04 的后台进程或第二套索引。

后续接入应复核该握手，复用共享生命周期和 T05 原文缓存，完成真实仓库冷/热报告、focus 范围、超过文件上限不重复构建、构建期间接收新消息，以及取消和错误路径验证。还需验证未选插件不注册、描述/schema token 增量、输出截断与缓存索引、核心 find/ls 不注入未选工具规则，并在临时 HOME 使用指定真实模型完成调用。上述 P156 验收均未完成；不得以 P159 的后端证据冒充 P156 验收。

公开工具落地时按 PT-README 和 spec/20 同步规范、reference 和插件文档，补注册契约检查；工具没有通用 golden。pi-lens 4.4.6 声明 MIT 许可，来源及安装要求已记录在 [code-intel README](../plugins/code-intel/README.md)。
