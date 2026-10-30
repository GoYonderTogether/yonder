# 聊天消息交互发版上线

2026-10-30，主人明确要求“合并 main 发版上线”。本记录承接 [源码验收](chat-message-ui-20261030.md)，不将源码/原型预览当生产验证。

## 发布源与授权

- 聊天实现 `6710c6b85f023355c233ad1f469f5219532d6652` 已在远端 main；社交后端分页提交 `08b3b5e0178b147b5c73ae3baddfe531a4dd8700`。
- `.14` 的 main 合回提交虽然在聊天实现之后，但实际标签 `87b6674` 不包含 `6710c6b`，不能复用它宣称聊天功能已发布。
- 按正式 `release.yml` 从 main `ca14d3f72461f0d9dbfd9c5c8974cb0967e78873` 发布 `.15`，没有手工改版本/标签。
- [Release workflow](https://github.com/GoYonderTogether/yonder/actions/runs/41057056859) 成功；[v0.3.26103015](https://github.com/GoYonderTogether/yonder/releases/tag/v0.3.26103015) 的标签 SHA 为 `74fc5c538ba67456b0f6dbdec6e9aa630eec47ff`，已核实包含聊天实现。
- 本机并行文档提交与 release 提交以普通 merge `aa274b5` 合回并推送，保留他人未提交样式、动画等工作树，不纳入版本产物。

## 部署前真实证据

- 已登录 Chrome 中真实聊天页仍为 AI 标签和常驻引用。
- 浏览器同源只读请求 `/api/conversations/GM7O0C/messages?limit=2`，HTTP 200，但返回 7 条、seq 1–7，证明旧后端未实施 limit。
- 根页/worker 由本机 app-live 快照经服务器 18052 隧道承载；实际 API/WS 由服务器 18051 上原 unit 承载。不能调用旧 prod 脚本而回滚已有后端补丁。

## 执行状态

最终 `.16 / 0ac066c` 已正式发布，网页和本机运行时均已更新并核验；社交后端分页已上线。`.15` 实际验收发现的快照问题已在 `.16` 修复并通过持续浏览器复验。源码、部署、安装和页面证据分列如下，未测与数据缺口见末节。

## 后端上线与真实分页

部署保留服务器实际旧源码及依赖，仅叠加 `08b3b5e` 的 11 行分页变更，未整仓覆盖远端已有补丁。实际承载 API 的原 unit 已切到 `/opt/yonder-card/backend/current/server`，本轮快照为 `/opt/yonder-card/backend/releases/chat-pagination-20261030-08b3b5e`，原 unit 与源码备份为 `/opt/yonder-card/backups/chat-pagination-20261030-08b3b5e`。旧源码同步 worker 未活跃，当前运行目录与旧开发目录隔离。`/api/session` 匿名检查精确为 `null`，unit active。新 `chat.ts` SHA256 为 `5e8329a7f94a151060f745ca3060e26ba6bf6cf3f5ed8e227c4985cab3ec9fad`。

主 Agent 使用已登录 Chrome，向同一真实会话发只读请求，未发送消息：

| 查询 | HTTP | 返回 seq | 条数 |
| --- | --- | --- | --- |
| `limit=2` | 200 | 6, 7 | 2 |
| `before=6&limit=2` | 200 | 4, 5 | 2 |
| `since=4&limit=2` | 200 | 5, 6 | 2 |
| `since=0`（旧调用） | 200 | 1–7 | 7 |

部署子任务曾误在共享仓库工作目录启动一次 `npm ci`，立即中止后按原 lockfile 恢复依赖（560 包、退出 0），未改源码。正式前端构建始终使用精确标签的独立发布快照，运行时更新器使用自己的版本安装目录。

## `.15` 安装与静态前端

- 已通过官方更新器安装 `.15`，实际 `service.info` 与 `install/current` 均为 `.15 / 74fc5c5`，pid 91603、ready=true；doctor 0 errors / 4 条既有 warnings。
- 第一次更新的服务控制 socket 在 30 秒窗口内尚未就绪，回执 `01M66DG28PP3NTGFKGBD2P6WPZ` 为 failed-or-unknown，不能以命令退出 0 宣称成功。随后服务自然就绪，通过已安装版本的既有 `verifyRelease()` 重试，回执 `01M66DJ3AFS14W05FGEXARCV3D` 为 verified=true，未额外重装/重启。
- 静态前端首次 nginx reload 后立即读取到旧 worker 的 `.13` 响应，部署事务如实回退；第二次有限轮询等待新 worker 后成功。当前目录 `/opt/yonder-card/web/releases/0.3.26103015-74fc5c538ba6-r2`，前态备份 `/opt/yonder-card/backups/chat-web-0.3.26103015-74fc5c538ba6-r2`。
- 公网 build-version 为 `.15 / 74fc5c5 / production`；HTML、worker 与精确标签构建逐字节一致，缺失 assets 返回 404。已停本机 app-live，公网仍正常，nginx 无 18052 引用。API/WS/console 路由保持原值。
- 精确标签首次直接构建 app 缺 gateway 协议声明而失败，按实际依赖图构建 gateway 后 `build:web` 和真实 API guard 通过，没有改源码或隐藏错误。

## 真实浏览器发现的快照问题

- 正式网页已显示 `bot` 标签，并通过主人工作桥展示真实完整主会话、工具、通知及飞书消息，不再只是七条社交记录。
- reload 后权威 ready 转录显示 2 个元数据入口、12 条普通气泡；实际键盘打开浮层，看到“运行时钟 · 正文前”“消息来源 · 正文前”“上下文注入 · 正文第 4 字后”，气泡正文没有 `<turn>`。
- 几秒后收到排队的全量 model snapshot，列表变为 200 项，元数据与渠道角标都消失。该现象重复复现，不能算详情交互通过。
- 根因：同一持久条目的转录 ID `t123` 和实时 model ID `123:0` 未对齐；snapshot 从空表重建，丢失 ready 的权威 prepared/来源，并把已加载窗口外的模型历史带回。最小修复由实现 Agent 负责：按真实条目 ID 合并、限制 snapshot 到已有原始分页边界，保留新消息、工具、通知、gap 和历史卸载语义；补真实 ready→queued snapshot 与相同正文不同 ID 不串元数据的回归。

## 补丁版本

- 最小修复提交 `5e8bca2303b9ccd4540cb72d6dcb3266e2b704c6` 已推送 main，仅共享 `useSession`、两个回归测试和 CHANGELOG。17 项定向检查、App 构建和类型检查通过；暂存时剔除另一并行任务的未提交 offlineCache 改动，保留其工作树。
- [补丁 Release workflow](https://github.com/GoYonderTogether/yonder/actions/runs/41059083542) 从精确 `5e8bca2` 执行并成功；[v0.3.26103016](https://github.com/GoYonderTogether/yonder/releases/tag/v0.3.26103016) 标签 SHA `0ac066c5807a2e5788119baecefeaecfae3a5a86`，确认包含该修复。发布时间 `2026-10-30T12:57:14Z`。
- `.16` 仅替换静态前端；已经验收的后端分页与其不可变快照保持原样。本机也通过正式更新器更新到同一版本。

## `.16` 最终安装与部署

- 前端 current `/opt/yonder-card/web/releases/0.3.26103016-0ac066c5807a`；previous 保留 `.15-r2`，备份 `/opt/yonder-card/backups/chat-snapshot-web-0.3.26103016-0ac066c5807a`。精确标签独立安装依赖、编译 gateway 依赖、`build:web`、66 文件真实 API guard 均退出 0；本次补丁部署无失败。
- 公网 metadata 为 `.16 / 0ac066c / production`，HTML 与精确构建逐字节一致（SHA256 `135bec238b6102c770207d802811a25f9a3e1c07b8997e758f0fad17c4228332`）。实际页面加载 `/assets/index-DJFgYWaQ.js`，旧 `.15` 入口 assets 仍返回 200。
- `.16` 切换仅原子更新静态指针：nginx 配置 SHA 前后相同，未 reload；后端 MainPID 1596293、chat.ts SHA、API/WS 路由保持不变，未重启或重新部署后端。
- 本机官方下载 `.16` 两次在 clone 阶段失败：先 curl 18 partial file/early EOF，进程级 HTTP/1.1 重试后为 SSL_ERROR_SYSCALL；均未切换旧 current。随后复用已从官方取得并核对 `0ac066c` 的精确标签 bare Git 缓存，仅给本次官方 update 进程配置 URL 重写，仍经正式 tag clone/build/doctor/切换/核验；没有读取开发脏树、改全局 Git/网络配置或改安装器。
- 最终官方更新回执 `01M66EGD2ZFXXR43PS62TKVZNV`，updateId `b988ab1c-f9a7-43e8-a06b-31801027df0f`：updated=true、verified=true、status=verified；本机 current、service.info 均为 `.16 / 0ac066c`，pid 14263、launcher 14127、ready=true、active=0。doctor 0 errors / 4 条既有 warnings。此轮无需额外补核/重启。
- release 提交已合入远端 main，热修来源也已 push。为保护并行尚未完成的 offline 任务，本机普通 merge `7194ed6` 只做版本对齐，未将本地未完成 offline 提交追加推到远端。本轮发布均以正式精确 tag 为准。

## `.16` 真实页面最终验收

主 Agent 使用已登录 Chrome 的独立后台窗口，没有发送测试聊天或调用模型，没有接管用户窗口焦点：

- 浏览器 metadata 与实际入口脚本确认 `.16`；聊天标题及列表显示 `bot`，主人真实完整主会话含工具、通知和飞书消息。
- 同一页面每 6 秒只读采样，共 18 秒：元数据入口始终 2 个、渠道角标始终 1 个；ready 的 23 项经原生快照归一为 16 项，详情和来源持续保留，不再重建为 200 项无来源消息。
- 实际飞书角标 hover 显示来源浮层、飞书名称及复制按钮。未写入用户剪贴板。
- 键盘打开元数据浮层，三节仍为运行时钟/消息来源在正文前、上下文注入在正文第 4 字后；气泡中没有原始 `<turn>`。
- 鼠标在消息行外时发送时间 opacity=0，移入整行时为 1，time.top 始终 `422.84722900390625`，没有气泡位置跳动。
- 桌面右键实际出现“引用/复制”；点引用出现可取消引用预览，常驻“引用这条消息”按钮数量为 0；随后取消，没有发送。
- iPhone 14 触屏模拟 390×844：viewport/body/main 宽均 390，元数据及渠道入口保留，没有横向溢出。该证据是浏览器模拟，不是真手机长按验收。
- 本机 `.16` 官方更新完成后唯一一次最终连接确认：标题“贾维斯bot在线”，元数据入口 2、渠道角标 1、消息项 16，公网 build metadata 仍 `.16 / 0ac066c / production`。
- 实际截图：[桌面](/tmp/yonder-chat-online-16-desktop.png)、[手机](/tmp/yonder-chat-online-16-mobile.png)。已恢复模拟设置并结束浏览器测试会话；本轮本地 5190 原型预览也已停止。

## 留存与边界

- 原始 `.15` 安装失败/补核、两次网络失败、首轮静态切换回退及误 cwd 依赖安装纠正均保留，未用最终成功覆盖失败事实。
- 分线原始报告：`/tmp/yonder-chat-runtime-report.md`、`/tmp/yonder-chat-deploy-report.md`、`/tmp/yonder-chat-deploy-report-0.3.26103016.md`。正式 Release 两次均 success，不等同全仓测试全绿；源码全套原始结果见前一份验收记录。
- 保留既有能力边界：没有伪造 QQ 可见群号/缺失群名，渠道仍沿用中性图标；后置上下文的各插件独立名称未持久化，不能恢复。真手机长按、实际剪贴板写入、跨渠道引用发送没有本轮新增端到端测试。
- 最终可回退静态前端至保存的 `.15-r2`，不必改后端或 nginx；后端原源码/unit 与两次静态备份均保留，数据库和凭据未变。
