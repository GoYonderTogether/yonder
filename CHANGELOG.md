# Changelog

## [Unreleased]

- 断网、合盖或代理中断后，主模型不再被冷却 10 分钟：连接被拒/重置/中断、DNS 失败、请求超时这类没拿到供应商响应的失败不再写入 `.yonder/model-health.json` 的持有，网络恢复后的下一次运行直接回到主模型；离线期间探测失败也只重排下一次探测，不延长持有。401/403/404/429/5xx 等供应商真实应答的冷却规则不变。

- 通讯录区分「加载失败」「节点没有社交服务」「真的为空」：`ui/Contacts`（`#/contacts` 侧栏）失败时显示 `role="alert"` 与重试，不再和「没有常驻 Bot」同屏；`features/social/Contacts` 与 `ContactDetail` 把网关 404 或 fetch 直接失败（当前节点没有代理社交接口）显示为「当前节点没有提供社交服务」，其他错误显示具体原因与重试，只有接口返回空结果才说「联系人不存在」；真实空态给「添加好友」入口。分类与文案在 `features/social/lib/socialError.ts`，三种状态各有单测。

- `sessions.watch` 被服务端 `end` 帧结束时，会话不再永远停在「连接中…」：`useSession` 接上 `onEnd`，`forbidden` 提示「没有权限查看这个会话」，`error` 提示连接出错并保留已有数据（mux 仍按契约带游标自动重订，重订后的 `ready` 清除提示），其他 reason（`closed`/`shutdown`/未知）给通用提示并保留数据，原始 reason 不上屏。补假 socket 喂 end 帧的单测（含重订回放）。

- `capabilities.get` 补齐 `NodeFactsSchema` 的 v1.1 字段：`minor`（1）、`node`（`{id,name}` 取本机 hostname，来源见下）、`views`（与 `views.list` 无参同源）、`models.select`、`remoteSession`（`sessions.open` 能否用、当前只有 `task`、`workspaces.list` 是否在表）、`auth`（`kind` + 是否持 `owner`），`plugins[].views` 改取插件清单 `contributes.views`，`features` 的 `attachments`/`notifications`/`approvals`/`suggestions` 按注册表事实给出。此前返回缺这些字段，apps/app 添加远程节点读 `facts.node.id` 必然失败。补 `Check(NodeFactsSchema, result)` 单测。节点 id/name 的取值来源契约未定义（本机 hostname，与 spec 16 设备名同源），已记待维护者确认。

- Console 分享二维码/链接改走服务端分享配额：名片页「分享名片」与群聊详情的群二维码先调 `POST /api/share-links`（`kind` + `targetId`），服务端复用同目标未过期链接，二维码与「复制链接」使用带 `?share=<token>` 的地址，访客凭它登录/加入时按链接计成功验证的新访客；只对本人或本人 Agent 的名片生成，别人的名片、访客身份、生成失败时退回原普通地址。`api/social` 新增 `ShareLink` 类型与 `createShareLink` / `getShareLink` / `revokeShareLink`。名片分享区与群聊详情新增「分享链接」窗口（复用 `Window`），列出本机生成过的链接：token 短显示、已用/上限、剩余天数，可复制、可吊销；状态按 `share_exhausted` / `share_expired` / `share_revoked` 给出中文提示。本机索引存在 localStorage `yonder.shareLinks`（服务端没有按目标列出链接的接口），换设备看不到旧记录。剩余天数与状态换算、分享地址拼接为纯函数并有单测。

- Console 社交登录改为验证码：登录页只有手机 / 邮箱两个 tab，发码（按服务端 `retryAfter` 倒计时）→ 填 6 位码 → 登录，首次验证即注册，不出现密码框；字段级校验手机（`/^1[3-9]\d{9}$/`）与邮箱格式，错误按 `invalid_code` / `locked` / `share_exhausted` / `share_expired` / `share_revoked` / 429 / 502 逐类给出中文文案。访客额度用尽时发消息返回 403 `verify_required`，聊天页弹 `VerifySheet` 复用同一表单（带分享链接的 `shareToken` 透传），验证成功后关闭并原样重发那条消息，不再静默拦截。「我」页设置的「账号与安全」显示脱敏后的已绑手机 / 邮箱（`138****1234`、`a****@example.com`），可绑定或换绑，`phone_taken` / `email_taken` 提示已被占用，换绑成功后提示重新登录。`api/social` 新增 `sendCode` / `verifyCode` / `sendBindCode` / `confirmBindCode`，旧 `login` / `register` 标记 deprecated 但保留。

- Console 的 Bot 与图标头像去掉渐变与光晕，改为一律平铺纯色：`.agent-orb` 只剩一条 `oklch()` 底色（亮色 `0.52 0.13`、暗色 `0.53 0.13`），色相仍按原派生逻辑取，每个 Bot 还是自己的颜色；白图标对底色按全部色相验算，最差亮色 4.87:1、暗色 4.68:1。名片页顶部的氛围光晕 `.ambient` 与星光 `.sparkle` 按「不要光晕」一并删除（含 `@keyframes twinkle` 与全仓库无引用的 `ui/kit/Aura.tsx`），开发浮窗的主题模拟同步改为纯色覆盖。名片卡面的主题渐变保持不变。

- Console 新增开发/演示用「视图切换」浮窗：默认不渲染，`?devtools=1` 或 localStorage `yonder.devtools` 才懒加载这块代码。浮窗可做断点预设（390×844 / 820×1180 / 1280×800，iframe 里开完整应用，断点按 iframe 的 `window.innerWidth` 计算）、路由快捷跳转（消息、通讯录、工作、我、`#/u/:id`、`#/g/:token`、`#/connect`、`#/get`）、身份入口（社交未登录/真实创建匿名访客/去登录，网关登出并重载）、节点切换（复用 `api/nodes`，远程节点另给新标签打开）、主题预览（`html[data-devtools-theme]` 叠同一套 token）与状态模拟（直接改真实查询缓存的 pending / 带标记错误 / 空数组，页面用自己的分支渲染，退出时恢复并重取）。所有数据仍来自真实网关，不造假数据；开关解析、断点映射、状态补丁与恢复都有纯函数单测。

- Console 外壳按三档断点渲染平板布局：新增纯函数 `shell/layoutMode.ts`，由 `breakpointOf`（手机 <640 / 平板 640–1024 / 桌面 >1024）推出导航、列、第二列与右栏模式，再由页型（列表 / 会话 / 设置 / 功能页）决定第二列去向。平板此前被当成手机（只有 1024 一档），现在是图标栏 + 主区：列表按需叠成覆盖层、打开会话即收起，右栏仍走 Chat 自己的覆盖层/抽屉，不提前变三栏；桌面保持三栏常驻，手机保持单列 + 底栏。`Shell.tsx` 据此走单一渲染路径，保留原有 Suspense/lazy、路由与全部 data-testid，仅新增 `data-testid="list-overlay"`。表驱动单测覆盖三档 × 四类页。

- Console 新增能力清单与桌面壳顶栏判定：`capabilities/features.ts` 用一张功能表描述顶栏、工作、常驻 Bot、通讯录、名片、私信、节点、更新、右栏卡片、底栏用量与系统通知的可见性，按 contracts §12 顺序（protocol → methods → features → events）判定，缺方法或节点版本较旧时给出原因而不是按插件名猜测；`lib/shell.ts` 只认壳注入的 `window.__YONDER_SHELL__`（`desktop`/`mobile`，未注入=web），不再从节点事实推断客户端壳；`api/capabilities.ts` 提供 `useCapabilities`/`useHasMethod`/`useFeature`。顶栏仍只在桌面壳渲染。

- Console 增加控制台入口（`#/console`）：工作列表顶部进入，在已接入节点间切换并打开对应设备的控制台——本机同源跳转，远程节点在新标签打开它自己的 origin；列出节点 id/名称/地址、当前节点高亮、添加设备与移除节点，未添加远程节点时说明「只控制本机」，远程节点如实标注默认无 owner scope、看不到 Bot 对话。导航仍是消息/通讯录/工作三项，不新增一级入口。

- Console 工作列表的 Bot 行与任务行、通讯录联系人行、右栏卡片与悬浮窗标题区接上统一上下文菜单（右键、触屏长按+震动、Shift+F10/菜单键）：菜单项由 `lib/menus.ts` 构造，对应打开会话、复制标题、关闭会话（确认后调 sessions.close）、置顶、发消息（openDm）、打开资料、停靠/弹出/收起；悬停显示标题，行内原有的链接、折叠与进度条不变。

- Console 个人页区分加载中、无会话、访客、正式账号和请求失败五种社交登录态：无会话直接给登录入口，访客提示「注册后可加好友」，失败可重试；登录/注册表单按服务端规则做邮箱格式与密码 ≥8 位校验、字段级错误、提交中禁用且保留输入；Agent 公开开关保存中禁用并显示失败原因。

- Console 用户气泡显示渠道色块图标与渠道名：覆盖 cli、card、wechat、wechat-ilink、qq、feishu、github、mcp、agent、cron、pi，实例 id（qq-main）归一到渠道类型；用中性色块 SVG，不用品牌 logo，缺失来源仍显示控制台默认。

- Console 设置页分为账号（网关/社交）、通知全局偏好、节点、关于（版本与更新）和退出；节点可添加远程网关并校验协议与 node.id，更新只在 ready 后出现应用按钮，后端没有 update.* 时显示不可用。

- Console 底栏显示真实用量与上下文：↑输入 ↓输出 R W CH、子 Agent 汇总、LSP、ctx%/窗口 (auto)、(provider) 模型 • 思考档；缺失字段省略。

- Console 右栏卡片与悬浮窗共用同一卡片组件：卡片栈布局计算抽成纯函数 `lib/railLayout.ts`，右栏卡片可 Alt+↑/↓ 键盘换位，悬浮窗拖动坐标统一夹进主区域，手机上的右栏抽屉支持 Esc 关闭并把焦点放到返回键。

- Console 迁入单一 Service Worker 与 manifest：只缓存带哈希的静态资源，不拦截导航、`/api`、`/ws`，按网关注入的 base href 工作，并显式放行 `/console/` 部署。

- Console 上下文菜单改用手机断点 640，方向键在菜单项间循环，长按时长与震动抽成可测纯函数，菜单项统一由 `lib/actions.ts` 构造。

- 工作列表按运行中、等你回答、待命、已完成分组，Bot 区与各分组可折叠且状态持久保存，已完成默认收起。

- 群聊 folded 待整理批次生成单行摘要，可在 Console 会话来源中查看。

- 学习复盘的证据提案先进入待确认，主人确认后写入并可撤销，保留来源和置信度。

- 群批次可选 judge 使用受限低价模型，持久记录预算与判断结果，并在调用前重验授权和静默策略。

- 本机验收可显式开启供应商请求与 SSE trace，支持 OpenAI completions 和 responses，并对已知鉴权信息脱敏。

- 修复硅基流动 DeepSeek-V3.2 的 effort 状态和思考参数，不支持的档位显示中文提示。

- 主动通知支持持久汇总和发送前权限复核；任务自检后的决定提醒限频并限制长度。

- Add optional code-intel symbol search through the shared pi-lens connection.

- code-intel 新增 AST 替换预览及受写权限保护的应用。

- Console 页面按需加载，静态资源按版本缓存，并提示可用更新。

- CLI 斜杠补全显示当前会话和预设可用的提示词模板。

- 无身份任务支持按子 Agent 名称和执行者 preset 分层发现参数化提示词模板。

- Console 展示 Bot 来源、会话事件与投递追踪，并保留历史工具结果。

- Codex delegation supports opt-in writes, rescue thread selection, explicit wait/background routing and the review prompt.

- 启用社交策略时，回复投递和重试前重新检查当前授权与静默状态，流式输出逐段复核。

- 可选 Codex 审查工具增加挑战式审查、focus 和按工具选择的斜杠模板。

- 新增可选 advisor 显式咨询与默认关闭的结果记录。

- Add optional Codex native review tool.

- durable 流及 bash 截断时缓存原文；网页超 2 MiB 的文本响应保存完整原文并提供缓存读取路径；read/grep 拒绝直接访问其他会话的工具输出缓存。

- Add optional `code-intel_effective_config` to explain redacted pi-lens configuration provenance and selection.

- Add optional `code-intel_lsp_navigation` through pi-lens MCP; applying cross-file changes is not yet available.

- 可选 code-intel 新增诊断查询与处理标记，支持会话延期、持久标记和源码抑制注释。

- 飞书投递重试复用稳定的分片 UUID；Channel.send 可接收可选 deliveryId。

- 社交路由追加 `routing.social-decision` 事件，关联原始输入并记录策略版本与判定原因。

- 定义可选社交配置、渠道能力和通知意图的增量契约；旧配置及发送行为保持兼容，社交运行接线待后续实现。

- Add optional `code-intel_read_enclosing` for position-based symbol reads through pi-lens MCP.

- Add optional `code-intel_read_symbol` using the pi-lens MCP backend.

- Add optional `code-intel_module_report` using the pi-lens MCP backend.

- code-intel 新增按需语法结构大纲工具，调用执行环境中的 ast-grep。

- 新增可选 code-intel 插件，通过执行环境中的 CodeGraph 查询符号与调用关系。

- QQ 群批次默认仅由 @Bot 或关键词触发，授权群保留原行为，支持按群配置参与方式。

- 精简共同提示词与官方角色模板，明确主管分派验收、执行者报告与续办；保留既有段落键。

- 飞书任务看板卡及其取数轮询退役，保留其他飞书任务卡功能。

- 隐式 console 绑定不再继承其他绑定的 busy 策略，网页 task 输入默认 steer；文档明确 busy 配置及同会话合并边界，并新增 O49 T03 场景矩阵，审批、后台等场景待实测。

- 名片页在任一请求失败时及时显示错误与重试入口。

### Added

- 新增会话隔离的 `/bg` 后台任务列表、日志和停止命令，以及 console 后台任务面板。

- 新增只读 `find` 工具，通过执行环境按 glob 查找文件，遵守 .gitignore 并包含隐藏文件。

- 新增只读 `ls` 工具，通过执行环境列目录，按 pi 的排序和截断方式返回结果。

- 新增 `/effort [level|auto]`；`/model effort` 已弃用，保留至 0.4 并提示新命令，最早 0.5 移除。

- 社交个人页支持修改昵称、退出登录与设置 Agent 公开状态。

- 删除 interaction 旧网页及其独立构建步骤。

- tasks 退役独立 HTTP 看板，保留控制面视图、渠道图片和 JSON 输出。

- interaction 退役独立 HTTP 服务，交互卡片通过控制面视图展示与回答。

- 控制接口接入 `views.list/data/act/watch`，interaction 提问卡与 tasks 看板注册为插件视图。
- 默认管家与首次引导：default 发行包加载 `@yonder/plugin-onboarding`；`init` 让 `main` 选入 tasks/onboarding 并绑定 `onboarding.start`。未完成且默认模型有凭据时唤醒管家（24 小时一次、累计最多 5 次，`enabled: false` 或主人关闭后不再唤醒），`onboarding_probe` 经新的 `api.host.status`（admin、只读）检查模型、渠道、网关、凭据、插件，按清单用 tasks 账本建任务，任务 id 存在插件状态里，可恢复、不重复（D59）。
- `yonder init --bundle core|default|full`（默认 `default`）：发行包决定 init 写入的插件与渠道实例。`core` 无渠道实例、不写 `cli` 绑定，`start --no-gateway` 后仍可用任务会话对话；`default` 按设计 §5.4 加载 cron、tasks、learning、channel-card、mcp-client、memory 与 channel-mcp（不监听，没有 `type: mcp` 实例就不开端口），memory 的 root/owner/timezone 由 init 填入；`full` 含其余随包插件。只有 `channel-wechat-ilink` 需要主人配置，不进任何包。`init` 必须带 `--model`，写入 `yonder.yaml.defaultModel`。
- 随包未启用的第三方渠道（feishu、wechat-ilink、qq、github）由`channels.list {shipped:true}` 单独返回，仅含本次安装里可解析的插件；`channels.list` 的已配置条目不变，`yonder channels list` 依次打印两者。
- `yonder migrate`：迁移旧 `yonder-harness` 用户数据（运行目录、插件 id/工具名、插件状态目录、power helper 的 launchd 标签），默认 dry-run，`--apply` 执行，`--rollback <备份>` 恢复（`--dry-run` 仅预览；迁移后有新写入数据时拒绝，`--force` 放弃）。持 home 锁、日志与自动还原使中断可恢复，launchd 步骤与数据迁移分开报告。
- 微信归档监听补齐入站标注：`wechat-archive.material` 的 data 增加 `channel`、`conversation`、批次去重的 `senders` 和一行通知用 `summary`（发送人加正文摘要，纯媒体与无正文分别记标记），消息正文与附件仍在 `messages`；同一会话是否提醒由 `notifications` 级别决定，监听保持只读、不自动回复。
- 渠道通知级别：`yonder.yaml` 新增 `notifications`（`default` + 按 `conv` 覆盖，取值 `all`/`mention`/`mute`）。被绑定接纳的入站 `message.in` 与带 `data.summary` 的插件事件对每个路由会话写一条 `yonder.notification`（走 `sessions.notify`，不唤醒模型），`mention` 只在 `data.mentioned` 为真时通知，`mute` 只累积事件与未读（06 §9.1、08 §2）。
- 控制方法注册表（`core/src/control/methods.ts`）：control.sock 与网关共用同一份方法定义（scope、参数校验、流类型、`local` 标记），原 CLI 内的 switch 迁入，socket 行为不变；新增 `capabilities.get`、`sessions.transcript`（`before` 倒序翻页）、`activity.summary/watch`，`sessions.submit` 支持 `requestId` 10 分钟幂等。
- 新包 `@yonder/gateway`：`POST /api/rpc/<method>`、`WS /api/stream`（ready/ev/end/pong 帧，`after` 续传与 `gap`），一次性票据（URL）或长期访问令牌（仅 `POST /login` 请求体）换 HMAC HttpOnly cookie，按对端限流登录失败（`gateway.trustProxy`），凭据到期/轮换后断开已建立的 WebSocket（4401），限制套接字、feed 与环形缓冲，校验 Host、Origin、Sec-Fetch-Site，严格 CSP，托管 `apps/app/dist`。配置 `gateway.port/publicOrigins/basePath/accessTokenHash/trustProxy/enabled`，支持去前缀的反向代理；`yonder start --no-gateway`、`yonder ui [--open]`、`yonder ui token --rotate`（配置只存 sha256）。
- 只读导入 pi 会话：`imports.list`、`imports.show` 把 `~/.pi/agent/sessions/**/*.jsonl`（`imports.piSessionsDir` 可改）解析为对话条目、todo 快照与 usage 汇总，未知条目原样带出。
- task 会话要求 STATUS 与实际证据；空或 `NO_REPLY` 回报由内核标为 `STATUS: unknown (no report)`，委派工具说明加入目标、材料、边界、完成标准、阻塞条件、回传格式六要素。
- 后台续办没有新的可见输出时，共享 delivery 按 run.end 保存的意图补一条模板通知；主人交互运行静默五分钟发送事实心跳（最多六次，可编辑渠道复用同一条消息）。保留静默绑定，未知交付不重发。
- luna/sol 家族按完整模型 ID 装入稳定的中文执行纪律段（`runtime.discipline`），不把每轮时间或计数放进 system。
- 模型账号回退：`fallback.accounts` 让主模型换用同一供应商的其他凭据槽，`fallback.accountModels` 按槽换成同供应商的其他模型（额度受限的账号跑较小模型），`fallback.hold`/`probe` 让失败模型在冷却期内不占用运行起点并由后台最小请求恢复。官方用量窗口从响应里的 `rate_limits` 只读取用，按 `provider@slot` 落盘；配置了 `fallback.quotaStopPercent` 的槽每 60 秒另查一次官方用量接口，未配置时不多发请求。`fallback.quotaStopPercent` 给某个槽设停用线，窗口重置后自动恢复。账号回退在运行时以只读别名供应商 `<provider>#<slot>` 实现，别名不进配置；调用适配器前把 provider 重写回真实 id，避免共享订阅按别名判定为不支持的能力。
- 官方用量读取自动刷新转换到槽旁的 Codex 凭据：访问令牌过期或距过期不足 60 秒时按 Codex 刷新协议刷新并原子写回，用量接口返回 401 时强制刷新一次并只重试一次；并发刷新合并为一次，刷新失败按不可用处理且不写文件。pi OAuth 凭据与调用方接口不变。


- 信号分级与同类聚合（`core/src/signals`）：`report` 按稳定错误码分级，同类首次输出完整上下文、之后只计数、每分钟汇总一条；未知码默认 `warn` 而不是 `error`。
- 状态面（`core/src/status`）：服务把"现在怎么样"原子写入 `.yonder/status.json`，内容不变时只按 10 秒心跳刷新 `observedAt`，空闲只付一次索引查询。菜单栏改读该文件，不再每 2 秒派生 `yonder service info` 进程。
- 保留引擎（`core/src/retention`）：日志按大小轮转保留 3 份、后台日志目录合并为滚动文件、派生物正文按 30 天回收，单轮 50 MB 预算，失败只记 `skipped` 不中断。
- 账本正文回收：`yonder.background` 终态记录的 `state.outcome` 正文剥离为摘要（保留 `status`、字节数、sha256、首尾各 2 KB）。正文仍在同会话转录 `pi_entries` 中（本机抽样 12/12 命中），属去重不是丢数据。
- 任务账本读模型：新增 `task_current` 投影表，`list`/`get`/`activity` 只查投影；面板视图从"每个任务一次全量重放"改为一次批量查询。
- 文件行数门禁：`scripts/check-file-size.mjs` 与 `scripts/file-size-baseline.json`，超过 500 行且未登记即失败，基线只减不增。

### Deprecated

- `@yonder/plugin-hermes-experience` 已弃用，请改用 `@yonder/plugin-learning`；旧别名将在 0.5 移除。

### Changed

- 官方任务预设 `default`/`coding`/`research` 与常驻模板不再写死模型，改由配置的默认模型解析；`init` 生成的 `presets/*.yaml` 不再含 `model`。
- QQ 渠道补齐媒体、引用和限流：入站附件映射为 `attachments`（只接纳 https URL），引用回复原文写入新增的 `quote.text` 并进入本轮提示，只有附件没有正文的消息也接纳；出站接受 https URL 或本地路径的 image/audio/video/file，先发文字再逐条发媒体；所有请求按新增实例配置 `sendIntervalMs`（默认 500 毫秒）串行间隔。
- 内置提示词底座补入自主（不把自己能做的事推给主人）、目标先行、够用就停与常见死磕场景，并写清命令路径/超时、台账批量记录、两条工作线上限；AGENTS.md 模板用途句提到目标与验收。
- `npm run lint` 现在包含文件行数检查。

### Fixed

- 安装根迁至 `~/.local/share/yonder/install`；`yonder migrate` 保留旧路径链接两个 minor，迁移旧服务标签，并支持安装根与数据目录联合回滚。learning 旧技能 owner 兼容仍保留；codemod 不再映射 hermes-experience，保留弃用别名包。

- `permissions` 工具参数改为顶层对象（`action` 判别 + 可选 `provider`/`kind`/`timeout`），修复严格供应商 API 以 `type: null` 拒绝该工具 schema；参数校验仍在工具内。
- 单次启动产生的 11,726 条 error 级"历史 submission 无原生回执"降为 1 条 `warn` 加周期汇总。
- 任务账本每次读取都新建连接、`SELECT *` 全表并从头 replay 的问题。

## [0.3.26102802] - 2026-10-28

- 飞书任务看板卡及取数轮询退役；保留其他飞书任务卡功能。
- 已知问题：通讯录、名片和个人页依赖尚未提供的云端用户会话和代理接口，相关能力计划于 0.4 完成。
- 第二轮验证存在测试失败和文件大小超限；详细计数与问题见 Release 说明。

## [0.3.26102801] - 2026-10-28

- 统一 workspace 版本至 0.3；本版包含默认管家与引导、发行包选择、控制方法与网关等上述变更。

## [0.2.26102701] - 2026-10-27

### Added

- T61：同步 pi 原生 `pi.model-observation` 逐网络 attempt start/end 观测；generation、compaction、取消和同步 throw 共用原生写入，保留现有 usage 累计和重试。附只读白名单 JSONL/counts 导出脚本。pi-ai 与 durable 同源，以仓库内哈希锁定 tarball 接入干净安装；真实模型/认证验收未执行。
- 模型供应商多账户槽位：配置档与按次任务选择、严格命名身份隔离、create-only/replace 登录与元数据管理；运行绑定贯穿生成、压缩和 deferred 请求。命名槽固定账号 generation，替换/删除后旧运行失败而不换号，恢复失败不阻断其他会话；真实认证验收未执行，AWS profile 命名身份模式明确拒绝。
- 新增独立无模型设备执行契约和标准 Ed25519 端点签名 helper，SDK重导出；仅W0接口，不含执行daemon/配对存储/relay实现。
- 多设备执行 W2/W4：授权范围内的设备发现快照过滤、HTTPS 与 Card 中继配对、控制器工具与持久命令恢复；新增 Linux 与 Windows 全程序平台适配器，校验 Windows 版本链接并拆分 systemd 转义。
- 任务面板视图：看板按状态分组展示任务，新增 panel 页与浏览器契约测试。

### Changed

- 统一根包与全部 workspace 包版本，内部 `@yonder/*` 依赖同步到同一版本；`pi-durable` 保持上游 1.3.0。

### Fixed

- 悬浮入口保留原184宽/22行高，以黄/红/蓝/灰区分执行和可见事项，当前执行优先；收起仅显示彩灯与姓名，详情留在提示与展开页，功能图标统一 Lucide 并保留许可。
- runtime 保留本次终止执行问题并投影自动重试；看板提供 caller 可见的轻量摘要，经 companion 私有回环端点送达 UI，切源或故障不沿用旧计数。
- 品牌小星球的统一角色时间轴放慢至1/3速度，保持逐帧渲染及静态品牌资产不变。
- 任务看板总览中，每条子任务仅在其状态分组出现一次；同组父子保留缩进，跨状态子任务留在自己的分组，详情仍显示全部子任务。
- 自管理创建说明补齐 `avatarUrl` 的统一身份来源、网页同步时点与飞书单独保存/发布的生效边界，避免创建或接入渠道时遗漏已有头像。
- 默认 `npm test` 不再收集用 `node:test` 编写的 `scripts/export-model-observations.test.mjs`，新增 `npm run test:node` 运行它（10 通过 / 0 失败）。

## [0.2.26102512] - 2026-10-26

### Added

- `location-request` 失败增加无位置数据的阶段诊断：首个授权 callback 耗时、激活请求/通知、失败时 isActive 与最后阶段。只补可观测性，保留授权、取消与单次请求语义；源码候选不代表已确认超时根因或完成 OS 修复。

### Fixed

- 微信 iLink 出站失败保留白名单阶段与安全数字 HTTP/ret/errcode，并写入安全诊断日志；不记录凭据、签名 URL、原始响应或消息/文件内容。保留拒绝与部分/未知投递语义，不自动重发。

## [0.2.26102511] - 2026-10-26

### Added

- Agent 可配置云端 HTTPS 头像 URL，经 card 渠道同步至网页身份；旧配置继续使用默认头像。

## [0.2.26102510] - 2026-10-25

### Added

- 可选 `tasks` 插件以只追加 SQLite 事件保存任务目标、范围、状态、交付与逐项验收证据；提供 `tasks_open/update/done/list/get/nudge/show`，稳定 `T<n>` 编号、归属与 parent 可见范围，以及 turn 目标上下文。具备 cross-agent 能力的管家可读取进行中任务并催办其 owner session；不自动启用插件。
- 每约 60 秒检查账本时点：默认 active 任务 30 分钟无活动后提交续办提醒，waiting-user 满 120 分钟向来源发送程序通知；窗口记录跨重启去重。完成后压缩与 recentlyDone 标记默认关闭；当前尚不能排除已有后台等待或 continuation 的 stall。
- `tasks_show` 提供同范围 TaskBoard 总览与详情、桌面/网页 companion 只读看板和轮询刷新；飞书总览原地更新最新卡片，显式请求另发新卡，失败回退 PNG，再回退文字。不含按 Agent 分行的管家视图。
- 向有人类输入记录的目的地追加最多五行任务回复尾摘要，按目的地和任务版本持久去重；超过两小时间隔使用回来摘要。

### Changed

- 插件 `sessions.submit` 可向已打开的 main/persistent 会话提交系统提醒，保留插件来源和 session.input 记录，沿用当前 profile 与原生 busy 队列，不携带人类授权。
- SDK `beforeSend` 类型声明包含实际目的地 `to: Ref`，供回复摘要按目的地处理。
- 常驻底座、default-agent 与 jarvis 提示词补充任务接单记录、状态维护、逐项证据结案及管家催办/看板要求；插件输入明确标注为无人工授权的系统提醒。

### Verification

- 本发行候选的干净安装、构建、静态检查、默认全量测试和 tasks 真实模型时点测试结果见 [发行验证](docs/verification/release-26102510.md)。PR #82 的分阶段历史结果保留在原有 docs/status.md 与任务账本验证记录中；不代表生产或真实渠道验收。

## [0.2.26102509] - 2026-10-25

### Added

- 同一签名 macOS Helper 增加有界 CoreLocation status/request/collect RPC，native permissions provider 支持 location 状态与显式请求；采集只使用真实已有授权，不隐式请求。保留原生授权状态、责任身份与结构化失败，补定位 usage 文案。源码验证不代表正式 OS 授权已完成。

### Fixed

- 定位原生错误回调与成功回调共用取消/deadline 检查，避免边界完成覆盖已超时或取消的操作。

### Verification

- 发布前构建、签名和测试结果见 [Location 发行准备](RELEASE-LOCATION-READY.md)。真实初始化 callback、前台激活、系统授权、定位 fix 与升级授权保留仍未测，由正式发布后的稳定 Helper 验收；源码测试不代表已获 OS 授权。

## [0.2.26102508] - 2026-10-25

### Fixed

- 修复服务入口经 current 符号链接启动时直接退出，导致 launchd 重启循环。正式归并 #79 的 realpathSync 入口修复与真实符号链接回归；本版取代带本机入口热修的 .07，旧 tag 与原部署失败证据不改写。

## [0.2.26102507] - 2026-10-25

### Changed

- 本机 ExecutionEnv.exec（rg、Runtime/SDK execution.run 和 cron 程序作业）接入同一薄宿主 program+argv 门；通过 Pi fork 的可选 local spawn/cancel 适配保留原 Result、流式输出/背压/spill、stdin transport、timeout/abort/cleanup，默认 bash 共用私有 fd 能力缓存，不再各自读取。无宿主/非 macOS/remote 原行为不变。

- 共享 Helper 安装器在 host/permissions 两个入口同步刷新当前安装发行版的稳定 permissions wrapper，支持升级和回滚；锁保留 holder 身份且仅证明旧 holder 已死才恢复，替换失败恢复旧签名 bundle，不盲删并发锁。

- 修复薄宿主后代枚举的归属竞态：以同一 BSD identity/PPID 快照复验到真实 anchor 或已 ACK 根的完整边，拒绝枚举后复用/换父的 PID，清理不误收新身份。

- macOS 服务改由同一 Helper 的无 UI 生命周期入口托管 Node；独立 group-anchor 在业务根退出后保留可验证的组身份，双方 owner 登记 ACK 后才允许启动，TERM 后有界等待并重验身份再组 KILL。
- 增加真实后代在脱组/丢失父链前逐进程登记的双方 ACK 协议，拒绝任意 target PID；服务 restart 先等待旧宿主卸载，旧版本回滚保留原启动链。至少一个 owner 存活且后代保持原组或先登记是受管契约，不承诺未登记 daemon 或双 owner 同杀。
- 默认 bash 在 macOS 薄宿主下复用同一 Helper 的每任务 command-anchor；从宿主私有继承描述符取得能力，先保持原组完成双方 prepare ACK，再建子组、完成 ready ACK 才执行。保留真实 shell 退出码/信号、stdio、stdin 与每任务 TERM→1秒 KILL，命令结束先回收子组再回收锚点；宿主协议损坏报错，不静默退回 detached。非宿主/非 macOS 原路径兼容。
- 保留 .06 统一 permissions registry/ToolContext/API；本次进程专项与产品构建不代表生产 TCC 授权或升级保留已验收。原失败门和最终专项记录见 [宿主回收验证](docs/verification/service-host-owned-cleanup-20261025.md)。

## [0.2.26102506] - 2026-10-25

- 新增共享 `PluginAPI.permissions`、核心 `permissions` 工具和 native-automation provider，复用已有 macOS 权限驱动及 desktop 兼容入口；按真实活动 ToolContext、session/profile 插件选择、owner、能力、执行环境和取消信号校验。
- 该 API 独立于未决的薄原生服务宿主，不改变服务入口或加入定位接口。统一 API 不代表 OS 授权继承；真实 TCC、grant 保留、薄 host 与定位均不在本版验收范围。正式安装另由现有更新流程核验。见 [权限 API 验证](docs/verification/permissions-api.md)。
- 标准 build/typecheck/lint 通过；唯一一次本地全量 662 通过 / 1 失败 / 39 跳过，修正旧 cleanup 测试夹具的 permissions 注册后定点 1 通过，未重复全量或掩盖原失败。

## [0.2.26102505] - 2026-10-25

- 状态栏展示逐 Agent 的运行/空闲/等待状态、任务摘要与可见回复短片段；图标同步标记运行中。
- 菜单入口改为“打开悬浮窗”；图钉可保留同锚点悬浮入口，显示各 Agent 状态，运行时轻微呼吸。

## [0.2.26102504] - 2026-10-25

### Added

- 配置档/defaults/preset 支持可选 `channelInstances` 实例范围；通用投递、飞书工具与带真实 owner 的 cron 程序通知共用检查，子任务保存父调用与预设的范围交集，并在恢复/重新解析时保持保存上限。

### Compatibility

- 未配置 `channelInstances` 保持无限制兼容，不从 bindings 推导授权，也不会自动隔离已有配置或旧任务；显式 `[]` 表示无渠道实例，admin/bypass 不越过显式名单。正式配置迁移须另行安排，已开始的运行仍沿原快照语义。
- 本次不是入站过滤、任意插件进程隔离或 exec/CLI/macOS 沙箱；无 ctx/owner 的可信插件自身通知仍沿原路径。

### Verification

- 复用最终代码 `76d5ee6` 的本地验收：104 个测试文件通过、19 个跳过；605 个用例通过、0 失败、39 个跳过；build/typecheck/lint 均 exit 0（lint 仍有 400 warnings、14 infos）。版本 metadata 变更不重复本地全量。
- 真实 Sol 模型整轮工具/子任务/恢复闭环及正式渠道平台联调未测；没有把离线平台边界回归或跳过项算作真实账号验收。

## [0.2.26102503] - 2026-10-25

- 统一聊天与上下文压缩的重试/回退决策和错误分类，持久记录失败尝试与后续动作，压缩失败明确报告重试或模型链耗尽。

## [0.2.26102502] - 2026-10-25

### Added

- 官方可选 `hermes-experience` 插件：授权 scope 内的精选记忆、静默会话后复盘、私有原生技能及支持文件、pending 管理和显式 `/refine` 工具；不自动选入现有 Agent。

## [0.2.26102501] - 2026-10-25

### Fixed

- 共享渠道路由只截获已识别的内建 slash 命令；未知 slash（如插件的 `/refine`）保留原始文本与来源上下文，继续经过既有绑定、准入与模型/插件流程，不再在模型前回复“未知命令”。内建命令的权限、错误及终端专用提示保持不变。

## [0.2.26102404] - 2026-10-24

### Added

- Yonder 同一签名原生权限宿主新增 owner 任务的 file-list / file-export：一层 metadata、不跟随符号链接、单普通文件私有产物与附件；实际读取在 Helper，不让 Node/Python 冒称继承授权，不自动请求权限。

### Fixed

- 权限入口允许同一 owner 任务的可信内核后台结果/续办沿持久 parent 继承来源；逐跳限制 agent/session/conv，保留访客、混合输入、取消和人工批准保护。SDK 事件查询增加可选精确 id。

### Verification

- 本地全套测试：92 个文件通过、19 个跳过；512 个用例通过、39 个跳过（551 个用例）。file-host 专项：124 个通过、0 失败、0 跳过。
- 未做实机 FDA/权限保留验收，未安装或启动 Helper；本版不代表所有平台或插件均已完成。

## [0.2.26102403] - 2026-10-24

### Changed

- 提示词重写（D65）：共同提示词、jarvis/default-agent 起始正文和任务正文去掉防御性措辞与互相冲突的规则；主人的指令即授权，阻塞立刻说明，只在接手/阻塞/结果/需拍板时发言，“之后讲”必须有机制支撑，一次一个问题并给默认；中文不再带英文套话与私人比喻。已有 Agent 的 SOUL.md/AGENTS.md 不会自动迁移。
- 子会话默认继承发起方的能力、工具和插件；官方 `default`/`coding`/`research` 预设不再写权限与工具白名单，`research` 可用 shell 与命令行。预设显式写出的字段才收窄。init 生成的独立任务预设显式带 read/write/exec/network。已有 home 预设里写死的 `tools`/`capabilities` 仍会收窄，需要的话请删除。`task_run` 嵌套限两层。
- maxTokens 提醒只计新输入与输出（不含缓存读写），提醒文字改为给出下一步；重复调用的拦截文字说明下一步做法。
- 回退模型链剔除与主模型相同的项，空链沿用原生 retry；`yonder doctor` 对这类配置和收不到 `agent_ask` 的 Agent 给出告警与修复片段；agent_ask 被拒时说明原因。
- 运行因网络中断停止时，给人的提示改为简短说明，不再贴供应商原始错误。

### Fixed

- 自动升级：同一安装同时只允许一个更新（避免争用临时目录并产生成对的失败通知），自动升级等待运行中的工作最多 30 分钟，通知只在终态发送且不含回执号。
- 飞书图片/文件下载遇到瞬时网络错误会重试，仍失败时只告知“没能下载，可以请对方重发”。

## [0.2.26102402] - 2026-10-24

- 原生自动化权限工具允许 owner 来源在现有能力范围内显式发起单项 request/guide/watch；系统批准仍由真人完成，status 保持非提示式。

## [0.2.26102401] - 2026-10-24

- 状态栏左右键统一打开原生菜单；点击图标不再直接展开窗口，当前交互和历史可从菜单主动打开。

## [0.2.26102314] - 2026-10-24

- 共同提示词：每条消息只问一个问题，汇报也一次一件；memory-onboarding 改为按来源（微信、聊天渠道、登记目录、节律）逐个询问并记录进度（D64）。

- 新建 Agent 默认生成只读工作区的 peer 协作 profile 与置前 ephemeral binding，回复只交等待调用方；init/create 可用严格布尔 isolated 创建输入禁用。peer 不继承主人私有上下文、插件或技能，仅预加载自身 SOUL.md/AGENTS.md 并校验符号链接边界；旧 Agent 不自动迁移（D63）。

## [0.2.26102313] - 2026-10-23

- 修复 memory 插件：白名单内的 agent 在定时作业与 `memory.attention` 等非聊天事件触发的运行中可以使用记忆工具和上下文，后台 `memory-keeper` 的晚间整理、周复盘与上手流程不再被拒；由聊天消息触发时仍要求主人在白名单会话，`commit`/`confirm` 核验不变。

## [0.2.26102312] - 2026-10-23

- 状态栏“保持唤醒”改为关闭/任务期间/始终三种互斥模式；任务结束后保留至少 15 分钟，新任务结束后重新计时。首次启用始终模式提示耗电与散热，沿用电源组件，无新增图标；旧布尔设置与 CLI on/off 兼容。

- 新增 channel-card 多 Agent 名片渠道、设备授权（含网页十位一次性邀请码兑换）和名片草稿工具；SDK 增加只读 Agent 枚举和需自身绑定的 multiAgent 定向（D61、D62）。

## [0.2.26102311] - 2026-10-23

### Removed

- 撤回 `plugins/progress-observer`、`plugins/decision-routing`、login operations 子系统（`login_begin`/`login_status` 工具、`loginOperations` 配置项、`login_operations`/`login_outbox` 数据表的创建与使用、`task.linked` 事件）及遗留审查报告（见 D60）。这些模块在 0.2.26102204 起的已发布版本中出现，从下一版起移除；若配置里仍引用 `progress-observer`、`decision-routing` 插件或 `loginOperations`，需要删除这些条目，否则加载或配置校验会失败。已存在的 `login_operations`/`login_outbox` 表不会被自动删除，保留无害。

## [0.2.26102309] - 2026-10-23

- 修复电源组件长时间运行后 Process/Pipe 句柄累积：每次调用释放 Foundation 临时对象并显式关闭管道；构建自检连续 64 次调用确认无句柄增长。旧组件通过协议标识在现有菜单项提示更新；首次更新仍由系统授权，不后台弹窗。

## [0.2.26102308] - 2026-10-23

- macOS 现有状态栏新增任务期间保持唤醒：服务按原生运行事实续租，限定电源宿主支持合盖运行，任务结束、断开或租约过期恢复自身设置；首次启用走系统授权，显示器可熄灭。

## [0.2.26102307] - 2026-10-23

### Added

- 官方 agent-presets 补齐通用 default、coding、research 三套可配置任务提示词，同一预设用于短期子任务或连续独立 session；保留 OpenCode、OpenMuse 与 Ponytail 的详细原文、固定来源和许可证。research 限定只读与网络工具，新 init 选用 web-tools；旧 home 同名配置不覆盖。

- `yonder.yaml` 全局 locale/timezone 默认中文与 Asia/Shanghai；提示词日历明确显示 UTC 和北京时间/星期，UI Companion 历史时间也使用同一设置，不依赖宿主时区。cron 仍要求作业显式设置时区。


## [0.2.26102306] - 2026-10-23

### Fixed

- 按需工具检索识别长查询或中文语句中的完整工具标识，避免 `task_run delegate subagent` 被额外关键词挡掉。未加载工具的调用仍不执行，但明确提示先搜索准确工具名、下一次模型响应再调用；提示词同步说明加载顺序与空结果恢复方式。


## [0.2.26102305] - 2026-10-23

### Changed

- Profile 新增 prompt.sections / prompt.overrides：内置提示词按稳定段落选择、排序、替换或关闭，适配短上下文本地模型；保持现有上下文/技能/工具选择、权限与运行快照。

- 完整重构系统、贾维斯主 Agent 与普通常驻 Agent 提示词：保留交流措辞与案例，适配本机、多仓库、多渠道及子任务/后台进程；官方 agent-presets 插件沿现有槽生成两类可编辑模板，新 init 选 Jarvis，既有文件不覆盖。插件使用与排障说明随各自能力提供。

## [0.2.26102304] - 2026-10-23

### Changed

- /model 与 /status 的上下文用量增加百分比，保留一位小数。
- 自动后台压缩可用 compaction.backgroundAtTokens 提前触发，与实际模型窗口分开设置。

## [0.2.26102303] - 2026-10-23

- 修复升级后状态栏“交互插件未就绪”：新 home 默认加载 ui-companion，旧 home 首次启动补齐桌面服务；保留自定义来源和 desktop:false，不扩大 Agent 工具权限。

### Fixed

- 参考 Hermes 的 names-only 目录和检索准入规则：按需工具配置保留可搜索工具名，中文任务可按名称加载完整定义；精确名称优先，过滤仅命中通用词的无关结果。保留 pi 原生工具加载与会话压缩。

## [0.2.26102302] - 2026-10-23

- 统一 macOS 状态栏入口：左键当前交互/历史，右键服务管理、检查更新与停止服务并退出；按 home 单实例，插件不创建额外图标。
- 新增 ui-companion SDK 插件：卡片提交、原会话结果回传、持久化交互历史；复用 ai-card 风格与共享 Logo，默认完成隐藏浮窗和浮球，支持无品牌内嵌。

## [0.2.26102301] - 2026-10-23

### Added

- 支持 Agent/profile 和单会话模型回退链，默认连续失败三次切换，原生 checkpoint 保留任务与重启恢复。
- 飞书、微信与 CLI 共用 /model、/status、/compact：模型目录、effort、上下文与后台任务/子 Agent 状态。

## [0.2.26102206] - 2026-10-22

### Fixed

- 修复 progress-observer 工具注册名称必须带 `<plugin-id>_` 前缀导致真实插件加载/doctor 启用检查阻断的问题；覆盖真实 loader 与启用配置下的 CLI doctor fixture。
- stall 候选以已核验执行器事件/里程碑证据窗口为准，跨重启对同一窗口去重；通知只表示“阈值内没有更新的进展证据”，不推断 executor 已死、任务 missing 或被中断。
- 静默任务及未通过管理员双 allowlist 的任务在模型判断/发送前过滤；done-but-unaccepted 仅在证据窗口超阈后才是待处理 stall 候选。

### Limitations

- 此 release 不等于 progress-observer 已在生产启用或完成生产验收。管理员 opt-in 与精确 allowlist 仍需单独授权和部署。
- owner inactivity 检测、ask/ownerRequired 生产接口，以及面向生产调用方的完整 milestone 更新接口仍未完成；不要把“无新进展证据”描述为 missing/dead。

## [0.2.26102205] - 2026-10-22

### Added

- progress-observer 自动进度通知改为显式 opt-in；只有管理员同时批准的 agent 与精确来源会话才允许触发判断及发送。此变更不包含 missing/stall 检测、owner inactivity 提醒或 ask 通知。

### Fixed

- memory inbox、bootstrap、capture 与微信归档自动捕获均默认关闭，必须分别显式启用；配置的 channel/白名单本身不再隐式开启自动处理。
- login operations 的显式 `loginOperations.enabled`（包括 `false`）优先于旧环境变量；`login_begin` 同时要求 `write` 与 `exec` capability，catalog 和 handler 均实施检查。

## [0.2.26102204] - 2026-10-22

### Added

- 集成可选 memory 插件（PR #27），提供个人记忆能力；默认未启用，需显式配置。
- 新增受控 login 生命周期（PR #28）；尚未验证人工登录流程，未知状态窗口仍需后续验收。

## [0.2.26102203] - 2026-10-22

### Added

- 新增 QQ 官方渠道：腾讯 SDK 的私聊与群 @ 文字收发、独立账号路由与投递回执；附带扫码配置命令，输出链接/二维码并可打开官方页面，自动保存凭据和绑定。
- 接纳平台已开放的 QQ 群普通消息，复用默认旁观绑定写入每群独立会话，不逐条调用模型；全量推送仍需平台开启“接收所有消息”。
- QQ 群持续参与：新配置默认每群只读分身、非空 60 秒分桶与显式消息 ID 回复；新增受限 parent_ask，经绑定请求所属主会话，不给群分身执行或通用跨会话发送能力。说明群主必须在具体群聊内逐机器人设置消息范围。

## [0.2.26102202] - 2026-10-22

- 修复 runtime.transcript 在 limit/from 很小时仍解码整段会话历史：把 minEntryId 与 limit 下推到存储扫描（生产最大会话 2552 条/26MB：limit=1 由约 65ms 降到约 1ms）。

## [0.2.26102201] - 2026-10-22

- 修复 Bash 默认开放 stdin 导致无路径搜索等输入；普通命令默认 EOF，交互命令显式 stdin:true，process.write 支持 eof:true。background 与软 timeout 语义不变。
- 后台取消仍通知确定性等待者并保留已输出尾部；滚动日志使用累计游标和截断标记；同步/后台路径保留相同的原生错误详情。
- 动态时钟移到既有输入准备层，system 恢复确定性；说明 waiter 最终回传与合法消息目标，无身份任务不提供 agent_ask。

- 修复 macOS 权限引导窗：跟随实际 Settings 列表下沿，授权后显示确认并自动关闭；guide/watch 共用每秒观察、600 秒超时和有证据的屏幕权限重启流程。

- BrowserSkill：同步最新上游指导与 UTF-8 runner 修复，加入默认关闭的书签、扩展管理工具；保留主人权限授权与安装确认。

- 实现稳定签名 Yonder Helper.app、9 类非提示式权限状态与请求历史；native-automation 桌面操作改由 helper 执行，新增只读 permissions action；独立人用 CLI 提供 request/guide/watch，显式引导复用 PermissionFlow。FDA/Files & Folders 如实 unobservable，真人授权/UI/升级保留待验收。

- 新增可选 clipboard 插件：同会话消息/文件/工具结果按 opaque handle 原样搬运，Keychain sealed 存储、隐藏 TTY 捕获、作用域/TTL/目的地授权与元数据审计；文件、固定 child env/HTTPS、open 消息及 vault 目的地。浏览器与飞书私密 adapter 仍阻塞，不启用生产配置。
- SDK 增加可选 beforeSend；选中 profile 的消息在 message_end 过滤后投递，工具异常与原生 process 结果也经过 afterTool。精确脱敏不构成 shell/OS 沙箱。

## [0.2.26102106] - 2026-10-21

- 启动恢复不再重放已有 `run.end` 的历史运行，并把回执附件与 `sources()` 的条目扫描限定在该运行自己的区间：用生产状态库副本实测，启动从约 45 秒（生产约 2 分钟）降到 4.8 秒，且不再随会话变长而增长。

## [0.2.26102105] - 2026-10-21

- 修复升级后记录结果时可能接管正在启动的服务的主目录锁、使其 ECOMPROMISED 崩溃的问题：控制接口未就绪而锁仍新鲜时等待服务，锁判陈旧的窗口放宽到 120 秒。
- `agent_ask` 与 `task_run` 增加可选 `effort`（需 admin）：只作用于由该委派启动的那次运行，无效或不支持的等级按确定规则回退，`run.end` 记录实际思考等级与请求/回退原因；聊天文本不能指定等级。

## [0.2.26102104] - 2026-10-21

- `agent_ask` 与 `task_run` 增加可选 `sources`：由程序把本次运行来源会话里的入站消息逐字追加给被委派方（带事件 id、发送者、时间与精确字符数），模型不复述；只限本会话、不转交附件、不截断。
- 新增 `credentials set <name> --home <dir>` 本机隐藏 TTY 命名凭据录入；只创建 API key，拒绝覆盖、管道和不安全存储，与 OAuth 共用锁并原子写入 0600。
- 飞书任务卡固定四色短标签，增加可选负责人/原文程序转发声明及两个短列表；按钮明确仅通知，通知结果未知不报成功、不重发，公开退役落盘和重启边界。
- 飞书增加显式受管任务状态卡工具：同消息更新、短表格、来源/revision/发起者校验、持久回执与新文字撤销旧按钮；详情和收到操作只产生无授权通知，不执行新任务。普通流式投递契约不变，真实平台验收与部署尚待完成。
- 飞书将明确发生于 TLS 建立前的连接重置识别为确定未发送，沿现有投递账本补达；普通断连及部分成功仍不重复发送。
- 所有渠道默认 steer，插话与后续队列一次消费全部待处理消息；生成中的旧回答可被插话中断，增加显式 interrupt 忙时策略。
- 微信接入默认返回可扫码链接并自动等待确认；新增 channels login 与 /connect，沿用当前服务的渠道和权限。
- 迁移微信双插件：本机归档查询、媒体、策略与资料触发器，以及 iLink 扫码、私聊、媒体与逐消息投递；首个实例默认关联显式主人，后续实例独立关联和权限路由。

## [0.2.26102103] - 2026-10-21

- 区分消息、模型运行与任务责任：task_continue 将具体后续步骤持久排入原会话，阶段汇报后无需追问继续执行。
- agent_ask/task_run 跨重启接回同一委派；子会话仍有后台工作时不提前返回阶段答复，最终结果按原生回执与因果关系交接。
- 修复 OAuth 刷新网络错误误判、错误详情丢失、后台结果未接纳却确认通知及临时会话提前关闭；接纳失败自动补交。
- 确定尚未发送的瞬时渠道故障沿原发送账本在线及重启后补达；流式创建前断网也在消息结束后补达完整正文；飞书区分 DNS/建连、鉴权拒绝和送达未知，部分成功与未知结果不重发。
- 增加真实 Luna 父子任务跨进程崩溃恢复、自动续办、断网、通知补达和发送中断回归。

## [0.2.26102004] - 2026-10-20

- 修复同一条飞书消息下多个后台任务按来源msgId误去重的问题，按session/job区分完成事件，保证新结果进入模型上下文并自动续办。
- 整合D45规范与提示词装配检查：内置单一英文底座，Agent沿SOUL.md/AGENTS.md上下文，保留日用额外约定，不自动改写旧文件。
- 沿用已进入03的pi-durable源码fork、可配置恢复与beta版本比较修复；增加连续委派上下文回归及干净安装、自动更新验收。

## [0.2.26102003] - 2026-10-21

- 修复 GitHub 插件在宿主为测试版（`-beta.N`）时无法比较版本、导致自动升级失败的问题；版本比较按 semver 处理预发布后缀。

## [0.2.26102002] - 2026-10-20

- 内化 pi-durable 1.3.0：从 GoYonderTogether/pi 的 yonder/1.3 源码 fork 同步为 workspace，删除安装补丁与 postinstall，其他 pi 依赖仍取上游 npm。
- 中断恢复：yonder.yaml.retry 可配置次数、基础和最大延迟，默认 10 次、2 秒起、5 分钟封顶；连续失败及退避重启共用一条提示，重启提示按运行去重。耗尽以明确 error 终结，退避可立即取消，close 清理计时器。

- 重启或连接中断时正在运行的任务从持久检查点自动继续，并向会话注入一行中断提示，让模型自行复查状态后恢复，不重复已完成的副作用。

## [0.2.26102001-beta.1] - 2026-10-20

- 版本号改为 `0.<minor>.<YYMMDDNN>`（两位年份），测试版带 `-beta.N` 后缀并发布为 GitHub 预发布，正式版无后缀；自动更新与 `update --to latest` 只认正式版，`update --to beta` 安装最新测试版。minor 由 1 升到 2 以保证相对旧的 `0.1.YYYYMMDDNN` 单调递增。
- 首个公开开发者预览：全新仓库历史、中英文 README、SECURITY 与行为准则、维护分支前缀 `zoran/` 改为 `yonder/`。
- 文档收敛：过程记录归档，规范按主题合并（10 运行保证与发布更新、13 观察与管理命令、14 执行能力，macOS 状态栏并入 09），新增 docs/status.md 与 CONTRIBUTING.md，plugins.md + reference.md 取代 function-tree.md。
- 内核拆分，行为不变：kernel 拆出 workspace、home、home-management、terminal、background；runtime 拆出 docs、catalog、results、output、policy、limits。
- 测试与 CI：补齐 8 个插件的契约测试，3 个本地集成脚本接入 vitest，新增 pi-durable 补丁生效检查；新增 macOS CI 工作流，lint 排除非产品目录。

## [0.1.2026102001] - 2026-10-20

- 模型每条消息独立结束气泡，工具和后台等待不保持飞书流式；阶段汇报与最终结果各自发送，前文不被覆盖。
- 后台完成续办接入同一流式投递路径，无需用户追问；补充长任务的实质进度汇报引导。
- 发送回执按每条原生消息去重并及时保存，保留恢复、unknown、取消和慢渠道的边界；移除流式对软时间阈值的误用。
- 飞书收到消息完成标记即关闭CardKit并刷新尾部文字；发送工具schema明确完整引用和file URI，提前拒绝现场两种错误参数。
- 真实Luna长工具自动续办与真实飞书三消息/18秒间隔验收通过；默认测试167通过、12跳过，全仓lint既有49错误保留。

## [0.1.2026101907] - 2026-10-19

- 长工具15秒转入pi原生后台任务，process管理日志、stdin、状态和取消，完成后自动继续原任务。
- 时间、轮数与tokens改为软提醒，子任务提醒父session；显式取消和实际模型限制保留，结束任务释放内存。
- 新增cron、通用MCP客户端、独立Playwright/macOS桌面自动化插件，保留既有宿主桥接。
- Agent/preset模板化管理、注册热发布与归档恢复；不提供真删。
- 工作区提供手工memory说明，不启用记忆引擎或自动注入；使用现有安装/update流程。

## [0.1.2026101906] - 2026-10-19

- 插件可按已有事件订阅直接执行已批准更新与程序通知，模型仅按显式绑定参与；增加可升级版本turn上下文。
- CLI/插件共用更新完成事件release.update-result；失败与未核验结果不冒充成功，不增加重试队列。
- 增加原生无模型session通知、CLI sessions notify及TUI程序消息显示，保留真实来源与原事件引用。
- 新增内置yonder-self-management技能；捆绑硅基免费图片/ASR插件，需另配服务凭据后启用。
- 1906通过既有update流程升级；配置迁移移除更新事件的多余模型唤醒，程序通知沿用明确目标。

## [0.1.2026101905] - 2026-10-19

- 内置yonder-plugin-debug：从真实入口执行短任务，核对工具、事件、转录、产物及投递；提供时序/恢复/权限复现指导。
- 沿用既有skill索引与按需读取，不注入全文，不增加插件或运行服务。
- 保留原始错误与未测，补充真实CLI短任务证据及安装版发现检查；不重跑全功能矩阵。

## [0.1.2026101904] - 2026-10-19

- 正式发行P轮成果：修复飞书历史背景时钟边界，保留已验证的原生队列、跨渠道主会话与独立安装更新能力。
- 全部任务分支及历史工作树统一进入main，保存被后续实现接替的旧草稿；不重复覆盖现行修复。
- 提供全量功能/英文注册名树、8个插件的接口与最小功能说明，以及实际验收和未测记录。
- 发行前功能基线35文件145项检查通过；视频播放、真实断网及执行中插话按用户决定留给日常反馈。

## [0.1.2026101903] - 2026-10-19

- 飞书历史背景固定截止覆盖已接纳消息的原始发送时间，修复平台时间略快于本机时区间倒置导致背景不可读。
- 明确CUA变量只在当前运行保留，以及网页正文提取不保证表格/元数据保真；说明creator辅助脚本的PyYAML依赖。
- 增加原生多渠道回投、访客权限、agent_ask、新建skill下轮读取及主动发送的真实Luna验收。群权限/媒体/卡片回调实证及未测记录见P轮结果。


## [0.1.2026101902]

- 全局yonder自动发现已安装服务home，裸入口连接常驻CLI主会话并立即装入历史；显式chat保持独立任务。
- 内置完整skill-creator与可选开发技能，按原skill_view机制加载，独立Git开发与正式update更新边界清楚。
- CardKit兼容历史用成功投递账本补回本机器人正文；工具说明明确原生ID引用与艾特语法。

- 区分飞书待处理输入与全参与者会话背景；使用现有turn上下文插槽，背景保留原始时序、已有回复和可见范围，不提升权限。
- 普通与迟到消息呈现原发送时间、接纳时间和原生消息ID，模型结合后续对话决定回复或NO_REPLY。
- 恢复仅合并连续同来源、同发送者、同线程消息，不再跨参与者或线程重排；保留原生pi队列，无新增缓存或消息系统。

## [0.1.2026101901]

- 修复已有安装首次启用历史补齐时跳过升级间隙的问题，沿已有事件最后确认时间续接；全新安装不回放旧历史。
- 恢复正文显示原发送时间、原生消息ID及引用，元数据计入批次预算，迟到历史不伪装成新消息。
- 统一SDK事件分发日志；条件引用同时观察已接纳的较新气泡，后台服务安装使用JSONL日志。

## [0.1.2026101807]

- 飞书连接与身份查询解耦，沿用官方SDK首次恢复/重连；统一脱敏网络诊断与后台JSONL日志。
- 启动/重连分页补齐已知私聊和可访问群历史，按会话与发送者分组，保留原生消息关联并沿用原生inbox。
- 主人飞书与CLI共用同一main会话，普通消息使用steer；其他来源默认旁观。
- 飞书复用CLI既有/help、/session、/skills、/stop；新增受权限约束的历史工具。
- 接收Typing表情、可见回复/终结清理及新用户气泡隔断时才引用；显式replyTo保持。

## [0.1.2026101805]

- 正式发行已审核的 R 轮修复，保留原生输入、父子取消、投递回执及独立 macOS 安装能力。
- 用户已单独批准受限 operator 自动更新及指定飞书私聊接入；配置、实际发布和安装验证以任务记录为准。

## [0.1.2026101804]

- 修复真实父任务取消后子会话终态遗漏：沿用原生子任务所有权，以服务上下文完成已接纳结果的唯一投影。
- CLI 帮助展示已提供的 service info / update --check。

- 安装版 Yonder/Sol 从真实 GitHub issue 自主修复飞书非 2xx 的原生错误诊断丢失，经 Codex 审阅合并 PR #2。
- 保留 HTTP、平台数值 code 和明确缺权 scope；沿用有界读取、脱敏及副作用不确定语义，不增加重试或回退。

## [0.1.2026101803]

- 补齐飞书普通消息工具的显式 replyTo，经共同投递入口完成回复。
- GitHub 首次全量扫描不发送 epoch 增量水位，修复实际 API 返回空列表而漏接 issue。

## [0.1.2026101802]

- 修复 macOS 服务重装时的退出竞态：确认旧进程及 launchd 注册已退出后再安装，不重发 bootstrap。

## [0.1.2026101801]

### 本轮修复与安装

- 运行开始时准备输入和图片；普通发送共用文件权限与结构化未知回执。
- SDK/CLI/MCP 共享接纳身份，子任务保留显式附件、会话和原生产物；MCP 进度走标准 SSE。
- 修复插件默认配置、Skills 导入、有效工具检查、TUI 断连与 NO_REPLY 完成态。
- macOS 原生状态栏和独立 launchd 登录项；只读检查正式 Release，退出停止服务。日期版本保留原有 X.Y.Z 安装协议。
- R0–R6 检查/独立安装/外部验收以任务结果为准，未测项目不算通过。

### 前轮功能体

- C0–C6 源码实现未验收：本地插件/Skills 管理、models/inspect、CLI 附件、共用会话观察及 MCP 被动观察。
- 官方 BrowserSkill、Codex Computer Use/hosted search、Tavily Search/Extract/Fetch、GitHub issue/PR/Release/operator、飞书流式卡片与多媒体插件纳入 workspace。
- D29 原生结束回执与恢复接线、唯一运行终结、投递未知状态、真实 grep 和图片规范化；保留原生 pi 队列及 TUI 交互。
- C0–C6 实施阶段当时仅构建与类型检查；该阶段没有运行测试或执行安装切换、外部发送、发布。

- TTY 默认任务聊天、显式渠道/会话目标、plain/JSONL、sessions open/submit 与中英文 shell/斜杠命令说明。
- zsh/bash/fish 补全脚本，动态候选只读查询当前 home，不修改 shell 配置。

- 基础 TUI 直接复用 pi 1.3.0 原生布局、消息/工具组件、编辑器、补全、选择器与键位；底栏仅适配 Yonder 数据。

- 可续聊任务的手动关闭策略、原生 steer/followup 输入与终端只读消息/工具观察控制接口。

## [0.1.4]

- Yonder maintainer（Luna）自主修复 task_run 的失败状态与原因丢失；普通提交与子任务共用终态转换。

## [0.1.3]

- 补齐独立安装、登录、后台服务入口及真实安装检查记录，用于验证服务外阶段更新。

## [0.1.2]

- 修复安装版经 current 软链接启动时 CLI 未执行的问题。

## [0.1.1]

本地阶段安装：N01 运行边界与 N02 MCP 已验证；安装、自维护及其余插件按 N03–N14 接续。本标签不等于正式 GitHub Release。

### Fixed
- 固定每轮配置与预算；限额停止当前运行后继续原生排队输入，工作区及上下文使用原生取消信号。依赖补丁由 postinstall 应用。
- 修复自定义事件正文丢失、事件标签换行，以及重载未做引用校验和上下文模板准备；预设能力不再因重载扩大。
- 运行上限使用稳定输入标识计数，被拒工具不绕过轮数，重复副作用在停止点前被阻止；配置快照与队列终止尚待 N01 完成。
- 修复离线控制连接错误、CLI JSONL/final 输出与断开退出；重启保留已修改的身份关系。
- 修复插件包解析、事件观察顺序与来源约束，以及 CLI 渠道崩溃遗留 socket 和连接归属。
- 修复真实模型工具运行的流式归属和完整消息块文本转换；统一凭据路径解析。
- 修复非账号来源路由及 kind 校验；测试入口排除 dist，避免重复执行编译产物。

### Added
- 官方 MCP 控制渠道：回环 HTTP 鉴权、原生事件/会话/身份/消息接口，以及真实模型控制与取消检查。
- 按 Git 标签安装和更新、原子版本切换、固定 Node/PATH 启动脚本、macOS launchd 服务命令与版本文档查询。
- Agent Skills 发现、优先级、按配置索引与受限文件读取；CLI 技能列表和诊断。
- CLI 初始化、登录、前台运行、聊天、诊断及管理查询；内核组装与离线只读查询。
- 回复来源判定、流式投递与七个内核工具，支持主动发送、agent 询问和预设任务。
- 绑定路由、四类会话、等待式事件调用与预设子会话能力交集。
- 确定性系统提示、每轮身份/附件/版本信息与按需上下文模板。
- 插件清单、八类贡献与配置校验，渠道/环境实例和插件生命周期加载。
- pi 持久运行时、模型与凭据适配、工具能力过滤、执行环境和运行上限。
- CLI socket 渠道与按配置选择的工作区上下文文件插件。
- YAML 配置校验、配置档解析和保留有效配置的热重载。
- SQLite 事件、会话元数据和跨渠道身份存储；与 pi 共用连接。
- SDK 类型、引用函数与插件契约检查，提供渠道、工具、上下文、环境及其他插件槽。
- npm workspace、TypeScript 工具链和 SDK/core/CLI/两个插件的包骨架。

### Changed
- 登录请求中的产品名称提示统一为 Yonder Harness；保留底层依赖与版权的准确名称。
- 0.1 接口补齐默认配置、定向 agent 调用、渠道投递与安装服务约定；按两轮计划先实现、后完整验收。
