# 1907 执行能力补齐结果

2026-10-19。范围与批准见 [实施计划](execution-capabilities-plan.md)、[spec/16](../spec/16-execution-capabilities.md)、D41。仓库并行会话已提交的内置提示词工作e910e85/2cf76a7保留原历史，本轮没有实现官方角色模板提案。三个Sol并行：cron；MCP后接独立自动化；Agent热管理。主路负责SDK、runtime、路由、会话、提示词、根打包和发行。

## 实现与边界

- 内核：统一通过pi原生conversation-owned background Task执行工具；15秒返回后台句柄，子会话仍归原生任务树。JobPointer与Task同事务创建；长结果继续原任务、固定requestId，显式取消不触发反向续跑。未知副作用重启后标中断，不自动重放。
- process：状态、日志、等待、stdin、取消；bash可立即background。stdout/stderr尾部有界，完整命令日志落盘，写盘背压控制内存；已结束running条目释放。取消/停服实际清理shell及子进程。不宣称PTY。
- 软阈值：maxMinutes/maxTurns/maxTokens提醒，不中断运行；tokens含输入/输出/缓存。当前请求携带UTC时间及已过时长；子任务提醒也写父session，不为提醒单独唤醒模型。显式取消、真实模型协议限制和重复空转保护保留；process观察不当作重复副作用。
- cron：at/every/5或6字段cron、IANA时区/DST、范围/列表/步长、起止窗口/次数、启停CRUD/立即运行/历史、补跑合并或跳过、并发/不重叠；事件、隔离preset、命令和脚本；真实结果投递。持久状态只在插件data，不新增工作流引擎；休眠/停机不执行。原始事件要求admin；作业归属同时核对Agent和profile，每次执行重新收窄权限。
- MCP客户端：stdio/StreamableHTTP/SSE，懒连接、断开/恢复、工具schema按需发现、原名调用、资源和prompt、外部instructions来源上下文；标准图片/音频/blob映射真实媒体，正文不塞base64。凭据引用、权限/会话隔离、取消与自有进程清理。OAuth交互登录未实现；已有授权可用凭据header，不导入其他客户端账号。
- 独立自动化：Playwright自动探测本机Chrome/Edge/Chromium并启动自己的headless浏览器；导航、snapshot、选择器操作、表单、标签、evaluate和实图。macOS桌面用原生JXA/CoreGraphics/screencapture提供状态/截图/观察/键鼠，不依赖BrowserSkill或Codex。OS授权和浏览器引擎仍是实际前提，不能承诺绕过。
- Agent/preset：模板生成、昵称/工作、CRUD、校验后热发布、归档恢复；已有工作继续，新输入排除归档对象。默认main保留日常入口，禁止真删；其他全局插件/provider/services仍需重启。
- memory：workspace/memory/README.md，允许按日期/条目手工保存/检索；不自动注入、整理、清理或建立记忆引擎。

## 实际检查

- 全仓默认检查首次160通过/11跳过/0失败（38文件通过、6文件跳过）；1907最终默认检查为161通过/11跳过/0失败，不把重复运行累计。build/typecheck通过；全仓lint有49错误/90警告，错误来自未改的bp子仓库和用户.claude；本轮60个源码/配置候选的作用域检查0错误、55警告（Biomes实际识别59文件），不清理无关内容。
- 真实Luna：15.004秒自动yield，独立写入比后台完成早5.820秒；原生child成功、process查真实exitCode0、自动续办最终EXECUTION_LIVE_DONE；三软提醒均不abort。单轮完成子任务的afterResponse用量提醒也已关联父通知：`/tmp/yonder-execution-live-vZWsfr/evidence/after-response-check.json`；父子运行均done。最后一次真实框架运行有1条英文文案断言失败，已修为事件ID关联并对原证据重放通过，未再次花模型调用。首轮完整通过证据 `/tmp/yonder-execution-live-HZDxzN/evidence`，详见 [真实模型记录](execution-live-result.md)。
- 真实pi/SQLite与子进程：15秒阈值、stdin、日志、跨session拒绝、abort/shutdown后shell及sleep PID消失、running清空，见 [后台检查](background-check-result.md)。
- 真实SDK三传输、文件工具/资源/prompt、PNG/音频/blob字节一致、重连/取消，见 [MCP结果](mcp-client-result.md)。
- 真实Chrome本地HTTP表单提交/截图，以及macOS后台屏幕截图；桌面未抢焦点实测键鼠。停止等待SIGTERM/SIGKILL和PID消失已实测，见 [自动化结果](native-automation-result.md)。
- cron表达式/持久化/补跑/撤权/停止、跨profile隔离与有界历史，见 [cron结果](cron-result.md)。真实定时模型与飞书投递组合未逐项跑；不以文件适配检查冒充真实渠道。
- 热管理真实隔离kernel/CLI，见 [Agent结果](agent-management-result.md)。三新插件已通过真实loader校验且在独立kernel加载成功，证据 `/tmp/yonder1907-loaded-result.json`。

## 保留的问题与失败

- 初始真实续办使用不合法system:yonder Ref导致generation faulted；已修为合法内部事件（无from，保留runtime类型、原parent/route）。前后完整证据保留。
- 直接setup检查漏掉SDK工具名前缀约束，真实loader拒绝；已统一mcp-client_stdio/http、native-automation_browser/desktop并通过checkPlugin与实际kernel加载。原检查不足如实记录。
- cron跨profile管理越权、历史全量装入内存、桌面kill不等退出均已修，有针对性检查。原始红绿记录在各分路文档。
- 两次真实脚本观测错误、native driver契约误读、旧硬阈值断言不匹配等原失败保留，不改成未发生。
- 未关闭完整飞书/断网/播放矩阵；本轮不追加记忆引擎、PTY、OAuth产品化登录、沙箱或人格模板。

## 发行与安装

源码和真实主链检查已完成；main合并、正式标签与本机update结果在执行完成后补记。原始正式1906历史见 [1906结果](release1906-result.md)。
