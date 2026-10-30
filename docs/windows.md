# Windows 原生适配

范围由维护者在 2026-10-29 确认：原生 Windows CLI/TUI、后台登录自启动、安装与更新。沿用现有命令、pi 会话和权限体系。

## 平台约定

- 控制面与 channel-cli 保持原 JSON Lines 协议；Windows 将原 socket 绝对路径与用户目录摘要映射为 `\\.\pipe\yonder-<sha256>`，所有生产者和消费者共用 SDK 地址函数。命名管道不作为文件删除。
- 本机 bash 工具保留注册名，在 Windows 执行系统 Windows PowerShell，UTF-8 输出、无 profile、非交互、隐藏窗口。取消回收命令进程树。不是 PTY 或沙箱，不承诺回收主动逃离父链的进程。
- 后台服务使用当前用户的登录计划任务（Interactive/Limited），不请求管理员权限、不保存登录密码；只在该用户已登录时运行。沿用 service 子命令，一个用户一个服务。日志继续位于 home/.yonder/logs。
- 安装仍使用版本目录与 current；Windows current 使用目录 junction。切换时先停本安装服务，再替换 junction，失败恢复旧 junction。Windows 不声称 POSIX rename-over-symlink 原子性。生成 yonder.cmd 启动器，保留 node 的绝对路径和 PATH；更新与回滚共用原入口、安装锁和结果核验。
- 2026-10-30 维护者追加完整桌面移植与真实模型、TUI、重启验收。Windows 使用系统托盘承载同一 service.info 与 ui-companion 状态；不建立第二会话/转录。桌面驱动使用 Win32/UI Automation，坐标与截图采用物理像素，Unicode 使用 SendInput；Windows keyCode 表示 Virtual-Key，command/option 分别映射 Win/Alt。输入受 UIPI、安全桌面和登录状态限制，不提权。
- Windows 权限查询返回实际宿主身份和可观察事实；没有对应全局授权开关的种类返回 unobservable，申请/引导仅打开对应 Windows Settings，watch 只观察。可信 owner、能力和取消规则不变。
- Windows sealed 字节使用 DPAPI CurrentUser 加密后保存到仅当前用户可读写的私有目录；明文仅经 stdin/stdout 与受信任消费者传递，不进入参数、日志和模型。所有私有文件/目录校验真实 ACL，不能以 chmod mode 代替。Mac 继续使用 Keychain。
- Windows awake 沿用 off/tasks/always 和任务结束后 15 分钟缓冲，通过服务子进程同一线程的 SetThreadExecutionState 持有租约；stdin 关闭/进程结束即释放，不改全局电源计划，不承诺覆盖合盖、手动休眠或系统策略。
- GitHub 独立升级使用当前用户一次性计划任务，runner 位于版本目录之外，沿用请求身份、单飞、结果核验和恢复通知；调度成功不等于安装成功。

## 验证

需要真实 Windows 文件、命名管道、进程和计划任务验证；模型测试仍使用 openai/gpt-6-luna，无凭据标未测。真实登录触发、整机重启、交互终端和发布升级单独记录，不能以纯函数检查代替。

## 使用与限制

前置条件：包含 npm 的 Node.js ≥22.19、Git；检索还需 rg。源码构建后沿用 `node packages/cli/dist/index.js init`、`login openai`、`start`、`chat`。`service install --home` 要求已通过 update 安装包含此适配的审核版本；不能指向尚未适配的旧发布标签。

Windows 暂存版本改名后必须重新绑定 npm workspace 的绝对 junction，再校验新版本与服务 home。服务启动器保留安装时 Node 和 PATH；Windows 服务为当前用户登录后启动，不代表机器启动前或用户注销后可用。

复现确定性检查：`npm run build`、`npm run typecheck`、`npm test -- --maxWorkers=4`、`npm run lint`。系统集成有 `scripts/test-windows-service.mjs`、`test-windows-install.mjs`、`test-windows-power.mjs`、`test-windows-desktop.mjs`、`test-windows-update-job.mjs`；桌面脚本显示专用测试窗口并发出真实键鼠输入，运行期间请勿切换焦点。服务/安装脚本发现既有注册服务即拒绝。安装检查需要 npm，支持 npm_execpath。正常结束清理测试任务和临时安装。

重启检查用 `node scripts/test-windows-reboot.mjs prepare <report.json>` 为已就绪的验收服务登记当前用户登录后的一次性检查。只有启动时间确实变化且内核、托盘、会话查询都通过才记 passed；不会自行重启。`status` 读取结果，`cleanup` 只删除此检查任务、不删除报告或用户数据。使用当前用户可管理 ACL 的私有 home；受沙箱/管理员 ACL 保护的工作区目录可能拒绝修改 DACL，不能因此放宽秘密存储要求。

macOS 的签名/TCC/launchd 与 Windows 的 ACL/Win32/计划任务分别实现。TUI 组件保持 pi 原生实现；完整能力、真实模型、交互与重启以验收记录为准。
