# Yonder 交互小窗原型

菜单栏小窗、项目共享角色与真实本地交互。2026-10-22 用户确认做体验原型，随后明确沿用 ai-card Web 风格，并将信息与操作收敛到交互流程。

## 运行

```sh
node proposals/ui-companion/build.mjs --native --serve
```

浏览器打开 `http://127.0.0.1:62735/`；macOS 打开 `proposals/ui-companion/dist/Yonder UI Prototype.app`。

独立菜单栏入口左键开关小窗，右键退出。启动先显示悬浮图标，不注册登录项，不改正式 Harness 服务。窗口为 400 × 460，内容超出时内部滚动。

## 体验路径

1. 点击悬浮入口展开；窗口与入口共享边角锚点，收起再打开位置不变。窗口空白区域和悬浮入口均可拖动，限制在屏幕内。位置在当前运行期间保留。
2. 初次位置选择离指针最远的屏幕角落；之后尊重拖动位置，不随鼠标跳动。原生入口为 56 × 56，Logo 视图为 52 × 52，允许图像放大。
3. 选择后进入下一步，草稿自动保留；完成默认收起。历史按钮查看真实交互记录，可展开回溯原问题与答案。
4. 网页通过顶部切换独立窗口、页面提醒、聊天内嵌。页面提醒先显示图标；内嵌隐藏全部品牌与外层工具栏，完成结果保留在原位置。

角色来自唯一品牌源 `brand/src/yonder-mark.js`，构建时直接内联。输入时倾听，完成时反馈；不代表模型运行或录音。主题跟随系统，减少动态效果时使用静态 Logo。

记录使用 localStorage，浏览器与原生 WebView 分开保存；清理网站数据会移除记录。原生记录依赖当前 bundle 路径。尚未接入真实 Agent 回传、语音、渠道图片生成或远程服务。

## 本地宿主接口

`window.yonderUI.present(card)` 接收含 `id`、`title`、`prompt` 的卡片；`kind` 为 `choice`（提供唯一 id 和 label 的 options）或 `form`。`next` 可指定下一步，`autoClose` 默认 true，设为 false 可保留完成窗口。每步触发 `yonder-interaction` 事件，detail 含交互 id、step 和 completed。同步事件处理器可提交新任务，旧任务不会把新任务收起。

`window.yonderUI.setSurface("window" | "notice" | "inline")` 切换承载方式。这仅是原型宿主接口，并非正式 SDK 公共契约；实际 Agent 适配仍需对接 Harness 的事件与绑定。

原生使用 nonactivating NSPanel、orderFrontRegardless、becomesKeyOnlyIfNeeded；出现时不调用激活应用或抢 key 的方法。配置 canJoinAllSpaces、fullScreenAuxiliary、stationary，并在 macOS 13+ 使用 [canJoinAllApplications](https://developer.apple.com/documentation/appkit/nswindow/collectionbehavior-swift.struct/canjoinallapplications) 支持台前调度集合。切换 Space 时收起为入口。输入仅通过用户主动点击进入。

## 风格来源

直接沿用本机 `/Users/zoran/Documents/yonder-card-web` 的 `DESIGN.md`、`src/styles.css`、`src/ui/Button.tsx` 与 `src/ui/Field.tsx`（参考 commit `1c5b692aa5ff40de9ee9c8105f96a564fb38aa98`）：

- 原样采用浅/深色令牌、字体与字号、控件/卡片圆角、柔和阴影、动效曲线。
- 黑白强调、薄雾灰底、白纸面、灰色输入区与黑色胶囊按钮。
- 字体使用该项目已安装的 Geist Variable Latin 字体，随原型离线打包，许可见 `assets/Geist-LICENSE`。
- 此处只适配小窗的布局；没有新建另一套配色，也没有改动 ai-card 工程。

[OpenUI](https://www.openui.com/demos) 与 [assistant-ui](https://www.assistant-ui.com/elements) 只作为任务卡片及渐进交互参考。没有引入它们的运行时或组件依赖。

当前为独立原型的令牌快照。正式接入时应复用统一 Web 样式源；本次不提前抽共享包，也不提供执行任意生成 HTML 的生产沙箱。

## 验证记录

```sh
node proposals/ui-companion/check.mjs
node proposals/ui-companion/build.mjs --native
npm run build && npm run typecheck && npm test && npm run lint
```

基于 `cf35aaa`，独立工作树和 `zoran/ui-companion-prototype` 分支；原工作区的 channel-card 改动未触碰。

- `npm ci --offline --ignore-scripts` 成功，零新增依赖。
- 仓库构建、typecheck 通过；默认测试 **52 文件通过 / 11 跳过，195 测试通过 / 23 跳过，0 失败**。没有启用真实模型测试，本次未修改模型调用。
- 状态自检通过：下一步、默认收起、宿主保留、草稿恢复、历史快照、旧记录兼容和无效输入。
- 原生编译与几何自检通过：避开初始指针、屏幕约束、负坐标显示器、拖拽边界、展开/收起同锚点。
- 浏览器实际验证：拖动、选择→补充→完成收起、历史逐步回溯、无品牌内嵌、页面提醒图标。展开前后窗口均为 x=16/y=244/400×460，收起入口为 x=16/y=648/56×56，同一左下角锚点。
- 原型 Biome 检查通过。全仓 lint 退出成功，184 条既有警告和 1 条提示。初版曾发现按钮 type、装饰 SVG 可访问性及 ARIA 语义问题，已修复。
- 当前原生入口已实际启动；此前实际查看了展开内容与选择进入下一步。原生文本输入自动化被桌面交互保护中断，输入与完成闭环仍未验证。
- 台前调度、全屏应用、不抢其他应用焦点、多显示器切换的系统级行为仍待实际场景验收；源码配置和几何检查不代替这些验证。
- `dist/preview.png` 为本轮放大 Logo 后的实际网页截图；`preview-dark.png` 是上一轮截图。

最新体验仍待用户反馈。
