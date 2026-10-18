# T10 第一批插件：channel-cli 与 context-files

**依据**：`docs/spec/04-plugins.md`（渠道提供者与上下文贡献）、`docs/spec/03-agents.md`、`docs/spec/06-delivery.md`、`docs/spec/09-cli-release.md`（`chat` 命令）

**路径**：`plugins/channel-cli/`、`plugins/context-files/`

**channel-cli**
- 注册 `type: cli` 的渠道提供者；每个实例一个 `kind: dm` 的会话 `conv:<实例>:local`，发送者 `acct:<实例>:local`，`output: { stream: true, attachments: false }`。
- 实例在 `<paths.data>/<实例>.sock` 上监听：客户端发来的每一行（UTF-8）是一条消息；服务端每行回一个 JSON：`OutputPart`，或 `{ "type": "message", "text": … }`（`send` 的内容）。同一实例同时只接受一个客户端，第二个收到错误后被断开。
- 没有客户端连接时 `send` 返回 `{ ok: false, error: "no client" }`。

**context-files**
- 贡献 `agents-md`、`user-md`、`soul-md`、`memory-md`，分别对应工作区的 `AGENTS.md`、`USER.md`、`SOUL.md`、`MEMORY.md`，`placement: system`，文件存在且非空时渲染其内容。
- 模板只含标题和一行说明这个文件用来写什么，不含示例内容。

**验收**：两个插件通过 `checkPlugin`；channel-cli 用真实套接字测试收发与"只接受一个客户端"。context-files 只在被选中时出现在 system 中的集成验收归 T08/T12，不阻塞插件独立实现。

## 问题

（无）
