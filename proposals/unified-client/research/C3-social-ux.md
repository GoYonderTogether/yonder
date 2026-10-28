> 证据材料，结论已并入 [design.md](../design.md)

# Yonder 社交模式与工作台 Bot 主对话：交互设计调研

调研日期：2026-10-27。只读调研，未修改任何仓库。

**调研范围与判据**：Card 前端（已上线）/Users/zoran/Documents/yonder-card-consolidate/src；旧前端 AI-Being（bundle 克隆到 /tmp/aibeing-ref）、/Users/zoran/Documents/github/yonder-being、/Users/zoran/Documents/github/grok-bot-0.18-reconstructed；内核 /Users/zoran/Documents/yonder-harness；目标设计 proposals/unified-client/design.md。

---

## 1. 现状盘点：已上线的 Card 前端

### 1.1 路由与页面（真实代码，非文档）

| 路径 | 页面 | 位置 |
|---|---|---|
| `/login` | 邮箱当登录名 | src/App.tsx:37 → pages/Login.tsx |
| `/u/:id`、`/p/:accountId` | 公开名片页（两条兼容 URL） | src/App.tsx:38-39 → pages/CardPage.tsx |
| `/g/:token` | 群二维码落地页 | src/App.tsx:40 → pages/GroupJoin.tsx |
| `/get` | 安装引导 | src/App.tsx:41 → pages/Install.tsx |
| `/cards/:id?`、`/cards/:id/edit` | 旧路由重定向到 `/contacts?wallet=` | src/App.tsx:43-44 → Contacts.tsx `CardsRedirect` |
| `/friends/add` | 加好友（ID/链接/扫码） | src/App.tsx:45 → pages/AddFriend.tsx |
| `/contacts/:id?` | 通讯录（卡包 + 好友/Agent/设备） | src/App.tsx:46 → pages/Contacts.tsx |
| `/connect` | 设备授权三步向导 | src/App.tsx:47 → pages/Connect.tsx |
| `/me` | 我的资料 / 我的 Agent / 设备 / 设置 | src/App.tsx:48 → pages/Me.tsx |
| `/`（ChatShell 内）、`/c/:id` | 会话列表、单会话 | src/App.tsx:49-52 → pages/Chat.tsx |

全部页面 `lazy()`（src/App.tsx:9-20）。`Private` 只拦匿名用户进 `/cards*`，其余允许匿名浏览（src/App.tsx:26）——这是「访客零门槛」设计的直接体现，对应 docs/design-v5.md:9「匿名也能聊，注册后合并」。

### 1.2 真数据 vs mock（关键事实）

- 数据源开关只有一处：`export const api: ApiClient = import.meta.env.VITE_API === 'http' ? httpApi : mockApi`（src/api/index.ts:5）。**默认是 mock**，要 `VITE_API=http` 才连真后端。
- mock 是内存实现，刷新即重置：8 个 actor、2 台设备、6 张卡、4 个会话（src/api/mock.ts）。假回复：`send()` 对 dm/group 700ms 后自动 emit「（原型回复）收到。」（src/api/mock.ts:87-97）。假邀请码：固定 `'0123456789'`（src/api/mock.ts:203）。`markRead()` 是空实现（src/api/mock.ts:154）。
- 界面自己会声明这一点：非 http 模式顶部黄条「本地原型模式 · 展示数据仅供界面验收，不代表真实用户」（src/components/Shell.tsx:43）。
- **真数据能力后端已存在**：server/src/{app,auth,chat,hub,realtime,cards,devices,groups,profile,references,execution-relay}.ts + migrations 001-009 + 14 个测试文件；`vite.config.ts` 把 `/api`、`/ws` 代理到 `127.0.0.1:18030`。
- 结论：**名片、私信、群、设备、联系人在服务端已实现**，前端默认仍指向 mock；design.md §4.4 已要求合并时删除 mock 数据源。

### 1.3 逐页交互清单（已实现 / 缺失）

**会话列表（src/pages/Chat.tsx:59-102）**

已实现：
- 搜索只按 `c.title.includes(q)` 过滤（Chat.tsx:59）；空态「没有匹配的会话。」；加载骨架 4 行；错误行「同步失败，仍显示已有会话。」+ 重试（Chat.tsx:75）。
- 行整块是 `<Link>`，`hover:bg-tone/60`，`press` 类按下缩放（Chat.tsx:87-102；`.press:active{transform:scale(0.97)}` 见 src/styles.css:132-133）。
- dm 显示对方头像（Agent 带在线圆点），group 用 Users 图标，notice 用 Bell 图标；Agent 名字后 `<AiBadge/>`；右侧 `HH:mm` 时间；第二行预览（text/markdown 去符号、interactive 取 title、image→[图片]、file→[文件]）。
- 未读徽标 `bg-accent` 数字（Chat.tsx:99-101）。
- 顶部设备行「<设备名> 上 N 个 Agent 在线」，无在线设备显示灰点「设备离线」（src/components/chat/DeviceRow.tsx）。

缺失（逐项）：
- **无置顶、无免打扰、无标为已读、无删除/隐藏会话、无未读 99+ 截断**。
- **无 hover 操作区、无右键菜单、无长按菜单**（见 §1.4 硬证据）。
- 无「草稿中」标记、无 typing 提示、无 @我 标记。

**单会话（src/pages/Chat.tsx:113-250）**

已实现：
- `api.markRead(id, seq)` 在消息变化后自动调用（Chat.tsx:119-122）。
- 详情面板由 URL `?detail=1` 控制，桌面右侧抽屉、手机整页（src/components/chat/ChatDetail.tsx:24-40）。
- 标题栏：Avatar(32) + AiBadge + 「在线/离线」（Chat.tsx:152），右上 `Ellipsis` 开详情（notice 会话不显示，Chat.tsx:155）。
- 消息列 `max-w-[720px]` 居中、`gap-0.5`、按 senderId 变化算 first/last 决定圆角收口（Chat.tsx:161-165、189）。
- Agent 离线时 toast「Agent 离线，消息会保留，上线后收到」（Chat.tsx:142）；匿名第 3 条后一次性 AnonHint（Chat.tsx:168）。
- 气泡：自己 `flex-row-reverse` + `bg-accent text-on-accent`，对方 `bg-tone`，`max-w-[80%]`，`rounded-bubble px-3.5 py-2 text-[15px]`；群聊首条显示发送者名 +「· Agent」；对方头像只在末条显示且可点进联系人（Chat.tsx:186-215）。
- 五种内容：text / markdown / image / file / interactive（interactive 渲染成 `<Link to={c.link ?? '#'}>` 胶囊按钮）。
- 输入框：自适应高度上限 160px、Enter 发送、Shift+Enter 换行、`isComposing` 保护中文输入（Chat.tsx:241）、`pending` ref 防重复、发送中 readOnly。

缺失：
- **气泡无长按/右键菜单，无复制、引用、转发、收藏、删除**。
- **无发送状态（sending/sent/delivered/read/failed）、无时间戳、无已读回执**。
- interactive 的 `state: 'pending' | 'done'` 字段存在（src/api/types.ts）但**没有渲染**，也没有回调。
- 输入框**无附件、无 @、无斜杠命令、无语音、无停止生成**。
- 详情面板**无免打扰开关、无置顶、无清空记录、无举报/拉黑**；「添加成员」只 `toast('即将推出')`（ChatDetail.tsx:113）。

**通讯录（src/pages/Contacts.tsx + components/wallet/ContactList.tsx）**

已实现：卡包条 + 好友/Agent/设备三段（`?tab=`）；搜索存 URL `?q=`；拼音首字母分组用 `Intl.Collator('zh-Hans-u-co-pinyin')`（ContactList.tsx:19-32）；「新的朋友」toast「即将推出」（ContactList.tsx:66）；设备行右侧联网 `Switch`，`stopPropagation` 防误触行（ContactList.tsx:116）。
- **唯一的键盘可达封装**：无 `to` 时用 `role="button" tabIndex={0}` + Enter/Space（ContactList.tsx:54）。这是全仓仅有的一处键盘处理。
- 缺失：列表项无右键/长按菜单（置顶、免打扰、删除、备注、标为已读都没有）；无滑动操作。

**名片页 / 加好友 / 连接设备 / 我**

- 名片页：「开始聊天」一步完成（无卡 `start(actor.id)`，有卡 `startFromCard(card.id, source)`，必要时先 `createAnonymous()` 再 nav），匿名点「加好友」toast「注册后可加好友，聊天无需注册」（src/pages/CardPage.tsx:42-55）。**无长按、无右键菜单**（微信场景下「长按识别/长按保存」是主路径，这里没有）。
- 加好友：ID/链接解析 + `BarcodeDetector` + `getUserMedia` 每 250ms 轮询扫码，不支持时 toast「当前浏览器不支持扫一扫，请用系统相机或粘贴链接」（src/pages/AddFriend.tsx:28-49）。**无震动、无长按识别、无相册选图**。
- 连接设备：三步向导 + 10 分钟倒计时圆环（`role="timer"`）+ 3s 轮询检测新设备（src/pages/Connect.tsx:28-103）。
- 我：设置里只有「账号昵称」「退出登录」（src/pages/Me.tsx:52-63）。**无通知设置、无免打扰、无主题、无快捷键**。

### 1.4 交互原语的硬证据

```
grep -rn "onContextMenu\|vibrate\|Notification\|onPointerDown\|onTouchStart\|useLongPress\|navigator.share\|longpress" src/
→ 0 命中
```

即：**整个 Card 前端没有右键菜单、没有长按、没有震动、没有通知 API、没有任何指针手势**。现有的「交互」只有：`<Link>` 导航、`onClick`、`hover:` 类、`.press:active` 缩放、`Toast` 单条提示（src/ui/Toast.tsx:17-18，`aria-live="polite"`）。

设计令牌已为气泡准备好：`--radius-bubble: 16px`、`--radius-bubble-tight: 6px`、`--radius-control: 10px`、`--radius-card: 16px`（src/styles.css:89-92）。

依赖里**没有** react-aria、framer-motion、vaul、sonner、i18n 库；有 `radix-ui` ^1.8.1（聚合包）、`lucide-react` ^1.61.0、`@tanstack/react-query` ^5.104.5、`nanostores` ^1.5.5（src/package.json）。

---

## 2. 旧前端参考：工作台版 Bot 主对话

### 2.1 yonder-being（最近的工作台实现，`packages/harness-ui`）

**渠道图标与来源信息**：`packages/harness-ui/src/conversation/chat/ChannelBadge.tsx`（45 行）。
- `labelFor(channel)`：feishu→「飞书」、wechat→「微信」、mcp/agent→「外部 AI」、其余原样；`kindFor(conversationKind)`：group→群聊、direct→私聊、local→本地对话；图标 wechat→`MessageCircle`、mcp/agent→`Bot`、其余→`MessageSquareText`。
- `delivery.status`：sent→已发送、silent→未发送、failed→发送失败、unknown→状态未记录、其余「等待投递结果」。
- 展开面板（`<details>`+`<summary>`，键盘可聚焦）显示「消息来源 / 回复去向」、`渠道 · 会话类型 · 会话名或 id`、`连接：connectionId`、`发送者 / 发送者 ID`、`平台消息 ID`、失败原因。面板 CSS：`z-index:4`（注释说明高于相邻消息、低于 sticky composer 的 7）、`max-width:min(320px,85vw)`、`background:var(--dsw-specific-menu)`。
- 辅助：`channel-source.ts` 的 `channelSource(value: unknown)` 做运行时校验。

**气泡布局**：`MessageItem.tsx:181-210` 的 `UserStyleBubble` = 右对齐竖列，顺序为 `ChannelBadge`（在气泡**外**、最上方）→ 图片 → 气泡 → 操作行。`MessageItem.module.css:17-27`：`border-radius:22px; padding:10px 16px; font-size:16px; line-height:24px`，容器 `max-width:min(525px,82%)`（注释：44px 单行气泡 = 24 行高 + 上下各 10）。
- `projectUserText()`（:159-178）把 `/skill`、`@subagent` 渲染成 `refChip`，注释明确「日志里的模型文本仍是唯一真相，这里只是展示」。

**消息元数据**：`MessageIconActions.tsx` 在气泡下方一行：复制（成功 1 秒换 check，`copyPending` 防连点）、可选分支、时钟（同日 HH:mm / 同年带日期 / 跨年带年月日）、`· Ran for 15s`、`· TTFT 1.2s`、`· 34 tok/s`、插件 `extraActions` 插槽。纯函数在 `message-chrome.ts`（96 行）。

**滚动跟随**：`use-scroll-follow.ts` 文件头注释说明「照搬自 DeepSeek Harness `ui-chat/src/client/chat/use-scroll-follow.ts`（MIT，commit 4878cdabd8）」，是独立的底部跟随意图 + 原生滚动，不含分页与 DOM 观察者。

可复用判断（推断）：气泡结构与「渠道徽标在气泡外」这一层级关系可直接搬；`--dsw-*` 令牌需映射到 Card 的 `--tone/--accent/--radius-bubble`。

### 2.2 AI-Being（旧版，交互最完整）

**长按/右键/键盘三入口同一份 actions**：`web/src/hooks.ts:41-61` `useLongPress(onLong)` —— 触屏 **450ms 未移动（>8px 取消）** 触发，触发时 `navigator.vibrate?.(8)`；`onContextMenu` 在非 `coarsePointer()` 时走同一回调；`onClickCapture` 在长按已触发时 `preventDefault + stopPropagation`，防止误点击进入会话。

**消息菜单**：`web/src/features/chat/Chat.tsx:78-100`，注释写明「触屏长按 450ms、桌面右键、键盘 Shift+F10 或菜单键。只放真能用的操作」。菜单项按条件构建：复制（有正文才加）、引用回复（非只读、text 类型、非 streaming、非 failed）、保存（恰好 1 个附件）、详情。防重入：`getState().overlays.some(o => o.type === 'messageMenu')`。

**消息状态**：`STATUS_LABEL`（Chat.tsx:47）= `{sending:'发送中', sent:'已发送', delivered:'已送达', read:'已读', failed:'发送失败，点击重试'}`；`StatusMark`（:49-56）用 clock/check/checks 图标 + `sr-only` 文案，failed 交给气泡自己处理重试。

**引用条**：`ReplyChip`（Chat.tsx:61-77），注释「Being 的每条回复都在信封里指向它回应的消息；紧挨着的就不再画引用条（同微信只显示刻意的引用）」；可点跳转，`aria-label` 完整。

**会话行**：`web/src/features/chat/Cards.tsx:46-51` 长按弹 `{type:'actions', anchor:{x,y}, title, actions}`；`rowActions()` = 置顶/取消置顶、免打扰/取消免打扰、有未读时「标为已读」。行内：免打扰显示 `bellOff` 图标 + `aria-label="免打扰"`；未读时**免打扰显示小圆点**（`aria-label="{n} 条未读（免打扰）"`），非免打扰显示数字徽标、>99 显示 `99+`（Cards.tsx:76-79）。`App.tsx:37` 注释「底部角标：聊天未读（不含免打扰）」——**免打扰只影响徽标形态与计数汇总，不影响消息接收**。

### 2.3 grok-bot 0.18（桌面 Bot 产品的做法）

- 消息操作是**悬浮工具栏**而不是长按菜单：`frontend/src/recovered/features/conversation/cards/transcript-card/message-actions.tsx` 的 `TranscriptCardActionAnchor` 在气泡旁渲染 `role="toolbar"`（反应、回复、`dots-3-horizontal` 更多）；**右键打开同一个菜单**（`onContextMenu` → `setMenuOpen(true)`），并排除链接/图片/输入框/有文本选区的目标（`isMessageContextTargetExcluded`）。
- 菜单关闭时 `Escape` 关闭并把焦点还给原来的按钮（`armTranscriptActionFocus` / `restoreTranscriptActionFocus`）。
- 会话行状态是纯函数投影：`sidebar-agent-status.ts` 的 `projectSidebarAgentStatus()` → `marker: 'blocked' | 'unread' | null`，标签 `'Needs attention' | 'Unread activity'`，`isWorking`，角标 `corner: 'marker' | 'ring' | 'running'`；展开行显示尾部标记，折叠/置顶行显示头像角点（10px/8px）。
- 行交互：单击打开、`metaKey/ctrlKey` 多选、`shiftKey` 区间选、**双击重命名**（`sidebar.tsx:250-266`）；行尾 kebab 菜单（置顶、标未读、隐藏、移动分组、复制会话 ID、删除）。
- 输入框：附件按钮 + 拖拽/粘贴文件 + 语音听写 + 录音芯片（含计时与波形）+ `Escape` 取消语音或失焦 + 发送键在有内容时从麦克风切成箭头（`composer.tsx:176-217`）。

### 2.4 渠道图标许可的既有约束（重要）

docs/HANDOFF.md:82 已明确：「图标许可尚未完整核实，先用『飞书/微信/CLI/MCP』等文字加项目已有许可可追踪的中性图标，或纯文字。不能从网站/CDN 拿 logo 便认定获商标许可」。**推断**：ChannelBadge 若迁入 Yonder，应保留「文字 + lucide 中性图标」策略，不引入第三方品牌 logo 资源。

---

## 3. 关键用户流程对标（微信 / 飞书 / Grok Bot）

### 3.1 会话列表

| 能力 | 微信 | 飞书 | Grok Bot | Card 现状 | Yonder 最小集合 |
|---|---|---|---|---|---|
| 置顶 | 有 | 有 | 有（`isPinned`） | 无 | **做** |
| 未读数字 | 有（>99 显示…） | 有 | 有（数字/点） | 有（无截断） | **做**（补 99+） |
| 免打扰标记 | 有（静音图标） | 有 | 无（用 blocked/unread） | 无 | **做**（图标 + 点状未读） |
| 折叠该群/分组 | 有（折叠的群聊） | 有分组 | 有 section | 无 | **可延后** |
| 仅 @ 提醒 | 有（群内 @ 我） | 有（消息免打扰细分） | — | 无 | **做**（三级） |
| 标为已读 | 有（右键/长按） | 有 | 有 | 无 | **做** |
| 删除/隐藏会话 | 有 | 有 | 有（hide） | 无 | **可延后** |

微信/飞书的具体菜单文案与分级细节**没有官方文档可引**——Card 仓自己的调研文档也记录了同一结论：docs/card-design-research.md:48「微信（只有第三方转述，无官方文档）」，:319「微信 官方文档（只有第三方教程）」。因此上表中微信/飞书列属**产品观察（未核实官方文档）**；Grok Bot 列有代码出处（§2.3）。

### 3.2 进入对话 / 发消息 / 消息状态

- 进入对话：微信整页推入、桌面右栏；Card 已是这个模型（桌面列表+主区，手机整页；src/lib/useDesktop.ts 用 `matchMedia('(min-width: 1024px)')` 切换）。**不需要改**。
- 发消息：Enter 发送 / Shift+Enter 换行 / 中文 `isComposing` 保护（Chat.tsx:241）——已达标，且 Card 做得比多数产品细。
- 消息状态：Card 完全没有。最小集合 = AI-Being 的五态（sending/sent/delivered/read/failed）+ 失败可点重试（Chat.tsx 的 `StatusMark` 可整体移植）。**内核侧已有对应数据**：`Delivery{ok, retryable?, uncertain?, id?, error?}`（packages/sdk/src/types.ts，`Delivery` 定义）与 `message.out` 事件（`MessageOutData.delivery`），映射关系已被 ChannelBadge 实现过一遍（§2.1）。**推断**：`uncertain` 应显示为「状态未知」，不要显示「失败」，否则用户会重复发送。

### 3.3 长按 / 右键菜单项

| 对象 | 微信 | 飞书 | AI-Being（可抄） | Yonder 最小 |
|---|---|---|---|---|
| 会话项 | 置顶、免打扰、标为已读、删除 | 置顶、免打扰、标为已读、移出 | 置顶、免打扰、标为已读 | 置顶、免打扰、标为已读 |
| 消息气泡 | 复制、转发、收藏、引用、删除、多选 | 复制、回复、转发、加急 | 复制、引用回复、保存、详情 | 复制、引用回复、详情 |
| 头像 | 查看资料 | 查看资料 | 点进资料页 | 点进资料页（已有 Link） |
| 名片 | 发送给朋友、保存图片 | 分享 | — | 分享链接（已有 `copyText`） |

### 3.4 通知与免打扰分级

建议的三级（对齐飞书的粗粒度模型，且与 AI-Being 的 `notificationLevel` 同构）：

1. `all` — 全部消息提醒（默认）。
2. `mention` — 仅 @我 / 仅审批与提问卡提醒。**依据**：内核入站事件已带 `mentioned: boolean`（plugins/channel-card/src/channel.ts:310、:333-346；`MessageInData.mentioned` 在 packages/sdk/src/types.ts），不需要新字段。
3. `mute` — 接收但不提醒（未读只累积成小圆点，同 AI-Being Cards.tsx:76-77）。

**先不做**：折叠该群、关键词提醒、分时段免打扰、按渠道单独设级别。

---

## 4. 交互打通：组件 × 输入方式矩阵

### 4.1 矩阵

图例：● 已有 / ○ 需新增 / — 不适用。

| 组件 | 左键/单击 | 悬浮 | 右键菜单 | 移动端长按 + vibrate | 键盘 |
|---|---|---|---|---|---|
| 会话项 | ● `<Link>`（Chat.tsx:87） | ○ hover 操作区（置顶/免打扰按钮） | ○ 置顶/免打扰/标已读 | ○ 同一 actions 数组 | ○ ↑↓ 移动、Enter 打开、`Shift+F10`/菜单键 |
| 消息气泡 | ● 无（正文可选文本） | ○ 复制/引用/更多（grok-bot 悬浮栏） | ○ 复制/引用/详情 | ○ 长按 450ms + `vibrate(8)` | ○ `Shift+F10`、`Escape` 关菜单并还焦点 |
| 头像 | ● `<Link to={/contacts/…}>`（Chat.tsx:192） | ○ 名片卡（HoverCard） | ○ 查看资料 | ○ 长按看名片 | ○ Tab + Enter |
| 名片（CardFace） | ● 打开层（PlusWindows/CardFullscreen） | ○ — | ○ 分享/复制链接/保存图片 | ○ **长按保存图片**（微信主路径） | ○ Esc 关闭 |
| 输入框 | ● Enter 发送、Shift+Enter 换行 | — | ○ 粘贴文件 | ○ 长按粘贴 | ○ Esc 失焦/取消语音 |
| 附件 | ○ 按钮 + 拖拽 + 粘贴（grok-bot composer.tsx:120-174） | — | — | ○ 相册 | ○ Tab 到按钮 |
| 会话详情抽屉 | ● `?detail=1` | — | — | ○ 侧滑返回 | ○ Esc 关闭 |
| 通知开关 | ○ Switch（复用 DeviceSheet 的 `role="switch"`，src/components/wallet/DeviceSheet.tsx:15） | — | — | — | ○ Space 切换 |
| 列表项（通讯录） | ● Link / `role=button`+Enter（ContactList.tsx:45-55） | ○ | ○ 备注/删除 | ○ | ● 部分 |

### 4.2 封装建议（三个 hook，一份 actions 数组）

```
apps/app/src/shell/interaction/
  usePress.ts        // 按下缩放 + 键盘 Enter/Space 等价点击 + 焦点环
  useContextMenu.ts  // 右键 + Shift+F10/ContextMenu 键，锚点 {x,y}，Esc 关闭并还焦点
  useLongPress.ts    // 触屏 450ms/8px 阈值 + navigator.vibrate(8) + 长按后吞掉 click
  actions.ts         // ActionItem{label, icon, onSelect, disabled, destructive}
```

**直接抄 AI-Being `web/src/hooks.ts:41-61`**（已验证可用：450ms、8px、vibrate(8)、clickCapture 防误触、`coarsePointer()` 判定）。三个入口共用同一个 `ActionItem[]`，这样菜单项不会分叉——这是 AI-Being 与 grok-bot 两套实现共同的正确做法（Chat.tsx:78-100 注释「只放真能用的操作」；message-actions.tsx 的 toolbar 与 contextmenu 共用一个 `setMenuOpen`）。

### 4.3 可用的现成库（版本与许可证，均为本次 `npm view` 实测）

| 包 | 版本 | 许可证 | 用途 | 建议 |
|---|---|---|---|---|
| react-aria | 3.53.1 | Apache-2.0 | `usePress`/`useLongPress`/`useContextMenu` 全套无障碍原语 | **可选**；体量大，需整包引入 hooks 层 |
| @react-aria/interactions | 3.28.1 | Apache-2.0 | 只要交互原语时的子包 | 若不自写，选这个 |
| @use-gesture/react | 10.3.1 | MIT | 手势（长按、拖拽、滑动） | 不必要 |
| vaul | 1.1.2 | MIT | 移动端底部抽屉（长按菜单可做成 sheet） | 可延后 |
| @radix-ui/react-context-menu | 2.4.1 | MIT | 现成的右键菜单（含键盘、焦点管理） | **推荐**（仓里已有 `radix-ui` ^1.8.1） |
| @tauri-apps/plugin-notification | 2.7.0 | MIT OR Apache-2.0 | 桌面通知 | 阶段 6 |
| @tauri-apps/api | 2.12.4 | Apache-2.0 OR MIT | Tauri 前端 API | 阶段 6 |
| web-push | 3.6.7 | MPL-2.0 | 服务端 VAPID 推送 | 见 §5 注意 |

**推断**：Card 仓已有 `radix-ui` 聚合包，右键菜单用 `@radix-ui/react-context-menu`（同一生态、零新概念）比自己写更省；长按仍必须自己写（Radix 没有长按原语），直接移植 AI-Being 的 20 行。

---

## 5. 最简通知系统

### 5.1 三个投递面与限制（已核实的官方来源）

| 面 | 机制 | 限制 | 出处 |
|---|---|---|---|
| 网页 | Notification API + Service Worker `showNotification` | 需 `Notification.permission === 'granted'`；页面关闭后必须由 SW 显示 | https://developer.mozilla.org/en-US/docs/Web/API/Notification （HTTP 200） |
| 网页（后台） | Web Push + VAPID（RFC 8292） | 需 HTTPS/`isSecureContext`、`PushManager`、推送服务 | https://www.rfc-editor.org/rfc/rfc8292 （HTTP 200） |
| iOS PWA | Web Push | **仅 iOS/iPadOS 16.4+ 且已「添加到主屏幕」**；同期带来 Badging API | https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/ （HTTP 200，原文「With iOS and iPadOS 16.4 beta 1 comes support for Web Push for Home Screen web apps, Badging API, Manifest ID」） |
| 桌面（Tauri 2） | `tauri-plugin-notification` | 需系统授权；Windows 需 AppUserModelID | https://v2.tauri.app/plugin/notification/ （HTTP 200） |

`web-push` 是 **MPL-2.0**（文件级 copyleft）。**推断**：如果 Yonder 只自用、不分发修改后的 `web-push` 源码，MPL-2.0 不传染；若要闭源分发服务端，需评估是否愿意接受该许可证，或改用其他实现。

### 5.2 通知源：内核已经有的东西

| 事件/数据 | 位置 | 能否直接做通知源 |
|---|---|---|
| `message.in`（渠道入站，带 `mentioned`/`msgId`/`createdAt`/`replyTo`） | packages/sdk/src/types.ts `MessageInData`；发出点 plugins/channel-card/src/channel.ts:333-348 | **是**（社交模式主源） |
| `run.end`（`status: done\|error\|aborted\|limit`、`replied`、usage） | packages/sdk/src/types.ts `RunEndData` | **是**（Bot 模式「跑完了」） |
| `yonder.notification` 记录 + `sessions.notify` 控制方法 | packages/core/src/runtime/notifications.ts:11-31；packages/cli/src/index.ts:736-741 | **是**（插件/子任务向主人说话的正规通道） |
| `runtime.warning` | packages/core/src/kernel/background.ts:53-62 | 是（低优先） |
| `SessionUpdate.type: 'notification' \| 'end' \| 'error'` | packages/sdk/src/types.ts `SessionUpdate` | 是（实时流上的帧类型） |
| 状态快照 `StatusSnapshot{active, agents}` | packages/core/src/status/snapshot.ts:10-24 | 否（只做角标，不做通知） |

**重要缺口（已核实）**：
- **不存在 `session.settled` 事件**。`grep -rn "session.settled" packages/` 只命中 `recovery.settled-failed`（packages/core/src/signals/codes.ts:13）和内部 `settledRun`，不是事件类型。design.md §1.2 把它列为「建议新增」，与代码一致。
- 实际存在的事件类型（`grep 'type: "[a-z._-]*"'` 统计）：`message.in`、`message.out`、`message.attempt`、`message.unknown`、`run.end`、`session.input`、`session.open`、`session.close`、`config.reload`、`runtime.tool-result`、`runtime.warning`、`memory.captured`、`channel.command.result`、`release.update-result`。
- **内核没有 unread 概念**：`SessionInfo` 只有 `{id, agent, profile, mode, key, parent, version, opened, closed}`（packages/sdk/src/types.ts），`grep -rn "unread" packages plugins` 无命中（只有无关注释）。**推断**：Bot 模式的未读必须在客户端用「lastReadEventId」派生，或新增节点事实。

### 5.3 最小架构

```
节点（内核）
  events: message.in / run.end / yonder.notification
        │
        ▼
  NotificationPolicy（纯函数，packages/core/src/notify/policy.ts）
    decide(event, sessionMeta, prefs) -> { level: 'all'|'mention'|'mute',
                                           title, body, tag, url, badge, silent }
        │
        ├─ WS 帧 { type:'notify', ... }  → 前台页面（应用内 toast / badge）
        └─ 投递适配器（按 surface 选一个）
              desktop : Tauri notification plugin
              web     : 无（前台 toast）；后台靠 SW
              mobile  : 云中转 → Web Push（阶段 5）
```

**免打扰在哪层过滤**：分两处，各管一件事。

1. **节点侧（权威）**：`NotificationPolicy` 读取会话级 `notificationLevel`，`mute` 直接不产生投递，`mention` 且 `message.in.mentioned === false` 也不产生。好处是省流量、省电、省打扰；且移动端（阶段 5）经云中转时策略只有一份。
2. **客户端侧（兜底）**：页面可见且 `document.hasFocus()` 且当前会话就是该会话时，不再弹系统通知（AI-Being 的 `isReading(active, conversation, visible, focused)` 就是这个纯函数，见 /tmp/aibeing-ref/src/notification-policy.ts:6-8）。这一层必须在客户端，因为只有客户端知道「用户正在看这一条」。

### 5.4 数据结构（最小）

```ts
// 偏好：会话级 + 全局默认。放客户端本地（IndexedDB），随账号切换。
type NotifyLevel = 'all' | 'mention' | 'mute'
interface NotifyPrefs {
  defaultLevel: NotifyLevel            // 全局默认 = 'all'
  perConversation: Record<string, NotifyLevel>   // convId / sessionId → 级别
  quietHours?: { from: string; to: string }      // 可延后
}

// 一条通知（节点产出，三面共用；字段与 AI-Being 推送载荷同构）
interface NotifyPayload {
  id: string                  // 幂等键 = 事件 id
  level: NotifyLevel
  kind: 'message' | 'run-end' | 'approval' | 'warning'
  title: string               // 「管家」「张三」
  body: string                // 正文摘要，最多 ~120 字
  tag: string                 // 同会话折叠：`conv:<id>` 或 `sess:<id>`
  url: string                 // 只允许同源、只允许应用内路由（防开放跳转）
  badge: number               // 未读数（不含 mute）
  silent: boolean             // level==='mute' 时 true
}
```

`url` 白名单校验必须做：AI-Being 的 `target()` 只接受同源且路径匹配 `^\/chats(?:\/|$)`，否则回退首页（/tmp/aibeing-ref/web/src/lib/sw-push.ts:14-17）。这是防开放跳转的最小实现，值得照抄并改成 `^\/(c|bot)(\/|$)`。

### 5.5 关键实现要点（都有现成参考）

- **SW 与页面分离**：AI-Being 把 SW 单独打包成 `/sw.js`（/tmp/aibeing-ref/web/src/sw.ts:1-2 注释「构建时由 vite.config.ts 单独打包」），API 与事件流不经 SW。Yonder 的网关是 `/api/rpc/*` + `/api/stream`，同样应排除。
- **订阅与账号绑定**：`GET /push/key` 拿公钥 → `pushManager.subscribe({userVisibleOnly:true, applicationServerKey})` → `POST /push/subscribe`；切账号前必须 `unsubscribe()` 并关闭已显示通知，否则旧账号的通知会继续落到这台设备（/tmp/aibeing-ref/web/src/lib/push.ts:24-31、:40-41）。
- **角标**：`navigator.setAppBadge(count)`，与列表计数同源（AI-Being sw-push.ts:32-34）。
- **应用内通知**：不新造体系，复用现有 Toast（src/ui/Toast.tsx）即可；系统通知只在页面不可见时发。

---

## 6. 结论：最小实现方案

### 6.1 必须（阶段 1–4 内做完，能撑起「类微信/飞书」的体感）

| # | 项 | 落点 | 依据 |
|---|---|---|---|
| 1 | **三个交互原语**：`usePress` / `useContextMenu` / `useLongPress`（450ms + `vibrate(8)` + 长按后吞 click） | `apps/app/src/shell/interaction/` | AI-Being hooks.ts:41-61 已验证；Card 现在 0 命中 |
| 2 | **会话项菜单**：置顶、免打扰、标为已读（三入口同一 actions 数组） | Chat 列表 ConvRow | AI-Being Cards.tsx:46-51；Grok Bot sidebar.tsx:294 |
| 3 | **未读徽标形态**：非免打扰=数字（>99 显示 99+），免打扰=小圆点 | ConvRow | AI-Being Cards.tsx:76-79 |
| 4 | **消息气泡菜单**：复制、引用回复、详情 | Chat 气泡 | AI-Being Chat.tsx:78-100；grok-bot message-actions.tsx |
| 5 | **消息状态**：sending/sent/delivered/read/failed + 失败点击重试 | 气泡下方 `StatusMark` | AI-Being Chat.tsx:47-56；数据来自 `Delivery`/`message.out` |
| 6 | **引用条**：有 `replyTo` 且非紧邻时显示，可点击跳转 | 气泡上方 | AI-Being Chat.tsx:61-77 |
| 7 | **渠道徽标**：文字 + lucide 中性图标，气泡外右上，展开看来源/投递状态 | Bot 主对话气泡 | yonder-being ChannelBadge.tsx；**不使用品牌 logo**（HANDOFF.md:82） |
| 8 | **通知三级**：all / mention（用 `mentioned` 字段）/ mute | 节点 `NotificationPolicy` + 客户端 `isReading` 兜底 | channel-card channel.ts:333-346；notification-policy.ts:2-8 |
| 9 | **网页通知**：`Notification.requestPermission` + SW `showNotification` + `setAppBadge` | apps/app | MDN；iOS 16.4+ 需添加到主屏幕 |
| 10 | **键盘可达**：Tab 顺序、Enter/Space、`Shift+F10`/ContextMenu 键、`Escape` 关菜单并还焦点 | 全部菜单 | grok-bot message-actions.tsx 的焦点恢复；Card 仅 ContactList.tsx:54 一处 |
| 11 | **删掉 mock 数据源** | src/api/index.ts:5 | design.md §4.4 阶段 4 验收 `grep -rn "mockApi" apps/app` 为空 |

### 6.2 可延后（有明确触发条件再做）

| 项 | 延后理由 | 触发条件 |
|---|---|---|
| 桌面系统通知（Tauri plugin） | 阶段 6 才引入桌面壳；v2.7.0 已有 | 桌面壳 spike 通过 |
| Web Push / VAPID 全链路 | 需要云侧 `web-push`（MPL-2.0）+ 订阅表 + 设备密钥 | 移动端 PWA 上线（阶段 5 远程控制之后） |
| 折叠该群 / 分组 | 现在会话总数很少（mock 4 个），分组是空收益 | 单用户会话 > 20 |
| 附件（按钮 + 拖拽 + 粘贴） | 社交侧后端 `MessageContent` 已有 image/file 类型，前端没有入口 | 有真实用户传图需求 |
| 语音输入 / 听写 | grok-bot 的实现依赖转录服务 | 有转录后端 |
| 引用转发、收藏、多选 | 依赖收藏模型 | 不做也不影响主流程 |
| 消息编辑 / 撤回 | 与 seq 模型、投递状态冲突 | 明确需求 |
| 震动强度/自定义 | `vibrate(8)` 一个常量够用 | 用户反馈 |
| 分时段免打扰、关键词提醒 | 三级已经覆盖 95% 场景 | 用户反馈 |
| 长按保存名片图 | 微信场景真实存在，但需要先有分享图渲染 | 名片分享图进 apps/app |

### 6.3 三个需要现在就定的实现细节（推断，供决策）

1. **Bot 会话的未读从哪来**：内核 `SessionInfo` 没有 unread。最省的做法是客户端存 `lastReadEventId`，用 `events.query({after})` 的条数当未读；不要为此改内核契约。
2. **社交未读与 Bot 未读是否合并计数**：Card 的 `Conversation.unread` 是服务端 seq 差值，Bot 侧是客户端派生。**建议**顶栏/托盘只显示一个总数，但两个来源分别计算、分别上报给 `activity.summary`，否则合并会变成两套真相。
3. **免打扰存哪**：社交会话的免打扰只有客户端知道（Card server 无此字段，`Conversation` 类型里没有 mute）；Bot 会话的免打扰最好也在客户端。**结论**：统一放客户端 IndexedDB，节点只在推送时读一份缓存；不要为它加服务端迁移。