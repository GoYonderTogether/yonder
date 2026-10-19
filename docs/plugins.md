# 官方插件功能清单

核对日期：2026-10-19；1907有12个官方插件，正式安装加载11个；media-tools仍未配置加载。正式升级、无模型程序通知、热配置和定时命令实证见[1907结果](tasks/execution-capabilities-result.md)。注册不等于全部真实场景通过，历史P轮/完整矩阵及未测保留；此前通知证据见[1906记录](tasks/release1906-result.md)。

本清单区分“贡献槽位”“监听事件”“外部输入”“可调用功能”。下列短句描述已存在的功能体，不宣布逐项验收成功。工具实际名称带插件ID前缀；浏览器动作是工具参数，MCP操作是外部协议能力，不混称核心模型工具。

## 01 channel-cli：本地消息通道

源码：[入口](../plugins/channel-cli/src/index.ts)。贡献：`cli`渠道；无内部事件订阅。

- 接收：从Unix socket接收文本或分帧输入，生成带本地账号/会话来源的消息事件。
- 多行输入：将一帧多行文本作为一条输入提交。
- 发送：向连接中的终端交付文字或流式输出片段。
- 生命周期：启动时监听socket，停止时关闭连接并清理本插件socket。
- 连接边界：每实例同一时刻接纳一个通道客户端，不能把全局单服务解释成无限并发CLI连接。

TUI、补全、管理命令在 `packages/cli/`；本通道不提供附件发送，控制接口的附件能力另计。

## 02 context-files：工作区上下文

源码：[入口](../plugins/context-files/src/index.ts)。贡献：4个system上下文；无事件订阅。

- `agents-md`：按选择读取AGENTS.md，提供工作规则。
- `user-md`：按选择读取USER.md，提供用户资料。
- `soul-md`：按选择读取SOUL.md，提供agent行为设定。
- `memory-md`：按选择读取MEMORY.md，提供已存文本。
- 文件准备：仅为选中的上下文按现有模板补初始文件。

本插件不检索、提炼或自动更新长期记忆。

## 03 channel-mcp：外部agent控制入口

源码：[协议入口](../plugins/channel-mcp/src/index.ts)、[操作实现](../plugins/channel-mcp/src/operations.ts)。贡献：`mcp`渠道；无内部事件订阅。外部输入：loopback `/mcp` 的Streamable HTTP/SSE请求，使用Bearer与Host/Origin约束。

19个外部操作，实际前缀为 `channel-mcp_`：

- `events_emit`：接纳事件并返回事件标识，不等待模型执行。
- `events_ask`：提交事件并等待绑定运行的原生结果。
- `events_query`：按条件分页读取事件账本。
- `sessions_list`：筛选并列出持久会话。
- `sessions_get`：读取指定会话元数据。
- `sessions_open`：按已有preset打开会话。
- `sessions_submit`：向preset会话提交输入，并按参数等待或立即返回。
- `sessions_watch`：被动观察已有运行进度，观察连接断开不取消任务。
- `sessions_abort`：显式取消会话运行及相应排队输入。
- `sessions_close`：关闭指定会话。
- `sessions_transcript`：分页读取原生转录条目。
- `identity_account`：读取渠道账号身份。
- `identity_person`：读取统一人物身份。
- `identity_lookup`：按已知标识查询身份映射。
- `identity_relation`：读取身份关系。
- `identity_createPerson`：创建统一人物记录。
- `identity_link`：在权限允许时建立账号与人物映射。
- `identity_unlink`：在权限允许时解除身份映射。
- `messages_send`：通过共享投递入口向指定人、账号或会话发送消息及附件。

本插件不连接任意MCP服务器；渠道的主动send不提供远端推送，结果经ask、watch或事件查询取回。

## 04 browser-skill：浏览器操作

源码：[入口](../plugins/browser-skill/src/index.ts)、[动作](../plugins/browser-skill/src/operations.ts)。贡献：7工具、1个browser-skill技能、1个资源清理trigger `browser-skill-cleanup`。

监听：内部 `session.close` 清理该会话拥有的浏览器资源；trigger启动/停止时清理已有归属资源与本插件runner。外部浏览器状态来自bsk守护服务和Chrome扩展，不是另一个内部消息订阅。

七工具、38动作：

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

已有真实基本浏览器闭环；38动作尚未逐一验收，初装扩展与断开引导仍须补证据。

## 05 codex-tools：本机桌面与hosted搜索

源码：[入口](../plugins/codex-tools/src/index.ts)。贡献：4工具、1个生命周期trigger `codex-tools-lifecycle`。监听：内部 `run.end` 释放对应会话app-server资源；trigger负责启动/停止时资源生命周期。

- `codex-tools_status`：发现本机CUA说明与schema，报告可用入口。
- `codex-tools_js`：通过本机CUA执行应用发现、界面读取、截图或操作。
- `codex-tools_js_reset`：清空JS绑定，保留已经发生的应用操作。
- `codex-tools_search`：调用本机Codex hosted search并返回来源和原生证据。

状态发现不等于系统授权通过；首次JS须遵守原生单入口约束。浏览器优先BrowserSkill；跨运行JS变量不能承诺持久。搜索桥接不复制Yonder OAuth，内部模型和供应商按实际记录说明。

## 06 web-tools：搜索与网页读取

源码：[入口](../plugins/web-tools/src/index.ts)。贡献：3工具；无事件订阅。

- `web-tools_search`：调用Tavily检索公开网页并返回来源。
- `web-tools_extract`：调用Tavily抽取指定URL的正文。
- `web-tools_fetch`：执行有界HTTP GET并处理支持的文本、HTML、JSON或Markdown。

登录/JS页面、二进制文档和原文结构保真有明确边界；不以空正文伪装成功，不冒充浏览器。

## 07 channel-github：项目维护与发行通知

源码：[入口](../plugins/channel-github/src/index.ts)、[渠道](../plugins/channel-github/src/channel.ts)、[Release](../plugins/channel-github/src/releases.ts)、[更新](../plugins/channel-github/src/updates.ts)。贡献：`github`渠道、9工具；无内部 `events.on` 订阅。

外部输入与输出事件：

- Issue轮询：按配置仓库、账号/标签和分页水位接收issue及评论，发出 `message.in`，抑制自身评论回环。
- Release轮询：以首次基线略过旧发行，发现真实GitHub Release后发出 `channel-github.release`。
- 更新回收：在启动/轮询时读取本插件独立更新作业结果，发出 `channel-github.update-result`。
- 渠道发送：通过统一投递向指定issue交付评论。

九工具：

- `channel-github_status`：读取仓库、准入条件与更新策略状态。
- `channel-github_read_issue`：读取issue正文和全部评论，拒绝把PR当issue。
- `channel-github_comment`：向获准issue发送可追踪评论。
- `channel-github_repository`：读取克隆地址、默认分支及可选分支头。
- `channel-github_create_pr`：为已推送分支创建或复用指定head/base的PR。
- `channel-github_read_pr`：读取PR元数据、文件补丁、提交和检查状态。
- `channel-github_read_release`：读取真实Release及其更新适用信息。
- `channel-github_update_schedule`：依获准策略启动固定仓库/版本的服务外更新作业。
- `channel-github_update_status`：读取作业回执与实际服务版本核验。

轮询不是通用cron。Git提交/推送仍走agent的既有Git/Bash能力；PR工具不代替推送、合并或发布。maintainer/operator是配置的agent，不是两个插件；已排更新不等于更新成功。

## 08 channel-feishu：飞书消息渠道

源码：[入口](../plugins/channel-feishu/src/index.ts)、[渠道目录](../plugins/channel-feishu/src/)。贡献：`feishu`渠道、4工具、1个turn上下文 `channel-feishu.conversation`。

内部订阅：

- `message.in`：记录当前输入路由与最新用户消息，为实际运行维护收到反应。
- `run.end`：清理结束、取消、不回复或失败运行遗留的Typing反应。
- `channel.command.result`：清理不经模型的共享命令反应。

外部输入：

- `im.message.receive_v1`：解析SDK WebSocket消息并经准入生成统一输入事件。
- `card.action.trigger`：接收卡片操作并发出 `channel-feishu.card-action`，不据此自动提升权限。
- 连接就绪回调：触发已知会话历史补收，复用SDK连接生命周期。

工具及既有协议功能：

- `channel-feishu_status`：查询连接、机器人身份、补收及渲染状态。
- `channel-feishu_history`：分页查询获准会话或线程的指定时间区间历史。
- `channel-feishu_message`：通过共享投递发送文字或多媒体，并可指定原生replyTo。
- `channel-feishu_card`：发送原生自定义或模板卡片，并可指定原生replyTo。
- 接收解析：解析文字、富文本、图片、文件、音频、视频和卡片消息。
- 恢复补收：按固定截止时间、水位与原生ID补收可访问的已知会话消息。
- 连续分批：只合并同会话、同发送者、同线程的连续输入。
- 会话背景：提供全参与者历史及确认送达的本机器人回复，与待处理输入分开。
- 同一主会话：通过核心身份和绑定让owner的CLI与飞书接入同一main。
- 默认准入：其他私聊/群聊依配置的受限权限接收，不在插件内复制主人权限系统。
- 流式卡片：按CardKit协议开始、更新并结束流式输出。
- 收到反应：接纳后标记Typing，开始回复或终结时移除。
- 条件引用：新气泡打断来源关系时按现有策略引用，工具显式replyTo保持有效。
- 艾特内容：支持飞书原生消息/卡片的at标记，实际提醒效果仍须客户端验收。
- 共享命令：复用核心help/session/skills/stop及双斜杠转义，不另设飞书命令系统。
- 统一日志：使用共享脱敏结构化日志定位接收、运行和投递。

默认随Yonder插件生命周期启动，不另开飞书服务。平台只提供机器人有权查看的历史；未知离线新私聊、删除或过期消息不能保证补齐。机器人消息可作背景，不自动当用户触发。当前主接入为人生管家；开发验收员待凭据配置。多媒体原生消息ID、卡片接口存在不等于播放/回调验收通过。

## 09 不是插件的能力

- 内置skill `skill-creator`：按需读取技能创建指导及配套资源，辅助Python脚本依赖仍有未闭合项。
- 内置skill `yonder-development`：建议在隔离开发目录使用Git保存、验证并交付可审查代码，用户可不采用。
- 内置skill `yonder-plugin-debug`（1905起）：从指定入口执行短任务、核对工具/事件/产物并按需隔离复现；不增加插件，沿现有按需读取机制使用。
- 核心运行：pi模型循环、原生队列/回执、会话、身份、权限、绑定及共享投递由core/runtime承担。
- 原生工具：文件读写、Bash、grep及共享message_send/task_run/agent_ask等不重复包装成插件。
- 用户入口：CLI/TUI、安装更新、launchd和状态栏属于产品包，不是额外渠道插件。

目前没有cron、主动记忆引擎、通用MCP客户端、持久PTY或PDF/Office插件；trigger槽或MEMORY.md文件不算这些功能已实现。

## 正式发行补记

1904 / `42646a4`已在main正式发行；插件功能与1903一致，仅统一版本与文档。完整注册名和SDK入口见[功能树](function-tree.md)，本机更新和分支归并见[发行记录](tasks/stable-release-result.md)。

- 1906新增内置skill `yonder-self-management`：Yonder特有目录、配置、Agent/preset、权限和更新规约；已随1906安装并加入两Agent的选择白名单，不增加通用编码/GitHub教程。

## media-tools（1906随包，本机未加载）

- 包：`@yonder/plugin-media-tools`；贡献两个模型工具，不贡献skill/channel/trigger。
- `media-tools_image_generate`：用已配置模型生成一张图片，下载保存到工作区artifacts并返回附件。
- `media-tools_audio_transcribe`：按文件访问权限读取音频，调用已配置ASR并返回文字。
- `services.resolve(image/asr)`复用既有服务/密钥来源，不把对话模型目录冒充生成API；不启用付费TTS或视频。
- 源码插件真实免费API调用通过，1906已随包安装但未配置服务、未加载，未作安装版模型选择/飞书端到端验收。见[实现记录](tasks/siliconflow-media-result.md)。

### 1906：GitHub事件程序处理（已安装）

channel-github新增上下文channel-github.release-availability，并订阅channel-github.release执行获准apply、订阅内核release.update-result在notifyUpdates=true时直接通知；原模型工具保留。直接执行业务函数，不模拟Agent调用、不新建插件或调度系统。参数及迁移见该插件README与 [E轮结果](tasks/event-driven-actions-result.md)。


## 10 cron：持久调度

工具 `cron_manage`、`cron_exec`；trigger `cron`。调度一次性/间隔/cron与时区，支持CRUD、启停、立即运行、窗口/次数/补跑/并发控制和运行记录。事件需显式绑定及admin；preset按创建/当前能力求交；命令/脚本要求exec；明确目标可投递真实输出。订阅由trigger计时，不是内核自动轮询模型。

## 11 mcp-client：外部MCP客户端

工具 `mcp-client_stdio`、`mcp-client_http`；context `mcp-instructions`；trigger `mcp-cleanup`；订阅 `session.close`。连接/断开/状态/忘记，发现/调用工具、读取资源、获取prompt；stdio、StreamableHTTP、SSE。只在选择时提供外部instructions，图片与附件映射真实产物；OAuth-only服务仍需另有授权，不复制账号。

## 12 native-automation：无宿主浏览器/桌面替代

工具 `native-automation_browser`、`native-automation_desktop`；trigger `native-automation-cleanup`；订阅 `session.close`。自动探测并启动自有Chromium浏览器完成网页操作；macOS原生截图/观察/键鼠。无需BrowserSkill/Codex，但仍需浏览器引擎和OS授权。停止等待自有进程真实退出；截图通过不代替键鼠真实验收。
