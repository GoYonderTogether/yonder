# Yonder UI Companion

已确认的小窗现为独立 SDK 插件，源码从 proposals/ui-companion 迁入此目录。保留 ai-card Web 风格、唯一共享品牌角色、同锚点展开/收起、大区域拖拽与历史回溯。

## 加载

在仓库运行 `npm run build`，会编译 TypeScript、构建离线 Web 页面，并在 macOS 编译主仓库唯一的 `packages/macos/dist/YonderStatus.app`。无需新增下载依赖。非 macOS 跳过状态栏宿主，仍提供网页。

新 home 默认加载官方插件；已有 home 在 CLI start 时补齐，已有配置与 desktop:false 保留。开发时可用现有 CLI 指向本目录：

```sh
yonder plugins add /absolute/path/to/yonder-harness/plugins/ui-companion --home /absolute/path/to/home
```

也可以在目标 home 的 yonder.yaml 加入：

```yaml
plugins:
  - use: /absolute/path/to/yonder-harness/plugins/ui-companion
    config:
      desktop: true
```

在实际 Agent 的 defaults.plugins 或配置档 plugins 选入 ui-companion，tools.offer 选 `ui-companion_*`；呈现需要 message，读取需要 read。安装插件不会自动扩大任何 Agent 的工具权限。使用既有重启方式加载代码。

## 真实调用闭环

1. Agent 调用 `ui-companion_present({card})`。插件校验并持久化，返回 id、url、noticeUrl、inlineUrl。macOS 由现有状态栏宿主读取插件发布的私有 desktop.json，待办先显示悬浮入口；desktop:false 不发布桌面入口，仅提供网页，用户或可信宿主自行打开返回的 URL。
2. Agent 调用 `ui-companion_result({id,wait:true})`。等待使用 Harness 原有工具/后台执行生命周期；wait:false 查询当前状态。
3. 用户选择或填写内容。服务以请求 id 和步骤序号接纳答案，拒绝重复和过期步骤；卡片有 next 时进入下一步。
4. 完成默认隐藏浮窗与浮球，无待处理任务时不在桌面留入口；菜单栏仍可打开历史。result 返回 completed 和真实 steps（原卡片、选择 value、可读 answer、时间 at）。autoClose:false 保留窗口。交互只回到创建它的 session/agent/profile，不向其他 Agent 伪造事件或自动唤醒。

card 必填：id、title、prompt、kind（choice/form）；choice 必须有 options（唯一 id、label）。可选 next 是下一张 card，可选 autoClose 默认 true。没有固定示例任务或模拟 Agent 回复。

取消等待保留卡片，可再次查询；session.close 取消该会话的未完成卡片。关闭小窗只收起，不代替取消。服务停止唤醒等待者并关闭监听器并清理自身 desktop.json；状态栏随之关闭旧交互页面。插件 data 目录的 interactions.json 保存队列和原始步骤，重启恢复；浏览器本地数据只保存展示状态和未提交草稿，清理网站数据不会删除服务端交互记录。

## 窗口与宿主

- 窗口与 56×56 悬浮入口共用边角锚点，拖动后再次展开不跳位。Logo 视图 52×52，原生使用高清品牌图。位置在当前宿主运行期间保留。
- 首次放在离指针较远的角落，之后尊重用户位置；不读取其他应用内容。空白区域和入口均可拖拽。
- 左键状态栏图标切换当前交互，无待办时查看历史；右键提供当前交互、历史、服务状态、检查更新及停止服务并退出。未启用插件时仍能管理服务，且交互入口显示未就绪。
- 状态栏原生 NSPanel 使用 nonactivatingPanel、orderFrontRegardless、becomesKeyOnlyIfNeeded，不在出现时激活应用。macOS 13+ canJoinAllApplications 用于台前调度集合，另设 canJoinAllSpaces/fullScreenAuxiliary；Space 切换收起入口。系统级焦点、全屏/台前调度与多屏行为仍需实际验收。
- url 是独立窗，noticeUrl 为页面浮窗提醒，inlineUrl 为无品牌核心内容且保留完成结果。支持 iframe 的本地 Web/聊天宿主可嵌入同一 URL；没有自动接入第三方 IM 或图片渠道。
- 回环 URL 含每次启动随机路径，是本机交互访问凭据；只交给用户或可信本地宿主，不公开传播。服务器验证 Host、Origin、内容类型、体积和步骤。它不执行任意生成的 HTML 或脚本；卡片答案不构成其他工具的权限放行。

## 风格和品牌

直接沿用 `yonder-card-web` 的 DESIGN.md、src/styles.css、Button/Field（参考 1c5b692aa5ff40de9ee9c8105f96a564fb38aa98）：浅深色令牌、Geist、字号/圆角/阴影/曲线。未改 ai-card 工程；字体许可在 web/assets/Geist-LICENSE。正式共享样式源尚未抽包。

角色构建时直接内联本仓库 brand/src/yonder-mark.js；输入倾听、完成反馈，不代表录音或模型状态。减少动态效果时显示静态 Logo。[OpenUI](https://www.openui.com/demos) 与 [assistant-ui](https://www.assistant-ui.com/elements) 仅作渐进交互参考，未引入其运行时。

## 验证

以下为开发阶段的原始验证记录，正式发布验收追加在末尾，未测项不因发版自动通过。

```sh
node plugins/ui-companion/test/state.mjs
npx vitest run plugins/ui-companion/test/contract.test.ts
npm run build && npm run typecheck && npm test && npm run lint
```

隔离分支 zoran/ui-companion-prototype；主工作区未提交的 channel-card 改动未触碰。原型旧提交保留在 Git 历史中，源码不保留双实现。

- 原型迁移前基线：52 文件通过/11 跳过，195 测试通过/23 跳过，0 失败。
- 首次插件聚焦检查：2 失败；配置省略读取和源码测试资产路径发现问题，均修复。迁移时状态自检首次因测试导入替换误删实参失败，已修正，后续通过。
- 首次插件全仓：52 文件通过/1 失败/11 跳过，195 测试通过/2 失败/23 跳过；与上述配置/资产问题相同。
- 修复后聚焦插件：2/2 通过。第二轮全仓：50 文件通过/3 失败/11 跳过，192 测试通过/5 失败/23 跳过；失败均为未修改的 CLI/微信用例 5 秒超时。以 maxWorkers=2 聚焦同三文件及插件：4 文件通过，13 测试通过/1 跳过，0 失败。未放宽断言或超时。
- 状态及原生几何自检通过；包括默认收起、宿主保留、恢复、历史快照、重复/越权答案、取消等待、会话关闭及重启恢复。
- 使用真实 Harness 插件加载器和注册工具启动，浏览器实际选择→填写→收起，result 工具拿到真实界面提交的两步答案；这不等于模型自主使用验收。
- 原生实际选择按钮→结果工具收到 confirm→自动收起闭环通过。原生文本输入、台前调度/全屏/多屏及其他应用焦点保持仍待人工实际验收。
- 没有调用模型；真实模型自主选用与已安装正式服务验收未测。

- 最终全仓以 maxWorkers=4 完整运行：53 文件通过/11 跳过，197 测试通过/23 跳过，0 失败；未改断言或超时。构建/typecheck 通过，lint 184 条既有警告和 1 条提示，插件单独检查无警告。

- 完成后全隐藏修订：构建/typecheck 通过，全仓仍为 53 文件通过/11 跳过，197 测试通过/23 跳过；实际提交后 result 返回 completed，网页 DOM 确认 panel 与 reopen 均 hidden。原生按待处理状态决定是否保留悬浮入口，菜单栏仍可回溯。

2026-10-23 状态栏归属合并：移除插件独立 App、进程启动与 NSStatusItem；唯一原生宿主在 packages/macos，插件只发布同 home 的回环端点。未安装/启用插件时服务菜单独立可用。既往独立宿主验证不代替本轮统一宿主验证。

统一状态栏本轮验证：原生编译、端点校验、单实例文件锁、几何自检通过；首次编译因自检局部变量同名失败，已更名并重新构建通过。全仓 53 文件通过/11 跳过，198 测试通过/23 跳过，0 失败；typecheck 通过，lint 为 184 条既有警告和 1 条提示。插件端点发布、0600 权限、停止清理及 desktop:false 均有真实回环测试。已实际启动 YonderStatus 唯一宿主并展开来自真实插件的卡片，网页提交回传工具成功；菜单左右键和真实更新/退出的人工验收仍待完成，自动化访问系统菜单栏超时，未执行停止正式服务。

已 fast-forward 合入主工作区 yonder/card-plugin（包含 f4a59df）。保留原有未提交 channel-card 改动，重叠文件另有恢复 stash。合并后主工作区构建/typecheck 通过；56 文件通过/11 跳过，221 测试通过/23 跳过，0 失败。全仓 lint 退出成功，202 警告和 1 提示（包含原有名片修改）；本次插件与构建脚本单独检查无警告。验证进程已关闭，桌面恢复原正式状态栏，未替换正式安装版或停止 harness 服务。

## 0.2.26102302 发布候选验证

基于当前正式主线 0e97c70，仅移植已确认 UI 功能及其必需品牌资源，不包含未提交的 channel-card 或 card-studio。npm ci、构建、typecheck 通过；默认全仓 97 文件通过/17 跳过，413 测试通过/36 跳过，0 失败；未调用真实模型。lint 退出成功（323 警告、13 提示），本次新增源码单独检查无警告。系统级全屏、台前调度以及菜单左右键真人验收仍未完成，发版不改变此边界。

## 0.2.26102303 默认就绪修复验证

本机旧 home 已补入官方插件并重启；runtimeLoaded 为 true，端点返回 HTTP 200。新 home、缺插件的旧 home 与 desktop:false 均通过真实内核/CLI 子进程回归，Agent 配置未变。全仓 97 文件通过/17 跳过，414 测试通过/36 跳过，0 失败；build、typecheck、lint 通过（323 条既有警告、13 条提示），权限自检 36 通过/0 失败。默认测试未启用真实模型；状态栏鼠标与全屏/台前调度人工体验未在本轮验证。
