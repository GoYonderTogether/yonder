# 给在本仓库工作的 agent

1. 先读 `docs/index.md`，再读 `docs/architecture.md` 全文。规范在 `docs/spec/`，是代码的目标。
2. 你被分配的任务在 `docs/tasks/Txx-*.md`。只做任务写的事，只改任务列出的路径。
3. 规范没写的行为不要发明；遇到空白或矛盾，写进任务文件的"问题"一节并停下。
4. 不写模拟模型、假数据、示例人设、占位功能。需要模型的测试用真实模型 `openai/gpt-6-luna`；缺凭据就跳过并写明"未测"。
5. pi 的包只能在 `packages/core/src/runtime/` 里 import（`@yonder/sdk` 可以 `import type`）。
6. 架构不变量（`docs/architecture.md` 第 5 节）任何时候都不能违反。
7. 改设计 = 先改 `docs/`，并在 `docs/decisions.md` 记一条；文档里过时或多余的内容要删掉，而不是追加。
8. 完成时在任务文件末尾写"结果"：改了什么、测试命令与输出摘要、偏离规范之处。
