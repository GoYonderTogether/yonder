> 1906最新全貌比较（2026-10-19）：见[产品能力与Hermes/OpenClaw体验对比](product-capabilities-1906.md)，按最新官方文档核对默认安装、细节与扩展边界。下方1903/1904及2026-10-18表格全部保留为历史，不据旧版本声称当前差距已关闭。

> 正式发行补记（2026-10-19）：0.1.2026101904 / 42646a4已在main发布，功能与下方1903对比基线相同；全部差距和未测保留，见[发行记录](stable-release-result.md)。

# Hermes 对比与范围收敛

## 当前结论（2026-10-19）

已实现功能先打磨，未通过的真实场景保留。复杂新插件后置；cron仅作为打磨后优先讨论的简单插件候选，本轮未开发。接口、注册、构建均不计整项功能完成。

本轮已执行：源码功能基线 `504b7fc`，日用 `0.1.2026101903`；P轮结果见[交付记录](finishing-result.md)。原比较和验收历史保留。Hermes仍按既有固定源码 `0eb4f62a8b35ff3b0454a8dbdbd3a7b55a6849b0` 比较，未重新拉取，也不宣称是最新Hermes功能或已实际验收Hermes。原功能定义和参考链接保留于下方历史快照。H25/H26是Yonder项目目标，不宣称Hermes有相同原生自维护/更新闭环。

证据编号见[现状总账](current-status.md)，P编号见[待审收尾方案](finishing-plan.md)，功能粒度见[插件清单](../plugins.md)。本页已归并P轮145项检查、独立更新及新增真实渠道证据；完整矩阵未关闭，不外推Hermes同等完整度。

| 编号/能力 | Yonder当前结论 | 与原对照能力的缺口/边界 | 证据/安排 |
|---|---|---|---|
| H01 终端交互 | 已实现、部分真实通过 | 1902裸命令接入main；完整TUI/视觉组合未闭合 | E02 / P2 |
| H02 会话与恢复 | 已实现、部分真实通过 | 持久会话与原生回执已整合；崩溃/恢复组合待补 | E03 / P0、P5 |
| H03 委派并行 | 已实现、具体场景通过 | 真实父子并行、取消已过；不等于所有附件/来源组合通过 | E03 / P5 |
| H04 回执进度投递 | 已实现、部分真实通过 | 接纳/运行/送达分离，观察接线存在；恢复失败组合待补 | E03、E09 / P5 |
| H05 Skills管理 | 已实现、部分真实通过 | 本地导入/查看/删除、发现/读取；真实自创建到下轮使用仍缺证据 | E11 / P2、P4 |
| H06 插件管理 | 已实现、安装可用 | 8官方插件已整合；新插件真实开发安装循环未闭合 | E02 / P4 |
| H07 模型工具配置 | 已实现、部分真实通过 | Luna/Sol与models/inspect、配置来源可用；完整失败/重载组合待补 | E01、E03 / P2、P5 |
| H08 浏览器 | 已实现、基本场景通过 | 真实导航观察截图清理；38动作及扩展初装不是全通过 | E04 / P3 |
| H09 Computer Use | 已实现、部分真实通过 | 飞书界面读取/动作/截图可用；窗口及生命周期失败保留 | E04 / P3 |
| H10 Web Search | 已实现、基本场景通过 | hosted search与Tavily均有真调用；不承诺全部供应商覆盖 | E05 / P3 |
| H11 图片附件 | 已实现、部分真实通过 | 实际附件管线和限制已接；全部渠道/模型/媒体组合未闭合 | E01、E08 / P1、P5 |
| H12 权限来源 | 已实现、部分真实通过 | 共享入口修复和受限operator已用；完整多人权限矩阵待补 | E01、E07、E09 / P1、P5 |
| H13 安装更新 | 已实现、具体链通过 | 1903独立更新安装；1805正式Release自动更新；全新用户/开机自启待验 | E02、E07 / P2、P5 |
| H14 通用MCP客户端 | 未实现；后续 | 当前仅服务端及特定桥接，复杂扩展后置 | 非收尾范围 |
| H15 主动记忆 | 未实现；后续 | MEMORY.md加载不能代替主动记忆引擎 | 非收尾范围 |
| H16 跨会话检索 | 未实现专用检索；后续 | 有指定会话转录和事件查询；先验证是否够用 | 候选，不开发 |
| H17 Skill自我改进 | 部分实现；复杂链后续 | creator/本地管理已具备；无反馈评分或自动改进同步 | E11 / P2、P4；不加引擎 |
| H18 cron | 未实现；简单新插件候选 | trigger槽不是定时任务；打磨后另审最小插件 | 候选，不开发 |
| H19 后台进程/PTY | 未实现专用管理；后续 | Bash和launchd服务不等于agent持久终端工具 | 非收尾范围 |
| H20 grep | 已实现、基本场景通过 | 原生rg工具与权限接线已有真实调用 | E03 / 仅缺口回归 |
| H21 Web Fetch | 已实现、基本场景通过 | 有界GET/HTML正文等可用；不是登录浏览器/二进制解析器 | E05 / P3 |
| H22 澄清/清单工具 | 无专用工具；按需再议 | 普通对话和文件已能提问/列清单，不预设新增插件 | 默认不新增 |
| H23 PDF/Office提取 | 未实现；后续 | 附件传递不等于文档解析 | 非收尾范围 |
| H24 飞书 | 已实现、部分真实通过 | 私聊/离线合并、群免@/@旁观、回调、原生同轮A/B已过；线程/媒体/执行中插话完整矩阵未过 | E08–E10、E12–E13 / P0、P1 |
| H25 GitHub自维护 | 已实现、单链通过 | issue→自主修复→commit/PR→Codex审查合入任务分支；不是全自主合并 | E06 / P4、P5 |
| H26 Release与operator | 已实现、单链通过 | 真实1805发布→独立更新→核验→飞书通知；1903尚无Release | E07 / P4、P5 |

**本轮结论**：P0–P5执行结果已交付，先修已有实现、保留剩余真实矩阵，停止开发待用户审核；不重开已通过功能。未关闭项见本轮结果。

**后续再做**：H14/H15/H16/H17未具备部分/H18/H19/H23及原后续项目；其中cron可以先讨论薄插件方案，但本轮不搭框架。

**不做**：保留历史第6节的范围排除和重复架构禁令；普通澄清/清单不自动变成插件。不以“追平Hermes”为理由增加新内核或平台。

---

## 历史快照：2026-10-18 原比较与C6更新（原文保留）

以下“当前”“未安装”“尚未实现”“本轮不测试”等字样只属于当时快照，不代表2026-10-19现状。后续R/F、D36/D37证据以本页当前表及总账为准。

### 原比较记录

**日期：2026-10-18。状态：现状核对已完成；用户已批准本轮范围，U05 已交接，按 C0–C6 实现；本表仍按原核对时点标注现状。**

结论：先完成已有能力的真实调用链，以及已批准的工具、GitHub、更新、飞书；不为追平 Hermes 数量补记忆引擎、cron、通用 MCP 客户端或另一套任务平台。所有已实现但不完整的项目都列在下表，不用“接口存在”冲抵功能缺口。

- 功能详情：[13 能力补齐边界](../spec/13-capability-completion.md)。已批准的功能继续引用 10/11/12，不在计划里重写。
- 实现安排：[能力补齐实施计划](capability-completion-plan.md)。用户批准见 e90a647，U05 交接见 3d31601。
- 原记录：[第一轮审查](review-first-pass.md)、[N 任务](next/README.md)、[TUI 任务](terminal/README.md)。本表不删除原失败、跳过和验收要求。

## 1. 对比口径与源码基线

Hermes 参考为本机 `hermes-agent-latest` 的固定快照 `0eb4f62a8b35ff3b0454a8dbdbd3a7b55a6849b0`。比较的是功能覆盖，不表示本次实际运行验收过 Hermes。

原核对时 Yonder 主仓库已提交基线为 `f9662ad`，U05 当时尚未交接；其后以 `3d31601` 交接，当前实现结果见末节。独立安装版仍是 0.1.4，来源 `99b019776ff891a0c4ab3403ae9d487d739ebf3d`，不能把开发分支当成日用版本。

源码、安装和真实使用分开记：

- **未实现**：没有实际功能体；只有类型、槽位、清单或注册也归此类。
- **已实现一部分**：存在实际调用，但还有明确的功能、接线或失败路径缺口。
- **实现未验收**：功能体及调用方已接好，尚未完成对应使用验收。
- **安装未验收**：已进入真实安装版本，但尚无该版本的对应使用证据。
- **真实使用通过**：只对已记录的具体场景成立，不扩大成整个模块完成。

以上是文档证据标签，不新增产品状态机。框架轮按用户要求不新增、不运行测试；“实现未验收”是该轮可交付状态，不能写成“功能完成”。下列既有运行结果继承原记录，本次没有重跑。

## 2. 基础能力：已有具体场景通过

| 能力 | 当前已有证据 | 不能由此推出 |
|---|---|---|
| 模型与工具循环 | 安装版真实 Luna、Sol 调用 Bash；N03/N04 | 所有模型、上下文长度、工具组合都可用 |
| 本机文件工具 | 已有 read/write/edit 实现与局部检查 | 所有附件和权限组合均已通过 |
| 本机 Bash | 真实 cwd/命令输出闭环 | 后台进程管理、持久 PTY 已实现 |
| 独立模型登录 | Yonder 自己的 home 完成 OAuth | Codex hosted search 也自动可用 |
| 基础持久会话 | SQLite 保存会话/转录，安装版重启后续聊 | 崩溃窗口、steer 和投递恢复已闭环 |
| 基础流式 | 安装版普通文字/工具过程已观察；U04 有独立终端证据 | 飞书卡片流式、多来源组合已通过 |
| 独立会话并行 | N05/N06/N07 原生会话实际交错执行 | `task_run` 父子并行、取消传播已完整验收 |
| 独立安装与常驻 | 0.1.4 安装目录、home、launchd 服务已运行 | GitHub Release → operator 自动更新已完成 |

这些基础能力保留，不再另写实现。下面列其尚未闭合的部分。

## 3. 本轮必须补齐：全部“已有但不完整”项目

| 编号 / 能力 | Hermes 对照能力 | Yonder 现状与缺口 | 本轮交付边界 | 依据 / 实施工序 |
|---|---|---|---|---|
| H01 终端交互 | 交互输入、会话和配置选择、过程显示 | U01–U04 已有源码与隔离终端证据；U05 进行中；未进入日用安装 | 接收 U05 成果，保留原生 pi 交互和可续聊任务；接入本轮真实管理结果 | 12；C0/C5 |
| H02 会话管理与恢复 | 继续会话、历史、生命周期恢复 | list/show/open/submit/abort/close 已有；N05 跨崩溃关联未交付 | 接纳、排队、运行、结束、重启恢复贯通；不覆盖 TUI 新语义 | 10 §3–4、12；C1 |
| H03 子任务委派与并行 | delegate 子任务及结果/进度 | `task_run`/`agent_ask` 已有；父子结果、附件、权限和取消组合不足 | 复用 pi 原生父子任务与工具并行；结果、父子身份、取消可追踪；不新建批调度器 | 10 §4、13 §2；C1 |
| H04 回执、进度与投递 | 运行/工具进度与终态 | MCP 能提交/查询；TUI 有观察流；缺统一关联及恢复后的唯一终结 | 共用原生运行事实；观察不抢回复；输入接纳、模型结束、渠道送达分开记录 | 10 §3、11 §2、13 §2；C1/C5 |
| H05 Skills 使用与管理 | 发现、读取、安装/管理 skill | 发现、索引、`skill_view` 已有；缺本地导入/查看/删除；来源错误 R10 | 本地目录导入、列出/查看、删除限定位置副本；沿用现有选择与遮蔽规则 | 03 §6、13 §3；C3 |
| H06 插件使用与管理 | 插件安装、状态、贡献和配置管理 | 八槽、加载和校验已有；缺实际管理命令 | 本地/已随安装提供的包 add/list/show/remove；显示贡献与选用；引用未解除不能移除 | 04、13 §3；C3 |
| H07 模型、工具与配置 | 模型选择、工具配置与诊断 | YAML/profile/reload 已有，Luna/Sol 已用；缺可理解的有效配置查询 | 显示模型目录、实际配置来源、工具暴露/权限；沿用文件配置和预设选择 | 08、12、13 §3；C1/C3 |
| H08 浏览器 | 页面观察、交互、截图、连接引导 | N07 在独立工作树提交 `2d79782`；七工具及 skill 已写；扩展连接阻塞，未整合安装 | 整合现有实现，补齐真实连接/引导调用链；不重写浏览器驱动 | 11 §4；C2 |
| H09 Computer Use | 桌面发现、读取、截图、动作 | N06 提交 `e067930`；已有本机 app-server 适配；不等于安装版 Yonder 通过 | 整合同一后端的状态/JS/重置工具与图像输出，保留授权和焦点边界 | 11 §3.1；C2 |
| H10 Web Search | 带来源的在线搜索 | N06 hosted search 有源码与原生探测；未安装；Tavily 未实现 | 分别实现 hosted search 与 Tavily Search/Extract；供应商可见，无静默替代 | 11 §3.2/5.2；C2 |
| H11 图片与附件 | 图片输入/处理和多模态上下文 | Attachment 类型与部分管线已有；实际大小/模型限制/恢复关联不足；控制 CLI 仍需接附件 | 实际字节、格式与模型限制；渠道/MCP/CLI 到模型和子任务的附件完整保留 | 03 §5.3、10 §4、13 §2；C1/C5 |
| H12 权限与调用来源 | 工具权限、路径和子任务隔离 | 能力+级别已写；合并来源、预设继承、插件 submit 来源仍有缺口 | 在共享入口修来源与能力交集；保留真实路径/取消边界，不复制审批系统 | 05、10 §3–4；C1 |
| H13 安装、版本与更新 | 安装管理、诊断、更新 | 本机阶段安装已用；新插件/TUI 未安装；正式发布链与服务外更新未完成 | 组装完整发行内容、保留数据与来源、接通已有更新策略；真实安装验收留后轮 | 09、10 §2/6；C4/C6 |

## 4. 本轮必须补齐：已批准但尚未实现的功能

| 编号 / 能力 | Hermes 对照 / 原目标 | Yonder 现状 | 本轮交付边界 | 依据 / 实施工序 |
|---|---|---|---|---|
| H20 grep | 文件搜索工具 | 尚无模型可调用的专用 grep | runtime 适配 rg，固定 argv、路径权限、文件/行号/截断；不再造搜索引擎 | 11 §5.1；C2 |
| H21 Web Fetch | 公开网页正文提取 | 尚无高级 Fetch 工具 | 有界 GET、成熟 HTML 正文提取、text/JSON/Markdown；取消、HTTP 错误、登录/JS 提示 | 11 §5.3；C2 |
| H24 飞书 | Hermes 飞书渠道；本项目已批准完整矩阵 | 只有通用渠道槽，没有飞书插件 | 私聊/群聊、@/引用/线程、消息/多媒体、普通/流式卡片、按钮回调、配置及断连处理全部写完 | 11 §7；C4 |
| H25 项目维护 agent 与 GitHub | 本项目目标，不宣称 Hermes 已有相同自动维护闭环 | maintainer 已创建，做过一个真实修复；GitHub 插件未写 | issue/comment → 事件绑定 → 读规范/参考项目 → 设计/修复 → commit/PR；Codex 审查合并 | 10 §1/5、11 §6；C4 |
| H26 发布消息与 operator | 本项目目标，不作为 Hermes 原生对等项 | operator 已创建；Release 监听与独立更新作业未写 | 同一 GitHub 插件监听真实 Release；operator 通过服务外一次性作业执行更新并核对结果 | 10 §6、11 §6；C4 |

飞书“全部写完”不等于真实飞书通过。GitHub/更新“全部写完”不等于已发 PR、发布或替换安装。本轮交付后逐项保持“实现未验收”。

## 5. 后续再做

| 编号 / 能力 | Hermes 有什么 | Yonder 当前差距 | 本轮处理 |
|---|---|---|---|
| H14 通用 MCP 客户端 | 连接任意配置服务器、发现/调用工具与鉴权 | 只有 MCP 服务端和特定 Codex 桥接，不是通用客户端 | 后续独立设计，不混进渠道 MCP |
| H15 主动记忆引擎 | memory 工具、长期记忆维护 | MEMORY.md 只是被选中的上下文文件 | 后续，不把文件加载叫记忆引擎 |
| H16 跨会话检索 | session search/历史搜索 | 只有指定会话转录分页和事件查询 | 后续，不为此复制转录 |
| H17 Skill 自我改进 | 创建、使用反馈、改进与同步工具链 | 只有发现/读取；本轮增加本地管理 | 后续；本轮无自动生成、评分或自更新 |
| H18 cron | 定时任务管理与唤醒 | trigger 槽存在，cron 插件未写 | 后续；槽位不算定时功能 |
| H19 后台进程与持久 PTY | process/后台终端生命周期 | 只有本机 Bash；TUI 的 PTY 验证不是产品工具 | 后续，不顺手增加进程管理平台 |
| H22 澄清与任务清单工具 | clarify、todo | 没有专用工具；普通对话仍能提问/列清单 | 后续按实际需求决定是否需要 |
| H23 PDF/Office 文档提取 | 文档读取工具与格式提取能力 | 文件附件不等于已解析内容 | 后续插件，不在 Fetch 中伪装支持二进制文档 |

同属后续：任意模型自动路由/供应商回退、会话中热切换 profile、脱离父任务的长期子 agent、在线插件/Skill Hub、TUI 图片剪贴板/拖拽。以上均不阻塞本轮明确入口的实现。

## 6. 不做

**本轮不做，未来有具体需求才立项**：除飞书/GitHub/CLI/MCP 以外的渠道；Docker/SSH/云执行后端大全；Desktop/Web 管理站；Honcho 生态；MoA；看板/工作流平台；研究/训练平台；图片/音视频生成全家桶；IoT；完整 IDE/LSP/ACP；Nous 专用网关。这些不是为达成本轮闭环所必需的缺口。

**明确不采用的重复架构**：第二套模型循环、转录库、执行队列、通用任务调度平台、重复能力/审批系统、为显示 TUI 而运行完整 coding-agent 内核。安全输入边界、数据保护、真实协议取消与错误处理继续保留。

## 7. 可追溯来源

- Hermes 固定源码：[工具集](https://github.com/NousResearch/hermes-agent/blob/0eb4f62a8b35ff3b0454a8dbdbd3a7b55a6849b0/toolsets.py)、[CLI 入口](https://github.com/NousResearch/hermes-agent/blob/0eb4f62a8b35ff3b0454a8dbdbd3a7b55a6849b0/hermes_cli/main.py)、[委派](https://github.com/NousResearch/hermes-agent/blob/0eb4f62a8b35ff3b0454a8dbdbd3a7b55a6849b0/tools/delegate_tool.py)、[Skills](https://github.com/NousResearch/hermes-agent/blob/0eb4f62a8b35ff3b0454a8dbdbd3a7b55a6849b0/tools/skills_tool.py)、[Web](https://github.com/NousResearch/hermes-agent/blob/0eb4f62a8b35ff3b0454a8dbdbd3a7b55a6849b0/tools/web_tools.py)、[MCP](https://github.com/NousResearch/hermes-agent/blob/0eb4f62a8b35ff3b0454a8dbdbd3a7b55a6849b0/tools/mcp_tool.py)。
- Hermes 功能说明：[工具](https://hermes-agent.nousresearch.com/docs/user-guide/features/tools)、[委派](https://hermes-agent.nousresearch.com/docs/user-guide/features/delegation)、[Skills](https://hermes-agent.nousresearch.com/docs/user-guide/features/skills)、[记忆](https://hermes-agent.nousresearch.com/docs/user-guide/features/memory)、[MCP](https://hermes-agent.nousresearch.com/docs/user-guide/features/mcp)、[cron](https://hermes-agent.nousresearch.com/docs/user-guide/features/cron)、[飞书](https://hermes-agent.nousresearch.com/docs/user-guide/messaging/feishu)。固定源码优先用于复现本次比较。
- Yonder 实时源码：[SDK](../../packages/sdk/src/types.ts)、[runtime](../../packages/core/src/runtime/)、[sessions](../../packages/core/src/sessions/index.ts)、[观察流](../../packages/core/src/runtime/terminal.ts)、[Skills](../../packages/core/src/skills/index.ts)、[插件加载](../../packages/core/src/plugins/index.ts)、[MCP](../../plugins/channel-mcp/src/operations.ts)、[CLI](../../packages/cli/src/index.ts)。
- N05 未提交工作树：`/Users/zoran/.codex/worktrees/yonder-maintainer/yonder-harness`，基于 `29bc8ec`；不能整文件覆盖现有 TUI。N06/N07 的提交在各自工作树，尚未集成到主线发行内容，见实施计划 C2。

## C6 更新：源码实现与验收分开

本表前述现状列保留原审查快照。C0–C6 已接收 U05，并对 H01–H13、H20/H21/H24/H25/H26 实现本轮规定的功能体、调用方及打包接线；当前统一为**实现未验收**，不能将构建通过改写成 Hermes 同等功能完整度或真实使用通过。没有新增测试、运行测试或安装。

- H02/H03/H04/H11/H12：D29 原生回执、恢复前置、唯一终结、实际输入来源/权限/附件、父子与统一被动观察接线。
- H05/H06/H07：本地 Skills/插件管理、models/inspect、来源与有效配置查询。
- H08/H09/H10/H20/H21：BrowserSkill、Codex 桌面/hosted search、grep、Tavily Search/Extract/Fetch。
- H13/H24/H25/H26：GitHub issue/PR/Release/operator、飞书消息/多媒体/普通与流式卡片功能体。
- H01：保留 U05 呈现与 U01 任务语义，接本轮管理与观察；视觉验收未新增。

实际 build/typecheck、贡献及已知问题见 [实施记录](capability-completion-plan.md)，具体命令和验收缺口见 [操作说明](capability-completion-usage.md)。H14–H19/H22/H23 与“不做”项保持原取舍，没有借本轮扩大范围。
