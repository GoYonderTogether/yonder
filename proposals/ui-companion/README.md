# Yonder 交互小窗原型

菜单栏小窗、项目共享角色与真实本地交互。2026-10-22 用户确认做体验原型，随后明确沿用 ai-card Web 风格，并将信息与操作收敛到交互流程。

## 运行

```sh
node proposals/ui-companion/build.mjs --native --serve
```

浏览器打开 `http://127.0.0.1:62735/`；macOS 打开 `proposals/ui-companion/dist/Yonder UI Prototype.app`。

独立菜单栏图标带“试”字，左键开关小窗，右键退出。启动时显示小窗，不注册登录项，不改正式 Harness 服务。窗口为 400 × 460，内容超出时内部滚动。

## 体验路径

1. 主界面只展示本次任务的三个选择；点击即保存，进入下一步。
2. 下一步可补充想法。输入时角色倾听，草稿自动保留；“完成”保存后收起。
3. 手动收起保留当前填写状态。刷新恢复已有草稿；历史从“更多 → 已保存”查看。
4. “更多”也可保持窗口打开或阅读原型说明。主题跟随系统，减少动态效果时使用静态 Logo。

角色来自唯一品牌源 `brand/src/yonder-mark.js`，构建时直接内联，没有复制或修改几何与动效。点击角色可预览状态，这些是 UI 动效，不代表模型运行或录音。

记录使用 localStorage，浏览器与原生 WebView 分开保存；清理网站数据会移除记录。浏览器使用固定本地端口；原生记录依赖当前 bundle 路径。尚未接入 Agent 回传、语音、主动唤起、渠道图片生成或远程服务。

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
- 状态自检通过：草稿恢复、选择去重、反馈保存、无效输入。
- 初次原型 lint 暴露按钮 type、装饰 SVG 可访问性及 ARIA 语义问题；已修复。最终原型 Biome 检查通过，无警告。
- 浏览器实际操作：选择→补充→完成收起→重新打开、刷新恢复草稿、从更多查历史均通过。390px 深色/减少动态效果、768px 浅色、1280px 浅色已查看。
- 最终全仓 lint 退出成功，184 条既有警告和 1 条提示；本次原型单独检查无警告。
- 原生构建通过，首次启动可见、角色渲染、选择进入补充页已实际验证；旧版的保存收起也已验证。精简版的原生文本输入自动化被桌面交互保护中断，尚未确认原生输入与完成闭环，不能用网页验证替代。
- `dist/preview.png` 与 `dist/preview-dark.png` 是实际网页截图。原生菜单栏点击、点击窗口外自动收起和多桌面行为仍待人工验收。

用户已确认初版视觉方向；最新精简版的用户体验验收待反馈。
