# 多设备执行 W0–W5 隔离集成（2026-10-26）

后续独立验收补充：Linux **ARM64 execution-only** 四包在已缓存 Node 24 的无网络临时容器内通过 SHA、离线安装、`init`、两轮 `serve`/停止和同一临时 home 身份保持；默认无 peer/grant，四项 GUI 能力实际为 unsupported/degraded，短测容器内存峰值约 74.3 MiB。它不验证已配对 signed RPC、真实 GUI、Linux full/systemd、x64 或生产服务。完整 A1–A12 现状与阻塞见本任务独立文档 `/Users/zoran/Documents/Codex/2026-10-26/task/multidevice-handoff-2026-10-26.md`；尚无整项签收。

独立无模型执行契约包、默认 devices 插件、execution-only CLI、账本/单 daemon 写锁、双端离线配对、HTTPS direct 和可选 Card 常驻连接已在本隔离树接线。W1 锁竞态、请求/效果原子回执及设备描述权限过滤已修；保存失败后 daemon 会故障封锁，直连/中继同 request 不返回未持久化的成功、也不派发新命令，重启才从磁盘恢复。W2 的 cached/fresh target 展示按当前 grant 过滤。实际 CLI 子进程与默认插件在临时双 home、本地 Card/PG/Redis 中完成 direct、relay、双路查询回退及命令去重；Card relay 源码位于独立未部署的 Card 树，Card 进程拓扑仍需核实。仅显式配置已配对设备、grant 和路由才连接，不进行隐式发现。完整程序新增 Linux systemd 用户单元、Windows 当前用户登录任务与命名管道适配；Mac 本机构建通过，Linux/Windows 安装与真实运行尚未验收，Windows 注销常驻和异常自动重启尚未实现。Linux GUI 驱动 `agent-device@0.21.31` 按需安装，真实 guest GUI、应用清单和模型自主选设备尚未验证；首版 checkpoint restore 明确 unsupported。全仓默认测试 788 通过、1 项原基线 memory 周号夹具失败、43 跳过；完整构建和 lint 退出 0。W0 证据见 proposals/multidevice/W0-verification.md；这些隔离测试不构成生产发布、VM 隔离或六端安装验收。

# 项目状态

更新：2026-10-27。版本 0.2.26102701，开发者预览。本页是“现在到哪了”的唯一入口：规范（`spec/`）是目标，本页记录现实与差距。

本轮把分散的 W0/W2/W4 多设备执行、T61 观测与 T63 凭据槽位、状态栏与看板摘要、任务面板并入 main：`npm run build`、`npm run typecheck`、`npm run lint` 退出 0；默认 `npm test` 138 文件通过 / 22 跳过，856 用例通过 / 0 失败 / 43 跳过；`npm run test:node` 10 通过 / 0 失败。真实模型与真实后端验收未执行。ui-companion 的两个浏览器契约用例在 160 并发下曾因 Chrome 启动超时而失败，单独运行 5 用例全部通过，属并发下的不稳定，不是代码回归。

运行时效率改造（同日）：新增 `signals`（信号分级与同类聚合）、`status`（状态面，`.yonder/status.json` + 10 秒心跳）、`retention`（日志轮转、后台日志合并、派生物正文回收）、`task_current` 投影表与文件行数门禁。`npm run build`、`npm run typecheck`、`npm run lint` 退出 0；默认 `npm test` 150 文件通过 / 22 跳过，915 用例通过 / 0 失败 / 43 跳过。状态面使空闲时不再派生 `service info` 进程；账本正文回收按 30 天、单轮 50 MB 预算执行。**未测**：真实服务在改造后连续运行 24 小时的 CPU 与内存曲线；账本回收在真实 home 上的实际释放量（抽样验证了 12/12 条正文在转录中有副本，但未跑全量回收）。

任务恢复（D46）：已实现消息/运行/后续责任分离、内部委派跨重启重接、真实错误保留、后台结果接纳补交及确定未发送通知补达；207项真实验收及macOS CI通过；正式03已由日用apply策略自动升级并核验，飞书升级通知送达。完整原始记录见 [task-recovery](verification/task-recovery.md)。

状态用词：**已实现**＝功能体、调用方与打包接线齐全；**已验证**＝有记录的真实调用结果。接口存在、工具注册成功、API 返回消息 ID 都不等于验收通过；一次成功也不覆盖未试过的组合。

## 任务回报与确定性可见性（2026-10-27，集成分支，待审核）

`yonder/runtime-discipline`（`58a9850`，原决策 D57）按当前主线重新落地：task 会话的最终回报必须以 `STATUS: done|partial|blocked` 起头并给实际证据，空回报与 `NO_REPLY` 归一为 `STATUS: unknown (no report)`（原生 status 与转录不变）；`agent_ask` / `task_run` 描述要求目标、材料、完成标准、边界、遇阻条件和证据；后台完成在续办收尾后按可见事实发一条兜底，`run.end` 保存通知意图、重启只补尚未尝试的；静默心跳复用运行软提醒计时器，生产 5 分钟、每轮最多 6 次、不调用模型；`runtime.discipline` 纪律段只在 modelId 完整匹配 `^gpt-\d+(?:\.\d+)?-(?:luna|sol)$` 时装入，可被 `prompt.sections` 排除。决策按现行惯例记为 `## 2026-10-27 任务回报与确定性运行可见性`（D57–D67 已被占用）。

`npm run build`、`npm run typecheck`、`npm run lint` 退出 0；默认 `npm test` 153 文件通过 / 23 跳过，959 用例通过 / 0 失败 / 44 跳过；lint 550 warnings / 16 infos，文件行数门禁通过。**未测**：真实模型验收（本轮环境未配置 `YONDER_TEST_REAL` / `YONDER_TEST_AUTH`，新增的 `runtime-discipline.test.ts` 默认跳过）；真实飞书卡片编辑与其他渠道的端到端显示。完整移植差异、跳过项与原始计数见 [运行纪律移植验收](verification/runtime-discipline.md)。

## 任务账本候选（未定版本，2026-10-25，待审核）

本轮 PR #82 机械同步（2026-10-25）：在指定任务 worktree 的干净分支合并 origin/main `8f2cfcb`（PR #77–#81，0.2.26102509），合并提交 `10a6915`。27 个冲突文件为 CHANGELOG、package-lock 和 25 个 package.json；无代码冲突。版本冲突采用 main，tasks workspace/锁文件链接与依赖保留并对齐 .09。后续提交 `462b027` 撤销 1346529 的发布准备声明，tasks 变更留在 Unreleased；已发布 CHANGELOG 段落逐字等于 main，已有包版本/依赖与锁文件版本核对通过。docs/verification 历史记录保留，候选等待独立 release PR 定版本。

本轮从干净 Git 状态执行以下命令（依次完成安装、构建、类型检查和测试，没有并发重装依赖）；命令均 exit 0，没有检查失败或修复重跑：

| 实际命令 | 本轮原始结果 |
|---|---|
| `agent-network run -- git fetch origin` | 通过 |
| `git merge --no-commit origin/main` | 预期冲突，按上述规则解决并提交 |
| `agent-network run -- npm ci` | 通过；新增 334 包，审计 361 包；4 vulnerabilities（2 moderate / 2 high），未自动修复；3 包 install scripts 提示未获 allowScripts 授权 |
| `agent-network run -- npm run build` | 通过，含 worktree 内 macOS Helper 构建/签名验证；未安装 |
| `npm run typecheck` | 通过，0 errors |
| `npm run lint` | 通过，406 files，0 errors / 482 warnings / 14 infos |
| `npm test` | 文件 117 passed / 0 failed / 19 skipped；用例 730 passed / 0 failed / 39 skipped（769） |
| `YONDER_TEST_REAL=1 YONDER_TEST_AUTH=/Users/zoran/Documents/yonder-harness/.yonder/auth.json agent-network run -- npm test -- plugins/tasks/test/moments.test.ts` | 文件 1 passed / 0 failed / 0 skipped；用例 4 passed / 0 failed / 0 skipped，含真实 openai/gpt-6-luna stall 检查；凭据仅由测试读取，未打印 |

本轮未测（not tested）：默认跳过的 39 个用例中，除上述 moments 真实用例外的其他真实模型/环境专项；历史 task-presets-live 失败未重跑；独立构建版 smoke、真实飞书、已安装 macOS、生产服务、TCC/定位授权与升级均未测。本轮未发布、安装、操作生产 home 或已安装服务；既往失败与计数继续保留在下文，不以本轮成功覆盖。原始本机日志：`/tmp/task-ledger-82-{ci,build,typecheck,lint,test,real}.log`。

任务 worktree 合并 origin/main `78ae9de`（PR #74–#76），合并提交 `fcc176a`。companion 同页保留 Agent 概览/图钉与任务看板；渠道实例范围、permissions API 及两侧历史记录保留。此前 release-prep 提交 1346529 的版本准备已撤销：本功能候选未定版本，等待独立 release PR；包版本沿用 main 的 0.2.26102509，不表示 tasks 已发布。以下保留此前验证的原始记录；当时未推送、打 tag、发布或安装。

干净安装、build、typecheck、lint 通过（0 errors / 478 warnings / 14 infos）；默认全量 114 文件通过 / 19 跳过，681 用例通过 / 0 失败 / 39 跳过。真实专项首轮被执行者并发 npm ci 破坏 worker 后中止（exit 130，无完整计数）；完整重跑为 48 文件通过 / 1 失败 / 1 跳过，141 用例通过 / 1 失败 / 1 跳过。失败的官方 task-presets-live 父预设只提供 task_run，coding 子任务按现有契约继承后无文件/Shell 工具；相关源码/测试与 main 完全相同，未为本次合并扩大修复，也不宣称候选全绿。execution-live 硬编码 worktree 凭据路径，未测。任务插件 moments 定点真实检查 4 通过 / 0 失败 / 0 跳过，Luna 实际 read/tasks_update 后标记 blocked。

此前构建版在独立 `/tmp/yonder-task-ledger-rc-smoke` 返回 .07/ready=true（历史验证值，不作为本候选版本）；真实 Luna 经真实 loader 完成 tasks_open → tasks_list → tasks_show，T1 一致，companion/board HTTP 200、Chrome 可见看板；临时进程已停止。首次 smoke 因临时配置缺少 research 依赖 web-tools 启动失败，恢复该插件后通过。生产/安装/渠道/原生鼠标与 TCC 均未测。完整命令、原始失败、结果与截图入口见 [发布候选验证](verification/task-ledger-release.md)。

## 任务账本 P3a renderers（2026-10-25，任务分支待审核）

仅在 `/Users/zoran/Documents/yonder-harness-tasks` 的 `feat/task-ledger-20261025` 实施，基于已提交的 P1/P2/P3-1、D66/D67。本轮一个逻辑提交覆盖三个插件；没有推送、发布、安装、修改生产 home 或操作已安装服务。

**已实现**：tasks 在随机路径 loopback 服务发布调用者可见范围内的 `{board,text}`；ui-companion 现有页面显示固定四组、计数、任务字段、滞留标记、详情/逐项证据/交付/事件/嵌套子任务，每秒刷新，刚完成默认收起，刷新保留滚动；复用网页徽标及原生 state/attention/current 机制。飞书通过现有 Attachment 投递路由接收 source URL，每会话当前看板卡每两秒读取、文字变化时带递增版本 PATCH 原消息；显式请求重新发送为最新锚，发送失败回退现有 PNG/文字路径。没有 renderer 任务状态机或账本读取，没有管家视图、操作按钮、新工具或生产配置。

SDK services 只有 resolve、没有发布注册接口，采用既有私有端点文件惯例；ui-companion 发布 renderer.json，飞书按实例发布 task-board.json 路由声明。tasks 不 import 其他插件，SDK/core/原生源码和全部受保护设计文档、prompts.ts 均未改。协议和最简单解释见三个插件 README 的 Questions for the maintainer：首次展示/重启需 tasks_show 建立范围；最近一次请求决定当前范围；飞书历史消息保留，只刷新最新锚；PATCH 不确定失败暂停该卡自动更新，显式 show 重接。

**实际验证**：真实 loader/kernel、SQLite、ChannelIO 和本地 HTTP 协议服务；FeishuApi 仅把 HTTP transport 接到隔离的本地协议服务器，实例走真实 start/stop（隔离 home 无飞书凭据，外部连接未启动），没有模拟模型。网页使用后台独立 Chrome profile 与 CDP，读取真实服务页面，验证分组顺序/刚完成收起/详情/证据/子任务/跨 Agent 隔离/账本变化后自动刷新/长静默标记/滚动保持/悬浮入口/current 入口。测试按调用者自己的范围发布，外部 Agent 详情返回 400。飞书验证首次仅一条、无变化不 PATCH、变化 PATCH 同 ID 且版本增加、显式请求新 ID、后续只 PATCH 新 ID、平台拒绝时真实 PNG 上传和发送。浏览器无 Chrome 时该用例显式 skip；本机未跳过。

原始命令与结果（passed / failed / skipped；未覆盖旧失败）：

| 命令 | 原始结果 |
|---|---|
| `npm run build` | 第一次 exit 2，4 个 TS 错误：promise setTimeout 与轮询函数同名造成 3 个类型错误，server 可选字段严格类型错误 1 个。改为 globalThis.setTimeout 和显式 undefined 联合类型后，4 次均 exit 0；含项目既有 macOS 编译/自检与网页资源构建，没有安装/启动原生应用 |
| `npm run typecheck` | 两次 exit 0 |
| `npm run lint` | 两次 exit 0；0 errors / 461 warnings / 14 infos |
| `npm test -- plugins/tasks/test plugins/ui-companion/test plugins/channel-feishu/test` | 首次 91 / 2 / 1，9 文件通过 / 2 文件失败，另有 1 unhandled rejection。测试夹具 active 直接 done 违反既有状态契约；HTTP FormData 错标 JSON 导致协议服务器解析异常和超时。修正夹具，不改状态机/断言/超时 |
| `YONDER_BOARD_SCREENSHOT=/tmp/yonder-task-board-detail.png npm test -- plugins/tasks/test plugins/ui-companion/test plugins/channel-feishu/test` | 首次 91 / 2 / 1：飞书夹具只启动卡片存储，实例仍 stopped；Chrome 启动标签页导航竞争。修正为真实实例 start/stop，浏览器独立测试标签页；最后两次均 93 / 0 / 1，11 文件通过 |
| `npm test -- plugins/ui-companion/test/contract.test.ts plugins/channel-feishu/test/contract.test.ts` | 5 / 2 / 0，仍为上述实例生命周期与浏览器导航问题；增加协议/导航诊断，没有扩大超时 |
| `YONDER_BOARD_SCREENSHOT=/tmp/yonder-task-board-detail.png npm test -- plugins/ui-companion/test/contract.test.ts plugins/channel-feishu/test/contract.test.ts` | 6 / 1 / 0，飞书已通过，Chrome 返回 net::ERR_ABORTED |
| `npm test -- plugins/ui-companion/test/contract.test.ts` | 3 / 1 / 0，网络诊断确认导航被取消；改为独立测试标签页后通过 |
| `YONDER_BOARD_SCREENSHOT=/tmp/yonder-task-board-detail.png npm test -- plugins/ui-companion/test/contract.test.ts` | 4 / 0 / 0，截图输出成功 |
| `node plugins/ui-companion/test/state.mjs` | exit 0，既有状态自检通过（脚本没有测试计数汇总） |
| `npm test` | 608 / 0 / 39（647），103 文件通过 / 0 失败 / 19 跳过（122），默认运行未启用真实模型 |
| `git diff --check` | exit 0 |

格式化仅作用于触及的插件源码、测试和 package.json：早期 `npx biome check --write` exit 0，分别报告 6 和 57 warnings；后续局部格式化同为 exit 0。最终以完整 lint 的 461 warnings / 14 infos 为准，不把 warning 当失败或删除既有检查。

本机实图已检查：`/tmp/yonder-task-board-detail-overview.png`（总览和嵌套子项）、`/tmp/yonder-task-board-detail.png`（详情和逐项证据）。图来自真实发布账本的浏览器测试，不是静态 mock。

**未测**：真实飞书平台/客户端卡片外观与更新；已安装 macOS 浮球、焦点、全屏及多屏；生产部署；resvg 故意缺失的文字降级；干净 npm ci。未调用真实模型（本轮是确定性渲染/协议，无模型判断变更），因此没有读取指定生产 auth 文件；默认跳过项不是通过。范围外的管家视图、后台日志尾部未实现。

## 任务账本 P3-1（2026-10-25，任务分支待审核）

- 仅 `/Users/zoran/Documents/yonder-harness-tasks`，`feat/task-ledger-20261025`。A `45c69e1` 为 SDK 类型及真实内核投递组件测试；B 为本节记录的 tasks 展示。未推送、发布、安装或操作生产服务；指定 auth 文件仅作为真实模型测试凭据入口。
- **已实现**：TaskBoard 纯数据投影、固定四组及计数、30 分钟刚完成窗口、每账本稳定 T<n>/UUID 兼容、原可见范围、验收证据计数与父子树；tasks_show board/detail JSON、文字/SVG/resvg PNG；程序附件发送；默认启用的 beforeSend 尾部摘要、每目的地持久去重、事件账本推导的两小时离开摘要。仍无桌面/网页端点、飞书卡、管家视图、后台输出尾部。
- **实际验证**：真实 SQLite、loader、kernel、本地 ChannelIO 与附件文件；纯 SVG 被 resvg 真实解析，PNG 文件头校验通过，实际图片已查看（本机 `/tmp/tasks-p3-board.png`）。摘要测试调用真实注册 hook 和事件查询 API，不模拟模型；SDK 测试沿用真实内核 createDelivery/SQLite 协议驱动，未把手工 ToolContext 当真实工具调用。真实 Luna stall 用例单独启用并通过。

原始命令与结果（通过 / 失败 / 跳过；保留失败尝试）：

| 命令 | 实际结果 |
|---|---|
| A `npm test -- packages/core/src/kernel/before-send.test.ts`，三次早期尝试 | 每次 0 passed / 1 failed / 0 skipped，1 文件失败；手工及 beforeRequest 上下文都不是原生工具 invocation，messages.send 返回“需要真实运行中的工具调用上下文”。删除该错误测试入口，改用现有内核投递协议驱动；未改运行时授权 |
| A `npm test -- packages/core/src/delivery/delivery.test.ts` | 11 passed / 0 failed / 0 skipped，1 文件通过 |
| `agent-network run -- npm install --workspace @yonder/plugin-tasks --save-exact @resvg/resvg-js` | exit 0；安装 3 包，锁定 resvg 2.6.2；npm 报审计项 1 moderate / 2 high，未运行范围外 audit fix |
| B `npx biome check --write plugins/tasks/src/board.ts plugins/tasks/src/digest.ts plugins/tasks/src/store.ts plugins/tasks/src/index.ts plugins/tasks/src/moments.ts plugins/tasks/package.json plugins/tasks/test` | 首次 2 errors / 20 warnings，修正 5 文件；escape 名称及隐式 any 待修 |
| B `npx biome check --write plugins/tasks/src plugins/tasks/test/board.test.ts` | 首次 2 errors / 47 warnings，修正 3 文件；修正 escape → escapeXml、attachments 显式类型后重跑 0 errors / 47 warnings |
| B `npx biome check plugins/tasks/src plugins/tasks/test/board.test.ts --diagnostic-level=error --max-diagnostics=100` | 修正前诊断确认上述 2 errors |
| B `npm run build` | 首次 exit 2：EventQuery.conv 不能显式传 undefined；改为条件字段。之后构建均 exit 0，包含本地 macOS 构建和 ui-companion 静态资源构建；未安装或启动应用 |
| B `npm run typecheck` | 三次均 exit 0 |
| B `npm run lint` | 三次均 exit 0；0 errors / 445 warnings / 14 infos |
| B `npm test -- plugins/tasks/test` | 三次均 13 passed / 0 failed / 1 skipped（14），3 文件通过 |
| B `npm test` | 两次均 606 passed / 0 failed / 39 skipped（645）；103 文件通过 / 19 文件跳过（122） |
| B `YONDER_TEST_REAL=1 YONDER_TEST_AUTH=/Users/zoran/Documents/yonder-harness/.yonder/auth.json agent-network run -- npm test -- plugins/tasks/test/moments.test.ts` | 4 passed / 0 failed / 0 skipped，1 文件通过；真实 openai/gpt-6-luna stall 检查已测 |
| `git diff --check` | exit 0 |

最终按 build → typecheck → lint → 插件测试 → 全仓默认测试顺序运行。最后一次修改把离开窗口内的首次回复判断限定在“两小时以后”，避免把离开前的普通回复算进窗口；随后的完整检查结果如上。其他局部 Biome 格式命令均只作用于 tasks 的 board/store/digest 或 A 测试文件，最终全仓 lint 为准。prompts.ts 与本期开始时完全相同。

**维护者问题/本期解释**记录于 [tasks README](../plugins/tasks/README.md#questions-for-the-maintainer)：编号按账本稳定；总览独立于 postRetain；open 归进行中、计数包含子任务；摘要无变化不重发，先落去重记录再投递存在漏送窗口；人类来源使用现有 acct/person message.in，SDK 未提供通用人类标记；owner 别名不猜；PNG 保留在插件 data；验收 met 仅计算已有 evidence。未改 spec/17、architecture、decisions、index 或现有 prompts 原文。

**未测**：真实微信/飞书等用户渠道；resvg 缺失/加载失败时的文字降级执行；SDK beforeSend 的完整真实模型出站调用（已测真实内核投递组件）；默认跳过的其余真实模型项目；spec 17 §9 n≥10 对照、多任务中断模型验收、postCompact 成功模型压缩；干净 npm ci；生产服务/发布升级。Luna 4/4 只证明该现有 stall 场景，不外推 P3 真实模型完整体验。

## 任务账本 P2 与 resident 插件输入（2026-10-25，任务分支待审核）

- 范围：仅 `/Users/zoran/Documents/yonder-harness-tasks`，`feat/task-ledger-20261025`；A `abdc211` 为 core 输入通路，B 为 tasks P2。没有推送、发布、生产 home 修改、安装或服务操作；基础分支继续保留 P1 提交。
- **A 已实现**：仅插件 `sessions.submit → submitFrom` 可向打开的 main/persistent 会话投递；复用原 session.input 落盘、runtime submission、当前 profile/capabilities、busy 队列及恢复机制。事件来源 `plugin:<id>`，模型输入明确为系统提醒、不携带人类授权，不补造 parent/owner 来源。普通 submit 保持 task-only。SDK 仅补注释；spec/02 §5 只更正原本禁止插件向 resident submit 的一句；不改 architecture/decisions。
- **P2 已实现**：`tasks-moments` Trigger 启动检查并每轮结束约 60 秒再检查；从账本时间推导到期，先追加 moment，再记录 moment-result（API 回执或错误），跨重启按窗口去重。stall 默认 30 分钟、仅 active、followup 到 owner session；user-wait 默认 120 分钟、直发 origin、中文 locale 本地化、不唤醒模型；tasks_nudge 需 cross-agent，以调用方 Agent 名构造维护者 NUDGE_INPUT，输入事件仍为 plugin:tasks。postCompact 默认关闭，done 15 分钟后调用 compact 一次；postRetain 默认关闭，done 30 分钟内 tasks_list 每项 recentlyDone 为 true。只接受 stallMinutes/userWaitMinutes/moments 三个配置键。
- **实际验证边界**：临时 SQLite、真实插件 loader/kernel/runtime admission、本地协议渠道；beforeRequest 暂停/取消 provider 请求，没有模拟模型。覆盖两个 resident mode、来源与当前能力、busy followup 入队、关闭/未知拒绝、task 输入、持久事件；P2 覆盖非 active 不 stall、窗口内一次、下个窗口重发、真实 kernel 重启不重发、用户通知无模型、缺 origin 跳过、催办到 owner/关闭或缺失拒绝、postCompact 默认关/开启调用后记录真实能力错误且只尝试一次、recentlyDone 30 分钟边界。

本次原始命令记录（通过 / 失败 / 跳过；未用后一次成功覆盖失败）：

| 阶段 / 命令 | 真实结果 |
|---|---|
| A `npx biome check --write packages/core/src/kernel/plugin-input.test.ts packages/core/src/sessions/index.ts packages/core/src/prompt/index.ts packages/sdk/src/types.ts` | exit 0，修正 1 文件；0 errors / 6 warnings / 4 infos |
| A `npm test -- packages/core/src/kernel/plugin-input.test.ts`，最初三次 | 每次 0 passed / 1 failed / 0 skipped；前两次临时 home 默认 preset 引用未注册插件/上下文，第三次测试事件未使用插件 x 命名空间；修正测试装配 |
| A `npm run build`，首次 | exit 1；2 个测试 TypeScript 错误：kernel.events 不暴露 emit、submit 返回 union 未指定 wait:false；改用真实 PluginAPI 并明确回执类型 |
| A `npx biome format --write packages/core/src/kernel/plugin-input.test.ts`（两次） | 均 exit 0，各格式化 1 文件 |
| A `npm test -- packages/core/src/kernel/plugin-input.test.ts`，修正后 | 1 passed / 0 failed / 0 skipped；1 文件通过 |
| A `npm run build`，修正后 | exit 0；原生构建、并发 power lease/64 次 pmset 与 ui-companion 构建通过；产物仅在 worktree |
| A `npm run typecheck` | exit 0 |
| A `npm run lint` | exit 0；0 errors / 396 warnings / 14 infos |
| A `npm test` | 598 passed / 0 failed / 38 skipped（636）；101 文件通过 / 19 跳过（120） |
| B `npx biome check --write plugins/tasks/src/index.ts plugins/tasks/src/store.ts plugins/tasks/src/moments.ts plugins/tasks/package.json plugins/tasks/test/tasks.test.ts` | exit 0，修正 3 文件；0 errors / 11 warnings |
| B `npx biome check --write plugins/tasks/test/moments.test.ts` | exit 0，修正 1 文件；0 errors / 6 warnings |
| B `npm run build`（两次） | 两次均 exit 0；第二次包含最终时点逻辑与协议测试修正，原生与网页构建通过 |
| B `npm test -- plugins/tasks/test`，首次 | 8 passed / 1 failed / 1 skipped（10）；1 文件通过 / 1 失败；本地测试渠道 send 错把第一个 target 参数当 message，修正为 send(target, message) |
| B `npx biome check --write plugins/tasks/src/store.ts plugins/tasks/test/moments.test.ts` | exit 0，修正 1 文件；0 errors / 11 warnings |
| B `npm run typecheck` | exit 0 |
| B `npm run lint` | exit 0；0 errors / 405 warnings / 14 infos |
| B `npm test -- plugins/tasks/test packages/core/src/kernel/plugin-input.test.ts`（两次） | 两次均 10 passed / 0 failed / 1 skipped（11）；3 文件通过 |
| B `YONDER_TEST_REAL=1 npm test -- plugins/tasks/test/moments.test.ts` | 3 passed / 0 failed / 1 skipped（4）；1 文件通过；新增 Luna 用例**未测：缺少凭据**（未设置 YONDER_TEST_AUTH，worktree 默认 .yonder/auth.json 不存在） |
| B `npm test`，最终默认全仓 | 601 passed / 0 failed / 39 skipped（640）；102 文件通过 / 19 跳过（121） |
| B `npx biome check plugins/tasks/README.md docs/status.md CHANGELOG.md` | exit 1；0 files processed，Biome 不处理这些 Markdown 路径；不算文档 lint 通过 |
| `git diff --check` | exit 0，无空白错误 |

- 模型原文 `plugins/tasks/src/prompts.ts` 未修改，与 A 及其父提交一致；当前 SHA-256 `4ab808d9f2bfec93efc111838f897e492a09262af09c0e43d24d72aaae52d59c`（本次实测，不回写历史 P1 记录）。工具与时点直接引用原文常量。
- **维护者问题/本期解释**见 [README](../plugins/tasks/README.md#questions-for-the-maintainer)：stall 把 wake 计为账本活动、排除 moment 行；等待从 waiting-user 状态时间起算；waitingFor 最近 note/缺省 objective。先记触发再外调，崩溃窗口可能漏送而不重放未知副作用；postCompact 每任务一次。最近完成保持数组并增加布尔标记，不扩大关闭任务的跨 Agent 可见范围。P1 的 session:<id> origin 继续交已有消息 API 处理，不猜渠道。
- **明确跳过条件**：SessionInfo 无后台等待/已接纳 continuation 字段，因此按本次授权不判定这项 stall 排除条件。
- **未测**：新增真实 Luna stall 行为（缺凭据）及其余 38 项默认跳过测试；postCompact 成功压缩/模型完成（协议测试验证的是真实 admin 能力拒绝与错误落账）；真实用户渠道、实际 60 秒墙钟等待、spec 17 §9 的 n≥10 对照、干净 npm ci、生产 Agent/服务、发布升级和生产账本对照。未实现 tasks_show、TaskBoard、投影、尾部摘要或任何完成后复盘时点。

## 任务账本 P1（2026-10-25，任务分支待审核）

- 范围：`feat/task-ledger-20261025`，仅 `/Users/zoran/Documents/yonder-harness-tasks`。新增可选 `@yonder/plugin-tasks`；插件 data 下 SQLite 只追加事件，五个工具、归属/parent 链/cross-agent 只读可见范围、逐项完成证据、turn 完整目标与一行重现。未改 SDK/core 或设计文档，未启用到现有 profile。
- 真实证据：临时目录里的 SQLite、真实插件 loader、真实 kernel profile 选择与原生 `prepareInput`；没有模型替身或模型调用。修正骨架回放修改原始 open 历史的问题，覆盖原始行不变、状态恢复、渲染版本和事件计数去重。
- 原始命令结果（本 worktree）：

| 命令 | 结果 |
|---|---|
| `npm install --package-lock-only --ignore-scripts --offline --no-audit --no-fund` | exit 0，更新 workspace 锁文件，无新增依赖 |
| `npx biome check plugins/tasks` | 首次失败：6 errors / 8 warnings；格式问题（包括必须保留原文的 prompts.ts） |
| `npx biome check --write biome.json plugins/tasks/package.json plugins/tasks/tsconfig.json plugins/tasks/src/index.ts plugins/tasks/src/store.ts plugins/tasks/test/tasks.test.ts` | exit 0，修正 5 文件，0 errors / 8 warnings；biome.json 仅对 prompts.ts 停用 formatter |
| `npm run build` | 两次均 exit 0；含原生 macOS 构建、并发 power lease/64 次 pmset 检查、ui-companion 构建；产物仅在 worktree |
| `npm run typecheck` | exit 0 |
| `npm run lint` | exit 0；0 errors / 393 warnings / 14 infos（保留仓库警告） |
| `npm test -- plugins/tasks/test/tasks.test.ts` | 6 passed / 0 failed / 0 skipped；1 文件通过 |
| `npm test` | 597 passed / 0 failed / 38 skipped（635）；100 文件通过 / 0 失败 / 19 跳过（119） |

- 维护者原文 `plugins/tasks/src/prompts.ts` SHA-256 保持 `7f5dd68c7b0788b0db40f7e9cb685ab588bc1720f71e1799ba3b2c31eb1f9e05`。工具描述直接引用原文常量；一行渲染直接调用 TURN_ONE_LINE。
- 待维护者确认的最简解释见 [README](../plugins/tasks/README.md#questions-for-the-maintainer)：状态恢复路径、预设 session 归属、显式 parent、关闭任务不注入；SDK RenderContext 无 run/write 标记，当前计数基于选中 turn 的输入渲染，session + event 去重，无法区分旁观与实际模型唤醒。
- **未测**：38 项默认跳过测试、真实模型 `openai/gpt-6-luna` 与 spec 17 §9 的 n≥10 场景、干净 `npm ci` 安装、生产 Agent/真实渠道/服务、发布升级和生产账本对照。按本次 P1 边界未实现 nudge、滞留定时器、tasks_show、投影、尾部清单或复盘时点；未触碰生产 home 或已安装服务，未推送或发布。

## 共享 permissions API 独立集成（0.2.26102506，2026-10-25）

从正式 .05 commit `7df082c5bc9d65e1a44a0e26121ff0e6a4fe92d9` 只迁入共享 SDK/core/native provider 与真实 adapter 合同两项增量。保留同一 registry、真实活动 ToolContext、session/profile 插件选择、finally 释放与 owner/capability/env/cancellation 校验；不包含薄服务宿主、安装入口变更或定位功能。

初始专项 12 文件、186 通过 / 0 失败 / 0 跳过。发版唯一一次本地全量为 662 通过 / 1 失败 / 39 跳过；失败是旧 cleanup 测试夹具缺少新增 permissions 注册服务，补齐直接 setup 夹具后仅定点重跑 cleanup：1 通过，未重跑本地全量、未将原失败写成全绿。标准 build（含正常本地签名）、typecheck、lint 均通过（lint 402 warnings / 14 infos）。API 只提供统一接口；**未验真实 TCC**、模型/Kernel/OS E2E、权限请求或定位，不能据此宣称 OS 授权继承、grant 保留或宿主生命周期已修复。正式安装及 ready 另由独立更新回执核验，不能由代码发版推断。原始记录与边界见 [权限 API 验证](verification/permissions-api.md)。

## 验证基线

- 0.2.26102307 提示词与任务预设：默认全仓 423/0/38，真实 Luna 三类任务及连续工作 session 集成 1/0/0；构建、类型检查、lint 通过，原始失败和修正保留在 [任务预设验收](verification/task-presets.md)。

- 0.2.26102106 构建、类型检查通过；默认测试 **246 通过 / 0 失败 / 26 跳过（272）**，56 文件通过 / 13 跳过；lint **0 错误 / 204 warnings / 1 info**。真实模型 `openai/gpt-6-luna` 与隔离 launchd（`--maxWorkers=4`）全量 **271 通过 / 0 失败 / 1 跳过（272）**，68 文件通过 / 1 跳过。此前全量 270 通过 / 1 失败 / 1 跳过与单文件重跑失败均为 input-queue 提示竞争导致的既有模型输出不确定，诊断及最小提示修正原样记录在 [0.2.26102106 验收](verification/release-26102106.md)。历史原始结果见 [0.2.26102104 验收](verification/release-26102104.md)、[0.2.26102105 验收](verification/release-26102105.md)；任务恢复与去重见 [task-recovery](verification/task-recovery.md)、[background-result-dedupe](verification/background-result-dedupe.md)。默认跳过项需要真实模型与凭据；跳过不等于通过。
- 产品目录 lint 0 错误（保留警告）。
- 有实际运行证据的平台：macOS（launchd 服务、状态栏、桌面自动化）。Linux、Windows 已有完整程序平台适配代码，真实安装与运行验收待做。
- 不使用模拟模型：需要模型的检查用真实模型 `openai/gpt-6-luna`，缺凭据则标“未测”。

## 已实现并有真实运行记录

- **内核主线**：事件账本 → 绑定 → 身份/权限 → pi 会话 → 投递；输入接纳、模型终态、渠道送达分别记录；崩溃恢复、显式取消、父子任务、15 秒后台任务与进程管理、时间/轮数/tokens 软提醒；逐条模型消息独立投递。
- **CLI 与 TUI**：init / login / doctor / start / service / update / sessions / events / identity / skills / plugins / models / inspect / agents / presets；沿用 pi 原生界面的 TUI，真实 PTY 下的续聊、取消、退出重连已验证。
- **安装与更新**：按 Git 标签在本机构建，`current` 切换，launchd 常驻；GitHub 正式 Release → 程序化升级 → 核验 → 无模型通知的完整链已在真实升级中验证。
- **凭据录入**：`credentials set <name> --home <dir>` 本机隐藏 TTY 录入命名 API key（D50）。隔离 home 的真实 PTY 验收覆盖保存、Ctrl-C、空输入、回显恢复与非 TTY 拒绝；对生产 home 的录入需要人在本机终端完成，尚未执行。
- **按次 effort**：`agent_ask`/`task_run` 的 `effort`（14 §5，D52，需 admin）只作用于由该委派启动的那次运行；`run.end` 记录 `thinking` 与 `effort`。真实 Luna 验收覆盖降级、回退、拒绝与不泄漏；06 生产 Jarvis → maintainer 已验证 `sources` 逐字引用与 `thinking/effort.requested:low`，见 [06 验收](verification/release-26102106.md)。
- **委派原文引用**：`agent_ask`/`task_run` 的 `sources`（06 §6.1，D51）由程序逐字附上来源会话的入站消息；真实 Luna 验收覆盖引用、逐字相等和拒绝其他会话。已在 0.2.26102104 的生产 Jarvis 上经 CLI 渠道验证（见 [release-26102105](verification/release-26102105.md)）；06 生产 CLI 原文引用与 low effort 探针通过，见 [06 验收](verification/release-26102106.md)；飞书/微信渠道里的使用待验证。
- **飞书任务状态卡**：`channel-feishu_task_card` 同消息更新、四个固定状态词、两个短列表、仅通知的两个按钮、新文字撤销旧按钮；离线 75 项通过。真实飞书 PATCH 与按钮回调待发版后验证。
- **插件**：channel-cli、context-files、channel-mcp（19 个操作）、browser-skill、codex-tools、web-tools、channel-github、channel-feishu、media-tools、cron、mcp-client、native-automation。清单见 [plugins.md](plugins.md)。
- **自维护闭环一例**：GitHub issue → 维护 Agent 修复 → 提交与 PR → 人工审核合并；另有真实一次性 cron 作业由模型创建并按时执行。
- **飞书**：私聊与群旁观、全参与者会话背景、卡片按钮回调、离线消息合并恢复、四条共享命令；文本、图片、文件、音频、视频出站取得平台消息 ID。

## 已知缺口（尚未实现）

- 安装器跨入口并发互斥：自动发布升级与手动 CLI 同时构建同一版本时共用 .tmp 目录，第二次失败清理会破坏第一次构建。本轮确认两项进程终止后串行升级成功；旧版本服务保留，失败回执未抹除。尚未补跨入口安装锁，见 [任务预设发布记录](verification/task-presets.md)。
- 已撤回（D60）：progress-observer、decision-routing、login operations（`login_begin`/`login_status`）及 `task.linked` 事件；无 spec 与真实验收，不属于当前能力。
- 完整的消息转派插件（单输入取消、进度与结果的跨渠道原文回传、指定目标会话）：D51 只做了 `sources`，其余依赖未获批的共享契约。
- 自动 effort / 模型路由：没有可挂接的输入钩子，建议库未合入（D52）；聊天文本里指定 effort 的语法未做（自然语言不是授权来源）。
- 通用凭据采集中枢（浏览器/文件/剪贴板采集进密钥库）：实验分支自评为部分验收、未达生产，未合入。
- 长期记忆引擎与跨会话检索（目前只有 context-files 与手工 `memory/` 目录约定）。
- PTY 交互进程（process 管理使用管道，不标称 PTY）。
- 沙箱或容器隔离的执行环境（环境槽已定义；本机 exec 不是沙箱）。
- MCP 客户端的交互式 OAuth 登录（已有授权可用凭据 header）。
- Linux/Windows 的实际安装、启动、控制、重启与卸载验收；Web 控制台；交互式安装向导。
- 官方常驻模板已提供 Jarvis 与普通常驻 Agent；任务预设新增 default/coding/research，接线与实际验证见 [任务预设](verification/task-presets.md)。更专门的购物等 Agent 尚未提供。
- 文档/PDF 解析、TTS、视频生成；ASR 随包但默认未启用。

## 未关闭的真实验收

### 微信双插件

- 已实现本机归档的 7 个工具与资料触发器、iLink 的扫码/私聊/媒体/逐消息投递及 3 个工具；首个实例默认绑定明确配置的主人，后续实例独立身份，复用原有绑定/profile/投递。
- 隔离协议/归档/真实宿主/工具权限及真实 Luna 状态工具调用 7/7 通过；真人扫码、真实微信客户端收发和生产归档覆盖未验收。配置、工具输入输出与原始检查计数见[微信迁移验收](verification/wechat-plugins.md)。

### 飞书

| 场景 | 状态 |
|---|---|
| 私聊接收 → 模型回复 | 已验证 |
| 群聊 @ 与不 @（旁观，不唤醒模型） | 已验证；运行型群绑定与多人组合未测 |
| Markdown / post、普通卡片、按钮回调 | 已验证；模板卡片未测 |
| 图片、文件、音频、视频出站 | 平台消息 ID 已取得；图片仅见缩略图、视频仅见 00:00 缩略图，实际打开/播放未验收，音频有 2 秒播放观察 |
| 回复/线程、@ 实际提醒 | 已实现；完整组合未测 |
| 流式卡片 | 逐消息收尾已用真实 API 确认；取消/失败在客户端的全过程未测 |
| 离线消息合并恢复 | 两条离线消息合并为一次输入、一次投递，已验证；真实断网重连未测 |
| 运行中插话（steer） | 原生 A/B 同一轮合并、一次投递已验证；“工具仍在执行时才发送 B”的精确场景未通过 |
| 其他机器人、多用户交错 | 未测 |

### 日用入口、浏览器与桌面

- 首次 OAuth 互动登录、登录过期重登录、系统注销再登录后的自启、fish 补全加载：未测。
- BrowserSkill：文件上传被上游权限拒绝（需用户在扩展中授权）；扩展断开 → 引导 → 重连未测；38 个动作未逐项验收。
- Computer Use：菜单入口与偶发窗口丢失未复现；依赖宿主授权。
- native-automation：真实键鼠输入与拖拽、Edge/Playwright 下载引擎分支、多屏 Retina 坐标：未测。

### 执行能力与管理

- mcp-client：真实需凭据的外网 MCP 服务、真实 OAuth、模型自行发现并调用工具、HTTP 断网/会话过期：未测。
- cron：模型 preset 与事件绑定的真实运行、飞书投递成败、系统重启与 DST 实时跳变：未测；不在休眠/关机期间执行。
- Agent/preset 热管理：归档时在途任务的真实模型验证、归档后渠道不再路由、TUI 实拍：未测。
- 后台任务：系统重启与进程崩溃后的恢复、真实飞书输出通知：未测。

### 中断恢复

- 已验证（隔离 home、真实模型与本地真实 HTTP 故障端点）：重启、退避期间重启、重试耗尽后重启，原运行沿 checkpoint 继续，每次中断只注入一条短提示；socket 断连、5xx、429 按 `retry` 配置退避重试，鉴权、配额、schema、上下文超限、abort、repeatStop 不重试；退避期间 abort 立即生效；恢复后不重复副作用，只向原来源投递一次。
- 未测：真实的 `yonder update` 升级链、整机关机与真实断网、飞书客户端里的完整恢复过程；供应商侧提示缓存不会保留。

### 发布与更新

- 正式 Release → 升级链已有多次真实记录；取消、失败、崩溃等组合未测。

## 当前修复验证

同一飞书来源下连续委派的后台完成事件曾按msgId误去重，导致后续prepared正文读回旧结果。现按(session, job)修复；正式04已发布，既有apply监听自动升级03→04并核验服务ready/commit与飞书通知成功，未手动升级。实现与真实验证记录见[后台结果去重](verification/background-result-dedupe.md)。

## 稳定性关注项

- pi-durable 1.3.0 为 packages/pi-durable workspace 源码 fork，来源固定在 FORK_SOURCE.json；无 postinstall 补丁。升级须审核 beforeAgent、abort 接续队列、原子回执与 shouldRetry 边界，运行 fork 与 runtime 检查。
- 消息生命周期与流式投递语义在 0.1.2026102001（现已并入 0.2 系列）重构，真实渠道矩阵尚未全部复验。
- 飞书渠道曾在一次升级后首次启动出现 `fetch failed` 而未连上；人工重启后恢复，根因未确认。


- D54 BrowserSkill fork：同步最新上游，插件提供 opt-in 书签和扩展管理；隔离测试及未关闭项见 [验收](verification/browser-skill-fork.md)。真人 Chrome 的扩展加载、权限、生产 Yonder 配置和真实模型验收尚未完成；CWS 发布缺主人账号/凭据，未发布。

## macOS 权限引导（Track C / D55）

Phase 3 修复 PermissionFlow guide 的列表下沿定位，guide/watch 共用每秒探针、600 秒超时、grantedAt 与有证据的屏幕录制重启流程。2026-10-22 实机 helper AX/Input 已获主人授权；Screen Recording 为 requested/false。短时实测确认两种 guide 的真实窗口在列表下方 8pt、辅助功能自动退出 0、关闭/超时返回 JSON 与退出 1；53 项专项检查通过。未点击授权；新拖放→授权、屏幕录制 needs-restart→重启→granted、撤销、手动移动/跨屏/Space、实际键鼠和升级保留仍待主人验收。FDA/Files & Folders 不可全局预检。详见[调研](research/mac-permission-guidance.md)和[验收记录/OWNER STEP](verification/mac-permissions.md)。

## QQ 官方渠道（2026-10-21，任务分支）

- 新增 `channel-qq`，腾讯 `qqbot-nodejs@1.0.4` 接官方 WebSocket 与文字 API，扫码配置复用腾讯公开发布的 connector@1.2.0。运行时仍只读凭据；本机配置命令保存凭据、渠道和绑定，群默认使用只读分身（首轮曾为无工具）。尚未发布或替换日用安装。
- 独立测试 home 已经由用户实际扫码，自动取得机器人与扫码用户标识、保存配置；`doctor` 通过。用户另行完成该 home 的 OpenAI 登录，未复制正式版 OAuth。
- 私聊真实闭环：输入事件 `01M5EDM50822G7F715AC3SH5W6`，run `49` / session `2`，`openai/gpt-6-luna`，status=done；投递事件 `01M5EDMBTTJTA02SBME226TNBW`，delivery.ok=true 且有 QQ 原生消息 ID。另有真实 Luna 调用 `message_send` 主动发至本次验证账号，delivery.ok=true。
- 原始失败保留：首次私聊在独立模型登录前触发，run `10` 为 error（Provider is not configured: openai）；错误文字经 QQ 成功回传。登录后第二次私聊完成上述成功闭环。首次专项测试为 2 通过/1 失败（测试目录未创建），修复测试准备后专项 3/3，通过后增加预取消检查；最终全仓 190 通过/0 失败/19 跳过（52 文件通过/10 文件跳过）。首次全仓为 189 通过/0 失败/19 跳过。未启用全仓真实模型开关，不能把这些跳过项计为真实模型通过。
- 构建、typecheck、lint 通过；lint 保留 126 个既存警告与 1 个 info，QQ 插件单独 lint 无诊断。npm 包 dry-run 含渠道、配置命令、README 与 NOTICE。
- 群 @ 真实闭环：输入事件 `01M5EDNZMR9NTKFMK7QC6T5N2P`，run `64` / session `56`（独立 persistent 群会话），Luna status=done，投递事件 `01M5EDP80YN4BZGQCE63WZ9SZR` delivery.ok=true。用户确认私聊与群 @ 均在 QQ 客户端收到回答。未 @ 的前一条没有进入事件账本，符合本切片范围。
- 对齐 main `aaf23e3`（0.2.26102103）后，重新构建/typecheck/lint 与全仓测试：192 通过/0 失败/19 跳过，52 文件通过/10 跳过；lint 127 个既存警告、1 info，QQ 插件无诊断。上述最初扫码与真实模型收发基于 0.2.26102101 的隔离测试服务，QQ 渠道逻辑与此整合提交一致；未替换日用安装。
- 用户追加群全量接收后，接纳 GROUP_MESSAGE_CREATE，复用腾讯 mentionGate passthrough 在清理正文前识别 @，普通文字消息沿现有 wake: mention 写入群会话，不逐条调用模型。构建/typecheck/lint 通过；全仓 192 通过/0 失败/19 跳过（52 文件通过/10 跳过），lint 127 个既存警告、1 info，QQ 专项无诊断。隔离服务已用 0.2.26102103 重启；后续群主已在具体群聊内逐机器人开启全量消息，bot_state=all/member，三条真实未 @ 文字已入站，见下项。
- 用户批准 [群持续参与契约](research/qq-group-participation.md)（D57）后，实现每群独立只读分身、非空 60 秒分桶、模型显式定向发送与受限 parent_ask；沿既有账本、绑定和原生会话，不建第二模型队列。真实三条普通消息合为一批，read 与主会话请求/返回已完成；首次定向发送因 turn id/原生 ID 歧义被拦截，已在共享投递入口修复转换。修复后五条未 @ 消息合批，main 实际核验通过并经后台结果返回，群分身两条定向消息均取得 QQ 官方成功回执；用户确认“两条已收到，引用正常”，完成未 @ 到真实引用回复的闭环。
- 扩展默认全仓 193 通过 / 0 失败 / 20 跳过（52 文件通过 / 11 跳过），build/typecheck/lint 通过，127 个既存警告、1 info。真实 Luna 协议入口专项四次原始失败后修复授权准备与消息 ID 转换，第五次 1/1 通过；追加忙时消息检查先 0 通过/1 失败（模型误判裸文本完成状态），主会话返回显式 status/session/text 后 1/1 通过，覆盖跨群拒绝、只读记忆、main 后台结果返回、忙时消息保留下一批、静默和已处理重启不重复。平台与协议入口证据、原始失败及未测项见 [QQ 验收记录](verification/qq-channel.md)。
- 完成真人验收后，QQ 任务分支对齐 main `3591a37`，保留共享 steer/all/interrupt 和 D49；全仓 200 通过/0 失败/24 跳过，build/typecheck/lint 通过（184 警告、1 info）。首次缺少 main 新增 silk-wasm，按锁文件补依赖后通过；未重启日用或 QQ 隔离服务。对齐后真实 Luna 群参与专项再次 1/1 通过（74.06 秒），平台验收沿前述真人记录，未新增平台收发轮次。

## QQ 与微信合并发布候选 0.2.26102202（2026-10-22）

从远端 main d3537b2 保留已发布的微信双插件与最新运行时，迁入 QQ 五个提交，统一包版本。构建/typecheck/lint 通过；默认 271 通过/0 失败/31 跳过，真实模型与隔离 launchd 全量 297 通过/0 失败/5 跳过；权限 self-check 36/36。原真人 QQ/微信验收与本轮模型检查分开记录，未改正式 home 配置；原候选因并行 main 发布已顺延至 0.2.26102203，详情见 [本轮记录](verification/release-26102203.md)。

最终版本顺延 0.2.26102203，合并 main 的 transcript 范围扫描优化，保留正常 merge 历史。默认 271 通过/0 失败/32 跳过；真实全量原始 297 通过/1 失败/5 跳过，失败是模型误填可选 sources 导致测试未开始子任务，明确测试参数后定向 1 通过/1 筛选跳过；未删断言、未改产品权限或加超时。详见同一发布记录，不能以定向结果覆盖原全量失败。

## RightAPI 与模型命令（2026-10-23）

正式版候选 `0.2.26102301`（开发验收从06的隔离工作树开始）：Agent/profile 与会话模型链、默认连续三次失败切换、/model /status /compact 共用命令、原生上下文/任务图状态已实现。默认检查384通过/0失败/36跳过，真实GPT回退与Luna压缩2/2通过，RightAPI Sonnet/Opus请求及Sonnet/read循环成功。完整原始失败与验收边界见[本轮记录](verification/rightapi-model-commands.md)。合并最新main后默认全套410通过/0失败/36跳过，权限自检36/0。真人飞书/微信命令回显未测，发布及日用服务结果以Release与实际服务核验为准。

## UI Companion 与统一状态栏

交互工具和私有回环服务在 plugins/ui-companion；唯一 macOS 宿主在 packages/macos，插件不再起第二个桌面应用。左键当前交互/历史，右键交互入口、服务状态、检查更新及停止服务并退出。默认完成隐藏浮窗和浮球，autoClose:false 可保留；不自动给未选择插件的 Agent 增加工具。端点/单实例锁/真实卡片回传有验证；全屏、台前调度与菜单左右键真人验收仍未完成。正式发布验证记录见插件 README。

UI Companion 0.2.26102302 候选：基于最新主线完成 npm ci、build/typecheck，413 测试通过/36 跳过，lint 退出成功。发布不自动启用 Agent 工具或修改用户权限；系统级桌面场景仍待人工验收。

## 提示词分层与官方模板（2026-10-23）

系统底座与两类官方常驻模板、子任务/进程和插件说明已重构；初期装配与检查结果见 [提示词验证](verification/prompt-layers.md)。新 init 使用 Jarvis，已有个体文件默认不覆盖。用户随后授权 0.2.26102305 正式发版与本机迁移，最新主线整合、原始计数和实际发布入口见 [发布验证](verification/release-26102305.md)。

## 2026-10-23 任务期间保持唤醒

现有菜单栏单开关；CLI start 按真实运行/输入/后台任务查询状态并续租，限定 root 电源宿主聚合连接，最后一项结束、断开或 5 秒超时后恢复自身系统改动。已验证实际 pmset 开启、并行持有、断开释放和超时释放；原生后台 bash → 活跃查询 → 系统保护 → 完成释放已跑通。MacToolkit 电源入口、启动恢复和 sudoers 安装逻辑已移除，本机应用已替换；其原有工作区改动保留，没有作为 Yonder 改动提交。

首次全仓：8 文件失败/91 通过/18 跳过，10 测试失败/412 通过/37 跳过；均因工作目录缺少主分支新增的 agent-presets workspace 安装。npm ci 后：99 文件通过/18 跳过，422 测试通过/37 跳过、0 失败；build/typecheck/lint 通过（325 warnings、13 infos）。最终发布检查另记。真实模型默认未启用；物理合盖与菜单鼠标验收不由上述结果代替。

发布候选 0.2.26102308：合入主分支任务预设后，99 文件通过/19 跳过，424 测试通过/38 跳过、0 失败；build/typecheck/lint 通过（331 warnings、14 infos）。真实 native 后台 bash 120 秒通过：任务期间系统保护有效，结束后自动释放，最大心跳间隔 1032ms，未观测到物理合盖。电源宿主实际 SIGKILL 后由 launchd 重启并从持久恢复记录恢复系统设置，通过。本机已完成管理员安装、旧 MacToolkit 电源规则删除；MacToolkit 本轮 64 项测试通过/0 失败，构建和签名验证通过，替换安装且旧应用有备份。未启用真实模型；物理合盖仍未测。

0.2.26102308 安装后持续运行复查发现电源组件累积 2567 个打开句柄，随后出现系统读取失败/Bad file descriptor；短时成功不覆盖此失败。修复为每次 pmset 调用独立 autoreleasepool 并显式关闭管道、使用 /dev/null 标准输入。修复版自检 64 次调用句柄 3→3；已安装组件 256 次连续请求句柄 10→10，通过。增加协议版本，旧 root 组件在原菜单项提示更新，不把旧宿主误标成已保护。用户反馈已合盖再打开，但先前 120 秒自动窗口未观测到合盖，因此保留“物理合盖未闭环”的界限。

修复版 0.2.26102309 最终检查：99 文件通过/19 跳过，424 测试通过/38 跳过、0 失败；build/typecheck/lint 通过（331 warnings、14 infos）。root 宿主已更新到协议 2，本机服务读取正常、空闲时 protected=false；再次连续请求成功。原生菜单自动化访问安装版时超时，菜单鼠标验收未完成。用户报告已做合盖动作，但不补写自动窗口未捕获的测量证据。

## 2026-10-23 唤醒模式与 15 分钟缓冲

现有状态栏改为关闭/任务期间/始终互斥模式。任务完成后继续保持至少 15 分钟，期间新任务结束后重新计时；旧设置兼容，始终模式不因任务归零释放。build/typecheck/lint 通过；79 文件通过/19 跳过，334 测试通过/38 跳过、0 失败（317 warnings、14 infos）。真实后台任务后缓冲保护、空闲 always 与显式关闭释放通过；短时采集到合盖状态且任务正常完成。时间边界测试不冒充真实等待15分钟，背包散热与热点稳定性未验收。详见 verification/awake-modes.md。
- 维护者复核（2026-10-25）：独立重跑 `npm run build`、`npm run typecheck` 通过；`plugins/tasks` 与会话测试 10 通过 / 2 跳过。设置 `YONDER_TEST_REAL=1` 与 `YONDER_TEST_AUTH` 指向主仓库 `.yonder/auth.json` 后，`plugins/tasks/test/moments.test.ts` 4 通过 / 0 跳过，其中 Luna 滞留提醒用例真实通过。提醒是否真的让 Agent 不再中断，仍需 P5 在生产对照。


## Agent 状态与固定悬浮入口（0.2.26102505）

状态栏、菜单与悬浮入口接入逐 Agent 的真实运行/等待/空闲状态；菜单和浮窗显示当前输入、执行步骤与生成中的可见回复短片段。图钉按 home 保存，固定后收起保留同锚点入口，鼠标移出且无输入/拖动时自动收起。默认完成自动收起与左右键统一菜单保持。build/typecheck/lint 与全仓 605/0/39 通过；原生实际交互与焦点边界不由构建推定，见 [验证记录](verification/agent-status-companion.md)。

## 2026-10-27 渠道通知级别、QQ 媒体与微信监听（lane/channels-20261027）

内核新增入站通知：每条被绑定接纳的 `message.in` 与带字符串 `data.summary` 的插件事件，按 yonder.yaml `notifications` 级别（all/mention/mute，可按 `conv:` 覆盖）写一条 `yonder.notification`，走 sessions.notify 的 app-only entry，不唤醒模型、不进模型消息。QQ 渠道补齐入站附件（`attachments`，只接纳 https URL）、引用原文（`quote.text` 进入本轮提示）、出站 image/audio/video/file 与 `sendIntervalMs` 串行间隔（默认 500 毫秒）。微信归档批次增加 channel/conversation/senders/summary 标注供提醒使用。

验证：`npm run typecheck` 通过；`npx vitest run packages/core/src/routing`、`npx vitest run plugins/channel-qq`（6 通过 / 1 跳过，跳过项是需要 `YONDER_TEST_REAL=1` 的真实模型群批测试）、`npx vitest run plugins/wechat-archive`（2 通过）通过。微信侧真实冒烟用本机归档：`wechat-context status` 报 540083 条/983 会话、上次同步 ok；`fetch-new --consumer lane-channels-smoke --from-now` 建立游标 540083，随后 `check-new` 报 0 条新、再次 `fetch-new` 返回 0 条并保留同一游标，证明真实增量与游标持久化可用。

**未测**：QQ 真实平台联调（本机 yonder.yaml 的三个 QQ 实例已占用全部 WebSocket 连接，抢连会打断在跑的服务，交主 Agent 联调）；真实微信新消息触发的模型唤醒与提醒端到端（本线没有产生新的微信消息，不伪造）；媒体发送在平台的序号与限流实测；网页端/桌面端消费 notification 事件的节点级扇出（属 B 线）。
