# @yonder/desktop（Tauri 壳）

桌面客户端是薄窗口：启动先探测本机核心，可达就加载本机网关地址，不可达就加载线上站点 `https://yonderbot.net/`。两种情况都是同一份前端产物、同一路由、同一数据来源。不打包本机运行树，不注入客户端壳标记（`window.__YONDER_SHELL__`），不提供托盘、菜单栏图标或第二套系统通知。

## 启动顺序

1. 依次找安装根：`YONDER_INSTALL` → 平台默认（macOS/Linux `~/.local/share/yonder/install`，Windows `%LOCALAPPDATA%\YonderHarness\install`）→ 旧布局 `~/.yonder-harness`；取第一个带 `bin/yonder`（Windows `bin\yonder.cmd`）的。
2. 运行 `<install>/bin/yonder ui --json`（最长 10 秒；它要经控制接口向服务要票据，本机实测 0.4–8 秒，取决于控制面当时的负载），从 `{url}` 取本机网关地址，只接受 `http://127.0.0.1:<port>` / `localhost` / `[::1]`。
3. 对该地址做一次 1.5 秒超时探测（只读状态行，任何 HTTP 响应都算可达）。探测**不带** `?token=`：那是一次性票据，探一次就作废，窗口随后只会被重定向到登录页。
4. 可达就加载本机地址；未装核心、核心停止、命令失败或超时都加载云端站点。

令牌只用来加载窗口，不写日志、不落盘。窗口内导航白名单是本机网关与 `yonderbot.net`（含本机页面跳到云端站点），其他外链交系统浏览器；新窗口请求一律拒绝并交浏览器。`capabilities/desktop.json` 的 `remote.urls` 仍只有 `https://yonderbot.net/*`：本地页面和网页一样不调用 Tauri API（不注入 `__YONDER_SHELL__`），不需要为它放开本机来源。

代码在 `src-tauri/src/local.rs`（路径解析、输出解析、探测、白名单都是不依赖 Tauri 运行时的纯函数，`cargo test` 覆盖），`lib.rs` 只在其 `#[cfg(desktop)]` 区域接线。

## 与核心的关系

- 桌面应用依赖本机核心先安装，但可以在核心服务停止时单独运行，此时回落到云端站点。
- 关闭桌面窗口只退出窗口；核心由后台服务（macOS launchd / Linux systemd 用户单元 / Windows 登录任务）继续运行。
- 想让「关掉桌面应用 = 只装了核心」成立，安装时就执行 `yonder service install`：`install.sh --desktop` / `install.ps1 -Desktop` 在装完核心之后自动做这一步。只重装桌面应用时，也可以手动执行一次。

## 构建

```sh
cd apps/desktop && npm install && npm run build
```

`npm run build` 只跑 `tauri build`；不需要先构建 `apps/app`，也不需要原来用来打包运行树的 `prepare-runtime.mjs`（已删除）。

`tauri.conf.json` 的 `bundle.targets` 是桌面三平台产物：`dmg`、`nsis`、`deb`、`appimage`（不支持的平台由 bundler 跳过）。`bundle.icon` 指 `icons/icon.ico`（Windows 资源必需，缺失会让 `tauri-build` 直接失败）与 `icons/icon.icns`（macOS）。`productName` 为 `Yonder`，`identifier` 为 `dev.yonder.desktop`。

本仓 `apps/desktop` 不在 npm workspaces 里，`bump-versions.mjs` 不改它的 `version`（`package.json` 与 `tauri.conf.json` 保持占位值）。发行构建由 `.github/workflows/desktop-release.yml` 用 `tauri build --config '{"version":"<version>"}'` 注入本次 Release 的版本，产物命名沿用 Tauri 2 默认：

| 平台 | 产物 |
|---|---|
| macOS（Apple Silicon） | `Yonder_<version>_aarch64.dmg` |
| Windows x64 | `Yonder_<version>_x64-setup.exe` |

workflow 在 macOS 上固定 `--target aarch64-apple-darwin`（不依赖 runner 当时是 Intel 还是 Apple Silicon），产物就是 `Yonder_<version>_aarch64.dmg`；`install.sh --desktop` 也只认 `Darwin arm64`：Intel Mac 与 Linux 没有桌面包，脚本会明确报错而不是给一个 404 地址。Windows 只构建 x64。

**Linux 桌面包未构建**：`bundle.targets` 里保留了 `deb`/`appimage`，但 `desktop-release.yml` 目前只有 macOS 与 Windows 两个 job。Linux 的 Tauri 构建需要 webkit2gtk 等系统库，尚未在 runner 上验证过，所以不发布不能验证的产物；补上时要在 README 记录实际构建与运行结果。

`install.sh --desktop` / `install.ps1 -Desktop` 按同一规则拼下载地址（`https://github.com/GoYonderTogether/yonder/releases/download/v<version>/<文件名>`，可用 `YONDER_DESKTOP_URL` 覆盖），改命名规则时两处必须一起改。

## 安卓构建与更新

安卓与桌面共用一个 `src-tauri`，只是入口换成 `#[tauri::mobile_entry_point]`，窗口仍加载 `https://yonderbot.net/`。

### 构建

前提：JDK 21、Android SDK（含 build-tools 与一个 NDK，本机是 r28c）、Rust 的 `aarch64-linux-android` 目标。Android 工程目录 `src-tauri/gen/android` 是生成物且被 gitignore，`tauri android init` 之后必须再跑一次 `prepare-android.mjs`，否则签名、Gradle 镜像与键盘 `adjustResize` 都会丢。

```sh
cd apps/desktop
npx tauri android init --ci
node prepare-android.mjs                       # 缺省读 ~/.yonder-signing/android/yonder-release.jks
npx tauri android build --apk --target aarch64 \
  --config '{"version":"<version>","bundle":{"android":{"versionCode":<YYMMDDNN>}}}'
```

- 签名材料：`prepare-android.mjs` 写 `keystore.properties`（路径与密码），并把 `signingConfigs` 与 release 的 `signingConfig` 插进 `app/build.gradle.kts`。别名缺省 `yonder`。没有 keystore 时 release 包是不签名的，照常能构建，但不能安装或升级。
- 版本：`apps/desktop` 不在 npm workspaces 里，`bump-versions.mjs` 不改它的 `package.json` / `tauri.conf.json`，所以版本只能用 `--config` 从本次 Release 注入，不回写仓库文件。`tauri.android.conf.json` 的 `versionCode: 26103020` 只是本地 debug 的占位。
- `versionCode` 取版本号的 `YYMMDDNN` 段（`0.3.26110205` → `26110205`），由 `scripts/release/android.mjs` 的 `androidVersionCode()` 计算，必须严格递增；写到 OSS 前会先比对线上 `latest.json`，不高就拒绝发布。

构建产物在 `src-tauri/gen/android/app/build/outputs/apk/universal/release/app-universal-release.apk`。

只构建 `aarch64`（arm64-v8a）：当前发布给普通 Android 手机，`armv7`/`x86_64` 没有产物，老 32 位设备与模拟器装不上。原生库只有这一份，APK 体积也最小。

### 发布

`.github/workflows/android-release.yml` 由 `release.yml` 在正式 Release 公开后以发版 tag 派发（本仓的 Release 由 `GITHUB_TOKEN` 创建，不会触发 `release: published`，所以不靠那个事件）。它需要这些 Actions secrets：

| secret | 内容 |
|---|---|
| `ANDROID_KEYSTORE_BASE64` | `yonder-release.jks` 的 base64 |
| `ANDROID_KEYSTORE_PASSWORD` | keystore 与 key 的密码（当前两者相同，`prepare-android.mjs` 的写法如此） |
| `ANDROID_KEY_ALIAS` | 可选，缺省 `yonder` |
| `ALIBABA_CLOUD_ACCESS_KEY_ID` / `ALIBABA_CLOUD_ACCESS_KEY_SECRET` | OSS `yonder-release` 的写入凭据 |

keystore 只在 runner 临时目录里还原，构建结束删除。产物两处：

- GitHub Release 资产 `https://github.com/GoYonderTogether/yonder/releases/latest/download/yonder-android.apk`（`apps/app/src/lib/platform.ts` 的下载页就指向它）。
- OSS：`https://yonder-release.oss-cn-hangzhou.aliyuncs.com/android/yonder-<version>.apk`，以及清单 `.../android/latest.json`：
  `{ version, versionCode, url, sha256, size, notes, publishedAt }`。
  另有一份固定名 `android/yonder-android.apk` 供直接下载。上传顺序是版本化 APK → 固定名 APK → `latest.json`，清单最后写，指向的地址一定已可下载。

### 应用内更新

代码在 `src-tauri/src/mobile_update.rs`，只在 Android（以及宿主 `cargo test`）下编译，`lib.rs` 只在 `#[cfg(mobile)]` 的 `setup_mobile` 里接线，不碰桌面的 `setup_desktop`。

1. 启动时检查一次；`WindowEvent::Resumed`（回到前台）再检查一次。同一时刻只跑一个检查。
2. `GET` 清单，严格解析：字段缺失、`url` 不是 https、`sha256` 不是 64 位十六进制、`versionCode` 为 0 都算失败，不用默认值继续。
3. `versionCode` 严格大于已安装版本（`PackageInfo.longVersionCode`）才下载。APK 落到应用缓存目录，大小与清单 `size` 一致、sha256 一致才改名落盘；先写 `.part` 再 rename，中断不会留下「已验证」的半截文件。
4. 用 `FileProvider`（authority 是 `<applicationId>.fileprovider`，Tauri 生成的清单里已有 provider）生成 content URI，`ACTION_VIEW` + `application/vnd.android.package-archive` 打开系统安装器。

**确认框由用户在系统里点，不是静默安装**：Android 要求用户确认安装未知来源应用，壳不做也无法绕过这一步。装完后由系统重启应用；新版本起来时会读到新的 `versionCode`。过程状态经 `android-update` 事件（`{ state, detail }`）发出，失败只上报原因，不重试。

### 验证与未验证项

已在本机（macOS，NDK r28c，`aarch64-linux-android`）跑通：

- `cargo test`（含 `mobile_update` 的清单解析、versionCode 比较、sha256 校验用例）与 `cargo check --target aarch64-linux-android`。
- `npx tauri android build --apk --target aarch64 --config '{"version":"0.3.26110205","bundle":{"android":{"versionCode":26110205}}}'` 成功产出 `app-universal-release.apk`；`apksigner verify --print-certs` 显示 `CN=Yonder` 的 release 证书，`aapt2 dump badging` 显示 `versionCode='26110205' versionName='0.3.26110205'`。
- `node scripts/release/android.mjs --dry-run` 对这份 APK 打印出正确的对象键与清单。

**未验证**（如实记录，不要当成通过）：真机上的安装确认框与升级后重启、清单从 OSS 的实际拉取与下载校验、CI 里的完整 `android-release.yml`（含 secrets 与 OSS 上传）、iOS。iOS 没有这条更新路径。

## 分发与签名

- CI 里 macOS 没有 Developer ID，只做 ad-hoc 签名（`APPLE_SIGNING_IDENTITY="-"`），不公证。Gatekeeper 会拦下首次打开：需要右键「打开」，或在「系统设置 → 隐私与安全性」里允许。`install.sh --desktop` 会去掉下载文件的 quarantine 属性，但通过浏览器手动下载 dmg 的用户仍会遇到这个提示。
- Windows 安装包未签名，首次运行出现 SmartScreen 提示，需要「更多信息 → 仍要运行」。
- 正式签名与公证另立验收（`docs/spec/09` §6.4）。
- 发布产物同时追加到 GitHub Release 与 OSS `desktop/<version>/`。

## 边界

- 站点内导航留在窗口；其它域名与协议交给系统浏览器，不在壳内打开第二套页面。
- 关闭窗口即退出；没有后台常驻进程。
- 本机 Yonder 的控制走设备绑定（`docs/spec/19-device-workbench.md`），壳本身不读凭据、不直接调用控制接口，只把本机网关页面放进窗口。
- 系统通知只由 macOS 状态栏进程（`packages/macos`）发出，避免同一事件弹两次。
- 旧的 D01 本机运行时 spike 与相关验收记录保留在 `docs/verification/d01-desktop.md`，是历史证据；当前实现以 `docs/spec/09-cli-release.md` §6.2 为准。
