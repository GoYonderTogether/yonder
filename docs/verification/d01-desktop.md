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

## D01r2 补充（2026-10-28）

**结论：保留 Swift。** Tauri 仍缺节点事件到系统通知的完整链路；本轮真实桌面验收也未完成，不能判定继续 Tauri 通过，亦没有 Electron 实测支持切换。

| 项目 | Tauri spike | 现有 Swift 壳 |
|---|---|---|
| 体积 | debug 706.53 MiB，含运行树；release 未测 | 现有 `packages/macos/dist/YonderStatus.app` 516 KiB（`du -sk`），不含 gateway/Node 运行树；不可直接等量比较 |
| 启动 | 上轮首次 32 秒内观察到页面；冷、热各三次及可交互时间未测 | 同方法冷、热各三次未测 |
| 通知 | `activity.watch` 只有计数，缺节点通知生产/订阅与发送；点击回调存在但端到端未测 | 本轮未测 |
| 托盘 | 断线或订阅结束设为离线，恢复摘要后更新；单元测试通过，真实断线未测 | 本轮未测 |
| 更新 | updater 插件已注册，但公钥和更新源为空，真实更新未测 | 菜单提供 CLI 更新检查，本轮未测真实更新 |
| 跨平台 | Tauri 可作为跨平台技术候选，Windows/Linux 构建、托盘、通知及运行均未实测 | 仅 macOS；Windows/Linux 不适用 |

Rust 固定 `1.99.0`：上一轮 1.92.0 两次下载未完成；本机 Homebrew 1.99.0 的 `cargo check --locked --offline` 使用已有 rsproxy 缓存通过。rustup 的 1.99.0 manifest 可取得，但组件下载未完成，不能声称 rustup 安装成功。

`node --test apps/desktop/src-tauri/src/activity.test.cjs`：1 项通过，覆盖活动流结束后设置离线；真实 gateway 断线与杀死壳后恢复均未测。bundle ID 为 `dev.yonder.desktop`，已有 debug 包为 ad-hoc 签名。历史 `/usr/bin/log show --last 2h --style compact --predicate 'process == "usernoted" AND eventMessage CONTAINS "dev.yonder.desktop"'` 在 13:03:10 记录上一轮临时通知调用，授权状态为 Denied；系统识别了该调用，但这不是节点事件，不能证明通知展示或点击跳转，也不能据此断定 ad-hoc 签名不支持通知或前台抑制是原因。当前权限未确认。

真实验收阻塞：修复提交推送后运行 `verify-copy.sh`，脚本报告验收 HOME `ch05r3` 仍在运行，拒绝更新共享副本；未停止其他任务进程。故 release 构建及体积、两壳各三次冷/热可交互计时、节点通知及点击、崩溃恢复和实际离线托盘均未验收。应在副本可更新后执行 `verify-copy.sh`、`verify-home.sh` 和 `real-check.sh`，再补上述实测；节点级通知契约需维护者确定。
