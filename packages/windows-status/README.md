# Windows 状态栏（托盘）

Windows 上的常驻状态栏图标，与 macOS 的 `packages/macos/YonderStatus.swift` 对齐（spec 09 §6、§6.1）：
只安装核心也有图标，菜单骨架固定，只读本机控制面，不建第二份状态。

## 形态

极小的 WinForms 托盘程序，源码在仓库、产物在 `dist/`，与 `packages/macos` 同一模式：

```
YonderStatus.csproj      net8.0-windows / UseWindowsForms，无 NuGet 依赖
Program.cs               托盘宿主、固定菜单、单实例锁、退出路径
StatusReader.cs          `yonder service info --json` → 固定文案（未知 / 空闲 / 运行 N · 等你 M）
YonderCommand.cs         经 cmd.exe 调 `<install>\bin\yonder.cmd … --json`
TrayIcon.cs              品牌 mark + 状态点（运行实心、空闲无点、未知空心）
Check.cs                 `--check` / `--print-status` / `--smoke`，供 CI 与人工核对
```

构建：`node scripts/build-windows-status.mjs`（根 `npm run build` 会调用；非 Windows 上只打印跳过原因）。
产物：`dist/YonderStatus.exe` 与两张品牌图，被安装目录的 `current` junction 引用，更新后随版本切换。

## 数据来源

只调用已安装的 `<install>\bin\yonder.cmd`（`service info --json`、`update --check --json`、
`service stop`），不直接连命名管道，不读凭据，不读写第二份状态文件。

为什么经 CLI 而不直连管道：管道名由 core 按规范化 home 的 sha256 派生，协议是一行 JSON 一问一答，
两者都是内核内部约定（`packages/core/src/control/index.ts`）；macOS 状态栏同样调用安装 bin，
这样两端永远看同一个 home、同一个端点、同一组 `service.info` 字段。

读取失败（服务没起、CLI 非零、输出无法解析、超时）一律显示「服务未就绪 · 状态未知」，
不拿磁盘上的版本目录冒充在线。`service.info` 的 `ready` 或 `agents[].tasks[].state` 缺失时整份快照记为未知。

## 菜单

固定骨架，启动后只改文字与可用性，从不增删菜单项：

1. 服务状态（禁用项）：`服务运行中 · 运行 2 · 等你 1` / `服务运行中 · 空闲` / `服务未就绪 · 状态未知`
2. 检查更新：只查询当前批准仓库的最新正式 Release，显示当前/可用版本或失败；不安装
3. 停止服务并退出：`service stop` 成功后退出图标；失败显示实际错误并保留图标

左键与右键打开同一个菜单。托盘 tooltip 单行；Windows 上限 127 字符，完整失败原因放在首项的
tooltip 里，菜单项文字单行截断。

## 自启动

`service install`（以及更新后的重装）注册**用户级**登录任务 `Yonder Status`（`schtasks /SC ONLOGON`），
启动脚本是 `<install>\bin\yonder-status.cmd`，仅含 install/home 两个绝对路径。
任务独立于服务任务 `Yonder Harness`：不随服务重拉，也没有 KeepAlive；`service uninstall` 删除任务与脚本。
`service stop` 不结束已经运行的图标（与 macOS 一致），图标会如实显示「状态未知」。

为什么用 `schtasks` 而不是启动文件夹的快捷方式：安装后端本来就用 Task Scheduler，不需要新系统接口，
也不需要 WScript.Shell 去写/删 `.lnk`；同样只需要当前用户权限。

## 单实例

与 macOS 相同的锁：`<home>/.yonder/status-ui.lock`，`FileShare.None` 打开；已有宿主运行时新进程直接退出。

## 验证

本地（macOS）只能验证 TypeScript 侧：`packages/core/src/release/status-windows.test.ts` 与
`platform-service.test.ts` 的 win32 分支（fake `schtasks.exe`，不碰真实任务）。C# 编译与真实托盘必须在
Windows CI 上验证：

```
node scripts/build-windows-status.mjs
packages/windows-status/dist/YonderStatus.exe --check         # 解析器与失败路径离线自检
packages/windows-status/dist/YonderStatus.exe --smoke         # 启动真实托盘宿主并退出
packages/windows-status/dist/YonderStatus.exe --print-status  # 打印真实 CLI 结果与菜单首行
```

未在 CI 中断言：托盘的视觉外观、图标/主题适配、Explorer 通知区域的收起行为——runner 没有交互桌面，
这几项需要真实 Windows 桌面验收并单独记录。
