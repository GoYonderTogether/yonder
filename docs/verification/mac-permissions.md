# Track C phase 2 macOS 权限验收

2026-10-22；基线 `f820996`；worktree `/Users/zoran/Documents/yonder-harness-perms`；branch `yonder/mac-permissions`；[PR #17](https://github.com/GoYonderTogether/yonder-harness/pull/17)，待审核、不合并。

Phase 2 已按维护者批准的 unknown 语义实现 helper/状态/CLI/插件接线。**真人授权、浮窗、键鼠和升级 grant-retention 未测。** 生产 home、服务、launchd、用户 TCC/Settings、浏览器 profile 均未修改。仅在任务允许的稳定 helper 目录安装自有签名 app、CLI 与状态文件；没有执行 request/guide/watch，没有点击 Allow、读 TCC.db 或运行 tccutil。

| 步骤 | 结果 | 证据 |
|---|---|---|
| 复用与 D55 | 保留五候选真实比较，解除完整观测 gate，明确 unknown/unobservable/请求历史 | [调研表](../research/mac-permission-guidance.md)、[D55](../decisions.md)、[spec/14 §5.1](../spec/14-execution-capabilities.md) |
| helper | SwiftPM，单一 dev.yonder.harness.helper；Apple Development 签名通过 | [Swift 源码](../../packages/macos-helper/Sources/YonderHelper/YonderHelper.swift)、[构建](../../scripts/build-permissions.mjs)、codesign verify strict |
| 身份与持久化 | LaunchServices 后台启动，实际执行代码自行探测；外置状态/锁、hash 变化才重装 | [CLI/launcher](../../scripts/yonder-permissions.mjs)、实机 JSON、unchanged-hash mtime 断言 |
| 桌面路由 | screenshot/click/move/drag/type/key/snapshot 在 helper 内 CG/AX 执行，删除 JXA/screencapture 路径 | [desktop](../../plugins/native-automation/src/desktop.ts)、[插件](../../plugins/native-automation/src/index.ts) |
| AI permissions | 9 类状态、raw、时间、bundle/path/codeHash/DR、中文下一步；不提供 request action | [实机检查](../../plugins/native-automation/test/permissions.mjs) |
| 人用 CLI/UI | request 调原生请求，guide 使用 pinned PermissionFlow，自动 AX 提示关闭；watch 最长 120 秒只读观察 | 实现/构建通过；交互仅 OWNER STEP，本轮未运行 |

稳定安装目录：`~/.local/share/yonder-harness/helper/`。`Yonder Helper.app`、`yonder-permissions`、`permissions-state.json`、`permissions.lock` 同级，状态不放在 app 内或生产 home 内。每次新 harness 调用 launcher 比较源/已装 CDHash，仅变化时校验签名并替换 app；已有状态保留。首次调用会安装 helper 并记录观测，“只读”指不发起权限请求或改变系统授权。原研究 demo 由此替代，原始实现保留在 commit `313fa60`。

本机发现 1 个有效 Apple Development 身份（zoran zeng，Z4A92U2M2T），实际签名无提示完成。默认 DR 包含 identifier、Apple anchor 和证书名称约束，跨本轮重编译保持一致；cdhash 随代码变化。CI/其他机器无证书时 ad-hoc，构建会明确提示更新后可能需要重新授权；不承诺所有机器或证书轮换后 grant retention。`YONDER_HELPER_SIGN_IDENTITY` 可显式指定分发身份，本轮没有创建证书、Keychain 项或开发者账户。

## 实际探针与状态

新 helper 独立 LaunchServices 启动，PPID=1；AX/Screen/Input 均 false，而 phase 1 终端研究进程曾为 true。这里记录 helper 本身的 API 证据，不把 PPID 当成系统 TCC responsibility 审计证明，也不把未授权的检查当作真实操作成功。

| kind | 实机 state | raw / 范围 |
|---|---|---|
| accessibility | not-granted | AXIsProcessTrusted=false |
| screen-recording | not-granted | CGPreflightScreenCaptureAccess=false |
| input-monitoring | not-granted | CGPreflightListenEventAccess=false；发事件不要求此项 |
| camera / microphone | not-granted | AVCaptureDevice.authorizationStatus=0 / 0 |
| notifications | not-granted | UNNotificationSettings.authorizationStatus=0 |
| automation | unknown | OSStatus=-600，com.apple.systemevents 目标未运行；未为 status 启动它 |
| full-disk-access / files-and-folders | unobservable | 不探测 Mail/Messages/Safari/TCC/主人受保护资源 |

每项均含 `lastCheckedAt`、`lastRequestedAt`（本轮为 null）、`responsibleIdentity`（bundleID/path/codeHash/designatedRequirement）、raw/nextStep。false 不推断 denied；requested 表示历史请求，不表示 OS pending。revoked-detected 为同身份曾 granted 后的新 false 证据；needs-restart 为旧 grant 与代码身份变化的警示，重启不保证修复。状态迁移的显式记录只在自检内使用，不写假 OS 状态到持久文件。

## 检查与全部失败

原始日志目录 `/private/tmp/yonder-r2/C/`，进度 `/private/tmp/yonder-r2/C.progress.log`。

| 检查 | 原始结果 / 日志 |
|---|---|
| Phase 1 五候选各自构建 | 5 成功 / 0 失败；调研表保留各 SHA/许可/维护数据 |
| Phase 1 combined smoke | 第一次失败：host 13 与 Permiso 最低 26；第二次失败：tools 6.1 无 .v26；第三次以 tools 6.2 成功，5 项真实 API 比较；smoke.log / smoke-2.log / smoke-3.log |
| Phase 1 demo | 首次失败：descriptor 非 optional 却使用 .map；修正后最终 4 通过 / 0 失败；demo-build.log / demo-status-final.json / demo-build-final.log |
| Phase 1 npm ci / build / typecheck / lint | 通过；npm ci 0 vulnerabilities，3 个 install-script allowScripts warning 保留，未 approve；lint 204 warnings / 1 info / 0 errors |
| Phase 1 全套 | 246 通过 / 0 失败 / 26 跳过；56 文件通过 / 13 跳过 (69)，18.82 秒；test.log |
| Phase 1 责任诊断 | launchctl procinfo 63052 失败 requires root；未提权，未证明旧生产 JXA 子进程归属 |
| Phase 1 ad-hoc 实验 | 自有两个 Mach-O 同 identifier 的 DR cdhash 不同；非真实 grant-retention 测试 |
| Phase 2 helper 首次构建 | **失败**：SecCode 需先转 SecStaticCode；macOS 不提供 UN ephemeral；AX 常量触发 Swift 6 concurrency 检查。按真实 SDK 修正；helper-build-1.log |
| Phase 2 第二次 helper 构建签名 | **成功**；helper-build-2.log，Apple Development 签名，codesign --verify --strict 通过 |
| Phase 2 首次插件实机检查 | **失败**：helper 的未授权 JSON 在 stdout，旧 native 错误路径只保留 stderr，导致主人命令丢失；permissions-live-1.log。launcher 现在将错误同步到 stderr |
| Phase 2 插件实机最终 | **30 通过 / 0 失败**，含 15 状态迁移检查（9 个真实探针 + 显式历史转换及无 grant 的 hash 变化检测）、4 provider/资源比较、9 项完整字段/身份、未变 hash 不重装、历史保持、拒绝 request action、未授权截图与主人命令；permissions-live-final.log |
| Phase 2 最终 build / typecheck | 通过；build-phase2-final2.log / typecheck-phase2-final.log |
| Phase 2 全套 | **246 通过 / 0 失败 / 26 跳过**；**56 文件通过 / 13 跳过 (69)**，17.68 秒；test-phase2.log。持公共锁，--maxWorkers=4，完成后释放 |
| Phase 2 lint | 退出 0；**204 warnings / 1 info / 0 errors**；lint-phase2.log；新 JS/TS 已按项目格式整理 |
| Phase 2 无 grant 的实际代码更新 | 1 通过 / 0 失败；同路径重编译/签名后的新 hash、前一 hash 与 9 条状态均保留，request 时间仍 null；upgrade-observation.json。**不代表 grant retention** |
| Phase 2 取消与参数 | 非提示式 status 取消后 launcher 退出/native children 清空；cancel-readonly.log。bash -n 通过，无效参数退出 2，不启动 helper |
| 真实模型 | **未测**：未启用 YONDER_TEST_REAL；本次是系统权限/本地执行改动，无模型调用改动，默认 suite 26 跳过如实保留 |
| CI | 以 PR #17 最新提交的 check 为准；不将 phase 1 绿色结果当作 phase 2 证据 |

## OWNER STEP：仅由主人执行

1. **复现只读检查**（不授权、不打开 Settings）：

   ```sh
   cd /Users/zoran/Documents/yonder-harness-perms
   agent-network run -- npm run build
   scripts/demo-permissions.sh status
   node plugins/native-automation/test/permissions.mjs
   ```

   应看到 9 类 JSON、正确稳定路径/代码身份、原生状态；首次未授权情况下应与上表相符。测试会按当前 Screen Recording 状态验证真实 PNG 或正确的未授权拒绝，不发送键鼠、不发权限提示。可直接运行 `~/.local/share/yonder-harness/helper/yonder-permissions status`。

2. **亲自授权 Accessibility**：

   ```sh
   ~/.local/share/yonder-harness/helper/yonder-permissions guide accessibility
   ```

   应打开 System Settings 对应隐私页并显示 Yonder Helper 拖动卡片。macOS 27 页面可能名为 Device Control and Data Access；实际中文以本机为准。移动 Settings 观察浮窗跟随；将 **Yonder Helper.app** 拖到列表，主人亲自打开开关并接受系统确认。不要给旧 Permission Research Demo、node 或 osascript 授权来替代 helper。缺 AX 时浮窗跟随可能受限，先完成该权限，再重新运行 guide 验证。关闭设置后 Ctrl+C 结束 guide。

3. **亲自授权 Screen Recording**：

   ```sh
   ~/.local/share/yonder-harness/helper/yonder-permissions request screen-recording
   ~/.local/share/yonder-harness/helper/yonder-permissions guide screen-recording
   ```

   主人接受系统提示，在 Screen & System Audio Recording 页启用 **Yonder Helper**；系统要求 Quit & Reopen 时由主人确认。Ctrl+C 结束旧 guide，然后新运行 status / `node plugins/native-automation/test/permissions.mjs`。新 helper 应显示 granted，插件检查应验证真实 PNG。此后再安排获准的真实键鼠/Unicode/快捷键/窗口读取验收；本轮没有发送任何输入。

4. **其他种类（仅按实际需要）**：`request input-monitoring` / `guide input-monitoring`，在 Input Monitoring 列表打开 Yonder Helper；该权限不作为点击/输入的前置。`request camera`、`request microphone`、`request notifications` 使用各原生系统提示。Automation 按 com.apple.systemevents 目标检查，目标未运行时先由主人启动目标或检查 request 返回值；它不参与当前 CG/AX 桌面路径。`guide full-disk-access` 由主人拖入启用；`guide files-and-folders` 仅打开设置，具体资源访问授权另按真实任务触发，不能拖入获得全局权限。两项 status 仍为 unobservable，不伪称 granted。

5. **观察与 phase 3**：

   ```sh
   ~/.local/share/yonder-harness/helper/yonder-permissions watch accessibility
   ~/.local/share/yonder-harness/helper/yonder-permissions status
   ```

   watch 每 2 秒输出一次该种类，granted 时退出，否则最多 120 秒；Ctrl+C 可取消，无请求/开 Settings。由主人完成拒绝/授权/撤销/重启及更新前后检查，记录同一身份的 raw 与状态。更新后 helper 路径与 state 应保持；同 hash 不重装；不同 hash 不保证保留 grant。真人矩阵完成后才可声称 UI 跟随、拖放、实际输入与 grant retention 已通过。

## 未完成/限制

- 本轮未运行 request/guide/watch，未验证浮窗、拖放、系统提示、实际截图像素（未授权分支已验证）、点击/拖拽/Unicode/快捷键/窗口实际读取、授权/拒绝/撤销/重启/跨版本 grant retention。没有 UI 预览可据此交付。
- 状态仅描述 helper 自身；不诊断其他工具、生产 node、Codex CUA 或任意 JXA。旧生产责任归属仍未核实；它不再用于新 native-automation 桌面实现。
- 缺签名证书的 CI/其他机器为 ad-hoc；证书轮换/路径或代码变化可能影响授权，需重新检查。完整 TCC observability 不作为完成门槛，仍不杜撰 denied/pending 或全局 FDA 状态。
- helper 已安装在专用稳定目录；未安装整个 harness、未重启生产服务、未合并、未打 tag、未发布。
