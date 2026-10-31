# @yonder/desktop（Tauri 壳）

桌面客户端是加载线上站点的薄窗口：窗口打开 `https://yonderbot.net/`，与浏览器和手机壳是同一份前端产物、同一路由、同一数据来源。不打包本机运行树，不探测本机网关，不注入客户端壳标记（`window.__YONDER_SHELL__`），不提供托盘、菜单栏图标或第二套系统通知。

## 构建

```sh
cd apps/desktop && npm install && npm run build
```

`npm run build` 只跑 `tauri build`；不需要先构建 `apps/app`，也不需要原来用来打包运行树的 `prepare-runtime.mjs`（已删除）。macOS 本地可 `codesign --force --deep --sign - <Yonder.app>` 临时签名；正式签名与公证随发行流程单独验收。

移动端（Android/iOS）共用同一个 `src/lib.rs`，只是直接打开同一站点；Android 的签名与 Gradle 镜像由 `prepare-android.mjs` 在 `tauri android init` 之后重放。

## 边界

- 站点内导航留在窗口；其它域名与协议交给系统浏览器，不在壳内打开第二套页面。
- 关闭窗口即退出；没有后台常驻进程。
- 本机 Yonder 的控制走设备绑定（`docs/spec/19-device-workbench.md`），桌面端自己不直连 `127.0.0.1` 网关、不读凭据。
- 系统通知只由 macOS 状态栏进程（`packages/macos`）发出，避免同一事件弹两次。
- 旧的 D01 本机运行时 spike 与相关验收记录保留在 `docs/verification/d01-desktop.md`，是历史证据；当前实现以 `docs/spec/09-cli-release.md` §6.2 为准。
