# Harness 自配置闭环修复

用户本轮要求从共享根因修复，使主人说出需求后，Agent 能配置、热重载、验证并交付，安排子 Agent 落地；不是逐 Bot 改 persona。实施范围为仓库源码、规范、随包指引与验证；正式 home、安装、公开发布分别验收，本次不以源码完成冒充上线。

## 完整行为链

复用 YAML、management/config/social API、pi-durable、事件和投递回执，不另建配置 DSL、审批平台、自动纠错 Agent 或任务/转录数据库。

1. 核对真实主人输入、目标 home/版本、Agent、渠道/群及 profile，沿用同对象/任务的授权。
2. 查模型目录、实际 binding/profile、工具插件、已有会话和参与策略。身份、上下文、能力、模型、调度、投递分别定位。
3. 形成最小局部候选，识别共享 profile 的影响范围，用现有 validate 做完整候选校验，不保存已知不可运行的路由。
4. 用 update/apply、既有锁和原子写入，等待 reload 接纳；失败恢复本次写入，不覆盖并发修改，恢复失败明确报告。
5. 读回有效配置与路由，核对新入站、run.end 和成功 message.out。没有新消息时明确端到端未测，出站成功不证明入站。
6. 交付改变、范围、有效配置、运行/送达证据和未测项。后台工作沿结果通知或 task_continue 续办，不以口头承诺结束。

| 用户需求 | Agent 与宿主的行为 |
|---|---|
| 私聊用某模型，群聊用另一模型 | 分别定位既有 profile，仅改相关模型/必要 fallback，保留其他字段。配置首选与实际 fallback 模型分开 |
| 负责工作群，消息都看、按需说 | 同 Agent、独立群上下文，必要执行沿 parent_ask；接收、唤醒、发言分开，节奏取实际配置，不强加新默认 |
| 这个群先别说话 | 复用 social_group_mode_set/social.update 设置 mute 并读回；复用已有发送控制，不扩大自然语言正则，不承诺撤回已送达消息 |
| 读群里的附件后办理 | 使用当前来源 message/index 和 conversation_attachment_read；必要时转交原请求，不要求用户搬运已收到材料 |

“同 Agent 接管”不自动公开私人 main conversation。用户明确要求同一份上下文时报告现有支持边界，不暗换含义或保存运行时必拒绝的绑定。模型/工具独立选择不要求合并上下文；既有会话 profile 不能偷偷替换。

## A 配置与路由契约

- 启动、管理写入、watcher 共用可接纳性校验：拒绝运行时禁止的 social 群→main、默认参与插件缺选、可确定的已有会话 profile 冲突。错误带字段/绑定与实际原因，不自动扩大权限或更换目标。
- 管理写入等待同步 reload，返回 saved/accepted/restartRequired 和可核对版本；accepted 仅服务接纳。失败恢复本次文件且报告恢复状态。
- config.get/update 支持可选既有 profile；省略保持 defaultProfile。CLI agents show/validate/update 继续负责完整配置，不新增工具平台。
- social.inspect 去掉占位，提供真实策略、绑定/profile、历史入站路由及缺口，标明历史事实与当前预测；无证据保持未知，不发假消息、不唤醒模型验收。
- social.update 保留 dryRun 默认预览，显式 dryRun:false 应用；移除无条件第二次精确“确认”口令。保留 admin/cross-agent、channelInstances 与已授权目标；核验直接主人群/私聊、可信 parent_ask/原生续办来源。非主人、来源不明不能提权。

## B 授权与委派契约

- parent_ask 回溯真实入站、batch 及 runtime.tool-result/runtime.continuation 的 parent；逐跳核验 agent/session/conv、内部事件、防环上限。旧批次兼容，混批逐一核验非主人额度。
- 来源缺失/伪造明确 origin 错误，不静默降为 guest 后报外人额度；准入拒绝使用已有 error/reason/isError，不把 done 当目标成功。
- effort/credentialSlots 可选覆盖错误指出参数、required/current capability 及合法省略覆盖路径；不自动提权、不暗丢用户必需参数、不原样无限重试。
- agent_ask.sources 仅逐字引用，不等同跨 Agent 主人授权；不扩大 peer 权限。parent_ask 来源延续与跨 Agent 委派分开。

## C 运行事实与附件契约

- 每次原生模型请求在稳定前缀后追加独立事实段：配置首选、本请求实际 provider/model/thinking；fallback 随实际选择更新。不从当前 YAML 猜历史模型；供应商响应型号只取真实观测。
- 附件行给 message/index；本轮有 conversation_attachment_read 时指明受限入口。复用作用域/下载/文本读取，不开放整个 home、不造新工具、不声称读懂未解析二进制。
- 复用当前已有群参与、addressedTo、公开背景和发送控制，不新增判断模型或自然语言状态机。系统和 self-management skill 只补公共操作闭环，不写 Bot 特例。

## 验收、分工与交付

回归覆盖目标 profile 模型更新、不可运行路由写前拒绝且旧状态有效、reload 失败恢复；主人经 batch/续办仍为主人，访客/混批/伪造不升权；可选 effort 拒绝与普通委派区分；附件引用可读而越会话/任意路径拒绝；实际 fallback 与配置首选区分；mute 有真实策略与发送控制。

执行 build/typecheck/npm test/lint，保留原始通过/失败/跳过。真实模型仅 openai/gpt-6-luna；缺测试环境凭据标未测，不复制其他应用 OAuth。源码、真实模型、QQ/飞书、正式安装分别记录。结果写 docs/verification/harness-self-configuration-20261101.md，本方案不是已实现声明。

config_routing 负责 A；delegation_auth 负责 B；runtime_evidence 负责 C 程序；主 Agent 负责规范、公共提示词/skill 和集成验收协调。全部共享 main，不建开发 worktree，不改正式 home/install，不推送触发自动发版。
