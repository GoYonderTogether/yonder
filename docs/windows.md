# Windows 原生适配

范围由维护者在 2026-10-29 确认：原生 Windows CLI/TUI、后台登录自启动、安装与更新。沿用现有命令、pi 会话和权限体系。

## 平台约定

- 控制面与 channel-cli 保持原 JSON Lines 协议；Windows 将原 socket 绝对路径与用户目录摘要映射为 `\\.\pipe\yonder-<sha256>`，所有生产者和消费者共用 SDK 地址函数。命名管道不作为文件删除。
- 本机 bash 工具保留注册名，在 Windows 执行系统 Windows PowerShell，UTF-8 输出、无 profile、非交互、隐藏窗口。取消回收命令进程树。不是 PTY 或沙箱，不承诺回收主动逃离父链的进程。
- 后台服务使用当前用户的登录计划任务（Interactive/Limited），不请求管理员权限、不保存登录密码；只在该用户已登录时运行。沿用 service 子命令，一个用户一个服务。日志继续位于 home/.yonder/logs。
- 安装仍使用版本目录与 current；Windows current 使用目录 junction。切换时先停本安装服务，再替换 junction，失败恢复旧 junction。Windows 不声称 POSIX rename-over-symlink 原子性。生成 yonder.cmd 启动器，保留 node 的绝对路径和 PATH；更新与回滚共用原入口、安装锁和结果核验。
- macOS 状态栏、原生自动化、电源组件不移植到 Windows，也不因构建通过而标记支持。Windows 凭据必须按 ACL 校验，不把 POSIX mode 当成权限证据。

## 验证

需要真实 Windows 文件、命名管道、进程和计划任务验证；模型测试仍使用 openai/gpt-6-luna，无凭据标未测。真实登录触发、整机重启、交互终端和发布升级单独记录，不能以纯函数检查代替。

## 使用与限制

前置条件：包含 npm 的 Node.js ≥22.19、Git；检索还需 rg。源码构建后沿用 `node packages/cli/dist/index.js init`、`login openai`、`start`、`chat`。`service install --home` 要求已通过 update 安装包含此适配的审核版本；不能指向尚未适配的旧发布标签。

Windows 暂存版本改名后必须重新绑定 npm workspace 的绝对 junction，再校验新版本与服务 home。服务启动器保留安装时 Node 和 PATH；Windows 服务为当前用户登录后启动，不代表机器启动前或用户注销后可用。

复现确定性检查：`npm run build`、`npm run typecheck`、`npm test -- packages/core packages/sdk packages/cli plugins/channel-cli plugins/context-files plugins/memory`、`npm run lint`。系统集成可单独执行 `node scripts/test-windows-service.mjs` 与 `node scripts/test-windows-install.mjs`：两者使用隔离临时目录，发现既有注册服务即拒绝。安装检查需要 npm；通过 npm 启动时也支持 npm_execpath。正常执行后清理测试任务和临时安装，不修改正式 home。

macOS 专属插件及 GitHub 的 launchd 独立自动升级作业保持原平台范围；Windows 本次实现 CLI update。TUI 组件保持 pi 原生实现，本轮无真实交互终端视觉验收。
