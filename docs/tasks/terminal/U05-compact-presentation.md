# U05 用户截图精简与通用键位

## 当前状态（2026-10-19）

实现已进入独立1902安装，有基础终端真实证据；完整视觉/交互验收仍未关闭。U05交接不是当前阻塞。见[总账](../current-status.md)与[待审P2](../finishing-plan.md)；下方原结果及未测项保留。

## 历史任务与结果（原文保留）

以下状态、版本及执行要求按记录当时理解；不作为当前派工指令。

**依据**：用户本轮截图与要求、spec/12 §4/6、D31。由主 agent 按本次明确授权修订设计后实施。

**允许路径**：packages/cli/、THIRD_PARTY_NOTICES.md、docs/spec/12-terminal-interaction.md、docs/architecture.md、docs/decisions.md、docs/tasks/terminal/。隔离运行 home 与既有可视化目录。

**必须**：复用 pi 原生组件；用户/AI 标记一致用于历史与流式；顶部简短、固定底栏默认一行、详情与快捷键可收起；按 §6 接线常用键位，不暗示未实现功能。

**验证**：build、typecheck、CLI 相关检查及全量回归；实际 PTY 历史/真实模型输入、展开收起、Tab/列表/Esc/Ctrl+C/退出；提供真实新画面。

## 问题

- 原始本轮全量检查在沙箱内 7 failed / 20 passed / 5 skipped（5 failed / 14 passed / 3 skipped files），失败包含 Unix socket listen EPERM 和其超时；在允许本地 socket 的环境原样重跑通过，不削弱断言。加入目录别名及消息密度检查后，最终计数见结果。
- 原生当前文件夹选择器遇到 `/tmp` 与 `/private/tmp` 别名显示空列表；用真实目录身份比较修复，并留实际符号链接检查，缺失/远程路径不会被猜为同目录。
- 录制器原先逐块 decode UTF-8 会把跨块字符录成替换符，已改 incremental decoder；最终深/浅色回放均检查无替换符。
- 全仓 lint 仍为原有 18 errors / 16 warnings；未扩围修改。U04 未测项保留。

## 结果

已实现并完成本轮开发态验证，等待用户视觉验收；未安装/发布到日用环境。

- **先调研再修改**：实际启动本机 Codex CLI 0.160.1 的独立只读 `gpt-6-luna` 会话，真实回复后正常退出；核对 `rust-v0.160.1` 的 `history_cell/messages.rs`、`style.rs`、`exec_cell/render.rs` 与 pi v1.3.0 消息组件。规范 §6、D31/D32 写明修改原因、固定来源与原生复用边界。Codex 的新参考会话为 `01a14fba-6a54-7eb1-9153-1e5127ca26be`，未恢复或修改已有会话。
- **呈现**：删除独占行“你/AI”标签和重复 Spacer；用户灰底行、灰色 `›`，AI 首行灰色 `•`（有真实 Agent 时紧贴其名），消息之间一空行；Markdown/代码/工具实际内容仍用 pi。工具默认一行真实调用和等待/运行/完成/失败，Ctrl+O 展开完整原生结果。原始消息和执行事实未修改。
- **底部与键位**：顶部只品牌；底部默认一行真实对象/模型与微提示；`?` 或 /hotkeys 展开帮助，/session 或 Ctrl+O 展开详情；Ctrl+C 运行时中止，Ctrl+L 重绘、Ctrl+P/N 历史，其余输入、Tab/选择和菜单优先级保持原生。用 pi 原生终端颜色查询适配深浅背景；字体像素设置仍由终端负责。
- **检查**：最终 build、typecheck 通过；23 files：20 passed / 3 skipped；34 tests：29 passed / 5 skipped。本轮 5 个修改 TS 文件定向 lint 无诊断；全仓 lint 仍未通过（18 errors / 16 warnings）。之前 27 passed / 5 skipped 与 28 passed / 5 skipped 的阶段计数保留在日志，不冒充最终数。
- **实际运行**：最终构建重新执行真实 Luna 的 bash/pwd、同任务第二轮、Ctrl+P 召回输入、Ctrl+O 展开/收起、? 微提示、Ctrl+C 中止且 manual 会话保留，以及 main 渠道单条多行输入；脚本全部断言通过。另重开真实 #90 历史验证深浅色、原生中文过滤/Tab 与会话选择/恢复，不以模拟消息做截图。
- **查看**：`/Users/zoran/.codex/visualizations/2026/10/18/01a14f54-9c42-7da3-a9c2-995d49d5fb8f/terminal-replay.html`；默认浅色最终版，presentation 是深色重开，yonder/channel 是最终真实调用，menus 是实际补全和选择。PNG 是实际 PTY 原始输出经 xterm 回放，13px Menlo、lineHeight 1.25、letterSpacing 0，不冒充物理桌面截图。原始 cast/事件与测试日志同目录。
- **入口**：服务保持运行在隔离 home `/tmp/ytui-live-H31ffU`。`node packages/cli/dist/index.js chat --home /tmp/ytui-live-H31ffU --session 90` 可查看并继续这段真实独立任务；`--channel cli` 进入实际 main 绑定。日用 alias/安装和主人的 home 未替换。
