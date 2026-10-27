# 08 配置

配置用 YAML。每个配置文件顶层有 `schema: <整数>`，当前仅支持 1；其他版本拒绝，并说明需要对应版本的迁移说明。0.1 没有旧格式，不增加未定义的迁移命令。

## 1. home 目录

```
<home>/
  yonder.yaml           harness：插件、模型、服务、执行环境、agent 登记
  presets/*.yaml        预设（03 §4）；init 生成 default.yaml 供基础 TUI 新任务使用（12 §3）
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
