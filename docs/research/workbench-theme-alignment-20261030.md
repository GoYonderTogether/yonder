# 工作区主题与通用组件审计（2026-10-30）

本记录是源码审计，未进行视觉验收。线上正式版本以 0.3.26103013 的发布记录及其提交 `9568086` 为基准；当前工作树另有大量未提交视觉改动，当前 live runner 指向精确 .13（`9568086`）独立发版归档，主目录未提交改动不会自动上线；本次 hotfix 将另以精确归档切换。不能把工作树色值称为 .13 正式发布色值。本文不批准新品牌或设计系统。

## 规约过时部分

`apps/app/DESIGN.md` 中手机 <768 / 桌面 ≥768、底栏“消息/名片/Agent/我”、Agent 渐变头像以及互联网网页尚未接入执行 API 等段落落后于已批准 spec/19 的三断点、四项导航、真实账号头像及设备工作数据。它们不能作为重置产品的依据；本轮主题比对以现有共享 token 与同类型组件为准，规范文档应由实现方核对现行事实后单独更新。

## 根因与最小处理

1. **提醒通道分裂，工作区 toast 不可见。** `apps/app/src/ui/Toast.tsx` 用 nanostores；`work/ui/kit/Toast.tsx` 维护独立状态和计时器。`App.tsx:48,60` 只挂前者的 Toaster，工作区调用的后者没有挂载消费者。最小做法是让工作区 kit 导出全站 toast（及必要兼容导出），继续只挂一个 Toaster，验证工作设置、列表、发送错误等调用确实可见；避免重复挂载造成双提示。
2. **相同按钮、字段维护两份。** `ui/Button.tsx` 与 `work/ui/kit/Button.tsx` 的三种变体、尺寸及 class 一致，只是前者使用 cva；`ui/Field.tsx` 与 `work/ui/kit/Field.tsx` 结构、状态及样式相同。可以复用/重导出既有组件，并保留调用方类型和密码切换行为；无需重写主题或新增组件库。`ui/Toast.tsx` 同样应复用，因其状态而非外观存在真实故障。
3. **工作模块 CSS 会泄漏。** `WorkRoot.tsx:1` 导入 `work/styles.css`；该文件不是 CSS module，`.md pre, .md code` 与 `.md pre`（13–18 行）全局匹配。工作区一旦加载，其他页面也可能继承 `overflow-wrap:anywhere` 与 `white-space:pre-wrap`，改变共用 Markdown 的代码块；`.pt-safe`、`.safe-b`、`.no-select` 也是全局 utility，但非 token 重定义。限定到工作根容器需检查移动层和浮窗挂载位置，避免误伤工作区内容。
4. **不存在的边框 token。** `work/features/views/ViewHost.tsx:85,109,114` 使用 `border-line`，全项目无 `--color-line`/`--line` 定义；现存的是 `border-hairline`。需要逐处核对控件实际可见边界，用已有 token，不新增同义 token。
5. **工作区状态色有硬编码。** `work/ui/PanelBody.tsx:189` 与 `Footer.tsx:67` 用同一 `#b7791f` 表示用量阈值，尚无共享语义 token；亮暗主题表现需实际比较。若本轮要统一，应抽同一个有明确阈值含义的现有约定或经批准的状态 token，不把它直接变成 danger；不存在现成同义 token 时先确认设计。
6. **少数几何值不统一。** `Composer.tsx:115,128` 的 22px/18px 圆角与 `DESIGN.md` 输入条 20px 描述不一致；全站字段 `rounded-control` 对应 10px，不能把聊天输入条机械替换成字段。`ChannelPanel.tsx:90` 遮罩为 `bg-black/30`，现有名片遮罩 `styles.css` `.card-overlay` 使用 ink 的 color-mix，暗色应实测并依据遮罩语义统一；`ChannelIcon.tsx:49` 的 5px 是小渠道标识，非通用卡片；`Avatar.tsx:10` 的 28% 属身份图形，不应直接套 16px 卡片角。
7. **头像的语义不能合并。** 云 Bot 已使用 `ui/Avatar.tsx` 的真实 actor、URL 校验/失败回退；`work/ui/Avatar.tsx` 是按 bot/task/import 分组的本地后备图标。它们视觉不同但输入语义不同；只将可获取真实 actor 的路径复用全站 Avatar，不按显示名猜身份，不抹掉任务/导入类别。
8. **开发主题模拟偏离当前 dirty tokens。** `work/devtools/devtools.css:9` light `--rail:#f5f5f3`，工作树 `packages/design/src/tokens.css` 为 `#f2f1ef`；模拟覆盖 `:root[data-devtools-theme]`，启用模拟时改变整个页面而非仅浮窗。两个文件均处于并行修改中；确认最终设计后使模拟值与实际一致，不能把模拟当正式主题证据。

## 已共享，不应重复实现

全站 `main.tsx` 导入 `styles.css`，其中从 `@yonder/design/tokens.css` 导入亮暗基础色、阴影、强调及状态色，并以 Tailwind `@theme` 映射；圆角、五档字号、字体及通用 `field`/`press`/`.md` 同源。工作区绝大部分使用 `bg-list`、`bg-ground`、`bg-tone`、`text-muted`、`rounded-card` 等相同 token；不要另建工作区颜色表。产品并没有单一通用 Card 组件：现有 `ui/Window.tsx` 是 dialog，`work/ui/PanelCard.tsx` 是有拖拽、停靠和浮出的工作卡片；统一视觉 token 而非把两者强行替换。按钮与字段存在 13/14/15px 的字面量，分别两套相同；如要消除与五档规则的偏差，应先决定已有 13px 标签/小按钮约定，避免全站无意字号变化。

## 正式版与工作树差异

在 `9568086` 中浅色 `rail/list/ground/tone` 为 `#efeeeb/#f1f0ed/#fbfbfa/#e9e8e4`；审计时 dirty 依次为 `#f2f1ef/#fcfcfb/#ffffff/#f0efec`，同时调整暗色、焦点阴影、字体权重及动效。`apps/app/src/styles.css` 的 dirty diff 新增全局字体权重映射、`time`/数字字宽、动画及字段焦点样式，影响社交、市场和工作页，不仅工作区；这些未提交的值不是 .13 正式发布事实。工作树还有并行 core、SDK、微信及规范改动，本审计不触碰它们。

## 待实测

实现方完成后以真实 app 逐项检查浅色/深色及 390、768、1280：工作/消息/市场的表面层级、字段焦点、菜单遮罩、任务卡与真实 Bot 头像、工作提醒、Markdown 长代码块；验证前注明实际运行版本和 commit，保留截图。模拟主题、测试替身、构建和真实浏览器证据分开记录。

## 5c2 候选浏览器证据（历史候选）

原网址当时运行 runtime/base `9568086` + 前端 `5c2a1dd`，非整个主仓 HEAD。Chrome 实际缩放 90%，按 `innerWidth` 校准；浅色工作会话 1280、768、390 与设备列表 320，暗色使用已有开发浮窗的 token 模拟（不是系统深色），检查工作会话 1280、768、390。截图分别为 `/tmp/final-work-{light,dark}-{1280,768,390}.png`、`/tmp/final-device-menu-320.png` 和 `/tmp/final-work-channels-768.png`；1280 工作截图中的“开发”是主动开启的开发浮窗，不算产品操作按钮。浅色 1280 消息、通讯录、市场对照截图为 `/tmp/final-{message,contacts,market}-1280.png`。

在该候选实际观察：320 设备单按钮打开单选菜单并显示当前勾选；工作会话更多菜单有渠道、悬浮、恢复及设置；悬浮子菜单可用 ArrowRight 打开；768 渠道与正文两列；390 右栏返回正文输入框。未测系统深色与跨页面暗色；独显布局入口已按用户后续要求撤销，旧 4c 候选关于布局 select 的证据仅为历史记录。之后用户又要求将更多按钮固定在内容区并合并设置入口，上述候选不代表这些后续修改的最终验收。

## 空态复现（修复前）

当前线上后台浏览器真实 `/work` 在 Chrome 90% 缩放下，实际 CSS 视口 1195×1315：列表 header 为 320×56，内容空态 header 的矩形宽约 106.6、高约 1309.6，文字和更多被垂直置中，见 `/tmp/work-empty-before-1195.png`。另留 `/tmp/work-empty-before-{1280,768,390}.png`；平板收起列表后的入口见 `/tmp/work-empty-before-768-collapsed.png`（重测实际宽 767，缩放舍入）。此为修复前证据；未对用户数据做修改。随后候选仍需独立复验。

分组讨论：现有会话有单个 `agent`、`opened`、`closed`/`archivedAt`，运行态来自 activity；单设备列表日期分组和排序按 `opened`，不能称最近活跃。可考虑用真实 agent 身份筛选、按现有时间及可证实状态分组；会话多 Bot 标签目前没有对应字段，不按显示名推断，也不因离线判定完成。仅建议，尚未实施。

## .16 界面和缓存验收

公网 `.16`（base `0ac066c`，缓存补丁 `99cda44`）在 Chrome 90% 缩放、真实 CSS 1195×1316 下，空态内容 header 宽约 793.6、高 56，More 位于内容右上，重复标题消失；图 `/tmp/work-empty-after-1195.png`。1280、768、390 图分别为 `/tmp/work-empty-after-{1280,768,390}.png`，1195 和平板列表可收起及恢复，列表项标题左侧槽位对齐。这组 UI 图取自 `.16` 基线，缓存补丁后未重新截图。

缓存实验：同一后台标签页先在线打开 `/work/161323`，观察到账号、设备和会话级 sessionStorage 缓存键，会话 items 为 2（未读取或记录正文）。只对该标签页阻断已观察到的设备列表、设备 agents 和工作 RPC 的 HTTP 请求；三条规则分别命中至少 12、6、12 次。重新加载后会话缓存和 2 条 items 仍在，但页面停在“工作设备 正在读取设备…”，未恢复聊天；停止拦截并重新加载后聊天恢复。此是具体 HTTP 请求阻断实验，WebSocket 未阻断，不能声称模拟完整设备离线；刷新失败已交实现方处理。完整设备断线与恢复、无缓存冷启动、权限撤销均未实测。
