# N07 BrowserSkill 默认插件与就绪引导

## 当前状态（2026-10-19）

已整合安装，真实Chrome导航、观察、截图和清理通过；初装/断开引导及全动作未验收，P3收尾。 依据：[当前证据](../current-status.md)、[R结果](../repair-main-result.md)、[F结果](../feishu-recovery-result.md)。本次仅整理状态，后续按[待审方案](../finishing-plan.md)。

## 历史任务与结果（原文保留）

以下状态、版本及执行要求按记录当时理解；不作为当前派工指令。

**状态**：已实现（待验收）；Codex 已审查方案并放行本独立工作树实现，真实页面验收暂阻塞于扩展未连接。

**负责人**：Yonder maintainer；Codex 检查安装与权限阻塞。

**依赖**：N03。未连接时可用系统打开 URL 引导，不要求先通过 N06。

**功能依据**：11 §4。完整条款见 [10](../../spec/10-local-maintenance.md)、[11](../../spec/11-official-plugins.md)，本任务不定义新功能。

## 允许路径

- plugins/browser-skill/
- 根 workspace/锁文件接线、THIRD_PARTY_NOTICES.md
- 安装 home 的默认插件/profile/skill 选择
- 本任务 BrowserSkill 会话与获准引导，不变更无关浏览器设置

本任务文件、任务总表和必要 CHANGELOG 记录可更新；冻结功能文档仅 N00 的设计方可按批准修改。

## 实现安排

移植上游适配单元，接实际 bsk；实现 readiness、服务启动和扩展连接引导，使 BrowserSkill 成为默认浏览器能力。按 10 §2.1 安装并启用后再做 Yonder 真实调用。

## 验证与交付

真实诊断→必要服务启动→用户扩展连接→Agent Window 导航/观察/交互/截图→释放；记录未连接分支，不卸载已有扩展制造场景。

记录实际命令、event/session/model、commit/PR 与失败/跳过；Yonder 和 Codex 的贡献分开归属。

## 方案核对（2026-10-18，待 Codex 审查）

本次执行工作树 `/Users/zoran/.codex/worktrees/yonder-browser/yonder-harness`，分支 `zoran/yonder-browser`，基线 `b7f2951`。首次方案核对阶段仅更新本任务方案/问题，当时未授权产品源码写入、不 commit；后续放行与交付见结果。后续独占修改限 `plugins/browser-skill/` 与本任务；根 workspace、锁、notice 总表、默认安装/profile 接线由 Codex 整合，不按上方历史允许路径自行写入。开发/真实模型验收指定 `openai/gpt-6.1-sol`。

### 1. 复用边界与交付单元

- 固定参考 BrowserSkill `f9b180bccbc79bd507d1ce292901170ca66e2abf` 的 DSH 适配包：复用 `runner.ts` 的固定 executable/argv、JSON 错误与取消；`tools.ts`、`phase-one-tools-{navigation,interaction,support,tabs}.ts` 的动作映射、输入边界；`sessions.ts`、`session-starts.ts`、`start-journal.ts` 的会话所有权和可恢复 start/cancel 协议；`queue.ts` 的按会话串行；`image.ts` 的 MIME 检测。不是导入 DSH 包或照搬 Cordis/DSH 类型。
- 上述相关适配文件已完整阅读。DSH UI、overlay/HTTP 服务、自动缩略图、lazy tool 注入、祖先会话/归档机制不移植；Yonder 自有 skill/tool selection 已承担发现。书签编辑、视频、完整 debug 实验不是 N07 的新增实现范围，CLI skill 的完整说明仍保留，不伪称已注册对应 SDK 工具。
- 随包提供 `skills/browser-skill/SKILL.md` 及 `references/`：采用 `crates/bsk-cli/skill/` 完整主文和全部九份参考，增加明确的 Yonder SDK 工具映射/会话所有权说明；保留原 CLI 说明与按需阅读、真实登录浏览器、页面数据不可信、禁止提取秘密、借用/人类帮助/取消/未知副作用边界。不能把 DSH 工具名直接当 Yonder 工具名。
- 两处上游 LICENSE 均为 MIT，Tencent 2026；复制的代码和 skill 保留版权/许可，在插件内放完整上游 LICENSE 与来源/commit/改编记录，由 Codex 汇入根 THIRD_PARTY_NOTICES。插件只依赖 `@yonder/sdk` 和 Node 标准库；不引入 DSH、React、pi 或浏览器引擎。
- 安装引导对照固定 `origin/main=d9a78aed47874459ae1e44523a597e42dd9acf99` 的完整 `AGENT_INSTALL.md`，不切换/覆盖参考 checkout。真实安装 CLI 为 0.3.3；其 start help 的默认后台语义与参考源码有差异，因此显式传 `--no-focus`，具体 flag 以已装 CLI help 为准，不写版本回退。

### 2. 最小 SDK 工具面

注册以下七个有界工具（参数按 action 校验，禁止任意命令/任意 argv 入口），名称使用合法的 `browser-skill_` 前缀：

| 工具 | action 与范围 |
|---|---|
| `browser-skill_setup` | status（CLI/version、daemon、browsers、doctor 诊断）；start-daemon（先探测后必要启动）；guide（返回连接/安装步骤，明确请求时才用 macOS 打开固定官方商店 URL） |
| `browser-skill_session` | start/stop/list；start 接 browser 实例 ID 或已验证唯一 label、尺寸及 no-focus；只列出/操作本 Yonder 会话拥有的 session/request |
| `browser-skill_page` | navigate/back/forward/reload/wait/wait-for-element；保留 waitUntil、timeout 与 reached/satisfied 的真实语义 |
| `browser-skill_inspect` | observe/snapshot/html/screenshot、必要 console/network 只读诊断；保留 cursor、截断、ref、tabId、capture_id 等 |
| `browser-skill_interact` | click/fill/select/press/hover/wheel/scroll-to/focus/blur；鲜活 refs、Canvas 单次 capture、值/尺寸/有限数值边界沿用上游 |
| `browser-skill_tabs` | list/create/select/close/borrow/return；借用遵循上游确认，不默认接管主人标签页 |
| `browser-skill_file` | upload/download；仅本地连接、显式 agent-local 路径、upload input/drop 显式选择、download 默认不覆盖；返回真实传输结果 |

`request-help`、resize/emulate 可作为 interact 的必要辅助 action 沿用上游映射，不另建一套人类授权系统。每个工具声明实际所需能力：统一有 `exec`，浏览器工具加 `read/network`；file 同时加 `write`。setup 需要 `exec`（联网/开安装页的工具保守声明 `network`）；不让 readonly 获得本机进程入口。权限仍由内核能力筛选/调用前判定，不复制 agent 权限系统。

### 3. 执行、取消和资源边界

- 使用确定的 bsk 程序（本机已验证 `/Users/zoran/.local/bin/bsk`；产品默认 PATH 的 `bsk`，只允许插件配置指定 executable，不接受模型传入），`spawn(program, argv, {shell:false,...})`；所有模型文本是单独 argv 值，防止以 `-` 开头的位置参数被解释为选项，必要时用明确 ref/selector flag 或 CLI 支持的 `--`。固定 `/usr/bin/open` 仅接 Chrome/Edge 官方商店枚举 URL，不接受任意 shell 或安装脚本。
- 每次 bsk client 都继承现有环境并设置 `BSK_AUTO_START=0`；不新设 `BSK_HOME`、不改 HOME、自动安装、删除 runtime 文件或停止/restart daemon。设置 setup 只注册工具/skill/生命周期贡献，不探测、不启动、不写 journal。
- 采用上游 start request `prepare → start --request-id → claim`，request 与 `ctx.session` 绑定，持久所有权仅存 `api.paths.data`；start 返回前失败/取消按该 request cancel，不凭短 session ID 猜归属。不允许另一 Yonder 会话指定或隐式取用它，也不采用全插件共享 current 指针。显式 stop 以 request 为稳定目标；失败保留可诊断记录，不能删除记录当作释放成功。
- 使用已有 SDK trigger 的 start/stop 生命周期承载加载记录/停止清理，`session.close` 监听只清理匹配 owner；不新增 SDK dispose。重启后的遗留记录仅核对并清理本插件 request，不接管外部 session；首次工具调用/显式 cleanup 再协调，setup 不 IO，不运行后台轮询或自动重试任务。具体生命周期接线接受 Codex 审查。
- 每个 bsk session FIFO；排队取消不启动命令，执行中按 `ctx.signal` 发送 SIGINT，让 CLI 发送 cancel RPC，再沿用上游有界强杀/收尾，绝不重放动作。stop 已接受后清理与调用者等待取消分离；清理失败保留 request 和真实错误。不搬入上游 session_busy 自动重试。
- 返回来源 `BrowserSkill/bsk`、命令类别和实际 JSON/错误 code/message/hint/data（包括 effect_state），不把退出 0 的 `satisfied:false`、`reached:timeout` 变成功。空输出/坏 JSON/超时/程序缺失明确失败，不静默回退。
- 截图写插件创建的唯一临时文件，只读回该实际目标；识别真实 MIME，用 `ToolResult.images[{mime,data:base64}]` 交模型，文本保留尺寸、tab/ref、capture_id/capture_unavailable。成功、失败、取消均清理自身临时文件；不只返回本机路径充作图片。文件传输复用 CLI staging/atomic commit/cancel，不复制实现；路径相对执行环境 cwd 解析。本轮只验收本机，远程 env 不得悄悄读写 harness 主机文件。

### 4. readiness 与引导顺序

1. version/帮助确认 CLI；spawn ENOENT 才报 CLI 缺失，报告已装位置/PATH 修复或官方安装说明，不自动安装。
2. 用 `BSK_AUTO_START=0 status --json` 诊断。可达则复用；只有已确认 listener/发现缺失才允许显式 `start-daemon` 执行一次 `daemon start`，随后独立调用 status 验证。权限/超时/协议错误不是缺失，不启动第二份，不停止共享服务。idle 退出后重新探测，不依赖旧 PID。
3. status 的 browsers 为空/指定实例不在线：报扩展未连接，不报“未安装”。展示实际 WS port、原 BSK_HOME 语义及所选实例；先请用户在该浏览器/profile popup 启用本地连接、核对端口。只有用户确认确需安装，guide 才经固定 open 打开相应官方商店，让用户安装/连接；不能依赖未就绪 BrowserSkill 自己点击。
4. 用户完成后重跑 doctor/status/browsers，验证同一实例；目标不在/label 歧义即停，不换 profile。已连接只代表连接可用；Yonder skill 发现、创建 Agent Window、导航观察与释放全部通过后才记录首次使用验收通过。

### 5. 最小检查及真实验收

- 实现后运行插件局部 build/typecheck/lint，vitest 调 `checkPlugin`，核对 manifest 七工具/skill/生命周期声明与真实注册；无 setup IO。最小纯函数检查覆盖 argv 注入/边界、错误 JSON/状态判定、跨 owner 拒绝、排队取消、截图 MIME 与临时文件清理，不写模拟模型或伪浏览器成功。
- Codex 完成共享 workspace/默认选择、安装和服务外更新后，真实 Yonder `openai/gpt-6.1-sol` 调用：发现 skill → status/doctor → 必要启动 → 绑定获准实例 → start(no-focus) → example.com 导航/observe/截图 → 获准页面上的一次可逆点击/填写/选择/按键/滚动与 tabs 创建/关闭 → stop。传输另用获准非敏感文件与测试页面真实上传/下载，检查字节与不覆盖规则；没有页面/授权即明确未测。取消用真实等待命令验证，不伪造成功。
- 成功/失败都核对仅自身 session/request 已释放、借用标签已归还；不重启 daemon。记录 event/session/model、bsk/browser IDs、命令、图片结果、失败/跳过及证据路径。
- 未连接分支沿用已有真实未连接诊断与引导证据；自然出现断连时补录，不卸载、禁用扩展或改权限制造场景。不能以当前 daemon 缺失代记“扩展未连接路径验收通过”。

## 问题

- SDK 没有通用插件 dispose，但有 trigger.stop 和 session.close 事件；以上使用该既有生命周期清理 request，请 Codex 核对，拒绝为此扩展冻结 SDK。会话所有权按 `ctx.session` 收紧，不移植 DSH 祖先关系。
- 本轮 status 实际失败的 JSON `code:null`，message 明确 `automatic daemon startup is disabled (BSK_AUTO_START=0)`、exit_code=2；源码 ensure_daemon 在 probe 缺失时生成此错误。实现需保留原错误，只对已核实的缺失特征允许启动，未知错误一律诊断，不按任意非零退出码启动。
- 已装 CLI start help 与参考 f9b180b 的焦点默认不同；显式 no-focus 可消除该差异，request prepare/claim/cancel 已由已装 CLI help 确认可用。其他命令实现时仍核对已装帮助。
- 方案核对时真实 SDK 工具接通、图片/取消/文件验收尚未执行，没有产品实现或通过声明；放行后的实现与实际检查见下方结果。远程文件模式上游不支持，不能补造支持。

## 结果

方案核对后已获 Codex 授权实现。首次资料路径中的 `tasks/README.md` 实际不存在，已完整阅读仓库对应 `docs/tasks/README.md`。下述首轮只读探测保留历史归属；产品实现与本轮真实检查另列于后。

本轮仅只读探测：`bsk --version` 返回 0.3.3；`BSK_AUTO_START=0 /Users/zoran/.local/bin/bsk status --json` 返回上述未运行诊断，未启动/重启 daemon、未操作浏览器。读取 start/request help 确认已装接口；`yonder --help`、`yonder docs --list` 确认运行环境文档入口。

Codex 先前真实宿主证据（由输入提供，非本轮维护 agent 复验）：doctor 8/8，Chrome 实例 `195df83d`，session `mlag` no-focus 导航 example.com、observe 并 stop；证据 `/tmp/yonder-n07-navigation.json`、`/tmp/yonder-n07-observation.json`。不能据此声称 Yonder 插件已安装/验收，也不假定 daemon 当前仍存活。


### Codex 放行后的实现与检查

- 已实现独立 `@yonder/plugin-browser-skill`（0.1.4）：七工具、按 action 的输入 schema/argv 映射、macOS-local 环境拒绝边界；固定 PATH `bsk`（可配置 executable），每次 client 强制 `BSK_AUTO_START=0`，无 shell、无自动重试/repair/daemon restart。会话按当前 Yonder session 所有权隔离；保留 native prepare/start/claim/cancel、最小持久事实、串行和排队/执行/stop 等待取消边界；setup 无 IO，trigger 生命周期/session.close 只处理本插件请求。截图返回真实 images，临时目录 finally 清理；文件传输沿用 native CLI。完整 CLI skill/九份参考加明确 SDK 映射与范围说明，保留 Tencent MIT 许可和固定来源 NOTICE。
- 依赖：本工作树 `npm ci --offline` 成功（236 packages，audit 0 vulnerabilities）；未改根 workspace/锁。仅局部 `tsc -b packages/sdk plugins/browser-skill`、`biome check plugins/browser-skill`、`vitest run plugins/browser-skill/test/plugin.test.ts --exclude '**/dist/**'`；最终 **11 passed、0 failed、0 skipped**。检查覆盖 checkPlugin/声明注册、setup 无依赖 IO、输入边界/选项注入、原生错误和未知 effect、就绪判定、MIME、远程环境拒绝、owner 拒绝、排队取消及 stop 等待取消。没有模拟模型/浏览器成功或全仓测试。
- 新增可执行 `test/live.mjs`，从编译后的插件入口调用真实 bsk；明确这是 source integration，不是安装版 Yonder 或真实模型验收。脚本不生成虚构输出，page 模式只对显式提供的获准实例创建 no-focus Agent Window、导航 example.com、观察、截图、释放；失败同样释放自己已取得的 request。
- 本轮真实 source status 先报告 daemon-absent，`pgrep -x bsk` 未见进程后，经 setup 的 `start-daemon` 仅启动一次已有本地 daemon。原 BSK_HOME 默认保持不变，没有重启或停止 daemon。**发现并修复实际接口差异**：已装 0.3.3 的 `daemon start --json` 退出 0 但 stdout 空，首版把它当 business JSON 因而如实失败；现在启动命令只检查原生退出/取消/超时，再用独立 status 探测判定，不用空输出充作就绪。修复后没有为覆盖启动分支再次重启 daemon，因此新启动分支只经局部构建/审阅，需下次自然缺失时复验。
- 独立后续 source status/guide 证实 daemon 0.3.3 可达、WS 52800、IPC 身份匹配；**浏览器列表为空、doctor 的 extension connected 为 fail**。guide 已真实返回“未连接不等于未安装”、原 profile popup 的 Local connection/端口步骤和官方商店链接，未打开安装页、未安装/卸载/禁用扩展、未改权限。需要用户/Codex 在原 `195df83d` 对应 profile 检查 popup 并恢复本地连接，不能据空列表换 profile。
- `page 195df83d` 真实 source 运行在 readiness 门槛失败（Not connected，退出 1），**尚未创建 session/导航/观察/截图，因此无本轮浏览器资源可释放**。先前 Codex 的成功不代记为本轮成功。真实未连接分支来自自然状态，没有人为制造。
- 证据目录：`/var/folders/hg/8kf929p12wz498k8q4r74kg00000gn/T/yonder-n07-source-live/`；`start-daemon.json` 保留首版真实空 JSON 解析失败，`status.json`/`guide.json` 为真实断连诊断和引导，`page.json` 保留 readiness 阻塞。真实命令均由 `BSK_TEST_EXECUTABLE=/Users/zoran/.local/bin/bsk node plugins/browser-skill/test/live.mjs <mode> [195df83d]` 发起；个人路径仅是本机检查输入，不写死在产品默认配置。
- **未测/待完成**：已连接 source 页面/图片/原生 request 全生命周期；已连接页面动作与 tabs；真实上传下载（需要获准页面/非敏感文件）；执行中 native browser 取消及图片临时文件路径的真实失败/取消；guide 实际打开商店（已有扩展，不制造安装需求）；安装后的 skill/profile/tool 发现与 `openai/gpt-6.1-sol` 实际模型调用/event/session 证据。纯队列/等待取消单测不能代替真实 native browser 取消。没有 commit/PR 外部发布或服务更新。
- **Codex 整合需求**：根 workspaces/lock/tsconfig 引入此包；安装包列表和目标 profile 的 `browser-skill` 插件、`browser-skill_*` 工具、`browser-skill` skill 默认选择；按实际安装配置 bskPath/PATH；根 THIRD_PARTY_NOTICES 汇入插件 NOTICE/完整 MIT；从服务外更新安装并继续真实模型验收。本任务未写上述共享文件。

## C2 补齐结果（2026-10-18）

实现未验收。复用 Yonder 的 2d79782（本工作树整合为 6cbbce9），原测试原样保留、未运行。现有七组工具已覆盖完整导航/观察/动作/截图/文件/标签与原生 request prepare/claim/cancel 所有权；补齐 CLI 缺失的结构化 readiness 状态与进程重启后已持久化任务会话释放。未重写驱动，不改共享 daemon 或 BSK_HOME。

未运行模型、浏览器、桌面、安装或任何测试。扩展未连接为历史验收阻塞；完整 N13/N14 矩阵留后轮。根 workspace/锁/构建引用由主 agent 接线。

### C6 主仓组装记录

本包生产源码、必要既有资产已整合到主仓，根 workspace、锁文件与 TypeScript 引用已接线；全仓 `npm run build`、`npm run typecheck` 通过。上文工作树检查为历史证据，当前不再处于“待根组装”。本轮没有新增/运行测试、授权、模型、外部 API/消息/安装/发布调用；功能保持“实现未验收”，原真实验收和未完成项留后轮。贡献归实际实现者，不把 Codex 续写计为 Yonder 自主实现。
