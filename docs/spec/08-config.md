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

plugins:
  - use: "@yonder/plugin-channel-cli"
  - use: "@yonder/plugin-context-files"
  - use: ./local-plugins/my-plugin       # 本地目录
    config: { … }                        # 该插件的配置段

channels:                                # 渠道实例：id → 提供者 type 与实例配置（04 §3.1）
  cli: { type: cli }
  feishu-main: { type: feishu, appId: cli_a1b2, credential: feishu-main }   # 密钥在凭据文件里

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
| `core` | context-files、ui-companion、agent-presets、web-tools | 无 |
| `default` | core 加 channel-cli、channel-mcp | `cli: { type: cli }` |
| `full` | default 加其余随包插件：channel-card、channel-feishu、channel-github、channel-qq、clipboard、native-automation、browser-skill、wechat-archive、codex-tools、media-tools、mcp-client、cron、tasks、hermes-experience、devices | 同 `default` |

- `core` 不写渠道实例，也不写 `cli` 绑定（`agents/main/agent.yaml` 只留 peer 绑定），否则渠道校验会报 unknown channel。`init --bundle core` + `start --no-gateway` 之后只能通过任务会话（`yonder chat --preset <id>`）对话；日常渠道聊天需要 `default` 或自行添加渠道。
- 需要主人级插件配置、init 无法替主人选择的插件不进任何包：`channel-wechat-ilink`（`config.owner`）与 `memory`（`root`/`owner`/`timezone`）用 `plugins add` 显式加入并写配置。统一客户端目标里的默认加载集（memory、cron、tasks、learning、channel-card、mcp-client）尚未全部由 init 写入，见 [状态](../status.md)。
- 第三方渠道 feishu、wechat-ilink、qq、github 随包提供但 init 不启用：`yonder channels list` 对已启用实例返回 `instance`/`type`/`login`，对未启用的随包渠道返回 `type`/`plugin` 与 `status: 随包提供，未启用 · Shipped, not enabled`。启用就是在 `yonder.yaml.channels` 加实例并重启；同一个 type 已有实例时不再重复列出。
- `channel-mcp` 随 `default` 加载但不监听：没有 `type: mcp` 的渠道实例时不开端口；写入实例（`port`、`credential`、`account`，可选 `origins`）并重启后才在 `127.0.0.1` 上监听，凭据缺失时请求一律拒绝。
- init 生成的 `presets/default.yaml` 与 `presets/research.yaml`、agent-presets 的任务与常驻模板都不写 `model`，按 `yonder.yaml` 的 `defaultModel` 解析；更换默认模型只改这一个字段。`--model` 必填并写入 `defaultModel`，缺失时 init 报「未指定默认模型」。配置档、agent defaults 自己写了模型则优先。没有任何模型来源时运行报「未配置默认模型」并点名 `defaultModel`。
- 旧 home（`yonder.yaml` 已登记 agent、没有 `defaultModel`）沿用升级前的解析结果 `openai/gpt-6-luna`，行为不变；想换模型就补写该字段（决定见 decisions）。
