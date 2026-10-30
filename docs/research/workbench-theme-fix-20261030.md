# 工作区主题一致性修复记录

2026-10-30；依据 `apps/app/DESIGN.md`、现有 `@yonder/design` 令牌及全站组件，保留已有工作区行为，不建立独立主题。源码审计见 [主题对照](workbench-theme-alignment-20261030.md)；撤销全宽工作工具栏由并行工作负责。

- 工作区 kit 的 `Button`、`Field` 复用 `src/ui`；Toast 复用全站唯一 store 与 `App` 中已挂载的 Toaster。原工作区自建 Toast 无挂载消费者，工作操作提示无法显示；现有组件的状态、变体、字段显隐与提示位置沿用全站。
- 工作 Markdown 的 pre/code 规则限定到 `.work-root`，避免懒加载工作区后改变消息/名片中的共享 Markdown；`ViewHost` 中未定义的 `border-line` 换成已定义的 `border-hairline`。不改变共享 Markdown 或全站色表。
- 设计文档修正旧的两断点、旧底栏、虚构渐变头像和“网页没有执行数据”描述；现以 spec 19 的三断点、四入口、真实 actor 与会话事实为准。任务/导入类别仍保留工作区本地回退图标，不能按名称猜真人或 Bot 头像。
- 当前未提交的 `apps/app/src/styles.css` 和 `packages/design/src/tokens.css` 含全局浅暗色、焦点、字重、弹簧与打字动效，影响整个产品；本次一致性修复不需要它们，未暂存或覆盖，也不增加新动画/调色。用量阈值黄色暂无现成同义 token，不误用 danger 或引入新 palette，留待视觉语义另行确认。
- `@yonder/app` 双 tsconfig typecheck、受影响文件 Biome 通过；挂载真实全站 Toaster 验证工作提示以及设置/入口四个测试文件 26/26 通过。当前全仓 size 检查失败：并行未提交 `packages/sdk/src/types.ts` 516 行、`packages/core/src/kernel/index.ts` 665 行超各自限制；不以本组检查代替全仓通过。
- 未部署，浅/暗色与真实浏览器在最终精确 hotfix 快照上验收；P0 四项导航回归也由集成负责人复测，不能从本组单元结果推断通过。

## 后续修正：单一设备菜单与小型更多菜单

主人进一步明确移除布局原生 select：设备选择是一个 Radix 菜单按钮，不显示单独“设备”标题或图标加 select；会话右上仅保留右栏开关与更多，渠道、悬浮面板和设置收进有文字的更多菜单。此前 `.13` 验收记录里两个 44px select 是当时真实历史证据，不再作为新候选目标。采用 `components/PlusMenu.tsx` 既有 DropdownMenu 的 `bg-raised`、`rounded-card`、`shadow-float`、`data-[highlighted]:bg-tone` 和 44px 项目；设备选中状态使用 Radix 单选语义，打开、方向键、Escape 和焦点回归走同一 primitive。无需新样式库或只用一次的菜单抽象。

该修正由并行负责人实施；本记录不声称已通过实际浏览器或已部署。此前共享 Button/Field/Toast、Markdown 作用域和现有 token 修复保持；正式运行时仍为 `.13`，新前端候选等待完整检查和实际 QA。

## 最终前端 hotfix 与验收回执

- 主人最终修正已实现：工作区不再显示布局原生下拉；设备使用单一按钮及 Radix 单选菜单；会话右上仅右栏开关和更多，渠道、悬浮面板、设置为文字菜单。之前 4c 候选的 select 检查保留为历史，不代表最终界面。
- 已上线精确组合 `appSource=5c2a1dd`、`.13` runtime base `9568086`；快照 `/opt/yonder-card/web/releases/0.3.26103013-hotfix-5c2a1dda4d2f` 的 hash 全部通过，provenance 包含 base 与 app 归档 hash。本次为前端 hotfix，没有新增 runtime 版本。
- 应用检查：89 个测试文件、538/538 测试通过；build、typecheck、lint 与 size 检查通过。主仓其他并行 core `0cf` 的原始 2 项失败不属于该应用检查，保留原结果，不称完整 main 全绿。
- 主 Agent 在真实浏览器 390 宽核验 QA 标题、转录、Footer 正确；右上为右栏开关与更多，更多菜单有文字项，方向键可进入悬浮面板的 checkbox 子菜单。320 CSS px 下设备按钮 1 个、原生 select 0 个、无额外设备标签；两个 RadioItem 的 checked 分别为 true/false、各高 44px，根横溢 0。截图 `/tmp/yonder-simple-device-menu.png`、`/tmp/yonder-simple-more-menu.png` 已查看。桌面设置页收起左栏后恢复入口仍可见，根横溢 0。
- entry 对新候选完成浅色、模拟暗色和三屏检查；系统暗色、跨页面暗色、真人触控及真实双设备仍未测。主 Agent 的 `vsdr` capture `db6c3f3e00a07` 已调用 stop，但 export 命令未核实产生文件且当前未找到文件；会话已结束，不把导出记为成功。上述实际截图和工具输出是可用证据。
- 本次实现、前端上线及已列浏览器检查完成；未测项保持开放，键盘和单设备不替代真人触控或双设备验收。
