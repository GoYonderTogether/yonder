# 前端状态矩阵（页 × 维度 × 状态）

> 事实文档，不是规范。「目标显示」一栏是**为讨论准备的候选**，不是已批准设计；需要产品决定的地方集中在 §6。任何一条与 `docs/spec/`、页面树冲突时，以后两者为准。
> 证据基线：`10fef489cbf1`。路径相对仓库根；检索优先用符号名。

## 1. 这不是笛卡尔积

维度之间并不独立组合。下面每张页面表只列**该页真实可能同时出现**的组合，其余组合要么在架构上不可达，要么应折叠成同一种显示。三条已由主 Agent 确定的独立性事实（本文按此组织，不自行改动）：

1. **公开路由绕过 gateway 登录，但不绕过 gateway 本身。** `App` 先渲染 `public: true` 页面再判 `authed`（`apps/app/src/App.tsx:23-29`），所以 `#/u`、`#/p`、`#/g`、`#/get`、`#/connect` 不会把浏览器踢到令牌登录页；但页面自己发的 `/api/*` 仍由网关按登录态回答（`packages/gateway/src/server.ts:236-247`）。
2. **网关登录与社交登录是两条独立事实。** 网关登录态来自 `capabilities.get` 是否成功（`App.tsx:15-21`）；社交登录态来自社交后端 `/api/session`（`apps/app/src/features/social/Profile.tsx:222-223`，纯函数映射在 `features/social/lib/session.ts:14-33`）。两条都可能有 unknown / no / yes / error，且可以任意交叉。
3. **设备绑定、设备在线、节点可达是三个独立事实。** 绑定来自社交后端 `/api/devices`（`api/social/http.ts:79-83` 的 `devices`、`DeviceSheet`），在线是节点给的 `Device.online`/`Actor.online` 布尔，节点可达是网关 WS 连接状态（`apps/app/src/api/stream.ts:4` 的 `connecting | open | down`）。社交后端不可达时，绑定与在线都无从谈起，但网关仍可能可达；反之亦然。

其余折叠规则：

- `gateway auth = no` 时，非公开页不会渲染业务内容，只会停在 `Login`（`App.tsx:31-39`）或「连接中…/无法连接网关」（`:40-45`），所以这些页面的表不再重复列社交/设备维度。
- `social auth = human` 蕴含 `anonymous = false`；写成 `anonymous` 时指「有访客账号但未注册」。
- `data = empty` 与 `data = error` 必须分开渲染；`forbidden`、`unsupported`、`unbound` 是 error 的三个子类，不允许并进「空」或「失败」。

## 2. 状态词表（六类不能合并）

| 词 | 含义 | 当前可观测证据 | 典型来源 |
|---|---|---|---|
| `pending` | 请求在途，尚无结果 | TanStack Query `isPending`/`isLoading` | 首次加载、切节点 |
| `empty` | 请求成功，结果为空 | `data` 是 `[]` / `null` / 明确无记录 | 无会话、无联系人、无设备 |
| `error` | 请求失败，原因可展示 | `isError`；`RpcError.message`、`SocialError.message` | 网络断开、5xx、解析失败 |
| `forbidden` | 已登录但没有该 scope | `RpcError.code === "forbidden"`（`api/client.ts:65`，网关 `/api/rpc` 403 或 body 内 code，`server.ts:176`）；WS `end{reason:"forbidden"}`（`server.ts:409`） | 远程令牌无 owner 看 Bot 会话；非 owner 调 `bots.*` |
| `unsupported` | 方法/契约不存在 | `RpcError.code === "unknown_method"`（`packages/core/src/control/methods.ts:63`）；或 `capabilities.get` 的 `methods` 里没有该方法 | `update.*` 空表、`approvals.*` 空表、views 未注册 |
| `unbound` | 服务在、实体未绑定 | `Device.online`、`Actor.deviceId`、`Agent.online`；`Profile` 的「连接设备后，Agent 会出现在这里」 | 社交账号存在但没绑定任何设备/Agent |
| `offline` | 实体存在但当前不可达 | `mux.state === "down"`（`ui/Banner.tsx:5-16`）；`Device.online === false`；`Actor.online === false`；`SocialChat` 的「Agent 离线，消息会保留」（`:148`） | 断网、桌面壳未启动、远程节点关机 |

补充：`gateway error` 与 `gateway unknown` 在 `App` 里被合并成同一屏文案（`App.tsx:40-45`：`facts.isError ? 无法连接网关：… : 连接中…`），但两者语义不同（连不上 vs 还没连），见 §6 第 1 项。

## 3. 页面状态表

### 3.1 公开名片 `#/u/:id`、公开个人页 `#/p/:id`

外壳不要求网关登录（`registry.ts:43-57`），页面只查社交后端。

| 组合 | 目标显示（候选） | 现状证据 | 缺口 |
|---|---|---|---|
| social pending | 骨架/「正在加载资料…」 | `CardPage.tsx:135-145`；`Profile.tsx:37-42` | — |
| social empty（id 无对应） | 「这个资料不存在或无法访问」+ 返回 | `CardPage.tsx:162-167`；`Profile.tsx:56-62` | — |
| social error（网络/5xx） | 「加载资料失败」+ 重试 | `CardPage.tsx:146-161`；`Profile.tsx:43-54` | — |
| **社交后端未接入（网关 404）** | 应显示「社交服务未接入」，**不能**说「不存在」 | `api/social/http.ts:21`：任何 404 一律 `null`；网关对未知 `/api/*` 返回 404（`server.ts:246`） | 现会被渲染成「这个资料不存在」——把 `unsupported` 误报成 `empty` |
| gateway no + social human | 页面照常可用；不出现「登录网关」提示 | `App.tsx:23-29` 先渲染 public | — |
| social anonymous | 可看；「开始聊天」会复用访客身份（`CardPage.tsx:33-38`） | 已有 | 「加好友」提示注册（`CardPage.tsx` 好友按钮分支） |
| 无设备绑定 / Agent 离线 | 公开页不依赖设备，不显示设备态；Agent 卡片只显示在线/离线 | `Profile.tsx` 的 agent 行 `agent.online ? 在线 : 离线` | 设备维度不该出现在公开页（产品确认） |

### 3.2 群邀请 `#/g/:token`

| 组合 | 目标显示（候选） | 现状证据 | 缺口 |
|---|---|---|---|
| pending | 骨架 | `GroupJoin.tsx:20-25` | — |
| empty（token 失效/不存在） | 「这个群二维码已失效」+ 回消息 | `:42-50`（`groupPreview` 404→null） | 404 与「未接入」仍不可分（同 §3.1） |
| error | 「加载失败」+ 重试 | `:26-41` | — |
| social anonymous（已加入） | 直接跳会话 | `:15-18`，`group.data.member && convId` 自动 `location.replace` | — |
| social no → 点加入 | 先建匿名账号再加入 | `:55-61` | 失败文案取 `Error.message`，`SocialError` 能给出；无登录入口（访客路径是设计还是兜底，待定） |
| join 成功 | 跳 `#/c/:id` | `:61` | — |
| join 失败 | 行内错误 | `:98-102` | 无「已满/禁止加入」等分类文案 |

### 3.3 安装 `#/get`、连接 `#/connect`

| 组合 | 目标显示（候选） | 现状证据 | 缺口 |
|---|---|---|---|
| Install 无邀请码 | 模板里占位 `__________` | `Install.tsx:19-20` | 占位符是否为可接受空态待定 |
| Install generating | 「正在获取邀请码…」 | `:65-69` | — |
| Install error | 「邀请码生成失败，请重试」 | `:70-74` | 401 有专门文案（`:29`），其余错误不分 429/网络 |
| Connect `?code=` pending | 「正在加载…」 | `Connect.tsx:23-29,89` | — |
| Connect code invalid/expired | 「授权码无效或已过期」；按钮禁用 | `:89,92-99`（`status !== "pending"` 禁用） | 过期与无效共用一句 |
| Connect 无 code：device list pending | 邀请码区「正在生成邀请码…」 | `:45-51,138` | — |
| Connect device list error | 「设备列表加载失败」+ 重试 | `:118-121` | 与「邀请码生成失败」两个错误源同时存在时的优先级未定 |
| Connect 邀请码过期 | 倒计时变「过期」+ 重新生成 | `:38,130,143,149,183` | — |
| Connect 连接成功 | 「<设备名> 已连接」+ 去联系人 | `:37,101-110` | 3s 轮询 + baseline 差集，刷新后 baseline 为空，历史设备不会被误判为「刚连上」（`:37`） |
| gateway no（`#/connect` 是 public） | 页面可开；社交未登录时 `createInvite` 401 → 「请登录后再获取连接邀请码」 | `Install.tsx:29`；Connect 的 invite 错误走 toast `:49` | Connect 没有把 401 单独说成「先登录社交账号」 |
| 无绑定设备 | 「只控制本机」语义在 `ConsoleSwitcher`（`:175-179`），Connect 页只显示「添加设备」 | — | 两处空态文案不统一 |

### 3.4 网关登录（`Login`，非路由页）

| 组合 | 目标显示（候选） | 现状证据 | 缺口 |
|---|---|---|---|
| gateway unknown（首次） | 「连接中…」 | `App.tsx:40-45` | — |
| gateway error（连不上） | 「无法连接网关：<原因>」 | `:43` | 与 unknown 同一屏，靠文案区分；无重试按钮 |
| gateway no | 登录表单 | `App.tsx:31-39` → `Login.tsx:27-63` | — |
| 提交中 | 按钮「登录中…」并禁用 | `Login.tsx:57-60` | — |
| 令牌无效 | 行内「令牌无效」 | `api/client.ts:78`（403/401 → forbidden） | 与 429 文案不同，已区分（`:77`） |
| 限流 429 | 「尝试次数过多，请一分钟后再试」 | `:77` | — |
| 登录成功 | 重置查询并回外壳 | `App.tsx:34-38`（`qc.resetQueries`） | 成功态无过渡提示（可接受） |
| social 任意态 | 不影响网关登录 | 两条独立事实（§1.2） | 登录页不提示社交状态——符合独立性 |

### 3.5 消息列表 `#/`

| 组合 | 目标显示（候选） | 现状证据 | 缺口 |
|---|---|---|---|
| gateway ready + sessions pending | 「加载中…」 | `SessionList.tsx:227` | — |
| sessions empty | 「还没有会话」 | `:229-231` | — |
| sessions error | 「会话加载失败，稍后自动重试。」 | `:228` | 无手动重试；5s 轮询（`queries.ts:12-17`） |
| 搜索无匹配 | 「没有匹配的会话」 | `:230` | — |
| imports unsupported/error | 静默为空（不显示导入分组） | `queries.ts:80-88` `retry:false`；`SessionList.tsx:192-200` 只列有数据的组 | 与「没有导入会话」不可分 |
| forbidden（远程无 owner） | 只列任务会话，Bot 区可隐藏或注明 | 网关侧过滤在 `session-methods.ts:63`（`ownsBots` 判定见 `packages/core/src/control/guard.ts:9-13`）；前端 `groupOf` 仍会得到 bot 组为空 | 前端不解释「为什么没有 Bot」；`bots.list` 失败被吞（`queries.ts:22-34`），只退回 agent id |
| offline（WS down） | 顶部断线横幅，列表保留 | `Banner.tsx:15`；`Shell.tsx` 挂载 `Banner` | 横幅不区分「网关不可达」与「本机网络断」 |
| 未读/置顶/免打扰 | 本机 localStorage | `lib/prefs.ts:17` | 多设备不同步是已说明的限制（`Settings.tsx:25`） |
| 新建任务失败 | 当前用 `alert()` | `SessionList.tsx:165` | 浏览器原生弹窗，与其他错误样式不一致 |

### 3.6 Bot 聊天 `#/s/:id`

| 组合 | 目标显示（候选） | 现状证据 | 缺口 |
|---|---|---|---|
| 会话 pending（WS 未 ready） | 「连接中…」 | `Chat.tsx:157-159` | — |
| 会话 ready + 空转录 | 「还没有消息」 | `ui/Transcript.tsx:165` | — |
| 运行中 | 「正在回复…」副标题 + 忙碌条 | `Chat.tsx:143`；`Composer.tsx:44-48` | — |
| 已结束 | 输入框换成「会话已结束」 | `Chat.tsx:162-164` | — |
| 会话不存在 | 应在 404 时说明 | `useSession` 的 watch 失败只走 `end` 帧 | **无 404 文案**：`onEnd` 未接（`useSession.ts:118-125`），会停在「连接中…」 |
| forbidden（无 owner） | 「没有权限查看该会话」 | WS `end{reason:"forbidden"}`（`server.ts:409`）；Mux 只在 `reason==="error"` 重订（`stream.ts:197-201`） | 同 404：`Chat` 不消费 `onEnd`，显示停在「连接中…」，把 `forbidden` 误报成 `pending` |
| 发送失败 | 行内 `role=alert` | `Composer.tsx:34,77` | — |
| 中止失败 | 同上 | `:40` | — |
| Bot 会话用 `bots.send`（owner） | 远程无 owner 时按钮应不可用 | `Composer.tsx:24` 直接调用；`bots.*` 是 owner（`bot-methods.ts:17`） | 前端不预判 scope，失败才显示 forbidden |
| 导入会话（`import:` 前缀） | 只读横幅 + 无输入框 | `Chat.tsx:187-217`；`ImportView.tsx:33-39` | — |
| offline | 断线横幅；重连后按游标补齐 | `Banner.tsx`；`stream.ts:158-168,197-201` | `gap:true` 时重建，前端已有（`useSession.ts:84-96`） |

### 3.7 社交聊天 `#/c/:id`

| 组合 | 目标显示（候选） | 现状证据 | 缺口 |
|---|---|---|---|
| pending | 「正在加载会话…」 | `SocialChat.tsx:62-67` | — |
| 会话不存在（resolve 404） | 「会话不存在或无法访问」+ 回消息 | `:88-96` | 与「社交后端未接入」不可分（`http.ts:21`） |
| error | 「会话加载失败。」+ 重试 | `:68-87` | — |
| empty（无消息） | 「还没有消息」 | `:136` | — |
| DM 对方 Agent 离线 | 输入框提示「Agent 离线，消息会保留」 | `:148` | 发送仍可点，符合候选 |
| social no | 页面不强制登录；发送 401 显示错误 | `http.ts:20-27` | 无「先登录」引导；`resolve` 也可能 401 |
| 新消息到达 | 无实时更新，仅手动刷新 | `:43` TODO | 「消息不实时」是当前最大缺口之一 |
| 发送失败 | 行内 `role=alert` | `:172-176` | — |
| markRead 失败 | toast「标记已读失败」 | `:36-39` | — |
| 群聊 / notice | 群不显示对方在线标签；notice 不可输入 | `:118-122,140` | — |

### 3.8 通讯录 `#/contacts`（外壳侧栏）

注意：`#/contacts` 现在渲染的是**网关 Bot 列表** `ui/Contacts.tsx`（`Shell.tsx:22,43`），不是社交通讯录 `features/social/Contacts.tsx`（后者无生产入口，只有测试 import）。

| 组合 | 目标显示（候选） | 现状证据 | 缺口 |
|---|---|---|---|
| pending | 「加载中…」 | `ui/Contacts.tsx:15` | — |
| empty | 「没有常驻 Bot」 | `:16` | — |
| sessions error | 应显示失败 | 只有 `isLoading` 与 `data` 分支（`:15-16`） | **error 显示成空**：失败与「没有 Bot」同屏 |
| forbidden（非 owner） | 应说明「远程连接看不到 Bot」 | 网关已过滤（`session-methods.ts:63`），前端仍按空处理 | 同 error，无法区分 |
| 社交联系人 | 「联系人、群组与好友需要 identity.* 之类的联系人接口，契约暂未提供」 | `:28` | 社交通讯录实现存在但未接入路由；`features/social/Contacts.tsx` 的 `#/contacts` 语义待定 |
| 社交 devices / groups | 社交通讯录内 tabs（好友/Agent/设备） | `ContactList.tsx:14-18,129-155` | 若接入，需决定与网关「本机 Bot」的分区 |

### 3.9 工作列表与新建任务 `#/work`

| 组合 | 目标显示（候选） | 现状证据 | 缺口 |
|---|---|---|---|
| sessions pending | 「加载中…」 | `WorkList.tsx:220` | — |
| sessions error | 「会话加载失败，稍后自动重试。」 | `:221` | 无重试按钮 |
| 无 Bot | 「没有常驻 Bot」 | `:223` | — |
| 无任务 | 「还没有任务会话」 | `:252` | — |
| activity pending | 运行徽标缺席，按待命 | `:199-200` 用 `activity.data?.sessions` 建 map，缺省为空 | 「未知运行态」与「待命」不可分 |
| 已完成分组 | 默认收起，折叠持久化 | `lib/work.ts` 的 `FOLD_KEYS`/`defaultOpen`；`:170,196` | — |
| 新建任务 | `sessions.open({preset:"default", close:"manual"})` | `:206` | 协议参数只有 preset/close/parent（`golden/methods.json`），**没有节点/工作目录/首条消息**；远程创建不成立 |
| 新建失败 | `alert()` | `:210` | 与消息列表同问题 |
| forbidden | 远程连接只有 task 会话可见 | 网关过滤 `session-methods.ts:63` | 前端不解释；`bots.list` 失败静默 |
| offline | 断线横幅；运行态停在最后快照 | `Banner.tsx`；`activity` 2.5s 轮询 | 轮询失败与「没有运行中任务」不可分 |
| `#/console` 节点页 | 节点列表、当前节点、远程限制说明 | `ConsoleSwitcher.tsx:69-201` | 远程节点只 `window.open`，不做跨节点数据；`facts.node` 缺失导致添加节点失败（`api/nodes.ts:120-124`，见 README §4.5） |

### 3.10 我 / 设置（`#/me`）

两套「设置」并存，见 README §4.2。

| 组合 | 目标显示（候选） | 现状证据 | 缺口 |
|---|---|---|---|
| 主区社交 personal：social unknown | 「正在加载资料…」 | `Profile.tsx:233-238` | — |
| social error | 「加载资料失败：<原因>」+ 重试 | `:239-244` | — |
| social guest | 「登录或注册」+ 登录表单 | `:245-256` | — |
| social anonymous | 身份卡 + 「注册后可加好友」+ 登录表单 | `:305-314` | — |
| social human + agents pending | 「正在加载 Agent…」 | `:322-325` | — |
| + agents error | 「加载 Agent 失败」+ 重试 | `:326-329` | — |
| + agents empty | 「连接设备后，Agent 会出现在这里」 | `:353` | 对应 `unbound`，文案已区分于 error |
| 侧栏 `Settings`：facts pending | 「加载中…」 | `Settings.tsx:29` | — |
| facts error | 原始错误消息 | `:30` | 未包装成「网关不可达」 |
| 节点列表 | 本机恒在 + 远程地址 | `NodesSection.tsx:14-125` | 无「节点不可达」态；`nodes.ts` 只存地址与 active，不做健康检查 |
| 更新 | `update.status` 不存在时「当前网关没有提供更新方法」 | `api/update.ts:55`；`update-methods.ts:3` 空表 | 正确区分 `unsupported`；但 `state.state === "idle"` 的「检查并下载」按钮永远不可达（方法不存在） |
| 更新远程节点 | 「远程连接不能操作本机更新」 | `api/update.ts:54` | — |
| 退出登录 | 退出社交 / 退出网关是两个按钮 | `Profile.tsx:382`（社交）；`Settings.tsx:43-49`（网关） | 用户可能只退一边；是否需要联动待定 |
| 未登录社交但已登录网关 | `#/me` 显示社交登录，同时侧栏显示网关设置 | 现状 | 「我」同时代表两个账号，命名待定 |

### 3.11 通知 / PWA

| 组合 | 目标显示（候选） | 现状证据 | 缺口 |
|---|---|---|---|
| web shell | 不做系统通知 | `NotifyHost.tsx:8` 无注入直接 return | 无 Web Notification、无标题角标、无 toast 通知 |
| desktop shell（Tauri） | 原生通知，遵守免打扰 | `:8-26`（`plugin:notification|notify`） | 未请求权限；无点击跳转；`notification` 事件来自 `activity.watch` |
| 免打扰 mute | 不通知，仍计未读 | `lib/prefs.ts:62`；`NotifyHost.tsx:19` | 逻辑在，消费方仅桌面壳 |
| mobile shell（注入 "mobile"） | 候选：页面在后台时通知 | 壳注入白名单已支持 `"mobile"`（`capabilities/facts.ts:26-28`） | 无实现 |
| PWA 安装 | standalone、manifest 生效 | `public/manifest.webmanifest:5-7`；`index.html:8` | 只有 SVG 单图标（`sizes:"any"`），部分平台不接受 |
| SW 注册失败 | 不阻塞渲染，仅 console.warn | `pwa.ts:9-18` | 无用户可见提示（可接受） |
| 更新提示 | 有新版本时提示刷新 | `UpdateNotice.tsx:3-47` | 固定请求 `/console/version.json`（`:9`），本机根路径下 404 → 永不提示；`--scope` 之外的路径未参数化 |
| offline | 顶部断线横幅 | `Banner.tsx:15` | SW 不缓存 HTML，离线时整页不可用（设计如此） |

## 4. 维度覆盖检查（哪些页必须考虑哪几轴）

| 页面 | shell | gateway auth | social auth | 设备绑定 | 设备在线 | 节点可达 | 数据 |
|---|---|---|---|---|---|---|---|
| `#/u` `#/p` | 显示差异 | 仅影响可用的其他入口 | 必须 | 否 | 仅 Agent 在线 | 否 | 必须 |
| `#/g` | 否 | 否（public） | 必须 | 否 | 否 | 否 | 必须 |
| `#/get` | 否 | 否（public） | 必须（邀请码 401） | 否 | 否 | 否 | 必须 |
| `#/connect` | 否 | 否（public） | 必须 | 必须 | 必须 | 否 | 必须 |
| Login | 否 | 必须 | 否 | 否 | 否 | 否 | 否 |
| `#/` 消息列表 | 布局 | 必须 | 否（当前不合并社交会话） | 否 | 否 | 必须 | 必须 |
| `#/s` Bot 聊天 | 布局 | 必须 | 否 | 否 | 否 | 必须 | 必须 |
| `#/c` 社交聊天 | 布局 | 否（独立数据面） | 必须 | 否 | 必须 | 否 | 必须 |
| `#/contacts` | 布局 | 必须 | 待定（见 §3.8） | 待定 | 待定 | 必须 | 必须 |
| `#/work` `#/console` | 布局 | 必须 | 否 | 必须 | 必须 | 必须 | 必须 |
| `#/me` | 布局 | 必须 | 必须 | 必须（Agent 列表） | 必须 | 必须 | 必须 |
| 通知 / PWA | 必须 | 必须 | 否 | 否 | 否 | 必须 | 否 |

「待定」= 该轴在语义上应当参与，但当前页面没有实现对应分支，需产品决定（§6）。

## 5. 当前最明显的状态误报（全部有代码证据）

1. `forbidden` 与 `not_found` 在 Bot 聊天里显示成 `pending`：`useSession` 未接 `onEnd`（`lib/useSession.ts:118-125`），`Mux` 只在 `reason==="error"` 重订（`api/stream.ts:197-201`），于是 403 会话永久停在「连接中…」。
2. `error` 在通讯录显示成 `empty`：`ui/Contacts.tsx:15-16` 没有 `isError` 分支。
3. `unsupported` 在公开页显示成 `not_found`：`api/social/http.ts:21` 把任何 404 变成 `null`，网关未接入社交代理（`server.ts:246`）会被说成「资料不存在」。
4. `unknown` 与 `error` 在网关门控合并为一个屏幕：`App.tsx:40-45`。
5. `unknown` 与 `empty` 在导入会话列表合并：`queries.ts:80-88` 失败静默为空。
6. `unknown` 与 `empty` 在 activity 合并：`WorkList.tsx:199-200` 缺省按空 map。
7. `unknown` 与 `ok` 在节点列表合并：`api/nodes.ts` 只存地址，没有可达性状态；`NodesSection` 用常亮圆点（`NodesSection.tsx:49`）表达「节点」。

## 6. 待维护者决定（状态矩阵相关）

1. `App` 是否把 `gateway unknown` 与 `gateway error` 分成两屏（现在共用一行文案，无重试）。
2. `forbidden` / `not_found` / `unsupported` 是否统一成一个可区分的错误组件（当前各页各写文案，且多处误报）。
3. 社交 404 的语义：`http.ts` 是否允许调用方区分「后端未接入」与「实体不存在」。
4. `#/contacts` 的归属：网关 Bot 列表、社交通讯录，还是两者分区；`features/social/Contacts.tsx` 是否接入路由。
5. `#/me` 与侧栏 `Settings` 的分工，以及「退出登录」是否需要同时退网关与社交。
6. 设备绑定/在线在公开页与通讯录的可见范围（是否给非主人看设备在线）。
7. Web Notification、标题角标、页面内 toast 是否进入 0.3；`NotificationEv` 的消费方是否只限桌面壳。
8. `UpdateNotice` 的版本文件路径是否改为相对 `<base>`（当前硬编码 `/console/`）。
9. 新建任务是否需要远程节点/工作目录/首条消息，以及 `sessions.open` 是否为承载方法（涉及冻结的 gateway 方法，需走稳定性流程）。
