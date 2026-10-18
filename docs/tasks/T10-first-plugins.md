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

### 源码审查（2026-10-18）

CLI provider 按实例捕获 PluginAPI；清除失去进程后的旧 socket；第二客户端写完错误再断开；固定 stream 接收连接并处理断开错误。真实子进程 SIGKILL 后遗留 socket 再启动的检查通过（1 文件、1 测试）。多 home 与流式重连组合未全部实测；context-files 的热重载 scaffold 缺口归 T08/T11。

完整证据、未完成项和设计问题见 [第一轮源码审查](review-first-pass.md)。本节不替代原定验收；任务保持原状态。

### 第一轮原记录

- 第二个客户端收到的错误 JSON 结构未在规范中定义；当前用 `{ "type": "error", "message": "client already connected" }` 后断开，第二轮确认是否冻结该形状。

## 结果（第一轮，已实现待验收）

- `channel-cli` 注册 `type: cli`，实例在 `paths.data/<实例>.sock` 提供 Unix socket；逐行 UTF-8 输入写入 `message.in`，from/conv 分别为 `acct:<实例>:local` 与 `conv:<实例>:local`。支持单客户端、文本 send 与 `OutputPart` stream；无客户端时返回 `no client`。
- `context-files` 注册四个 system context；各自只读取对应工作区 Markdown，缺失或空白时不渲染；scaffold 模板只有标题与一行用途说明。
- 实际检查：两个插件定向 `tsc -b` 通过；`npx vitest run plugins/channel-cli/test/channel.test.ts` 在权限允许创建 Unix socket 后通过（1 文件、1 测试），覆盖 `checkPlugin`、真实 socket 收发与第二客户端断开。
- `npm run build` 未通过，阻塞来自并行任务的 `packages/core/src/config/index.ts` 类型比较、`packages/core/src/runtime/credentials.ts` 缺少 `proper-lockfile` 及两个类型错误；这些路径不属于 T10。全量 typecheck 未单独运行。
- 未调用模型；context 被选中后进入 system 的组装集成验收留给 T08/T12。
