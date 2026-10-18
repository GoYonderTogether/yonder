# R1–R3 主路结果与 R4 交接

日期：2026-10-18。基线 e5311b7；R0 冻结 ae60bf2。用户批准 R0–R6、D1–D4、补测/真实安装及原生状态栏；三个 Sol 只写各自允许路径，核心/SDK/CLI/共享文件由主 agent 实施。A/B/C 原始检查记录分别见 repair-a/b/c-result.md。

## 已实现，不能替代日用验收

- I01：SDK 普通发送携带真实 ToolContext；Runtime 的活动调用 WeakMap 验证身份，调用结束删除。发送文件及显式子任务附件共用 read/canonicalPath/工作区或本轮输入附件路径边界；渠道拒绝远程环境/非本机 file URI。可信插件主动发送仍有独立 plugin 身份。
- I02/I03：原始输入先由 pi 接纳/落位；现有 beforeAgent 按实际运行配置准备上下文/图片，并在 pi 原生不可变 ContextEdit 中保存一次结果及已下载附件关联。steer/followup/被动 write 均在实际模型运行边界准备；旧输入/事件不覆盖，无新增 pi 补丁或第二队列。配置快照先持久化；恢复先载快照，调度恢复后再准备；准备/读图片沿用真实原生取消信号。新图片共享现有历史的请求预算，超量显示可读文件 URI，旧不兼容历史保留并终止请求。
- 实际检查揭露：pi beforeRequest hook 普通异常只报告、继续请求。原来的 throw 不能拒绝不兼容图片。现使用既有原生 abort，RunDoc 保存明确输入错误并投影 error 终态；没有伪装 maxTurns、重试/回退或改弱断言。
- I04/I05：task_run 显式附件默认无；返回 child session/status/text/reason/真实附件。产物经原生工具结果 details 持久化，并按唯一原生 tool task id 归属本轮；不扫描工作区猜文件。入队前失败由拥有者收尾，已入队的准备失败归原生终结；保留 manual/run-end。
- I06/I07/O3：object 插件省略配置统一为 {}，必填仍拒绝。离线/在线 inspect 同一工具选择算法，包含 native/core/plugin、offer/search/拒绝原因及真实 tool_search；插件选用包含 home/plugin presets。磁盘候选与正在运行快照分开标示。models list/本地 Skills 管理不再无谓装载所有插件。
- I08/I09：SDK/CLI/MCP 非等待提交共享 event/session 接纳身份；wait=true 保留 RunResult。MCP 使用标准 SSE，真实标准客户端收到 progress。断开观察不等于 abort。
- I13–I15：TUI 删除失效 observer，恢复观察后先提示核对历史且不自动重发；并发 watch 合并，目标切换后忽略旧异步结果；多目标 skills 显式选择。NO_REPLY 完成态仅精确匹配，短回复 N/NO 保留。沿用 U05/pi 呈现。
- I10–I12/I16 与 O1/O2：由 A/B/C 完成，见各路记录。主路核对实际 diff；已接共同 SDK、service info 和结构化 unknown。unknown 保留已确认部分消息 id；无错误文本前缀协议、自动回滚或副作用重发。
- 用户追加：Swift/AppKit 状态栏，仅真实服务状态、只读检查正式 Release、停止服务并退出。独立 RunAtLoad 登录项 KeepAlive=false；沿用现有 harness 服务与安装更新流程，无窗口/Dock/特权助手。源码 packages/macos，构建 scripts/build-macos.mjs，CLI 增加 service info 和 update --check。实际安装/菜单验收留 R4。

## 检查事实与失败保留

- 初次共享聚焦：3 failed / 8 passed / 5 skipped；包括旧插件 fixture 未给 package version、旧 route 期望缺 busy/waiting、沙箱拒绝 Unix socket。补齐原契约期望、正常本机 socket 环境后：1 failed / 11 passed / 5 skipped，剩旧 MCP 数量期望漏已有 watch；未减少 API 数量或放松来源验证。
- 真实 Luna/Sol 首批：4 files / 6 passed。覆盖工具流、排队时换模型/配置、会话继续与重启、MCP 控制/观察/取消。
- 新子任务检查先因测试插件工具缺必须前缀失败 1 项；修正 fixture 后 1 passed，真实 child 读显式文件、生成真实产物并返回父工具/SDK，越界发送在 attempt 前拒绝。
- 图片检查先因配置 maxPerRequest=0 本身非法失败；改用合法 text-only 模型配置。初始 PNG 解码被原生图片处理器拒绝而降级，随后换合法 RGB PNG，并增加原生记录图片数量断言；该过程仍发现上述 hook 不阻止请求的真实产品问题。
- 首轮整仓：29 files 中 27 passed / 2 failed；91 tests 中 89 passed / 2 failed，0 skipped。失败分别为初始化已创建 presets 后 fixture 再 mkdir，以及旧图片请求未被 hook 阻止；均保留记录。后续聚焦：7 passed / 1 failed，确认合法图片仍被继续请求；修产品根因后输入边界 4/4 passed（含取消准备、真实图片降级/旧历史拒绝）。
- 最终整仓：`YONDER_TEST_REAL=1 YONDER_TEST_AUTH=<Yonder 自身现有授权路径> agent-network run -- npm test`，**29 files passed；92 tests passed，0 failed，0 skipped**。没有模拟模型或复制 OAuth；临时 home 使用 Yonder 自身授权路径，检查不会向外部消息渠道发送。
- 最终 `npm run build` 通过，含系统 swiftc 编译出的 arm64 Mach-O 状态栏；`npm run typecheck` 通过。原 `tsc -b --noEmit` 因 TS6310 失败，修为原生 `tsc -b --force` 完整检查引用项目并生成所需声明，不跳过诊断。
- `npm run lint` 最终 0 errors / 51 warnings / 1 info，122 files，无禁用规则。最初 10 errors / 50 warnings / 1 info；修复范围内的格式/import 排序、明确 BrowserSkill version 类型及一处赋值表达式。只处理实际强制检查诊断，没有顺手重构。
- npm lock 同步现有 TypeBox 精确依赖和一致日期版本，offline package-lock-only 成功；干净 npm ci/独立安装的补丁应用尚待 R4，不能用本工作区 node_modules 成功替代。

## 尚未完成

R4 独立安装、launchd/菜单真实状态和界面证据、安装版 Yonder MCP 并行/父子实际维修、浏览器/CUA/Search/Tavily/飞书真实矩阵；R5 issue→Yonder/Sol→PR→Codex 审核合并→正式 Release→operator 更新。原 N09/N13/N14、T/U 验收未覆盖项仍保留，92 项通过不冲抵它们。

当前获准资源：BrowserSkill Chrome 195df83d（zoran主账号）连接正常；用户已提供生产人生管家应用和指定收发会话，secret 已通过受信任程序保存至 Vaultwarden 自动化库，仅记录引用，不入仓库。用户追加：开发验收员用于 home-dev，人生管家用于生产 home；允许飞书测试账号私聊/群聊/创建群及 Chrome 后台配置。开发 bot secret 与 GitHub 插件专用凭据尚未取得；现有 GitHub 仓库已只读确认 private/main，Tavily 自动化凭据引用已找到。
