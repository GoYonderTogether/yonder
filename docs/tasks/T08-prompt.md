# T08 提示词组装

**依据**
- `docs/spec/03-agents.md:87-120`（§5 全部）、`29-41`（工作区内容与自动生成）
- `docs/spec/04-plugins.md:98-119`（§3.3 上下文贡献）
- `docs/spec/06-delivery.md:44-55`（框架段要讲的规则）
- `docs/spec/09-cli-release.md:62-67`（版本通知）

**路径**：`packages/core/src/prompt/`

**必须**
- system 五段的顺序与确定性规则；第 ③ 段（skill 索引）在 T13 之前没有内容；只调用 `contexts` 选中的贡献。
- 框架段：内容只覆盖 03 §5.2 与 06 §4 列出的点；英文，不超过 250 词；`yonder` 命令那一句只在配置档有 `exec` 时出现。
- `<turn>` 块格式严格按 03 §5.3：`from`、`attachment` 行；`http(s)` 附件下载到 `<home>/.yonder/attachments/`；模型支持图片时图片附件转为图片块（交给 T05 的 submit）；会话 `version` 与当前版本不同时加 `notice` 行并更新 `version`；`wake: write` 时的简化形式。
- `placement: turn` 的贡献追加在 `<turn>` 之后，`RenderContext.event` 为当前事件。
- 初始化 agent 时写入 `SYSTEM.md` 模板（03 §5.4）；选中的上下文贡献缺文件时按 `scaffold` 生成。

**禁止**：在 system 中放时间或其他每次变化的内容；虚构人设或示例对话。

**验收**：同样输入渲染两次逐字相同；未选中的贡献不被调用（计数断言）；`<turn>` 块快照测试（含附件、通知、write 形式）；框架段词数测试。

## 问题

（无）
