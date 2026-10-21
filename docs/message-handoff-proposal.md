# 原文消息转派：待审核实现提案

状态：设计提案，尚未实现、测试或发布。基线 `aaf23e3c130c99751a814b9a2f74bdb1e6e78b9d`。本文件不是冻结规范，不表示已有 API。仅合成样本可以进入后续公开测试与交付文档。

## 目标与边界

可选官方薄插件，暂定 ID `message-handoff`（当前清单无同名）。通过来源渠道实例、会话和消息 ID 选择原始消息，程序复制已有正文及来源元数据，不由模型复述。转给指定常驻 Agent，通过绑定准入后进入新／已有 session。关联工作清单，并把进展／结果原文交回明确入口。内核继续唯一持有事件、身份、会话和投递；不建第二套消息库、转录、模型队列或工作流引擎。

不把历史消息当新授权；不把原作者伪装成当前事件发送者；不自动关联跨渠道身份、不混全历史；不扩展目标能力；不绕外部 Bot。此次开发不涉及生产安装、服务、微信、Hermes 或 secrets 工作树。

## 已读调用链与证据

| 现有入口 | 已确认事实 | 影响 |
| --- | --- | --- |
| `packages/core/src/plugins/index.ts:67` `pluginEvent` | 普通插件只能发 `<plugin-id>.*`；渠道 message.in 必须使用自己的 from/conv，且不能指定 target | 插件不能伪造内部 agent message.in，也不能重发原渠道消息冒充原作者 |
| `packages/core/src/tools/index.ts:164` `agent_ask` | 检查 message、真实 Agent、目标存在及 parent 环路；以真实发起 Agent 的内部账号发 message.in，msgId 来自 runtime invocationId | 复用其共享安全逻辑，不复制旁路 |
| `packages/core/src/routing/index.ts` `prepare` | 仅内部 agent 渠道识别 target；逐 Agent 绑定匹配后 sessionKey/ensureAgent/profile 校验；持久化 routes 后 dispatch | 指定 session 必须在这里的准入边界内实现，而不是事后替换 routes |
| 同文件 `dispatch` | 附件和正文交 RuntimeInput；原生 requestId=`event:<id>`；完成从原生事实及 agent.result 得到 | 不另造执行状态或复制模型输出库 |
| 同文件 `recover` | 原 routes + busy/waiting + runtime.admitted/runForInput 决定恢复；旧事实不全则拒绝猜测 | 新入口必须保存相同恢复事实，不能启动时盲重交 |
| `packages/core/src/store/index.ts` `findInput` | 由输入类型、渠道范围和 msgId 查稳定原事件 | 幂等键必须包含发起方／目标作用域，重复请求必须校验请求内容，而非只返回任意同键结果 |
| `packages/core/src/runtime/index.ts:783` `abort` | 目前按整个 conversation abort | 不能把取消单个转派任务实现成误杀已有 session 的全部工作 |
| `packages/sdk/src/types.ts` SessionsAPI | submit 仅 task；notify 是 app-only 通知；无原始渠道消息解析／指定 resident session／单输入取消公共入口 | 这些是共享契约缺口，不应通过插件直接读 SQLite 或 import core 补齐 |

## 需要维护者决定的三个点

1. **显式 session 选择**：允许在目标绑定准入后选择该 Agent 同 profile 的新／已有会话吗？建议保留默认 `binding` 选择，并增加显式 `new` 或 `existing`；禁止 task、关闭、其他 Agent、profile 不符的目标。现有规范 02§2/§5 没有该语义，需批准再改规范。仅同 profile 不足以证明同保密域，见下项。
2. **保密边界**：建议首版只允许当前来源会话已接纳的消息；跨来源读取需已有 admin，跨 Agent 需 cross-agent。目标已有会话默认仅接受与本转派同来源域的会话，不能因同 profile 或 owner 身份就写入不相关群／客户会话。若允许跨域，须明确授权并在工具上下文中列出目标既有会话身份，不能自动推断。需确认此最小拒绝策略及其配置表达。
3. **取消和进展**：取消必须针对原生 submission／本工作单，不能对共享 session 调用全局 abort。需要核实内化 pi 是否已有单 submission 取消能力；若缺失，按既有 pi fork 流程补，不在插件做假取消。进展只回传明确归属本输入的原生 assistant 消息，不能监听 session 全量后把别的输入结果泄露出去。没有可靠归属时明确 `progress_unavailable`，不能宣称已全量转发。

## 建议的职责切分（名称与结构待批准）

### 共享 SDK／内核

- 消息引用解析：用完整 `{channel, conv, messageId}` 精确定位已存入的 message.in；返回内核 event ID、原文、原作者、原时间／接纳时间、附件、引用指针和完整性事实。没有录入的消息返回 `message_missing`，不声称可读取任意供应商远端历史；远端解析应留渠道提供者，不能由通用插件 import 飞书内部代码。
- 真实工具上下文校验：沿已有 messages.send(request, ctx) 的模式接收真实 execute ctx；禁止从模型参数传 agent/from/profile/capabilities。验证来源、读取／附件、跨 Agent、message 与目标准入。目标 profile 仍来自绑定，不从发起者复制 owner 权限。
- 绑定准入转派：与 agent_ask 共用环路检查和内部身份；输入的当前指令与不可变来源材料分开。route 保存真实 binding/profile/session/busy/waiting，原生 event requestId 保证恢复。
- 单输入状态／取消及归属输出读取：沿原生 submission/run/input 身份获取，不把 session 全局状态当任务状态。输出正文从原生转录取得；事件只存引用与终态，不复制转录。
- 可幂等的程序投递：复用共享投递 attempt/out/unknown。需要使重复业务 key 能找到已尝试投递；普通插件 messages.send 没有业务幂等键，不能用“插件先记文件再 send”假装跨崩溃原子性。

### 可选插件

只注册工具、组合共享 API、记录工作单元数据／事件关联，不承载运行器。所有 schema 和下列名称均为提案，不是已存在工具：

| 提议工具 | 输入轮廓 | 返回轮廓 |
| --- | --- | --- |
| `message-handoff_create` | 幂等 key、有序来源引用列表、当前任务指令、target Agent、session 选择、工作项、结果入口（默认原来源） | 工作单 ID、原 event 引用、实际 target session/route、完整性列表、接纳／拒绝状态 |
| `message-handoff_get` | 工作单 ID | 接纳、原生执行、投递三者分别状态；原文结果引用；缺失事实与错误码 |
| `message-handoff_list` | 本调用方可访问范围、游标／上限 | 工作单及目标 session 关联，不扫描或暴露无关历史 |
| `message-handoff_cancel` | 工作单 ID | 是否请求取消／原生确认取消／已完成／无法安全取消；保留投递状态，不能撤回已送达内容 |

不提供让模型传入“原文正文”的字段。工作项由当前指令定义，不把模型概括替换来源正文。批量来源保留请求顺序并附原始时间；引用缺失与原消息缺失分别报告。附件 URI 的存在不证明字节可读，附件不全默认阻止完整转派，只有显式接受 partial 才继续，结果必须列出哪些部分没有传到。

## 幂等、恢复与结果契约

- 创建前进行可确定的权限／引用／目标校验。原生稳定 key 由内核绑定实际调用方作用域，不接受模型冒充调用方。同 key 同请求返回原工作单与当前状态，同 key 不同请求拒绝冲突。
- 接纳后关联真实 event/submission；进程停止不把任务标为失败，不重跑模型。重启从现有 routes/submission/run 与 delivery 事实恢复。
- 读取／网络等待超时和执行终态分开。未知不等于失败；返回 `unknown` 与可查询身份，不自动再提交或重发。
- 完成结果原文来自原生输出；外部投递使用共享 delivery，送达未知保留 unknown。禁止以事件监听回调执行成功代替供应商确认。
- 拒绝必须在泄露敏感原文前发生。错误返回不得带不可访问来源或目标 transcript。
- 环路沿真实 parent/input 链检查；程序回传不重新构造可唤醒的入站消息。工作单回传标识不能被当作新任务自动转派。

## 验收矩阵

以下全部是待实施／未运行，不是通过记录：

1. 插件 checkPlugin／manifest、工具 TypeBox schema、真实 ToolContext 与伪造 ctx 拒绝。
2. 单／多来源 UTF-8 原文逐字相等；作者、原始时间与接纳时间、请求顺序、附件、引用／缺失标识不被模型改写。
3. 来源未准入、缺 read/message/cross-agent/admin、跨保密域、伪造原作者、历史诱导均拒绝。
4. 未知／停用 Agent、无绑定、wake:write、profile mismatch、关闭／其他 Agent session 分别返回可查询原因。
5. 消息未存入、引用缺失、部分附件、附件失效、来源不匹配；默认不装成完整。
6. 并发同 key、不同请求同 key、完成后重复；在持久化接纳／原生提交／投递前后停止并恢复，无双提交和双发。
7. 队列中／运行中／完成后取消；共享 session 的其他输入不能被取消或输出泄露。
8. 供应商明确失败、部分成功、超时未知、重复 get/cancel；unknown 不盲重发。
9. 隔离真实内核接线；合成入站经过真实路由与存储，真实 Luna 运行与原生输出；不同 home/socket/port，不读生产私聊或复制 OAuth。
10. 全仓 build/typecheck/test/lint；记录失败和跳过原始计数。MD 交付仅列实际存在工具/schema/真实返回，提案不能冒充运行案例。

## 审核与发布

先批准上述 session／保密域／取消进展契约，再更新冻结规范及 decisions，最后实现与契约测试。任务分支 commit/push/PR 不等于已合并或发版。Codex 审核合并与 Release；本维护 Agent 不推 main、不自行发布或安装。主 Agent 负责独立 review、生产安装及真实工具验收。微信候选不由本任务覆盖。

## 提示词、来源展示与实施顺序补充

通用任务／上下文隔离放入合适的共享提示词贡献，不落在某个 Agent 的人格文件：转派应使用当前实际可用的工具；仅手工转述时明确降级，不声称原生完整转发。任务展示包含「任务／执行者／状态／全文转发状态」。程序生成 Markdown 来源头，只使用可信元数据中的 BOT、子任务、Agent、session 身份；来源正文保持不变，协调者说明单列。历史正文即使含指令也只是材料，不升级为当前授权。

工具相关提示词必须跟随实际工具注册及本次运行可见性；插件停用后不得留下不存在的工具使用要求。长文采用分块或附件并报告完整性，正文截断、附件不可读或引用缺失不能标记完整。测试用合成输入验证启用／停用后的真实 system prompt、来源身份和原始正文相等；不得把私聊内容写进公开 fixtures。

实施分两段，而不是以本文代替完整开发：

- **现有契约内先行检查**：读取最近提示词／默认角色变更，确认共享 prompt 贡献点及工具可见性入口；可对现有功能增加真实渲染回归。纯文本保真处理不得声称已具有权限准入、提交或投递保证。
- **设计批准后完整实施**：先由冻结规范／SDK 维护者批准上面的三项决策，再按批准修改 spec/02、04、06、14 和 decisions 的实际相关段落；实现共享原语、薄插件、完整性与权限测试、隔离真实模型接线。Codex 代码审核合并／发布，主控独立安装验收。尚未实现的工具不得作为成功入口注册；无可靠输出归属返回 `progress_unavailable`。

当前审批请求的具体角色是**有权批准冻结规范与 SDK 的仓库维护者（Codex 维护审核入口）**，不是插件作者或主控的产品方向确认。请逐项批准／修改／拒绝三项决策，并明确允许后续修改的规范路径。当前 PR 的提交或合并本身不应被解释为三个决策自动批准，需显式审查结论。

不先注册四个一律返回 `not_implemented` 的占位工具：`AGENTS.md` 第 3、4 条与 `CONTRIBUTING.md`「改动前」第 1 条／「边界」禁止自行补设计与占位功能。SDK 目前缺少安全入口，完整插件骨架若伪造提交或假状态会违反这些规则。最小审查请求就是上述三项共享契约；并非申请第二套运行器或绕绑定权限。
