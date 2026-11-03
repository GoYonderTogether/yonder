
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
| `doctor` | 校验配置、插件、绑定的 `kind`、skill（03 §6）；模型链整条跑不通时逐个候选报原因；已弃用插件给出 `yonder migrate` 迁移路径（04 §2）；说明 05 §3 关于 `exec` 的限制 |
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
| `migrate [--dry-run \| --apply] [--no-service]` / `migrate --rollback <备份> [--dry-run] [--force]` | 把旧安装根和 `yonder-harness` 用户数据迁到新布局：安装根移到 `~/.local/share/yonder/install`，旧 `~/.yonder-harness` 留符号链接至少两个 minor（0.3、0.4）；运行目录移到 `~/.local/share/yonder/home` 并在旧路径留符号链接、`yonder.yaml` 与 `agents/*.yaml` 内旧插件 id/工具名改写（原文件留作 `.pre-migrate-<日期>`）、插件状态目录重命名、旧用户服务标签及 macOS power helper 的 launchd 标签改名。默认只预览。目标 home 取 `YONDER_HOME`（未设时 `~/.local/share/yonder/home`），旧目录取同一 `share` 下的 `yonder-harness/home`，自定义 home 不迁移安装根。系统服务步骤（launchd 标签与用户服务标签）只在该 home 就是当前用户默认安装路径时执行，否则默认跳过；`--no-service` 显式跳过。`--apply` 持服务同一把 home 锁（`.yonder/lock`）并在改名前再确认无服务在运行；先备份到 `<目录>.backup-<日期>/home`（含 `manifest.json`），再「临时名建链接 → 改名 → 链接就位」，日志 `.migrate-journal.json` 记录中间状态，任何一步出错自动还原，中断后重跑 `--apply` 会收尾。备份有意不含运行时 socket（`control.sock`、渠道 `*.sock`）与锁目录：它们只在运行期存在，服务启动时重建。launchd 步骤需管理员权限，与数据迁移分开报告，失败时打印剩余命令的原样文本，数据迁移不受影响。`--rollback` 同时恢复数据目录和安装根，先恢复到同级临时目录、原子换入、最后才删旧副本；要求旧路径是指向新目录的符号链接，且新目录中没有迁移完成后写入的文件，否则拒绝，`--force` 明确放弃这些数据后才继续；服务标签改名不自动回滚 |
| `completion zsh\|bash\|fish` | 输出 shell 补全脚本；无 home 也可输出静态脚本；不修改用户 shell 配置（12 §5.3） |

除上述命令（含 `migrate`）、14 §4 的 agents/presets 管理及 13 §2 的 plugins list/show/add/remove、skills show/add/remove、models list、inspect 外，不增加其他命令。sessions submit 同时支持 13 §1.4 的可重复 --attachment <本地路径>。这些命令的精确参数与语义见 13，不在此复制第二份。

`chat` 默认进入独立新任务；进入常驻渠道需显式 `--channel <实例>`，不会暗中把 main 历史搬进任务会话。补全命令与 help/version 等一样不要求 home；动态候选仅在能解析 home 时读取。

## 3. 安装布局

```
<install>/                    默认 ~/.local/share/yonder/install，可用 YONDER_INSTALL 改
  versions/<version>/         某个审核 tag 的构建安装，已 npm ci && npm run build，无 .git
  current -> versions/<version>   Unix 符号链接；Windows 目录 junction
  bin/yonder                  Unix shell wrapper
  bin/yonder.cmd              Windows cmd wrapper；均用安装时 node 绝对路径运行 current 里的 CLI
```

- 安装目录放代码，home 放数据，两者分开；一个安装可以服务多个 home。
- 首次安装：在任意一份已构建的源码里运行 `node packages/cli/dist/index.js update --to <tag|latest>`，它创建安装目录；然后把 `<install>/bin` 加进 `PATH`。
- wrapper 将安装 bin、安装时 node 所在目录加到 PATH 前面；保留安装时的 PATH 供后台进程使用，使本机 agent 能运行 yonder、node、npm、git。凭据不写入 wrapper 或服务环境。
- 每版保留不含秘密的安装来源（仓库、tag、commit、版本）；version 查询安装来源。维护源码、安装程序、运行 home 分离，正式运行不引用开发包。

### 3.1 首次安装脚本

- 两条固定地址随每个正式 Release 发布，内容是该 tag 里的 `scripts/install.sh` / `scripts/install.ps1`：
  - `https://github.com/GoYonderTogether/yonder/releases/latest/download/install.sh`（macOS/Linux）
  - `https://github.com/GoYonderTogether/yonder/releases/latest/download/install.ps1`（Windows）
- 默认只安装核心：CLI、内核与服务。交互方式可以是微信/QQ 等渠道、云端连接或 CLI/TUI。
- `--desktop`（Windows：`-Desktop`）：核心安装完成后再安装桌面应用——macOS 取 dmg 装到 `/Applications/Yonder.app`，Windows 静默运行 nsis `setup.exe`。桌面应用依赖本机核心先安装，但可以在核心服务停止时单独运行，此时回落到云端站点（§6.2）。关掉桌面窗口即退出桌面应用，本机核心服务与状态栏继续运行，等于回到只装核心。
- 脚本只做四件事（带 `--desktop` 时核心装完后再装桌面应用，见上条）：检查 node（≥22.19）/npm/git；用 `git ls-remote --tags --refs` 取最高**正式**标签（不带 `-beta`，`YONDER_VERSION` 可显式指定）；`git clone --depth 1 --branch <tag>` 后 `npm ci && npm run build` 放进 `<install>/versions/<version>`，校验包版本与标签一致并写 `.yonder-install.json`（字段与 §4 的安装记录相同，`rm -rf .git`）；最后用这份已构建的 CLI 跑 `yonder update --to <version> --repo <repo>`。
- 收尾交给 `update`，不在 shell 里重写 wrapper、`current` 切换与保留最近三版的逻辑；重复执行幂等，已存在的版本目录不再构建。
- 数据目录的 `yonder.yaml` 不存在时才执行 `yonder init --model openai/gpt-6-luna`；存在则一律不改。登录模型供应商与 `service install` 不代劳，脚本只打印下一步。
- `--dry-run` 只解析版本并打印将要执行的步骤，不下载、不写盘。
- 只取正式标签，禁止从开发分支或未审核提交安装。

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

- **版本号**：`0.<minor>.<YYMMDDNN>`，YYMMDD 是两位年份的发布日期，NN 是当天递增序号；本次切换至 `0.3.26102801`，根与所有 workspace 包版本一致，`packages/pi-durable` 保留其上游版本。**正式版**是无后缀版本，对应 GitHub 正式 Release；**测试版**加 `-beta.N` 后缀（如 `0.3.26102801-beta.1`），对应 GitHub 预发布（prerelease）。同一 X.Y.Z 下测试版先于正式版（semver）。自动更新、`update --check`、`update --to latest` 与发布监听只认正式版；安装测试版需显式 `update --to beta` 或指定标签。版本方案变更时递增 minor，保证次序单调。
- 每次变更把对外可见的变化记在根目录 `CHANGELOG.md` 顶部的 `## [Unreleased]`（小节用 Added / Changed / Fixed / Removed）。发布时统一所有包版本与 CHANGELOG，打标签 vx.y.z 并推送，使用 gh 创建该标签的正式 GitHub Release；本地阶段标签不推送，也不等于 Release。发布 watcher 接实际 Release 对象，不把标签当发布通知（10 §3）。
- `yonder changelog --from a --to b`：输出 `CHANGELOG.md`（当前版本里的）中版本在 (a, b] 之间的各节；`--to` 缺省为当前版本，`--from` 缺省为 `--to` 的上一个版本。

### 5.1 CI 发版

正式版只由 `.github/workflows/release.yml` 发布，不在本机手工改版本、打标签或建 Release。

- **自动触发**：main 的 push 所触发的正式 `CI` 成功后，由 `Auto release` 复核同仓库、工作流身份、事件来源、main 当前 SHA 与本次 CI 的 head SHA，拒绝 fork、PR、失败、标签复验和过时提交。已正式发布的提交直接跳过；其余只派发唯一的 `release.yml`，不自行改版本、标签或 Release。
- **手动触发**：任何有仓库写权限的人都能在 Actions 页面运行，或用 `gh workflow run release.yml -R GoYonderTogether/yonder -f ref=main`；可选 `-f version=<版本>`，须高于已有最高标签。`require_ci` 默认 true；维护者明确给 false 时仅手动路径允许关闭，自动路径始终开启。
- **前提**：`ref` 必须是 main 的历史，随后只快进到 main 当前 tip。自动请求携带可选 `expected_sha`（完整 40 位提交 SHA）；对齐时 main 不再等于该 SHA 就停止，不把旧 CI 的结果用于新提交。提供 `expected_sha` 时强制 CI 门禁，即便 `require_ci=false` 也不可绕过。`version.mjs --assert-unreleased` 继续拒绝已带正式标签或已作为发版提交父提交的来源。
- **CI 门禁**：`ci-status.mjs` 经 `gh api` 查询目标提交的 check-runs，要求 macOS、Linux、Windows x64 与 ARM64 四个必需汇总检查均以 success 完成，同名只看最新一次。缺失或运行中最多等 15 分钟，失败、取消、neutral、skipped 都不放行；macOS 不再 continue-on-error。构建期间 main 若前进，仍由既有原子推送拒绝发布。
- **版本**：未给版本时取 UTC 当天 YYMMDD，NN 在已有同日标签上加一。
- **改动**：`scripts/release/bump-versions.mjs` 把根与所有 workspace 包（`packages/pi-durable` 除外）的版本和内部 `@yonder/*` 依赖改成新版本，并以 `npm install --package-lock-only` 更新 lockfile。`scripts/release/changelog.mjs` 把 `## [Unreleased]` 的手写条目连同上一标签到目标提交之间的 feat/fix/perf/refactor/revert 提交（按 Added/Fixed/Changed/Removed 分组）写成新版本小节；其他类型与无前缀提交不列。
- **提交与标签**：CI 提交 `chore(release): <版本>`，打 `v<版本>`，`version-check.mjs --tag` 核对后构建、打包，再以 `git push --atomic` 把 tag 与 main 一次推上去。因为发版提交直接落在 main tip 上，这次推送必然快进，不需要 rebase；原子推送保证 tag 与 main 要么都在、要么都不在，重跑发版即可，不会出现只有 tag 没有 main 的状态。
- **Release**：在 tag 与 main 都推送成功之后才创建，并且先建成草稿、核对附件齐全再公开（`--draft` → 核对 → `--draft=false --latest`）。草稿阶段失败时 tag 与 main 已在远端，不会出现孤儿版本；报出后按提示补建即可，不要重新触发发版。正文是 CHANGELOG 的该版本小节；附件是 `scripts/release/pack-runtime.mjs` 对每个非 private workspace 包 `npm pack` 生成的 `.tgz`、`SHA256SUMS` 与两个安装脚本，数量与可打包包数 + 3 不符就不公开。`yonder update` 与首次安装按 §3/§4 从标签 `git clone` 并本机构建，不读取附件；附件供离线核对与按包安装。
- **发版后的分发构建**：Release 公开后，`release.yml` 以发版 tag 派发 `android-release.yml`、`ios-release.yml` 与 `desktop-release.yml`（载荷为 version 与完整提交 SHA）。派发失败只记警告与步骤摘要（`packages=pending:<工作流>`），不回滚已公开的版本，也不重新发版；按提示在 tag 上对这些工作流手动 `workflow_dispatch` 补跑。构建完成前 Release 正文与附件里没有 apk/ipa/dmg/nsis，这是允许的中间状态。见 §6.3–§6.5。
- **发版后的 CI**：GITHUB_TOKEN 推送的提交不会触发 `push` 事件，所以发版提交与 tag 本身从不产生 CI 运行。公开 Release 后，工作流用 `gh workflow run ci.yml --ref v<版本>` 以 tag 为 ref 派发一次（`ci.yml` 因此声明 `workflow_dispatch`），让 CI 跑在发布的那个提交上。该次运行失败不回滚已发布的版本，按缺陷修好后发下一版。
- **本机预演**：上述脚本都支持 `--dry-run`，只打印将改的文件、CHANGELOG 小节或打包清单，不写入。
- **网站部署**：私有仓 `GoYonderTogether/yonder-cloud` 的 `Deploy web` 从公开正式 Release 协调工作台前端到 `yonderbot.net`。已配置跨仓派发凭据时，`release.yml` 公开 Release 后以 `repository_dispatch`（`deploy-web`，载荷只有 tag 与提交 SHA，不含产物）通知；没有凭据时不回退本仓 GITHUB_TOKEN 发起必然无权的请求，明确记录网页仍待协调。Cloud 沿既有定时拉取公开 latest Release/tag SHA 的路径及手工 workflow_dispatch 收敛，不新增凭据或工作流。定时配置不是执行延迟保证，Release公开、部署派发、服务器部署验收分别记状态。对方按 SHA 从本公开仓取源码，跑本仓的 `build:web` 生产构建与真实 API 守卫，打包后经服务器上的受限执行器 `/opt/yonder-card/bin/yonder-web-deploy` 上传：执行器由 `authorized_keys` 的 `command=` 固定，只接受「版本 + tar SHA256 + tar 流」，解包到新的 `web/releases/<版本>-<提交前 12 位>`，原子切换 `web/current` 与 `web/previous`，保留最近 5 个版本；不重启服务、不改 nginx、不碰后端与数据库。执行器在服务器本地核对线上 `build-version.json` 后才返回成功——托管 runner 在境外直连该站会被 TLS reset（实测），因此公网可用性不能由 runner 探测。线上版本与目标一致时（含定时巡检）跳过上传。网站与后端是两条链：本步骤只换静态前端，后端与迁移仍由 `yonder-cloud` 自己的流程发布。

## 6. 后台服务

- macOS `service install`：写 `~/Library/LaunchAgents/dev.yonder.service.plist`——`ProgramArguments = [<install>/bin/yonder, start, --home, <home>]`、`RunAtLoad`、`KeepAlive`、标准输出与错误写 `<home>/.yonder/logs/harness.log`——再 `launchctl bootstrap gui/<uid>`。一台机器一个服务，对应一个 home。
- `start`：已加载用 `launchctl kickstart`，未加载但 plist 存在用 `bootstrap`；`stop` 用 `bootout`，保留 plist；`restart` 对已加载服务用 `kickstart -k`，未加载时用 `bootstrap`；`status` 用 `print`；`uninstall` 卸载已加载服务后删除 plist。
- 未迁移的机器上仍可能是旧标签 `dev.yonder.harness` / `dev.yonder.harness.service`（状态栏 `dev.yonder.harness.status`）：`status`/`start`/`stop`/`restart`/`uninstall` 先按新标签、再按旧标签识别本机实际安装或已加载的那个，`status` 输出所用标签；`install` 仍只写新标签，接管成功后删除旧标签文件；旧→新迁移仍由 `yonder migrate` 完成。
- plist 的 EnvironmentVariables 仅保存 PATH、YONDER_INSTALL、YONDER_HOME；PATH 含安装 bin、安装时 node 所在目录及安装时 PATH。服务验证必须包含 stop → start，以及从后台 agent 调用 yonder docs、node、npm、git。
- 进程异常退出由 launchd 拉起；运行恢复按 07 §3.1 接好输入/结束关联后启用 pi 调度，重新打开文件不代表完成恢复。
- Linux 使用 systemd **用户**单元 `dev.yonder.service`，放在 `$XDG_CONFIG_HOME/systemd/user`（缺省 `~/.config/systemd/user`）。`service install` 写单元并 `daemon-reload`、`enable --now`；start/stop/restart/status/uninstall 对该用户单元操作。ExecStart 使用已安装 wrapper、固定 home；日志由 journald 保管。无需 root，不安装系统级服务。
- Windows 使用当前用户的 Task Scheduler 登录任务 `Yonder Harness` 作为后台入口；不注册需要管理员权限的 SCM 服务。`service install` 在 `<install>/bin` 保存只含 home/install/node 路径的启动脚本，并在 `%LOCALAPPDATA%\\YonderHarness` 保存注册记录；start/stop/restart/status/uninstall 使用 `schtasks`，卸载保留 home 与版本。任务在当前用户会话启动，不承诺注销后运行或崩溃后自动重启。Windows 控制面与 CLI 渠道使用本机命名管道，管道名由规范化 home 路径摘要决定，不暴露 TCP 端口。
- Windows 管道当前显式关闭 Node 的 `readableAll`/`writableAll`，但跨账户隔离尚无实机证明。验收门槛：Windows ARM64 上同一普通用户可连控制面和 CLI 渠道，另一独立普通用户对两条管道均被拒绝，且任务重启后仍成立；若默认 DACL 不满足，需在创建管道时将 DACL 限定为安装用户 SID（及系统必需主体）并在无法施加时拒绝启动，或增加绑定仅该用户可读本地凭据的认证。未完成前不得将 Windows 本机控制面标为多用户安全通过。
- Linux/Windows 的 full 首版是 CLI/TUI 与内核；macOS Helper、屏幕/电源辅助能力仅在 macOS 启用。macOS 与 Windows 有状态栏（§6.1），Linux 不做状态栏。实际安装、启动、Agent 创建、控制、重启连接、卸载按 OS 与架构单独验收，构建成功不等于运行通过。

### 6.1 macOS 与 Windows 状态栏

macOS 复用 §3–§4 的 git 标签→本机构建→版本目录→current→独立 home→launchd 安装链；Windows 复用同一套安装版本目录，托盘随 §6 的登录任务自启。macOS/Linux 默认安装目录 `~/.local/share/yonder/install`、数据目录 `~/.local/share/yonder/home`，Windows 为 `%LOCALAPPDATA%\\YonderHarness\\install` 与 `home`；不从开发仓库运行日用服务，不复制其他应用 OAuth。

macOS 状态栏用原生 Swift/AppKit NSStatusItem、LSUIElement，一个 home 只有一个状态栏宿主，无 Dock 图标或客户端框架。左右键均打开同一原生管理菜单，不因点击状态栏展开交互窗口。菜单是固定骨架，启动后不按动态数据增删菜单项：首行只显示真实服务状态与当前运行数、等你数（“服务运行中 · 运行 2 · 等你 1”，空闲为“服务运行中 · 空闲”，读取失败为“服务未就绪 · 状态未知”）；随后是保持唤醒（关闭 / 任务期间保持唤醒 / 始终保持唤醒，附真实保护状态与缓冲剩余）、检查更新、停止服务并退出。菜单不列 Agent、会话、任务摘要或回复片段，不承载交互卡片窗口；动态文字单行截断，完整原因放 tooltip。打开菜单时读取权威状态；后台查询不抢焦点。图标以活动标记区分运行与空闲。检查更新只查询当前批准仓库实际最新正式 Release 并显示当前/可用版本和失败，不自动安装，不发消息。退出停止既有 harness launchd 服务，再退出图标；保留服务定义、版本与数据，下一次登录仍自启。若停止失败，显示实际错误并保留图标。

服务使用 dev.yonder.service；图标采用一个用户 launchd 登录项 dev.yonder.status，RunAtLoad=true、KeepAlive=false，避免用户退出后被重拉。状态栏不承载交互窗口；交互卡片只在网页控制台以插件视图呈现。不增加第二套常驻管理器、自动更新机制、设置页、安装平台或特权助手。

Windows 状态栏是一个常驻托盘 `Yonder Status`，用户级登录自启，菜单是同一套固定骨架：服务状态、检查更新、停止服务并退出；不承载交互窗口。它由 `service install` 注册、`service uninstall` 移除。Linux 明确不做状态栏。状态栏只读本机控制面，读取失败显示未知，不以图标等价于服务运行。

状态栏源码位于 packages/macos/，使用系统 swiftc；构建/安装接入既有发行流程。安装版保存构建后的 .app；程序调用安装 bin/yonder 固定 argv，不拼 shell，不读凭据。状态/更新检查需要相应真实结果，不以图标显示等价于服务运行。macOS 状态栏操作和屏幕预览需要真实运行证据。

只读命令 `yonder service info --home <home> --json` 返回实际服务进程的 version/commit/home/pid/ready/active/agents；agents 按已注册且未归档的 Agent 聚合原生运行、待执行输入和后台任务。仅读本机控制面，不暴露思考、工具参数或工具输出，不建立第二份任务状态；状态栏订阅网关 `activity.watch` 只取运行数与等你数，读取失败显示未知。控制面未就绪时失败，不回退磁盘版本。`yonder update --check --json` 经本机既有 gh 登录态查询仓库最新正式 GitHub Release，返回 current/latest/updateAvailable/url，缺 gh、登录或正式发布时显示实际失败。不会安装或改配置。

桌面交互入口默认就绪：init 将 interaction 加入全局插件列表；CLI start 对旧 home 复用 plugins 管理入口，按实际插件 id 检查并仅在缺失时补入官方包。已有自定义来源与旧配置保留，不改任何 Agent/预设的 plugins、tools 或权限。交互卡片经控制面视图 `interaction.card` 在网页控制台呈现与回答；插件不提供独立 HTTP 服务、回环页面或桌面窗口，旧 `desktop` 配置键只为旧 home 保留读取兼容、不产生行为。UI 状态不复制到内核；业务工具/队列/历史仍由 interaction 插件负责。状态栏进程使用当前 home 的文件锁阻止重复启动；不依赖 Web 内容保证单实例。

### 6.2 桌面客户端

桌面客户端是独立的 Tauri 窗口壳。启动时先探测本机核心：经已安装的 `yonder ui --json` 取本机网关地址，短超时探测可达性。可达则本机直连控制面，不绕云端；不可达则加载与线上完全相同的站点 `https://yonderbot.net/`。两种情况都是同一份前端产物、同一路由、同一数据来源；不注入客户端壳标记，不改写路径，不打包本机运行时，也不另外设计界面或布局。窗口内导航白名单为本机回环地址与 yonderbot.net，其他外链交系统浏览器。窗口关闭即退出。

桌面应用依赖本机核心先安装（§3.1），但可以在核心服务停止时单独运行，此时回落到云端站点；本机 Yonder 的控制在云端路径下仍沿用设备绑定（[19](19-device-workbench.md)），网页经云端 `/ws/work` 转发。壳不读凭据、不提供托盘、菜单或第二条系统通知路径；系统通知仍由状态栏进程发出。UI 入口允许三种来源——应用内置、云端站点、用户本地打包——但都读同一数据面。构建目标是 macOS、Windows 与 Linux，实际运行验收按平台分别记录；壳的签名、公证与分发见 §6.4。

### 6.3 安卓分发与更新

- CI 由 `android-release.yml` 在正式 Release 发布后构建签名 APK，上传 GitHub Release 资产 `yonder-android.apk`，并上传 OSS `https://yonder-release.oss-cn-hangzhou.aliyuncs.com/android/yonder-<version>.apk` 与清单 `.../android/latest.json`（字段：version、versionCode、url、sha256、size、publishedAt）。清单的 `url` 指向同一 Release 的 GitHub 资产：阿里云不允许经 OSS 默认域名对外分发 APK（`ApkDownloadForbidden`，需绑定 CNAME），OSS 上的 APK 保留给已绑定域名的镜像；修正已发布清单时只允许同 versionCode、同摘要的覆盖。
- App 内更新：拉 `latest.json` 比较 versionCode，下载后校验 sha256，再交 Android 系统安装器。系统确认框必须由用户点击，不声称静默安装；安装完成后系统重启应用。

### 6.4 桌面安装包分发

由 `desktop-release.yml` 在正式 Release 后构建 macOS dmg、Windows nsis，上传同一 GitHub Release 与 OSS `desktop/<version>/`。macOS 在没有 Developer ID 时 ad-hoc 签名，Gatekeeper 需右键打开；Windows 未签名，出现 SmartScreen 警告。签名与公证另立验收。

发布产物统一放在对象存储 bucket `yonder-release`（阿里云 OSS，cn-hangzhou，public-read），只放发布产物。凭据经 CI secrets `ALIBABA_CLOUD_ACCESS_KEY_ID` / `ALIBABA_CLOUD_ACCESS_KEY_SECRET` 提供，不进仓库。安卓签名 secrets 为 `ANDROID_KEYSTORE_BASE64`、`ANDROID_KEYSTORE_PASSWORD`、`ANDROID_KEY_ALIAS`（workflow 还原到临时目录后以 `--keystore` / `--alias` 与 `YONDER_ANDROID_KEYSTORE_PASSWORD` 交给 `apps/desktop/prepare-android.mjs`，构建后删除 keystore；本地构建可直接用脚本的同名环境变量 `YONDER_ANDROID_KEYSTORE` / `YONDER_ANDROID_KEYSTORE_PASSWORD`）。

发布相关操作可以经本机阿里云 CLI（3.5.2）直接对 bucket 执行；bot 使用同一 CLI 与 agent-vault 中登记的凭据，凭据不进仓库、不进文档。

### 6.5 iOS 与 TestFlight

由 `ios-release.yml` 在正式 Release 后从 secrets 还原 Apple Distribution 证书与 App Store 分发 profile，`tauri ios build --archive-only` 归档，再用带 `provisioningProfiles` 映射的 ExportOptions 执行 `xcodebuild -exportArchive` 导出 IPA（Tauri 自带的导出步骤不带这个映射，实测报 `exportArchive requires a provisioning profile`）。IPA 经 App Store Connect API Key 用 `altool --upload-app` 上传 TestFlight，并作为附件追加到同一 Release。

`apps/desktop/prepare-ios.mjs` 负责重放 `tauri ios init` 之后被覆盖的设置：团队、手动签名、profile 名，以及把 `iPhone Developer` 改成 `iPhone Distribution`。App 图标必须是 1024 无 alpha（上传报 90717），由 `scripts/flatten-icon.swift` 铺白底后重出整套尺寸。签名 secrets 为 `IOS_DISTRIBUTION_CERT_P12_BASE64`、`IOS_DISTRIBUTION_CERT_PASSWORD`、`IOS_PROVISIONING_PROFILE_BASE64`、`IOS_TEAM_ID`；上传用 `ASC_API_KEY_ID`、`ASC_API_ISSUER_ID`、`ASC_API_PRIVATE_KEY_BASE64`。

## 7. 统一诊断

start输出沿用单一日志入口，增加ISO时间；插件api.log沿用plugin标签和实例/阶段字段。后台服务以--json写JSONL，仍写home/.yonder/logs/harness.log，可用系统tail查看/追踪，不新增日志服务或额外命令。CLI/TUI斜杠清单与飞书共用SDK常量；文本渠道实现11及12定义的共享命令子集。

## 8. 全局日用入口与开发边界

裸yonder在TTY中优先进入名为cli的CLI渠道，否则首个实际CLI渠道；无CLI渠道才保留新任务入口。显式yonder chat保持独立任务，--channel/--preset/--session保持原含义。进入CLI渠道即可只读装入该渠道已声明main绑定的agent的现有main历史并观察更新，不必先发一条消息；发送仍经原渠道绑定，禁止直接向常驻session.submit绕过绑定。没有主会话时首次输入正常创建，不伪造历史。

默认home从唯一已安装服务读取，保持--home/YONDER_HOME和当前明确home优先；不依赖开发仓库或shell额外环境变量。未初始化时裸入口说明yonder init、login openai、service install，不偷偷启动第二进程。新用户按README从官方仓库安装，之后用同一update/current/版本目录机制更新回滚。正式安装不保留.git、不以开发目录运行，测试开发显式指定隔离home；不添加第二套服务管理或更新器。

## 9. 统一更新结果及内部通知

updateRelease 是 CLI 与插件独立作业共用的安装入口，实际尝试产生 01 定义的 release.update-result；不能只对 GitHub 自动升级写完成事实。完成核验服务版本/来源提交/home/pid/ready，不用模型确认。无服务可核验或仍待重启时不能报告 verified。同一安装同时只允许一个 `updateRelease`（安装目录下 `.update.lock`，持有进程存活且不足 30 分钟则后来者直接报错，不记录失败结果、不争用临时目录）；自动升级的独立作业在运行中有活动工作时先等待，最多 30 分钟，主人或 Agent 明确要求的升级不等待。给主人的通知只在终态发送：核验通过写“已更新并核验”，失败写简短原因，不含回执号。更新错误保留错误和事实，不能为了记录失败吞掉原失败。结果记录失败与更新失败分开返回/报告，不重做已完成的安装。服务重启后控制接口尚未就绪而主目录锁仍新鲜（120 秒内被刷新）时，记录结果等待服务而不是接管该锁：启动中的内核事件循环可能被占用超过锁的 10 秒默认过期时间，被接管的锁会使其以 ECOMPROMISED 崩溃（0.2.26102104 升级实测）；超过等待上限仍无服务则报告记录失败。

核验失败必须在回执 error 里写明是哪个事实不匹配（服务版本、来源提交、home、pid、ready，launchd 记录的 pid/install/home，安装记录 tag/commit/repository，`install/current` 指向），并附服务日志尾部（含密钥字样时整段省略）；不能只写「服务未就绪」。`verifyRelease` 是失败后的重试入口：不重装、不改 `current`，只对运行中的服务重做一次核验并新记一条 release.update-result，version/tag/commit 取实际安装记录的；重试失败仍照实记录，不把重试当作新代码已生效的证据。
新增 `sessions notify <id> --event <事件id> --text <正文>`，仅提交 system:cli 来源的程序通知；不接受 from，不启动模型。复用现有控制面及 JSON/退出码规范，目标/原事件不合法则拒绝，持久记录和实际展示分别确认。

## 渠道接入命令

`yonder channels list` 列出当前服务的渠道和是否支持扫码登录；`yonder channels login [instance] [--poll] [--verify-code <code>] [--open]` 调用当前服务的渠道登录，不启动第二个内核、不复制凭据。未带验证码时默认返回可扫码链接；`--verify-code` 接受 1–12 位纯数字并以 poll action 传给渠道。card 将其中十位数字解释为兑换网页主人发起的一次性邀请码，成功直接连接，无需第二次确认（16 §1）。--open 在当前本机显式打开 HTTPS 链接；--json 保持机器可读。服务未运行时（`control.sock` 不存在）`channels login` 直接报「服务未启动，先运行 yonder start」，不打印裸 ENOENT。CLI 管理面仍只对本机用户开放。渠道聊天中的 `/connect [instance]` 只允许 admin+network 来源，返回同一安全链接和状态，不调用模型。

## 任务期间保持唤醒（macOS）

主服务按原生运行、待执行输入和后台工作查询活跃数量；现有状态栏提供唯一的“任务期间保持唤醒”开关与真实状态，不新增图标。设置存于 home/.yonder/awake.json，默认关闭，首次明确启用安装限定电源能力的 root helper 并由系统请求授权；成功后保持选择。显示器允许休眠。

服务每秒续租；root helper 仅接受安装用户的本机 Unix socket，聚合所有连接的任务保护。需要时用 IOKit 防空闲睡眠并临时设置 SleepDisabled，最后一份租约断开、超过 5 秒未续租或任务结束时恢复自身改动；原本已禁用睡眠时不擅自关闭。root helper 持有恢复记录，重启时先恢复。服务/状态栏退出不遗留租约；菜单收起不释放任务保护。无授权与失败显示真实状态，不能标记已保护。

CLI awake status/set/install 提供状态、布尔策略开关和用户主动授权入口；后台启动不弹授权。活动计数不唤醒模型，不复制会话存储。单纯历史会话和未来定时任务不计；等待 interaction_result 且没有其他实际执行的状态不计。MacToolkit 电源功能移除后交由 Yonder 单独管理。合盖、电池供电、服务崩溃恢复均需分开验证；不能把编译或热点连接当成物理合盖验收。

电源组件协议带版本；升级后旧组件不标记为已保护，原菜单项提供更新操作并复用系统授权，不后台弹窗。持久 socket 每次调用须回收子进程/管道资源；构建自检重复真实 pmset 读取，无句柄增长。

### 唤醒模式与任务结束缓冲

现有菜单的“保持唤醒”子菜单提供互斥的关闭、任务期间保持唤醒、始终保持唤醒。沿用已安装电源组件，不增加图标。CLI awake set 接受 off/tasks/always，旧 on 等价 tasks，旧 enabled 布尔配置兼容读取。模式选择保存到同一 home，已有关闭选择保留；首次启用 always 提示额外耗电与合盖散热，用户确认后保存提示已读。

任务模式在观察到最后一项真实任务结束时开始至少 15 分钟缓冲，期间新任务重置缓冲，等新任务全部结束后重新计 15 分钟。缓冲结束前最后再查询一次运行状态；始终模式不因空闲释放，关闭模式立即释放。状态显示真实保护结果、模式和缓冲剩余分钟；不能以 active=0 判定缓冲期不需要保护。等待未来定时任务不单独持有保护，已配置定时任务进入实际运行后沿相同机制重计缓冲。服务退出仍释放自身保护，重启不会凭空补出历史缓冲。唤醒与网络重连是不同能力，不承诺已睡主机能被普通 cron 或消息唤醒，也不承诺手机热点永不断连。

创建接口：`initHome(home, owner?, options?: { isolated?: boolean })`；`agents create --file` 的创建输入可含 isolated，不新增该命令旗标，也不持久化到 Agent 配置。
