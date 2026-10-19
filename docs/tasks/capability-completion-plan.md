# 能力补齐实施计划（实现轮已交付，待审核）

## 当前状态（2026-10-19）

本文件保留当轮方案、授权与结果，不能把当时的“当前/待做/未验收”直接作为今天状态。当前事实见[总账](current-status.md)，后续编排见[待审收尾方案](finishing-plan.md)；本次不重新启动本轮，也不新增功能。

## 历史任务与结果（原文保留）

以下状态、版本及执行要求按记录当时理解；不作为当前派工指令。

> **审查更新（2026-10-18）**：亲自对照锁定文档后发现 I01–I16 实现缺口，原“接线完整”判断不成立；详见 [源码审查](review-c0-c6.md)。下一轮 [修复与验收方案](repair-acceptance-plan.md) 待用户审核，尚未开始开发或运行。以下保留原实现轮记录，不作为真实通过证明。

**当前工位：2026-10-18 用户已批准完整方案；U05 已以 3d31601 完成交接，C0–C6 源码实现轮已结束，待用户审核。** 三个 Sol sub agent 并行，核心和共享文件由主 agent 负责；不写测试、不跑测试，功能体和接线完整实现，问题随任务记录，整轮完成后交用户审核。

U05 交接基线为 3d31601；待用户视觉验收与未安装事实保留。C0 已统一批准文案及关联规范，设计记录 D33。

功能只看 [13 能力补齐边界](../spec/13-capability-completion.md) 及其引用的已批准规范；[Hermes 对比](hermes-capability-comparison.md) 记录现状、取舍与 H 编号。本文件只安排实施，不新增功能。用户本次要求的“不写测试、不运行测试”用于下述实现轮；原 N09/N13/N14 验收留后轮，不删除或预报通过。

## 1. 放行前的现状

- U05 已提交交接，工作区干净；不重做其界面，不把开发态证据扩大为日用验收。
- N05 留在 `zoran/yonder-maintainer` 工作树，基线 `29bc8ec`，未提交产品修复。它落后于 U01 的 manual task、busy、terminal observe，不能整文件覆盖或直接作为新版内核。
- N06 `e067930`、N07 `2d79782` 分别已在独立工作树提交真实插件实现；未进入主仓库发行内容/日用安装。本轮复用已有成果，先读并补缺，不从头重写。
- 已安装版 0.1.4 继续保留；本轮实现不自动切换它。既有会话、home、登录和源码工作树不删除。

## 2. 工序与文件边界

下表中的新目录/文件均为**拟新增**，不是现存能力声明。每项提交按原领域拆，保留原 N 任务结果；下面的 C 编号只用于本轮编排。

| 工序 | 执行内容与预期产物 | 对应需求 | 允许源码路径 / 文档 |
|---|---|---|---|
| C0 接收与锁定 | 等 U05 交接，记录实际 commit；用户批准后，先统一新旧规范、登记设计决定并冻结；派发精确路径 | 13 §5；H01 | 设计方：docs/spec/02-sessions.md、03-agents.md、04-plugins.md、09-cli-release.md、13-capability-completion.md；docs/decisions.md、docs/index.md、相关任务；本工序不改产品源码 |
| C1 核心收口 | 阅读 N05 未提交差异，逐项移植原生回执/恢复/唯一终结；保留 TUI manual/busy/observe；一起修已知来源、权限交集、配置、附件与原契约缺口，冻结必要 SDK | 10 §3–4、13 §2；H02/H03/H04/H07/H11/H12 | 主 agent 独占：packages/sdk/src/、packages/core/src/runtime/、routing/、sessions/、delivery/、config/、prompt/、tools/、store/、kernel/；patches/pi-durable-1.3.0.patch；N05/N09/原 T 任务问题与结果 |
| C2 常规工具 | 整合 N06/N07；补完整插件调用体；实现 web-tools；主 agent 在 runtime 接 rg/Bash 必要适配；给出真实配置说明 | 11 §3–5；H08/H09/H10/H20/H21 | 各 worker 独占自己的 plugins/codex-tools/、plugins/browser-skill/、拟新增 plugins/web-tools/；主 agent 独占 runtime；N06/N07/N08 |
| C3 本地管理 | 复用加载/配置/Skill 解析，完成 13 §3 有限命令的功能体与控制面接线；修 R10；不另造注册表 | 13 §3；H05/H06/H07 | 主 agent：packages/core/src/plugins/、config/、kernel/、control/、runtime/models.ts；worker：packages/core/src/skills/；可按需新增 packages/core/src/plugins/manage.ts、packages/core/src/skills/manage.ts；CLI 由主 agent 接线 |
| C4 渠道与维护 | 一个 worker 按 N10→N11 顺序写 GitHub issue/release；另一个并行写飞书全部功能体；更新 maintainer/operator 的可交付配置和说明 | 10 §1/5/6、11 §6/7；H13/H24/H25/H26 | 各 worker：拟新增 plugins/channel-github/、plugins/channel-feishu/；主 agent：packages/core/src/release/、CLI 必需更新接线；N10/N11/N12。不得修改真实 home/安装/launchd |
| C5 统一入口 | 主 agent 整合管理命令、CLI 附件、TUI/控制/MCP 共用观察与必要参数；插件配置/默认选择接线；不重做 U05 界面 | 12、13 §2–4；H01/H04/H05/H06/H07/H11 | 主 agent：packages/cli/src/、packages/core/src/control/、kernel/、index.ts、plugins/channel-mcp/src/；只有真实调用方需要时改 sdk；相应 README/使用说明 |
| C6 组装交付 | 根 workspace/项目引用/锁文件/许可接线，必要 build/typecheck；整理逐项源码状态、未测/问题、下一轮真实验收清单；到此停止，交用户审核 | 13 §1；全部本轮 H 项 | 主 agent：根 package.json、package-lock.json、tsconfig.json、各包构建清单/必要导出、THIRD_PARTY_NOTICES.md、CHANGELOG.md、README.md/README.zh-CN.md、本计划及原任务结果 |

不在任何任务中顺手清理无关代码；新增依赖只为已批准功能中的真实缺口，沿用已有 pi/SDK/标准库/已装依赖。打包共享文件统一交主 agent，worker 不自行改根锁文件或公共导出。

## 3. 并行分工

采用 **1 个主 agent + 3 个 gpt-6.1-sol 执行 sub agent**。C1 的插件所需接口冻结后派发三路；核心和共享文件由主 agent 单写。

| 执行者 | 顺序职责 | 不碰的共享区 |
|---|---|---|
| 主 agent / Codex | C0→C1；之后 grep/Bash、插件管理/inspect、各路 SDK/CLI/发行组装；检查范围与源码差异、整合提交 | 不覆盖 U05 未提交成果，不复制整套 N05 旧文件 |
| Agent A / Sol | 接收并补齐 N06 codex-tools → channel-github issue → 同包 release；外部 app-server 授权问题单独记录 | 不写 sdk/core/CLI/root 锁文件 |
| Agent B / Sol | 接收并补齐 N07 browser-skill → channel-feishu；浏览器扩展未连不阻塞飞书源码开发 | 不写 sdk/core/CLI/root 锁文件 |
| Agent C / Sol | web-tools Search/Extract/Fetch → skills 本地管理；以现有 Skill 解析为单一来源 | 不写 plugins loader/config、sdk、CLI/root 锁文件 |

C1 的必要接口冻结后，A/B/C 同时开工；每路一个独立工作树。包内工作先完成即接下一项，不等所有工具齐了才写 GitHub/飞书。C3 的插件管理与三路插件开发可并行：它只管已冻结的清单/加载规则，不修改供应商包。C5 接线随各模块交付顺序进入，由主 agent 单写。

```text
U05 交接 + 用户批准
          │
       C0 → C1（共享核心/SDK，单写）
          ├─ A：codex-tools → GitHub issue → release ───────┐
          ├─ B：browser-skill → Feishu ────────────────────┤
          ├─ C：web-tools → skills 管理 ──────────────────┤
          └─ 主：grep/Bash → 插件管理/inspect → C5 接线 ────┤
                                                        C6
                                              实现轮交付，等用户审核
```

当前维护链未闭合，不能为了让 Yonder 开发而先反复安装半成品。本轮由上述 Codex sub agent 补框架，下一轮安装验收后，经 MCP 让真实 Yonder 执行维护任务与测试；既有 N06/N07 保留 Yonder 作者与原会话证据。**Codex 写的源码不算 Yonder 自主完成。** 本编排已随方案批准，取代原 N 任务的后续派工顺序；原功能和验收保留。

## 4. 合并顺序与已知约束

1. **N05 先移植、后接消费者。** 核对旧工作树的完成处理是否会无条件 close task、恢复中是否提前 submit、delivery 是否仍写终态。保留 U01/U05 已有公开契约。只修共享根因，不加另一个状态同步器。
2. **SDK/core/CLI 单写。** worker 报告当前消费者缺口，主 agent 在共享入口修；不在插件内偷接 core 或模拟缺失 API。出现未定义的产品语义写问题，不自行补设计。
3. **同包顺序。** GitHub issue 与 release 由 A 顺序完成；C 的 web-tools 与 skills 互不共享源码，但受并发名额限制顺序接续，不额外开调度层。
4. **外部未就绪不阻塞无关实现。** Browser 扩展、Tavily 凭据、飞书授权等只阻塞相应真实验收；配置/状态/真实调用代码仍按规范完成，不能放空函数。
5. **不以通过测试作本轮派工门槛。** 原 N09 中已知实现缺陷并入 C1/C3；N09 补测试、N13 飞书真实矩阵、N14 全链验收推迟到下一轮。N10/N12 的源码开发不再等 N09 测试完成。
6. **范围外另列。** H14–H19/H22/H23 不进各 worker 提示词；完整 Hermes 生态不成为本轮验收义务。

## 5. 实现轮结束条件

- 所有本轮 H 项都有真实实现和调用方，原来只有接口/槽位的项目不再是占位；每项标明源码提交、未接线/未完成部分及实际执行者。
- 保留功能、配置、错误/取消、附件、来源/权限等原要求；框架轮不豁免这些代码责任，只推迟测试与真实使用验收。
- 不新增测试、不运行测试；只记录实际发生的构建/类型检查。旧失败与未测清单继续可查；无法构建的真实原因记问题，不能标为可组装。
- 新功能操作文档可按步骤阅读；命令是拟新增还是已写、查询的是静态配置还是运行事实必须明确。
- 交付一份短进度清单：🟢 已交付文档/已有具体场景通过；🟡 部分实现或实现未验收；⚪ 未实现；🔴 具体阻塞。颜色不替代文字范围。
- 到 C6 停下。不给自己追加测试/加固/审计循环，不自动安装、推送、发布或发飞书消息。

**下一轮**在用户审核源码和问题后另行放行：补测试/修 bug → 独立安装 → Browser/CUA/Search/飞书真实矩阵 → GitHub issue→Yonder 设计/修复→commit/PR→Codex 审核合并 → 实际 Release→operator 更新。届时逐项沿用 N09/N13/N14 的原验收；目前这些都不是通过状态。

## 本轮执行记录

- C0：完成。U05 基线 3d31601，用户批准记录 e90a647；D33 登记本轮范围、并行与不测试约束。仅文档变更，无安装/外部写入。
- C1：已整合 N05/D29、恢复与唯一终结，保留 manual/busy/观察，来源/权限/附件在共享入口收口；实现未验收。
- C2：BrowserSkill/Codex 旧成果补齐整合、真实 grep、Tavily/Fetch 及原生 Bash 接线完成；实现未验收。
- C3：本地插件/Skills 管理、来源、models/inspect 功能体及调用方完成；实现未验收。
- C4：GitHub issue/comment/PR/Release、服务外更新、飞书完整渠道实现；实现未验收。
- C5：管理 CLI、重复附件参数、TUI/控制/MCP 共用观察接线完成；不重做 U05。
- C6：五包 workspace/锁文件/项目引用、许可、双语 README、CHANGELOG、操作说明与结果记录完成；build/typecheck 通过。无新增/运行测试、运行验收、日用安装、push 或发布。

### 问题

- U05 视觉验收和日用安装未做；沿用其原记录，不在框架轮重跑。

### C1 插件接口冻结

插件继续使用 3d31601 的 PluginAPI、Tool、Channel、Trigger 与凭据接口；本轮不新增供应商专用 SDK。运行恢复所需来源/关联字段只作兼容性新增，不改变这些现有调用签名。三路可据此并行补功能体，核心收口继续由主 agent 执行。C3 Skills 的内部接线约定：保留 pluginDirs: string[]，增加可选 pluginSources（目录到实际 plugin id 的只读 Map），主 agent 从加载注册事实提供；worker 不写 loader/kernel。

### 实际贡献与交付索引

- 主 agent：C0 设计冻结提交 446ea49；C1/C3/C5 的 SDK/core/CLI/MCP/原生补丁、grep/图片与管理共享接线；C6 组装与文档。旧 N05 为 Yonder 草稿，按 U05 逐项移植，未整文件覆盖。
- Sol A 独立工作树：codex-tools/GitHub/Release。固定交付含 2247a55、5328221、20b136b、5c2291e、94aeda8、7dbed57、f8a5e39、50146fa；原 N06 e067930 作者证据保留。
- Sol B 独立工作树：BrowserSkill/Feishu。固定交付含 6cbbce9、695120c、72b67e2、4d13d51、5291733；原 N07 2d79782 作者证据保留。
- Sol C 独立工作树：Web/Skills。固定交付 d6fd2a6、34f0971、855ba5c、beb0abd。
- 三路生产源码和资产按允许路径整合到主仓，各原工作树提交保留；不是把所有 worker 提交直接 cherry-pick 到主分支。主分支按领域单独提交。
- 操作入口：[本轮使用说明](capability-completion-usage.md)。各 N05–N12 任务保留原始证据并追加整合结果。

### 构建结果与未验收问题

- 实际执行 npm 依赖组装、现有补丁脚本、源码格式化、`npm run build`、`npm run typecheck`；最终均成功。早期编译暴露可空关联、声明 AbortSignal 和恢复标志重名，已修复；没有以测试/自检名义运行真实功能。
- 声明与工具注册名称曾不一致、GitHub 用主机时钟推进水位、Codex/GitHub 依赖私人网络 wrapper，均在对应模块修正后整合；未运行外部供应商验证。
- D29 前历史缺原生结束回执无法补造；恢复扫描保留线性历史成本，不另造索引/队列。外部依赖、扩展、真实授权及协议效果未知。
- 多来源/父子/取消/恢复/投递断点、排队模型变化与图片限制等组合未测；N09/N13/N14 保留完整后轮验收义务。U05 视觉验收与日用安装未做。
- 当前来源构建与日用 0.1.4 分离；未声明已安装或自维护闭环真实通过。到 C6 停止，不追加例行检查循环。

### 主分支源码提交

- 24229e4：共享核心、原生恢复回执、SDK、本地管理、Skills、CLI/附件/MCP 观察。
- 5fb51c6：Codex 桌面/hosted search 插件及 N06 结果。
- cb2b800：BrowserSkill 工具、技能与资产及 N07 结果。
- d55101e：Web/Tavily 正文工具及 N08 结果。
- 9d86a5b：GitHub issue/PR/Release/operator 及 N10/N11 结果。
- fa287fb：飞书消息/媒体/卡片/流式及 N12 结果。

N06/N07 旧提交中的测试文件随原源码保留，本轮没有新写、扩写或运行。最终组装文档提交位于这些领域提交之后；查看 `git log`，不预写自身 commit hash。
