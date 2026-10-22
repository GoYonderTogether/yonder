# macOS 权限引导调研（Track C / D55）

2026-10-22，基线 `f820996`，实机 macOS 27.2 / 26B5091g，Apple Silicon，Swift 6.4。

**Phase 2 决定：复用 PermissionFlow 的显式引导 UI，采用原生非提示式探针 + 自有请求历史，以稳定签名的 Yonder Helper.app 执行所有桌面操作。** 维护者已批准 unknown / unobservable，不再要求 OS 区分未请求与拒绝；下表为 phase 1 的真实候选证据，继续复用，不重新造权限框架。helper 及原生操作已构建并签名；授权、拖放、撤销与跨更新 grant-retention 仍须主人验收。

## 复用选择与实测

数字通过 `agent-network run -- gh api repos/<owner>/<repo>` 与 `releases/latest` 获取；open issues 含 PR，是规模信号，不是自动质量评分。所有候选 checkout 与原始日志保留在 `/private/tmp/yonder-r2/C/`，没有安装到用户 Applications 或生产 home。

| 候选 | Stars / open issues | 最后 release / push (UTC) | 许可 | macOS 27.2 构建 + 运行 | 适配与决定 |
|---|---:|---|---|---|---|
| [PermissionFlow](https://github.com/jaywcjlove/PermissionFlow) | 422 / 3 | v2.11.3，2026-09-26 / 2026-09-26 | MIT | `swift build -j 4` 成功；AX / Screen / Input 3 个 provider 与同进程原生 API 一致 | 选为显式 guide 的固定依赖；不采用其 FDA provider |
| [AskForPermission](https://github.com/riko2chen/AskForPermission) | 41 / 0 | 无 release / 2026-04-19 | MIT | build 成功；真实 `PermissionCenter()` 拒绝裸 CLI（missingHostApplicationBundle），未运行其全权限 status | 要求 .app；状态初始化会探测 Safari/TCC 文件及私有 SPI，不选择 |
| [SwiftPermissions](https://github.com/MoElnaggar14/SwiftPermissions) | 5 / 3 | v3.6.0，2026-10-06 / 2026-10-06 | MIT | build 成功；AX / Screen 2 项原生比较通过 | 可复用细分 provider，但不提供目标浮窗；请求历史推断 denied 不符合严格状态语义 |
| [PermissionsKit](https://github.com/MacPaw/PermissionsKit) | 313 / 9 | 1.0.6，2024-04-15 / 2026-09-21 | MIT | build 成功；真实 calendar status 返回 raw 0（notDetermined） | 支持日历/联系人等，缺 AX/Screen/Input 与引导浮窗；FDA 仍为受保护文件探测 |
| [Permiso](https://github.com/zats/permiso) | 571 / 1 | 无 release / 2026-07-01 | 未发现 LICENSE | build 成功；真实 enum/deeplink 元数据调用通过；未显示 UI | macOS 26+；仅引导，许可未定，不纳入仓库依赖或复制源码 |

固定 checkout SHA：

| 项目 | 实测 SHA |
|---|---|
| PermissionFlow | `cb96db4bfd2342e8d8c56f2a7d51ca65b8aed6e2` |
| AskForPermission | `91f4dde33f9f5dd58a89d72f3f05aa4b149a1f0e` |
| SwiftPermissions | `c91fba2d72cd5dce61ffa75b45588beb3534d714` |
| PermissionsKit | `dc44876860368c3c56d13b53319945d475289a16` |
| Permiso | `77afe0eb5251d6da8756aac1b24e3c01c1433f87` |

运行证据的边界：Permiso 仅验证链接与元数据；AskForPermission 仅验证裸 CLI 拒绝；PermissionsKit 仅验证日历查询。五个库都不能据此标记“完整 guide/UI 验收通过”。候选合并 smoke 的初次构建失败（Permiso 要求 macOS 26，host 最初为 13），第二次因 PackageDescription 6.1 不支持 `.v26` 失败；改为 tools 6.2 后第三次构建运行成功。未修改任何候选源码。

维护状况核验：[PermissionFlow #3](https://github.com/jaywcjlove/PermissionFlow/issues/3) 报告运行中撤销 FDA 后状态不刷新；[#13](https://github.com/jaywcjlove/PermissionFlow/issues/13) 报告初始浮窗裁切及已有列表项问题（2026-10-07 更新）；[#10](https://github.com/jaywcjlove/PermissionFlow/issues/10) 为屏幕录制布局 UX 问题。Permiso 唯一 issue [#1](https://github.com/zats/permiso/issues/1) 请求补许可。选择 PermissionFlow 是具体引导能力与可复现构建的结果，不是对其全状态正确性的背书。

补充候选：[Rust permission-flow](https://github.com/veecore/permission-flow) 2 stars / 2 issues，MIT，无 release，push 2026-05-06；[TrustMe](https://github.com/piercefreeman/TrustMe) 1 star / 0 issues，MIT，v0.2.0 2026-10-15。未列为 top candidates，未构建运行，不据此作可运行性承诺。

成熟应用的规模参考（未安装/未运行）：[Hammerspoon](https://github.com/Hammerspoon/hammerspoon) 16312 stars / 700 issues，MIT，1.1.1 2026-02-26；[Rectangle](https://github.com/rxhanson/Rectangle) 30123 / 70，API license NOASSERTION，v2.0.4 2026-10-20；[Mos](https://github.com/Caldis/Mos) 21692 / 421，NOASSERTION，4.2.1 2026-05-31；[Loop](https://github.com/MrKai77/Loop) 11838 / 52，GPL-3.0，1.4.2 2026-01-26。这些是整应用，不是已经验证可无提示复用的权限组件。Raycast / BetterTouchTool / CleanShot / Keyboard Maestro 未作为可采用开源库，也未安装。

## 复用阶梯的决定

1. **直接使用成熟组件**：PermissionFlow 能处理 Settings deeplink、原生拖放、浮窗位置、中文和资源打包；产品 helper 固定其 revision，保留 MIT LICENSE 与 NOTICE。
2. **包裹适配**：仅以 `PermissionFlowController` 打开显式 guide；`promptForAccessibilityTrust: false`；status 直接调用三个 provider 并与 Apple API 比较。避开会触发多种请求的 `PermissionFlowButton`、默认 FDA provider 与自动 status registry 读取。
3. **组合**：Camera/Microphone、Automation、Notifications 可由 Apple 原生只读 API 提供，不为此再引入整套状态管理库。
4. **剩余缺口**：实际 responsible identity、不可观测状态、跨更新身份及进程重启证据没有由候选解决。不得自己造一个枚举就声称解决。phase 2 已批准不可观测语义；剩余实现采用最小 Swift helper，详见下文。

## 各类权限能证明什么

| kind | 非提示式证据 | 不能据此声称的事实 / 下一步 |
|---|---|---|
| Accessibility | 当前调用进程 `AXIsProcessTrusted()` boolean | false 不区分未请求/拒绝；不能测另一进程，也不证明 helper 是 responsible app |
| Screen Recording | 当前进程 `CGPreflightScreenCaptureAccess()` boolean | 不证明 screencapture 子进程有效；进程缓存与重启须同身份新旧进程实测 |
| Input Monitoring | 当前进程 `CGPreflightListenEventAccess()` boolean | 不证明监听器已重建；当前桌面驱动只是发事件，不应强求此权限 |
| Automation | `AEDeterminePermissionToAutomateTarget`，`askUserIfNeeded: false` | 按 target + event class/id，不是一个全局 granted；目标未运行可能返回 -600，不启动它来“修好”探针 |
| FDA | 未找到满足当前严格要求的公共全局 preflight | 不运行候选的 Mail/Messages/Safari/TCC 文件探针；文件存在/可读也不是普适 FDA 证明 |
| Files & Folders | 必须绑定具体资源与实际访问结果 | 不能用单一 boolean，也不能为了 status 访问主人目录制造弹窗 |
| Camera / Microphone | `AVCaptureDevice.authorizationStatus(for:)` | 返回调用方状态，不替代真正相机/麦克风使用链的归属 |
| Notifications | bundle 中 `UNUserNotificationCenter.notificationSettings()` | 当前 Yonder 状态栏与研究 app 不是同一身份；只在相关功能实际需要时请求 |

Apple 的 [Automation API](https://developer.apple.com/documentation/coreservices/3025784-aedeterminepermissiontoautomatet) 与 [WWDC19](https://developer.apple.com/videos/play/wwdc2019/701/) 支持非提示式按目标预检。[Apple DTS 的 Files & Folders 说明](https://developer.apple.com/forums/thread/125438) 明确 responsibility 会影响子进程归属，且 Files & Folders 不能靠拖 app 进列表获得，必须通过对应访问触发授权。[Apple DTS 的 FDA/文件访问说明](https://developer.apple.com/forums/thread/124895) 区分 BSD、sandbox、data vault、FDA 与 Files & Folders；因此不能把任意 EACCES/EPERM 简化成“拒绝 FDA”。

## 当前 Yonder 的真实执行链与签名

源码：`packages/core/src/release/index.ts` 的 `servicePlist` → 安装目录 `bin/yonder` shell wrapper → `exec node .../packages/cli/dist/index.js start`。桌面工具再 spawn `/usr/bin/osascript`，截图另 spawn `/usr/sbin/screencapture`。`YonderStatus.app` 是独立状态栏进程，并不是服务的父 app。

只读现场：`launchctl list` 显示服务 PID 63052；`ps -p 63052 -o pid=,ppid=,comm=` 显示 PPID 1，执行文件 `/Users/zoran/.local/share/mise/installs/node/24.21.0/bin/node`。其 `codesign -d -r-` 为 `identifier node`、Developer ID Team `HX7739G8FX`；osascript 与 screencapture 分别为 Apple 签名 `com.apple.osascript`、`com.apple.screencapture`。这些事实不等于它们分别出现在权限列表里。未启动生产子进程做新操作。

`launchctl procinfo 63052` 实测返回 **This subcommand requires root privileges: procinfo**。没有提权、没有运行授权请求、没有修改/重启生产服务。生产 node 与其 JXA/screencapture 子进程的实际 TCC responsible code 因此仍未证实。开发终端内 AX/Screen/Input 全部 true 也不能填补这个缺口。

[Apple 对 responsible constraint 的定义](https://developer.apple.com/documentation/security/applying-launch-environment-and-library-constraints) 区分 parent 与 responsible；[DTS 关于 helper 归属的解释](https://developer.apple.com/forums/thread/702907) 表明某些链路需要进一步现场诊断。不能靠把一个独立 helper 命名为 YonderPermissions.app 就让 launchd node 自动继承授权。

更新稳定性：本机创建两个完全自有的 throwaway Mach-O，均 `codesign --sign - --identifier dev.yonder.research.sign`，DR 分别为 `cdhash 8ae540d57ee4ed985b212fb76dd0f180ded7e588` 与 `cdhash b082425bab8de6690de59360dbb175e8e1e7f5a3`。同 identifier 的 ad-hoc 重编译确实改变 DR。未创建 Keychain 项或读取签名私钥。按 [Apple Code Signing Guide](https://developer.apple.com/library/archive/documentation/Security/Conceptual/CodeSigningGuide/AboutCS/AboutCS.html) 与 [TN2206](https://developer.apple.com/library/archive/technotes/tn2206/)，稳定证书链/identifier 的 DR 是跨版本代码身份的依据；Developer ID 可作为分发方案，但不是“权限永不丢失”的保证，TCC 更新保留仍须真实升级试验。没有申请开发者账号、选择生产签名身份或承诺签名已配置。

## Phase 2：解除 gate 后的实现与实测

复用阶梯：原生 TCC API 能做自身 preflight；PermissionFlow 已解决 Settings deeplink、拖动卡片、窗口跟随和本地化；二者组合后，剩余缺口只有稳定代码身份、请求历史和在同一代码中实际执行桌面操作，因此实现一个 SwiftPM executable，不再加入第二套权限库。旧研究 demo 被产品 helper 取代，原始源码保留在 Git commit `313fa60`。

- `packages/macos-helper/` 固定同一 PermissionFlow SHA；MIT LICENSE/NOTICE 保留，不使用 FDA provider。只有显式 guide 创建 controller；promptForAccessibilityTrust=false。native status 直接读 AX/CG/AV/UN/按目标 Apple Events API。
- `security find-identity -v -p codesigning` 实测 **1 valid identity**：Apple Development: zoran zeng (Z4A92U2M2T)。以该证书签名成功，`codesign --verify --strict` 通过；未要求主人接受任何提示。DR 包含 helper identifier、Apple anchor 与证书名称约束；不是仅用 path 或宽松 identifier 自定义 DR。
- `open -n -g -W --stdin ... --stdout ... -a 'Yonder Helper.app'` 使用本机 `man open` 支持的 LaunchServices API，保持后台启动、不激活应用。stdin/stdout 是私有临时文件承接的 JSON，无网络服务。helper 自身用 CoreGraphics 截图与输入、AX 窗口读取，Node 不再 spawn JXA 或 screencapture。CLI 信号转发到 helper，取消标记防止尚未启动的请求稍后执行输入。
- helper 位于 `~/.local/share/yonder-harness/helper/Yonder Helper.app`；state/lock/稳定 CLI 在 bundle 外。launcher 比较源 bundle 与已安装 bundle 的 CDHash，未变不替换，变更才校验签名并替换。请求与 status 共用文件锁、原子保存 JSON；状态保留同路径旧身份的历史用于 needs-restart 提示。无签名身份时构建明确回退 ad-hoc，更新可能要求重新授权，不保证 grant retention。
- 实机新身份 AX/Screen/Input **false**；AV Camera/Microphone raw=0；Notifications raw=0；Automation raw=-600（目标未运行）；FDA/Files & Folders unobservable。前述终端研究进程 true 没有被沿用到产品权限状态。PPID=1 是 LaunchServices 独立启动的佐证，不能代替 TCC 授权后的真人验收。
- Phase 2 不调用 request/guide/watch。窗口跟随、拖放、真实输入、授权与撤销、重启与升级保留均未测；构建和状态机检查不替代这些证据。

批准语义见 [D55](../decisions.md) / [spec/14 §5.1](../spec/14-execution-capabilities.md)，原始失败、当前结果、确切 OWNER STEP 见[验收记录](../verification/mac-permissions.md)。

## Phase 3：布局与授权后生命周期

2026-10-22 再核验 [repo API](https://api.github.com/repos/jaywcjlove/PermissionFlow)：423 stars / 3 open issues，MIT，push 仍为 2026-09-26。[main commit](https://github.com/jaywcjlove/PermissionFlow/commit/cb96db4bfd2342e8d8c56f2a7d51ca65b8aed6e2) 与已固定 SHA 相同，无可直接升级的布局修复。[#10](https://github.com/jaywcjlove/PermissionFlow/issues/10) 与 [#13](https://github.com/jaywcjlove/PermissionFlow/issues/13) 仍 open；已读正文和讨论，分别涉及屏幕录制与系统音频列表的混淆、macOS 27 的初始裁切及已有条目拖入不生效。保持原候选比较表，不扩大选型。

| 复用阶梯 | 源码证据与结论 |
|---|---|
| 原样依赖 / 公开配置 | `PermissionFlowConfiguration` 没有 frame provider / grant completion / close callback；`FloatingDropPanel.targetFrame` 只按整个 Settings frame 与 sidebar 常数定位。公开 `closePanel` 可复用，但无法取得用户关闭事件或更新状态文本 |
| 小型适配 | 采用 [PermissionFlow-guide.patch](../../packages/macos-helper/patches/PermissionFlow-guide.patch)：只开放 frame/message/restart/close hooks、初始无 frame 隐藏、非全 Space 浮窗与可访问关闭按钮名称；不重写拖放或 provider。build 在 pinned SwiftPM checkout 幂等应用，冲突即失败；MIT/NOTICE 保留 |
| 原生组合 | CGWindowList 的 Settings 实际可见窗口边界 + 已有 AX 授权下的右侧列表/父容器 frame；只读、无截图、不访问 TCC。无 AX 列表时落到窗口下沿，留 8pt；屏幕下方空间不足则隐藏并要求主人上移 Settings，不钳制到列表上方 |
| 剩余生命周期 | AppKit run loop 在 Swift main actor task 外启动；guide/watch 共用观察。记录 grantedAt；授权后一秒确认并复检撤销。Screen Recording 使用同一 Helper 可执行文件的新子进程运行非提示式 preflight，与当前进程比较；只有 false/true 不一致才给重启按钮，launcher 继承原始截止时间重启，经新探针确认后 granted |

运行证据：构建/签名成功；53 项专项检查（内含 36 项 self-check）；两种 guide 的真实 CG bounds 与 AX 列表边界比较各 3 项通过。短时 guide 的累计打开时间每种 < 30 秒，无授权操作；源数据、初次采集失败和所有未测项见[验收记录](../verification/mac-permissions.md)。没有把已有 AX grant 或未授权屏幕状态当作新拖放授权成功。
