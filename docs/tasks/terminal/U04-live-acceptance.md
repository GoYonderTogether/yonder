# U04 真实终端与模型验收

## 当前状态（2026-10-19）

实现已进入独立1902安装，有基础终端真实证据；完整视觉/交互验收仍未关闭。U05交接不是当前阻塞。见[总账](../current-status.md)与[待审P2](../finishing-plan.md)；下方原结果及未测项保留。

## 历史任务与结果（原文保留）

以下状态、版本及执行要求按记录当时理解；不作为当前派工指令。

**依据**：docs/spec/12-terminal-interaction.md 及其关联 02/03/06–09；D30。

**依赖**：U01 U02 U03。

**允许路径**：plugins/channel-cli/、packages/cli/、packages/core/src/kernel/、packages/core/src/runtime/、packages/core/src/sessions/（本轮必要验收检查与缺陷修复）、docs/tasks/terminal/、docs/tasks/README.md、README.md、README.zh-CN.md、CHANGELOG.md；隔离测试目录和本轮可视化输出目录。

**必须**：逐条执行 spec/12 §8，以相同终端尺寸对照 pi 原生；提供真实终端截图/录屏或可重放运行记录与打开入口。只修本轮缺陷。

**验证**：npm run build、npm run typecheck、npm test、npm run lint；记录原始通过/失败/跳过，真实 Luna 工具/续聊/菜单/退出恢复，交付实际画面。

## 问题

- 全量测试首跑 1 failed / 26 passed / 5 skipped（22 files：1 failed / 18 passed / 3 skipped）。新 init 创建 presets，旧测试 mkdir 的目录不存在假设过时；改 recursive，未削弱重载断言。
- 原始全仓 lint 22 errors / 15 warnings；错误涉及文件除 channel-cli 外均与 U00 相同。只格式化本轮改动的 channel-cli，其他旧格式问题不扩围。
- 真实 PTY 发现 live 消息组件每次增量都新建，已修成复用同一组件；实际 entry id 收束和原生快照单独发送一并复验。
- fish 本机无可执行文件：脚本生成，实际 fish 加载未测。
- 日用安装、首次新 OAuth 授权页、Linux/Windows、完整多渠道混合矩阵仍不属于本轮开发预览证据；不冒充已通过。

## 结果

已实现，开发态验收记录如下；完整 §8 矩阵仍待验收，不将局部证据标成全部通过。

- build、typecheck 通过；完整离线回归 22 files：19 passed / 3 skipped，32 tests：27 passed / 5 skipped。原始失败记录保留在上方。
- 独立真实 Luna/control 检查 3 files / 5 passed；增强生命周期检查 1 file / 1 passed，覆盖工具、两轮续聊、服务重启恢复、manual/default 关闭、中止、原生队列撤回及关闭后拒绝。CLI/渠道检查 4 files / 6 passed，包含原始协议和多行单消息。
- 全仓 lint 最终 18 errors / 16 warnings，均保留未扩围；本轮 22 个相关文件定向 lint 0 errors / 3 warnings。全仓 lint 未通过。
- 在隔离 home `/tmp/ytui-live-H31ffU` 运行真实构建程序；PTY 100×30 记录真实 Luna 工具/续聊、main Agent 单条多行输入、中文过滤/Tab、原生会话选择/恢复，并以同版本上游 pi 对照。修复 snapshot 首屏缺失、live/final 重复消息、thinking 初值和工具渲染接线。
- 原始 cast、事件和 PNG 回放：`/Users/zoran/.codex/visualizations/2026/10/18/01a14f54-9c42-7da3-a9c2-995d49d5fb8f/terminal-replay.html`。PNG 来自实际 PTY 输出的 xterm 回放，不冒充桌面截图。可复执行脚本：`packages/cli/test/record-terminal.py`。
- 首次 OAuth 授权页、fish 实际加载、完整多渠道/全部错误矩阵未测；未覆盖日用安装/正式发布。用户随后要求按 Claude 截图进一步精简外观与键位，转 U05 实施。
