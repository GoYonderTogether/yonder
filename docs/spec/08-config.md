# 08 配置

配置用 YAML。每个配置文件顶层有 `schema: <整数>`，当前仅支持 1；其他版本拒绝，并说明需要对应版本的迁移说明。0.1 没有旧格式，不增加未定义的迁移命令。

## 1. home 目录

```
<home>/
  yonder.yaml           harness：插件、模型、服务、执行环境、agent 登记
  presets/*.yaml        预设（03 §4）；init 生成 default.yaml 供基础 TUI 新任务使用，并生成选择 web-tools 的 research.yaml（12 §3）
  skills/               所有 agent 与预设共用的 skill（03 §6）
  agents/<id>/          本机工作区（远程工作区不在这里，03 §2.1）
  .yonder/              运行状态，不进版本库
    state.db            事件、会话、身份、pi-durable 存储
    auth.json           凭据（默认位置）
    device-id           本 home 的固定 UUID，OAuth 登录用（07 §6.2）
    plugins/<id>/       插件私有数据
    attachments/        内核下载的附件（03 §5.3）
    logs/               harness 日志
    lock  control.sock
```

## 2. yonder.yaml

```yaml
schema: 1
locale: zh-CN                          # 可省略，默认中文；可显式覆盖为有效 Intl locale
timezone: Asia/Shanghai                 # 可省略，默认北京时间；必须是有效 IANA 时区
defaultModel: provider/modelId          # 全局默认模型（provider/modelId）；不写模型的预设与配置档都用它。代码不含任何模型常量
autoTitle: false                       # 可省略；仅 true 时任务首轮完成后调用模型生成标题

plugins:
  - use: "@yonder/plugin-channel-cli"
  - use: "@yonder/plugin-context-files"
  - use: ./local-plugins/my-plugin       # 本地目录
    config: { … }                        # 该插件的配置段

channels:                                # 渠道实例：id → 提供者 type 与实例配置（04 §3.1）
  cli: { type: cli }
  feishu-main: { type: feishu, appId: cli_a1b2, credential: feishu-main }   # 密钥在凭据文件里
  qq-main: { type: qq, appId: 1234567890, credential: qq-main }             # 密钥在凭据文件里；sendIntervalMs 默认 500（两条发送的最小间隔 ms，可省略）

notifications:                           # 通知级别，06 §9.1；可省略，默认 all
  default: mention                       # all 全部 | mention/mentions 仅 @我 | mute 免打扰
  conversations:                         # 按会话覆盖；键为 conv ref 或 session id
    conv:qq-main:group:7788: mute
credentials: ~/.yonder-credentials/auth.json   # 可选，默认 .yonder/auth.json

models:
  providers:                             # 与 pi 的 models.json 同构
    deepseek:
      baseUrl: https://api.deepseek.com
      api: openai-completions
      authHeader: true
      models:
        - { id: deepseek-flash, reasoning: true, contextWindow: 1048576, maxTokens: 393216, compat: { thinkingFormat: deepseek } }

services: []                             # 非对话服务配置见 07 §6.3

envs:
  local: { type: local }

retry:                                   # 可省略，以下为默认值；修改后重启
  maxRetries: 10                         # 初次请求之外的重试次数，0 禁用
  baseDelayMs: 2000
  maxDelayMs: 300000                     # 每次退避封顶 5 分钟

compaction:                              # 原样传给 pi-durable
  reserveTokens: 16384
  keepRecentTokens: 20000

agents:
  - id: main
    workspace: ./agents/main

identity:
  persons:
    - { id: zoran, name: Zoran, accounts: [acct:cli:local] }
```

`locale` 与 `timezone` 可分别省略，生效默认值为 `zh-CN` 与 `Asia/Shanghai`；显式值须通过运行时 Intl locale 与 IANA 时区校验。`locale` 同时决定默认用户回复语言（用户明确使用其他语言时跟随用户；不擅自翻译 skill 或来源文本）和日期本地化。运行提示词按该 locale/时区渲染本地日历（含星期），同时给出 UTC 时间；插件 SDK 向插件暴露同一全局 locale/timezone，UI Companion 历史日期使用它。此配置不读取操作系统时区；该时区是 Harness 日历/提示词显示设置，不会隐式改变 cron 或 memory 插件的调度/记忆配置。cron 作业仍必须各自提供明确 IANA `timezone`，memory 插件也仍按其自身配置确定日期边界。

`retry` 各字段可单独省略；次数为非负整数，延迟为正整数毫秒（不超过 2147483647）。第 n 次退避为 `min(baseDelayMs * 2^(n-1), maxDelayMs)`，不加随机抖动。次数和截止时间由 pi checkpoint 持久化；恢复保留已消耗次数和已定截止时间，后续退避使用重启后的配置。

`identity.persons` 只用于初始化；之后的关联变化以存储为准，并写 `identity.link` 事件。

`notifications` 可整体省略，等价于 `default: all` 且没有按会话覆盖。`default` 是所有会话的级别，`conversations` 的键为 `conv:` 引用或 session id；`mention` 与 `mentions` 互为别名，读取后统一为 `mentions`，未知级别拒绝。yaml 是节点启动时读取的初始默认值；节点级运行时偏好保存在 `state.db`，覆盖 yaml，设置后立即生效。`notifications.prefs.get` 返回合并结果及各项来源（yaml 或 runtime）；详见 contracts §16。级别不改变事件接纳、绑定唤醒或未读累积（06 §9.1）。

`models.providers.<id>.compat` 与每个模型的 `compat` 逐项传给 pi-ai；在此之上 Harness 另有两个请求整形标志，只增不改，缺省即 pi-ai 的行为。`systemAsUser: true` 表示该 provider/模型会丢弃请求开头的 system 消息（rightapi 的 glm 路由如此）：Harness 不发 system 角色，而把渲染好的系统提示词包成 `<system>…</system>` 放在第一条 user 消息最前面，后面接用户原文；只有第一条 user 携带该块，块内字节在各轮之间不变，压缩之后仍然保留。provider 级与模型级同时给出时模型级覆盖 provider 级；已知供应商的默认值写在代码里（SiliconFlow 的 `supportsDeveloperRole: false`、`rightapi-glm` 的 `systemAsUser: true`），显式写 `false` 可关闭。`doctor` 对已知会丢 system 的 provider 未显式开启时给出提示。
## 3. 重载

| 文件 | 何时生效 |
|---|---|
| `agents/<id>/agent.yaml` | 保存后自动重载，下一次运行生效；校验失败保留旧配置并写 `config.reload` 事件 |
| `presets/*.yaml` | 同上 |
| 上下文文件（SOUL.md、AGENTS.md 等）、`skills/` | 每次组装提示词时读取 |
| `yonder.yaml.agents` | 注册、归档、Agent及preset统一校验后热发布；新输入使用新有效状态 |
| `yonder.yaml` 其余字段 | 需要重启 |

重载先完成与启动相同的结构/引用校验和必要模板创建，再发布候选；无效保留旧配置，seen 对应实际接受版本。实际运行开始时固定配置，当前运行不被重载改变。删除被未关闭会话引用的 profile/preset 不生效，提示先关闭会话；预设创建时的父/调用方能力上限不因重载扩大（10 §2）。

## 4. 一个完整的 agent.yaml（QQ 场景）

```yaml
schema: 1
id: xiaoyuan
name: 小远
owner: person:zoran
defaultProfile: guest
defaults:
  model: openai/gpt-6-luna
  contexts: [soul-md, agents-md]
  plugins: [context-files, qq]
profiles:
  owner:  { level: bypass, tools: { offer: ["*"] } }
  friend: { level: standard, tools: { offer: [qq_*, read] } }
  guest:  { level: readonly, contexts: [agents-md], skills: [] }
  group:  { level: readonly, thinking: low }
  call:   { level: standard, thinking: low }
bindings:
  - { id: calls,    match: { channel: qq-main, kind: call, from: [owner, known] }, session: { mode: persistent, per: conv },   profile: call }
  - { id: owner,    match: { channel: qq-main, from: owner },                      session: main,                              profile: owner }
  - { id: friends,  match: { channel: qq-main, kind: dm, from: known },            session: { mode: persistent, per: person }, profile: friend }
  - { id: stranger, match: { channel: qq-main, kind: dm, from: stranger },         session: { mode: persistent, per: from },   profile: guest }
  - { id: groups,   match: { channel: qq-main, kind: group },                      session: { mode: persistent, per: conv },   profile: group, wake: mention }
```

- 通话：QQ 渠道给每通电话一个新的 `conv`，所以每通电话是一个新会话；跨通话的连贯由记忆类上下文插件按人召回。陌生人的来电没有命中任何绑定，不处理。
- 通话绑定排在 owner 之前，否则主人的来电会进主会话。


名片渠道 `type: card`：endpoint 默认为 https://yonder.zethai.cn，device.kind 默认为 desktop（可选 laptop/server）。令牌仅在插件私有目录，不写配置，见 16。

`defaults`、profile 与 preset 可写 `channelInstances: [qq-main]`（上述 QQ 实例）；数组整项替换，profile 未写则沿 defaults。均未配置保持旧版无限制兼容，不自动推导 bindings；`channelInstances: []` 禁止全部实例。填写显式名单后才启用该资源隔离，admin/bypass 同样受约束；跨实例业务须明确列出所有所需实例。这不是 macOS 沙箱。

## 5. 提示词预算

Agent defaults/profile 与 preset 都可通过 `prompt.sections` 选择内置段落、`prompt.overrides` 替换正文，包括空列表关闭内置正文。沿现有 contexts/skills/tools/plugins/instructions 分别选择其他上下文来源，不自动根据模型名裁剪。字段与继承见 [03 §5.5](03-agents.md#55-小上下文模型与段落配置)，完整配置示例和稳定 id 见 [提示词配置](../prompts/configuration.md)。

## 6. init 的发行包与随包渠道

`yonder init [dir] [--owner <id>] [--bundle core|default|full] --model <provider/modelId> [--isolated]` 由发行包决定写进 `yonder.yaml` 的插件与渠道实例；`initHome(home, owner, { bundle })` 走同一写入路径，默认 `default`，未知包 id 直接拒绝并列出可选值。

| 包 | 写入的插件 | 渠道实例 |
|---|---|---|
| `core` | context-files、interaction、agent-presets、web-tools、learning | 无 |
| `default` | core 加 channel-cli、channel-mcp、channel-card、cron、tasks、onboarding、mcp-client、memory | `cli: { type: cli }` |
| `full` | default 加 channel-feishu、channel-github、channel-qq、clipboard、native-automation、browser-skill、wechat-archive、codex-tools、media-tools、devices | 同 `default` |

- `default`/`full` 写 `card` 渠道实例，因此 init 同时把 `channel-card` 写进 `agents/main/agent.yaml` 的 `defaults.plugins`，main 默认有 `channel-card_card_push`；`core` 没有 card 实例，也不写该插件。已有 home 不自动迁移，需要时在 `defaults.plugins` 里自行加入。
- `core` 不写渠道实例，也不写 `cli` 绑定（`agents/main/agent.yaml` 只留 peer 绑定），否则渠道校验会报 unknown channel。`init --bundle core` + `start --no-gateway` 之后只能通过任务会话（`yonder chat --preset <id>`）对话；日常渠道聊天需要 `default` 或自行添加渠道。
- `default` 按上表写入插件；learning 无 scope 配置时不授权任何 Agent 记忆访问。memory 的必填配置由 init 填入：`root: <home>/memory`（所有 agent 工作区之外）、`owner: person:<owner>`、`timezone`；触发器、采集与白名单都不开，因此不读任何数据。`full` 加载上表中的可选插件；secrets 需单独添加，旧 `hermes-experience` 是弃用别名，不与 `learning` 同时加载。`channel-wechat-ilink`（`config.owner`）需要主人选择，用 `plugins add` 显式加入。
- 第三方渠道 feishu、wechat-ilink、qq、github 随包提供但 init 不启用。`channels.list` 与 `yonder channels list` 的已配置渠道条目（`instance`/`type`/`login`）保持原样；随包未启用的渠道由同一控制方法的可选参数 `channels.list {shipped:true}` 单独返回 `type`/`plugin`/`status: 随包提供，未启用 · Shipped, not enabled`，只列本次安装里插件包实际可解析、且 `yonder.yaml.channels` 尚无同 type 实例的项。CLI 的 `channels list` 把两者依次打印。启用就是在 `yonder.yaml.channels` 加实例并重启。
- `channel-mcp` 随 `default` 加载但不监听：没有 `type: mcp` 的渠道实例时不开端口；写入实例（`port`、`credential`、`account`，可选 `origins`）并重启后才在 `127.0.0.1` 上监听，凭据缺失时请求一律拒绝。
- init 生成的 `presets/default.yaml` 与 `presets/research.yaml`、agent-presets 的任务与常驻模板都不写 `model`，按 `yonder.yaml` 的 `defaultModel` 解析；更换默认模型只改这一个字段。`--model` 必填并写入 `defaultModel`，缺失时 init 报「未指定默认模型」。配置档、agent defaults 自己写了模型则优先。没有任何模型来源时运行报「未配置默认模型」并点名 `defaultModel`。
- 旧 home（`yonder.yaml` 已登记 agent、没有 `defaultModel`）沿用升级前的解析结果 `openai/gpt-6-luna`，行为不变；想换模型就补写该字段（决定见 decisions）。

## 社交策略与主动通知（CH-01）

每个 agent.yaml 可选 `social`：`enabled` 默认 false；`authorized` 可列 people/accounts/conversations，`friends` 为 person/acct，`denied` 为 person/acct/conv；`defaults` 按 dm/group/channel 给策略，`conversations` 按精确 conv 覆盖，`mappings` 包含 subject、agent、profile。缺少 social 保持原行为；新 init 可明确启用。字段形状及信号默认值见 [渠道社交提案 §5](../../proposals/agent-ux/channels-social.md#52-类型定义与字段约束)，以本节和 §13 裁定为准。

策略字段 mode、batch、minIntervalSeconds、signals、keywords、triggers、quiet、foldedEverySeconds、judge 均可选。覆盖按字段合并：内置默认 < defaults[kind] < conv；数组整体替换，空数组清空，不接受 null。count 1–100、delaySeconds 1–3600、maxMessages 1–100、maxBytes 1024–65536、minIntervalSeconds 1–3600、foldedEverySeconds 300–86400、judge.maxCallsPerHour 1–60；keywords 最多 32 项且每项 1–64 字符。quiet 的 timezone 为 IANA、start/end 为 HH:mm，可跨午夜但相等无效。DM 仅 direct/record/mute；group/channel 禁止 direct。

引用须存在，目标 Agent/profile 与渠道实例须存在，目标实例须在该 Agent 的 channelInstances 内（console 例外）；同级映射冲突拒绝。静态配置未知字段按既有 config 规则校验；gateway 请求按其协议兼容未知字段。加载或热重载校验失败保留旧配置并报告路径，revision 是 agent.yaml 的内容版本；更新先校验、比较 revision，再原子替换。

`notifications.outbound` 可选：mode 为 off/digest/immediate，默认 digest；digestEverySeconds 默认 21600、范围 300–86400；maxItems 默认 5、范围 1–20；quiet 同上；decisionRepeat 为 never；target 为 `{to: Ref, via: string}`，必须显式指定账号或会话及实例，省略为 console-only。旧 home 不启用新出口。

默认 batch 为 run false、count 20、delaySeconds 60、maxMessages 100、maxBytes 16384，minIntervalSeconds 60；run 为 true 时允许无 judge 的批次直接运行，未配置或为 false 时保留未读。judge 显式配置后使用来源配置档的 cheap 或 simple，缺失或失败时保留未读，不回退主模型；foldedEverySeconds 21600，judge 关闭，启用后 maxCallsPerHour 默认 6。信号默认 botMention=respond，其余 ownerMention/groupOwner/everyone/keyword=consider；keywords 默认空，按 Unicode NFC 字面匹配。quiet 未配置时不猜时区或睡眠时间。

## 运行期预算与配置视图键（O51 IMP-02/IMP-34，只增不改）

`yonder.yaml` 在前文之外还有以下可选键，全部缺省即旧行为，默认值不写进示例人设：

| 键 | 取值 | 说明 |
|---|---|---|
| `models.chain` | provider 或 `provider/model` 的数组，唯一 | 兜底链顺序，按序回退 |
| `models.priceCapPerMTokenYuan` | ≥0 的数字 | 按量付费模型的单价上限（元/百万 token），输入与输出都不得超 |
| `budget.tokens` | 整数，0 或缺省为不限 | 单会话累计 token 上限 |
| `budget.maxMinutes` | 数字，0 或缺省为不限 | 单会话打开后的分钟上限 |
| `budget.maxWakeups` | 整数，0 或缺省为不限 | 单会话运行次数上限 |
| `budget.overBudget` | `record`（默认）或 `stop` | 超限处理；本版内核按 `record` 只记录并显示 |
| `outsiders.ownerShareDailyTokens`、`outsiders.perPersonDailyTokens`、`outsiders.guestPerQrDailyTokens` | 整数或 `12.5K`/`3M` 字符串 | 外人每日 token 额度 |
| `outsiders.requireLoginForQuota` | 布尔 | 是否要求登录才计入额度 |
| `outsiders.guestMaxRounds` | 0–1000 | 访客单次最长轮数 |
| `outsiders.guestPerSourceDailyRounds` | ≥0 整数 | 访客按来源的每日轮数 |
| `outsiders.capabilities` | `chat`、`web_search`、`public_docs` 的子集 | 外人可用的能力 |
| `outsiders.publicDocs` | 路径数组 | 主人标记为公开、外人只能读这些目录或条目 |
| `defaults.channelPolicy` | `open`（默认）或 `closed` | 未配白名单的渠道：放行走外人额度，或只允许主人与白名单 |

这些键的机器可读形状由 `packages/core/src/config/schema.golden.json` 守护（20 §5），改键即改 golden。控制面通过 `config.get` 的 `home` 视图读取，通过 `config.update` 的 home 白名单写入（contracts.md「O51 IMP-34 运行期契约同步」）；home 段写入需要重启内核才生效，agent 段写入即时重载。

`agents/<id>/agent.yaml` 的可选键另有：配置档或 defaults 内的 `limits.maxTokens`（正整数），以及本文件下文社交策略中的 `social` 段。

群聊调度可为 Agent 设置 `social.scope`，仅该列表使用 social 准入与映射，范围外仍沿原绑定；省略保持原有全局 social 行为。SocialPolicy 新增可选 `plugin: string`，值为当前 Bot/群选择的参与策略插件 id，缺省为 social；可在现有 defaults.group 与 conversations 精确覆盖，沿现有策略合并顺序，不另建插件选择表。目标插件须实际加载并由 Bot 选择，内核按真实插件身份及 Bot/群范围检查；无效选择明确拒绝，不回退或扩大权限。

social 插件既有 `config.groupJudge` 保留为兼容入口，包含复盘 preset、受管 conversations、公开 identities、已核实 rooms，以及可选 review.intervalHours（默认24）/minMessages（默认20）。受管路径使用硬规则，不再按轮调用 judge；旧 judge 配置与历史不移除。triggers 可含有限 regex、字面 exclude、minLength/maxLength；长度范围须有效，正则边界见 11。自调规则版本记录在事件账本，按 Bot/群及基础 ownerRevision 隔离，只覆盖自身触发字段，不覆盖权限/准入/群主策略。公开身份使用显式 identities 或真实名称，缺关注方向不推测。群工具/上下文复用已有插件选择，groupJudge 不代替 Bot 授权。详见 04、11。

