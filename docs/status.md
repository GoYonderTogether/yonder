# 项目状态

更新：2026-10-22。版本 0.2.26102103，开发者预览。本页是“现在到哪了”的唯一入口：规范（`spec/`）是目标，本页记录现实与差距。

任务恢复（D46）：已实现消息/运行/后续责任分离、内部委派跨重启重接、真实错误保留、后台结果接纳补交及确定未发送通知补达；207项真实验收及macOS CI通过；正式03已由日用apply策略自动升级并核验，飞书升级通知送达。完整原始记录见 [task-recovery](verification/task-recovery.md)。

状态用词：**已实现**＝功能体、调用方与打包接线齐全；**已验证**＝有记录的真实调用结果。接口存在、工具注册成功、API 返回消息 ID 都不等于验收通过；一次成功也不覆盖未试过的组合。

## 验证基线

- 构建、类型检查通过。默认测试 188 通过 / 19 跳过 / 0 失败；显式打开真实模型与隔离 launchd 后 207/207 通过，零跳过。最终源码 e163f64 在全新克隆的 npm ci、构建、类型检查、默认测试与 lint、独立安装真实 Luna/bash 和 macOS CI 中通过。原始失败、跨进程恢复、通知补达与实际升级见 [本轮记录](verification/task-recovery.md)；上一轮去重验收保留在 [历史记录](verification/background-result-dedupe.md)。默认跳过的用例需要真实模型（`YONDER_TEST_REAL=1` 与可用凭据，见 [CONTRIBUTING.md](../CONTRIBUTING.md)）；跳过不等于通过。
- 产品目录 lint 0 错误（保留警告）。
- 支持平台：macOS（launchd 服务、状态栏、桌面自动化）。Linux、Windows 未支持。
- 不使用模拟模型：需要模型的检查用真实模型 `openai/gpt-6-luna`，缺凭据则标“未测”。

## 已实现并有真实运行记录

- **内核主线**：事件账本 → 绑定 → 身份/权限 → pi 会话 → 投递；输入接纳、模型终态、渠道送达分别记录；崩溃恢复、显式取消、父子任务、15 秒后台任务与进程管理、时间/轮数/tokens 软提醒；逐条模型消息独立投递。
- **CLI 与 TUI**：init / login / doctor / start / service / update / sessions / events / identity / skills / plugins / models / inspect / agents / presets；沿用 pi 原生界面的 TUI，真实 PTY 下的续聊、取消、退出重连已验证。
- **安装与更新**：按 Git 标签在本机构建，`current` 切换，launchd 常驻；GitHub 正式 Release → 程序化升级 → 核验 → 无模型通知的完整链已在真实升级中验证。
- **插件**：channel-cli、context-files、channel-mcp（19 个操作）、browser-skill、codex-tools、web-tools、channel-github、channel-feishu、media-tools、cron、mcp-client、native-automation。清单见 [plugins.md](plugins.md)。
- **自维护闭环一例**：GitHub issue → 维护 Agent 修复 → 提交与 PR → 人工审核合并；另有真实一次性 cron 作业由模型创建并按时执行。
- **飞书**：私聊与群旁观、全参与者会话背景、卡片按钮回调、离线消息合并恢复、四条共享命令；文本、图片、文件、音频、视频出站取得平台消息 ID。

## 已知缺口（尚未实现）

- 用户记忆库（memory 插件，规范 [15](spec/15-memory.md)）：规范已定，**尚未实现**。通用记忆引擎（语义召回、自动画像）无计划；目前 agent 侧只有 context-files 与手工 `memory/` 目录约定。
- PTY 交互进程（process 管理使用管道，不标称 PTY）。
- 沙箱或容器隔离的执行环境（环境槽已定义；本机 exec 不是沙箱）。
- MCP 客户端的交互式 OAuth 登录（已有授权可用凭据 header）。
- Linux systemd、Windows 支持；Web 控制台；交互式安装向导。
- 官方角色/人格模板。
- 文档/PDF 解析、TTS、视频生成；ASR 随包但默认未启用。

## 未关闭的真实验收

### 名片渠道

- 已实现 [channel-card](../plugins/channel-card/README.md)，契约见 [16](spec/16-card-plugin.md) 与 D52：设备码后台登录、网页十位一次性邀请码兑换（B）、私有令牌、启用 Agent 枚举与十分钟同步、单条 WS/hello/退避重连、绑定约束下的 multiAgent 定向、带 Agent 的引用、匹配 sent 确认、15 秒 uncertain 且不重发、emit 接纳后 ack、acct DM、仅起草名片工具。workspace、构建与默认测试发现已包含新包。
- 内核去重已按 target 区分同一渠道的同一原生消息，防止群消息给第二 Agent 的输入被吞；普通渠道仍拒绝 target，provider 注册值决定 multiAgent（实例不能自行开启）。
- loopback 契约测试覆盖注册无联网、登录与后台 poll、0600/0700、Agent 映射、kind/mentioned、ack 顺序与失败不 ack、匹配回执/错误/超时/断连/取消、不重发、十分钟同步、工具身份。核心测试覆盖枚举热更新/归档/恢复/独立返回值、目标自身绑定与非目标 no-binding、普通渠道禁止定向、多 Agent 去重。
- **真实后端已测（仅 loopback，无模型）**：动态加载 sibling server 的真实实现和 test/services.ts（先编译到临时发布布局，不修改 sibling 生成文件），启动临时 PostgreSQL/Redis；注册真实 human → device start → 网页 session confirm → poll → 登记两个 Agent → WS hello 在线 → 网页 DM → message.in target research → send → human 历史看到回复；另测 acct 私聊和名片草稿。后端 devices 测试 6 通过 / 0 失败 / 0 取消 / 0 跳过（含新增 DM 权限、并发幂等和设备/启用边界）。
- 最终检查：npm run build、npm run typecheck、npm run lint 均退出 0；lint 226 文件、198 警告、1 提示，无错误。定向测试 6 文件、18 用例通过 / 0 失败 / 0 跳过；默认全套 YONDER_TEST_REAL=0 npm test：55 文件通过 / 11 文件跳过，206 用例通过 / 0 失败 / 23 跳过，共 229。
- 邀请码 B 本次检查：`npm run build`、`npm run typecheck`、`npm run lint` 均退出 0；lint 226 文件、202 warnings、1 info、0 errors。`YONDER_TEST_REAL=0 npx vitest run plugins/channel-card/test`：2 文件、19 用例通过 / 0 失败 / 0 跳过（其中新增 12 个邀请码契约用例）；`YONDER_TEST_REAL=0 npm test`：55 文件通过 / 11 文件跳过，218 用例通过 / 0 失败 / 23 跳过，共 241。新增契约用例覆盖 start/poll 兑换、默认/配置 kind、unknown/expired/used、429、重复连接与私有文件重载、0600/0700 和结果/日志不含秘密；原有真实后端测试验证的仍是 start/confirm/poll，不证明邀请接口已联调。本轮检查未发生失败；上轮原始结果保留如下。
- 邀请码 B **未测/待完成**：并行真实后端 invite/redeem 与网页 `/get`/“添加设备”的端到端联调；包含此插件及兑换功能的官方发行版。Agent 提示词模板在插件 README，本轮未修改 sibling repo。方式 A（URL scheme/loopback 唤醒本地 Yonder）未实现，待维护者批准内核设计。
- 如实保留早期结果：首次 typecheck 因遗漏 inspection agents service 与 exactOptional 字段报错，后修复；第三次因测试误用 kernel.inspect 报错，后修复；其余复跑通过。首次定向 9 通过 / 2 失败（后端源码 metadata 相对路径、测试 fixture 缺 version）；第二次 10/1（fixture JS 语法）；第三次 12/1（initHome 显示名期望错误）；第四次 13/0；新增守卫/去重测试后第五次 17/1（新增 fixture JS 语法），第六次 18/0。未通过结果不计作最终成功。
- 真实后端差异：poll 对未知及过期均 404 invalid_code，used 为状态；WS 错误实际为 {error}，缺 type/ref，无法关联的错误等待确认超时；Agent 登记仅 upsert，不删除省略 Agent；hello 只在连接时订阅（同步后重连）。app.ts 的 package.json 路径面向发布布局，直接从 source 启动会 ENOENT，测试采用临时真实编译布局。后端只修改 devices.ts、test/devices.test.ts 与 PLAN 路由行，未修改 realtime.ts/app.ts。
- **未测**：生产/外网/真实客户端；真实 ChatGPT/Luna 或其他模型路径；真实后端断网、进程重启与游标补收；长期十分钟真实时钟（契约测试推进时钟）、入站 image/file/interactive 的真实客户端展示、HTML/SVG 安全渲染和网页人工发布。契约测试不代替这些真实验收。没有提交、切分支、安装或服务部署。

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

## UI Companion 插件（2026-10-22）

已确认原型迁入 plugins/ui-companion，SDK 工具/生命周期、回环服务、私有交互存储、主仓库唯一状态栏的 macOS 非激活宿主接通。真实加载器+工具→网页选择/填写→结果回传/收起，以及原生按钮→结果回传/收起已验证；全仓 198 通过/23 跳过。原生文本输入、系统级台前调度/全屏/焦点保持与真实模型自主调用仍未测；未安装到正式服务。原始失败和重跑计数见插件 README。

2026-10-23：状态栏图标统一到 packages/macos，ui-companion 不再起第二个桌面进程。唯一宿主读取当前 home 私有端点，左键当前交互/历史，右键服务管理。原生编译、端点/锁自检及实际卡片展示已验证；左右键菜单、真实更新和停止服务的人工验收仍未完成，未停止正式 harness 服务。
