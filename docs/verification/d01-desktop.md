# D01 桌面壳 spike 验证记录

结论：尚不能判定 spike 通过或改用 Electron；保留 Swift 壳。

- 本机 Homebrew Rust 1.99.0，安装 rustup 1.29.2 成功；固定工具链 1.92.0 两次下载未完成。Tauri 2.12.5、notification 2.8.0、updater 2.14.1；npm CLI 2.12.4。
- `cargo check` 通过；此前先后遇到资源复制竞争、旧版 Tauri 依赖不兼容、缺 icon，修正后通过。前端构建、`npx tsc -b`、app typecheck、改动文件 Biome 通过；prefs 测试 1 文件、8 项通过。全仓文件大小检查失败：并行改动的 `packages/core/src/runtime/background.ts`、`packages/sdk/src/types.ts` 新超限，`packages/core/src/runtime/index.ts` 超基线。
- 第一次 debug `.app` 约 1.01 GiB；按包发布清单精简后的最终 debug `.app` 为 706.53 MiB，已 ad-hoc 签名并启动。最终构建首次运行在启动后第 23 秒观察到运行树释放完成，第 32 秒前通过 AX 看到窗口内容；这是区间观测，不是精确冷启动计时。使用临时 home 且设置 `gateway.basePath: /console/`，窗口 AX 显示 `/console/?shell=desktop` 和消息列表。截图在 `~/Documents/yonder-lead/program/verify/d01/window-final.png`，包含本机导入会话标题。首次启动曾因 updater 无配置而失败，补配置后启动。
- 网关默认 basePath `/` 下 `/console/assets/` 返回 404，`/console/api/stream` 返回 HTML；显式配置 `/console/` 后 API 返回预期的未登录 401。壳提示用户配置，不改已有配置。
- `activity.watch` 当前只发送活动计数摘要，尚未发现节点级 `notification` 事件生产路径。临时测试代码调用 Tauri notification 插件后进程无报错，但系统通知中心未观察到通知；真实弹出及点击跳转未验证，临时代码未保留。
- 未验证：真实更新源、正式版本签名与公证、Swift 壳体积和冷启动对比、macOS 非激活悬浮窗、三平台托盘与单实例、sidecar 崩溃拉起。这些不是 spike 通过的证据。
- 待办：正式 macOS Developer ID 签名及公证需 Apple Developer 账号；本卡本机验收只需 ad-hoc 签名。

- 精简运行树检查：工作区符号链接断链 0、树外链接 0；内置 Node 执行该树的 CLI 并向临时 gateway 获取一次性票据成功。运行树按归档 SHA-256 分目录，避免更新时复用旧版本。
