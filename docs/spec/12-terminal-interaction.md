# 12 命令行与基础终端交互

## 1. 原则：沿用成熟产品，不另设计交互

以 pi coding-agent v1.3.0 原生终端组件与布局为实现基准；沿用其编辑、消息、工具和选择器，只适配 Yonder 内容及后端。依据 Claude Code 的交互说明做有限的精简呈现与常用键位适配（§6）；不引入第二套渲染框架。选择 pi 是因为本项目已使用其运行库，界面源码和组件可核验；不是因为要把 Yonder 改成编码 agent。

不引入 coding-agent 的模型循环、SessionManager 或配置存储，但允许直接复用其 UI、主题与键位实现。仅使用 pi-tui 的通用组件再独立拼界面，不满足该原则。

## 2. 复用范围与职责

| 内容 | 处理方式 |
|---|---|
| 启动区、对话区、编辑区、底栏、全屏/滚动布局 | 使用同版本 pi 组件树；顶部仅品牌，主要状态固定在底部，默认一行、详情可折叠 |
| 主题、字体样式、间距、边框、Markdown/代码与工具输出 | 沿用上游组件、默认主题和渲染行为 |
| 输入编辑、粘贴、历史、补全、选择列表、搜索、快捷键与退出 | 沿用上游实现；仅按 §6 调整 Claude 通用键位，菜单优先级保持原生 |
| 品牌、命令内容与说明 | 替换为 Yonder 的真实命令，中文/英文提示使用原有说明位置 |
| 当前对话对象、任务归属、会话与执行信息 | 将 Yonder 数据接到原有启动区、消息标签、会话选择器和底栏 |
| 系统命令、安装、服务管理 | Yonder 自己的管理面，继续保证参数、JSON、退出码与非交互行为 |
| 模型、工具、事件、会话、取消与恢复 | Yonder Core/runtime，经既有 pi-durable 运行；UI 不另启动 coding-agent 执行系统 |

TUI 随 CLI 安装，不要求人另装插件。channel-cli 仍只负责常驻 agent 的渠道消息和绑定；独立任务直接使用控制面。插件不增加系统命令或界面框架注册槽。

复用顺序：公开 UI 导出能直接使用就直接使用；与上游 AgentSession 耦合的部分，按 MIT 许可从同一 tag 提取最小完整 UI 模块，保留来源/版权/许可证与修改记录，仅适配数据读取、动作回调及本规范明确批准的角色标签/折叠呈现。不能为了避开包依赖重新设计同功能组件，也不能复制整套运行时来满足 UI 构造参数。pi-tui 是渲染基础，coding-agent UI 是产品界面基准；两者都需固定精确来源版本。

允许 `packages/cli/` 使用 pi-tui 和明确列出的 coding-agent UI/主题/键位导出或提取模块。实现前记录具体文件与运行时耦合边界；不把整个 InteractiveMode 当作已经可接任意后端的独立组件。模型/会话运行包与 chord 仍只经 `packages/core/src/runtime/` 使用，插件仍只依赖 SDK。

## 3. 入口与首次使用

| 入口 | 行为 |
|---|---|
| `yonder` | 交互终端进入既有CLI渠道（优先cli，否则首个实际CLI渠道），装入其main历史；无CLI渠道时为新任务 |
| `yonder chat` | 交互终端进入新任务草稿，预设default；/channel可切换常驻渠道 |
| `yonder chat --preset <id>` | 用该真实预设准备新任务；首次发送才创建会话 |
| `yonder chat --session <id>` | 继续未关闭的手动关闭 task 会话；已关闭会话只读，不能暗中重开 |
| `yonder chat --channel <instance>` | 进入指定 CLI 渠道，普通文字经该渠道的事件与绑定处理 |
| `yonder chat --plain …` | 使用普通文字输入输出；目标参数与 TUI 相同 |
| `yonder chat --json …` | 非 TUI 的 JSONL 输出；stdin 仍是一行一条文字消息 |
| `yonder help` / `yonder --help` | 输出帮助，不进入 TUI |

三个目标参数互斥；`--plain` 和 `--json` 互斥。无 TTY 时 chat 默认用 plain；裸 `yonder` 在非交互环境报用法错误并提示显式命令，不能等待输入。普通管理命令不因 TTY 存在而弹出菜单或提问。

- home按09解析：显式参数/环境及明确当前home优先，然后唯一安装服务home与默认全局home；未初始化时显示既有init/login/service install命令。
- 服务未启动时给出 `yonder start` / 已安装服务的 `yonder service start`，保留用户输入；TUI 不隐式安装或启动后台服务。
- 新 home 的 init 额外生成 `presets/default.yaml`：真实默认模型 `openai/gpt-6-luna`、level `standard`、tools.offer `["*"]`，plugins/contexts 为空，不写示例人设。模型与实际可用工具在界面展示。standard 含 exec，不宣称主机文件隔离（05 §3）。旧 home 缺该预设时提供真实预设选择和创建说明，不在启动 TUI 时修改配置。
- 任务默认 cwd 为 home、env 取预设或 local，沿用 03 §4；界面必须显示实际路径。当前 shell 的 cwd 不暗中覆盖服务端 cwd。
- 未登录时说明当前模型需要的 provider 及 `yonder login <provider>`；不展示凭据值。命令失败留在界面显示原因，不把输入丢掉。

## 4. Yonder 内容与精简呈现

不再提供自定文字线框。视觉参照为 pi v1.3.0 的 [原生界面及使用说明](https://github.com/earendil-works/pi/blob/v1.3.0/packages/coding-agent/docs/usage.md)，实现时以同 tag 的组件、布局和默认主题为准。

原有信息位置承载以下真实内容，不另加仪表盘或一套页头：

- 对话对象：明确当前是独立任务，还是与哪个常驻 agent 对话。任务没有 agent 时显示“独立任务 / Standalone task”，不虚构归属。
- 任务归属：有真实父会话/所属 agent 才展示；“任务属于谁”和“当前在跟谁说话”不能混为一项。渠道可能命中多个 agent 时列真实目标，消息按实际输出来源标明 agent。
- 会话信息：实际 session id、类型、预设/配置档、运行状态；底栏默认只展示实际对话对象、模型、状态与简短操作提示；cwd/env、能力、会话和已知用量放在可收起详情。未知值不填零，不伪造标题。
- 消息：用户、assistant、工具、错误仍用 pi 原生消息/工具组件；用户正文行使用灰色背景，灰色 `›` 紧贴正文；AI 只在首行左侧用灰色 `•`，有真实 Agent 名时同一行紧贴标记显示，不单独占一行写“AI”。消息之间一空行，正文内部不添加额外空行；实时更新和历史恢复一致。过程和 final 通过同一原生消息身份更新，不自行增加一种“最终回复卡片”，不重复追加同一回复。

基础版必须支持工具输出展开/收起以及实际工具开始/成功/失败显示。过程默认只保留一行灰色调用摘要和实际状态，错误用错误色；Ctrl+O 展开 pi 原生完整参数/输出，保留原始转录。thinking 默认收起，不让空标题占消息首行。若现有 OutputPart 不足，补 Core 到 UI 的真实工具调用/结果与消息身份映射；不能以 SDK 暂缺字段为由改成另一套简陋显示。没有返回的工具结果、thinking 或用量不编造，缺口按 §7 记录。

## 5. 命令与补全：换内容，保留上游交互

### 5.1 系统管理命令

init、login、doctor、start/stop、sessions、events、identity、skills、version、docs、changelog、update、service 仍由系统 CLI 实现，以 agent/脚本为主要使用方，人也能使用。普通输出按成熟 CLI 的摘要/列表/正文呈现，不打印通用 inspect 对象；有限命令 --json、错误码与退出码保持既有契约。

新增 `completion zsh|bash|fish` 输出 shell 补全脚本，不自动改用户 shell 配置。shell Tab 补全命令、参数、枚举与路径；动态目标只读查询 home，服务不可用时仍有静态补全，不能唤醒模型。

会话命令补 `sessions open <preset> [--keep-open]`、`sessions submit <id> --text <text>`。open 默认一轮关闭，keep-open 为 manual；submit 返回接纳事件 id，不默认阻塞等模型。交互客户端通过控制面读取真实预设和目标，不让模型解析帮助文本。

### 5.2 TUI 命令内容

同一含义的操作沿用 pi 的命令名与选择器；Yonder 特有操作才添加命令。下表是内容映射，不是新菜单框架。

| 命令与双语说明 | Yonder 中的内容 |
|---|---|
| `/new` 新建会话 · New session | 用真实预设开始独立任务，首次发送才创建 |
| `/resume` 继续会话 · Resume session | 原生会话选择器装入 Yonder 记录；继续未关闭 manual task，其他历史只读 |
| `/session` 当前会话 · Session info | 切换底部真实会话详情，默认收起 |
| `/hotkeys` 快捷键 · Hotkeys | 切换底部简短帮助，取实际启用动作绑定 |
| `/channel` 渠道聊天 · Channel chat | 用原生选择列表选择已配置 CLI 渠道，进入真实绑定目标 |
| `/skills` 技能 · Skills | 当前目标真实技能；多目标时仍用原生选择器选择 |
| `/stop` 中止运行 · Stop | 对应上游中止动作，调用 Yonder abort；如影响整会话/排队输入必须如实提示 |
| `/close` 关闭任务 · Close task | 关闭 manual task，保留历史；运行中用原生确认选择器明确中止并关闭 |
| `/help` 帮助 · Help | 在原生命令呈现方式下说明 Yonder 命令与操作 |

退出沿用 pi 的退出动作，不再要求独立 `/exit` 命令。上游模型切换、fork/tree、分享等没有 Yonder 后端契约的能力，不伪装可用；不把上游全部业务功能自动算作本次范围。已有等价能力必须复用原入口，不因“Yonder 特点”另造一套。

### 5.3 补全与双语

斜杠候选、参数候选、路径补全、过滤、列表选择/分页/返回，直接使用同版本上游实现。命令的中文/英文说明填入已有 label/description 字段；规范名称和参数保持英文，两种说明都可搜索。不加自定双语常驻大提示条，菜单结构和键位保持原生，不新增中文别名或语言配置系统。终端支持时 shell 候选也显示双语说明。

## 6. 原生交互与通用键位适配

界面动作以 pi v1.3.0 的 [Keybindings](https://github.com/earendil-works/pi/blob/v1.3.0/packages/coding-agent/docs/keybindings.md) 和同 tag 源码为准。编辑、补全、选择、粘贴、滚动和消息渲染继续由 pi 实现。依据 [Claude Code 官方交互说明](https://code.claude.com/docs/en/interactive-mode)，采用以下有限适配：

- Enter 发送、Shift+Enter / Ctrl+J 换行；Tab 接受补全，↑↓ 选择、Enter 确认、Esc 返回，保持原生。
- Esc 中止当前会话运行（菜单打开时先关闭菜单）；Ctrl+C 运行时中止，空闲时清空，再快速按一次退出；Ctrl+D 空输入退出、非空输入删除字符。
- Ctrl+O 展开/收起工具、thinking 和底部详情；Ctrl+G 外部编辑器，Ctrl+L 重绘，Ctrl+P/N 输入历史。不将 Ctrl+T 声称为 Claude 任务列表，原生 thinking 快捷键移除，统一随 Ctrl+O 收展。
- 编辑器只输入 `?` 时显示底部快捷键微提示，继续输入其他文字即恢复普通输入；`/hotkeys` 也切换该帮助，Esc 可收起。帮助显示实际启用按键，不能列未接线能力。
- 默认底栏一行：真实对象/会话、实际模型、状态及 `? 快捷键` 或运行中 `esc 中止`。`/session` 或 Ctrl+O 切换固定底部详情；折叠时不常驻 cwd、token、能力长列表。顶部只保留简短品牌。
- 消息呈现依据 Codex rust-v0.160.1 的 history_cell/messages.rs、style.rs 与 exec_cell/render.rs 调研：两列灰色行首标记、用户灰背景，去掉 pi 已有 padding 外再叠加的标签/Spacer。只加这一层呈现适配，内容换行、Markdown、工具结果仍由 pi 负责；背景只填真实文字行，不渲染多余的整块空白。终端内不插入字符间隔或隔行，预览行高 1.25、letterSpacing 0；真实终端字体/像素行高由宿主终端控制，不写用户终端配置。
- 只复用 pi 的原生 Text/消息/页脚/编辑/选择组件，不新增主题系统或自制编辑器。pi 原生 Alt+Enter 后续输入、Alt+↑ 撤回队列继续有效，提示如实标明；未实现的 Claude 权限切换、rewind、后台任务不能暗示可用。

- 独立任务按上游的当前任务引导/后续输入动作映射 pi-durable 的 steer/followup，不在客户端新建队列。相关提交/取消关联属于必须补齐的后端适配；未接通不能宣称继承该操作。
- 渠道模式仍由绑定决定 busy 和运行归属，界面显示实际行为，不能用上游 UI 动作绕过绑定。渠道差异属于内容/后端语义，不能悄悄更改通用键位。
- 上游菜单、搜索和编辑器拥有的按键先按其原生优先级处理；不能关闭菜单同时触发一次中止。原生中止动作对接真实运行，不能把取消观察当已中止模型。
- 退出/断开不隐式关闭或中止后台任务；在上游提示位置显示运行仍继续及可恢复的真实 session。切换目标沿用上游切换与草稿处理方式，不再自定每目标草稿缓存机制。
- 错误、中止、上限、连接断开分别用原生通知/状态组件表示。重连先读取真实转录与状态；接纳未知不自动重发。TUI 不保存第二份会话转录。
- 需要确认关闭时使用上游确认组件；空回复、未绑定或被拒绝输入必须结束实际等待状态，不留无限运行提示。

对于上游交互受服务端语义限制的地方，实现任务须列出“上游动作 → Core 调用 → 实际影响”，包括取消范围、排队输入与已关闭历史。只适配这些必要差异，不因接入困难另设计交互。

## 7. 支撑闭环的最小会话与控制面调整

1. task 增加创建时的关闭策略 `run-end`（默认）/ `manual`。现有 task_run 与未带选项的 open 不变；TUI 用 manual，答复结束只结束本轮，下一次发送继续同一 pi conversation。策略持久化于已有 pi 扩展文档，不靠客户端内存；`SessionInfo.close` 对 task 返回实际策略，旧记录按 run-end。已关闭不允许 submit，不允许把一轮任务改成可续聊任务。
2. SessionsAPI.submit 的 opts 新增可选 `busy: followup | steer | interrupt`，缺省 steer，直映射原生 inbox；不增加客户端队列。TUI 使用上游输入动作选择该选项。该选项只用于显式 task 输入，不覆盖 agent 的渠道绑定。
3. 本地控制面增加 presets 列表、CLI 渠道及其路由目标查询、task open/submit，与现有 list/transcript/abort/close 共用 Core 行为。列表只读，不能为了预览目标创建会话或花 token。task 提交写真实 `session.input`；常驻 agent 仍走渠道绑定。
4. task TUI 用控制面的只读会话观察流，订阅确认后再允许发送。观察流给出实际运行状态，以及附有 session、输入事件关联与原生运行标识的 OutputPart；结束记录包含 done/error/aborted/limit（含空回复），不能只靠 final 推断运行结束。运行标识沿用首个实际 submission，不自建 run 身份。可用模型/级别/env/cwd 从 Core 已解析配置和运行快照读取，不由客户端猜。
5. 观察不是等待者，不创建渠道、不写 message.out、不改变投递选择；不复制转录。task 用 wait:false 提交，先返回已接纳事件 id，再从观察流看进度/终结，最终内容与转录核对。断开只释放观察者，不取消任务。重连先观察再取实际转录/状态，按原生标识合并快照与实时内容，不补发错过的过程、不重复显示 final。
6. 渠道仍用 channel-cli 的来源投递流；补齐连接所接纳输入的事件/路由/会话关联及终态通知，使 TUI 能展示真实目标与中止选择。无绑定、write-only 或路由丢弃也必须明确返回，不留永久“思考中”。控制面观察不替代渠道投递。
7. 控制流为专用连接的一行一个 JSON 消息，订阅请求先确认，后发送状态/输出记录；普通控制请求继续一问一答。CLI 只通过 Core 暴露的 Yonder 类型访问它，不直接 import pi runtime 或打开正在运行服务的数据库。

8. 原生消息/工具组件需要的消息 id、工具调用 id、真实参数/结果与状态，由 runtime 的原生事实映射为 Yonder 自己的 UI 类型；通用渠道 OutputPart 不够时补必要接口与关联，禁止伪造结果。可用 UI 导出、需提取模块和缺失数据分别记录。

这些接口细节必须在实现任务中与 SDK/控制协议一起落地，不能用浏览器、进程内另一份 agent 或第二套队列绕过。

## 8. 验收

实现、检查并提供真实终端画面；允许隔离 home 与真实模型检查，不自动替换日用安装、改主人 home 或发布。

基础交互验收必须覆盖：

1. 新 home 初始化、真实 provider 登录、启动服务、进入 TUI；打开界面/列表无模型调用，首条消息使用真实模型执行工具并回答。
2. 同一 manual task 连续追问、退出再进入、服务重启恢复；默认 run-end/task_run 行为保持，关闭后拒绝输入，历史仍可查。
3. 同版本 pi 原生界面与 Yonder 在同终端、列宽、主题下并排核对：布局、输入、补全、选择、滚动/搜索、快捷键、Markdown、工具折叠、粘贴/中文宽度与退出恢复。差异限真实内容、已列后端语义及 §6 的精简呈现/键位；实际截图/录屏是证据，自画线框不算。
4. 运行中引导/后续输入、中止与排队输入处理，核对上游动作映射和原生执行事实，不把“禁用发送”当完成。
5. 真实工具成功/失败、空回复、模型错误、上限、显式 abort、断连和接纳未知；输入不丢、状态不猜、不重复运行或输出最终回复。
6. 渠道进入和原 main 连续对话、多目标路由展示、无绑定反馈；不能因 TUI 选择目标绕过绑定。
7. zsh/bash/fish 补全脚本的加载与静态/动态候选；未启动服务仍能静态补全，补全不唤醒模型。
8. plain/JSONL、有限命令 JSON 和退出码回归；确认原管理命令不读 stdin、不提问。所有安装与后台运行依旧按 09/10 验收。

## 9. 固定参考来源

- 原生组件与布局基准：[pi coding-agent v1.3.0](https://github.com/earendil-works/pi/tree/v1.3.0/packages/coding-agent/src/modes/interactive)，重点是 interactive-mode 的布局装配、components、theme 和 core/keybindings；公开 UI 导出见同 tag 的 src/index.ts。它不是已独立于 AgentSession 的通用后端客户端，不能直接声称“接上 socket 即完成”。
- 通用渲染：[pi-tui v1.3.0](https://github.com/earendil-works/pi/tree/v1.3.0/packages/tui)。只使用它而重写整套产品界面，不算本次复用达标。
- Claude Code [官方交互说明](https://code.claude.com/docs/en/interactive-mode) 用于 §6 的精简信息与常用键位适配；渲染组件仍统一使用 pi。DSH、Hermes、Codex 不另引入组件。
- Codex 消息与灰背景来源：[messages.rs](https://github.com/openai/codex/blob/rust-v0.160.1/codex-rs/tui/src/history_cell/messages.rs)、[style.rs](https://github.com/openai/codex/blob/rust-v0.160.1/codex-rs/tui/src/style.rs)、[exec_cell/render.rs](https://github.com/openai/codex/blob/rust-v0.160.1/codex-rs/tui/src/exec_cell/render.rs)。Rust 实现作呈现规则参考，不移植其后端。
