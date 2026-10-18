# C0–C6 与 U05 源码审查

日期：2026-10-18。审查基线：`9c3d39a`，含 U05 `3d31601`。主 agent 亲自阅读、追踪调用链；本次没有派审查 sub agent，没有修改产品代码、运行测试/模型/外部接口或安装。

## 结论与证据边界

**当前不能直接进入日用安装验收。** 已有真实功能体和 workspace 接线，但仍有权限、配置时点、回执、插件加载和终端断连缺口。上轮“所有必需项功能体与调用方完整”的判断过早；应以本报告列出的缺口修正，而不是以构建通过冲抵。

- 审查差异：`e90a647..9c3d39a`，115 个文件，包含功能文档、U05、C0–C6、许可、既有测试及技能资产；逐域追踪新增生产代码与共享调用方。
- 对照：架构不变量、spec/02–09 的相关原契约、10/11/12/13 及 D28/D29/D33。13 对本轮执行者和暂缓测试的较新批准有效；不再以 11 的旧实施顺序否认实际 Codex 贡献。
- 上轮最终 build/typecheck 通过仍是该 commit 的构建证据；本次没有重跑，不提供新的通过计数。
- 以下“确定”指源码控制流可确认，**不表示已动态复现**。协议效果或运行时竞争不足以静态确定的，单列未验证项，不编造失败。
- 当前 Git 工作区进入审查时干净，TUI 和 C0–C6 已全部本地提交；未推送。该报告和下一轮计划另作本地文档提交。

## 一、实现问题：已有契约足以判定

### A. 文件权限与附件

**I01 / P1 / 确定：发送附件绕过文件读取作用域。**

- 位置：`packages/core/src/tools/index.ts:133`、`packages/core/src/delivery/index.ts:378`；`plugins/channel-feishu/src/index.ts:97`、`plugins/channel-feishu/src/channel.ts:391`。
- 触发：配置允许发送到飞书，模型给 message_send 或飞书消息工具传一个工作区外的本机 file: URI。即使当前运行没有 exec，upload 仍直接 `open(path)` 读取主机文件。
- 根因：read/grep 的 canonicalPath 判定只覆盖文件工具；发送附件只检查收件人/message 能力，飞书普通消息工具又以 plugin 身份调用 messages.send，丢掉当前 ToolContext。
- 影响：不能把只读工具的路径保护当成整个系统的保护；模型可借附件上传读出作用域外内容。该问题是新飞书消费者暴露的共享缺口，不是要求增加沙箱。
- 依据：05 §1/3、13 §2.2/2.4。
- 最小方向：在“模型发附件→真实文件读取”的共享边界保留实际调用上下文，复用已有真实路径/本轮附件豁免和执行环境规则；普通插件工具必须走同一入口。不要在每个供应商复制一套权限系统。SDK 表达方式见 D3。

**I02 / P1 / 确定：输入配置只在模型环节取快照，输入准备仍提前使用旧配置。**

- 位置：`packages/core/src/kernel/index.ts:615`、`prompt/index.ts:132`、`runtime/index.ts:662/733`；真正运行快照在 runtime `prepareRun:231`。
- 触发：B 输入排队时按旧 profile 渲染 turn 上下文、下载/筛选/编码图片，之后重载模型、上下文或 env，B 实际开跑读取新配置。
- 影响：正文/附件已经固化成旧配置的输入，而 system/工具/能力使用新快照；不支持图片的旧模型会在入队前把图片降成路径，新模型开跑也拿不到图，反向变化则可能整轮报错。已开始运行时再准备 steer 输入也可能读到重载后的配置。
- 依据：10 §4、03 §5.3、13 §2.4。
- 最小方向：原始事件和稳定附件关联先接纳；依赖运行配置的准备服从同一个原生运行边界。保持一个 pi 队列，不在路由再建配置/媒体队列。实现前核对 pi 的输入落位/steer 调用链，不能只往 inputContent 增加一个 guard。

**I03 / P2 / 确定：新图只按单消息限制准备，超出整请求限制时直接终止运行。**

- 位置：`prompt/index.ts:169`、`runtime/index.ts:675/338`。
- 触发：历史已有图片，新消息自身不过 maxPerMessage，却使整请求图片数或编码字节超限。
- 影响：beforeRequest 对整请求抛错，新的超限图片没有按规范转为可读附件提示。旧历史本身超限时保留历史并报错是正确的，不能把两者混为一类。
- 依据：03 §5.3、13 §2.4。
- 最小方向：与 I02 同一准备入口处理“新图可退为附件/旧历史不可悄悄裁剪”，复用实际模型限制；不加第二份历史。

### B. 子任务与生命周期

**I04 / P1 / 确定：子任务的附件及结构化结果没有接通。**

- 位置：`packages/core/src/tools/index.ts:187`、`runtime/types.ts:37`、`packages/sdk/src/types.ts:168`。
- 当前 task_run schema 只有 preset/task，taskInput 的 session.input 没有附件；返回将 RuntimeRun 压成 `run.text || reason || status` 加 isError。父模型拿不到 child session、明确 status/reason，也没有结果附件通路。
- 影响：底层 RuntimeRun 有 inputs/status，不等于父模型已经获得这些事实；“子结果保留实际身份/状态/原因/附件”的目标未完成。
- 依据：10 §4、13 §2.2/2.4。03 的旧文本工具签名与新附件目标还需固定最小表达，见 D2。
- 最小方向：保留原生 task ownership；结构化返回实际 child 身份/终态，附件显式传递，禁止自动把父全部附件广播给每个子任务。

**I05 / P1 / 确定：子任务入队前失败会留下未关闭的 task 元数据。**

- 位置：`packages/core/src/runtime/index.ts:940–968`、`tools/index.ts:82–128/194`、`sessions/index.ts:211`。
- 触发：原生 child conversation 和 y_sessions 已创建，initialize 中 prepareInput/文件或上下文读取失败，handle.submit 尚未发生。
- 根因：本轮删除 task_run 的 finally close，但唯一终结入口依赖原生 submission 结束回执；此窗口根本没有 submission。恢复又跳过 taskOwned 输入。
- 影响：父工具返回错误，child 却可一直留在 open 列表；没有完整结束事实，不能靠恢复重交消除。
- 依据：02 生命周期、10 §3、13 §2.1/2.2。
- 最小方向：由同一拥有者收尾“尚未接纳”的真实失败，结束/关闭一次；已接纳后的结束仍归原生回执，不能恢复重复 finally 互相争抢。

### C. 插件加载与管理

**I06 / P1 / 确定：可省略配置的 BrowserSkill/Web 无法直接 add。**

- 位置：`packages/core/src/plugins/index.ts:141`、`kernel/index.ts:274`；`plugins/browser-skill/src/index.ts:93`、`plugins/web-tools/src/index.ts:68`。
- 触发：按操作说明执行 plugins add @yonder/plugin-browser-skill 或 web-tools。add 只写 `{use}`；loader 用 undefined 校验 type:object，setup 中的默认 `{}` 根本到不了。
- 影响：最基本的配置/安装入口被拦住，缺凭据诊断也不会被执行。手写 config:{} 能绕开症状，但不是命令闭环。
- 依据：11 §1/4/5、13 §3.1。
- 最小方向：统一可省略配置的加载语义，仍拒绝真正必填的缺失字段。只修 loader/插件约定及消费者，不绕过 schema 校验。

**I07 / P2 / 确定：离线 inspect 不给出完整的有效工具视图。**

- 位置：`packages/core/src/kernel/index.ts:198–213/736–758`。
- 离线只列注册的插件工具，没有核心工具及 offer/search/denied 原因；在线 tools 又从运行中配置计算，result 的 next-run 字段却从磁盘另读。配置文件被拒绝或正在变化时，两部分可能不是同一个版本。
- plugins list/show 的 selectedBy 只遍历 agent profile，遗漏 home/plugin preset 的选用，虽然 remove 另有候选引用校验。
- 依据：13 §3.1/3.3。
- 最小方向：有效工具选择复用一个纯计算入口，明确磁盘候选/已生效配置；选用报告补真实 preset，不增加配置镜像数据库。

### D. MCP 与被动观察

**I08 / P1 / 确定：MCP 非等待 submit 不返回接纳身份。**

- 位置：`plugins/channel-mcp/src/operations.ts:130–143`；`packages/core/src/sessions/index.ts:166–204`。
- CLI 使用 submitAccepted 返回 event；MCP 使用 SDK submit(wait:false)，原函数返回 void，被 json 序列化为 null。
- 影响：控制 agent 无法将这次接纳与后续 run.end 严格关联，尤其同会话多个并发输入时；“再查最近一条”不能代替稳定回执。
- 依据：11 §2、13 §2.3。公共返回类型矛盾见 D1。

**I09 / P1 / 确定：watch 写了 progress 通知，实际 HTTP 传输把它丢弃。**

- 位置：`plugins/channel-mcp/src/index.ts:79`、`operations.ts:146–183`。
- 证据：现有 transport 设置 enableJsonResponse:true；已阅读安装的 MCP SDK `webStandardStreamableHttp.js:824`，relatedRequestId 的非 response 消息仅在 `!enableJsonResponse` 分支写入 SSE。extra.sendNotification 绑定的正是该 relatedRequestId。
- 影响：函数调用成功不代表客户端收到进度；目前只能等 watch 结束后拿 updates，不能称“标准进度通知已接通”。
- 依据：13 §2.3。
- 最小方向：使用现有 Streamable HTTP 的 SSE 响应能力，并保留普通查询/客户端降级；不引入 WebSocket、MCP Tasks 或私有进程订阅服务。

### E. GitHub 与更新

**I10 / P1 / 确定：更新验证会把“当前目录已换、服务有 PID”当成新版真正运行。**

- 位置：`plugins/channel-github/src/update-job.ts:105–129`；`packages/core/src/release/index.ts:220`。
- version 是另起 CLI 读取 current，不是服务自报；service status 是 launchd loaded/PID。runner 只在没有 PID 时等待，看到旧 PID 不同但尚未 ready 的新进程也可能标 verified:true。
- 触发：新版 CLI doctor 能过，服务启动后因端口/锁/渠道启动问题迅速退出或反复拉起；取样瞬间仍可有 PID。
- 依据：10 §2/6，11 §6。
- 最小方向：通过已有本地控制面核对实际服务已就绪及运行版本/commit/home；必要字段由已启动服务返回。CLI 磁盘版本与 launchd PID继续作为证据，不把它们当同一事实，不新增 supervisor。

**I11 / P1 / 确定：作业尚未启动的准备失败会永久封住后续更新。**

- 位置：`plugins/channel-github/src/updates.ts:87–132`。
- 触发：mkdir(release目录) 已成功，随后 request 写入、runner 复制或 plist 写入失败，bootstrap 尚未调用。
- 后果：无 result 的旧目录阻止其他 release；同 release 返回 readUpdate，request 缺失时又直接失败。没有“仅查询”能补出 result，用户只能手工处理私有目录。
- 依据：10 §6 的可查询更新结果及明确未知窗口。
- 最小方向：明确未调用 bootstrap 的失败可记录为未调度/清理自身暂存；只有真正越过派发边界才保留结果未知和禁止重发。不要把所有异常都升级成永久未知，更不要自动重试更新。

**I12 / P2 / 确定：GitHub 评论工具绕过共同发送回执。**

- 位置：`plugins/channel-github/src/index.ts:90–110`，直接调用 c.send；正常渠道自动回复则经 core delivery。
- 影响：工具转录存在，但没有共享 message.attempt/message.out/unknown 的对应记录；相同的评论发送有两种责任路径。
- 依据：06 投递事实、10 §3、11 §6 的真实发送/回执边界。
- 最小方向：普通评论经既有 messages.send/共同投递，保留专用 marker；自定义 PR 操作继续留供应商工具，不为所有 GitHub REST 建通用 outbox。

### F. TUI 与 CLI

**I13 / P1 / 确定：观察断连后仍保留旧订阅，允许继续盲发。**

- 位置：`packages/cli/src/terminal.ts:339–344/397–405/628–665`。
- disconnect 消息只 notice；observers 里仍有旧连接，info 也仍在。后续 submit 不确认观察在线，watch 又因 observers.has 直接返回。
- 影响：服务恢复后请求可成功，但 UI 没有过程和终态；用户容易以为没执行而重发。当前断连提示也不重置运行事实。
- 依据：12 §6/7，13 §2.3。
- 最小方向：把失效观察从当前目标移除；恢复观察后读真实快照/历史再允许发送。不能自动重发原输入，也不要缓存第二份转录。

**I14 / P2 / 确定：最终文本为 N、NO 等时会被当成 NO_REPLY 隐藏。**

- 位置：`packages/cli/src/terminal.ts:309–314`。
- `.startsWith(text.trim())` 对流式前缀有意义，但同一逻辑也用于完整/历史消息；最终回答“N”或“NO”因此消失。
- 依据：06 §4、12 §4 的实际内容与历史一致。
- 最小方向：只在 streaming 期间等待控制标记前缀，完成态只精确匹配 NO_REPLY。

**I15 / P2 / 确定：多目标渠道中的 /skills 没有选择目标，底栏详情也被最后一个异步刷新覆盖。**

- 位置：`packages/cli/src/terminal.ts:257/399/525–532/601–606`。
- 多 route 会 watch 多个 session，但共享 info 只留下最后一次返回；/skills 直接显示 info.skills，不使用规范要求的原生目标选择器。run.end 的异步 refresh 还能在切换目标后写回旧 info。
- 依据：12 §4/5.2，目标归属必须真实。
- 最小方向：显示与动作明确绑定当前选中目标，对已切换目标的旧返回不写回；沿用现有选择组件，不建每目标 UI 状态平台。

### G. 文档事实

**I16 / P2 / 确定：更新说明宣称已有失败回退，实际只有保留旧版本和手动 rollback。**

- 位置：`plugins/channel-github/README.md:113`、`src/update-job.ts:141`；实际 updater `packages/core/src/release/index.ts` 在切 current 后重启，没有自动切回流程。
- 09 §6 明确回滚是 update --to <旧版本>，并未要求自动回退。本轮应删掉错误能力声明，保留手动恢复流程；不能为了兑现错误注释临时设计自动回滚平台。
- C6 操作说明/计划中的“全部功能体和接线完整”须同时引用本报告的缺口，不继续向外宣传已齐。

## 二、设计问题：本次不擅自改锁定规范

这些是接口或行为边界需要确定；不是将上面的实现 bug 重新归类为“文档没写所以不用修”。推荐在下一轮 R0 一次性审核必要的精确文档 diff，其余原规范不动。

**D1：异步接纳回执的公共表达。**

11/13 要求返回原生 event/session，SDK SessionsAPI.submit 仍冻结为 Promise<RunResult|void>，CLI 有私有 submitAccepted。建议把“接纳回执”和 wait:true 的 RunResult 在同一公开接口中说清楚并接到 MCP；复用现有接纳事件，不引入 task id/state。需要同时更新 02/04/13 的相关签名和全部调用者。具体 TypeScript 兼容签名先列 diff，不临场留两套互不一致的 submit。

**D2：子任务附件的选择与产物格式。**

13 已要求保留附件，但 03 的 task_run 仍只有文本参数；目前也没有“最终产物附件从哪里取”的确定契约。建议输入显式可选附件、不自动继承父全部附件；结果保留 child/session/status/reason/text，附件只返回实际存在且明确交付的产物引用。没有产物就不虚构附件；不新增 artifact 数据库。需锁定最小字段和附件读取权限，之后再补实现/测试。

**D3：普通发送的调用上下文与不确定结果。**

当前 PluginAPI.messages.send 只有插件身份，供应商 send 多数 catch 后返回 ok:false；core 仅在 throw 时记 unknown，另用中文错误前缀识别未知。这使“模型代发还是插件主动发”及“明确失败还是可能已发送”在接口上不稳定。

建议让普通模型发送保留真实 ToolContext/会话归属，沿用共同权限与投递；Delivery 用一个最小结构化字段表达不确定结果，替代错误字符串协议。供应商只报告它能证明的事实。精确签名需审核；不加审批、自动重试、第二套投递数据库或任意消息 DSL。

**D4：首次启用 Release 源的历史边界。**

当前 releases.ts:86–119 将所有历史正式发布按时间发送，未保存初始基线前会唤醒 operator 多次。规范没有明确首次启用要补发多少历史发布，也未规定 apply 模式如何避免处理老版本。

建议首次建立当前发布基线，历史可显式查询，后续只接新发布；如需要首次立即升级，只处理一次当前批准目标，不能把整段历史依次应用。该行为改变需先确认；现有显式 update --to 仍可用于人工回滚，不新增复杂版本策略。

## 三、过度设计与防御代码评估

**O1 / 建议精简：BrowserSkill 保留不可达 Windows 分支。**

index.ts:194 限制 darwin/node:local，runner.ts:78/107/123/143 却维护 Windows 的宽限、stdin EOF 和环境分支。当前无 Windows 使用方。下一轮删这部分及无关说明，保留 macOS 实际需要的取消、进程退出/管道收尾、原生 request 所有权。不能因“看起来复杂”删除真实资源保护。

**O2 / 建议精简：重复实现 JSON Schema 标量校验。**

Browser operations.ts 的 validateField 自制了数组/枚举/数字校验；Web 同时维护 schema 与大段重复标量校验。原生 pi 工具层已经校验 parameters。建议复用已装 TypeBox/既有边界，只保留动作相关互斥、trim、跨字段和原生协议检查；不重新写第三个 validator，也不弱化插件直接调用的受支持边界。

**O3 / 建议收窄：管理入口全量重复装载。**

manageHome 在判断 models.list/skills.remove 前加载全部插件和 agents，在线也重复 setup；模型目录这种独立查询会被不相关插件配置拖垮。当前没有必要给它再做缓存/健康服务。把独立读取分支前移，其余继续复用同一 loader 与引用校验即可。

**保留，不作为过度设计删除：**

- D28/D29 原生边界与回执：服务真实恢复缺口；没有另建执行队列。
- 消息 attempt/unknown：保护实际外部副作用，不应改成自动重发。
- Browser 原生 request ownership/串行化与清理：上游约束，不是新任务系统；只删除不可达平台代码。
- GitHub 独立 launchd runner：锁定的自更新责任边界，不是额外 supervisor；修 I10/I11，保留服务外执行。
- Feishu 官方 SDK reconnect、协议去重及核心跨 emit 去重：分别管理传输和输入接纳，不能仅凭“都叫去重”删一层。
- 回执历史扫描已标 ponytail 成本上限；本次不在无性能证据时加缓存/索引。
- 工具结果最终文本已有 pi 原生 boundContent；本次核对后**不**重复增加全局截断层。GitHub REST 聚合的内存成本和检索分页体验留运行证据，不冒称已无限占用模型上下文。

## 四、逐模块覆盖与尚未验证的内容

- **core/runtime + 补丁**：读恢复、开始快照、回执/用量、上限、权限、父子、图片、观察与原生关键调用；I01–I05。崩溃/取消/steer 的实际竞争留 N09，不把静态没有发现当通过。
- **router/sessions/store/delivery**：读稳定 requestId、原消息去重、waiting/busy、唯一终结、发送尝试与历史恢复。run.end 后尚未 attempt 的最终消息，恢复会通过原生 receipt 再进入投递；因此本报告**不**错误地宣称“run.end 后崩溃必丢最终消息”。重复投递由 attempt 阻止，实际窗口仍须验证。
- **配置/插件/Skills**：加载/候选校验、热重载、保护未关闭引用、原子写、技能复制/删除与符号链接规则；I06/I07。未执行新增管理命令。Skills 选择仍由 profile.skills 控制；未把 plugin.tools 的选择规则误套为所有 skill 自动不可见。
- **BrowserSkill**：七工具的 schema/argv/runner/request/清理、skill/参考与许可清单；O1/O2。扩展连通、引导打开、真实动作/图片/上传下载未验收。
- **Codex**：app-server RPC、发现/JS/重置、搜索禁用面/原生证据、取消与清理完整阅读；本次未发现足以单列的新增确定错误。实际 AX/截图/动作、线程隔离和当前账号 hosted search 必须安装版实测；这不是“已通过”。
- **Web**：Tavily 两入口、有界 HTTP/提取/重定向/错误与取消完整阅读；O2。中文/新闻/域限制、正文提取质量与登录/JS 提示需真实页面验证，不增加供应商回退。
- **GitHub/Release**：轮询、分页/水位、账号标签/自身评论、PR、独立 updater 完整阅读；I10–I12、D4。真实授权、issue→PR→审核→Release→安装链未跑。
- **飞书**：连接/入站/附件/模板和自定义卡片/CardKit/回调/大小/取消完整阅读；I01、D3。官方接口响应、音视频可播放、客户端呈现、按钮与断线恢复均未验证，不用源码判断宣称 API 兼容。
- **MCP**：新 watch 与实际 transport/SDK 发送分支，submit 及原工具消费者；I08/I09。断连不杀模型的目标保留，真实客户端通知留下一轮。
- **CLI/TUI**：新增命令/补全、观察/目标切换、消息包装/工具/页脚、U05 差异与原生组件边界；I13–I15。完整恢复历史的成本、shell 补全、键位与视觉仍须真实 PTY/截图；没有重新设计界面。
- **根组装/资产**：workspace、TS 引用、锁文件、包 files/exports、许可、README/CHANGELOG 与原测试资产；I16。上轮构建证据有效，干净安装/生产依赖和实际打包尚待验证。U05 测试与 N06/N07 原测试是既有成果，本审查未改断言或运行。

下一轮按 [补测试、修复与安装验收方案](repair-acceptance-plan.md) 执行；**该方案未批准，本次不开始开发或运行。**
