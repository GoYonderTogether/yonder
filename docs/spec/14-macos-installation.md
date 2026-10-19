# 14 macOS 本机安装与状态栏（2026-10-18 用户批准）

复用 09/10 的 git 标签→本机构建→版本目录→current→独立 home→launchd。安装路径 /Users/zoran/.yonder-harness，数据 /Users/zoran/.local/share/yonder-harness/home；不从开发仓库运行日用服务，不复制其他应用 OAuth。版本使用合法 X.Y.Z：本轮 0.1.YYYYMMDDNN，NN 为当天递增序号；版本/源码 commit 同时可查，已安装标签和版本不可覆盖。

macOS 状态栏用原生 Swift/AppKit NSStatusItem、LSUIElement，无主窗口、Dock 图标或客户端框架。菜单只含真实服务状态（只读）、检查更新、退出。打开菜单时读取权威状态；后台查询不抢焦点。检查更新只查询当前批准仓库实际最新正式 Release 并显示当前/可用版本和失败，不自动安装，不发消息。退出停止既有 harness launchd 服务，再退出图标；保留服务定义、版本与数据，下一次登录仍自启。若停止失败，显示实际错误并保留图标。

服务沿用现有 dev.yonder.harness；图标采用一个用户 launchd 登录项 dev.yonder.harness.status，RunAtLoad=true、KeepAlive=false，避免用户退出后被重拉。无需新增常驻管理器、自动更新机制、窗口、设置页、安装平台或特权助手。

状态栏源码位于 packages/macos/，使用系统 swiftc；构建/安装接入既有发行流程，由主 agent 顺序管理共享 release/CLI/scripts。安装版保存构建后的 .app；程序调用安装 bin/yonder 固定 argv，不拼 shell，不读凭据。状态/更新检查需要相应真实结果，不以图标显示等价于服务运行。macOS 状态栏操作和屏幕预览需要真实运行证据。

只读命令 `yonder service info --home <home> --json` 返回实际服务进程的 version/commit/home/pid/ready；控制面未就绪时失败，不回退磁盘版本。`yonder update --check --json` 经本机既有 gh 登录态查询仓库最新正式 GitHub Release，返回 current/latest/updateAvailable/url，缺 gh、登录或正式发布时显示实际失败。不会安装或改配置。

2026-10-18 用户指定飞书环境：生产 home 使用人生管家；开发验收使用开发验收员和独立 /Users/zoran/.local/share/yonder-harness/home-dev。开发进程仍从独立安装的 bin/yonder 启动，不另加 launchd 管理器；生产登录自启保持唯一。两个 home 的配置/状态/凭据分开，不复制其他应用 OAuth。用户授权在本飞书测试账号内操作 Chrome 开发者后台、私聊及群聊并创建验收群；这不把会话 id 自动等同主人账号身份。

F轮验收：用户已确认原生状态栏菜单正常，记为用户验收通过；Mac注销后重新登录仍需用户主动操作，核对唯一服务/图标、同安装/home及飞书连接/积压，不自动注销系统、不登出ChatGPT制造测试。
