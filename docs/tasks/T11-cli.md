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

- 真实进程 stop 后，CLI `sessions show 2 --json` 触发 readline Interface 未捕获的 socket ENOENT，离线回退未到达；core 的直接只读查询及转录检查通过。按首轮规则记录，第二轮修复 CLI 连接错误传播。

- Windows 命名管道尚未实现：规范未定义命名规则；当前 macOS 使用 Unix socket。
- 本次真实 CLI 对话只观察到 final，未观察到 text/tool 过程片段；默认回复可用，流式过程留第二轮定位。
- Unix socket 受 macOS 路径长度限制；系统长临时目录首次启动检查返回 EINVAL。最小检查改用 /tmp 短路径；沙箱 EPERM 经授权运行本地 socket 后通过。
- OAuth 新 home 登录交互、恢复未完成运行、远程工作区和多渠道组合未测；本次使用本项目已有测试凭据引用，未复制其他程序 OAuth。

## 结果

第一轮：已实现（待验收）。

- CLI 提供 init/login/doctor/start/stop/chat/sessions/events/identity 与本地控制协议；内核组装配置、插件、工作区模板、身份、pi 运行时、路由、投递和热重载。一个 home 持锁；停止后查询只读打开 SQLite。
- 必要适配：插件发送携带 pluginId；OAuth 独立登录不创建 Harness；在线/离线转录复用同一映射。
- 实际检查：CLI/core 构建通过；最小控制 socket 测试 1 项通过；只读 SQLite 转录测试 1 项通过；init/doctor/open/close/offline 最小检查首次失败 1 项（长路径），第二次失败 1 项（沙箱），获准监听后 1 项通过；非法参数退出码 2。未执行全量测试。
- 真实模型：开发 home `.yonder/home` 初始化、doctor、start、chat 已运行；会话 2 使用 `openai/gpt-6-luna`，实际调用 bash/pwd，回复当前目录；run.end.status=done、replied=source。CLI 在线查到转录和事件，随后 Ctrl-D 与 stop 正常退出。保留开发 home 与真实对话供审核。
- 凭据通过 yonder.yaml 的 credentials 引用本项目已授权的 `.yonder/auth.json`；未复制凭据。首次 OAuth 登录和完整 T11 验收留第二轮。
