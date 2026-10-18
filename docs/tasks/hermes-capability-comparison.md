# Hermes 对比与范围收敛

**日期：2026-10-18。状态：现状核对已完成；“本轮必须补齐”是待用户审核的范围建议，尚未授权开发。**

结论：先完成已有能力的真实调用链，以及已批准的工具、GitHub、更新、飞书；不为追平 Hermes 数量补记忆引擎、cron、通用 MCP 客户端或另一套任务平台。所有已实现但不完整的项目都列在下表，不用“接口存在”冲抵功能缺口。

- 功能详情：[13 能力补齐草案](../spec/13-capability-completion.md)。已批准的功能继续引用 10/11/12，不在计划里重写。
- 实现安排：[能力补齐实施计划](capability-completion-plan.md)。先等 U05，再经用户审核放行。
- 原记录：[第一轮审查](review-first-pass.md)、[N 任务](next/README.md)、[TUI 任务](terminal/README.md)。本表不删除原失败、跳过和验收要求。

## 1. 对比口径与源码基线

Hermes 参考为本机 `hermes-agent-latest` 的固定快照 `0eb4f62a8b35ff3b0454a8dbdbd3a7b55a6849b0`。比较的是功能覆盖，不表示本次实际运行验收过 Hermes。

Yonder 主仓库已提交基线 `f9662ad`；U05 正在同一工作区修改终端，尚未交接。独立安装版仍是 0.1.4，来源 `99b019776ff891a0c4ab3403ae9d487d739ebf3d`，不能把开发分支当成日用版本。

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
