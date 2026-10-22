# memory

用户个人资料库插件，独立于 agent 工作区。当前实现 WP1–WP7：个人记忆文件库、检索/整理、受限来源导入、审计启动、两个上下文贡献与六个按需 skills。它不是向量检索、自动画像或跨会话聊天记忆注入。

Node ≥ 22.19；状态工具需要 read + admin。自动行为均为 opt-in：`triggers.inbox` 与 `triggers.bootstrap` 缺省/省略时均为 `false`；禁用的 trigger start/stop 不初始化、扫描或读取 `root`。只有显式设为 `true` 才分别启动 inbox watcher/重扫或 bootstrap 首次审计/周期检查。`capture.enabled` 缺省为 `false`，即使配置了 `capture.channels` 也不自动处理消息或附件；需显式设 `enabled: true` 并配置 channel 才启用。旧配置若曾用 inbox/bootstrap 自动监控或消息自动 capture，迁移时须人工添加相应 `triggers.*: true` / `capture.enabled: true`；本升级不会自动恢复这些动作。手动工具和 contexts 不依赖这些开关。配置必填 `root`（绝对路径，位于所有 agent 工作区外）、`owner`（person: 引用）、`timezone`（IANA 时区）。`allowedAgents` 与 `allowedSourceConversations` 是管理员明确维护的身份边界：memory 读写工具与个人记忆上下文仅在 agent 位于前者、事件为 `message.in`、来源 acct 解析到 owner、且完整 `event.conv` 精确命中后者时授权；两项默认空。allowlist 不可由模型或工具参数改变。SDK 未提供私聊标志，因此配置会话是管理员逐会话批准，不代表系统自动识别私聊。无 conv 一律拒绝，不用 from/account 引用兜底。登记目录只读，root 与任一登记目录相同或互相包含时加载失败，不初始化。目录/固定文件只在触发器 start 创建，已有文件不覆盖。

依赖精确版本：`@yonder/sdk@0.2.26102103` 提供插件接口；`typebox@1.3.27` 校验配置与参数；`yaml@2.9.1` 读取 frontmatter。不安装转换器，不自动访问微信内容，不安装到正式服务。

详细执行与检查记录见 [verification.md](verification.md)。

WP2 已加入 `memory_capture`（参数见规范 §5.1）、周/月文档引擎、补记、私密记录、长正文 raw 文件、逐文件互斥、原子替换与元信息日志。`material` 忽略 by，不能与 private 同用。周按配置时区与 ISO 周四定月，补记只追加不重排。整理标记与节写入目前为内部引擎，memory_review 工具属于 WP5。

WP2 精确依赖：`luxon@3.7.2`（MIT，Node ≥12）负责时区、DST 与 ISO 周；`write-file-atomic@6.0.0`（ISC，Node ^18.17.0 或 ≥20.5.0）负责临时文件、fsync 和原子替换，均兼容本仓库 Node ≥22.19。开发类型包 `@types/luxon@3.7.6`、`@types/write-file-atomic@4.0.3` 仅用于构建。不手写日期算法或替换原子写库。


WP3 使用 PATH 中的 `rg`，固定字面/忽略大小写/不跟随链接参数，不经 shell。查询同时搜索用户输入与其 NFKC 形式，按文件聚合并按逐命中的来源与日期过滤；不改写已有兼容字符原文。默认搜索 timeline/life/me/mine/raw/projects 和登记目录，不含 archive/private；private 与 frontmatter 私密文件需显式 includePrivate。登记目录路径写作 `<name>:<相对路径>`，只读；memory_read 也可按 ISO 周定位，并分页返回至多 12000 字符。缺 rg 给出诊断，不提供另一套检索实现。

测试仅使用临时文件系统；尚未在用户 Obsidian/微信归档、真实模型或正式服务验证。卸载配置不会删除根目录。根 package-lock.json 未在本任务允许的修改范围内更新，全新 npm ci 安装新 workspace 未验收。

WP4 已接入主人白名单消息与 inbox：chokidar@5.0.0（MIT，Node ≥20.19）awaitWriteFinish 1000ms；周期重扫兜底。点文件和下载临时文件不处理；转换失败留在 inbox 并在 status 报错。文本原件不添加 frontmatter，manifest 的 files[path].origin 是其权威来源，hashes[sha256] 指原件路径；keys 保存事件/微信等去重引用，不含正文。附件使用随机前缀文件名避免冲突。转换文件为原件路径加 .converted.md，写 origin/source/sha256/converted，并做 NFKC。推荐外部 markitdown 0.1.9（MIT），插件不负责安装。`converter.command/args/timeoutSeconds` 是管理员配置的固定可执行文件和参数，不能由模型或附件覆盖；未配置时不调用转换器。转换前拒绝符号链接、非普通文件、超出 `capture.maxAttachmentBytes`（默认 25 MiB）的文件，并校验扩展名对应的 PDF/ZIP(DOCX)文件签名；这些检查不是恶意软件扫描或隔离。转换器以插件进程同一 UID 运行，无法防御同 UID 对手在检查后替换文件，也不能消除转换器自身漏洞风险。

WP5 已接入 memory_plan、memory_review、memory_me。所有操作显式传 op，参数见规范 §5.1；commit/confirm 检查当前运行首事件为owner message.in且晚于提议。confirmed事实的evidence为 evt:<当前事件id> 或 ^<确定性chat/wechat-self条目id>，模型调用的said不算证据。me手改条目通过与插件写入快照比对，读取时按confirmed呈现，不回改用户文件；历史不删除。新建me文件含当前/历史，新建month/year/vision含规范节与历史，不覆盖已有文件。

WP6 已接入名单内微信实时/历史、memory_import、memory_bootstrap和memory-keeper预设。微信正文仅用于存储与调用方检索，日志只记录元信息；历史和实时共用 wechat:<chat>:<msgid> 键。分页按CLI给出的nextBefore继续，不假定数值递减；dryRun不写入，返回written=0。未同步或无转换器时不会自行修环境。

审计采用 gpt-tokenizer@4.1.0（MIT）o200k_base，只读、无模型调用、不触发转换；按文本估tokens，未转换格式单列未估。输入目录价来自api.models（美元/百万tokens），无价不猜，仅作输入单次量级估算，不含输出、多轮和订阅计费差异。ack缺省静默cooldownHours，传snoozeDays可覆盖；first-run ack设置initialized，first-run/source-new ack持久记录本次确认审计的来源名/id。初始化和告警不创建agent、作业或导入。

## 上下文、技能与隐私

`memory-core` 只读取 `me/now.md`、`me/profile.md`、`me/mind.md`，最多 `context.meChars`（默认 2000）字符；空缺、私密标记文件不贡献。`memory-week` 和 `memory-core` 仅在通过上述 agent、owner acct 与精确 conv allowlist 鉴权后提供个人记忆；无 conv、未批准会话、非 owner 或未批准 agent 均不贡献。贡献是确定性文件读取，不搜索 private 目录，不调用模型。六个 `skills/` 可由 profile 按需选用：morning-brief、evening-wrap、weekly-review、monthly-plan、onboarding、onboard-legacy。

配置示例（触发器和自动 capture 全部关闭；这些开关不影响手动工具/contexts）：

```yaml
triggers:
  inbox: false
  bootstrap: false
capture:
  enabled: false
  channels: []
  attachments: false
# 不配置 converter 时绝不调用转换器。
```

`plugins/memory/package.json` manifest 仍声明两个 trigger ID，以供宿主发现；每个 trigger 的运行行为由上面的受 schema 校验配置门控。`SCHEMA.md` 是新库结构说明。插件不会读取其他 session/agent 的对话或工作区历史；记忆内容只通过配置根目录的静态文件与显式工具调用进入上下文。`admin` 是本插件工具要求，也允许 agent 修改自身工作区配置（SDK 当前能力词表的已知限制）。卸载只移除插件配置，不删除根目录；事件库记录不承诺可擦除。

周期任务示例（须在目标 agent 的配置中显式设置）：`payload: { kind: "event", type: "cron.tick", target: "memory-keeper", data: { name: "weekly-review" } }`。启用前请按 cron 插件实际作业 schema 配置并人工确认主人资料；不会自动创建作业。

常见问题：缺少 `rg` 时检索工具报告错误；缺少 `markitdown` 只影响不支持的文档转换，原件保留；微信工具不可用时跳过微信导入并保持文件资料可用；目录不可读或 owner 无法核验时上下文缺省，不猜测身份。
