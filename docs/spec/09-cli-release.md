# 09 CLI、安装与更新

CLI 同时给人和 agent 用：agent 在 bash 里运行 `yonder`，配合 `yonder docs`，就能自己查看和维护运行环境。

## 1. 约定

- **非交互**：除 `login`、`chat` 外不读标准输入、不提问；缺参数就报错并给出用法。
- **`--json`**：每个命令都支持。有限命令输出一个 JSON 值（列表输出数组）；持续的 `start`、`chat` 输出一行一个 JSON 值（JSON Lines）。`login` 的交互提示走 stderr，stdout 只输出最终结果。不带时输出给人看的文本。
- **退出码**：0 成功；1 失败（stderr 一行原因；带 `--json` 时 stdout 输出 `{ "error": "…" }`）；2 用法错误。
- **home**：`--home <dir>` > 环境变量 `YONDER_HOME` > 当前目录（含 `yonder.yaml` 时）> 报错。harness 启动时把 `YONDER_HOME` 设为自己的 home，本机执行环境里运行的命令继承它，所以 agent 直接运行 `yonder` 就作用于自己所在的 home。
- `help`、`--help`、`version`、`docs`、`changelog`、`update` 不要求已有 home（能解析到时仍使用）；`init` 的目标按位置参数 > `--home` > `YONDER_HOME` > 当前目录解析，不覆盖已有 yonder.yaml。`service install` 要求 home，其余 service 子命令从已安装 plist 取得 home。
- **帮助**：每个命令有 `--help`；`yonder help` 列出全部命令。
- **CLI 是管理面**：能运行它就能改配置、身份与会话（05 §3）。

## 2. 命令

| 命令 | 作用 | 任务 |
|---|---|---|
| `init [dir] [--owner <id>]` | 生成 home、`yonder.yaml`、一个 agent `main`；加载两款内置插件、cli 实例与 local 环境；agent 显式使用 `openai/gpt-6-luna`、owner 配置档 `bypass`、`tools.offer: ["*"]`、contexts `[agents-md, user-md]`、plugins `[context-files]`；CLI owner 私聊绑定到主会话且 stream 开启；生成 SYSTEM.md 与所选上下文模板；`identity.persons` 登记 `person:<id>`（默认 `owner`）并关联 `acct:cli:local` | T11 |
| `login <provider>` | pi-ai OAuth 登录（07 §6.2），写入凭据文件 | T11 |
| `doctor` | 校验配置、插件、绑定的 `kind`、skill（03 §6）；说明 05 §3 关于 `exec` 的限制 | T11 |
| `start` | 前台运行 harness：持锁、开控制接口、日志写标准输出 | T11 |
| `stop` | 经控制接口让运行中的进程退出 | T11 |
| `chat [--channel <实例>]` | 连接 channel-cli 实例的套接字 `<home>/.yonder/plugins/channel-cli/<实例>.sock`（默认实例 `cli`），一行一条消息，打印流式输出；Ctrl-D 退出 | T11 |
| `sessions list [--agent] [--mode] [--open]` / `show <id>` / `abort <id>` / `close <id>` | 会话接口（02 §5） | T11 |
| `events [--type --from --conv --agent --since --until --after --limit]` | 事件查询（01 §4） | T11 |
| `identity lookup <ref>` / `link <acct> <person>` / `unlink <acct>` / `person <id> <name>` | 身份接口（02 §4.4） | T11 |
| `skills [--agent <id>] [--profile <name>]` | 列出 skill 及来源、是否被遮蔽、索引的估算 token | T13 |
| `version` | 当前版本、安装目录、home | T14 |
| `changelog [--from <v>] [--to <v>]` | §5 | T14 |
| `docs [path] [--list]` | 输出当前版本 `docs/` 下的文件；不带参数输出 `docs/index.md` | T14 |
| `update [--to <tag>\|latest] [--repo <url>]` | §4 | T14 |
| `service install\|uninstall\|start\|stop\|restart\|status` | §6 | T14 |

只有这些命令。

## 3. 安装布局

```
<install>/                    默认 ~/.yonder-harness，可用环境变量 YONDER_INSTALL 改
  versions/<version>/         某个审核 tag 的构建安装，已 npm ci && npm run build，无 .git
  current -> versions/<version>
  bin/yonder                  shell 脚本：用安装时记录的 node 绝对路径运行 current 里的 CLI
```

- 安装目录放代码，home 放数据，两者分开；一个安装可以服务多个 home。
- 首次安装：在任意一份已构建的源码里运行 `node packages/cli/dist/index.js update --to <tag|latest>`，它创建安装目录；然后把 `<install>/bin` 加进 `PATH`。
- wrapper 将安装 bin、安装时 node 所在目录加到 PATH 前面；保留安装时的 PATH 供后台进程使用，使本机 agent 能运行 yonder、node、npm、git。凭据不写入 wrapper 或服务环境。
- 每版保留不含秘密的安装来源（仓库、tag、commit、版本）；version 查询安装来源。维护源码、安装程序、运行 home 分离，正式运行不引用开发包（10 §2）。

## 4. 更新

`yonder update [--to <tag>|latest] [--repo <url>]`：

1. 目标版本：`latest` 是仓库里最高的 semver 标签 `vX.Y.Z`；仓库默认取根 `package.json` 的 `repository`，用本机的 git 凭据访问。
2. 已是当前版本：什么都不做，退出码 0。
3. `git clone --depth 1 --branch <tag>` 到 `versions/<version>.tmp` → `npm ci` → `npm run build` → 记录来源 commit/tag，移除 .git → 改名为 `versions/<version>`。任一步失败：删除临时目录，当前版本不变，退出码 1。
4. 装了服务时，用新版本对服务的 home 运行 `doctor`；失败则不切换。
5. 原子切换 `current`（新建符号链接再 rename 覆盖）。
6. 装了服务：`service restart`。没装服务但有运行中的进程：提示手动重启。
7. 只保留最近 3 个版本，且不删当前与上一个。回滚就是 `update --to <旧版本>`。

阶段安装由 Codex 从被更新服务外执行 `update --repo <本地仓库> --to <唯一版本>`；不同审核源码使用不同 X.Y.Z，包版本和标签一致，不移动已安装标签或覆盖同版本目录。N11 接通后，operator 把更新交给独立一次性 launchd 作业，重启后核对结果；不得把自身 bash 被杀死视为更新成功。变更成为下一任务运行依赖前，先安装重启并经 MCP 真实调用（10 §2.1/6）。

### 4.1 版本通知

- 每次唤醒运行前比较会话的 version 与当前版本：不同则这次输入带一行 notice，输入真正提交后才更新 version；准备失败不消耗通知。新会话直接记当前版本，不带通知。预设同样适用。
- 文案固定：`notice: yonder harness updated from <旧> to <新>; details: yonder changelog --from <旧> --to <新>`。
- 这是给 agent 的内部信息：框架段告诉模型知道即可、不主动转述（06 §4）。

## 5. 发布

- 每个任务把对外可见的变化记在根目录 `CHANGELOG.md` 顶部的 `## [Unreleased]`（小节用 Added / Changed / Fixed / Removed）。Codex 审查 commit 与检查后统一所有包版本、CHANGELOG，打标签 vx.y.z 并推送本项目，使用 gh 创建该标签的正式 GitHub Release；本地阶段标签不推送，也不等于 Release。发布 watcher 接实际 Release 对象，不把标签当发布通知（10 §6）。
- `yonder changelog --from a --to b`：输出 `CHANGELOG.md`（当前版本里的）中版本在 (a, b] 之间的各节；`--to` 缺省为当前版本，`--from` 缺省为 `--to` 的上一个版本。

## 6. 后台服务（macOS）

- `service install`：写 `~/Library/LaunchAgents/dev.yonder.harness.plist`——`ProgramArguments = [<install>/bin/yonder, start, --home, <home>]`、`RunAtLoad`、`KeepAlive`、标准输出与错误写 `<home>/.yonder/logs/harness.log`——再 `launchctl bootstrap gui/<uid>`。一台机器一个服务，对应一个 home。
- `start`：已加载用 `launchctl kickstart`，未加载但 plist 存在用 `bootstrap`；`stop` 用 `bootout`，保留 plist；`restart` 对已加载服务用 `kickstart -k`，未加载时用 `bootstrap`；`status` 用 `print`；`uninstall` 卸载已加载服务后删除 plist。
- plist 的 EnvironmentVariables 仅保存 PATH、YONDER_INSTALL、YONDER_HOME；PATH 含安装 bin、安装时 node 所在目录及安装时 PATH。服务验证必须包含 stop → start，以及从后台 agent 调用 yonder docs、node、npm、git。
- 进程异常退出由 launchd 拉起；运行恢复按 07 §3.1 接好输入/结束关联后启用 pi 调度，重新打开文件不代表完成恢复。
- Linux（systemd 用户单元）以后做，命令不变。
