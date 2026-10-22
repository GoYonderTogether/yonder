# Track C phase 3 macOS 权限引导验收

2026-10-22；基线 `20ed4a2`（PR #17 已合并）；新 worktree `/Users/zoran/Documents/yonder-harness-perms-ui`；新 branch `yonder/mac-permissions-ui`。D55 原地修订，PR 待审核，禁止合并/发布。Phase 2 原始计数保留在本文后半部分。

**当前结果：列表下沿几何、已有 AX grant 的自动确认退出、主人关闭引导窗和未授权超时已在实机验证。新拖放授权、屏幕录制重启和撤销仍未测。** 没有点击 Allow/开关、拖入应用或改 TCC；没有改生产 home/service/launchd。稳定 Helper bundle/CLI 按代码 hash 更新，权限历史保留。主人此前已授予 AX/Input，本轮探针为 true；Screen Recording 为 false。

## Phase 3 变更与原始检查

日志 `/private/tmp/yonder-r2/C3/`，进度 `/private/tmp/yonder-r2/C.progress.log`。复用表与上游 issues/main 核验见[调研](../research/mac-permission-guidance.md)，许可/补丁见 [NOTICE](../../packages/macos-helper/NOTICE)。

| 步骤 | 结果 / 证据 |
|---|---|
| 新 worktree/分支 | 从 `origin/main=20ed4a2` 创建；原工作树未修改；无 force-push |
| 上游选择 | main 仍为 pinned `cb96db4…`；423 stars / 3 issues / MIT。保留源库，以可审阅补丁开放小型 API，build 自动幂等应用；helper-build-1/2/3/final.log 均构建签名成功 |
| npm ci / build / typecheck | 全部退出 0；npm-ci.log / build.log / typecheck.log。复编译 patch 已应用的 checkout 仍通过 |
| 本地全套 | **252 通过 / 0 失败 / 26 跳过；56 文件通过 / 13 跳过（69），18.81 秒**；test.log。持有公共 heavy-test 锁，仅测试时占用，--maxWorkers=4，完成后释放 |
| 最初专项检查 | **失败 1**：已有 screen 请求历史时 nextStep 合法返回 `guide screen-recording`，旧断言固定只接受 `request screen-recording`；permissions-live-final.log。没有更改权限状态来制造通过，现断言错误包含当次状态返回的完整 nextStep |
| 最终专项检查 | **53 通过 / 0 失败**（含 **36 self-check / 0 失败**、真实九类探针、grantedAt、history/hash、拒绝 AI request、未授权截图命令、watch 成功/超时/退出码）；permissions-live-final-2.log。显式历史迁移仅自检使用，不写虚构 OS grant |
| 初次外部帧采集 | 采集程序 stdout 缓冲，终止时 AX 样本未落盘且 screen 尾行不完整，解析失败；不作为通过。改用 FileHandle 逐行即时输出，再测实际窗口，保留最初日志 |
| 最终 live geometry | **6 通过 / 0 失败**；geometry-assertions.json、*-final-windows.jsonl、*-final-guide.jsonl。外部 CG 实际窗口与 host 目标 frame 一致；两种均在列表下方 8pt；未截屏 |
| 真实关闭/超时 | Screen guide 12.40 秒超时返回 requested / exit 1；最终约 2.80 秒后只对 Helper 自有“关闭权限引导”按钮执行 AXPress，返回 closed/requested/exit 1。AX guide 两次约 1.56/1.60 秒，返回 granted/grantedAt/exit 0。每种累计打开 < 30 秒，无授权/Settings 移动 |
| lint | 退出 0，**204 warnings / 1 info / 0 errors**，基线诊断保留；lint.log |
| 真实模型 | **未测**：本轮无模型链路变更，未启用 YONDER_TEST_REAL；全套 26 skipped 如实保留 |
| CI | 新增非提示式 helper self-check；最终 PR check 以 GitHub 对本分支最新提交的实际结果为准 |

## 真实窗口数字

AppKit 坐标为左下原点，`[x,y,width,height]`；主屏 `[0,0,2560,1440]`，visible `[0,0,2560,1410]`。CG/AX 坐标为左上原点，转换 `appKitY=1440-cgY-height`。Settings 稳定窗口 AppKit `[601,244,740,923]`，CG `[601,273,740,923]`。

| kind | AX 列表/父容器（AppKit） | 目标 / 实际引导窗（AppKit） | 外部实际 CG guide bounds | 断言 |
|---|---|---|---|---|
| accessibility | `[853,404,468,630]` | `[853,300,468,96]` | `[853,1044,468,96]` | panel 上沿 396，list 下沿 404，8pt 间隔，退出 0 |
| screen-recording | `[853,668,468,379]` | `[853,564,468,96]` | `[853,780,468,96]` | panel 上沿 660，list 下沿 668，8pt 间隔，关闭退出 1 |

Settings 自身打开动画还产生真实 sample `[497,222,547,710]`（AX list 尚不可见），当时 fallback guide 为 `[727,118,317,96]`。纯计算 self-check 使用这些真实原始 sample、无 AX fallback、空间不足隐藏、多屏偏移；平移样本明确是计算检查，**不是实际移动 Settings 的证明**。没有人工移动 Settings，以免影响主人其他工作；人工移动/resize、跨屏/Space 的 live 跟随仍未测。实现按可见 Settings CG 边界跟随，未知 frame 时隐藏，未设置 canJoinAllSpaces。

## OWNER STEP：仅主人完成授权矩阵

在当前 PR worktree 构建并通过 status 安装对应 Helper：

```sh
cd /Users/zoran/Documents/yonder-harness-perms-ui
agent-network run -- npm run build
scripts/demo-permissions.sh status
node plugins/native-automation/test/permissions.mjs
```

1. 运行 `~/.local/share/yonder-harness/helper/yonder-permissions guide accessibility`。guide 应在实际列表正下方，不遮挡开关或 `+`。当前已授权时显示“已授权 / Granted”约一秒后自行关闭，JSON outcome=granted、exit 0。需要测新授权时，由主人自行先撤销再重开 guide，把 **Yonder Helper.app** 拖入列表并接受系统确认；不授权 node/osascript 替代 Helper。移动/调整 Settings 大小，观察跟随；屏幕底部无空间时上移 Settings。
2. 运行 `~/.local/share/yonder-harness/helper/yonder-permissions guide screen-recording`。主人亲自拖入/启用 **Yonder Helper**；新进程已看到授权而当前进程仍 false 时应显示“需要重启 Helper”，只有一个“重启 Yonder Helper”按钮。主人点击该按钮，新 Helper 重新检查，显示“已授权 / Granted”约一秒，自动关闭并 exit 0；status 中 grantedAt 应存在。如果系统要求 Quit & Reopen，由主人确认。不得把本轮未授权检查称为重启链已通过。
3. 运行 `~/.local/share/yonder-harness/helper/yonder-permissions watch screen-recording`，共享同一探针/状态逻辑，默认 600 秒；此命令不打开 Settings、不发请求。若观察到新旧进程授权差异会自动重启自身再确认。可用 `watch screen-recording --timeout 5` 复测超时（请求时间不更新），exit 1；granted 则 exit 0。guide 关闭按钮返回 closed 和 exit 1；取消用 Ctrl+C，launcher exit 130。
4. 在 guide 打开期间由主人撤销权限，观察 revoked-detected；授权后一秒确认期间再撤销不得返回成功。完成后运行 status 和专项脚本，屏幕授权后脚本应验证 PNG。键鼠真实执行、拒绝/撤销/重启、多屏/Space 与更新 grant-retention 按明确授权另行记录，本轮未做。

## 未完成 / 限制

- **未测**：新拖放→探针变 true 的真人授权、屏幕 needs-restart→按钮/自动重启→granted 的真实缓存分支、实际撤销、人工移动/resize 与跨屏/Space、实际键鼠、授权后 PNG 与升级 grant retention。现有 AX/Input true 是主人此前授权，本轮不冒充新 grant。
- 未获 AX 时只能用 CG Settings 窗口下沿；不能读取准确列表结构。屏幕下方没有足够空间则隐藏引导并输出上移 Settings 的下一步，避免遮挡按钮。
- grantedAt 是此状态机首次观测该次 grant 的时间，不能反推 OS 真正授权时刻；旧 JSON 无此字段可解码。watch 从未请求的种类仍保留其真实状态与 null 请求时间，不伪造请求历史；unobservable 不会因超时变成可观测。
- Screen Recording 新子进程探针失败会返回实际错误，不伪造 needs-restart。代码 hash 变化的既有 needs-restart 仍是风险提示，不承诺重启恢复；ad-hoc/证书轮换仍须主人检查授权。
- 未改生产 home、service、launchd，未合并/发布；仅专用稳定 Helper/CLI/state 按任务更新。

## Phase 2 历史记录（当时未进行 UI 授权验收）

下列是 PR #17 合并前的原始证据，日期 2026-10-22，旧 worktree `/Users/zoran/Documents/yonder-harness-perms`；旧状态不是本轮实时状态，watch 120 秒等旧实现描述已被 Phase 3 的 600 秒共享循环替代。

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
