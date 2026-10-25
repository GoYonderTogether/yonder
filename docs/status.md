# 项目状态

更新：2026-10-23。版本 0.2.26102307，开发者预览。本页是“现在到哪了”的唯一入口：规范（`spec/`）是目标，本页记录现实与差距。

任务恢复（D46）：已实现消息/运行/后续责任分离、内部委派跨重启重接、真实错误保留、后台结果接纳补交及确定未发送通知补达；207项真实验收及macOS CI通过；正式03已由日用apply策略自动升级并核验，飞书升级通知送达。完整原始记录见 [task-recovery](verification/task-recovery.md)。

状态用词：**已实现**＝功能体、调用方与打包接线齐全；**已验证**＝有记录的真实调用结果。接口存在、工具注册成功、API 返回消息 ID 都不等于验收通过；一次成功也不覆盖未试过的组合。

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

## 验证基线

- 0.2.26102307 提示词与任务预设：默认全仓 423/0/38，真实 Luna 三类任务及连续工作 session 集成 1/0/0；构建、类型检查、lint 通过，原始失败和修正保留在 [任务预设验收](verification/task-presets.md)。

- 0.2.26102106 构建、类型检查通过；默认测试 **246 通过 / 0 失败 / 26 跳过（272）**，56 文件通过 / 13 跳过；lint **0 错误 / 204 warnings / 1 info**。真实模型 `openai/gpt-6-luna` 与隔离 launchd（`--maxWorkers=4`）全量 **271 通过 / 0 失败 / 1 跳过（272）**，68 文件通过 / 1 跳过。此前全量 270 通过 / 1 失败 / 1 跳过与单文件重跑失败均为 input-queue 提示竞争导致的既有模型输出不确定，诊断及最小提示修正原样记录在 [0.2.26102106 验收](verification/release-26102106.md)。历史原始结果见 [0.2.26102104 验收](verification/release-26102104.md)、[0.2.26102105 验收](verification/release-26102105.md)；任务恢复与去重见 [task-recovery](verification/task-recovery.md)、[background-result-dedupe](verification/background-result-dedupe.md)。默认跳过项需要真实模型与凭据；跳过不等于通过。
- 产品目录 lint 0 错误（保留警告）。
- 支持平台：macOS（launchd 服务、状态栏、桌面自动化）。Linux、Windows 未支持。
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
- Linux systemd、Windows 支持；Web 控制台；交互式安装向导。
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
