# X4 独立浏览器和桌面结果

主路补记：1907已正式发行、安装并启用本插件；加载与配置证据见[整轮结果](execution-capabilities-result.md)。键鼠实操仍未测，浏览器引擎和系统授权仍为前提。

分路原交接（2026-10-19）：已实现、完成真实headless浏览器与macOS后台屏幕验证，待主路发行整合；未提交、切分支或推送。只改plugins/native-automation/**与本文件。

## 实现和整合入口

独立插件包`@yonder/plugin-native-automation`，id `native-automation`，注册工具`native-automation_browser`、`native-automation_desktop`，trigger `native-automation-cleanup`。直接依赖为`playwright-core`精确1.64.1、既有`typebox`1.3.27与`@yonder/sdk`。主路负责根workspace引用/lock/版本/发行清单；本分路不改旧BrowserSkill/Codex插件。

浏览器直接使用成熟官方Playwright，不自造CDP。自动检测本机Chrome、Edge、Chromium、Playwright Chromium；无配置自动headless启动自有浏览器，按session隔离context/cookies/pages，调用间保留当前page。完整动作：状态、导航、ARIA snapshot、点击、填表、按键、选择、截图、evaluate、tabs增删切换、前后/刷新、关闭。危险page evaluate和所有浏览器动作保守要求exec/read/write/network/message，不给readonly任意JS或页面写/发消息通路。操作串行，取消关闭本session browser、session close/stop清理自有browser，不触碰用户浏览器profile/登录。

桌面使用macOS原生JXA/CoreGraphics/System Events和screencapture；提供权限状态、前台应用/窗口标题观测、屏幕截图、鼠标移动/左右点击/拖拽、Unicode输入和物理keyCode+修饰键。需要exec/read/write/message，拒绝非node:local；固定原生操作而非任意osascript/shell。屏幕录制/辅助功能/Automation不足时返回真实诊断，不绕过、不主动激活应用。全局display points与Retina screenshot pixels区别已说明。

截图均为真实工具images并保存插件data/artifacts下PNG，图像20MB上限；snapshot/evaluate JSON 50K字符，native stdout 1MB、stderr尾部10K。session close/stop终止自有native子进程，保留已有artifact。浏览器/子进程只属于当前会话。

参考已读本地Hermes的`hermes_cli/clipboard.py`和`tools/terminal_tool_macos_open.py`，OpenClaw的`extensions/browser/src/browser/pw-session-actions.ts`、`pw-tools-core.snapshot.ts`；无复制源码模块，MIT归属与官方Playwright Apache-2.0说明见插件NOTICE.md，没有引入其他Agent运行核心。

## 实际检查和证据

- `./node_modules/.bin/tsc -b plugins/native-automation`：通过。首次因主路SDK新增execution而testing暂缺字段、以及尚未安装playwright而失败；依赖安装及共享代码完成后通过，没有改共享路径。
- `./node_modules/.bin/biome check --write plugins/native-automation/src ...`：通过，最终无warning/error。
- `YONDER_KEEP_ARTIFACTS=1 node plugins/native-automation/test/integration.mjs`：通过。自动检测本机Chrome启动headless，真实本地HTTP表单导航→ARIA snapshot→填写带中文/时间的文本→点击提交→服务端实际收到同值→evaluate读取实际DOM→截图PNG，另验证session隔离、readonly拒绝、取消关闭、session.close与stop。
- 已亲自读取真实浏览器截图，显示Submission received与实际提交中文/时间，1280×800；路径 `/var/folders/hg/8kf929p12wz498k8q4r74kg00000gn/T/yonder-native-check-T8Vhmo/artifacts/1ac0f28c-b764-4870-9432-fc4b238d3568.png`。
- macOS非交互权限probe实际返回screenCapture=true/accessibility=true；后台screencapture已真实返回PNG并保存，未操作鼠标/键盘、未激活应用。最初JXA metadata未暴露CGPreflightScreenCaptureAccess，已用系统ObjC.bindFunction绑定后真实复测通过。
- 测试不调用模型、不复制任何账号、不依赖BrowserSkill/Codex/ChatGPT。测试使用注册API收集器承载真实工具调用，浏览器和桌面均为本机真实进程。

## 问题与未测

- playwright-core仅提供驱动，不打包浏览器。当前本机Chrome/Edge存在；无引擎时提示明确安装流程。系统Safari不提供Chromium CDP，本实现不声称支持Safari；若无Chromium须显式安装引擎，不能称完全无依赖。
- 未实测：真实用户桌面的键鼠输入、拖拽、System Events窗口/Unicode输入授权；用户只批准后台屏幕观测，未抢用户焦点。原生方法真实存在性已检查，但不是输入验收通过。
- 未测：其他操作系统、真实外网/登录站点、Edge及Playwright下载引擎分支、Retina多屏实际坐标输入、无权限场景在另一未授权宿主的重现；未以API存在代替这些验收。
- 根整合、全仓检查、安装和真实模型自主调用归主路，不在本分路声明已完成。

## 停止等待修复（同日主路复核）

主路发现真实缺陷：session.close/trigger.stop原先仅child.kill后返回，不能证明native子进程已退出。现复用desktop.children Map的原close生命周期，先注册close等待，再SIGTERM，清理阶段1秒仍未退出则SIGKILL，await close后才完成停止；普通调用没有新增硬超时。session.close只等待所属子进程，trigger.stop等待全部自有子进程；Map仍由native原close监听删除，没有另建管理器。

新增最小真实检查 `node plugins/native-automation/test/cleanup.mjs`：启动两个真实长Node子进程，session.close等待第一个PID消失且保留其他session；另一个显式忽略SIGTERM，stop实际升级SIGKILL并等到close，最终children Map为空、两个PID均ESRCH。该检查通过；本次单包tsc和改动路径Biome通过。没有重复已过浏览器/桌面矩阵，没有展开其他审查。

## 实际loader注册名修复（同日主路checkPlugin发现）

保留失败证据：此前真实浏览器/桌面检查直接module.setup到collector，没有经过SDK loader注册名校验；主路checkPlugin实际发现原native_browser/native_desktop缺少pluginId前缀被拒绝，原PASS不等于插件可加载。

现统一源码注册、manifest contributes、README、测试调用与本结果当前名称为`native-automation_browser`/`native-automation_desktop`，不改主路统一的1907版本、根或SDK。先完成两个包tsc，再真实SDK `checkPlugin('plugins/native-automation')` 返回`[]`。受名称影响的`test/integration.mjs`重新执行PASS（真实Chrome本地表单/截图/隔离/取消、macOS后台权限和截图）；原cleanup.mjs不使用工具名称，本次未重复运行。Biome格式检查修正新长名称格式后通过。本次仅证明loader契约与直接工具运行，正式安装/模型调用交主路。
