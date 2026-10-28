# @yonder/desktop（D01 spike）

在仓库根目录先构建运行包；在本目录执行 `npm install`、`npm run build`。构建时将当前 Node、工作区运行树和 app 产物打入应用；首次打开会释放运行树。macOS 本地可用 `codesign --force --deep --sign - <Yonder.app>` 签名。

窗口连接本机 gateway；现有 gateway 需配置 `gateway.basePath: /console/`，否则显示提示，不修改用户配置。通知依赖节点级 `notification` 事件和可访问的会话 ID。桌面 updater 通过 Tauri 配置 `plugins.updater.endpoints` 与 `pubkey` 注入；默认无源，不检查更新。

这是 spike，未完成的跨平台、通知与恢复验收见 `docs/verification/d01-desktop.md`；Swift 壳仍保留。
