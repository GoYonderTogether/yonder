# 项目状态

更新：2026-10-20。版本 0.2.26102001-beta.1，开发者预览。本页是“现在到哪了”的唯一入口：规范（`spec/`）是目标，本页记录现实与差距。

状态用词：**已实现**＝功能体、调用方与打包接线齐全；**已验证**＝有记录的真实调用结果。接口存在、工具注册成功、API 返回消息 ID 都不等于验收通过；一次成功也不覆盖未试过的组合。

## 验证基线

- `yonder/pi-fork`：build、typecheck、Biome error 检查通过；默认 59 文件（51 通过 / 8 跳过）、198 用例（182 通过 / 16 跳过 / 0 失败）；真实全量 59 文件通过、197 通过 / 1 跳过 / 0 失败（launchd 未测）。全新 clone 的 npm ci/build/test 与 npm ci --dry-run 通过。Fork durable harness 相关检查 31 文件、619 用例通过，retention=0 同样通过。范围、原始失败及上游全仓 check 的未通过项见 [pi-fork 验收记录](validation/pi-fork.md)。
- 父分支 `3bcacb5` 历史基线：构建、类型检查通过。默认测试 59 文件（51 通过 / 8 跳过），196 用例（180 通过 / 16 跳过 / 0 失败）；打开真实模型后 59 文件通过，196 用例（195 通过 / 1 跳过 / 0 失败；跳过项需要 launchd）。默认跳过的用例需要真实模型（`YONDER_TEST_REAL=1` 与可用凭据，见 [CONTRIBUTING.md](../CONTRIBUTING.md)），默认不运行；跳过不等于通过。
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

- 长期记忆引擎与跨会话检索（目前只有 context-files 与手工 `memory/` 目录约定）。
- PTY 交互进程（process 管理使用管道，不标称 PTY）。
- 沙箱或容器隔离的执行环境（环境槽已定义；本机 exec 不是沙箱）。
- MCP 客户端的交互式 OAuth 登录（已有授权可用凭据 header）。
- Linux systemd、Windows 支持；Web 控制台；交互式安装向导。
- 官方角色/人格模板。
- 文档/PDF 解析、TTS、视频生成；ASR 随包但默认未启用。
- 渠道目前只有 CLI、MCP、GitHub、飞书。

## 未关闭的真实验收

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

- pi-fork 已验证：配置次数/基础与最大延迟；本地真实 HTTP 覆盖 auth/API key/permission、context/token limit、quota/billing、abort/repeatStop 排除及 socket/5xx/429 重试；在途请求连续重启、退避中重启共享提示、耗尽正常 error 后再重启、即时 abort、原副作用与来源投递不重复。只有 durable 内化，默认 10 次、2 秒起、5 分钟封顶；完整记录见 [验收报告](validation/pi-fork.md)。
- 已验证（隔离 home）：在途 HTTP 模型请求重启后重发并注入提示；Luna 在已完成文件写入后经历 501/503，恢复且不重复写入，只向原 CLI 来源投递一次；完成回执再次恢复不增加 message.out。真实 socket 断连、429/503 的 3 次退避，401/schema 不重试、退避期间 abort、重复重启保留重试预算及提示身份均通过。逐消息气泡与恢复去重由既有共享 delivery / 飞书协议测试覆盖，未新增模拟模型。
- 父分支原始过程：首次定向 2 通过 / 1 失败；代理协议定位随后 3 次各 1 失败 / 2 跳过；修正订阅 compat 后 1 通过 / 2 跳过，扩展定向 5 通过；最终在途请求重启定向 1 通过 / 3 跳过。曾出现 2 次类型检查错误及 1 次格式错误，已修复；本次 pi-fork 原始失败及最终计数另列验收报告，未覆盖旧记录。
- 正式 `yonder update`、系统关机/断网、飞书客户端恢复全过程及供应商缓存命中：未测；不触碰日用服务。

### 发布与更新

- 正式 Release → 升级链已有多次真实记录；取消、失败、崩溃等组合未测。

## 稳定性关注项

- pi-durable 1.3.0 为 packages/pi-durable workspace 源码 fork，来源固定在 FORK_SOURCE.json；无 postinstall 补丁。升级须审核 beforeAgent、abort 接续队列、原子回执与 shouldRetry 边界，运行 fork 与 runtime 检查。
- 消息生命周期与流式投递语义在 0.1.2026102001（现已并入 0.2 系列）重构，真实渠道矩阵尚未全部复验。
- 飞书渠道曾在一次升级后首次启动出现 `fetch failed` 而未连上；人工重启后恢复，根因未确认。
