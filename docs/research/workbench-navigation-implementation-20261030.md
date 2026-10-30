# 工作区导航重设计：本轮实施记录

2026-10-30。实施依据 [导航重设计方案](workbench-navigation-redesign-20261030.md) 与 [浏览器审计](workbench-responsive-browser-audit-20261030.md)；此文记录各阶段实际结果，不把静态测试当浏览器或真人验收。

## P2 工具栏与图标

- Tabler Icons 3.46.0 官方四个 `layout-sidebar-{left,right}-{collapse,expand}` 原始 SVG 路径按需移植为 `apps/app/src/ui/PaneIcons.tsx`，MIT 许可原文保存在 `apps/app/src/ui/tabler/LICENSE`；不引入整库依赖。四图装饰性 SVG 默认隐藏于无障碍树，由动作按钮提供名称和状态。Logo、头像、渠道品牌保留。
- `AppBar` 增量支持副标题和可选样式，消息与通讯录沿用既有调用，市场标题栏复用同一骨架并保留既有 CSS 和业务动作。搜索字段补可访问名称、加号菜单明确为“创建或添加”；不把列表、卡片和输入区的动作上移成全局按钮。
- 验证：`@yonder/app` 两个 tsconfig 类型检查通过；工具栏、主导航、个人抽屉、通讯录、市场 5 个定向文件共 11 项通过；相关文件 Biome 检查通过（项目原有 Market/Chat/Contacts 非阻断提示另按集成检查记录）；文件大小检查通过，未提高基线。Tabler 官方 GitHub MIT 许可与 3.46.0 原始 SVG 已核对。
- P0 状态机 `51352c6`；P1 工作 toolbar `2aa24af`、回归 `8235759` 与触控目标修正 `76665a1`；市场 live 深链/资源路由 `87a1a97`。此轮源码及线上预览已供检查，正式发行仍待 CI 和发布回执。

## 集成检查与真实浏览器证据

- `8235759` 本机全量原始结果：测试文件 396 通过、4 失败、62 跳过；测试 2200 通过、5 失败、102 跳过。无并行负载后原四个失败文件定向重跑为 4 文件通过、17 测试通过、1 跳过；未修改断言，定向结果不覆盖原始全量失败。日志 `/tmp/yonder-12-test.log`。
- 主 Agent `nvpr` 实测 CSS 1600×937 设置页收起列表后恢复按钮可见且可打开；真实 `/work/161323` 仅列表点击当前任务后进入该设备的规范路由，mode=auto、聊天可见、根横溢 0。missing 会话第一次在全量测试与 runtime 更新并行时 caps 请求 504，停止测试负载后重载约 950ms 出现 not_found，收起列表后仍可恢复、根横溢 0。390×844 空右栏不自动占位，单 header，历史任务可读；手机更多中两个 select 均 44px，空右栏选项禁用，选择正文后对话框关闭、单 header、聊天可见、根横溢 0。截图 `/tmp/yonder-toolbar-phone-verified.png`、`/tmp/yonder-pane-settings-recovered-control.png`、`/tmp/yonder-pane-open-current-fixed.png`；capture `de6eada673ff8` 已停止并导出 `/tmp/yonder-pane-implementation-browser.json`，会话已关闭。
- 独立后台 `lomb` 对真实 `/work/2` 在 CSS 宽 640、768、1023、1024、1025、1440、1920、高 844 各选 auto/list/content/rail，28 个 DOM 状态均可选、根横溢 0。768 打开渠道后展开列表，实测列表 320、正文 448 CSS px，不再出现旧 148px 的三列挤压。768 仅右栏展开真实子任务并进入 `/8316`，浏览器返回后实际 URL 回 `/work/2`、mode=rail、右栏可见；返回工具等待 load 15s 超时，结论以 URL 与 DOM 为准。
- 320、390、639 CSS 宽的 list/content/rail 各 3 个模式共 9 次可见值正确、根横溢 0；auto 操作 3 次已选择，但菜单关闭后 DOM 选择值不可读取，不能把这 3 次算作模式值完整验证。最早 12 次手机循环受到右栏/渠道 dialog 遮挡而无可读模式，已排除而非记为通过。844×390 只核几何：根横溢 0、正文 524、右栏 320，截图 `/tmp/yonder-navigation-p3/work-landscape.png`。390 手机更多菜单的设备和布局 select 实测高度均为 44 CSS px。
- 手机真实站内市场显示个人入口、市场标题、发布，根横溢 0；通讯录显示个人入口、标题、创建/添加和具名搜索。市场直接深链曾在旧 live 版本返回 404，`87a1a97` 后主 Agent 公网确认 `/market` 200 HTML、`/market/camera.jpg` 200 JPEG、缺失 JS 404。截图 `/tmp/yonder-navigation-p3/contacts-390.png`。
- 一次 `/work/2` 冷刷新曾长时间显示连接中，捕获中一次 capabilities.get 200 耗时约 24.3 秒；同一时段 runtime 由其他并行工作升级至 `.12`，设备短暂离线后只读设备接口恢复 online=true、workProtocol=1。不能仅据此判断根因；没有重启运行时。`lomb` capture `d9793243076b5` 已停止并导出 `/tmp/yonder-navigation-p3/capture.json`（9,576,057 字节），会话已关闭；捕获保留 64 操作、丢弃 125 操作，不是完整操作日志，矩阵文件与截图为证。
- 原四个浏览器问题经本轮真实操作复验未再出现；物理手指、真实鼠标拖动、屏幕阅读器与真实双设备切换尚未测，单设备和键盘不代替这些验收。正式 CI run `41047860130` 及 `.13` 发行仍待回执，不在此记为成功。
