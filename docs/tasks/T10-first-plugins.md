# T10 channel-cli 与 context-files

**依据**：`docs/spec/04-plugins.md:37-106`（渠道与上下文贡献）、`docs/spec/03-agents.md:29-40`、`docs/spec/06-delivery.md:26-39`

**路径**：`plugins/channel-cli/`、`plugins/context-files/`

**channel-cli**
- 一个插件可配置多个实例（例如 `cli`、`cli-alt`），每个实例一个 `kind: dm` 的会话 `conv:<实例>:local`，发送者 `acct:<实例>:local`。
- `output.stream: true`：文本增量直接打印，工具开始/结束各打印一行。
- 读标准输入一行为一条消息。

**context-files**
- 贡献 `agents-md`、`user-md`、`soul-md`、`memory-md`，分别对应工作区的 `AGENTS.md`、`USER.md`、`SOUL.md`、`MEMORY.md`，`placement: system`，文件存在且非空时渲染其内容。
- 模板只含标题和一行说明这个文件用来写什么，不含示例内容。

**验收**：两个插件通过 `checkPlugin`；context-files 只在被选中时出现在 system 中。

## 问题

（无）
