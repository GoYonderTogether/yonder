# 给在本仓库工作的 agent

1. 先读 `docs/index.md`，再读 `docs/architecture.md` 全文。规范在 `docs/spec/`，是代码的目标。
2. 实现工作按 `docs/tasks/README.md` 的"实现循环"进行：选任务、只改任务列出的路径、验证、写"结果"、一个任务一个提交。
3. 规范没写的行为不要发明；遇到空白或矛盾，写进任务文件的"问题"一节，按 docs/tasks/README.md 的当前轮次继续其余工作，不自行补设计。
4. 不写模拟模型、假数据、示例人设、占位功能。需要模型的测试默认用真实模型 `openai/gpt-6-luna`；本轮 N 任务中用户指定的 Sol 按实际 provider/model ID 验证后使用。凭据见 `docs/tasks/README.md`；缺凭据就跳过并写明"未测"。
5. pi 的包只能在 `packages/core/src/runtime/` 里 import（`@yonder/sdk` 只能 `import type`）；插件只依赖 `@yonder/sdk`。
6. 架构不变量（`docs/architecture.md` 第 5 节）任何时候都不能违反。
7. 实现者不改 `docs/spec/`、`docs/architecture.md`、`docs/decisions.md`、`docs/index.md` 与本文件。首轮工序 0 已完成；2026-10-18 用户已授权设计方补齐 spec/10、11 并启动 N00–N14，N00 由执行主 agent 对齐受影响旧条款并记录冻结 commit。随后实现者不再改功能规范；实质变更交用户审核。改设计先改 `docs/`，在 `docs/decisions.md` 记一条，删掉过时内容而不是追加。
