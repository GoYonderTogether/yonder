# 执行能力补齐实施计划

2026-10-19 用户已批准并行实施和发布。功能以spec/16为准；不新造运行核心、记忆引擎、沙箱和工作流系统。

- X0 主路：统一spec/07、architecture上限语义和D41，冻结本轮规范。
- X1 Sol cron：plugins/cron/**、docs/tasks/cron-result.md；完整调度、数据和执行/投递；不改SDK/核心/根依赖。
- X2 Sol MCP：plugins/mcp-client/**、docs/tasks/mcp-client-result.md；真实SDK客户端、连接/工具/资源/prompt/来源引导。
- X3 Sol Agent：packages/core/src/config/**、kernel/**、control/**、packages/cli/src/**、skills/yonder-self-management/**、docs/tasks/agent-management-result.md；热注册和管理。共享runtime/SDK由主路独占。
- X4 浏览器/桌面：空出一条Sol分路后做plugins/native-automation/**，按需真实依赖；不改旧BrowserSkill/Codex插件。
- X5 主路：runtime/**、tools/**、sessions/**、SDK、prompt的必要接线；15秒后台、进程管理、软阈值、结果与资源释放，手工memory目录。
- X6 主路：根workspace/锁/导出整合，必要聚焦测试、build/typecheck，真实本地后台和替代浏览器验证；合并main、推送发行1907、沿现有update安装并核对。不得以接口存在算通过。

分路不改规范、共享文件、版本号、根lock，不切分支或推送。每任务写真实结果/问题，失败和未测原样保留。正式环境在新版本可安装后才迁移，不在开发中重启日用进程。媒体服务与其他无关功能保持原范围。


## 实施状态

X0–X6本轮实施与发行安装已完成，交用户审核。1907已进入main并推送正式标签；本机原update升级、程序通知、热配置和真实Luna创建后自动定时执行均有回执。主路与X3共享kernel接线统一提交，插件各任务独立提交；检查结果、原始失败和未测见[整轮记录](execution-capabilities-result.md)，不根据文件存在关闭真实未测。
