# 聊天消息交互与完整转录

日期：2026-10-30。用户本轮要求实现，主 Agent 负责规约与验收，子 Agent 在 main 修改代码。设计边界见 spec/19 §6。

## 目标和范围

聊天列表标签改为 `bot`，他人的 Bot 显示真实主人名称；消息右键/长按引用、整行悬停时间、五分钟/跨天分隔及系统消息；主人设备 Bot 私聊复用工作页完整主会话；渠道角标可查阅和复制真实来源；按原位置、顺序查看隐藏的固定注入元数据；滚动拉取并卸载历史，限制数据和渲染数量。保留普通社交权限和现有布局，不新增模型调用、会话副本或依赖。

服务端必要分页改动位于独立仓库 `/Users/zoran/Documents/yonder-card-web/server`，保留旧 `since` 同步。主仓库 `/Users/zoran/Documents/yonder-harness` 是 `/Users/zoran/Documents/yonder` 的符号链接。两仓均为 main。

## 初始证据

- 真实已登录网页 `https://yonder.zethai.cn/c/GM7O0C` 中，贾维斯 DM 显示七条社交消息，每条有常驻“引用”，列表和标题为 AI 标签。后台 browser-skill 会话读取，没有发送消息。
- 工作页已有 `useSession`、`Transcript`、`useMenuTrigger`、`ActionMenu`，社交页未复用完整转录。
- 原社交 GET messages 为 `since=0` 全量读取，SQL 无 LIMIT。原 `TranscriptItem` 不投影准备编辑，缺时间与真实注入详情。
- 现有正式前端服务来自 `/Users/zoran/.local/share/yonder-web-releases/hotfix-13-app-5c2a1dd`，不是当前 checkout；修改源码不会自动改变线上前端。生产服务、后端和日用安装本轮未更新。

## 验收清单

- [x] 标签与引用菜单，键盘入口；复用既有触屏长按逻辑（真手机长按未测）。
- [x] 行悬停时间、时间分隔、系统/外部输入区分（源码/专项测试）。
- [x] 主人设备主会话与他人 Bot 的权限区分（源码/专项测试）。
- [x] 真实准备编辑投影和正文保护、按顺序位置查看元数据（真实 SQLite 集成）。
- [x] 来源浮层悬停与复制，未知名称及 QQ OpenID 不伪装群号（源码；线上未测）。
- [x] 有界历史、空原始分页、卸载恢复、历史阅读期间新消息及滚动锚点（专项测试；长历史线上未测）。
- [x] 执行项目强制 build、typecheck、test、lint，保留原始失败与跳过；全套不是全绿，见下文。
- [x] 当前页面实际运行预览；源码、原型和生产证据分别记录。

## 已完成与实际页面证据

- 社交消息窗口最多 120 条，完整会话窗口最多 200 条；历史卸载只保留游标，返回最新时重新同步。原始转录游标独立于可见行，空页与仅有内部条目的页可继续前进。社交序号缺口的空页终止已补组件回归。
- 真实 `prepareInput` → SQLite `yonder.prepared` 编辑 → 转录投影 → 消息详情的定向检查通过，覆盖准备条目跨分页边界，不更改原模型输入。原始用户 XML 正文保留。
- 后台 Chrome 在当前源码独立端口 `http://127.0.0.1:5190/` 使用已有 mock API，仅用于交互布局预览，没有发送聊天消息。已实际打开桌面右键菜单、选引用并看到输入框引用预览；键盘聚焦“消息操作”按 Enter 可打开同菜单；整行 hover 前后时间 opacity 从 0 到 1，top 坐标不变。390×844 触屏模拟下无横向溢出，常驻引用按钮已消失。没有宣称真手机长按或真实完整主会话验收。
- 本地截图：[桌面](/tmp/yonder-chat-after-desktop.png)、[手机](/tmp/yonder-chat-after-mobile.png)。原型横幅保留，不能作为生产数据证据。
- 独立社交后端 main 提交 `08b3b5e0178b147b5c73ae3baddfe531a4dd8700`，真实 PostgreSQL/Redis 测试 137 通过 / 0 失败，未 push、未部署；旧 since-only 调用保留原语义。

## 检查原始记录

- 子 Agent 定向最终 9 文件 / 39 用例通过；另社交组件与分页检查 4/4 通过。真实 prepared 集成曾因 import 路径错误发生 1 suite 失败 / 16 用例通过，修正后又有 1 个缺少 SQLite commit_seq 的用例失败，修正后 18/18 通过；社交组件初次 2 失败（测试宿主缺 location）后 4/4 通过。保留这些原始失败，不以最后通过覆盖。
- 主 Agent `npm run build` 退出 0；SDK 必要分拆后 `npm run typecheck` 再次退出 0。`npm run check:dist` 退出 0。
- 首次 `npm run lint` 的 Biome 无错误（867 warning / 30 info），行数门槛失败：新增可选字段使 sdk/types.ts 达 504 行。`TranscriptItem` 移至既有 messages.ts 并保留导出兼容后，最终 `npm run lint` 退出 0，11 项基线未增长；没有调高阈值。
- 全仓 `npm test` 退出 1，原始计数：404 文件通过 / 5 失败 / 62 跳过；2168 用例通过 / 5 失败 / 101 跳过。失败为 `packages/design/test/tokens.test.ts`（现有并行 CSS 与 TS tokens 不一致）、`paRedirect`（路由仍为 /pa）、`migrate`（20 秒超时）、`permission-actions`（导出 20 秒超时）、`tasks/moments`（轮询未及时得到请求）。耗时 200.35 秒。
- 仅将这 5 文件以 `--maxWorkers=1` 定向复跑：4 文件通过 / 1 失败；153 用例通过 / 1 失败 / 1 跳过。路由、迁移、导出和 moments 通过；唯一稳定失败为 token 一致性。后者对应任务开始前已有的 `packages/design/src/tokens.css` 改动，本轮未改该文件或削弱断言。不以定向结果改写全仓原始失败。
- 日志 `/tmp/yonder-chat-test.log`、`/tmp/yonder-chat-failures-rerun.log`；构建、最终类型和 lint 日志分别在 `/tmp/yonder-chat-build.log`、`/tmp/yonder-chat-typecheck-final.log`、`/tmp/yonder-chat-lint-final.log`。本轮没有运行真实模型测试。

## 未完成与事实限制

线上前端、社交服务后端及日用网关未部署更新；真实账号下新版完整转录、注入详情、跨渠道来源浮层、长历史滚动尚未端到端验证。界面“完整会话暂不可用”不冒充显示全部历史。QQ 官方会话 OpenID 不是可见群号；缺失群名/群号不编造。渠道沿用现有中性图标，未新增品牌 Logo。已持久化的后置上下文是合并字符串，能保持原顺序和正文后位置，不能恢复各插件独立名称。
