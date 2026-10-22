# Track C macOS 权限验收记录

2026-10-22；基线 `f820996`；worktree `/Users/zoran/Documents/yonder-harness-perms`；branch `yonder/mac-permissions`。本 PR **未完成完整权限能力**，只交付调研、D55 准入结论及真实可运行的隔离研究 demo。生产 home、服务、launchd 定义、用户 TCC/Settings 配置、Keychain、浏览器 profile 均未修改。

## 步骤与证据

| 步骤 | 结果 | 证据 |
|---|---|---|
| C1 候选比较 | 五个 top candidates 构建成功，安全只读 smoke 完成；完整 gate **未通过** | [研究表](../research/mac-permission-guidance.md)，固定 SHA、维护 issue、许可、规模数据 |
| C2 + D55 | 记录责任边界与两条后续选择；正式 helper/状态契约 **BLOCKED** | [D55](../decisions.md)、[spec/14 §5.1](../spec/14-execution-capabilities.md) |
| C3 | 研究 bundle 的非提示式状态与真实 API 比较通过；生产 helper/持久状态迁移 **未实现** | [研究源代码](../research/mac-permission-demo/Sources/PermissionDemo/PermissionDemo.swift)、[脚本](../../scripts/demo-permissions.sh) |
| C4 | 文档如实标明未实现；生产 native-automation 接线 **BLOCKED** | plugins / README / reference / status / CHANGELOG；未注册占位 action |

研究 app 的 `status` 是运行探针，不是拟议产品 CLI 的部分实现；不持久化、不导入生产插件、不被 `npm run build` 或发行脚本打包。`guide` 仅供主人亲自运行，固定使用上游浮窗；无自建引导 UI，无授权点击/绕过。

## 原始检查记录

本地原始日志在 `/private/tmp/yonder-r2/C/`；临时目录仅为本轮证据入口，不是长期安装路径。上游源码、全部构建、combined smoke 日志也保留在那里。

| 检查 | 结果 |
|---|---|
| PermissionFlow / AskForPermission / SwiftPermissions / PermissionsKit / Permiso 各自 `swift build -j 4` | 5 成功、0 失败 |
| 五库 combined smoke，第一次 | 构建失败：host macOS 13 与 Permiso 最低 26 冲突，`smoke.log` |
| combined smoke，第二次 | 构建失败：tools 6.1 无 `.v26`，`smoke-2.log` |
| combined smoke，第三次 | tools 6.2 / host 26 构建运行成功；5 项真实 API 比较通过（PermissionFlow 3 + SwiftPermissions 2），其余为安全子集调用；`smoke-3.log` |
| 研究 demo 首次构建 | 失败：Apple Event descriptor 非 optional 却使用 `.map`，`demo-build.log`；已按真实 SDK 类型修正 |
| 研究 demo 第二次 | 成功运行，3 项原生比较通过；`demo-status-2.json`；随后检查资源查找源码，修正资源放置到标准 Contents/Resources |
| 研究 demo 最终 `scripts/demo-permissions.sh status` | 构建 + bundle 签名 + 运行成功；**4 通过、0 失败**（三项原生比较 + 包内资源查找），`demo-status-final.json` / `demo-build-final.log` |
| shell 语法 / 无效参数 | `bash -n` 通过；无效参数退出 2，不构建/启动 UI |
| `npm ci` | 成功，0 vulnerabilities；3 个包的 install scripts 未在 allowScripts 内的原始 warning 保留在 `npm-ci.log`，未擅自 approve |
| `npm run build` | 通过，`build.log` |
| `npm run typecheck` | 通过，`typecheck.log` |
| `npm test -- --maxWorkers=4` | **246 通过 / 0 失败 / 26 跳过**；文件 **56 通过 / 13 跳过 (69)**；18.82 s，`test.log`。按公共规则等待并获取 `/tmp/yonder-heavy-test.lock`，执行后释放 |
| `npm run lint` | 退出 0；204 warnings / 1 info / 0 errors；无自动修正，`lint.log` |
| 模型测试 | **未测**：本次 gate 后无模型/插件执行改动，没有启用 `YONDER_TEST_REAL`；默认 suite 的跳过未冒充通过 |
| 生产 responsibility 查询 | `launchctl procinfo 63052` 失败：requires root privileges；没有提权 |
| ad-hoc 更新试验 | 同 identifier 的两个自有 Mach-O 得到不同 cdhash DR；仅签名身份变化证据，未进行真实 TCC grant-retention 试验 |

最终研究 app 调用方的现场值（2026-10-22T04:56:46Z）：AX=true、Screen=true、Input=true；Camera raw=0（notDetermined）、Microphone raw=3（authorized）；Notifications raw=0（notDetermined）；System Events Automation OSStatus=-600（目标未运行；未启动目标），FDA/Files & Folders=unknown。这些结果属于开发调用链中的研究进程，不是生产 node / JXA / screencapture 的权限结论。

## OWNER STEP：确切操作

1. **只读复现（不弹窗）**：

   ```sh
   cd /Users/zoran/Documents/yonder-harness-perms
   agent-network run -- scripts/demo-permissions.sh status
   ```

   应看到 JSON，`scope` 明示研究进程；`checks.passed=4`，`checks.failed=0`；出现 raw OSStatus / raw 枚举，FDA/Files & Folders 为 unknown。stderr 输出本次临时 `.app` 位置。每次脚本建立一个新研究 bundle，不安装、不与生产身份共用，不证明跨升级授权保持。

2. **查看浮窗（明确的前台操作，仅主人执行）**：

   ```sh
   cd /Users/zoran/Documents/yonder-harness-perms
   agent-network run -- scripts/demo-permissions.sh guide accessibility
   ```

   应打开对应隐私设置页，出现中文拖动卡片；PermissionFlow 的 macOS 27 文案为 Device Control and Data Access（实际本机翻译/页签须主人确认）。移动 Settings 窗口观察浮窗跟随。**本轮只确认引导 UI，不拖入、不打开权限开关**；卡片代表 `Permission Research Demo`，不是 Yonder。关闭 Settings 后在终端 Ctrl+C 结束。可按相同步骤分别运行 `guide screen-recording`、`guide input-monitoring`、`guide full-disk-access`，确认目标页与浮窗，不授权。这些 UI 未由 Agent 运行或截图。若已有可复核截图，由主人回传后再记录 UI 验收。

3. **生产责任归属的只读诊断（需要主人 sudo；本轮没有执行）**：

   ```sh
   pid=$(launchctl list | awk '$3 == "dev.yonder.harness" {print $1}')
   ps -p "$pid" -o pid=,ppid=,comm=
   sudo launchctl procinfo "$pid"
   ```

   只核实 responsible PID/coalition/代码身份；不要把包含无关进程信息或环境的完整输出发入聊天。osascript/screencapture 在真正生产调用中是短命子进程，**本 PR 没有启动它们、没有证实其 responsibility**。需要维护者批准隔离服务的诊断方案后才能覆盖三条路径；本条诊断即便成功也不直接证明 TCC 的所有归属。

4. **维护者决策**：按 D55 选择保持严格完整门槛，或允许不可判定时 unknown。若保持完整要求，需要另行安排隔离 launchd 服务、稳定 helper 签名身份、把实际受保护操作路由到同身份的设计与授权/撤销/重启/两次升级矩阵。当前没有可要求主人运行的产品 `yonder-permissions request/watch`，因此不提供虚构命令。不得在生产中先授权研究 app 来“验通”。

## 全部未完成与限制

- C1 的实际服务/子进程归属、完整状态覆盖、真实 UI 验收均未通过；PermissionFlow 被选作研究 UI 依赖，未获产品状态正确性背书。
- 未实现产品 helper、per-kind/per-responsible-process 持久状态、AI `permissions` action、status 诊断替换。未虚构 `denied` / `needs-restart` / `revoked-detected`。
- 未运行 request / guide / watch 于主人桌面；授权、拒绝、撤销、重启、稳定证书签名与自更新保留 TCC 的真人矩阵未测。原型状态迁移代码不存在，因此没有以 pure tests 代替实现或真人证据。
- 未构建/运行补充候选 Rust permission-flow / TrustMe 或整应用；没有运行候选全权限探测，未读 Mail/Messages/Safari/TCC 内容。
- 未配置 Developer ID / Apple Development、未访问私钥或创建 Keychain 项，未注册开发者账户、未合并/发版/安装。
