# 一键安装、卸载、迁移与客户端自动更新：现状与测试方案

调研对象：`/Users/zoran/Documents/yonder-harness`（只读）。所有命令在本机 Apple M5 / macOS 27.2 / arm64 前台执行。未改动任何仓库文件，未提交、未推送。

## 0. 结论摘要

1. **“一键安装”目前不存在**。README 的 Quick start 是“clone + `npm ci` + `npm run build` + 四条 CLI 命令”（`README.md:56-67`），全仓没有 `install.sh` / `curl … | sh` / `irm … | iex` 安装器；`design.md:521-540`（§6）把这条命令列为**目标**而非现状。
2. 现有安装器实际上是 **`yonder update --to latest`**：它在目标机上 `git clone --depth 1 --branch <tag>` → `npm ci` → `npm run build`（`packages/core/src/release/index.ts:648-783`）。也就是说目标机必须预装 **Node 22.19+、git、npm 与完整构建链**，这与“面向普通用户的一键安装”是两件事。
3. **卸载只有 `yonder service uninstall`**（删 launchd plist / systemd 单元 / schtasks 任务），**没有任何命令删除 home、版本目录、helper、特权守护进程**；全仓 `packages/cli`、`packages/core` 里没有删除 home 的代码路径。
4. **`yonder migrate` 尚未实现**（全仓 `packages/core`/`packages/cli`/`scripts`/`docs` 无 `migrate` 子命令），只存在于 `design.md:268-286`。
5. **自动更新链已上线且只在 macOS 生效**：`channel-github` 插件发现正式 Release 后派发一个**一次性 launchd 作业**（`dev.yonder.github-update.<instance>.<releaseId>`）跑独立进程执行 `yonder update`，再回读 `service status`/`service info` 核验 version+commit+pid（`plugins/channel-github/src/updates.ts:79-146`、`plugins/channel-github/src/update-job.ts:96-200`）。非 darwin 直接抛错（`updates.ts:79-80`）。
6. **GitHub Releases 目前没有任何二进制附件**（`gh release view v0.2.26102701 … --json assets` → `"assets":[]`），只有 tag。三平台安装包、`latest.json`、签名都是阶段 6 的新工作。
7. CI 只有一个 `macos` job，**没有 ubuntu/windows job，也没有任何安装/卸载/升级 e2e**（`.github/workflows/ci.yml`）。

---

## 1. 现状：安装路径与入口

### 1.1 安装入口链路（已核实）

| 环节 | 入口 | 出处 |
|---|---|---|
| 首次获取代码 | `git clone … && npm ci && npm run build` | `README.md:56-67` |
| 装到版本目录 | `node packages/cli/dist/index.js update --to latest` | `README.md:60-62` |
| 加 PATH | `export PATH="$HOME/.yonder-harness/bin:$PATH"`（**不写 shell 配置**） | `README.md:62`；本机 `grep yonder-harness ~/.zshrc ~/.zprofile ~/.zshenv` 无命中 |
| 初始化 home | `yonder init` → 写 `yonder.yaml`、`agents/main`、`presets/` | `packages/core/src/kernel/home.ts:104-150` |
| 注册后台服务 | `yonder service install --home <home>` | `packages/cli/src/index.ts:69`、`packages/core/src/release/index.ts:479-582` |
| 桌面权限 helper | 首次桌面调用时 `installHelper()` 装 `Yonder Helper.app` | `scripts/yonder-helper-install.mjs`、`scripts/yonder-service-host.mjs` |
| 电源保持唤醒（特权） | `yonder awake install` | `packages/cli/src/awake.ts:63-92` |

`yonder` 命令全集里没有 `install` 子命令，只有 `update`（`packages/cli/src/index.ts:40-71` 的 usage 表）。

### 1.2 逐平台：安装 / 卸载 / 迁移 / 升级

| | macOS | Linux | Windows |
|---|---|---|---|
| **安装** | 有（`update --to latest`，需 Node+git；无 GUI 安装包） | 代码有、**未实机验收**（`docs/status.md:178`） | 代码有、**未实机验收**；且需 git/npm/node 才能装 |
| **安装目录** | `~/.yonder-harness`（`YONDER_INSTALL` 可改） | 同左 | `%LOCALAPPDATA%\YonderHarness`（`index.ts:37`） |
| **数据目录** | `~/.local/share/yonder-harness/home` | 同左 | `%LOCALAPPDATA%\YonderHarness\home`（`packages/cli/src/index.ts:267`、`docs/spec/09-cli-release.md:11`） |
| **服务注册** | 两个 LaunchAgent：`dev.yonder.harness.plist`、`dev.yonder.harness.status.plist`（`index.ts:306-324`） | systemd **用户**单元 `~/.config/systemd/user/dev.yonder.harness.service`（`index.ts:331-374`） | Task Scheduler 登录任务 `Yonder Harness` + `<install>/bin/yonder-service.cmd` + `%LOCALAPPDATA%\YonderHarness\service.json`（`index.ts:375-478`） |
| **卸载** | `service uninstall`：bootout + 删两个 plist（`index.ts:540-550`），**保留 home 与版本** | `disable --now` + 删单元（`index.ts:355`） | `/End` + `/Delete /F` + 删 `service.json`，**保留 home 与版本**（`index.ts:435`、`docs/spec/09-cli-release.md:95`） |
| **迁移** | 无 | 无 | 无 |
| **升级** | `yonder update`（显式）+ launchd 一次性作业自动升级（`updates.ts:104-146`） | 仅显式 `update`（`docs/spec/09-cli-release.md:74`） | 仅显式 `update`；且自动更新作业本身只支持 darwin（`updates.ts:79`） |

版本布局：`<install>/versions/<version>`、`current` 为 Unix 符号链接 / Windows 目录 junction、`bin/yonder`（Unix sh）与 `bin/yonder.cmd`（`docs/spec/09-cli-release.md:48-56`、`index.ts:289-302`、`index.ts:583-597`）。切换是“先建新链接再 rename 覆盖”，Windows 先把旧 junction 改名留回退（`index.ts:700-760`）。保留最近 3 个版本（`index.ts:773`；本机实测 `~/.yonder-harness/versions/` 恰为 `0.2.26102702/704/705`）。

### 1.3 实际写入的路径（本机实测）

- `~/.yonder-harness/`：`bin/`、`current -> versions/0.2.26102705`、`versions/`（3 个）。
- `~/.local/share/yonder-harness/`：`home/`、`helper/`（`Yonder Helper.app`、`permissions-state.json`、`permissions.lock`、`yonder-permissions`）、`archives/`、`deployment/`。
- `~/Library/LaunchAgents/dev.yonder.harness.plist`（实测 ProgramArguments = `["/Users/zoran/.yonder-harness/bin/yonder-service","--home","/Users/zoran/.local/share/yonder-harness/home"]`，EnvironmentVariables 仅 PATH/YONDER_INSTALL/YONDER_HOME）。
- `~/Library/LaunchAgents/dev.yonder.harness.status.plist`（ProgramArguments = `<install>/current/packages/macos/dist/YonderStatus.app/Contents/MacOS/YonderStatus`）。
- 若跑过 `yonder awake install`：`/Library/PrivilegedHelperTools/dev.yonder.harness.power` 与 `/Library/LaunchDaemons/dev.yonder.harness.power.plist`（`packages/cli/src/awake.ts:63-92`，经 `osascript … with administrator privileges`）。
- PATH：**不写任何 shell 配置**，仅 wrapper 内嵌安装时 PATH（`index.ts:279-302`）。

### 1.4 发布产物

- 版本号 `0.<minor>.<YYMMDDNN>`；正式版无后缀 → 正式 Release，`-beta.N` → prerelease（`docs/spec/09-cli-release.md` §5）。
- `gh release list -R GoYonderTogether/yonder-harness`：Latest = `0.2.26102701`（2026-10-27T09:10:52Z），其下至少 20 个历史 release；`gh release view v0.2.26102701 --json assets` → `[]`。
- 结论：**Release 只有源码 tag，安装包/校验和/`latest.json` 全部不存在**。这与 `design.md:521-540` 的目标（三平台产物 + `SHA256SUMS`）差距最大。

---

## 2. Windows 支持度

代码里的 `win32` 分支（非测试命中）：

| 能力 | 实现 | 出处 | 缺口 |
|---|---|---|---|
| 默认路径 | `%LOCALAPPDATA%\YonderHarness`（install）与 `…\home`（数据） | `index.ts:37`、`packages/cli/src/index.ts:267` | — |
| 控制面 | 命名管道 `\\.\pipe\yonder-control-<sha256(规范化 home 前 32 hex)>` | `packages/core/src/control/index.ts:17-31` | 跨账户 DACL **无实机证明**（`docs/spec/09-cli-release.md:96`） |
| CLI 渠道 | `\\.\pipe\yonder-cli-<sha256(<home>/.yonder/plugins/channel-cli/<id>.sock)>` | 同上 `:26-31` | 同上 |
| 服务注册 | `schtasks /Create /SC ONLOGON /TR cmd.exe /d /c ""<script>"" /F /RL LIMITED` | `index.ts:375-478` | `/TR` 超 262 字符直接抛 `Windows scheduled task command exceeds the 262-character /TR limit`；不承诺注销常驻、不承诺崩溃自动重启（`docs/spec/09-cli-release.md:95`、`docs/status.md:5`） |
| 版本切换 | 目录 junction，旧链接改名回退 | `index.ts:714-760` | 切换期有短暂入口空档（`docs/spec/09-cli-release.md:70`） |
| wrapper | `yonder.cmd`，`%`→`%%`、`^`→`^^`，含 `\r\n"` 报错 | `index.ts:285-299` | — |
| shell 执行 | 依赖 Git Bash：`where bash.exe`、`%ProgramFiles%\Git\bin\bash.exe` | `packages/pi-durable/src/env/node.ts:194,224` | **干净 Windows 机器必须另装 Git for Windows**，否则 shell 工具不可用 |
| 进程管理 | `detached: false`、`taskkill.exe` 杀进程树 | `packages/pi-durable/src/env/node.ts:275,848`、`packages/executor/src/backends/process.ts:13,25` | — |
| 文件监视 | win32 强制 `polling` 模式 | `packages/pi-durable/src/env/node-watch.ts:184` | 大量文件时 CPU/延迟成本（推断） |
| 路径逃逸判断 | 分隔符按 `\` 判断 | `packages/core/src/runtime/policy.ts:46` | — |
| 凭据 EPERM | win32 容忍 `EPERM` | `packages/core/src/runtime/credentials.ts:30` | — |
| 自动更新 | `process.platform !== "darwin"` 抛 `Service-external updates require macOS launchd user domain` | `plugins/channel-github/src/updates.ts:79-80` | Windows 无任何自动升级路径 |
| 更新作业可执行路径 | `join(request.install, "bin/yonder")`（缺 `.cmd`） | `plugins/channel-github/src/update-job.ts:107` | 即便放开平台也会找不到 Windows 入口 |
| Helper / 状态栏 | 仅 macOS（`Yonder Helper requires macOS`） | `scripts/yonder-permissions.mjs`、`docs/spec/09-cli-release.md:97` | Windows 无桌面自动化 |
| CI | 仅 macos job | `.github/workflows/ci.yml` | 无 Windows 编译与安装验证 |

补充事实：`packages/core/src/release/platform-service.test.ts:69-121` 用**假 `schtasks` 脚本**验证 Windows 服务命令的参数序列，不接触真实系统；`packages/core/src/release/index.ts:481` 之外无其它平台分支，`manageService` 对未知平台抛 `Yonder Harness background services currently support macOS launchd only`。

---

## 3. 卸载与迁移

### 3.1 现有清理能力（全部）

1. `yonder service uninstall`：macOS 两个 plist + bootout；Linux `disable --now` + 删单元；Windows `/End`+`/Delete`+删 `service.json`。**都保留 home 与 versions**。
2. `yonder update` 的版本修剪：保留最近 3 个版本（`index.ts:773`）。
3. 没有其它清理命令：`grep -rn "rm(home\|rmdir\|removeHome"` 在 `packages/cli/src`、`packages/core/src` 无命中。

### 3.2 卸载必须覆盖的残留（本机实测清单）

| 路径 | 内容 | 现状是否被清理 |
|---|---|---|
| `~/.yonder-harness/`（含 `versions/`、`bin/`、`.update.lock`、`.yonder-install.json`） | 代码 | 否 |
| `~/.local/share/yonder-harness/home/` | 数据（`yonder.yaml`、`agents/`、`presets/`、`skills/`、`.yonder/`） | 否 |
| `home/.yonder/state.db` | **1,184,567,296 B ≈ 1.18 GB**（另有 4.2 MB WAL） | 否 |
| `home/.yonder/background/` | 8,892 项 | 否 |
| `home/.yonder/{auth.json,auth.json.slots/,device-id,plugins/,backups/,logs/,service-host.json,status.json,awake.json}` | 凭据与运行时状态 | 否 |
| `~/.local/share/yonder-harness/helper/` | `Yonder Helper.app`、`permissions-state.json`、`yonder-permissions` wrapper | 否 |
| `~/Library/LaunchAgents/dev.yonder.harness{,.status}.plist` | 服务定义 | 是（service uninstall） |
| `/Library/PrivilegedHelperTools/dev.yonder.harness.power` + `/Library/LaunchDaemons/dev.yonder.harness.power.plist` | root 特权守护进程 | 否（install.sh 里只有 bootout 后重装，无删除路径） |
| shell PATH 里的 `~/.yonder-harness/bin` | 用户手工加的 export | 否 |
| `<home>/.yonder/plugins/channel-cli/*.sock`、`control.sock`、`service-host.lock`、`status-ui.lock`、`install.lock` | 运行时套接字与锁 | 否 |

推断：卸载测试的关键指标不是“删得掉”，而是**1.18 GB state.db 与 8,892 项 background 的删除耗时/失败恢复**，以及“卸载后 launchd 里不再有同名 Label”。

### 3.3 `yonder migrate` 需要覆盖的点

`design.md:268-286` 已列 4 条（移动 home + 留符号链接并提示重注册服务、重写 `yonder.yaml`/`agents/*.yaml` 的旧插件 id 与工具名、移动 `<home>/.yonder/plugins/hermes-experience/`→`learning/`、打印计划 + `--dry-run`）。按当前代码，还**必须**覆盖下面这些 design.md 没写、但会直接坏掉的东西：

1. **服务定义里的绝对路径**：macOS plist 的 `ProgramArguments`/`EnvironmentVariables`（`index.ts:306-315`，实测为 `<install>/bin/yonder-service --home <home>`）、Linux 单元首行 `# YonderService={"home":…,"install":…}` 与 `ExecStart`（`index.ts:331-334`）、Windows `<install>/bin/yonder-service.cmd` 与 `service.json`（`index.ts:375-478`）。design.md 自己也标注了“未核实其具体字段”（`design.md:268-286`）。
2. **状态栏 plist 的 `statusExecutable`**：写死 `<install>/current/packages/macos/dist/YonderStatus.app/...`（`index.ts:42-43,316-324`）。
3. **helper 的稳定目录**：`stableDirectory()` 固定为 `~/.local/share/yonder-harness/helper`（`scripts/yonder-helper-install.mjs`），且 `installHelper` 要求 `root === realpath(<install>/current)` 且存在 `.yonder-install.json`，否则抛 `Production Helper installation requires the current installed release, not a development checkout`。
4. **wrapper 内嵌的 node 绝对路径**：`launcher()`/`windowsLauncher()` 把安装时 `process.execPath` 与 PATH 写死（`index.ts:279-302`）——换机器/换 node 版本必须重写。
5. **命名管道名由 home 路径哈希决定**：home 搬家后管道名变化（`packages/core/src/control/index.ts:17-31`），迁移必须重注册服务，否则 CLI 连不上。
6. **`service-host.json` 与 `launch.json` 中的绝对路径**：`scripts/yonder-service-host.mjs` 的 `onState` 原子写 `<home>/.yonder/service-host.json`，lease 目录在 `/tmp`。
7. **一次性更新作业目录**：`<plugin data>/<instance>.updates/<releaseId>/{request.json,result.json,update-job.mjs,job.plist}`（`plugins/channel-github/src/updates.ts:17,104-146`），其中 request.json 含 install/home 绝对路径。
8. **`awake.json`、`model-health.json`、`auth.json.slots/`、`device-id`**：属于用户数据，迁移只能搬不能改（`design.md:268-286` 第 3 条只提到 `.hermes-pending`）。
9. **插件目录改名**：`plugins/hermes-experience` 与 `plugins/ui-companion` 仍在仓库里（`ls plugins` 23 项），本机 home 的 `.yonder/plugins/` 也有这两个目录 —— 迁移的“旧 id → 新 id”映射要同时处理**仓库内目录、home 内插件数据目录、`yonder.yaml` 引用、`<home>/.yonder/plugins/*/` 运行时文件**四处。
10. **幂等与并发**：迁移期间必须拒绝并发（沿用 `.update.lock` 的模式，`index.ts:794-826`），否则迁移与自动升级会同时动 `current`。

---

## 4. 客户端自动更新

### 4.1 现状：内核/CLI 自更新（已上线，仅 macOS）

链路（全部已核实）：

1. `channel-github` 轮询仓库 releases，按 `approvedAuthors` 与 `policy: notify | apply` 过滤（`plugins/channel-github/src/releases.ts:9-10,61-66,101-162`）。
2. `apply` 时 `dispatchUpdate()` 写 `<data>/<instance>.updates/<releaseId>/request.json`（含 install/home/PATH）、把 `update-job.mjs` **复制出 `versions/current` 之外**、生成 `job.plist`（`RunAtLoad=true`、`KeepAlive=false`），然后 `launchctl bootstrap gui/<uid> <plist>`（`plugins/channel-github/src/updates.ts:104-146`）。作业 Label = `dev.yonder.github-update.<instance>.<releaseId>`。
3. 作业进程：先 `yonder version --json`、`service status --json`、`service info --json` 核对 install/home/pid/commit 边界；`defer` 时最多等 30 分钟等 `active` 归零；再执行 `yonder update --repo https://github.com/<repo>.git --to <tag> --home <home> --json`（超时 15 分钟）；最后 30 秒内轮询 `service status`/`service info`，要求 version+commit+pid 匹配且 pid 变化，写 `result.json`（`plugins/channel-github/src/update-job.ts:96-200`）。
4. `verifiedService()` 的通过条件包含 `actual.source === <install>/versions/<version>`、`service.loaded === true`、`running.ready === true`、`running.pid === service.pid`、`running.commit === origin.commit`（`update-job.ts:64-93`）。
5. `updateRelease` 自身有 `.update.lock`（持有进程存活且 <30 分钟则报 `Another update is already running (pid …)`，`index.ts:794-826`）；切换后用新版本跑 `doctor --home` 失败则不切换（`index.ts:648-783`）。
6. `yonder update --check` 走 `gh api repos/<owner>/<repo>/releases/latest`，拒绝 draft/prerelease（`index.ts:106-121`）。

注意：`docs/status.md:196` 仍把“安装器跨入口并发互斥”列为未修（“尚未补跨入口安装锁”），但代码已有 `.update.lock` —— 现状与状态页不一致，**建议核实文档是否过期**（推断：锁是后加的，文档未更新）。

### 4.2 Tauri 2 updater（目标方案，来源：https://v2.tauri.app/plugin/updater/）

- 平台支持：windows / linux / macos（页面 “Supported Platforms” 表，Rust ≥ 1.90）。
- 签名**不可关闭**：`tauri signer generate -w ~/.tauri/myapp.key` 生成密钥对；公钥写进 `tauri.conf.json` 的 `plugins.updater.pubkey`，私钥构建时经环境变量 `TAURI_SIGNING_PRIVATE_KEY`（可加 `_PASSWORD`）注入，“.env files do not work”。
- 产物：`bundle.createUpdaterArtifacts: true` 后 macOS 出 `myapp.app.tar.gz(.sig)`、Linux 出 `myapp.AppImage.tar.gz(.sig)`、Windows 出 `myapp-setup.exe`/`.msi` 及 `myapp-setup.nsis.zip(.sig)` / `myapp.msi.zip(.sig)`。
- 更新源：`plugins.updater.endpoints` 数组，支持 `https://github.com/user/repo/releases/latest/download/latest.json`；支持 `{{current_version}}`/`{{target}}`/`{{arch}}` 变量；TLS 强制。
- 静态 `latest.json` 格式：`{version, notes, pub_date, platforms: {"<os>-<arch>": {signature, url}}}`，`version` 必须是合法 SemVer（带不带 `v` 均可），`signature` 必须是 `.sig` 文件内容（“A path or URL does not work!”）；**Tauri 会先校验整份文件再比版本，任何平台条目残缺都会失败**。
- Windows 额外 `installMode`：`passive`（默认，进度条，无需交互）/`basicUi`/`quiet`。
- 前端权限：capabilities 里需 `updater:default`（含 `allow-check`/`allow-download`/`allow-install`/`allow-download-and-install`）。
- 发布自动化：`tauri-apps/tauri-action` 的 `uploadUpdaterJson` 默认 `true`，`updaterJsonPreferNsis` 默认 `false`（https://github.com/tauri-apps/tauri-action 的 README，`README.md:150-180`）。
- `latest.json` 的 `signature` 与系统代码签名是**两套独立机制**：前者防篡改，后者过 Gatekeeper/SmartScreen（`design.md:395-444` 同结论）。

### 4.3 Electron autoUpdater（备选，来源：https://www.electronjs.org/docs/latest/api/auto-updater）

- 内置 `autoUpdater` **只支持 macOS 与 Windows**（macOS 基于 Squirrel.Mac，Windows 基于 Squirrel.Windows），“There is no built-in support for auto-updater on Linux, so it is recommended to use the distribution's package manager”。
- macOS “Your application must be signed for automatic updates on macOS. This is a requirement of Squirrel.Mac.”；更新 ZIP 是流式写盘。
- 因此若走 Electron 且要覆盖 Linux，必须引入 `electron-updater`（electron-builder 生态，GitHub provider + `latest.yml`）。其文档站当前为 JS 渲染，`https://www.electron.build/auto-update` 返回 404（本次实测），细节**未核实**。

### 4.4 “后台下载 → 显示更新按钮 → 点击重启更新”

- Tauri 明确支持拆开：`const update = await check()` → `update.download(progressCb)` → 之后 `update.install()` → `relaunch()`（`@tauri-apps/plugin-process`）。官方示例注释原文：“alternatively we could also call update.download() and update.install() separately”。这正是“下载完再出按钮”的形态。
- 需要注意的语义（推断，基于文档描述）：macOS 上 `install()` 是替换 `.app`，Windows 上是运行安装器（`installMode` 决定是否弹窗），Linux AppImage 上替换自身；三者都建议 `install()` 后 `relaunch()`，所以“点击更新”= install+relaunch 一步，不能只 install 不重启（重启前进程仍是旧二进制）。
- 与现有内核链的关系：壳的 updater 更新的是**整包**（含内核，`design.md:395-444`）；内核若也要能独立 `yonder update`，两条链会同时改 `versions/current` —— 必须共用同一把 `.update.lock`（`index.ts:794-826`）并约定“壳更新后 `current` 指向新版本、`.yonder-install.json` 由壳写入”。

---

## 5. 测试矩阵

### 5.1 本机条件（实测）

```
Apple M5 / macOS 27.2 (BuildVersion 26B5091g) / arm64
docker version --format '{{.Server.Os}}/{{.Server.Arch}}' → linux/arm64 29.8.1
docker buildx ls → desktop-linux  PLATFORMS: linux/amd64 (+2), linux/arm64, linux/ppc64le, linux/s390x
```
即：**本机能跑 Linux 容器（arm64 原生 + amd64 经模拟），不能跑 Windows，不能安全跑第二份 macOS 服务**。

既有可复用的本地 e2e 脚本（都在 `scripts/`，全部 macOS-only、用临时 `/tmp` 目录、需持 `/tmp/yonder-heavy-test.lock`）：`test-service-host.mjs`(550 行)、`-registration.mjs`(322)、`-startup.mjs`(186)、`-command.mjs`(165)、`-command-gate.mjs`(185)、`-managed-group.mjs`(192)、`-owned-cleanup.mjs`(151)、`-collect.mjs`(83)、`test-helper-install.mjs`(131)。它们明确注明**不**做 launchd bootstrap/install —— 即“服务宿主内部逻辑”有覆盖，“真实安装/卸载”没有。

### 5.2 方案比较

| 方案 | 成本 | 单轮耗时 | 能验证 | 不能验证 |
|---|---|---|---|---|
| **GH Actions `ubuntu-latest` / `ubuntu-24.04-arm`** | 0（公开仓免费额度；私有仓消耗分钟） | 8–15 min（含 `npm ci`+build） | `yonder update` 装到 `versions/`、`current` 符号链接原子切换、systemd 用户单元文件内容、`service install/uninstall` 的 `systemctl --user` 调用序列、`doctor`、退出码与幂等 | GUI 安装包、签名、状态栏、Helper、真实 launchd；systemd 在 runner 上以用户会话运行需实测（**推断**可行，`systemctl --user` 需 lingering） |
| **GH Actions `windows-latest` / `windows-2025`（x64）与 `windows-11-arm`（arm64）** | 0 / 分钟 | 10–20 min | `yonder.cmd` wrapper、junction 切换与回滚、`schtasks /Create /SC ONLOGON` 参数、`service.json`、命名管道连通性（`sessions list`）、262 字符限制的真实行为 | 签名/SmartScreen、真实 MSI/NSIS 安装包（需先有）、跨账户管道拒绝（需建第二本地用户，runner 是管理员，**推断**可做但未验证） |
| **本地 Docker（linux/arm64 原生）** | 0，已有 | 3–8 min | Linux 安装/升级/回滚脚本逻辑、路径与权限、`minisign`/`sha256sum -c` 校验流程 | systemd（Docker Desktop 容器默认无 systemd，需 `--privileged` + systemd 镜像，**推断**）、任何 macOS/Windows 行为 |
| **本地 Docker `--platform linux/amd64`（模拟）** | 0，已有 buildx 支持 | 5–15 min（QEMU 慢 2–4×） | x64 路径正确性、x64 Node 二进制/依赖安装 | 性能相关断言、原生扩展；不验证服务 |
| **UTM + Windows 11 ARM 虚拟机** | Windows 授权 + ISO 下载 + 装系统（~1 h 一次性）；磁盘 40–60 GB（推断） | 冷启 1–2 min，单轮 e2e 5–10 min | **真实** `irm … \| iex`、MSI/NSIS 安装、`signtool verify`、命名管道跨账户 ACL（可建两个本地用户）、注销/登录后任务行为、SmartScreen 提示 | 与真机硬件差异（推断）、macOS 侧任何东西；UTM 在 M5 上走 Virtualization.framework（**推断**）；Windows 11 ARM 授权方式**未核实** |
| **macOS 隔离：新建测试用户** | 低（`sysadminctl -addUser`，需管理员） | 3–5 min | 真实 launchd `gui/<uid>` bootstrap、plist 写入与 bootout、状态栏登录项、Helper 安装与 CDHash 替换、卸载后无残留 | 公证/Gatekeeper（未签名构建）、干净机器首启体验 |
| **macOS 隔离：临时 `$HOME` + `YONDER_INSTALL` 前缀** | 最低 | 1–3 min | 安装/升级/回滚的文件系统效果（`os.homedir()` 在 POSIX 优先读 `$HOME`，见 https://nodejs.org/api/os.html 的 `os.homedir()` 条目） | **不能**做真实服务注册：launchd Label 固定为 `dev.yonder.harness`（`index.ts:31-32`）、`domain()` 用真实 `process.getuid()`（`index.ts:47`），同一 GUI 域内同名 Label 冲突 |
| **tart 虚拟机（macOS on Apple Silicon）** | `brew install openai/tools/tart`，镜像 ~25 GB | 冷启 30–60 s | 完整干净 macOS：一条命令安装、首启、签名+公证产物 `spctl -a -vv` / `stapler validate`、升级与卸载全链 | 需要 macOS 13.0+ 宿主（本机满足）；镜像拉取占带宽；不能测 Windows |

补充事实：`https://github.com/cirruslabs/tart` README（现重定向到 `openai/tart`）：“Tart is a virtualization toolset to build, run and manage macOS and Linux virtual machines (VMs) on Apple Silicon… uses Apple's own Virtualization.Framework”，用法 `brew install openai/tools/tart` + `tart clone ghcr.io/cirruslabs/macos-tahoe-base:latest`，要求宿主 macOS 13.0+。
UTM 有官方 Windows 11 指南：https://docs.getutm.app/guides/windows/ 。

### 5.3 GH Actions runner 事实（https://docs.github.com/en/actions/reference/runners/github-hosted-runners）

| Runner | CPU/RAM | 架构 | label |
|---|---|---|---|
| Linux | 4 / 16 GB | x64 | `ubuntu-latest`、`ubuntu-24.04`、`ubuntu-22.04`、`ubuntu-26.04` |
| Linux | 4 / 16 GB | **arm64** | `ubuntu-24.04-arm`、`ubuntu-22.04-arm`、`ubuntu-26.04-arm` |
| Windows | 4 / 16 GB | x64 | `windows-latest`、`windows-2025`、`windows-2025-vs2026`、`windows-2022` |
| Windows | 4 / 16 GB | **arm64** | `windows-11-arm`、`windows-11-vs2026-arm` |
| macOS | 4 / 14 GB | Intel | `macos-15-intel`、`macos-26-intel` |
| macOS | 3 (M1) / 7 GB | arm64 | `macos-latest`、`macos-14`、`macos-15`、`macos-26`、`xcode-27` |

同一表格在“私有仓库标准 runner”一节也列出 `windows-11-arm`，即**私有仓同样可用**；页面上没有 “public preview” 标注（本次抓取全文无 `preview` 字样）。macOS arm64 有官方提示：“All actions provided by GitHub are compatible with arm64 GitHub-hosted runners. However, community actions may not be.”

### 5.4 关键陷阱（本次核实到的，会直接让测试假绿/假红）

1. **macOS Label 固定** → 临时 `$HOME` 隔离不了 launchd（同上）。必须新建用户或上 VM。
2. **`schtasks` 任务名固定为 `Yonder Harness`**（`index.ts:375-478`）→ 同一 Windows 账号上并行跑两份安装会互相覆盖；测试需按用户隔离。
3. **命名管道名由 home 路径哈希决定**（`packages/core/src/control/index.ts:17-31`）→ 换 `YONDER_HOME` 就等于换管道，测试断言不能硬编码管道名。
4. **安装会真编译**：`npm ci` + `npm run build`（`index.ts:648-783`）→ 每个 e2e 用例 3–10 分钟，必须用“预构建 tarball/本地 `--repo`”加速（`docs/spec/09-cli-release.md:74` 支持 `update --repo <本地仓库> --to <唯一版本>`）。
5. **`.update.lock` 与一次性作业目录**在并发测试下会互相阻塞（`index.ts:794-826`、`updates.ts:104-146`）。
6. 现有 macOS 重测脚本需要持 `/tmp/yonder-heavy-test.lock` 且要 `swiftc`（`scripts/test-service-host-registration.mjs`）→ 并行度上限为 1。

---

## 6. 结论：目标命令与行为规格

### 6.1 目标命令（每平台）

**统一入口（三平台同语义，`design.md:521-540`）**

| 命令 | 行为 | 退出码 | 幂等 |
|---|---|---|---|
| `curl -fsSL https://…/install.sh \| sh`（macOS/Linux）、`irm https://…/install.ps1 \| iex`（Windows） | 检测架构 → 下载对应 tag 的预构建产物（含 Node 运行时，不再 `npm ci`）→ 解到 `<install>/versions/<v>` → 原子切 `current` → 写 `bin/yonder[.cmd]` → 提示 PATH → **询问**是否装服务（或 `--service`） | 0 / 1（失败不改现有 current） | 是（同版本直接返回 `updated:false`） |
| `yonder install [--home <dir>] [--service] [--json]` | 安装器脚本的等价实现，供 GUI/测试直接调用 | 同上 | 同上 |
| `yonder uninstall [--purge] [--keep-home] [--json]` | 默认：停服务 + 删 plist/unit/任务 + 删 `<install>`；`--purge` 追加删 home、helper、`/Library/PrivilegedHelperTools` 与 LaunchDaemon（需一次管理员授权）、PATH 提示；**默认不删 home** | 0 / 1 | 是（不存在也算成功，退出码 0） |
| `yonder migrate [--dry-run] [--json]` | 见 §3.3 的 10 点；先备份（`*.pre-migrate-<日期>`）→ 搬 home/插件目录 → 重写配置 → 重注册服务 → 打印每条操作 | 0 / 1（部分成功要留回滚点） | 是 |
| `yonder update [--to latest\|<tag>] [--check] [--json]` | 已有；建议加 `--from <本地包>` 供测试免编译 | 已有语义不变 | 已有 |
| 壳内更新 | `check()` → 后台 `download()` → UI 出“重启更新”按钮 → `install()` + `relaunch()` | — | 是 |

**每平台写入路径（规格）**

| | macOS | Linux | Windows |
|---|---|---|---|
| 代码 | `~/.yonder-harness/{versions,current,bin}` | 同左 | `%LOCALAPPDATA%\YonderHarness\{versions,current,bin}` |
| 数据 | `~/.local/share/yonder-harness/home` | `~/.local/share/yonder-harness/home` | `%LOCALAPPDATA%\YonderHarness\home` |
| 服务 | `~/Library/LaunchAgents/dev.yonder.harness{,.status}.plist` | `~/.config/systemd/user/dev.yonder.harness.service` | Task Scheduler `Yonder Harness` + `<install>\bin\yonder-service.cmd` + `service.json` |
| 特权 | `/Library/PrivilegedHelperTools/dev.yonder.harness.power` + `/Library/LaunchDaemons/dev.yonder.harness.power.plist`（仅 `awake install`） | 无（不装系统级服务） | 无（不注册 SCM） |
| 应用 | `/Applications/Yonder.app`（dmg，阶段 6） | AppImage/deb/rpm（阶段 6） | MSI/NSIS（阶段 6） |
| 更新源 | GitHub Releases `latest.json`（Tauri updater）+ `versions/`（内核链） | 同左（Linux 仅显式 update，`docs/spec/09-cli-release.md:74`） | 同左 |

硬性行为要求（建议写进 spec）：

1. 安装/卸载/迁移**任何一步失败都不破坏现有可运行状态**（沿用 `current` 先建后 rename + 失败回滚，`index.ts:700-760`）。
2. 卸载必须**列出将删除的路径**并区分“数据/凭据”与“代码”，`--purge` 才动数据；`home/.yonder/state.db` 达 GB 级，删除要有进度与可中断语义（推断：直接 `rm -r` 在普通用户机器上可能数十秒）。
3. 迁移必须拒绝并发（复用 `.update.lock`）并重注册服务（否则 launchd/systemd/schtasks 里的旧路径会让服务起不来）。
4. 自动更新必须两把锁合一：壳 updater 与 `yonder update` 不能同时改 `current`。
5. `latest.json` 三平台条目必须同时产出，否则 Tauri 校验整份文件失败（§4.2）。

### 6.2 测试流水线建议

**分层，按“能验证什么”归位，不追求一个环境测全部：**

- **L1 单元（现有 CI，macos job 保留）**：`platform-service.test.ts` 的假 `schtasks`/假 `systemctl` 断言继续覆盖参数序列；新增 `migrate` 的纯函数测试（配置重写、路径映射、幂等、`--dry-run` 输出）。
- **L2 Linux e2e（新增 GH Actions，`ubuntu-latest` + `ubuntu-24.04-arm`）**：`install.sh` → `yonder init` → `service install`（断言 `systemctl --user cat` 内容与 `enable --now` 结果）→ `update --to <下一个 tag>` → 断言 `current` 指向与 `.yonder-install.json` → `service uninstall` → 断言单元被删、home 仍在 → `uninstall --purge` → 断言 home 被删。用 `update --repo <本地裸仓库>` 避免每次编译。
- **L3 Windows e2e（新增 GH Actions，`windows-latest` x64 + `windows-11-arm` arm64）**：`install.ps1` → `init` → `service install`（断言 `schtasks /Query` 输出与 `service.json`）→ `sessions list` 走命名管道 → 建第二个本地用户，用 `runas` 断言管道被拒（`docs/spec/09-cli-release.md:96` 的验收门槛）→ `uninstall` 断言任务删除、home 保留。
- **L4 macOS 真实服务（本机隔离，**不要**动主人安装）**：优先 **新建测试用户**（`sysadminctl -addUser`）跑 `install → init → service install → update → service uninstall`；Label 冲突问题使临时 `$HOME` 方案只能测文件系统效果，不能测 launchd。若需干净机器语义（公证、首启、状态栏），用 **tart VM**（`tart clone ghcr.io/cirruslabs/macos-tahoe-base`）。
- **L5 安装包/签名（阶段 6 才有，需主人资源）**：macOS 在 GH `macos-15`/`macos-26` 上 `codesign` + `notarytool` + `stapler`，验收 `spctl -a -vv` 与 `stapler validate`；Windows 用 `windows-latest` + `signtool verify`（需代码签名证书或 Azure Trusted Signing）；Linux `minisign -V` + `sha256sum -c`。这些**都不能在本机 Docker 里做**。
- **L6 更新按钮（GUI，只能人工或 VM）**：Tauri updater 的“下载→按钮→重启”涉及真实安装包替换与进程重启，GH runner 无法断言 UI；建议在 UTM Windows 11 ARM 与 tart macOS 上各做一次人工/半自动脚本走查（截图为证），CI 只断言 `latest.json` 内容与 `.sig` 校验通过。
- **不要**指望的：Docker 里的 systemd full 行为（推断不可靠）、模拟器里的 amd64 性能断言、GH macOS runner 上的 TCC/桌面权限。

**落地顺序建议**：L2（最快见效、当前完全空缺）→ L3（`windows-11-arm` 已可用，直接对上 `docs/spec/09-cli-release.md:96` 的验收门槛）→ L4（本机新用户）→ L1 的 migrate 测试（随 `yonder migrate` 实现同步写）→ L5/L6（阶段 6，与签名资源同时到位）。

---

### 未核实 / 需主人确认

- `~/Library/LaunchAgents/dev.yonder.web-live.plist` 的来源（不属于本仓安装流程，本次未追）。
- Electron `electron-updater` 的具体配置项与 `latest.yml` 字段（官方文档站 `https://www.electron.build/auto-update` 本次返回 404，只有 Electron 内置 `autoUpdater` 文档可用）。
- GitHub macOS runner 上 `launchctl bootstrap gui/<uid>` 是否稳定可用（推断可用，未实机验证）。
- `docs/status.md:196` “尚未补跨入口安装锁”与代码 `.update.lock`（`index.ts:794-826`）的矛盾：推断文档过期，未查提交历史确认。
- Windows 11 ARM 的授权与 ISO 获取方式。