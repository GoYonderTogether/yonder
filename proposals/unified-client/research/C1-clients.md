> 证据材料，结论已并入 [design.md](../design.md)

# 参考客户端调研：pi、opencode、DeepSeek Harness → Yonder 统一应用

## 0. 结论速览

1. 三个参考实现的远程面都在收敛到同一形状：**一元 RPC 走 HTTP，事件走一条可续的流（带 seq/after 游标），会话内历史分页单独一条读接口**。opencode 明确把全局 SSE 标为 "Volatile by contract…events during disconnection are missed"（`packages/protocol/src/groups/event.ts:46-60`），另给 `/api/experimental/session/:id/log?after=<seq>&follow=true` 做可续（`packages/protocol/src/groups/session.ts:665-682`）；DSH 的 `follow` 首帧 `snapshot{cursor, records, projections}` 再补 durable 事件（`packages/api/session-controller/src/types.ts:552-566`）。Yonder 现在的 `sessions.watch` 没有 `after`，`cli/src/index.ts:792-808` 只有「先 `terminal.info` 返回快照，再逐条推 update」。
2. **prompt 一律带客户端生成的 requestId 做幂等**（DSH `SessionPromptRequest.requestId`，`packages/api/session-controller/src/types.ts:333-347`），返回的是 accepted 收据而不是结果。Yonder `sessions.submit` 返回 `InputReceipt`（`packages/sdk/src/types.ts:181-215`）但没有 requestId，重连重发会重复入队。
3. **附件是两段式**：先传字节拿 receipt/uri，再在 prompt 里引用。DSH 走 `POST /api/session/uploadFileBinary` + `{type:'file', receiptId}`（`packages/client/file-upload/src/protocol.ts:2`、`session-controller/src/types.ts:89-99`），opencode 走 `files:[{uri,name?}]`（`groups/session.ts:335-355`），pi 只支持内联 base64 图片（`docs/rpc-commands.md:15-20`）。Yonder 的 `Attachment` 只有 `uri`（`packages/sdk/src/types.ts:32-38`），**网关必须补一条字节上传路由**。
4. **选模型是独立方法，不是斜杠命令**。opencode `POST /api/session/:id/model {model:Model.Ref}`、`/agent {agent}`（`groups/session.ts:117-827` 区间内），DSH `selectModel {sessionId, provider, model, reasoningEffort?}`（`types.ts:299-307`），pi RPC `set_model {provider, modelId}` + `get_available_models`（`packages/coding-agent/src/modes/rpc/rpc-types.ts:21-74`）。Yonder 只能 `sessions.command(id, "/model …")` 文本驱动（`packages/core/src/sessions/index.ts:114-175`），前端无法做下拉框。
5. **agent 可调用的会话工具三家用三种粒度**：pi 核心零个（只有 bash/edit/find/grep/ls/read/write），靠 `pi-subagents` 扩展给一个 `subagent` 工具（`tool-reference.md:5,330-410`）；opencode 给 `subagent` + `session_rename`/`session_move`/`models`（`packages/core/src/tool/plugin/opencode.ts:106-220`）；DSH 最完整：`subagent`、`send_message`、`interrupt_agent`、`list_agents`（`packages/subagent/tool-subagent-control/README.md:1-45`）加 5 个只读 `session_*` 查询工具（`packages/session-query/tool-session-query/README.md:1-45`）。Yonder 有 `session_list`/`session_read`（需 admin），**没有「给某个会话发消息」「中止/关闭某个会话」「开子会话」工具**（`packages/core/src/tools/index.ts:197-523`、`catalog.ts:1-16`）。
6. 桌面壳三家都是 **Electron + 打包后的同一份 Web SPA + 独立 Node 后端进程**：DSH 用 RunAsNode 子进程跑 Host，加载 `dsh-app://app/`（`apps/desktop/README.md:5-9`）；opencode 用 `opencode-cli serve --service` 起 sidecar，渲染层拿 `{url, auth:{type:"basic",password}}`（`packages/desktop/src/main/service/background-service.ts`）。这与 Yonder 的「Tauri 壳 + 独立 Node 内核 + 网关托管 apps/app」结构同构，只差壳技术选型。
7. 自动更新三家的差异在「谁来签、谁来装」：DSH 用 electron-updater + generic feed（`https://download.deepseek.com`，channel `nightly`）+ Windows Authenticode 发布者锁定，并在渲染层放一个**状态指示按钮**（`packages/client/ui-settings-general/src/client/DesktopUpdateIndicator.tsx:1-80`）；opencode 的桌面更新器是一个 GUI 扩展包 `packages/gui-extensions/src/updater/*`，`autoDownload=false`、`check` 后由用户确认再下载、下载完 `quitAndInstall()`；Tauri 2 的 `tauri-plugin-updater` 形态最接近 Yonder 设计（Ed25519 签名 `latest.json`，可 `check()`/`download()`/`install()` 分开，见 `research/C4-install.md:147-167`）。
8. 三家都**没有**把「会话列表」放进 agent 工具的核心面（opencode 没有 session_list 工具，pi 核心没有，DSH 只有只读检索）；Yonder 的 `session_list`/`session_read` 需要 admin（`tools/index.ts:437,456`）反而更保守——补齐时应沿用能力门槛而不是放开。

---

## 1. 远程创建 / 驱动 session

### 1.1 pi：stdio JSONL RPC（无 HTTP 服务端）

- 集成面只有三种：进程内 SDK（`createAgentSession()`）、`pi --mode rpc` 的 stdio JSONL、print/json 模式（`docs/rpc.md:5-13`）。**没有 HTTP/WS 服务端**，一个 RPC 子进程 = 一个会话。
- 帧格式：stdin 每行一条命令（可带 `id`），stdout 每行 `{"id","type":"response","command","success",data|error}`，事件与响应同流、靠 `type` 区分；必须按 LF 切分，官方明确不要用 Node `readline`（U+2028/2029 会断行，`docs/rpc.md:118-127`）；关闭 stdin 即优雅退出（`docs/rpc.md:130-160`）。
- 创建/切换：`new_session {parentSession?}`、`switch_session {sessionPath}`、`fork {entryId}`、`clone`（`rpc-types.ts:21-74`）。
- 续写：`prompt {message, images?, streamingBehavior?}`；运行中不给 `streamingBehavior` 直接报错，给 `steer`/`follow_up` 才排队；响应 `data.disposition = started|queued|handled`。**`agent_end` 不是结束，要等 `agent_settled`**（`docs/rpc.md:130-148`）。
- 中止：`abort`（等空闲）、`clear_queue`、`abort_retry`、`abort_bash`。
- 列出：**RPC 里没有 list**。列表靠进程外 `SessionManager.list()`/`listAll()`（`packages/coding-agent/src/core/session-manager.ts:1900,1921`），会话是 JSONL 树，CLI 用 `--continue/--resume/--session/--fork` 选（`docs/sessions.md:9-20`）。→ 教训：**列表属于存储层，不属于运行时**。
- 订阅流：无多路复用，事件按 `message_update/message_end/agent_end/agent_settled` 顺序推。
- 附件：仅图片，内联 base64 `{"type":"image","data":"<base64>","mimeType":"image/png"}`（`docs/rpc-commands.md:15-20`）。
- 选模型 / 思考档：`set_model {provider, modelId}`、`cycle_model`、`get_available_models`、`set_thinking_level {level}`、`cycle_thinking_level`、`get_available_thinking_levels`。
- 选 agent：**pi RPC 没有 agent 概念**（没有 `set_agent`；只有 `get_commands` 列斜杠命令）。子 Agent 完全由扩展实现（见 §2）。

### 1.2 opencode：HTTP + 两条流

契约在 `packages/protocol/src/groups/*.ts`（effect `HttpApiGroup`）+ 生成的 `openapi.json`；client 由它代码生成（`packages/client/src/{promise,effect}/generated/*`）。

| 动作 | 请求 | 出处 |
|---|---|---|
| 创建 | `POST /api/session` `{id?, parentID?, title?, agent?, model?, location?, metadata?, permissions?}` → `{data:Session.Info}` | `groups/session.ts:117-827` 区间 |
| 子会话 | 同上带 `parentID` | 同上 |
| 续写 | `POST /api/session/:id/prompt` `{id?, text, files?:[{uri,name?,description?,mention?}], agents?, skills?, metadata, delivery?: "steer"\|"queue", resume?:boolean}` → `{data:SessionInbox.User}` | `groups/session.ts:335-355` |
| 中止 | `POST /api/session/:id/interrupt?resume=` → `{interrupted:boolean}`（idle 时 false；`resume=true` 继续 pending steering） | `groups/session.ts:685-704` |
| 列出 | `GET /api/session?limit(默认50)&cursor` → `{data:[Session.Info], cursor:{previous?,next?}}` | 同上 |
| 详情 | `GET /api/session/:id`、`GET /api/session/active`、`DELETE /api/session/:id` | 同上 |
| fork | `POST /api/session/:id/fork {before?}` | 同上 |
| 选模型 | `POST /api/session/:id/model {model:Model.Ref}` → 204；清单 `GET /api/model`、`GET /api/model/default` | `groups/session.ts`、`groups/model.ts:10,26` |
| 选 agent | `POST /api/session/:id/agent {agent}` → 204；清单 `GET /api/agent`、`/api/agent/:agentID` | `groups/session.ts`、`groups/agent.ts:10,24` |
| 斜杠命令 | `POST /api/session/:id/command {name, ...Prompt, delivery?}` | `groups/session.ts` |
| 其它 | `shell`、`compact`、`synthetic`、`revert.stage/clear/commit`、`context`、`diff`、`inbox.list/cancel/update`、`form.*`、`view`、`move`、`PATCH`（title/metadata/permissions/archived） | 同上 |
| 订阅（易失） | `GET /api/event` SSE，含 `server.connected`；文档明写慢消费者会溢出、断线期间事件丢失 | `groups/event.ts:46-60` |
| 订阅（可续） | `GET /api/experimental/session/:id/log?after=<seq>&follow=true` → `SessionEvent.Durable \| EventLog.Synced`，按 aggregate seq 排他读再切实时 | `groups/session.ts:665-682` |

- `delivery` 取值就是 `steer|queue`（`packages/schema/src/session-inbox.ts:12`），与 Yonder 的 `busy: followup|steer|interrupt`（`packages/cli/src/index.ts:780-791`）语义基本对齐，但 opencode 把「打断」单独做成 interrupt 端点。
- 进程内宿主：`OpenCode.create()` 在内存里跑同一套 HTTP router，"opening no listener and adding no network hop"（`packages/sdk/README.md`）——**这正是 Yonder 想做的「进程内网关 + 同一契约」**，可作为设计背书。

### 1.3 DSH：Typert Remote（一元 `/api` + WS 多路流）

服务类方法即端点（`@Remote('name')` / `@Remote({mode:'stream'})`，`packages/typert/protocol/src/index.ts:197-207`），一元 RPC 全走 `/api` 前缀（`packages/client/connection/src/api-path.ts:7`），所有 stream 复用一个 WS `/api/remote.mux`（`packages/api/gateway/src/stream-protocol.ts:6-13`，帧类型 ready/emit/waterfall/cancel，:45-70）。鉴权是 HMAC 签名 cookie `dsh-auth-` + 每请求 Host/Origin/Fetch-Metadata 绑定（`packages/client/connection/src/browser-auth.ts:1-15`、`api-request-trust.ts:1-10`）。

`SessionController` 的完整 Remote 面（`packages/api/session-controller/src/index.ts:251-528`）：

| Remote | 请求 | 返回 |
|---|---|---|
| `list` | `{cursor?}` | `{items: SessionSummary[]}`（`agentAvailable, sessionId, updatedAt, running, blank, parentSessionId?, origin?:'subagent', cwd?`，`types.ts:177-190`） |
| `search` | `{query}` | `{items:[{sessionId,snippet}], hasMore}`（上限 20 条 / 240 码点） |
| `create` | `{workspaceId?, cwd?, sessionId?, agentPreset?}` | `{sessionId, agentPreset?}`（`sessionId` 可指定 → **幂等 adopt**） |
| `selectModel` | `{sessionId, provider, model, reasoningEffort?}` | `{selected}` |
| `modelCatalog` / `initializeDefaultModel` | — | 模型目录 / 首个可用模型 |
| `prompt` | `{requestId, sessionId, mode:'queue'\|'steer', content: PromptContentPart[], clientTimeZone?}` | `{accepted:true}` |
| `attachment` | `{sessionId, attachmentId}` | `{attachment, data(base64)}` |
| `updateQueue` | `{sessionId, itemId, action: {kind:'edit'\|'remove'\|'steer'}}` | `{accepted}` |
| `cancel` | `{sessionId}` | `{accepted}` |
| `page` | `{address, throughSeq, beforeSeq?, maxMessages?, turnWindow?}` | `{records, hasMore}` |
| `follow`（stream） | `{address, maxMessages?, turnWindow?, assistantStream?}` | 首帧 `{type:'snapshot', header, cursor, records, hasMore, projections}` 后接 durable 事件 |
| `control`（stream） | — | `{type:'baseline'}` + 每会话 projection 增量 |
| `rename` / `fork {atSeq?}` / `projections` / `openWorkspacePath` | — | — |

`SessionAddress` 区分普通会话与子会话（`types.ts:408-416`），`origin:'subagent'` + `delegationDepth` 出现在 header 上。→ 对 Yonder 的启示：**父会话/子会话不是新概念，而是同一地址族的两个 kind**。

### 1.4 四方对照

| 维度 | pi | opencode | DSH | Yonder 现状 |
|---|---|---|---|---|
| 传输 | stdio JSONL | HTTP + SSE(WS for PTY) | HTTP 一元 + 单 WS 多路 | Unix socket 行 JSON |
| 一进程多会话 | 否 | 是 | 是 | 是（内核常驻） |
| 创建参数 | `new_session{parentSession?}` | `{parentID,title,agent,model,location}` | `{cwd,agentPreset,sessionId?}` | 仅 `{preset, close?}` |
| 幂等 | 无 | `id?` 可指定 | `sessionId?` adopt + `requestId` | 无 |
| 续写 | `prompt{streamingBehavior}` | `prompt{delivery}` | `prompt{mode,requestId}` | `submit{busy}` |
| 中止 | `abort` | `interrupt?resume=` | `cancel` | `sessions.abort` |
| 列出 | 进程外 SessionManager | `GET /api/session?cursor` | `list{cursor}` | `sessions.list{filter}` 无游标 |
| 订阅 | 单流事件 | 易失 `/api/event` + 可续 `/log?after` | `follow` 首帧 cursor | `watch` 无 after |
| 历史分页 | `get_entries{since}`/`get_messages` | `GET /api/session/:id/message/:id` + context | `page{beforeSeq,turnWindow}` | `transcript{from,limit}`（SDK）无 control 方法 |
| 附件 | 内联 base64 图 | `files[{uri}]` | upload → receiptId / image base64 | `uri` 引用，无上传端点 |
| 选模型 | `set_model` + `get_available_models` | `POST …/model` + `GET /api/model` | `selectModel` + `modelCatalog` | 只有 `/model` 文本命令 |
| 选 agent | 无 | `POST …/agent` + `GET /api/agent` | `create{agentPreset}` | 由 preset 决定 |
| 能力声明 | — | — | — | 无（`capabilities.get` 待补） |

### 1.5 Yonder 网关最小方法集

现有方法（`packages/cli/src/index.ts:724-841`）：`awake.status`、`channels.list/login`、`release.result`、`sessions.notify`、`management`、`terminal.sessions/presets/channels/queued/dequeue/info`、`service.info`、`sessions.command/open/submit/watch/list/show/abort/close`、`events.query`、`identity.*`、`stop`。SDK 面见 `packages/sdk/src/types.ts:145-180`。

建议的最小集（12 条，括号内为对现有实现的改动）：

| 方法 | 参数 | 返回 | 依据 |
|---|---|---|---|
| `capabilities.get` | — | `{kind, protocol, methods[], plugins[], granted[]}` | design.md §4.1 |
| `sessions.list` | `{agent?, mode?, open?, cursor?, limit?}` | `{items, cursor}` | opencode `GET /api/session?cursor`、DSH `list{cursor}` |
| `sessions.show` | `{id}` | `{session, info}` | 现 `sessions.show` 把整份 transcript 一起返回（`index.ts:811-816`），大会话会爆 |
| `sessions.transcript` | `{id, before?, limit?}` | `{items, hasMore}` | DSH `page`、opencode `/log` |
| `sessions.watch` | `{id, after?}` | 首帧 `snapshot{session, info, transcript?, cursor}` + `update{seq}` | 补 `after` + `seq`（现在 `index.ts:792-808` 无游标、无序号） |
| `sessions.open` | `{preset, parent?, agent?, model?, capabilities?, close?}` | `SessionInfo` | opencode create、DSH create |
| `sessions.submit` | `{id, requestId?, text, attachments?, busy?}` | `{event, session}` | DSH `requestId`、opencode `delivery` |
| `sessions.abort` / `sessions.close` | `{id}` | `{ok}` | 已有 |
| `sessions.command` | `{id, command}` | 文本 | 保留兼容 `/status`、`/compact`（`sessions/index.ts:114-175`） |
| `sessions.model.set` | `{id, provider, model, effort?}` | `{model}` | 结构化替代 `/model` 文本 |
| `models.list` | `{provider?}` | `{providers:[{id, models:[{id, name, contextWindow, reasoning}]}]}` | 现在只能从 `terminal.info` 的 `model` 或 `/model list` 文本里抠（`kernel/terminal.ts:39-171`） |
| `attachments.put` | 原始字节 `POST /api/attachments` → `{uri, bytes, mime}` | — | DSH `uploadFileBinary` + receipt |

可选但很快会用到：`sessions.fork {id, at?}`（opencode/DSH 都有）、`sessions.search {query}`（DSH `search`）、`sessions.activity`（`kernel.terminal.activity()` 已存在但 control 未暴露，见 `kernel/terminal.ts:39-171`；「左栏任务计数」目前只能由前端从 `sessions.list` 自己算——推断）。

**缺口归纳（按优先级）**：① `watch` 的 `after`+`seq`；② `submit` 的 `requestId`；③ `open` 的 `parent/agent/model`；④ 结构化 model/agent 选择 + `models.list`；⑤ 附件上传；⑥ `transcript` 分页；⑦ `capabilities.get`。

---

## 2. 让 agent 用工具管理 session

### 2.1 pi

- 核心工具只有 `bash/edit/find/grep/ls/read/write`（`packages/coding-agent/src/core/tools/`），**没有 task/subagent/会话管理工具**。
- `pi-subagents` 扩展（v0.83.0，MIT，`~/.pi/agent/npm/node_modules/pi-subagents`）提供单个 `subagent` 工具 + `subagents_enable` 延迟激活（`tool-reference.md:5`、`configuration.md:83-99`）。顶层 schema：`agent, task, workflow, args, async, model, cwd, worktree, output, action, id, message`，其余进 `options`（`tool-reference.md:104-108`）。
- 动作覆盖整套会话管理：`status`（fleet/transcript 视图）、`interrupt`、`stop`、`resume`（从子会话 jsonl 新起会话续写，独占 lease）、`steer`（`mode: steer|follow_up|auto`，3 秒内回执 delivered/queued）、`children.list`、`schedule.*`、`mission.*`、`worktree.cleanup`、`doctor`、`guide`（`tool-reference.md:330-410`）。
- 权限不靠提示词：由 pi 的 tools allowlist / `excludeTools` / native child permission rules 决定（`configuration.md:742-744`）。

### 2.2 opencode

- `subagent`（`packages/core/src/tool/plugin/subagent.ts`，311 行）：输入 `{agent, description(3-5 词), prompt, model?("providerID/modelID#variant"), sessionID?, background?}`，输出 `{sessionID, status:"completed"|"running", output}`。
  - 权限：`permission.assert({action:"subagent", resources:[agent.id], sessionID, agent, source:{type:"tool",messageID,id}})`（同文件）。
  - 深度：`config.experimental.subagent_depth ?? 1`，沿 `parentID` 上溯计数；`agent.mode === "primary"` 直接拒绝。
  - 续写：传 `sessionID` 可继续既有子会话；`background:true` 时 `prompt({resume:false})` 后立即返回并自动通知（`subagent-completion.ts:42` 以 `<subagent sessionID=… state=…>` 文本回注）。
  - 前台等待 `jobs.block({id:child.id, sessionID})`，中断时 `sessions.interrupt(child.id)`。
- 其它 agent 可用的会话类工具（`packages/core/src/tool/plugin/opencode.ts:106-220`）：`opencode`、`session_rename`、`session_move`、`worktree_create`、`worktree_list`、`worktree_remove`、`models`（`{query?, provider?, all?, limit≤100, offset}`，让 agent 自查模型清单再传给 subagent）。
- **没有** `session_list`/`session_read`/`send_message`/`interrupt_agent` 这类通用工具：跨会话只走 subagent 父子链。

### 2.3 DSH

- `subagent`（`packages/subagent/tool-subagent/README.md`）：`{provider, toolName, enableRunInBackground, backgroundMode: 'one-shot'|'continuable', agentOptions{provider,model,reasoningEffort,maxTokens}, persona, toolFilter, maxDepth(默认 1，0 禁止委派), modelSelectionSettings}`。one-shot 默认前台等结果；continuable 默认后台并返回 id。
- 控制工具（`tool-subagent-control/README.md`）：`send_message {agent_id, …}`（工作中的目标在最近 step 边界以 Steer 投递；空闲目标走 continuation 生命周期启动/恢复；**只返回 accepted messageId，不返回回复**）、`interrupt_agent`（只停当前 turn，inbox 与后代保留）、`list_agents {scope: children|descendants}`（状态来自 live Agent registry：running/inactive；one-shot 子会话被省略）。
- 只读检索（`packages/session-query/tool-session-query/README.md` + `src/input.ts:14-80`）：`session_search`、`session_event_search`、`session_trace`、`session_event_trace`、`session_event_read`，授权规则是**目标 session 的 cwd 必须与调用者完全一致**，调用者无 cwd 只能看自己；`maxSearchResults` 默认 100、`searchTimeoutMs` 30s。
- 后台作业：`job_output` / `job_kill`（`tool-subagent/README.md` 前台/后台章节），由 `job-controller` 的 stream + `kill` 支撑。

### 2.4 Yonder 现状与补齐清单

现有（`packages/core/src/tools/index.ts`，能力表 `catalog.ts:1-16`）：

| 工具 | 参数 | 能力门槛 | 行号 |
|---|---|---|---|
| `message_send` | `{to(owner\|person:\|acct:\|conv:), via?, text, replyTo?, attachments?}` | 无 | :197-216 |
| `parent_ask` | `{text}`（15 秒后转后台句柄） | 无 | :217-266 |
| `agent_ask` | `{agent, text, sources?, effort?}` | `message`；`effort` 需 `admin` | :267-322 |
| `task_continue` | `{text}` | 无 | :323-353 |
| `task_run` | `{preset, task, sources?, effort?, credentialSlots?, attachments?}` | 无（`effort/credentialSlots` 需 admin）；嵌套 ≥2 层报错 `任务已嵌套两层…` | :354-421 |
| `session_list` | `{agent?, mode?, open?}` | `admin`，跨 agent 需 `cross-agent` | :422-447 |
| `session_read` | `{session, from?, limit?}` | `admin` + sameAgent / `cross-agent` | :448-469 |
| `identity_lookup/link` | … | `read` / `admin` | :470-523 |

补齐清单：

1. **`session_send`（发消息给指定会话）**——缺。现只能 `message_send` 投渠道/人，或 `agent_ask` 请求常驻 Agent（`tools/index.ts:267-322`）。参照 DSH `send_message`：参数 `{session, text, mode: "steer"|"queue", attachments?}`，返回 `{accepted, messageId}`，要求 `admin` + sameAgent（跨 agent 再加 `cross-agent`）。
2. **`session_open`（开子会话）**——缺。`task_run` 是「一次性任务」语义（`preset + task`），不能续写；需要 `{preset, parent?, agent?, model?}` 返回 `SessionInfo`，深度限制沿用 `task_run` 的 2 层（`tools/index.ts:379-386`）。
3. **`session_abort` / `session_close`**——缺。DSH `interrupt_agent` 的「只停当前 turn，保留 inbox」语义应照抄：`session_abort {session}` 返回 accepted，不清队列。
4. **`session_list` 增加 `cursor`/`parent` 过滤**——现在只有 `{agent, mode, open}`（`tools/index.ts:422-447`）。
5. **`session_trace`（父子树）**——缺。DSH `session_trace` 返回祖先链 + 后代树，Yonder 有 `parent` 字段（`packages/sdk/src/types.ts:181-215`）但无工具。
6. **`models_list`**——缺。opencode 明确给 agent 一个 `models` 工具（`tool/plugin/opencode.ts:220`），因为「让 agent 猜模型 ID」不可靠。
7. **权限模型对齐**：三家的共同做法是「工具存在与否 + 能力/权限断言」，不是提示词约束（opencode `permission.assert`、pi 的 `excludeTools`/permission rules、DSH 的 `toolFilter`+`maxDepth`）。Yonder 已有 `requireCapability`（`tools/index.ts:68`），补齐时全部走它，并在 `catalog.ts` 里登记。

---

## 3. 桌面 / 客户端结构

### 3.1 DSH（Electron + Host 子进程 + 同一份 Web SPA）

- 启动链路：Electron 主进程 → `spawn` 一个 RunAsNode 子进程跑共享 profile runner（`apps/desktop/src/host-process.ts:1-40`，事件 `ready{url, injections}` / `fatal` / `platform-session` / `update-tasks` / `quit-inspection`）→ 主进程 `protocol.handle('dsh-app://…')`（`src/main.ts:662`）→ 窗口直接加载打包后的 Web 入口 `dsh-app://app/`，用共享 loading 页等 boot injections 后**不换文档**启动客户端（`apps/desktop/README.md:5-7`）。
- 窗口：1280×820、min 520×600；macOS `titleBarStyle:'hiddenInset'` + `trafficLightPosition {x:16,y:18}` + `vibrancy:'sidebar'` + 透明背景；Windows `titleBarOverlay`（`src/main.ts:207-230`）。
- 网络：应用 HTTP 请求经 IPC 转发给已鉴权 Host，剥掉 `transfer-encoding/connection/keep-alive`；WS 流带凭证连 Host（`README.md:7`）。端口桌面 19387 / Web 3080（`README.md:9`）。
- 布局（A2 已详述，`research/A2-deepseek-reference.md` §4）：无 router，`ui-layout` 的三栏 `AppFrame`（sidebar | center | rightbar）+ Slot 注册表（`packages/client/ui-layout/src/client/AppFrame.tsx:1-41`）；右栏是 dock（`ui-dockkit`）、审批卡 `ui-approval`、提问卡 `ui-user-questions`、任务 `ui-jobs`、定时 `ui-schedule`。**没有命令面板**（`grep -rn "command palette" packages/client/*/src` 无结果）；快捷键是应用内注册表 `packages/client/shortcuts`，桌面把绑定持久化到 `userData/keybindings.json`（`apps/desktop/src/keybindings.ts:19`）。

### 3.2 opencode（Electron + CLI sidecar + SolidJS）

- 启动链路：主进程 `background-service.ts` spawn `[...cli.command, "serve", "--service"]`，经 `@opencode/client/service` 的 `Service.ensure({version, file?, command, onStart})` 拿到 `{url, auth:{type:"basic",password}}`，`SidecarCredentials.set({url,password})` 交给渲染层；`0.0.0.0` 归一成 `127.0.0.1`；启动期 `sidecarProbe` 探测可复用服务（`packages/desktop/src/main/service/background-service.ts`）。
- 壳：主进程 `src/main/{index.ts, windows/*, native/{menu,menu-actions}.ts, storage/*(drizzle+sqlite 存 window state/drafts), ipc-rpc/*}`，preload 用 typed ipc-contract；renderer 是 SolidJS（`packages/app`）。
- 布局 `packages/app/src/shell/shell.tsx`：Titlebar + 左侧 **vertical tabs**（`data-slot="vertical-tabs-sidebar"`，默认 260px，ResizeHandle 140–520，可切横向）+ `<main>` + `ExtensionSlot at="window.bottom"` + ToastRegion + UploadToastHost；移动端 767px 以下切 drawer；安全区用 `--shell-*-inset` 变量。
- 命令面板 `packages/app/src/shell/commands/palette.ts`：**一个面板同时搜命令、文件、会话**（`CommandPaletteEntry.type: "command"|"file"|"session"`），常驻项 `session.new / workspace.new / session.previous / session.next`；`DEFAULT_PALETTE_KEYBIND = "mod+k,mod+shift+p"`（`shell/commands/command.tsx`）；快捷键分组 General/Session/Navigation/Model and agent/Terminal/Prompt，可在设置里改并持久化（`settings/keybinds/keybinds.tsx`）。
- 会话视图 `packages/app/src/session/*`：`header/*`（含 running menu、working indicator）、`composer/{region,queue-panel,queue,selection,attachments/uploads}`、`requests/{permission,question,elicitation,websearch}-dock` + `session-request-tree`（**右栏「待你回答」的来源**）、`commands/{export,fork-dialog}`、`incompatible-server-panel`。

### 3.3 pi

- 没有桌面壳，只有 TUI（`packages/tui`）；**没有 auto-updater UI**，自更新是检测安装方式后执行对应包管理器命令（`packages/coding-agent/src/config.ts:79-100` `detectInstallMethod`，`:121-335` `getSelfUpdateCommand`；bun-binary 安装则提示「Download from https://github.com/earendil-works/pi/releases/latest」`config.ts:344-346`）。
- 值得借鉴的底座是 `packages/chord`：对象/契约运行时，TypeBox schema，`acceptWebSockets`/`webSocketLink`，状态快照 + delta、principal（owner/guest）。pi 自己没在 coding-agent 里用（grep 无引用），但形状与「网关 + 多客户端 + 快照/增量」完全一致。

### 3.4 对 Yonder 的落点

- 三家的「一份产物、多处运行」都靠**启动时注入 surface 事实**（DSH `dshDesktopBoot`/injections；opencode `SidecarCredentials`），与 design.md §4.4 的 `ClientFacts.surface` 一致 → 落点 `apps/app/src/shell`、`apps/app/src/transport`。
- 右栏「等你回答」在 opencode 是 4 个独立 dock 组件、在 DSH 是 `ui-approval`/`ui-user-questions` 插件 → Yonder 的 `views` 槽（design.md §4.8，`packages/core/src/plugins/index.ts:131` claim）应保留「按请求类型分卡片」，而不是一张万能卡。
- 命令面板 + 快捷键是 opencode 最值得直接抄的交互：`mod+k` 一个入口搜命令/文件/会话（`palette.ts`），Yonder 顶栏「搜索/设置」可合并进去；落点 `apps/app/src/shell/commands`。
- 壳与内核的关系照 opencode：**壳不碰数据，只拿 `{url, credential}`**。Yonder 已有 `<home>/.yonder/gateway.json`（design.md §4.2），等价于 `Service.ensure` 的返回，不必新造握手协议。

---

## 4. 自动更新

### 4.1 DSH：electron-updater + 状态指示按钮

模块（全部在 `apps/desktop/src/`）：

| 文件 | 职责 |
|---|---|
| `update-coordinator.ts`（196 行） | 唯一 updater owner：`autoDownload=false`、`autoInstallOnAppQuit=false`、`channel='nightly'`、`allowPrerelease=true`、`allowDowngrade=false`；`check()` 单飞、`download(version)` 校验版本一致、`install(version)` 前先 `beforeRestart()`（任务授权 + 准入锁 + 停 Host）再 `quitAndInstall(true,true)`；`enabled()` = `app.isPackaged && existsSync(resourcesPath/app-update.yml)` |
| `update-schedule.ts`（105 行） | 周期检查：`DSH_DESKTOP_UPDATE_CHECK_INTERVAL_MS` 默认 600000，指数退避到 3600000，jitter 0.2，单调时钟 |
| `update-dialog.ts`（149 行） | 独立 `dsh-app://shell/update-dialog.html` 文档承载确认框；`revision` 防旧响应；文案由主进程给，文档只能回 index |
| `update-presentation.ts` / `update-error.ts` | 把失败分类成 `check/download/install(-network)` 等稳定 kind，不把原始诊断给渲染层 |
| `update-journal.ts`（74 行） | 可选 JSONL 证据：`started/workspace-ready/check-requested/download-requested/install-confirmed/quit-requested/...`；错误码白名单含 `ERR_UPDATER_INVALID_SIGNATURE`、`ERR_UPDATER_CHECKSUM_MISMATCH` |
| `update-overlay.ts` / `update-attention.ts` | 安装期遮罩；窗口隐藏时把「可安装」做成 Dock/任务栏提醒 |
| `mandatory-update-policy.ts`（234 行）+ `mandatory-update-window.ts` | 服务端强制最低版本（独立于业务流量与 updater 产物），命中则阻塞窗口 |

**「更新按钮」的实现**：渲染层拿 `DesktopUpdateBridge {status(), open(), subscribe()}`（`packages/client/ui-settings-general/src/types.ts:20-30`），`DesktopUpdateIndicator.tsx` 把 phase 映射成文案：`checking/available/downloading(percent)/verifying/installing/ready/error(retry)`，位置在侧栏账号按钮旁，`busy` 时 `aria-disabled`（`DesktopUpdateIndicator.tsx:1-80`）。点击 → `open()` → 主进程确认框（下载确认 / 安装并重启 / 稍后）。

**更新源与签名**：`publish: [{provider:'generic', url: update.publicUrl, channel:'nightly'}]`（`apps/desktop/scripts/electron-builder-config.mjs:249`）；生产 origin `https://download.deepseek.com`（`scripts/desktop-auto-update-environment.mjs:20-24`）；macOS 把 `app-update.yml` 在**签名前**写入并校验（`scripts/macos-app-update-config.mjs:1-50`、`electron-builder-config.mjs:188,210`），Windows 由 `publisherName`（来自签名证书）做 Authenticode 发布者锁定（`electron-builder-config.mjs:228`），产物侧另有 sha512 校验与签名验证脚本（`scripts/verify-installed-update-package.ts:58-97`）。

### 4.2 opencode：GUI 扩展包做更新器

- 位置 `packages/gui-extensions/src/updater/{main.ts, platform.ts, machine.ts, contract.ts, section.tsx, actions.tsx, whats-new.tsx, log.ts, i18n/*}`。
- `main.ts`：`enabled = build.packaged && build.channel !== 'dev'`；`electron-updater` **只在打包构建、首窗口起来后动态 import**；向渲染层 provide `Updater` 服务 `{state(), check(), install()}`；菜单加 "Check for Updates"；检查结果用 electron dialog 分 error/up-to-date/ready（ready 给 Restart/Later）。
- `platform.ts`：channel `latest`；`autoDownload=false`、`autoInstallOnAppQuit = darwin`、`allowPrerelease=false`、`allowDowngrade=true`；UA `opencode/<channel>/<version>/desktop`；Windows ARM64 模拟下过滤 files；`stageUpdate()` 调 `downloadUpdate()`（win32 关差分下载），`installAndRestart()` 调 `quitAndInstall()` 并监听 `before-quit-for-update`，10 秒超时。
- `machine.ts`：状态机 `idle|checking|downloading|ready|installing|up-to-date|download-required|error|disabled`；`stage()` 把已下载版本写进 persistence（`stores.ready`）以规避差分 blockmap 失效；启动检查一次，之后每 10 分钟一次。
- 更新源：`provider:'generic'`，`https://opencode.ai/update/api/{latest|beta}/desktop/opencode/`（`packages/desktop/electron-builder.config.ts`）；Windows 显式 `verifyUpdateCodeSignature:false`（同上）。
- CLI 侧另有独立自更新 `packages/cli/src/services/updater.ts`：探测安装方式（curl/npm/pnpm/bun/yarn/vp/brew/winget，`:18`），源 `https://opencode.ai/update/api/<channel>/<artifact>/<distribution>?current=<version>`，策略来自 config `update: disable|notify|auto`（`:124`）。

### 4.3 Tauri 2 updater 的对应做法

（本节事实来自已核实的 `research/C4-install.md:147-167`，官方页 https://v2.tauri.app/plugin/updater/）

- 签名**不可关闭**：`tauri signer generate` 生成密钥对，公钥进 `tauri.conf.json` 的 `plugins.updater.pubkey`，私钥构建时用 `TAURI_SIGNING_PRIVATE_KEY` 注入。
- 产物：`bundle.createUpdaterArtifacts: true` → macOS `.app.tar.gz(.sig)`、Linux `.AppImage.tar.gz(.sig)`、Windows `-setup.nsis.zip(.sig)`。
- 更新源：`plugins.updater.endpoints` 数组，支持 GitHub Releases 的 `latest.json`；`latest.json = {version, notes, pub_date, platforms:{"<os>-<arch>":{signature,url}}}`，`signature` 必须是 `.sig` 文件内容本身；**整份文件先校验再比版本**，任一平台条目残缺即失败。
- 前端权限：capabilities 需 `updater:default`（`allow-check/allow-download/allow-install/allow-download-and-install`）。
- 「后台下载 → 出按钮」原生支持：`check()` → `update.download(cb)` → `update.install()` → `relaunch()`（`@tauri-apps/plugin-process`）。
- 与系统签名是两套独立机制：`.sig` 防篡改，Developer ID / Authenticode 过 Gatekeeper / SmartScreen（`design.md:395-444` 同结论）。

### 4.4 对 Yonder 的落点

- 阶段 6 的壳更新器应照 DSH 的分层（coordinator / schedule / dialog / presentation / journal / overlay），落点 `apps/desktop/src/update/*`，但**用 `tauri-plugin-updater` 的 check/download/install 三段式**，不要学 opencode 把更新器写成扩展包（Yonder 的插件槽是给业务视图的，更新器属于壳）。
- 「更新按钮」的位置照 opencode/DSH：放在侧栏账号行旁的状态指示（Yonder 落点 `apps/app/src/shell`，由 `ClientFacts.surface === 'desktop'` 决定是否渲染），状态语义直接复用 DSH 的 8 个 phase。
- 内核自更新链（`plugins/channel-github/src/update-job.ts`、spec 09 的 `YONDER_INSTALL*`）与壳整包更新必须共用 `.update.lock`（`packages/cli/src/index.ts:794-826`）——这条已在 `C4-install.md:167` 记过，仍未落地（未核实是否有后续实现）。

---

## 5. Yonder 应借鉴的 13 条（含落点）

1. **`sessions.watch` 加 `after` 游标 + 每帧 `seq`，首帧给 `snapshot{session, info, transcript?, cursor}`**。依据：opencode `/log?after=&follow=`（`groups/session.ts:665-682`）、DSH `follow` 首帧 `{type:'snapshot', header, cursor, records, hasMore}`（`types.ts:552-566`）。落点：`packages/core/src/control/methods.ts`（新注册表）+ `packages/gateway`。
2. **`sessions.submit` 加 `requestId` 幂等键，返回 accepted 收据而非结果**。依据：DSH `SessionPromptRequest.requestId` + `{accepted:true}`（`types.ts:333-347`）。落点：`packages/sdk/src/types.ts:145-180`、`kernel/terminal.ts` 的 `submitAccepted`。
3. **新增字节上传路由，`Attachment.uri` 由它签发**。依据：DSH `POST /api/session/uploadFileBinary` + `{type:'file', receiptId}`（`file-upload/src/protocol.ts:2`、`types.ts:89-99`）。落点：`packages/gateway`（`POST /api/attachments`），`packages/sdk/src/types.ts:32-38` 增加 `id/bytes`。
4. **把模型/agent 选择做成结构化方法 + 目录查询，保留 `/model` 文本命令做兼容**。依据：opencode `POST …/model`+`GET /api/model`、DSH `selectModel`+`modelCatalog`、pi `set_model`+`get_available_models`。落点：`sessions.model.set`、`models.list`、`agents.list`，实现在 `packages/core/src/sessions/index.ts:114-175` 之外新开 `models` 方法（复用 `runtime().models.getProviders()`）。
5. **历史分页独立成 `sessions.transcript {before?, limit?}`，`sessions.show` 只返回会话元数据**。依据：DSH `page{beforeSeq,turnWindow}`（`types.ts:471-493`）；现状 `sessions.show` 一次吐整份 transcript（`cli/src/index.ts:811-816`）。
6. **列表走存储索引并带游标**，不要从 runtime 聚合。依据：pi 的列表只在 `SessionManager.list/listAll`（`session-manager.ts:1900,1921`）、opencode `GET /api/session?cursor`、DSH `list{cursor}`。落点：`kernel/terminal.list()`（`kernel/terminal.ts:39-171`）之上加 `sessions.listIndex`。
7. **给 agent 补 3 个会话工具：`session_send`（steer/queue）、`session_open`（子会话）、`session_abort`**，全部走 `requireCapability("admin")` + sameAgent/cross-agent。依据：DSH `send_message`/`interrupt_agent`/`list_agents`（`tool-subagent-control/README.md:1-45`）、opencode `subagent`（`tool/plugin/subagent.ts`）。落点：`packages/core/src/tools/index.ts:197-523`、`catalog.ts:1-16`。
8. **agent 侧给一个 `models_list` 工具**，避免模型 ID 靠猜。依据：opencode `models` 工具（`tool/plugin/opencode.ts:220`）+ 其描述原文「Do not guess the ID: look the model up with the models tool」（`subagent.ts:36-40`）。
9. **子会话用同一地址族的 `parent` 字段表达，深度上限 2 层**（现状 `task_run` 已有此限制，`tools/index.ts:379-386`）；opencode 的 `subagent_depth ?? 1`、DSH `maxDepth` 默认 1 是同类约束。
10. **右栏「等你回答」按请求类型分卡片，不合并成万能卡**。依据：opencode `session/{permission,question,elicitation,websearch}-dock`（`packages/app/src/session/requests/*`）、DSH `ui-approval`/`ui-user-questions`。落点：`apps/app/src/features/views`（design.md §4.8 的 views 槽）。
11. **命令面板一个入口同时搜命令/文件/会话，`mod+k`**。依据：opencode `shell/commands/palette.ts`（`CommandPaletteEntry.type: command|file|session`，`DEFAULT_PALETTE_KEYBIND = "mod+k,mod+shift+p"`）。落点：`apps/app/src/shell/commands`，替换顶栏分散的「搜索/设置」。
12. **壳只拿 `{url, credential}`，不碰数据；启动期探测可复用服务**。依据：opencode `background-service.ts`（`Service.ensure` + `sidecarProbe`）、DSH `host-process.ts` 的 `ready{url, injections}`。落点：`apps/desktop` 读 `<home>/.yonder/gateway.json`（design.md §4.2），与 `Companion.swift` 的 `gateway.json` 分支对齐。
13. **更新器分层 + 状态指示按钮，用 Tauri 三段式**。依据：DSH `update-coordinator/schedule/dialog/presentation/journal` + `DesktopUpdateIndicator.tsx`（8 个 phase）、Tauri `check()/download()/install()/relaunch()`（`C4-install.md:147-167`）。落点：`apps/desktop/src/update/*` + `apps/app/src/shell` 的指示器；签名走 `plugins.updater.pubkey`（Ed25519），与 Developer ID/Authenticode 分开配置。
14. **（附加）能力清单必须在握手期下发，前端 `visible()` 纯函数算**。依据：三家都靠启动注入（DSH injections、opencode `SidecarCredentials` + `incompatible-server-panel`），Yonder 设计里的 `capabilities.get` 正是这个位置（design.md §4.1）——这是三家都没做成「服务端算 UI」的反证。
15. **（附加）保留一条「易失事件流 + 一条可续日志」的双流，而不是把一切塞进一条流**。依据：opencode 明确区分 `GET /api/event`（易失、慢消费者会失败）与 `/log?after`（durable）；DSH 区分 `control`（全 host projection 增量）与 `follow`（单会话日志）。落点：`packages/gateway` 的 `GET /api/stream`（会话日志，可续）+ 可选 `GET /api/events`（活动计数/审批提醒，可丢）。

---

### 附：本次未核实项

- opencode `packages/core/src/tool/plugin/opencode.ts` 里 `session_rename`/`session_move`/`worktree_*`/`models` 的**权限断言细节**（该文件在 sparse checkout 内但注册与权限路径未逐行读完）。
- Yonder `plugins/channel-github/src/update-job.ts` 与 Tauri 壳更新的锁共用是否已实现（`C4-install.md:167` 提出的约定，代码里只有 `.update.lock` 本身，`cli/src/index.ts:794-826`）。
- DSH `mandatory-update-policy.ts` 的服务端契约字段（只读了前 45 行的配置校验，未读响应 schema）。
- pi `packages/chord` 与「远程多客户端」的实际组合方式（pi 本体未使用 chord，属于推断其可复用性）。