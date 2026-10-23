# 03 Agent、配置档与提示词组装

## 1. 两类执行者

| | 常驻 Agent | 预设 Preset |
|---|---|---|
| 身份 | 有：id、owner、账号、绑定 | 无 |
| 工作区 | 有，一个文件夹 | 无；会话和配置照常记录 |
| 会话 | main / persistent / ephemeral | task |
| 用途 | 长期存在的个人或业务 agent | 给任何 agent 或外部调用方临时用一下：编码、调研…… |

## 2. Agent 工作区

### 2.1 位置

工作区 = **执行环境 + 路径**（05 §4）。home 的 `yonder.yaml` 登记每个 agent：

```yaml
agents:
  - id: main
    workspace: ./agents/main          # 默认执行环境 local
  - id: gpu-coder
    env: gpu-box                      # 工作区在远程环境里，主机上没有这个文件夹
    workspace: /home/me/agents/gpu-coder
```

内核读写工作区一律通过执行环境接口（架构不变量 8）。

### 2.2 内容

```
<workspace>/
  agent.yaml     必需。身份、绑定、配置档、选用的上下文与插件
  SOUL.md        可选（soul-md）。风格、扮演的角色、品味
  AGENTS.md      可选（agents-md）。工作方式、工作范围、执行任务的方式与风格
  skills/        可选。这个 agent 自己的 skill（§6），agent 可以自己写
  memory/        手工按需资料；README说明临时方法，不自动注入或维护
  …              其余文件由选用的上下文贡献声明（04 §3.3），缺失时按声明自动生成
```

- 内核只规定 `agent.yaml`。Agent 自己的提示词只有两份：`SOUL.md`（风格、角色、品味）与 `AGENTS.md`（工作方式与范围），由 context-files 插件的 `soul-md`、`agents-md` 贡献，init 默认选用。两份同一种语言，随角色而定：默认英文，明确的中文角色设定才用中文；Agent 按主人使用的语言回话。`USER.md`、`MEMORY.md`、`memory/` 等同样不是内核概念；不选就不存在、不占上下文。
- agent 用普通的文件工具修改自己的工作区。写 `agent.yaml` 需要 `admin` 能力，其余文件需要 `write` 能力（05 §3）。插件可以把自己声明的文件标为受保护，并指定所需能力。

### 2.3 agent.yaml

```yaml
schema: 1
id: main                          # 等于 yonder.yaml 中的登记 id
name: 小远
owner: person:zoran
defaultProfile: owner
defaults:                         # 所有配置档的默认值，配置档可逐项覆盖
  model: openai/gpt-6-luna
  contexts: [soul-md, agents-md]  # 上下文贡献 id，按顺序
  plugins: [context-files]        # 这个 agent 用哪些插件的工具与钩子
profiles:
  owner: { level: bypass }
  guest: { level: readonly, contexts: [agents-md], instructions: 只回答公开信息。 }
bindings: [ … ]                   # 见 02 §2
```

## 3. 配置档

配置档决定一次运行用什么。属于 agent 的配置档就是这个 agent 的"分身"：同一个身份、同一个工作区，能力不同。

| 字段 | 含义 |
|---|---|
| `model` | `provider/modelId`（07 §6） |
| `fallback` | 可选 `{ models: [provider/modelId, ...], after: 3 }`；主模型连续失败达到 after 后按顺序回退，成功响应清零计数；最后一个模型也只尝试 after 次。省略则沿用原生 retry。计数与当前模型限于本次运行，新运行从主模型开始。 |
| `thinking` | `off` / `minimal` / `low` / `medium` / `high` / `xhigh` / `max` |
| `level` 或 `capabilities` | 安全级别或显式能力列表（05 §2），二选一 |
| `plugins` | 用哪些插件的工具与钩子 |
| `tools` | `{ offer: [glob…], search: [glob…] }`。`offer`：工具定义常驻在请求里；`search`：通过按需搜索加载（07 §4）。都要先通过能力过滤 |
| `contexts` | 上下文贡献 id，按顺序 |
| `skills` | skill 名的通配列表，默认 `["*"]`（§6） |
| `instructions` | 追加在系统提示词最后 |
| `env` | 工具在哪个执行环境运行；默认是工作区所在环境 |
| `limits` | 覆盖运行软阈值与重复空转保护：`{ maxTurns, maxMinutes, maxTokens, repeatBlock, repeatStop }`（07 §5） |

未写的字段取 `defaults`，再取内核默认。

内核默认：`model: openai/gpt-6-luna`、`thinking: medium`、`level: readonly`、`plugins: []`、`tools: { offer: ["*"], search: [] }`、`contexts: []`、`skills: ["*"]`、`instructions: ""`；`env` 取工作区环境，`limits` 取 07 §5。数组整项替换；`tools` 与 `limits` 按键覆盖。`level` 与 `capabilities` 是同一组选项，配置档指定任一个就替换 defaults 的这一组，不能把两个来源合并成冲突。其余字段按字段覆盖。通配只支持 `*`（任意字符串）与 `?`（单字符），不引入路径 glob 语言。

## 4. 预设与临时会话

预设是不属于任何 agent 的配置档，放在 `<home>/presets/<id>.yaml`（`id` 取文件名），或由插件贡献（04 §3.7）。字段同 §3，另加必填的 `description`（一句话，会出现在 `task_run` 工具说明里）。SDK 类型：`Preset = Profile & { id: string; description: string }`，`Profile` 即 §3 的字段表。

- 内核工具 `task_run({ preset, task, attachments? })`：用预设开一个 `task` 会话，把 `task` 作为输入，运行结束后把最终回复作为工具结果返回，会话关闭。基于 pi-durable 的子会话所有权，发起方中止时子会话一并中止。
- 子会话的能力 = 预设能力 ∩ 发起方能力。**禁止**借预设提权。
- 插件（例如 MCP 服务端渠道）用 `sessions.open({ preset, capabilities })` 打开预设会话、`submit` 驱动；能力 = 预设 ∩ `capabilities`，插件应当传入它代表的外部调用方被允许的能力。
- 基础 TUI 的待审核方案（12）：独立任务使用 `sessions.open({ preset, close: 'manual' })`，首次发送才创建，连续追问沿用同一 conversation；没有 agent 身份、工作区或常驻绑定。默认 `run-end` 与 `task_run` 仍一轮结束后关闭。init 生成无虚构人设的 default 预设，具体值见 12 §3；这不是新增 agent。
- 有 parent 的预设会话在创建时保存实际父 cwd/env 与能力上限；无 parent 时 cwd 为 home、env 默认为 local。预设显式 env 优先。首次运行取当前预设能力与保存的父/调用方限制相交，不因重载扩大已授范围；已开始运行按原配置恢复。没有 agent 工作区，不读取工作区上下文贡献；system 保留框架、共同底座、运行约定、按能力选择的 CLI 导航、home/插件 skill 索引和 instructions；不装入常驻身份段。有效能力、cwd/env 与运行配置存在 pi 扩展文档中供恢复使用，不增加 Yonder 转录或会话表字段。

## 5. 提示词组装

### 5.1 三个位置

| 位置 | 放什么 | 规则 |
|---|---|---|
| system | 依次：① 框架段 ② 内置共同底座 ③ 常驻身份段（仅有 agent）④ 内置运行约定 ⑤ CLI 自管理导航（仅有 exec）⑥ skill 索引（§6）⑦ `placement: system` 的上下文贡献（按 `contexts` 顺序，SOUL.md、AGENTS.md 在此）⑧ 配置档 `instructions` | **必须**是确定性的：同样的配置、同样的文件内容，渲染结果逐字相同（不放时间、不放随机内容），以命中提示缓存 |
| 本轮输入 | 依次：① 输入准备时的 `<runtime_clock>` 时间快照和内核的 `<turn>` 块 ② 原事件正文（紧随其来源与原时间）③ `placement: turn` 的补充上下文 | 随用户消息一起写入转录，可审计，不再改写 |
| tools | 只放工具定义 | 不在工具定义里塞上下文 |

### 5.2 框架段

内核写死、agent 不能改的一小段，只说明：运行在 Yonder Harness、自己的 agent id 与当前配置档、06 §4 列出的规则、可以用 `yonder` 命令与 `yonder docs` 了解和维护自己的运行环境（09 §1，仅当配置档有 `exec`）。用英文书写，**应当**控制在 250 词以内。

### 5.2.1 非插件内置底座

英文正文只有一份，即 `packages/core/src/prompt/content.ts`，不另设译文审阅源。共同底座说明产品愿景、所有 Agent 共有的习惯、使用建议与资产维护；常驻身份说明 SOUL.md/AGENTS.md 的地位、生命连续性、唯一主人与社交关系、持续授权、工作线分工、任务与协作、成长；运行约定说明事件、插件、会话、投递与可信元数据、位置与源码、技能入口。只写模型反复犯错之处与 Yonder 特有事实，不写通用美德；用 Yonder 自己平实的嗓子，不含具体名字、人设或作家文风，不改权限系统。

框架段的250词约束只约束5.2短导航，不截断完整底座。常驻身份仅真实agent装入，无身份preset不获得主人关系。CLI命令导航仅有exec能力时装入；skill_view等非CLI说明按实际工具规则使用。正文随版本编译，稳定、一次装入，不新增文件读取/回退/复制脚本；技能、上下文与instructions顺序相对保持。

### 5.3 `<turn>` 块

每个提交的事件都带一个，run/write 都标明原事件 id/type；以下只示意既有消息正文格式：

```
<turn id="事件id" type="message.in" time="2026-10-18T14:03:00+08:00" channel="qq-main" kind="group" conv="conv:qq-main:g:7788">
from: 阿明 (acct:qq-main:10001, known: person:aming)
attachment: 报价单.pdf (application/pdf, 120 KB) file:///…/报价单.pdf
notice: yonder harness updated from 0.1.0 to 0.1.1; details: yonder changelog --from 0.1.0 --to 0.1.1
</turn>
```

- 仅 `wake: run` 增加可信运行事实：当前软件version与home、有效env与cwd、宿主prepared时间/时区/platform。宿主与执行环境分别标明，cwd不冒充远程宿主或工作区；不新增时间轮询。prepared为本次输入准备时刻，不替换事件原时间。这些事实随输入保留，不进入system。
- `attachment:` 每个附件一行。模型支持图片输入时，图片附件不列在这里，而是由内核读取后作为图片块放进同一条用户消息（超出模型 `inputLimits` 的仍按附件列出）；其余附件只列出，由工具处理。`http(s)` 地址由内核下载到 `<home>/.yonder/attachments/` 后改写为 `file://`。
- `notice:` 只在会话的 `version` 与当前版本不同时出现一次（09 §4）。
- 以 `wake: write` 写入的消息只带 `from` 与 `attachment` 行，不带时间以外的环境信息。
- id/type 对 write 同样保留；message.in/session.input 继续使用 text 与附件，其他事件将完整 data JSON 序列化为正文。插件负责原生事实，内核不识别 release 或卡片专用字段。外部名称、附件名按字符串转义为单行，不能通过换行或标记制造框架边界；原事件保持不变（10 §1.1）。
- 提示词、环境、能力与投递均使用本次运行配置；新选中的上下文文件在配置发布前完成必要 scaffold。版本只在输入真正提交后确认，准备失败不能吞掉 notice。

### 5.4 SOUL.md 与 AGENTS.md 模板

选用 `soul-md`、`agents-md` 时，context-files 生成只含文件名标题与一句用途说明的英文模板，不含虚构的人设或示例对话。未经编辑的模板不注入提示词。

## 6. Skill

采用 [Agent Skills](https://agentskills.io/specification) 标准，与 pi、Claude Code、Codex、OpenClaw、Hermes 通用：别处的 skill 原样放进来就能用。

**格式**：一个目录，含 `SKILL.md`。frontmatter 的 `name`（小写字母、数字、连字符，不以连字符开头结尾、不连续，≤ 64 字符）与 `description`（必填，≤ 1024 字符）是内核用到的字段；`disable-model-invocation: true` 的 skill 不进索引；其他字段保留不用。格式不合法的 skill 不加载，`yonder doctor` 与日志说明原因。

**来源**（同名时排前者生效，`doctor` 报告被遮蔽的）：

1. agent 工作区的 `skills/`（经执行环境读取）；
2. home 的 `skills/`；
3. 插件贡献（04 §3.8）；
4. 安装代码根目录skills/内置技能。

预设会话没有工作区，使用home、插件及内置来源。目录按 `**/SKILL.md` 递归发现。

**选择**：配置档的 `skills` 通配列表（默认 `["*"]`）；访客类分身可以设为 `[]`。

**索引**：system 第 ⑦ 段（§5.1），按 `name` 排序，每个 skill 只有名字与描述，格式：

```
<skills>
<skill name="pdf-tools">Extract text and tables from PDF files. Use when …</skill>
</skills>
```

索引在每次组装提示词时重新生成（skill 有变化才会改变 system）。索引超过 4000 个估算 token（字符数 ÷ 4）时 `doctor` 警告，内核不截断。

**读取**：内置工具 `skill_view({ name, path? })` 返回 `SKILL.md` 全文，或 skill 目录内的某个文件（`path` 相对 skill 目录，不能越出）。结果开头注明 skill 目录的绝对路径与所在位置（工作区所在执行环境，或主机）。`skill_view` 不需要能力，只能读本配置档选中的 skill；运行 skill 里的脚本仍需 `exec`，且只有脚本所在位置与本次运行的执行环境相同时才可行。

**自己写 skill**：agent 用普通文件工具在工作区 `skills/<name>/SKILL.md` 写入（需要 `write`），下一次运行即进入索引。内核不自动生成、合并或删除 skill；自动整理之类的策略由插件实现。

**与工作流的区别**：skill 是给模型的做事说明，在一次运行里由模型照着做；工作流是跨多次运行、多个 agent 或脚本的编排。0.1 不做工作流，两种做法都有现成接口：模型驱动（skill 写清步骤，模型调用 `task_run` / `agent_ask`），或代码驱动（插件用触发器 + `events.on` + `events.ask`，04 §8）。

## 7. 本地管理补齐

Skills 本地导入/查看/删除、来源与配置诊断的完整边界按 13 §2。发现/遮蔽/profile 选择仍按本页，不增加自动学习引擎、启停数据库或会话中 profile 热切换。

Agent 与预设的热管理、归档与模板创建见 [14 §4](14-execution-capabilities.md)；limits.maxTurns/maxMinutes/maxTokens 是软提醒阈值，见 14 §1。

## 8. 子任务结果

子任务输入附件由调用方显式选择，默认不继承父全部附件；每条附件保留原来源与既有读取范围。task_run 返回包含实际 child session、status、reason、text 和可选 attachments 的结构化正文。ToolResult 可携带显式 attachments，runtime 把这些真实产物引用存入该工具原生结果元数据并在本轮结果中保留；没有产物不造附件，不从自然语言猜路径，不扫描工作区搜集文件。结果引用不自动扩大父调用方权限，读取/发送仍校验；不增加 artifact 数据库。

## 9. 内置创作与开发技能

发行包含完整上游skill-creator（含许可及引用资源）与简洁yonder-development，默认skills=[*]的所有agent及预设可发现，只有名字描述进入索引，正文仍由skill_view按需加载。显式skills选择/禁用和workspace/home覆盖仍有效，不以“默认”绕过用户过滤。现有本机agent配置中的显式白名单加入这两项，不强制未来配置。

yonder-development提供可工作的建议：默认源码<home>/development/<name>或用户指定路径，普通插件独立git保存，官方代码改动常规fork/branch/PR；运行用隔离home与自身凭据，不覆盖正式launchd。正式程序仅update更新，不在versions/current改源码。用户可选择其他方式；skill不授予push/发布权限，不建立强制工作流或自动创建remote。
