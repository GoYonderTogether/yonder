# memory：用户个人记忆库

*English summary: an official Yonder Harness plugin that keeps one person's memory as plain Markdown, outside every agent workspace. It captures chat, dropped files, registered folders (e.g. an Obsidian vault, read-only) and self-notes from WeChat; searches them with ripgrep; and closes the loop with weekly documents, a life plan, and a propose → owner confirms → organize flow. Spec: `docs/spec/15-memory.md`.*

## 这是什么

一个**属于你、不属于任何 agent** 的资料库。所有 agent 共用同一份，数据是普通 Markdown 文件，用 Obsidian 打开也行，不用也行。

它做四件事：

1. **全部记下来**：你和 agent 的对话、丢进 `inbox/` 的文件、微信文件传输助手里的笔记、你登记的旧笔记目录。
2. **查得到**：用 ripgrep 做字面搜索，不建索引，对中文稳定。
3. **形成时间线**：每月一个目录，每周一个文档（没有每日文档），记录流、计划、决定、产出、复盘都在周文档里。
4. **闭环**：AI 提议 → 你在对话里确认 → 才生效；整理只把记录从 `[ ]` 翻成 `[x]` 并写去向，**从不改你的原文**。

## 它不是什么

- 不是向量检索，也不是自动画像或“分身”。
- 不自己创建 agent、不自己开定时任务、不自己导入旧资料。这些都是**通知 agent，经你确认后**才做。
- 不替你做判断：工具只核验“是谁发的”，不核验内容对不对。

## 目录

```
<root>/                     你指定的绝对路径，必须在所有 agent 工作区之外
  SCHEMA.md                 给模型的读写规则（可改）
  log.md                    变更日志，只记元信息，不复制正文
  mine/                     你亲笔写的东西；插件从不写入
  raw/YYYY-MM/              原始资料：inbox 处理后的原件、转换文本、agent 资料
  inbox/                    把文件丢在这里
  life/                     vision.md（愿景）、<年>.md（年度）
  timeline/YYYY-MM/         month.md（月文档）、YYYY-Www.md（周文档）
  me/                       now.md、profile.md、mind.md：关于你的条目，带 confirmed/inferred
  projects/                 一个项目一个文件
  private/                  私密记录（默认不检索、不进上下文）
  archive/                  只归档，不删除
  .memory/                  状态、manifest、锁
```

登记的外部目录（比如你的 Obsidian 库）**不复制、不改动**，只读检索。

### 周文档长这样

```
## 本周计划       确认过的任务：- [ ] 文字 📅 2026-10-25
## 提议           AI 提议、等你确认的条目
## 决定           背景 / 选项 / 选择 / 理由 / 复查日
## 产出           本周产出的文档，只放链接
## 复盘           AI 草拟，你改定
## 记录流         最后一节，只追加：
                  - [ ] 14:03 {chat} 你说的话 (ref: …) ^id          ← 未整理
                  - [x] 14:20 {capture} … ^id → me/now              ← 已整理，去向
```

文件名 `YYYY-Www` 与 Obsidian Periodic Notes 的默认周格式一致；任务行沿用 Obsidian Tasks 的写法。

## 前置条件

| 需要 | 说明 |
|---|---|
| Node ≥ 22.19 | 同 Yonder Harness |
| `rg`（ripgrep） | 必须在服务进程的 PATH 里；缺失时 `memory_status` 与搜索会给出具体诊断，不会静默失败 |
| 文档转换器（可选） | 推荐 [markitdown](https://github.com/microsoft/markitdown) 0.1.9（MIT）：`pip install "markitdown[pdf,docx]"`。没有它时只处理 md/txt |
| wechat-context 与 wechat-archive（可选） | 只有要采集微信时才需要 |

## 安装与最小配置

```sh
yonder plugins add @yonder/plugin-memory
```

在 `yonder.yaml` 的 `plugins` 里：

```yaml
plugins:
  - use: '@yonder/plugin-memory'
    config:
      root: <绝对路径>             # 必填，在所有 agent 工作区之外
      owner: person:<id>           # 必填，这份记忆属于谁（须与身份映射一致）
      timezone: <IANA 时区>        # 必填，周和日的边界按它算
      allowedAgents: [<agent id>]                 # 见下节
      allowedSourceConversations: [<conv 引用>]   # 见下节
      triggers:
        bootstrap: true            # 建议打开：首次启动创建目录并评估是否需要通知
```

**所有自动行为默认关闭**（`triggers.inbox`、`triggers.bootstrap`、`capture.enabled` 缺省都是 `false`）：不扫描、不初始化目录、不采集聊天、不读微信。需要哪项就显式打开哪项。改插件配置需要重启服务。

### 授权白名单

记忆里有你的个人信息，所以上下文和“确认”只对**白名单里的 agent、来自白名单里的会话、且身份映射确认是你本人**的消息生效：

```yaml
allowedAgents: [<agent id>]
allowedSourceConversations: [<conv:渠道:会话 id>]   # 例如你和日常 agent 的私聊会话
```

两项缺省为空，等于**没有任何人能触发记忆上下文和确认**。工具本身要求 `read`/`write` + `admin` 能力，访客类配置档拿不到。

你的日常 agent 的配置档需要选择这个插件：

```yaml
profiles:
  owner:
    plugins: [memory]
    contexts: [memory-core, memory-week]
    # 工具 memory_*，并有 read、write、admin 能力
```

访客类配置档**不要**选 memory：工具都要求 `admin` 能力，上下文会包含你的个人信息。

## 第一次启动会发生什么

1. 需要 `triggers.bootstrap: true`。启动时创建 `<root>` 下的目录和 `SCHEMA.md`（已有文件不覆盖）。
2. 启动器评估后发出一条 `memory.attention` 事件（`first-run`），里面带着**审计结果**：各来源的文件数、字符数、估算的 token 数。这一步**不调用模型**。
3. 你需要给负责的 agent 加一个绑定，它才会收到这条事件：

```yaml
bindings:
  - id: memory-attention
    match: { type: memory.attention }
    session: main
    profile: owner
```

4. agent 按 skill `memory-onboarding` 向你报告：找到了什么、大约多少 token、粗略费用（只算输入、一遍，不是账单；没有价格就只给 token）。
5. **你明确说“好”之后**，它才会创建后台整理 agent `memory-keeper`、开启你同意的定时节律、开始导入，最后确认（ack），之后不再重复提醒。

另外两种情况也会发 `memory.attention`：`backlog`（inbox 或未整理记录堆积）、`source-stale`（微信归档超过 `wechatStaleHours` 没同步）。

## 采集来源

### 对话

```yaml
capture:
  enabled: true               # 必须显式打开，缺省 false
  channels: [<渠道实例 id>]   # 默认空 = 不采集
  attachments: true           # 附件复制进 inbox，缺省 true；设 false 只记元数据
```

只记录**你本人**（身份映射到 `owner`）在这些渠道里的消息。以 `/` 加字母开头的是命令，不记录。

### inbox 与文档转换

需要 `triggers.inbox: true`。把文件丢进 `<root>/inbox/`，写完后（`chokidar` 的 `awaitWriteFinish`）自动处理：

- 文本原件移入 `raw/`，**字节不变**；重复内容移入 `archive/duplicates/`。
- PDF、docx 等需要转换器，转换产物是原件路径加 `.converted.md`，并做 Unicode NFKC 规范化（PDF 抽取常把“文”变成部首“⽂”，不规范化就搜不到）。

```yaml
converter:
  command: /绝对路径/markitdown
  args: []
  timeoutSeconds: 120
```

调用约定：不经 shell，输入文件绝对路径作最后一个参数，标准输出是 Markdown；非零退出、空输出、超时都算失败，原件保留在 inbox 并在 `memory_status` 里可见。docling 需要自备输出到标准输出的包装脚本。

### 登记旧笔记目录（含 Obsidian 库）

```yaml
roots:
  - { name: <名>, path: <绝对路径>, origin: legacy }
```

`origin` 取 `human`、`agent`、`external`、`legacy`（缺省）。**只读**：参与检索，插件从不写入、移动或改名其中任何文件。`legacy` 表示作者未确认，内容当作假设而不是证据。`root` 与登记目录相同或互相包含时配置无效，不会启动。

### 微信自写笔记

```yaml
sources:
  wechat:
    cliPath: <wechat-context 绝对路径>   # 可选
    chats: [{ chat: <Msg_… 会话 id>, self: true }]
```

- 只读取名单内的会话；`self: true` 表示这是写给自己的笔记（如文件传输助手）。
- 实时：需要同时安装 `wechat-archive`，且它的 `chats` 包含同一会话。
- 历史：agent 调用 `memory_import`；实时与历史共用去重键 `wechat:<会话>:<消息 id>`，重复导入不新增。
- 媒体只记元数据和链接，不复制文件。
- 归档停止同步时会发 `source-stale`；插件**不会**自行修复归档的权限或密钥。

## 日常使用

| 你想 | 做法 |
|---|---|
| 记一件事 | 对 agent 说“记一下……”（`memory_capture`），或直接发到被采集的渠道 |
| 找东西 | 问 agent；它用 `memory_search`（字面子串，同义词由模型展开）和 `memory_read` |
| 定计划 | agent 用 `memory_plan` 提议；你在对话里确认后才写入计划 |
| 整理 | 定时节律或手动让 agent 整理：`memory_review` |
| 改“关于我” | `memory_me`；你亲口说的可标 `confirmed`，模型推断的只能是 `inferred` |
| 私密记录 | `memory_capture` 带 `private: true` |

确认规则：`commit` 和 `confirm` 必须在**由你本人的消息触发的那一轮**执行，并且要确认的提议必须写在这条消息之前，也就是**提议和确认至少隔一轮**。定时任务触发的运行不能自己确认。

## 定时节律（可选）

6 个 skill：`memory-onboarding`、`memory-onboard-legacy`、`memory-evening-wrap`（晚间整理）、`memory-weekly-review`（周复盘）、`memory-monthly-plan`（月计划）、`memory-morning-brief`（晨报）。**建议先只开晚间整理和周复盘。** 插件不会替你创建任何 cron 作业。

用 `cron_manage` 创建事件作业，payload：

```json
{"kind":"event","type":"cron.memory-evening","target":"conv:cron:memory-evening","data":{"skill":"memory-evening-wrap"}}
```

schedule 必须写明时区，格式按 cron 插件的说明。再给 agent 加一个绑定，匹配这个事件类型并选择主人类配置档（可加 `deliver` 把结果发到你的渠道）。`data.skill` 只是告诉模型该用哪个 skill，不是内核自动执行的命令。没有内容可说时，节律可以回复 `NO_REPLY`。

## 后台整理 agent：memory-keeper

插件提供预设 `memory-keeper`：只有 `memory_*` 和基础文件工具，能力是 read、write、admin，**不含** exec、network、message。它不直接给你发消息，结果通过绑定的 `deliver` 投递。

> `admin` 是本插件工具的前置要求，它同时让这个 agent 能改自己工作区里的 `agent.yaml`。这是 0.1 能力词表下的已知局限。

## 隐私与安全

- `private/` 目录和 frontmatter 含 `private: true` 的文件：默认不检索、不进上下文，读取必须显式 `includePrivate: true`。**这不是加密。**
- 删除记忆里的文件**不会**擦除事件库里的原始消息和已发出的事件。
- 带 `exec` 的配置档可以绕过文件工具的边界；亲笔保护不是沙箱。
- 外部内容（inbox 文档、微信消息、转换产物）一律当资料，工具结果带 `externalContent: true`，不当指令。
- 写入有逐文件队列、跨进程锁和原子替换；你同时在 Obsidian 里编辑时，冲突会重读一次，仍冲突就报错，**不覆盖你的编辑**。
- 同一用户权限下，有人在路径检查和写入之间恶意替换符号链接的竞态，目前**防不住**；记忆根请放在私有权限目录里。

## 卸载

删除插件及相关配置、绑定、cron 作业即可。`<root>` 原样保留，不会自动删除任何资料。

## 常见问题

| 现象 | 查什么 |
|---|---|
| 搜索报错或 `memory_status` 显示 rg 不可用 | 服务进程的 PATH 里有没有 `rg` |
| inbox 里的文件不动 | `memory_status` 看状态；非文本需要配置 converter |
| 一直没有收到 `memory.attention` 的回复 | 绑定有没有加、配置档是否存在且选择了 memory |
| 确认被拒 | 在你本人新发的消息触发的那一轮里再确认 |
| 提示冲突、不覆盖 | 说明你正在编辑同一文件；稍后重试 |

## 依赖

SDK 0.2.26102103、typebox 1.3.27、yaml 2.9.1、luxon 3.7.2、write-file-atomic 6.0.0（ISC）、chokidar 5.0.0（不用 6.x，它要求 Node ≥ 22.22）、proper-lockfile 4.1.2、gpt-tokenizer 4.1.0（`o200k_base`，只用于估算）。测试范围、原始失败与未验收项见 [verification.md](verification.md)；完整规范见 [docs/spec/15-memory.md](../../docs/spec/15-memory.md)。
