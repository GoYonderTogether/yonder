# T11 CLI、控制接口与内核组装

**依据**：`docs/spec/09-cli-release.md`（约定与命令）、`docs/spec/07-runtime.md`、`105-107`（锁与控制接口）、`docs/spec/08-config.md`、`docs/spec/02-sessions.md`、`docs/spec/01-events.md`

**路径**：`packages/cli/`、`packages/core/src/control/`、`packages/core/src/kernel/`、`packages/core/src/index.ts`

**必须**
- 内核组装：按 `yonder.yaml` 打开存储与 runtime、加载插件（把真实服务传入 T06 的 `KernelServices`）、启动渠道与触发器、热重载、设置 `YONDER_HOME`。
- 控制接口（07 §8）：一行一个 JSON 请求与响应；没有运行中的进程时查询类命令只读打开存储。
- 09 §2 表中任务列为 T11 的命令，全部遵守 09 §1 的约定（`--json`、退出码、home 解析、`--help`）。

**禁止**：表外的命令或参数。

**验收**：在一个新目录 `init → login openai → start → chat` 跑通一次真实对话；`start` 运行时另开终端执行 `sessions list --json`、`events --json` 能查到这次对话；`stop` 后重新 `start`，`chat` 继续同一主会话；有限命令的 `--json` 输出能被 `JSON.parse`，start/chat 逐行可解析；错误参数退出码为 2。完成后 CLI 可以日常使用。

## 问题

（无）
