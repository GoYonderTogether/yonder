
# 09 CLI、安装与更新

CLI 同时给人和 agent 用：agent 在 bash 里运行 `yonder`，配合 `yonder docs`，就能自己查看和维护运行环境。

## 1. 约定

- **非交互**：除 `login`、`chat` 与交互终端中的无参数 TUI 入口外不读标准输入、不提问；缺参数就报错并给出用法。管理命令以 agent/脚本为主要使用方，人也能阅读；TUI 是人使用产品的基础入口，不能用 JSON 或逐行打印代替。
- **`--json`**：每个命令都支持。有限命令输出一个 JSON 值（列表输出数组）；持续的 `start`、`chat` 输出一行一个 JSON 值（JSON Lines）。`login` 仅本机交互 TTY，拒绝 `--json`；提示走 stderr，stdout 只输出最终非秘密结果。不带时输出给人看的文本。
- **退出码**：0 成功；1 失败（stderr 一行原因；带 `--json` 时 stdout 输出 `{ "error": "…" }`）；2 用法错误。
- **home**：`--home <dir>` > 环境变量 `YONDER_HOME` > 当前目录（含 `yonder.yaml` 时）> 已安装唯一服务的 home > `~/.local/share/yonder/home`（macOS/Linux）或 `%LOCALAPPDATA%\\YonderHarness\\home`（Windows）。harness 启动时把 `YONDER_HOME` 设为自己的 home，本机执行环境里运行的命令继承它，所以 agent 直接运行 `yonder` 就作用于自己所在的 home。
- `help`、`--help`、`version`、`docs`、`changelog`、`update` 不要求已有 home（能解析到时仍使用）；`init` 的目标按位置参数 > `--home` > `YONDER_HOME` > 含配置的当前目录 > 已安装服务home > 默认全局home解析，不覆盖已有 yonder.yaml。`service install` 要求 home，其余 service 子命令从已安装的平台注册记录取得 home。
- **帮助**：每个命令有 `--help`；`yonder help` 列出全部命令，命令名/参数保持英文，说明“中文 · English”。普通结果按命令呈现摘要、表格或正文，不默认打印调试对象；JSON 键与退出码不翻译。两种 Tab 补全见 12 §5；TUI 菜单、列表、布局和快捷键统一沿用固定版本 pi 原生实现，仅替换 Yonder 命令说明与内容（12 §2/4/6）。
- **CLI 是管理面**：能运行它就能改配置、身份与会话（05 §3）。

## 2. 命令

| 命令 | 作用 |
|---|---|
| `init [dir] [--owner <id>] [--isolated]` | 生成 home、`yonder.yaml`、一个 agent `main`；加载 channel-cli、context-files、interaction、agent-presets、web-tools 五款官方插件、cli 实例与 local 环境；agent 显式使用 `openai/gpt-6-luna`、owner 配置档 `bypass`、`tools.offer: ["*"]`、name `Jarvis`、contexts `[jarvis-soul, jarvis-work]`、plugins `[context-files, agent-presets]`；CLI owner 私聊绑定到主会话且 stream 开启；默认先生成独立 peer profile/binding，`--isolated` 禁用（03 §2.4）；生成所选上下文模板；`identity.persons` 登记 `person:<id>`（默认 `owner`）并关联 `acct:cli:local`。另从官方插件生成 default 与选择 web-tools 的 research 任务配置，coding 直接用插件预设（03 §5.4.1、12 §3） |
| `login <provider> [--slot <name>] [--method oauth|api_key] [--replace]` | 供应商原生认证（07 §6.2），默认 default/create-only；秘密与手工 code 隐藏录入，显式选择认证能力，不记录认证 URL/code/token |
| `credentials slots list` | 列出模型供应商 default 与已登记槽的白名单元数据，不列 named 服务密钥 |
| `credentials slots status <provider> <slot>` | 元数据与真实 OAuth/API-key/交互登录能力，不刷新或执行 key command |
| `credentials slots create <provider> <slot> [--env-ref <variable>]` | 创建槽描述，已有项拒绝；env-ref 只存变量名 |
| `credentials slots remove <provider> <slot>` | 只删除指定槽的该供应商账号，保留 generation 墓碑；default 不删除其他 provider/named key |
| `credentials set <name> --home <dir>` | 本机隐藏录入一项命名 API key（07 §6.2）：仅交互 TTY，不接受秘密参数、管道或 `--json`；已有同名项（含 OAuth）一概拒绝，不提供读取、轮换、删除；与 OAuth 共用凭据文件锁，原子写入，文件须为本用户单链接 0600 普通文件，路径中不得有 symlink 或他人可写目录。运行中的服务不必停止 |
| `doctor` | 校验配置、插件、绑定的 `kind`、skill（03 §6）；说明 05 §3 关于 `exec` 的限制 |
| `start` | 前台运行 harness：持锁、开控制接口、日志写标准输出 |
| `stop` | 经控制接口让运行中的进程退出 |
| 无参数 / `chat [--preset <id> \| --session <id> \| --channel <实例>] [--plain \| --json]` | TTY 默认进入新任务 TUI（default 预设，发送才创建），可选继续 task 或指定渠道；任务走控制面，渠道连接 `<home>/.yonder/plugins/channel-cli/<实例>.sock`。plain/JSONL 与非 TTY 规则见 12 §3 |
| `sessions list [--agent] [--mode] [--open]` / `show <id>` / `abort <id>` / `close <id>` | 会话接口（02 §5） |
| `sessions open <preset> [--keep-open]` / `submit <id> --text <text>` | 显式开任务与提交，默认一轮关闭，keep-open 为 manual；submit 返回接纳事件 id，不默认等待模型（12 §5） |
| `events [--type --from --conv --agent --since --until --after --limit]` | 事件查询（01 §4） |
| `identity lookup <ref>` / `link <acct> <person>` / `unlink <acct>` / `person <id> <name>` | 身份接口（02 §4.4） |
| `skills [--agent <id>] [--profile <name>]` | 列出 skill 及来源、是否被遮蔽、索引的估算 token |
| `version` | 当前版本、安装目录、home |
| `changelog [--from <v>] [--to <v>]` | §5 |
| `docs [path] [--list]` | 输出当前版本 `docs/` 下的文件；不带参数输出 `docs/index.md` |
| `update [--to <tag>\|latest\|beta] [--repo <url>]` | §4 |
| `service install\|uninstall\|start\|stop\|restart\|status` | §6 |
| `migrate [--dry-run \| --apply]` / `migrate --rollback <备份> [--dry-run] [--force]` | 把旧 `yonder-harness` 用户数据迁到新布局：运行目录移到 `~/.local/share/yonder/home` 并在旧路径留符号链接、`yonder.yaml` 与 `agents/*.yaml` 内旧插件 id/工具名改写（原文件留作 `.pre-migrate-<日期>`）、插件状态目录重命名、macOS power helper 的 launchd 标签改名。默认只预览。`--apply` 持服务同一把 home 锁（`.yonder/lock`）并在改名前再确认无服务在运行；先备份到 `<目录>.backup-<日期>/home`（含 `manifest.json`），再「临时名建链接 → 改名 → 链接就位」，日志 `.migrate-journal.json` 记录中间状态，任何一步出错自动还原，中断后重跑 `--apply` 会收尾。备份有意不含运行时 socket（`control.sock`、渠道 `*.sock`）与锁目录：它们只在运行期存在，服务启动时重建。launchd 步骤需管理员权限，与数据迁移分开报告，失败时打印剩余命令的原样文本，数据迁移不受影响。`--rollback` 先恢复到同级临时目录、原子换入、最后才删旧副本；要求旧路径是指向新目录的符号链接，且新目录中没有迁移完成后写入的文件，否则拒绝，`--force` 明确放弃这些数据后才继续；launchd 改名不自动回滚 |
| `completion zsh\|bash\|fish` | 输出 shell 补全脚本；无 home 也可输出静态脚本；不修改用户 shell 配置（12 §5.3） |

除上述命令（含 `migrate`）、14 §4 的 agents/presets 管理及 13 §2 的 plugins list/show/add/remove、skills show/add/remove、models list、inspect 外，不增加其他命令。sessions submit 同时支持 13 §1.4 的可重复 --attachment <本地路径>。这些命令的精确参数与语义见 13，不在此复制第二份。

`chat` 默认进入独立新任务；进入常驻渠道需显式 `--channel <实例>`，不会暗中把 main 历史搬进任务会话。补全命令与 help/version 等一样不要求 home；动态候选仅在能解析 home 时读取。

## 3. 安装布局

```
<install>/                    默认 ~/.yonder-harness（Windows 为 %LOCALAPPDATA%\\YonderHarness），可用 YONDER_INSTALL 改
  versions/<version>/         某个审核 tag 的构建安装，已 npm ci && npm run build，无 .git
  current -> versions/<version>   Unix 符号链接；Windows 目录 junction
  bin/yonder                  Unix shell wrapper
  bin/yonder.cmd              Windows cmd wrapper；均用安装时 node 绝对路径运行 current 里的 CLI
```

- 安装目录放代码，home 放数据，两者分开；一个安装可以服务多个 home。
- 首次安装：在任意一份已构建的源码里运行 `node packages/cli/dist/index.js update --to <tag|latest>`，它创建安装目录；然后把 `<install>/bin` 加进 `PATH`。
- wrapper 将安装 bin、安装时 node 所在目录加到 PATH 前面；保留安装时的 PATH 供后台进程使用，使本机 agent 能运行 yonder、node、npm、git。凭据不写入 wrapper 或服务环境。
- 每版保留不含秘密的安装来源（仓库、tag、commit、版本）；version 查询安装来源。维护源码、安装程序、运行 home 分离，正式运行不引用开发包。

## 4. 更新

`yonder update [--to <tag>|latest|beta] [--repo <url>]`（版本号与通道见 §5）：

1. 目标版本：`latest` 是仓库里最高的正式版标签 `vX.Y.Z`，`beta` 是包含测试版在内最高的标签；仓库默认取根 `package.json` 的 `repository`，用本机的 git 凭据访问。
2. 已是当前版本：什么都不做，退出码 0。
3. `git clone --depth 1 --branch <tag>` 到 `versions/<version>.tmp` → `npm ci` → `npm run build` → 记录来源 commit/tag，移除 .git → 改名为 `versions/<version>`。任一步失败：删除临时目录，当前版本不变，退出码 1。
4. 装了服务时，用新版本对服务的 home 运行 `doctor`；失败则不切换。
5. Unix 原子切换 `current`（新建符号链接再 rename 覆盖）；Windows 创建新 junction，验证新旧入口均为指向本安装 `versions/<version>` 的链接后，先把旧 junction 改名留作回退，再将新 junction 改名为 `current`。真实目录、悬空或越界链接须拒绝且不删除；仅 unlink 已验证的旧链接。切换失败恢复旧 junction；Windows 切换期间可能有短暂入口空档。
6. 装了服务：`service restart`。没装服务但有运行中的进程：提示手动重启。
7. 只保留最近 3 个版本，且不删当前与上一个。回滚就是 `update --to <旧版本>`。

从本地仓库阶段安装：`update --repo <本地仓库> --to <唯一版本>`；不同审核源码使用不同 X.Y.Z，包版本和标签一致，不移动已安装标签或覆盖同版本目录；同版本 update 返回未更新，不能作为新代码已生效的证据。macOS 自动更新由独立一次性 launchd 作业执行并核对结果，不得把承载自身的 bash 被杀死视为更新成功（10 §3）；Linux/Windows 首版仅支持显式 update。

### 4.1 版本通知

- 每次唤醒运行前比较会话的 version 与当前版本：不同则这次输入带一行 notice，输入真正提交后才更新 version；准备失败不消耗通知。新会话直接记当前版本，不带通知。预设同样适用。
- 文案固定：`notice: yonder harness updated from <旧> to <新>; details: yonder changelog --from <旧> --to <新>`。
- 这是给 agent 的内部信息：框架段告诉模型知道即可、不主动转述（06 §4）。

## 5. 发布

- **版本号**：`0.<minor>.<YYMMDDNN>`，YYMMDD 是两位年份的发布日期，NN 是当天递增序号（如 `0.2.26102001`）。**正式版**是无后缀版本，对应 GitHub 正式 Release；**测试版**加 `-beta.N` 后缀（如 `0.2.26102001-beta.1`），对应 GitHub 预发布（prerelease）。同一 X.Y.Z 下测试版先于正式版（semver）。自动更新、`update --check`、`update --to latest` 与发布监听只认正式版；安装测试版需显式 `update --to beta` 或指定标签。版本方案变更时递增 minor，保证次序单调。
- 每次变更把对外可见的变化记在根目录 `CHANGELOG.md` 顶部的 `## [Unreleased]`（小节用 Added / Changed / Fixed / Removed）。发布时统一所有包版本与 CHANGELOG，打标签 vx.y.z 并推送，使用 gh 创建该标签的正式 GitHub Release；本地阶段标签不推送，也不等于 Release。发布 watcher 接实际 Release 对象，不把标签当发布通知（10 §3）。
- `yonder changelog --from a --to b`：输出 `CHANGELOG.md`（当前版本里的）中版本在 (a, b] 之间的各节；`--to` 缺省为当前版本，`--from` 缺省为 `--to` 的上一个版本。

## 6. 后台服务

- macOS `service install`：写 `~/Library/LaunchAgents/dev.yonder.harness.plist`——`ProgramArguments = [<install>/bin/yonder, start, --home, <home>]`、`RunAtLoad`、`KeepAlive`、标准输出与错误写 `<home>/.yonder/logs/harness.log`——再 `launchctl bootstrap gui/<uid>`。一台机器一个服务，对应一个 home。
- `start`：已加载用 `launchctl kickstart`，未加载但 plist 存在用 `bootstrap`；`stop` 用 `bootout`，保留 plist；`restart` 对已加载服务用 `kickstart -k`，未加载时用 `bootstrap`；`status` 用 `print`；`uninstall` 卸载已加载服务后删除 plist。
- plist 的 EnvironmentVariables 仅保存 PATH、YONDER_INSTALL、YONDER_HOME；PATH 含安装 bin、安装时 node 所在目录及安装时 PATH。服务验证必须包含 stop → start，以及从后台 agent 调用 yonder docs、node、npm、git。
- 进程异常退出由 launchd 拉起；运行恢复按 07 §3.1 接好输入/结束关联后启用 pi 调度，重新打开文件不代表完成恢复。
- Linux 使用 systemd **用户**单元 `dev.yonder.harness.service`，放在 `$XDG_CONFIG_HOME/systemd/user`（缺省 `~/.config/systemd/user`）。`service install` 写单元并 `daemon-reload`、`enable --now`；start/stop/restart/status/uninstall 对该用户单元操作。ExecStart 使用已安装 wrapper、固定 home；日志由 journald 保管。无需 root，不安装系统级服务。
- Windows 使用当前用户的 Task Scheduler 登录任务 `Yonder Harness` 作为后台入口；不注册需要管理员权限的 SCM 服务。`service install` 在 `<install>/bin` 保存只含 home/install/node 路径的启动脚本，并在 `%LOCALAPPDATA%\\YonderHarness` 保存注册记录；start/stop/restart/status/uninstall 使用 `schtasks`，卸载保留 home 与版本。任务在当前用户会话启动，不承诺注销后运行或崩溃后自动重启。Windows 控制面与 CLI 渠道使用本机命名管道，管道名由规范化 home 路径摘要决定，不暴露 TCP 端口。
- Windows 管道当前显式关闭 Node 的 `readableAll`/`writableAll`，但跨账户隔离尚无实机证明。验收门槛：Windows ARM64 上同一普通用户可连控制面和 CLI 渠道，另一独立普通用户对两条管道均被拒绝，且任务重启后仍成立；若默认 DACL 不满足，需在创建管道时将 DACL 限定为安装用户 SID（及系统必需主体）并在无法施加时拒绝启动，或增加绑定仅该用户可读本地凭据的认证。未完成前不得将 Windows 本机控制面标为多用户安全通过。
- Linux/Windows 的 full 首版是 CLI/TUI 与内核；macOS Helper、状态栏、屏幕/电源辅助能力仅在 macOS 启用。实际安装、启动、Agent 创建、控制、重启连接、卸载按 OS 与架构单独验收，构建成功不等于运行通过。

### 6.1 macOS 状态栏

复用 §3–§4 的 git 标签→本机构建→版本目录→current→独立 home→launchd 安装链。默认安装目录 `~/.yonder-harness`，默认数据目录 `~/.local/share/yonder/home`；不从开发仓库运行日用服务，不复制其他应用 OAuth。

macOS 状态栏用原生 Swift/AppKit NSStatusItem、LSUIElement，一个 home 只有一个状态栏宿主，无 Dock 图标或客户端框架。左右键均打开同一原生管理菜单，不因点击状态栏展开交互窗口；菜单含打开悬浮窗、交互历史、逐 Agent 的实际运行状态与任务摘要、真实服务状态（只读）、检查更新、停止服务并退出。打开菜单时读取权威状态；后台查询不抢焦点。检查更新只查询当前批准仓库实际最新正式 Release 并显示当前/可用版本和失败，不自动安装，不发消息。退出停止既有 harness launchd 服务，再退出图标；保留服务定义、版本与数据，下一次登录仍自启。若停止失败，显示实际错误并保留图标。

服务沿用现有 dev.yonder.harness；图标采用一个用户 launchd 登录项 dev.yonder.harness.status，RunAtLoad=true、KeepAlive=false，避免用户退出后被重拉。交互浮窗与浮球由同一状态栏进程承载，不增加第二个桌面应用、常驻管理器、自动更新机制、设置页、安装平台或特权助手。

状态栏源码位于 packages/macos/，使用系统 swiftc；构建/安装接入既有发行流程。安装版保存构建后的 .app；程序调用安装 bin/yonder 固定 argv，不拼 shell，不读凭据。状态/更新检查需要相应真实结果，不以图标显示等价于服务运行。macOS 状态栏操作和屏幕预览需要真实运行证据。

只读命令 `yonder service info --home <home> --json` 返回实际服务进程的 version/commit/home/pid/ready/active/agents；agents 按已注册且未归档的 Agent 聚合原生运行、待执行输入和后台任务，包含空闲、运行、等待交互及每个活跃会话的短摘要和可见回复片段。仅读本机控制面，不暴露思考、工具参数或工具输出，不建立第二份任务状态；状态栏后台定期读取，失败显示未知，图标以活动标记区分运行与空闲。控制面未就绪时失败，不回退磁盘版本。`yonder update --check --json` 经本机既有 gh 登录态查询仓库最新正式 GitHub Release，返回 current/latest/updateAvailable/url，缺 gh、登录或正式发布时显示实际失败。不会安装或改配置。

桌面交互入口默认就绪：init 将 interaction 加入全局插件列表；CLI start 对旧 home 复用 plugins 管理入口，按实际插件 id 检查并仅在缺失时补入官方包。已有自定义来源和 desktop:false 均保留，不改任何 Agent/预设的 plugins、tools 或权限。交互插件在私有 data 目录发布 desktop.json（运行时回环 url、实际 pid），状态栏仅读取当前 home 的 .yonder/plugins/interaction/desktop.json 并验证本机地址和进程存活；插件停止清理自身描述文件，宿主关闭旧页面与窗口。desktop:false 不向状态栏发布。UI 状态不复制到内核；业务工具/队列/历史仍由 interaction 插件负责。状态栏进程使用当前 home 的文件锁阻止重复启动；不依赖 Web 内容保证单实例。

## 7. 统一诊断

start输出沿用单一日志入口，增加ISO时间；插件api.log沿用plugin标签和实例/阶段字段。后台服务以--json写JSONL，仍写home/.yonder/logs/harness.log，可用系统tail查看/追踪，不新增日志服务或额外命令。CLI/TUI斜杠清单与飞书共用SDK常量；文本渠道实现11及12定义的共享命令子集。

## 8. 全局日用入口与开发边界

裸yonder在TTY中优先进入名为cli的CLI渠道，否则首个实际CLI渠道；无CLI渠道才保留新任务入口。显式yonder chat保持独立任务，--channel/--preset/--session保持原含义。进入CLI渠道即可只读装入该渠道已声明main绑定的agent的现有main历史并观察更新，不必先发一条消息；发送仍经原渠道绑定，禁止直接向常驻session.submit绕过绑定。没有主会话时首次输入正常创建，不伪造历史。

默认home从唯一已安装服务读取，保持--home/YONDER_HOME和当前明确home优先；不依赖开发仓库或shell额外环境变量。未初始化时裸入口说明yonder init、login openai、service install，不偷偷启动第二进程。新用户按README从官方仓库安装，之后用同一update/current/版本目录机制更新回滚。正式安装不保留.git、不以开发目录运行，测试开发显式指定隔离home；不添加第二套服务管理或更新器。

## 9. 统一更新结果及内部通知

updateRelease 是 CLI 与插件独立作业共用的安装入口，实际尝试产生 01 定义的 release.update-result；不能只对 GitHub 自动升级写完成事实。完成核验服务版本/来源提交/home/pid/ready，不用模型确认。无服务可核验或仍待重启时不能报告 verified。同一安装同时只允许一个 `updateRelease`（安装目录下 `.update.lock`，持有进程存活且不足 30 分钟则后来者直接报错，不记录失败结果、不争用临时目录）；自动升级的独立作业在运行中有活动工作时先等待，最多 30 分钟，主人或 Agent 明确要求的升级不等待。给主人的通知只在终态发送：核验通过写“已更新并核验”，失败写简短原因，不含回执号。更新错误保留错误和事实，不能为了记录失败吞掉原失败。结果记录失败与更新失败分开返回/报告，不重做已完成的安装。服务重启后控制接口尚未就绪而主目录锁仍新鲜（120 秒内被刷新）时，记录结果等待服务而不是接管该锁：启动中的内核事件循环可能被占用超过锁的 10 秒默认过期时间，被接管的锁会使其以 ECOMPROMISED 崩溃（0.2.26102104 升级实测）；超过等待上限仍无服务则报告记录失败。

新增 `sessions notify <id> --event <事件id> --text <正文>`，仅提交 system:cli 来源的程序通知；不接受 from，不启动模型。复用现有控制面及 JSON/退出码规范，目标/原事件不合法则拒绝，持久记录和实际展示分别确认。

## 渠道接入命令

`yonder channels list` 列出当前服务的渠道和是否支持扫码登录；`yonder channels login [instance] [--poll] [--verify-code <code>] [--open]` 调用当前服务的渠道登录，不启动第二个内核、不复制凭据。未带验证码时默认返回可扫码链接；`--verify-code` 接受 1–12 位纯数字并以 poll action 传给渠道。card 将其中十位数字解释为兑换网页主人发起的一次性邀请码，成功直接连接，无需第二次确认（16 §1）。--open 在当前本机显式打开 HTTPS 链接；--json 保持机器可读。CLI 管理面仍只对本机用户开放。渠道聊天中的 `/connect [instance]` 只允许 admin+network 来源，返回同一安全链接和状态，不调用模型。

## 任务期间保持唤醒（macOS）

主服务按原生运行、待执行输入和后台工作查询活跃数量；现有状态栏提供唯一的“任务期间保持唤醒”开关与真实状态，不新增图标。设置存于 home/.yonder/awake.json，默认关闭，首次明确启用安装限定电源能力的 root helper 并由系统请求授权；成功后保持选择。显示器允许休眠。

服务每秒续租；root helper 仅接受安装用户的本机 Unix socket，聚合所有连接的任务保护。需要时用 IOKit 防空闲睡眠并临时设置 SleepDisabled，最后一份租约断开、超过 5 秒未续租或任务结束时恢复自身改动；原本已禁用睡眠时不擅自关闭。root helper 持有恢复记录，重启时先恢复。服务/状态栏退出不遗留租约；菜单收起不释放任务保护。无授权与失败显示真实状态，不能标记已保护。

CLI awake status/set/install 提供状态、布尔策略开关和用户主动授权入口；后台启动不弹授权。活动计数不唤醒模型，不复制会话存储。单纯历史会话和未来定时任务不计；等待 interaction_result 且没有其他实际执行的状态不计。MacToolkit 电源功能移除后交由 Yonder 单独管理。合盖、电池供电、服务崩溃恢复均需分开验证；不能把编译或热点连接当成物理合盖验收。

电源组件协议带版本；升级后旧组件不标记为已保护，原菜单项提供更新操作并复用系统授权，不后台弹窗。持久 socket 每次调用须回收子进程/管道资源；构建自检重复真实 pmset 读取，无句柄增长。

### 唤醒模式与任务结束缓冲

现有菜单的“保持唤醒”子菜单提供互斥的关闭、任务期间保持唤醒、始终保持唤醒。沿用已安装电源组件，不增加图标。CLI awake set 接受 off/tasks/always，旧 on 等价 tasks，旧 enabled 布尔配置兼容读取。模式选择保存到同一 home，已有关闭选择保留；首次启用 always 提示额外耗电与合盖散热，用户确认后保存提示已读。

任务模式在观察到最后一项真实任务结束时开始至少 15 分钟缓冲，期间新任务重置缓冲，等新任务全部结束后重新计 15 分钟。缓冲结束前最后再查询一次运行状态；始终模式不因空闲释放，关闭模式立即释放。状态显示真实保护结果、模式和缓冲剩余分钟；不能以 active=0 判定缓冲期不需要保护。等待未来定时任务不单独持有保护，已配置定时任务进入实际运行后沿相同机制重计缓冲。服务退出仍释放自身保护，重启不会凭空补出历史缓冲。唤醒与网络重连是不同能力，不承诺已睡主机能被普通 cron 或消息唤醒，也不承诺手机热点永不断连。

创建接口：`initHome(home, owner?, options?: { isolated?: boolean })`；`agents create --file` 的创建输入可含 isolated，不新增该命令旗标，也不持久化到 Agent 配置。
