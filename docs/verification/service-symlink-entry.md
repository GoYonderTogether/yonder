# 本机 service-host 符号链接入口修复

2026-10-25，用户授权排查本机并修复、恢复任务。

日用 0.2.26102507 的 launchd 已尝试 424 次，退出码 0，无 PID/控制 socket。launcher 通过 current/scripts/yonder-service-host.mjs 调用，ESM import.meta.url 已解引用而 argv 未解引用，入口被跳过。修复为与既有 CLI 一样 realpathSync(argv) 后比较；不增加恢复机制。

本机安装目录的同一源码已应用热修；launcher 保持 current 路径。真实 launchd 重启后 PID 99472、ready=true，5 项活动工作，主会话 2、子任务 96806、Hermes 11751 正在执行。

回归测试用真实符号链接及 Node 子进程，不启动伪模型或 launchctl。build、typecheck、lint 通过；全套 670 通过/0 失败/39 跳过，113 文件通过/19 跳过。lint 406 warnings/14 infos/0 errors。

首次检查复用了安装目录 node_modules，668 通过/2 失败/39 跳过，两个路径断言发现依赖实际解析到安装目录；没有削弱断言。改为独立 npm ci 后，完整检查以上述结果通过。

此次本机热修不改变正式版本号；源码 PR 合并发布前，安装来源仍为 f13f7ed02fcfc5cf8e3c62d8885e8d021be9e2a9 加本地入口修复。
