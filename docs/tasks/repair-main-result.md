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

## R4 安装现场问题（继续执行）

候选 cec2d38 已经从本地唯一 tag 干净 clone/npm ci/build 安装到独立 versions，实际控制面返回正确 commit/版本/home/PID、ready=true，doctor 通过。随后 service install 重装同一现有服务时，bootout 返回但旧进程/注册尚在退出，紧接 bootstrap 报原生 5；未用 root 绕过。只读确认服务已经卸载后用原 start 恢复，控制面再次就绪。共享修复：bootout 后在同一安装/停止入口等待已知旧 PID 和 launchd 注册都退出，再进入下一操作；30s 是本机实际服务停止确认预算，只读观察状态，不重发 bootstrap、不新增监督器或重试机制。将以真实临时 launchd job 和现有安装入口复验，日期子版本递增，不移动已安装标签。

真实 macOS 临时 launchd job 检查通过：release.test.ts 1 file / 2 passed，其中真实 job 确认停止后重新 bootstrap 成功；实际生产控制面再次返回 0.1.2026101801/cec2d38、ready=true。新安装候选递增为 0.1.2026101802，旧 tag 保留。

## R4 已取得的独立安装证据

- 0.1.2026101802 / 3d9ec69433f902690e62f2a4fce5accb0e5574b5：真实 update 干净 clone/npm ci/build，service install 成功；实际 service info ready=true，PID 61177；状态栏登录项进程 61208 running。用户登录项已注册，尚未实际注销/重登录验证。Computer Use 选择菜单栏应用挂起约 48 分钟后超时；不重复这条挂起调用，菜单点击和截图仍未测。
- 飞书生产应用真实鉴权成功，机器人名称人生管家/open_id 已确认；历史 API 200/code=0，唯一用户发送者为 ou_a8b9231042bc5160e9d212d8c4cc8dce。用户给出的 oc_… 是会话，未误作 owner；尚未因唯一发送者就授予 owner。开发验收员后台已发布、长连接和 im.message.receive_v1 已有，开发 secret 未读取。生产/Tavily 指定自动化库凭据仅经受信任进程写入安装版自身存储。
- 安装版经 MCP 同时接纳 Sol 四会话：1204 BrowserSkill、1217 Tavily、1230 hosted search、1243 飞书状态。四个 run.end 均 model=openai/gpt-6.1-sol/status=done；实际时间 20:18:41–20:19:36 UTC，存在并行重叠。原生转录已保存 /tmp/yonder-r4-*-transcript.json。
- 1204：真实 skill_view→诊断→195df83d 后台 session ywge→example.com→observe→PNG screenshot→stop/list；资源释放成功。1217：Tavily search/extract 成功，fetch source=http-get/truncated=false；Tavily 原生提取表格日期缺失如实报告，不改写成全保真。1230：codex-tools_search 返回 native webSearch 1 item/14 text_result，内部 Luna thread 01a150aa-b6f0-7d03-ab29-ffb599030e61，turn 01a150aa-c1e4-7122-b08f-7d48e04cfacb。1243：channel-feishu_status connected/botIdentityKnown=true。
- 以上是具体基本场景通过，不代替完整 R4 多媒体/取消/父子/恢复/TUI 等矩阵。旧 u05-c0-c6 自动化在明确删除授权后返回 not_found，已无等待任务。
- 新实现漏接：飞书普通消息工具描述支持回复，但未提供 replyTo；现沿用 OutMessage 已有字段接入 SDK/共同发送/工具，不绕开投递权限。聚焦协议检查 6/6、typecheck 通过；尚未安装此源码差异。

R5 前置真实缺陷：相同授权 REST issues 请求带 since=1970-01-01T00:00:00.000Z 返回 []；仅去掉首次 since 参数即返回 issue #1。插件原先 ready 但未发事件。首次全量扫描不带增量水位；已有有效水位仍保留原参数和同秒边界，旧 epoch 游标无需改数据即可继续。最小回归在原首次扫描/重启检查增加初始参数断言，不增加另一同步器。

## R4/R5 后续实际结果

- 安装版 0.1.2026101803 / 690d399：GitHub 首次扫描修复后 issue #1 的真实 message.in 为 01M58B6A9ADKS7RN472KJ84G46，路由 github-issues → maintainer/Sol session 1336 / run 1344。Yonder 自行读取完整 issue/规范/参考、报告方案、修改三文件、运行检查、commit f9df5e0bedf2a09e2130b27683763d2a88f3e8e0、推任务分支并经 channel-github_create_pr 创建 PR #2。Codex 亲自审阅完整 diff 与工具事实，锁定 head 后合并到 zoran/first-pass；合并 commit 2abc4e3，未合并 main。issue 已关闭。未把同账号 PR 评论冒称 GitHub 的独立批准票；CI statusCheckRollup 为空。
- 自主维修主轮实际 20:28:01–20:32:50 UTC，Sol 用量 input 65985/output 6675/cacheRead 893696，cost 0.2880896；补充范围评论触发的后续轮只确认边界，未重做修复。主轮累计 token 不是单请求上下文长度，不能据此声称超限或未超限；运行真实完成。任务记录保留 6/6 原始基线、旧实现 6过2失败、扩展初次9过1失败、最终10/10与类型检查/Biome事实。
- 默认 Luna 安装版 session 1370 实际调用 bash/pwd、grep、read；run.end 明确 model=openai/gpt-6-luna。CUA session 1357 通过自己的 codex-tools_js 取得真实应用清单/飞书 AX，点击消息后观察，并另次取得实际 JPEG 截图；无浏览器 metadata 的错误没有用另一后端绕过。后续读取原生返回 cgWindowNotFound，未执行新的客户端动作。截图是旧会话位置，不能证明本次新消息/媒体已展示或可播放。
- 生产飞书 session 1447：文字/引用回复、PNG、Ogg/Opus、MP4 取得原生消息 id；首次 TXT 以相对 file: URI 被解释到根目录而 ENOENT，改明确绝对 URI 后发送成功。首次 schema2.0 卡片错误使用旧 action 容器而 HTTP400；修为直接 button/behaviors callback 后普通卡片发送成功。两次重做均有明确新假设及无副作用拒绝证据，没有重发成功项目。客户端、入站模型回复、群聊、按钮/模板、CardKit全链、播放、断连仍未通过。
- 97/97 完整真实模型/launchd 回归在 0.1.2026101804 工作区通过，29文件、0失败0跳过；build/typecheck通过，lint0错误/51warnings/1info。随后仅补 CLI 帮助文字展示已有 service info/update --check；初次受限环境聚焦1失败3通过（socket相关检查5000ms超时），相同断言在正常本机权限下4/4通过，未延长超时。后续新发现的父子取消缺陷及新增回归另记，97项不是最终计数。
- 临时独立 home 由安装版原生 init 建立，仅引用 Yonder 自有授权文件，未复制 OAuth。plain CLI 连续两轮输入/EOF等待得到“R4第一轮通过”“R4第二轮通过”并正常停止。真实父24同时调用两 task_run：子40和47分别20:40:18.571/.573打开、20:40:25.245/24.986关闭，各bash输出A/B；子模型最终正文分别空/NO_REPLY，父工具忠实返回，未从工具历史编造最终正文。旧生产 home 缺 TUI 默认 preset，补入原生 init 完全相同的 default Luna preset，未新增外部主体或admin权限。

### 父子取消现场缺陷（已修复并验证）

临时父83 abort 后已结束，但子98未生成run.end/closed。真实最小回归旧源码1失败/1按筛选跳过，确认不是检查脚本误判。根因：runTask 在父调用绑定的 submission.wait(context) 上观察子任务；父取消使观察提前抛出，原生子任务虽终止，Yonder 的唯一终态投影未运行。改为已接纳后取相同原生 submission 的服务侧 handle，以服务上下文等待其既有终态并投影；提交与子任务所有权仍原生、取消仍原生，不增加第二观察器/队列/模拟结束。对应真实模型回归最终2/2通过；新增测试初次build因tools是可选字段报TS18048，按类型契约修正访问后build/typecheck通过，没有削弱终态断言。

### 需用户决定/外部条件

自动审批明确拒绝了 proposed operator policy=apply、admin更新工具权限及新飞书绑定的组合配置：要求单独确认持久权限与更新策略。该脚本未执行，生产仍notify、operator未获admin，未增加飞书owner映射/入站绑定。已异步提供“受限工具自动更新/保持notify手动更新”的选择，待用户答复，不能把时间流逝当批准。原生模板 default preset 是独立且已通过审批的安装配置修复。

开发验收员secret未取得；用户睡觉后不揭示后台masked secret、不扩大自动化库范围。正式Release与operator更新/通知闭环等待上述决定；菜单点击、真实注销/重登录、完整TUI实拍与飞书客户端矩阵尚未完成。Computer Use两类真实失败（菜单应用选择超时、后续飞书cgWindowNotFound）分别保留，不猜测是用户锁屏还是驱动问题。不用源码、97项测试或API发送成功冲抵这些未验收项。

## 最终源码检查（候选 0.1.2026101804）

最后一次完整回归：`YONDER_TEST_REAL=1 YONDER_TEST_LAUNCHD=1 YONDER_TEST_AUTH=<Yonder自有授权> agent-network run -- npm test`，**29 files passed / 98 tests passed / 0 failed / 0 skipped**，日志 /tmp/yonder-r6-final-tests.log。原97/97是新增父子取消回归前的历史结果；旧失败不删除。build/typecheck通过；完整lint 0 errors / 56 warnings / 1 info（新回归使用项目既有非空断言风格增加5条warning），日志 /tmp/yonder-r6-final-lint.log；未禁用规则或新增绕过。CLI帮助的socket聚焦4/4通过，日志事实见前文。

R0–R3源码、现场三处根因修复及Yonder自主PR已落地。本轮剩余不是以“全绿”掩盖的完成项：R4全部客户端/TUI/恢复矩阵未齐；R5正式Release和operator更新通知尚待策略授权及实际验证；R6因此仅交付已完成源码/检查/独立安装事实，不能宣布全系统最终验收。用户审核后再恢复依赖其授权的部分，不自行扩大范围或持续例行审查。

## 安装交接：0.1.2026101804

实际独立安装 source `/Users/zoran/.yonder-harness/versions/0.1.2026101804`，唯一 tag `v0.1.2026101804` → `8fe6435eacac819b782b03732ff6238c86af515e`。真实 update 再次干净 clone/npm ci/原生补丁/TypeScript与Swift构建通过，实际控制面 version/commit/home 一致，ready=true，PID70049；菜单栏登录项 running/PID70080。旧版本和标签保留。图标进程/登录项不是菜单点击或重新登录验收。

安装版04在临时独立home重新加载旧数据后，父子取消现场脚本再次通过：父117、子132，子2026-10-18T20:49:21.912Z关闭，真实 native run-end 投影；非仅开发源码测试通过。临时home服务已停止，故障/结果文件保留 `/tmp/yonder-r4-cancel-result.json`，生产服务继续运行。未触碰原维护工作树的未合并历史修改；自主任务的干净工作树仅快进到已审核04，维护工作说明已标明issue#1完成，防止硬编码重做旧任务。

用户入口：`/Users/zoran/.local/bin/yonder` 已作为稳定 launcher 的符号链接创建，未覆盖文件或改shell配置。可用命令：

```sh
yonder chat --channel cli --home /Users/zoran/.local/share/yonder-harness/home
yonder sessions list --home /Users/zoran/.local/share/yonder-harness/home --json
yonder sessions show 1336 --home /Users/zoran/.local/share/yonder-harness/home --json
yonder service info --home /Users/zoran/.local/share/yonder-harness/home --json
```

第一条与默认 main/Luna 交互，选用已配置官方工具；不带channel的 `chat` 则使用原生default独立任务预设。历史会话1336是本次真实自主维修，不是新的测试请求。没有正式Release、自动更新或主人身份映射的成功声明；策略与客户端未完成项见前文。源码交接后的记录提交仅更新文档，不移动安装tag。

只读 `yonder update --check --json` 已实际执行，最新正式Release接口返回HTTP404，命令正确失败并显示真实原因；当前尚未创建正式Release，没有把本地tag或磁盘版本当成最新正式发布。按钮本身仍未点击验收。
