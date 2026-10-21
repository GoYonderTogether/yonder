# 给在本仓库工作的 agent

1. 先读 `docs/index.md`，再读 `docs/architecture.md` 全文。规范在 `docs/spec/`，是代码的目标；当前实现状态见 `docs/status.md`。
2. 工作方式、检查命令与真实模型凭据见 `CONTRIBUTING.md`：只改任务涉及的路径、验证、如实记录结果与未测项，一个逻辑改动一个提交。
3. 规范没写的行为不要发明；遇到空白或矛盾，记录问题并交维护者决定，不自行补设计。
4. 不写模拟模型、假数据、示例人设、占位功能。需要模型的测试默认用真实模型 `openai/gpt-6-luna`；缺凭据就跳过并写明“未测”。
5. pi 模型/会话运行包只能在 `packages/core/src/runtime/` 里 import（`@yonder/sdk` 只能 `import type`）；插件只依赖 `@yonder/sdk`。基础 TUI 以 pi v1.3.0 原生界面为唯一基准，允许 `packages/cli/` 使用 pi-tui 及 coding-agent 的 UI/主题/键位导出或按许可提取的界面模块；不得接入 coding-agent 的第二套运行/存储系统，不得自行重设计布局和交互，边界见 spec/12。
6. 架构不变量（`docs/architecture.md` 第 5 节）任何时候都不能违反。
7. 改 `docs/spec/`、`docs/architecture.md`、`docs/decisions.md`、`docs/index.md` 与本文件属于设计变更，须维护者批准。改设计先改 `docs/`，在 `docs/decisions.md` 记一条，删掉过时内容而不是追加。
