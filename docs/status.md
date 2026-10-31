# 项目状态

更新：2026-10-31。版本 0.3.26103105，开发者预览。本页只记录“现在到哪了”：规范（`spec/`）是目标，本页记录现实与差距。按时间累积的验收记录移到 [verification/](verification/)，10 月的分节见 [status-history-2026-10](verification/status-history-2026-10.md)。

状态用词：**已实现**＝功能体、调用方与打包接线齐全；**已验证**＝有记录的真实调用结果。接口存在、工具注册成功、API 返回消息 ID 都不等于验收通过；一次成功也不覆盖未试过的组合。

## 本轮收敛（2026-10-31 起，进行中）

按 [收敛方案](../proposals/convergence/plan.md) 执行：文档收敛、core 分层（[architecture §6](architecture.md#6-内核分层与规模预算)）、大文件拆分、内核瘦身。各阶段完成后在此更新，原始命令结果写在对应提交说明里。

| 阶段 | 状态 |
|---|---|
| A 群参与收口提交 | 已提交 `c400a8d`：默认 `npm test` 2254 通过 / 1 失败 / 104 跳过（失败为既有无关的 `apps/app/scripts/market.test.mjs`）；真实 Luna live 183 / 0 / 3 跳过 |
| B1 文档 | spec 编号、index、architecture §6–§7 已提交 `6b35927`；本页压缩与历史移出随本次提交 |
| B3 非 core 大文件 | 已提交：cron、native-automation、channel-wechat-ilink、channel-qq、channel-feishu、cli terminal、cli index 均 ≤500 行 |
| B2 core 分层 | 已提交 `ae6a1de`…`ec87624`：9 处上行依赖修复，另修 routing→delivery；新增 `scripts/check-layers.mjs`（接入 `npm run lint`，基线为空）；默认 `npm test` 2264 / 1（既有 market.test）/ 104 |
| C 拆 runtime/release/delivery/kernel/device | 已提交（runtime `4a472c0`…`9282191`；release `c25b6e9`、delivery `d3cf6d8`、kernel `614952f`、device `fe80678`）；全仓已无超过 500 行的源文件，行数基线为空 |
| D 内核瘦身 | 未改代码：social-guard 迁入插件会削弱安全，D1/D2 都需要先批准 SDK 接缝（[设计稿](../proposals/convergence/kernel-slimming.md)）；未接线的群摘要显示与外人闸门待决定接线或删除 |
| E 干净验收 | 进行中 |

已知、早于本轮的真实模型失败（拆分前后同一组）：凭据缺 `workbuddy`、`rightapi-glm` provider；测试配置里 `cron` 插件重复列出；`unknown channel card`；`console-live`；若干模型判断类断言。

## 验证基线

- 最新默认全仓（`c400a8d`，2026-10-31）：2254 通过 / 1 失败 / 104 跳过；失败为既有无关的 `apps/app/scripts/market.test.mjs`。更早的基线见 [status-history-2026-10](verification/status-history-2026-10.md)。
- 产品目录 lint 0 错误（保留警告）。
- 有实际运行证据的平台：macOS（launchd 服务、状态栏、桌面自动化）。Linux、Windows 已有完整程序平台适配代码，真实安装与运行验收待做。
- 不使用模拟模型：需要模型的检查用真实模型 `openai/gpt-6-luna`，缺凭据则标“未测”。

## 已实现并有真实运行记录

- **内核主线**：事件账本 → 绑定 → 身份/权限 → pi 会话 → 投递；输入接纳、模型终态、渠道送达分别记录；崩溃恢复、显式取消、父子任务、15 秒后台任务与进程管理、时间/轮数/tokens 软提醒；逐条模型消息独立投递。
- **CLI 与 TUI**：init / login / doctor / start / service / update / sessions / events / identity / skills / plugins / models / inspect / agents / presets；沿用 pi 原生界面的 TUI，真实 PTY 下的续聊、取消、退出重连已验证。
- **安装与更新**：按 Git 标签在本机构建，`current` 切换，launchd 常驻；GitHub 正式 Release → 程序化升级 → 核验 → 无模型通知的完整链已在真实升级中验证。
- **凭据录入**：`credentials set <name> --home <dir>` 本机隐藏 TTY 录入命名 API key（D50）。隔离 home 的真实 PTY 验收覆盖保存、Ctrl-C、空输入、回显恢复与非 TTY 拒绝；对生产 home 的录入需要人在本机终端完成，尚未执行。
- **按次 effort**：`agent_ask`/`task_run` 的 `effort`（14 §7，D52，需 admin）只作用于由该委派启动的那次运行；`run.end` 记录 `thinking` 与 `effort`。真实 Luna 验收覆盖降级、回退、拒绝与不泄漏；06 生产 Jarvis → maintainer 已验证 `sources` 逐字引用与 `thinking/effort.requested:low`，见 [06 验收](verification/release-26102106.md)。
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

- 已实现本机归档的 11 个工具与资料触发器（含创建、查看、控制及回放四个只读监听工具）、iLink 的扫码/私聊/媒体/逐消息投递及 3 个工具；首个实例默认绑定明确配置的主人，后续实例独立身份，复用原有绑定/profile/投递。
- 早期隔离协议/归档/真实宿主/工具权限及真实 Luna 状态工具调用 7/7 通过，原始结果见[微信迁移验收](verification/wechat-plugins.md)。2026-10-30 已发布并安装 `0.3.26103014`：真实 Luna 验证监听创建、采集回放、静默、提醒、暂停恢复、规则回退和重启；本机实际归档补采 47 条，正式 Bot 的飞书主人私聊取得成功回执。唯一真实来源为已有授权 p2p，未新增群监听、未做主动提问，真实微信群与完整手机历史覆盖仍未验收；完整检查计数与边界见[监听闭环验收](verification/wechat-watch-20261030.md)。

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
## 稳定性关注项

- pi-durable 1.3.0 为 packages/pi-durable workspace 源码 fork，来源固定在 FORK_SOURCE.json；无 postinstall 补丁。升级须审核 beforeAgent、abort 接续队列、原子回执与 shouldRetry 边界，运行 fork 与 runtime 检查。
- 消息生命周期与流式投递语义在 0.1.2026102001（现已并入 0.2 系列）重构，真实渠道矩阵尚未全部复验。
- 飞书渠道曾在一次升级后首次启动出现 `fetch failed` 而未连上；人工重启后恢复，根因未确认。


- D54 BrowserSkill fork：同步最新上游，插件提供 opt-in 书签和扩展管理；隔离测试及未关闭项见 [验收](verification/browser-skill-fork.md)。真人 Chrome 的扩展加载、权限、生产 Yonder 配置和真实模型验收尚未完成；CWS 发布缺主人账号/凭据，未发布。
