# 官方插件功能清单

本清单区分“贡献槽位”“监听事件”“外部输入”“可调用功能”。下列短句描述已存在的功能体。工具实际名称带插件ID前缀；浏览器动作是工具参数，MCP操作是外部协议能力，不混称核心模型工具。

核心原生工具、CLI 与 SDK 的注册名见[功能与注册名参考](reference.md)。

## 01 channel-cli：本地消息通道

- **包**：`@yonder/plugin-channel-cli`
- **源码**：[入口](../plugins/channel-cli/src/index.ts)
- **贡献**：
  - 渠道 `cli`：type="cli" · dm · Unix socket
- **订阅事件**：无
- **外部输入**：Unix socket 上的文本或分帧输入
- **可调用工具**：无
- **功能**：
  - 接收：从Unix socket接收文本或分帧输入，生成带本地账号/会话来源的消息事件。
  - 多行输入：将一帧多行文本作为一条输入提交。
  - 发送：向连接中的终端交付文字或流式输出片段。
  - 生命周期：启动时监听socket，停止时关闭连接并清理本插件socket。
  - 连接边界：每实例同一时刻接纳一个通道客户端，不能把全局单服务解释成无限并发CLI连接。
- **边界**：TUI、补全、管理命令在 `packages/cli/`；本通道不提供附件发送，控制接口的附件能力另计。

## 02 context-files：工作区上下文

- **包**：`@yonder/plugin-context-files`
- **源码**：[入口](../plugins/context-files/src/index.ts)
- **贡献**：
  - 上下文（placement=system）：
    - `agents-md`：按选择读取AGENTS.md，提供工作规则。
    - `user-md`：按选择读取USER.md，提供用户资料。
    - `soul-md`：按选择读取SOUL.md，提供agent行为设定。
    - `memory-md`：按选择读取MEMORY.md，提供已存文本。
- **订阅事件**：无
- **外部输入**：按选择读取的 AGENTS.md、USER.md、SOUL.md、MEMORY.md 文件
- **可调用工具**：无
- **功能**：
  - 文件准备：仅为选中的上下文按现有模板补初始文件。
- **边界**：本插件不检索、提炼或自动更新长期记忆。

## 03 channel-mcp：外部agent控制入口

- **包**：`@yonder/plugin-channel-mcp`
- **源码**：[协议入口](../plugins/channel-mcp/src/index.ts)、[操作实现](../plugins/channel-mcp/src/operations.ts)
- **贡献**：
  - 渠道 `mcp`：type="mcp" · loopback HTTP /mcp · Streamable HTTP/SSE
  - MCP server 工具（`server.registerTool` 注册的外部控制接口，不是模型 `tools.register`），见下
- **订阅事件**：无
- **外部输入**：loopback `/mcp` 的Streamable HTTP/SSE请求，使用Bearer与Host/Origin约束。
- **可调用工具**（MCP server 工具，名称带前缀 `channel-mcp_`）：
  - `channel-mcp_events_emit`：接纳事件并返回事件标识，不等待模型执行。
  - `channel-mcp_events_ask`：提交事件并等待绑定运行的原生结果。
  - `channel-mcp_events_query`：按条件分页读取事件账本。
  - `channel-mcp_sessions_list`：筛选并列出持久会话。
  - `channel-mcp_sessions_get`：读取指定会话元数据。
  - `channel-mcp_sessions_open`：按已有preset打开会话。
  - `channel-mcp_sessions_submit`：向preset会话提交输入，并按参数等待或立即返回。
  - `channel-mcp_sessions_watch`：被动观察已有运行进度，观察连接断开不取消任务。
  - `channel-mcp_sessions_abort`：显式取消会话运行及相应排队输入。
  - `channel-mcp_sessions_close`：关闭指定会话。
  - `channel-mcp_sessions_transcript`：分页读取原生转录条目。
  - `channel-mcp_identity_account`：读取渠道账号身份。
  - `channel-mcp_identity_person`：读取统一人物身份。
  - `channel-mcp_identity_lookup`：按已知标识查询身份映射。
  - `channel-mcp_identity_relation`：读取身份关系。
  - `channel-mcp_identity_createPerson`：创建统一人物记录。
  - `channel-mcp_identity_link`：在权限允许时建立账号与人物映射。
  - `channel-mcp_identity_unlink`：在权限允许时解除身份映射。
  - `channel-mcp_messages_send`：通过共享投递入口向指定人、账号或会话发送消息及附件。
- **边界**：本插件不连接任意MCP服务器；渠道的主动send不提供远端推送，结果经ask、watch或事件查询取回。

## 04 browser-skill：浏览器操作

- **包**：`@yonder/plugin-browser-skill`
- **源码**：[入口](../plugins/browser-skill/src/index.ts)、[动作](../plugins/browser-skill/src/operations.ts)
- **贡献**：
  - 工具：`browser-skill_setup`、`browser-skill_session`、`browser-skill_page`、`browser-skill_inspect`、`browser-skill_interact`、`browser-skill_tabs`、`browser-skill_file`，动作见下
  - skill `browser-skill`：BrowserSkill使用指导，按需读取
  - 触发器 `browser-skill-cleanup`：启停时清理已有归属资源与本插件runner；不是cron
- **订阅事件**：`session.close`，清理该会话拥有的浏览器资源
- **外部输入**：bsk守护服务与Chrome扩展
- **可调用工具**：
  - `browser-skill_setup.status`：检查bsk、守护服务和扩展连接状态。
  - `browser-skill_setup.start-daemon`：启动本地浏览器守护服务。
  - `browser-skill_setup.guide`：提供扩展安装与配置引导，按明确选项打开页面。
  - `browser-skill_session.start`：为当前agent会话建立浏览器会话。
  - `browser-skill_session.stop`：结束本会话拥有的浏览器会话。
  - `browser-skill_session.list`：列出归属当前agent的浏览器会话。
  - `browser-skill_page.navigate`：将当前页面导航到指定URL。
  - `browser-skill_page.back`：返回上一页。
  - `browser-skill_page.forward`：前进到下一页。
  - `browser-skill_page.reload`：重新加载当前页。
  - `browser-skill_page.wait`：等待页面导航达到指定状态。
  - `browser-skill_page.wait-for-element`：等待指定页面元素出现。
  - `browser-skill_inspect.observe`：读取可操作的页面观察结果。
  - `browser-skill_inspect.snapshot`：读取页面结构快照。
  - `browser-skill_inspect.html`：读取目标页面HTML。
  - `browser-skill_inspect.screenshot`：生成页面截图。
  - `browser-skill_inspect.console`：读取页面控制台记录。
  - `browser-skill_inspect.network`：读取页面网络记录。
  - `browser-skill_interact.click`：点击指定页面目标。
  - `browser-skill_interact.fill`：填写指定输入框。
  - `browser-skill_interact.select`：设置选择控件的选项。
  - `browser-skill_interact.press`：发送按键。
  - `browser-skill_interact.hover`：将指针移到指定目标。
  - `browser-skill_interact.wheel`：执行滚轮操作。
  - `browser-skill_interact.scroll-to`：滚动到指定目标。
  - `browser-skill_interact.focus`：聚焦目标元素。
  - `browser-skill_interact.blur`：取消目标元素焦点。
  - `browser-skill_interact.resize`：调整浏览器窗口尺寸。
  - `browser-skill_interact.emulate`：设置已有浏览器模拟参数。
  - `browser-skill_interact.request-help`：请求用户协助处理当前浏览器步骤。
  - `browser-skill_tabs.list`：列出可用标签页。
  - `browser-skill_tabs.create`：创建标签页。
  - `browser-skill_tabs.select`：选择工作标签页。
  - `browser-skill_tabs.close`：关闭指定标签页。
  - `browser-skill_tabs.borrow`：按现有协议借用用户标签页。
  - `browser-skill_tabs.return`：归还借用的标签页。
  - `browser-skill_file.upload`：向页面上传指定文件。
  - `browser-skill_file.download`：取得页面触发的下载产物。
- **边界**：外部浏览器状态来自bsk守护服务和Chrome扩展，不是另一个内部消息订阅。

## 05 codex-tools：本机桌面与hosted搜索

- **包**：`@yonder/plugin-codex-tools`
- **源码**：[入口](../plugins/codex-tools/src/index.ts)
- **贡献**：
  - 工具：`codex-tools_status`、`codex-tools_js`、`codex-tools_js_reset`、`codex-tools_search`，见下
  - 触发器 `codex-tools-lifecycle`：管理本插件app-server资源生命周期（启动/停止时）
- **订阅事件**：`run.end`，释放对应会话app-server资源；释放当前run的JS绑定与连接
- **外部输入**：本机CUA说明与schema（由 `codex-tools_status` 发现）；本机Codex hosted search（由 `codex-tools_search` 调用）
- **可调用工具**：
  - `codex-tools_status`：发现本机CUA说明与schema，报告可用入口。
  - `codex-tools_js`：通过本机CUA执行应用发现、界面读取、截图或操作。
  - `codex-tools_js_reset`：清空JS绑定，保留已经发生的应用操作。
  - `codex-tools_search`：调用本机Codex hosted search并返回来源和原生证据。
- **边界**：状态发现不等于系统授权通过；首次JS须遵守原生单入口约束。浏览器优先BrowserSkill；跨运行JS变量不能承诺持久。搜索桥接不复制Yonder OAuth，内部模型和供应商按实际记录说明。

## 06 web-tools：搜索与网页读取

- **包**：`@yonder/plugin-web-tools`
- **源码**：[入口](../plugins/web-tools/src/index.ts)
- **贡献**：
  - 工具：`web-tools_search`、`web-tools_extract`、`web-tools_fetch`，见下
- **订阅事件**：无
- **外部输入**：Tavily（检索与抽取）；`web-tools_fetch` 的有界HTTP GET
- **可调用工具**：
  - `web-tools_search`：调用Tavily检索公开网页并返回来源。
  - `web-tools_extract`：调用Tavily抽取指定URL的正文。
  - `web-tools_fetch`：执行有界HTTP GET并处理支持的文本、HTML、JSON或Markdown。
- **边界**：登录/JS页面、二进制文档和原文结构保真有明确边界；不以空正文伪装成功，不冒充浏览器。

## 07 channel-github：项目维护与发行通知

- **包**：`@yonder/plugin-channel-github`
- **源码**：[入口](../plugins/channel-github/src/index.ts)、[渠道](../plugins/channel-github/src/channel.ts)、[Release](../plugins/channel-github/src/releases.ts)、[更新](../plugins/channel-github/src/updates.ts)
- **贡献**：
  - 渠道 `github`：type="github" · kind=issue，接收issue/评论，向issue交付回复
  - 上下文 `channel-github.release-availability`：从已核实缓存提供可升级版本，turn选用，不在聊天联网
  - 工具：见下
- **订阅事件**：
  - `channel-github.release`：执行获准apply
  - 内核 `release.update-result`：CLI及插件作业共用的程序更新完成事实；在 `notifyUpdates=true` 时直接通知
- **外部输入与发出事件**：
  - Issue轮询：按配置仓库、账号/标签和分页水位接收issue及评论，按准入与水位接纳消息，发出 `message.in`，抑制自身评论回环。
  - Release轮询：以首次基线略过旧发行，发现真实GitHub Release后发出 `channel-github.release`，只接收真实发行对象。
  - 更新回收：在启动/轮询时读取本插件独立更新作业结果，发出 `channel-github.update-result`，报告服务外作业与实际版本结果。
- **可调用工具**：
  - `channel-github_status`：读取仓库、准入条件与更新策略状态。
  - `channel-github_read_issue`：读取issue正文和全部评论，拒绝把PR当issue。
  - `channel-github_comment`：向获准issue发送可追踪评论。
  - `channel-github_repository`：读取克隆地址、默认分支及可选分支头。
  - `channel-github_create_pr`：为已推送分支创建或复用指定head/base的PR。
  - `channel-github_read_pr`：读取PR元数据、文件补丁、提交和检查状态。
  - `channel-github_read_release`：读取真实Release及其更新适用信息。
  - `channel-github_update_schedule`：依获准策略启动固定仓库/版本的服务外更新作业。
  - `channel-github_update_status`：读取作业回执与实际服务版本核验。
- **功能**：
  - 渠道发送：通过统一投递向指定issue交付评论。
  - 原模型工具保留；程序处理直接执行业务函数，不模拟Agent调用、不新建插件或调度系统。
  - 配置键 `releases.notifyUpdates`：显式启用程序通知，沿用目标与未知不重发语义。
  - 参数及迁移见[该插件README](../plugins/channel-github/README.md)。
- **边界**：轮询不是通用cron。Git提交/推送仍走agent的既有Git/Bash能力；PR工具不代替推送、合并或发布。maintainer/operator是配置的agent，不是两个插件；已排更新不等于更新成功。

## 08 channel-feishu：飞书消息渠道

- **包**：`@yonder/plugin-channel-feishu`
- **源码**：[入口](../plugins/channel-feishu/src/index.ts)、[渠道目录](../plugins/channel-feishu/src/)
- **贡献**：
  - 渠道 `feishu`：type="feishu" · dm/group，官方SDK WebSocket；随Yonder启停
  - 上下文 `channel-feishu.conversation`（placement=turn）：当前来源全参与者背景，与待处理输入分离
  - 工具：见下
- **订阅事件**（内部）：
  - `message.in`：记录当前输入路由与最新用户消息，为实际运行维护收到反应；跟踪路由与最新气泡。
  - `run.end`：清理结束、取消、不回复或失败运行遗留的Typing反应。
  - `channel.command.result`：清理不经模型的共享命令反应。
- **外部输入**：
  - `im.message.receive_v1`：解析SDK WebSocket消息并经准入生成统一输入事件，发出 `message.in`。
  - `card.action.trigger`：接收卡片操作（认证按钮回调）并发出 `channel-feishu.card-action`，不据此自动提升权限。
  - 连接就绪回调：触发已知会话历史补收，复用SDK连接生命周期（生命周期回调，不是额外事件总线）。
- **发出事件**：
  - `channel-feishu.card-action`：卡片按钮回调。
  - `channel-feishu.card-sent`：工具卡片发送，保留卡片及原生消息关联。
  - `channel-feishu.task-card-updated`：受管任务状态卡创建或更新，携带 receipt、revision 与来源消息。
- **可调用工具**：
  - `channel-feishu_status`：查询连接、机器人身份、补收及渲染状态。
  - `channel-feishu_history`：分页查询获准会话或线程的指定时间区间历史。
  - `channel-feishu_message`：通过共享投递发送文字或多媒体，并可指定原生replyTo。
  - `channel-feishu_card`：发送原生自定义或模板卡片，并可指定原生replyTo。
  - `channel-feishu_task_card`：创建、更新、读取一张受管任务状态卡：同一条原生消息 PATCH、固定状态词与两个短列表；新文字撤销旧卡按钮，按钮只产生无授权通知。
- **功能**：
  - 接收解析：解析文字、富文本、图片、文件、音频、视频和卡片消息。
  - 恢复补收：按固定截止时间、水位与原生ID补收可访问的已知会话消息。
  - 连续分批：只合并同会话、同发送者、同线程的连续输入。
  - 会话背景：提供全参与者历史及确认送达的本机器人回复，与待处理输入分开。
  - 同一主会话：通过核心身份和绑定让owner的CLI与飞书接入同一main。
  - 默认准入：其他私聊/群聊依配置的受限权限接收，不在插件内复制主人权限系统。
  - 流式卡片：按CardKit协议开始、更新并结束流式输出。
  - 收到反应：接纳后标记Typing，开始回复或终结时移除。
  - 条件引用：新气泡打断来源关系时按现有策略引用，工具显式replyTo保持有效。
  - 艾特内容：支持飞书原生消息/卡片的at标记。
  - 共享命令：复用核心help/session/skills/stop及双斜杠转义，不另设飞书命令系统。飞书仅使用四个共享命令：`/help`、`/session`、`/skills`、`/stop`；双斜杠转义按普通消息处理。
  - 统一日志：使用共享脱敏结构化日志定位接收、运行和投递。
- **边界**：默认随Yonder插件生命周期启动，不另开飞书服务。平台只提供机器人有权查看的历史；未知离线新私聊、删除或过期消息不能保证补齐。机器人消息可作背景，不自动当用户触发。

## 09 media-tools：图片生成与音频转写

- **包**：`@yonder/plugin-media-tools`
- **源码**：[入口](../plugins/media-tools/src/index.ts)
- **贡献**：
  - 工具：`media-tools_image_generate`、`media-tools_audio_transcribe`，见下
  - 服务解析：`services.resolve(image/asr)`
  - 不贡献skill、channel或trigger。
- **订阅事件**：无
- **外部输入**：已配置的硅基图片模型与硅基ASR服务（经 `services.resolve` 解析）
- **可调用工具**：
  - `media-tools_image_generate`：调用已配置硅基模型生成单图，立即转存工作区artifacts并返回附件。
  - `media-tools_audio_transcribe`：按文件访问权限读取音频，经已配置硅基ASR返回识别文本。
- **功能**：
  - `services.resolve(image/asr)`：复用既有服务/密钥来源（现有端点、模型清单和凭据引用），不把对话模型目录冒充生成API。
- **边界**：不启用付费TTS或视频；没有TTS/视频工具，没有新增skill、channel、trigger或模型循环。不能将已安装包当作已配置能力。

## 10 cron：持久调度

- **源码**：[入口](../plugins/cron/src/index.ts)
- **贡献**：
  - 工具：`cron_manage`、`cron_exec`，见下
  - 触发器 `cron`：at / every / cron + timezone / window / count / missed / concurrency
- **订阅事件**：无
- **外部输入**：无
- **可调用工具**：
  - `cron_manage` / `cron_exec` → create/get/list/update/enable/disable/delete/run/history
- **功能**：
  - 调度一次性/间隔/cron与时区，支持CRUD、启停、立即运行、窗口/次数/补跑/并发控制和运行记录。
  - 事件需显式绑定及admin；preset按创建/当前能力求交；命令/脚本要求exec；明确目标可投递真实输出。
- **边界**：订阅由trigger计时，不是内核自动轮询模型。

## 11 mcp-client：外部MCP客户端

- **源码**：[入口](../plugins/mcp-client/src/index.ts)
- **贡献**：
  - 工具：`mcp-client_stdio`、`mcp-client_http`，见下
  - 上下文 `mcp-instructions`：只在选择时提供外部instructions；按选择给出已连接server的外部来源信息
  - 触发器 `mcp-cleanup`：关闭连接和自有子进程
- **订阅事件**：`session.close`，关闭连接和自有子进程
- **外部输入**：外部MCP server，经stdio、StreamableHTTP、SSE连接
- **可调用工具**：
  - `mcp-client_stdio` / `mcp-client_http` → connect/disconnect/status/forget
    - tools/call/resources/read/templates/prompts/prompt/instructions
- **功能**：
  - 连接/断开/状态/忘记，发现/调用工具、读取资源、获取prompt；stdio、StreamableHTTP、SSE。
  - 图片与附件映射真实产物。
- **边界**：OAuth-only服务仍需另有授权，不复制账号。

## 12 native-automation：无宿主浏览器/桌面替代

- **源码**：[入口](../plugins/native-automation/src/index.ts)
- **贡献**：
  - 工具：`native-automation_browser`、`native-automation_desktop`，见下
  - 触发器 `native-automation-cleanup`：等待自有浏览器/进程退出
- **订阅事件**：`session.close`，等待自有浏览器/进程退出
- **外部输入**：浏览器引擎与OS授权（见边界）
- **可调用工具**：
  - `native-automation_browser` → status/navigate/snapshot/click/fill/press/select/screenshot/evaluate
    - tabs/new-tab/select-tab/close-tab/back/forward/reload/close
  - `native-automation_desktop` → status/permissions/snapshot/screenshot/move/click/drag/type/key
- **功能**：
  - 自动探测并启动自有Chromium浏览器完成网页操作；macOS原生截图/观察/键鼠。
  - 停止等待自有进程真实退出。
- **边界**：无需BrowserSkill/Codex，但仍需浏览器引擎和OS授权。截图通过不代替键鼠真实验收。

macOS 桌面通过稳定路径的签名 Yonder Helper.app 执行。permissions/status 只读 OS 探针，提供 9 类权限的身份、请求历史、原始状态和主人下一步；只由人用 CLI request/guide 交互。FDA/Files & Folders 为 unobservable。首次调用可复制/更新 helper 并持久化观测，不代表授予权限。截图当前限主屏；真人 UI/输入/授权/撤销/升级保留未测，见[实测与 OWNER STEP](verification/mac-permissions.md)。

## 微信归档与 iLink

- `@yonder/plugin-wechat-archive`：7 个私密资料工具（status/sources/history/search/message/media/policy）及 wechat-archive 触发器，只读微信，不提供发送渠道。配置、入参与出参见[归档插件](../plugins/wechat-archive/README.md)。
- `@yonder/plugin-channel-wechat-ilink`：wechat-ilink 私聊渠道及 status/login/message 工具；首个配置实例默认关联明确配置的主人，后续实例独立关联。模型权限、会话与投递沿用现有系统。详见[iLink 插件](../plugins/channel-wechat-ilink/README.md)。
- 实现/验证/真实微信未测项见[微信迁移验收](verification/wechat-plugins.md)。


BrowserSkill 可选 fork 工具（D54）：`browser-skill_bookmarks`（tree/move/create-folder/remove-empty-folder）和 `browser-skill_extensions`（list/enable/disable）。各需 owner 配置 opt-in 与 popup 可选权限，默认关闭；只用调用会话拥有的本地 session，影响整个 profile。安装步骤及限制见[扩展调研](research/chrome-extension-install.md)。

## Clipboard / Keychain（D53）

- 包：`@yonder/plugin-clipboard`，只依赖 SDK；[配置与边界](../plugins/clipboard/README.md)。
- 工具：`clipboard_copy`、`clipboard_paste`、`clipboard_list`、`clipboard_drop`、`clipboard_capture`；钩子 `clipboard-redact`。
- 事件：`clipboard.audit`，仅元数据（intent/completed/failed）；TTY journal 在下一次授权调用导入。
- open 引用同会话入站消息、文件字节范围或当前转录工具结果；sealed 使用 macOS Keychain，不返回原文，隐藏 TTY 一次性 ticket；支持 create-only 文件、固定 child env/HTTPS、open 消息及 vault。
- 安装不授权；exact profile grant + session scope、TTL/限额/目的地 allowlist。只支持 local；浏览器/Feishu 私密 adapter 阻塞，raw exec 不是沙箱。实际结果见[验收](verification/clipboard-vault.md)。

## 14 channel-qq：QQ 官方机器人

- **包**：`@yonder/plugin-channel-qq`；[使用与扫码配置](../plugins/channel-qq/README.md)
- **贡献**：渠道提供者 `qq`；工具 `channel-qq_status`（read）。
- **输入**：官方 WebSocket 的 C2C、群 @ 与平台已开放的普通群消息，写 `message.in`，保留原生 msgId、时间、发送者、会话及 mentioned。默认群绑定普通消息只写入会话，@ 唤醒。
- **输出**：官方文字 API，经共享投递返回平台消息 ID；未知结果不重发。首版无媒体/流式/频道/Webhook。
- **配置**：显式本机 `yonder-qq setup` 输出官方扫码链接/二维码，可打开浏览器；密钥存既有凭据文件，私聊仅扫码用户，群默认独立无工具配置档。
