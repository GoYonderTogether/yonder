# 项目状态

更新：2026-11-03。开发者预览，精确当前版本见根 `package.json` 与最新正式 Release。本页只记录“现在到哪了”：规范（`spec/`）是目标，本页记录现实与差距。按时间累积的验收记录移到 [verification/](verification/)，10 月的分节见 [status-history-2026-10](verification/status-history-2026-10.md)。

状态用词：**已实现**＝功能体、调用方与打包接线齐全；**已验证**＝有记录的真实调用结果。接口存在、工具注册成功、API 返回消息 ID 都不等于验收通过；一次成功也不覆盖未试过的组合。

## 共享 Bot 核心重构（2026-11-02–03，阶段1–11完成）

维护者授权目标见[22](spec/22-shared-bot-core.md)。本机与云端共用createBot/唯一Runtime及提示词装配；定义/工作区、运行状态和插件数据使用真实FS/SQLite或租户隔离PG实现。本机零环境组合与PG单进程Worker已验证，旧core兼容导出保留。Worker按消息激活、20实例LRU和唯一持久deadline调度；原Docker/安装/发版路径未改。

最终完整build/typecheck/lint通过；默认**2733通过/0失败/112跳过**，515files通过/67skip，106.11秒；size930/layer109、基线0，相对固定a6a6c0b5无新增失败。Cloud根/server build/typecheck通过，后端207通过/0失败/0取消/0跳过。既有1322 lint warning/34 info保留，真实gpt-6-luna缺规约凭据仍未测。

真实GLM证明两租户PG SOUL生效、最终卡片/connect与/download，以及本机临时设备官方memory插件读取。worker/server错误唯一结果、后续prompt排除、红色气泡外UI和真实Chrome路由已有证据；reply:none不堵队列。设备通过原work-bridge与原生program ToolTask执行，按真实owner DM/可核程序refs授权，per-run/per-task名单和资源冻结，离线移除工具；cron继承及逐次HTTP目录一致性用明确transport回环独立验证。默认cloud不新增exec，不据memory往返宣称物理grant、硬件或所有设备组合已测。

新版100Bot+1暖轮：idle139.362MB、50ms采样peak318.996MB，active/highWater20、101完成/pending0；PG2/TCP3/Timeout2不随Bot增长。cold Worker Client.query168–169（mean168.8），warm90，不含server SQL。另有新版3run真实GLM及其独立RSS记录；无强制GC。数据来自本机macOS，不等于2核2GB生产共存/长期驻留验收。

证据：[阶段总账](verification/shared-bot-core-20261102.md)、[包边界](verification/shared-bot-boundaries-20261103.md)、[Worker](verification/shared-bot-worker-20261103.md)、[客户端](verification/shared-bot-app-20261103.md)、[卡片](verification/shared-bot-card-20261103.md)、[设备工具与最终gate](verification/shared-bot-device-tools-20261103.md)。各阶段哈希、A1–A12、未测与部署草案在根目录未提交REFACTOR-REPORT.md。未推送、部署、连接生产或操作桌面。
## 多端工作台（2026-11-02）

运行位置与资源工作区已分开实现：会话选择实际云端或设备Harness，工作区可指定多设备/多目录、仅设备或沿用Bot授权集合。供应商/模型/effort合并选择，模型来源限云端及运行宿主；主人工作台权限覆盖、运行快照、文件图片上传与持久查看/下载已接通，普通渠道不继承主人bypass。设计见[19 §7](spec/19-device-workbench.md#7-运行位置资源工作区与模型2026-11-02-主人批准实施)。

已验证本机真实Luna、云端真实DeepSeek、Linux完整Harness与独立execution-only安装，以及物理云Linux→Mac的模型read/bash和结果回读；设备离线明确返回unknown，重连原commandId的测试副作用仅一次。正式 **v0.3.26110209** 已公开，网页静态与本机正式服务均精确对应tag `dc45befd`，本机原始升级回执verified、真实云模型回合通过。生产桌面和390px复验确认模型名优先、真实供应商名可见，目录确认不支持effort调整时隐藏无效档位，无横向溢出或pageerror。临时设备、授权及验收登录已清理，云端历史保留。云后端仍为 `52692f5`，云Runtime保留已验收Linux构建 `8f620a0`；WorkBuddy测试模型依赖Mac在线。完整计数、原始失败与发行后检查快照见[验收记录](verification/workspace-multidevice-20261102.md)。

## v09发布门禁与安装证据（2026-11-02）

`41cccfed` 的发布前CI `41467977328` 全平台成功，正常Release `41470496669` 公开v09。先前漏交operability类型导致的TS2307已补齐并推送，随后完整实现由原任务合入；原失败保留在验收记录。Windows x64/ARM64源码检查各2646通过/0失败/131跳过；v09两架构的一行安装、启动/控制状态/停止/重启CI均成功。桌面macOS/Windows与签名Android APK构建、上传作业成功，仍不代表干净实机GUI或安卓真机验收。精确发行tag的追加CI最后快照仅ARM64全量回归仍运行，其余任务成功，不以派发当作完成。

## 安装与分发（2026-11-02，代码已接线，验收只做了一部分）

设计见 [09 §3.1、§6.1–§6.4](spec/09-cli-release.md)：安装分“只装核心”与 `--desktop` 两种形态；桌面壳启动时先探测本机核心，可达直连本机控制面，否则回落 `https://yonderbot.net/`；状态栏扩展到 Windows（`Yonder Status` 托盘），Linux 不做；安卓 APK 与桌面 dmg/nsis 由 Release 后的 CI 构建，连同 OSS 清单一起分发到 bucket `yonder-release`。

| 项 | 现实 |
|---|---|
| `install.sh` / `install.ps1` 的 `--desktop` / `-Desktop` | 已接线：核心装完后取同一 Release 的 dmg 装进 `/Applications`（Windows 为 nsis `/S`），再执行 `yonder service install`。`install.sh` 本机通过 `sh -n`、shellcheck 与 `--dry-run`，并实测挂载 dmg、替换 `/Applications/Yonder.app`；`install.ps1 -Desktop` **未执行**（本机无 PowerShell，也没有 Windows 实机） |
| 桌面壳本机优先加载 | 已接线并两条路径实测：`local.rs` 跑 `yonder ui --json` 并短超时探测本机网关，可达用它、否则云端。本机真实运行里，核心在线时探针收到窗口对本机地址的 `GET /`；无本机安装时 WebKit 网络进程连向 yonderbot.net 的解析地址。7 个 Rust 单测通过，`cargo check`/`clippy` 干净。**未测**：登录态、外链交系统浏览器、离线提示 |
| Windows `Yonder Status` 托盘 | 已接线：`packages/windows-status`（WinForms，单实例，固定菜单骨架），由 `service install` 经登录任务 `Yonder Status` 注册、`service uninstall` 移除；TS 侧单测通过。Windows CI 两个架构真实编译并跑过 `--check` 与 `--smoke`（托盘图标注册成功、缺服务时首行显示“服务未就绪 · 状态未知”）。**未测**：真实桌面外观、登录后自启、实机卸载 |
| `android-release.yml` / `desktop-release.yml` | 已接入 `release.yml` 的派发步骤，并在 `v0.3.26110208` 上真实跑过：桌面构建成功；安卓首次因已发布 tag 缺少 `tauri` 脚本失败，修好后重跑成功。两个工作流在旧 tag 上也能自足（工作流会补该脚本） |
| 安卓 APK | 本机与 CI 均构建出签名 APK；`v0.3.26110208` 的 `yonder-android.apk` 已进 Release（16.0 MB），OSS 上有版本化副本与 `android/latest.json`。阿里云禁止经 OSS 默认域名分发 APK（`ApkDownloadForbidden`），清单的下载地址因此指向同一个 Release 的 GitHub 资产。**未测**：真机安装、系统确认框、从设备上真正跑一次 App 内更新 |
| 桌面安装包 | `v0.3.26110208` 的 `Yonder_0.3.26110208_aarch64.dmg` 与 `Yonder_0.3.26110208_x64-setup.exe` 由 CI 构建并进 Release，OSS 上同路径可公开下载（实测 200）。ad-hoc 签名，**Gatekeeper 右键打开未在干净机器验证；nsis 安装流程未实机执行** |
| OSS 上传 | `scripts/release/oss.mjs` 用真实凭据上传并公网读取成功；桌面安装包与安卓清单位于 `desktop/<version>/`、`android/` 前缀下实测 200。签名与清单单测通过 |
| bucket `yonder-release` | 阿里云 OSS，cn-hangzhou，public-read（已关闭 public access block），生命周期只清 7 天未完成分片。本机操作走 `scripts/cloud/aliyun.sh`，凭据取自 agent-vault，不落盘 |
| 签名与公证 | macOS 无 Developer ID，ad-hoc；Windows 未签名。Gatekeeper 右键打开与 SmartScreen 警告未在干净机器上验证 |

未测汇总：桌面壳的登录态与外链跳转、Windows 托盘的安装/自启/卸载与真实外观、`install.ps1 -Desktop` 实机、安卓真机安装与 App 内更新、nsis 安装流程、签名与公证。

## Harness 自配置闭环（2026-11-01，本地实现，未发布）

共享管理链已补目标 profile 定位、候选路由可接纳性、锁内版本核对、同步热重载及失败恢复；可信 owner 来源跨分身/续办、社交原授权直接应用、真实路由诊断、请求模型事实及附件读取导航已接通。按可信接入事实补默认 parent/批次链，可行动错误给出缺项与修复入口；显式 batch.run 普通消息不被关键词/数量二次门槛吞掉。主会话不提供不可执行的 parent_ask，本机执行到只读 CLI inspect 保留当前 home/Agent/profile，显式目标与跨 home 边界优先。最终默认测试 2505 通过 / 0 失败 / 107 跳过，build/typecheck/lint 通过。真实 Luna 用主人自然原话完成私聊模型切换，以及受限群→主会话协助→策略应用/读回→普通非@消息实际批次运行；群场景采用真实内核与本地录制 transport，不代表真实平台验收。历史操作式测试仅证明操作链；自然测试的全部失败、修复与证据见[验收记录](verification/harness-self-configuration-20261101.md)，设计见[方案](research/harness-self-configuration-20261101.md)。正式 home/install 未改，真实 QQ/飞书及正式安装验收未执行。

## 本轮收敛（2026-10-31，已随 0.3.26110101 发布）

按 [收敛方案](../proposals/convergence/plan.md) 执行：文档收敛、core 分层（[architecture §6](architecture.md#6-内核分层与规模预算)）、大文件拆分、内核瘦身。各阶段完成后在此更新，原始命令结果写在对应提交说明里。

| 阶段 | 状态 |
|---|---|
| A 群参与收口提交 | 已提交 `c400a8d`：默认 `npm test` 2254 通过 / 1 失败 / 104 跳过（失败为既有无关的 `apps/app/scripts/market.test.mjs`）；真实 Luna live 183 / 0 / 3 跳过 |
| B1 文档 | spec 编号、index、architecture §6–§7 已提交 `6b35927`；本页压缩与历史移出随本次提交 |
| B3 非 core 大文件 | 已提交：cron、native-automation、channel-wechat-ilink、channel-qq、channel-feishu、cli terminal、cli index 均 ≤500 行 |
| B2 core 分层 | 已提交 `ae6a1de`…`ec87624`：9 处上行依赖修复，另修 routing→delivery；新增 `scripts/check-layers.mjs`（接入 `npm run lint`，基线为空）；默认 `npm test` 2264 / 1（既有 market.test）/ 104 |
| C 拆 runtime/release/delivery/kernel/device | 已提交（runtime `4a472c0`…`9282191`；release `c25b6e9`、delivery `d3cf6d8`、kernel `614952f`、device `fe80678`）；全仓已无超过 500 行的源文件，行数基线为空 |
| D 内核瘦身 | D2a 参与判定接缝已提交（`2c30644`、`ddd3ed9`、`f2d4e3b`、`c2b9b1a`）：`Hook.participation` 进 SDK 与 golden，策略代码搬进 social 插件，所选插件不可用时入站只记录、出站失败关闭。实测：`npm test` 2279 / 1（既有 market.test）/ 104；`check-stability` 9 项通过；真实模型对照父提交无回归（`participation-live` 在两侧都偶发失败，属模型相关的既有抖动）。**core 非测试行数 28,556 → 28,733（+177）**：接缝管线比搬走的策略代码（约 60 行）多，所以这一步的收益是边界清楚（策略在插件、强制在内核），不是内核变小。agent 配置段贡献与显式迁移钩子获批但暂缓：能搬走的代码少（约 240 行、101 行），而 core 路由仍要读 `social` 段的 `enabled/scope/plugin`、迁移钩子会改变老 home 的运行时机，按收益不做；未接线的群摘要显示（`routing/group-session.ts`、`views/social-group.ts`）与外人闸门（`delivery/outsider-guard.ts`）仍待决定接线或删除 |
| E 干净验收 | `7d1d374` 与收敛前 `8b60bee` 各自干净 `npm ci` 后对照：build、typecheck、`test:node`（40/0/0）两边通过；`npm test` 2263 / 1 / 105（仅既有 `apps/app/scripts/market.test.mjs`），收敛前 2231 / 2 / 105；`npm run lint` 现在通过，收敛前因行数门禁失败。真实模型全集 825 / 28 / 17，收敛前 802 / 29 / 17，**无回归**（失败集合是收敛前的子集）；剩余失败多为凭据缺 `workbuddy`、`rightapi-glm` 与轮询超时 |

收敛前后：core 模块之间的双向值依赖 9 对 → 2 对（剩 `control↔kernel`、`kernel↔plugins`，同在 L4）；层级违规 0；超过 500 行的源文件（不含 vendored pi-durable）22 → 10，剩下的都在行数门禁范围外（`apps/app` 前端、`.mjs` 脚本、Swift）；core 非测试代码 27,052 → 28,556 行（含群参与收口新增与拆分开销）。

**发版与 CI（2026-11-01）**：`v0.3.26110102` 已由官方 Release 作业发布（41 个附件、非草稿），main/tag 同提交。此前市场分类断言与设备崩溃夹具的时效问题已修复；`06b44b01` 的 [CI](https://github.com/GoYonderTogether/yonder/actions/runs/41279589830) 九个 job 均实际成功。现已接入 main push 的 CI 成功后自动派发正式 Release，默认启用严格门禁并锁定已验证 SHA，见 09 §5.1；运行结果以 Actions 记录为准，不把 GitHub 安装版本当作网站部署。Windows 本机换行与迁移检查已修复：完整 build/typecheck 通过，`test:node` 52 通过 / 0 失败 / 1 平台跳过，自动发布策略 20 / 0 / 0，完整 lint 0 errors（937 warnings、30 infos）。首次严格 macOS CI 的 Node 检查为 48 通过 / 2 失败 / 0 跳过，新增 CLI 入口漏掉 /var 到真实目录的软链接；随后以真实 Windows junction 复现并补修双方 realpath，迁移定向 8/8。失败记录保留在 CI 41282064380，不以本机成功覆盖跨平台结果。这些结果不等同于完整 Windows Vitest、真实模型或服务器部署验收。

待维护者决定：未接线的群摘要显示（`routing/group-session.ts`、`views/social-group.ts`）与外人闸门（`delivery/outsider-guard.ts`）是接线还是删除；云端部署需维护者用 `scripts/deploy-node.sh` 在本机执行。

已知、早于本轮的真实模型失败（拆分前后同一组）：凭据缺 `workbuddy`、`rightapi-glm` provider；测试配置里 `cron` 插件重复列出；`unknown channel card`；`console-live`；若干模型判断类断言。

## 验证基线

- 最近已完成的官方 CI：`06b44b01` 的 Linux 四个全仓测试分片、类型、构建、Node 检查、lint、Linux 汇总与 macOS 子集均成功，合计 9/9 job。历史全仓原始计数保留在上表与 [status-history-2026-10](verification/status-history-2026-10.md)，不使用子集结果覆盖旧记录。
- 产品目录 lint 0 错误（保留警告）。
- 有实际运行证据的平台：macOS（launchd 服务、状态栏、桌面自动化）；Linux完整Harness和独立execution-only的本轮实际安装见上节。Windows已有平台适配代码，完整安装生命周期与托盘实机验收仍未完成。
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
- Linux/Windows全安装生命周期仍有未测组合；Linux完整Harness、execution-only与Web工作台本轮实际证据见「多端工作台」，不再统称为未实现。交互式安装向导未实现。Windows状态栏与安卓分发见「安装与分发」。
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
