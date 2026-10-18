# T08 提示词组装

**依据**
- `docs/spec/03-agents.md:85-113`（§5 全部）
- `docs/spec/04-plugins.md:85-106`（§3.3 上下文贡献）
- `docs/spec/06-delivery.md:40-50`（框架段要讲的规则）
- `docs/spec/03-agents.md:29-40`（工作区内容与自动生成）

**路径**：`packages/core/src/prompt/`

**必须**
- system 四段的顺序与确定性规则；只调用 `contexts` 选中的贡献。
- 框架段：内容只覆盖 03 §5.2 与 06 §4 列出的点；英文，不超过 200 词。
- `<turn>` 块格式严格按 03 §5.3，`wake: write` 时的简化形式。
- `placement: turn` 的贡献追加在 `<turn>` 之后。
- 初始化 agent 时写入 `SYSTEM.md` 模板（03 §5.4）；选中的上下文贡献缺文件时按 `scaffold` 生成。

**禁止**：在 system 中放时间或其他每次变化的内容；虚构人设或示例对话。

**验收**：同样输入渲染两次逐字相同；未选中的贡献不被调用（计数断言）；`<turn>` 块快照测试。

## 问题

（无）
