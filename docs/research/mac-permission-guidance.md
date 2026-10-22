# macOS 权限引导调研（Track C / D55）

2026-10-22，基线 `f820996`，实机 macOS 27.2 / 26B5091g，Apple Silicon，Swift 6.4。

**结论：优先复用 PermissionFlow 的引导 UI，但完整状态管理准入未通过，生产 helper / 插件集成暂停。** 本 PR 提供真实只读探针与主人手动启动的研究浮窗，不宣称完成 C2–C4。浮窗能显示不等于目标进程获得权限；进程的父子关系也不是 TCC responsibility 的证明。

## 复用选择与实测

数字通过 `agent-network run -- gh api repos/<owner>/<repo>` 与 `releases/latest` 获取；open issues 含 PR，是规模信号，不是自动质量评分。所有候选 checkout 与原始日志保留在 `/private/tmp/yonder-r2/C/`，没有安装到用户 Applications 或生产 home。

| 候选 | Stars / open issues | 最后 release / push (UTC) | 许可 | macOS 27.2 构建 + 运行 | 适配与决定 |
|---|---:|---|---|---|---|
| [PermissionFlow](https://github.com/jaywcjlove/PermissionFlow) | 422 / 3 | v2.11.3，2026-09-26 / 2026-09-26 | MIT | `swift build -j 4` 成功；AX / Screen / Input 3 个 provider 与同进程原生 API 一致 | 选为 UI 候选及研究 demo 的固定依赖；不采用其 FDA provider |
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

1. **直接使用成熟组件**：PermissionFlow 能处理 Settings deeplink、原生拖放、浮窗位置、中文和资源打包；研究 demo 固定其 revision，保留 MIT LICENSE 与 NOTICE。
2. **包裹适配**：仅以 `PermissionFlowController` 打开显式 guide；`promptForAccessibilityTrust: false`；status 直接调用三个 provider 并与 Apple API 比较。避开会触发多种请求的 `PermissionFlowButton`、默认 FDA provider 与自动 status registry 读取。
3. **组合**：Camera/Microphone、Automation、Notifications 可由 Apple 原生只读 API 提供，不为此再引入整套状态管理库。
4. **剩余缺口**：实际 responsible identity、不可观测状态、跨更新身份及进程重启证据没有由候选解决。不得自己造一个枚举就声称解决。生产实现在这里停下，见 BLOCKED。

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

## BLOCKED：C1 gate 及下一选项

- **完整状态语义**：AX/Screen/Input 公共 API 返回 boolean；“已发请求”不等于“用户拒绝”。不能真实区分 pending/denied/needs-restart 时必须 unknown，而原需求要求完整区分。FDA / Files & Folders 也没有选出可靠、无副作用、全局可读的状态来源。
- **责任进程**：C1 要求具体证实 launchd node、JXA、screencapture 的归属；目前只证实 executable、parent、DR。生产链验证需要主人只读诊断，或后续明确授权的隔离 launchd 环境，不能拿终端运行代替。
- **引导 UI**：五个库的编译不等于 UI 验收；本轮禁止替主人运行 guide，浮窗跟随、拖放、正确 pane、授权与撤销/重启都待 OWNER STEP。
- **跨更新身份**：无稳定 Yonder helper 分发身份及 grant-retention 实测；新 helper 的授权也不会自然覆盖现有 JXA/screencapture 路径。

下一选项供维护者选择：

1. 保留“完整、可证明”的门槛，先在隔离服务中验证实际归属与升级，选定稳定 app/helper 身份并将受保护操作真正路由到它，再实现状态与集成。
2. 明确批准收窄为“可观测状态 + 不可判定时 unknown（保留 raw API evidence）”，按 permission + responsible identity + target/resource 持久化事实；不可再标“完整授权状态已知”。

这两个选项都不是本 PR 已做出的产品契约变更。本 PR 不注册空壳工具、不替换现有桌面诊断、不加入未工作的持久状态机。
