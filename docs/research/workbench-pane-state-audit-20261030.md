# 工作区面板状态审计（2026-10-30）

## 判断与边界

当前实现有真实的互相覆盖和恢复路径缺口，不适合继续叠加条件修补。建议保留现有会话、设备、卡片和请求能力，统一收敛“要看什么”和“当前能容纳什么”的状态，先修状态转换，再按断点渲染。本文只读产品源码，没有修改产品或设计规范；真实浏览器验收由并行负责人单独记录。以下标“源码推断”的现象需在真实浏览器复现，不能称为用户已验收。

已执行 `npx vitest run apps/app/test/layoutMode.test.ts apps/app/test/railContent.test.ts apps/app/test/workEntry.test.tsx apps/app/test/layout.test.ts apps/app/test/workRoutes.test.ts`：5 文件、51 项通过，0 失败、0 跳过。它验证现有纯函数和设备入口，并不覆盖完整 WorkShell 状态转换、真实视图网络/浏览器布局。分组统计是该次原始结果。

## 当前状态从哪里来

- `WorkShell.tsx:28-30,40-45,57-92`：`paneChoices`（auto/list/content/rail）和手机 `phoneRailChoices` 是模块内 Map，键为 `node.id:session`；`leftOpen`、`manualRail` 为组件状态；`railPref.open` 是全局 localStorage。它们不是同一个状态机。
- 同文件 50–56：`hasRail` 来自活动会话及异步数据；`railContent.ts:68-100` 将尚未返回、失败和确认空视图都按 false 处理，附件只查最近 50 条转录。既有异步状态不等于已证实“无内容”。
- `layout.ts:72-90,143-168`：卡片布局按云账号/设备/会话分开，右栏开关和宽度却只保存在全局 `yonder.rail`；本地非云节点沿用旧 session 键。`WorkApp.tsx:55-95,123-128` 切换设备时重置 mux/查询并以 node key 重挂载 WorkShell；按 session 的 Map 仍留在模块内。
- `Chat.tsx:98-148,152-183,231-324`：右栏按钮和列表恢复在会话 Header，手机右栏是全屏 dialog；渠道与子会话面板有自己独立的 `channels` 状态。`CardStack`/浮窗属于第三组面板状态。

## 当前实际组合矩阵

符号：L=工作列表、C=会话正文、R=工作右栏、P=设置/功能页、E=“选择一个 Bot 或任务”空主区；S=手机全屏右栏抽屉；“无”表示 `hasRail=false`；“有”表示 `hasRail=true`。此矩阵是按源码推导的稳定结果，不是声称所有组合均有浏览器实测。`A` 表示桌面/平板 `railPref.open && (hasRail || manualRail===sessionKey)`；`M` 表示手机 `phoneChoice ?? hasRail`。用户手动打开技术面板可使空数据下 A/M 为真。

| 路由 / 模式 | 桌面 >1024 | 平板 640–1024 | 手机 <640 |
|---|---|---|---|
| list / auto | `leftOpen` 真 L+E，假 E+恢复按钮 | `leftOpen` 真 L 覆盖 E，假 E+恢复按钮 | L 占主区；无侧栏收起按钮 |
| session / auto、无 | 默认 L+C；A 真时 L+C+R，关闭左栏后 C 或 C+R | A 假且 `leftOpen` 真为 L+C，否则 C；A 真为 C+R | M 假 C；M 真 C 底层加 S 覆盖 |
| session / auto、有 | A 真 L+C+R，A 假 L+C；左栏可关闭 | A 真 C+R、L 隐藏；A 假且 `leftOpen` 真 L+C，否则 C | 未手选时 S；手选 false 后 C，手选 true 时 S |
| session / list | L 占满，隐藏正文与右栏 | 同桌面 | 同桌面；顶部选择器仍在 |
| session / content | C 占满；Header 仍可显式打开右栏并回 auto | 同桌面 | 同桌面 |
| session / rail、有 | CardStack 占满，顶部选择器可恢复 auto | 同桌面 | 同桌面；不是 dialog |
| session / rail、无 | 立即显示 content，effect 将保存选择改为 content | 同桌面 | 同桌面 |
| settings/page | `leftOpen` 真 L+P，假仅 P | 仅 P | 仅 P |

补充：桌面和会话模式下的平板的 Chat 均用 `wide=true`，因此右栏或渠道面板为横向列；手机用 dialog/sheet。`frameOf().chatWide` 仍给平板 false，但 WorkShell 实际用 `breakpoint !== "phone"`，两者不可混为同一个事实。普通 `content` 模式把 `Chat.showRail` 固定为 false，`panes` 则仍由 auto 的 `showRail` 算；实际渲染由 `paneMode === "auto"` 额外屏蔽左栏。

## 操作与转换（当前代码）

| 事件 | 现有动作 | 后果 / 限制 |
|---|---|---|
| 选择 auto/list/content/rail | 按当前 node/session 写 `paneChoices`，不改路由 | 四种专注视图按会话记在内存；rail 仅在 `hasRail` 为真时可选择 |
| 左栏顶部收起 | list 专注模式转 content；其他模式只令 `leftOpen=false` | 组件级状态，并不按会话保存；手机没有此按钮 |
| Header 展开列表 | 非 auto 先转 auto，`leftOpen=true`；平板且 `showRail` 时全局关闭 `railPref.open` | 操作一次同时改右栏偏好，桌面不会同步修改右栏 |
| Header 切换右栏 | 非 auto 切回 auto；手机写当前 `phoneRailChoices`；桌面/平板写全局 `railPref.open` 和当前组件 `manualRail`，平板打开时再置 `leftOpen=false` | 同一图标在不同断点写不同存储，且在平板会永久改变左栏状态 |
| 手机右栏返回/Esc | 调同一个 `toggleRail`，设置该 node/session 的 phoneChoice=false | 当底层模式是 auto 时，后续新内容不会再次抢屏；dialog 初始聚焦返回，代码没有焦点陷阱或关闭后恢复焦点 |
| 打开/关闭渠道与子会话 | `Chat.Live` 自己切换 channels；宽屏渠道面板替换右栏，手机打开独立底部 sheet | 未纳入 WorkShell 的 `panes`/showRail 判定；按钮状态仍由 showRail 表达，非实际右侧内容 |
| 切 session / 浏览器返回 | 路由改变，按新 `node.id:session` 查询专注模式和手机选择；同 WorkShell 的 leftOpen/manualRail 保留 | 已保存的 rail 专注模式在数据尚未加载时可能被 effect 覆写；无 session 路由没有专注模式选择器 |
| 切账号/设备 | CloudWorkEntry 停旧流、清旧设备查询，GatewayWorkApp 按 node.id 重挂载；显式设备路由携带设备和会话 | leftOpen/manualRail 重置，railPref 保留；专注模式和手机选择仍为该 session key 的内存记录；离线设备走 WorkApp 的设备状态页，不显示 WorkShell |
| 改窗口断点 | useBreakpoint 更新 phone/tablet/desktop，状态不迁移 | 手机 map 与桌面 railPref 各自决定右栏，可能变化；平板打开右栏造成的 `leftOpen=false` 在放大到桌面仍保留 |
| `hasRail` 从无→有 / 有→无 | auto 重新计算；仅 rail 模式在 false 时 effect 永久改 content | 空、加载、失败没有区分；手机已有手选 false 会继续 content，但手选 true 即使变空仍显示 S |

## 问题、证据及影响

1. **专注列表无法直接打开当前会话。** 源码推断：在 `paneMode=list` 时 WorkShell 只渲染 `sideContent`（WorkShell 140–149）；点击当前已选行仍导航同一 URL，`paneChoices` 没有清理或切回正文，列表仍占满。可通过顶部选择器恢复，但列表项本身没有完成“进入”的语义。应分别验当前行、其他 session、同号不同设备和浏览器返回。
2. **加载/出错会永久丢失“仅右栏”的选择。** 源码推断：`hasRail` 在初始快照和独立视图/附件尚未返回时为 false，WorkShell 59、64–69 直接将该 session 的 rail 选择写为 content；后续数据返回也不会恢复。刷新、切设备重新挂载或瞬时断线可能触发。应明确 `unknown/loading/error/empty/present`，只对已确认 empty 触发退回；测试请求先后顺序与 gap。
3. **平板右栏开关影响左栏和其他屏幕的持久偏好。** 源码推断：平板 `toggleRail` 打开设置 `leftOpen=false`，关右栏并不恢复它（76–92）；展开列表还会将跨设备共享的 `railPref.open=false`。横竖屏变化或会话切换后，桌面也可能失去预期默认右栏。需要区分用户手动隐藏与因空间自动让位，自动让位不写偏好。
4. **渠道面板绕过三列限制，右栏按钮/状态可能不实。** 源码推断：宽屏 `channels` 直接渲染 ChannelPanel 且压掉 RightRail（Chat 313–315），但 WorkShell 的平板 `panes.left` 只看 `showRail`。当右栏未开、左栏可见时再开渠道面板，平板可出现 L+C+渠道三列；Header 的 `aria-pressed` 也仍代表 showRail，而不是当前实际右侧面板。渠道面板应作为右侧内容的一种，和 R 共用容量及关闭语义。
5. **仅右栏时悬浮面板失去恢复入口。** 源码推断：独显 rail 直接渲染 CardStack（WorkShell 143–149），FloatLayer 只在 Chat 的正文 section 内（Chat 311）；全浮出时 CardStack 明示“去悬浮窗停靠”，但当前视图看不到浮窗或正文的悬浮菜单。要让已浮出卡片在该模式可达，或明示并提供返回会话的快捷入口。
6. **设置/功能页隐藏左栏后缺少局部恢复按钮。** 源码推断：desktop P 分支直接返回 page，左栏收起时 `onList` 只传给 Chat、EmptyPane 恢复按钮只在无 session 的 E 分支（WorkShell 150–175）。可通过其他全局导航绕回，但当前页缺直接恢复。要提供固定可达的左栏恢复入口，不依赖是否为 Chat。
7. **空、失败、浮窗与数据内容混同。** 源码推断：`hasRailContent` 只看数据，不看对应卡片是否已浮出；`views.data` 部分失败由 allSettled 转为 false，附件任何一个查询失败则整组没有 data；只查最近50条消息（railContent 41–65、73–100）。可能把未知当空，也可能在所有实际内容都浮出时把空 CardStack 当有内容；附件历史范围不是全部。应保留未知/错误反馈，区分“卡片可用数据”与“停靠区有可显示内容”，不要为判断 UI 扩展成转录存储。
8. **手机选择和断点变化不一致。** 源码推断：phoneRailChoices 独立于桌面 `railPref`，跨断点时不会迁移手动选择；手机手选 true 后内容清空时仍开空 S（phoneRailVisible 63）。`hasRail` 出现前选过 content 不抢回是有测试覆盖的；空右栏的例外应明确区分“显式打开技术信息”与“自动展示数据”。
9. **缺失会话时收起列表难以直接恢复。** 源码推断：`Live` 在 `not_found` 直接返回 `Missing`（Chat 268–269），该组件宽屏无返回按钮、也没有 onList；若左栏已收起，只有顶部显示选择器可切列表。把容错页纳入相同导航，而非再为缺失会话增加特殊状态。
10. **测试与注释描述的旧布局不是当前实际布局。** 已测事实：现有测试中的 tablet `frameOf().chatWide=false` 通过；源码 WorkShell 使用 `breakpoint !== "phone"` 向 Chat 传 true，layoutMode 文档仍称平板右栏覆盖。当前测试只验证独立函数，没有验证组合后 DOM，容易在“测试通过”时仍发生右侧超列或恢复死路。
11. **断点口径不一致，但不能据此断言某个像素必坏。** 源码事实：`useBreakpoint` 把 1024 归为 tablet，`useDesktop` 从 1024 起算桌面，Shell/PersonalDrawer 用 Tailwind `lg` 切主导航与头像；WorkShell 根据自己的断点决定内容列。尤其 640–1023 时 layoutMode 的 `nav=iconrail` 只是函数返回值，Shell 实际按自己的 CSS 规则渲染。应在真实视口测 639/640、1023/1024/1025 和系统缩放，分别检查导航、个人入口与内容列，确认布局期望后统一口径，不先把“值不同”当作已证实视觉缺陷。

## 建议的最小状态机与可达规则

仅作为本轮建议，尚未获准修改 spec 或代码。

1. **用户意图与实际布局分开。** 每个 `(account, device, session)` 只保留 `focus = auto | list | content | rail`；左、右显式开关使用明确 `open/closed/auto`，不可因宽度不足把 auto 让位写成 closed。渠道/子会话是右侧 `panel = work | channels`，不是额外的一列。窗口断点和真实数据作为输入，推导显示结果；不再同时维护 phone map、全局开关、manualRail 三份相互独立的“右栏开了吗”。宽度作为设备界面的偏好可保留原生存储，与是否打开分离。
2. **数据判定有四态。** `loading | error | empty | present`；空态判断含实际停靠的待办、子任务、附件、视图和后台等。错误或未加载不能写成 empty；手动打开技术信息允许在 empty 时显示，但不得把它说成自动有数据。若进入 rail 专注时数据暂未到，保留选择和加载态；确认变空才回内容，并可恢复。
3. **导航必须有同一出口。** 任意会话中都可进入列表、正文、右栏并恢复 auto；同一会话从列表被点击时也必须切正文，不依赖 URL 变化。左栏显隐按钮在 settings、missing、空主区与普通 Chat 都可达。显示选择器可以保留，但动作必须更新同一个 focus/面板状态，状态值与真实可见区域、aria-pressed 一致。
4. **按可用空间推导，而不改用户意图。** desktop：auto 最多 L+C+R，用户分别可收起或独显。tablet：auto 两列，R 有内容时 C+R，否则 L+C；当用户主动展开 L 时显式让右侧让位，收回后保留它的上次意图。phone：auto 单屏，首次已知有右内容时优先 R；数据异步到达不能打断用户已经手动选择或正在输入的正文焦点，待用户主动切换时保留右栏有内容的提示。空右回正文但保留用户明确打开技术面板的能力。settings/page 永不自动出现 session 右栏。
5. **会话身份与状态生命周期。** 云端 session 操作必须以 `(accountId, deviceId, sessionId)` 绑定；只读全设备聚合查询按设备并发，详情、写入与订阅只绑定所选设备。切换先取消旧流、隔离旧查询；明确路由直接打开对应设备，同号不会串。专注状态和草稿的保留时长、重载与登出清理要写明；不将离线当解绑。
6. **右侧和悬浮卡片不互相藏住。** 用户切换至仅右栏时，浮窗仍有可发现的入口或可直接停靠；打开渠道面板等价于切换右侧内容，保持最大列数。手机 dialog 需要焦点约束、Esc/返回与焦点归还；滚动和输入焦点不因刷新被抢走。

## 建议验收矩阵与执行顺序

- 先以纯状态转换测试覆盖 3 断点 × 4 focus × 右栏 loading/error/empty/present × 左右显隐，再加跨断点、session、账号和设备切换；断言实际列数、控件名称/状态、动作结果与自动/手选优先级，而不只断言旧 `frameOf`。
- 真实浏览器覆盖每断点：打开与关闭两栏、各专注模式及回 auto、当前会话列表点击、渠道面板切换、全部卡片浮出后恢复、missing/settings、空变有与有变空、刷新与横竖屏切换、键盘/focus。保留真实截图与设备/视口；浏览器观察与纯函数测试分别记录。
- 双设备同号会话：从全部列表各自进入、刷新深链、切设备、发消息后草稿/右栏布局/订阅归属，确保不跨设备；离线、解绑、无权限和网络错误分别呈现。真实账号与真实设备操作遵守既有授权，不发无关消息。
- 最小落地顺序：先确定状态归属与转换契约，再修用户入口及渠道面板冲突，再做异步数据四态与浮窗可达，最后针对三断点执行浏览器验收。现有单次纯函数通过不能替代完整操作验证。
