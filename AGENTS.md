# 给在本仓库工作的 agent

1. 先读 `docs/index.md`，再读 `docs/architecture.md` 全文。规范在 `docs/spec/`，是代码的目标。
2. 实现工作按 `docs/tasks/README.md` 的"实现循环"进行：选任务、只改任务列出的路径、验证、写"结果"、一个任务一个提交。
3. 规范没写的行为不要发明；遇到空白或矛盾，写进任务文件的"问题"一节，按 docs/tasks/README.md 的当前轮次继续其余工作，不自行补设计。
4. 不写模拟模型、假数据、示例人设、占位功能。需要模型的测试默认用真实模型 `openai/gpt-6-luna`；本轮 N 任务中用户指定的 Sol 按实际 provider/model ID 验证后使用。凭据见 `docs/tasks/README.md`；缺凭据就跳过并写明"未测"。
5. pi 模型/会话运行包只能在 `packages/core/src/runtime/` 里 import（`@yonder/sdk` 只能 `import type`）；插件只依赖 `@yonder/sdk`。基础 TUI 以 pi v1.3.0 原生界面为唯一基准，允许 `packages/cli/` 使用 pi-tui 及 coding-agent 的 UI/主题/键位导出或按许可提取的界面模块；不得接入 coding-agent 的第二套运行/存储系统。不得自行重设计布局和交互；具体边界见 spec/12，实施按 docs/tasks/terminal/README.md。
6. 架构不变量（`docs/architecture.md` 第 5 节）任何时候都不能违反。
7. 实现者不改 `docs/spec/`、`docs/architecture.md`、`docs/decisions.md`、`docs/index.md` 与本文件。首轮工序 0 已完成；2026-10-18 用户已授权设计方补齐 spec/10、11 并启动 N00–N14，N00 由执行主 agent 对齐受影响旧条款并记录冻结 commit。随后实现者不再改功能规范；实质变更交用户审核。改设计先改 `docs/`，在 `docs/decisions.md` 记一条，删掉过时内容而不是追加。

2026-10-18 用户另行授权设计方修改 CLI/TUI 规范并先展示方案，见 spec/12、D30 及关联条款。用户随后明确批准该方案，要求拆任务并开始实现、展示实际运行效果；实施 U00–U04，不改变其余冻结条款与 N00–N14 原授权。

2026-10-18 用户已批准 R0–R6 与 D1–D4 推荐方向，允许补测试、运行测试、独立本机安装与真实验收，并追加原生 macOS 状态栏。以 docs/tasks/repair-acceptance-plan.md、D34 和 spec/14 为当前工序边界；旧 C 轮禁止测试/安装的批准不再套用本轮。
