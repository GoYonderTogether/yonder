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
  SYSTEM.md      必需。agent 的基础系统提示词，初始化时由内核模板生成，之后可自由修改
  …              其余文件由选用的上下文贡献声明（04 §3.3），缺失时按声明自动生成
```

- 内核只规定 `agent.yaml` 和 `SYSTEM.md`。`AGENTS.md`、`USER.md`、`SOUL.md`、`MEMORY.md`、`memory/` 等都不是内核概念，而是上下文插件的贡献；不选就不存在、不占上下文。
- agent 用普通的文件工具修改自己的工作区。写 `agent.yaml` 需要 `admin` 能力，其余文件需要 `write` 能力（05 §3）。插件可以把自己声明的文件标为受保护，并指定所需能力。

### 2.3 agent.yaml

```yaml
schema: 1
id: main                          # 等于 yonder.yaml 中的登记 id
name: 小远
owner: person:zoran
defaultProfile: owner
defaults:                         # 所有配置档的默认值，配置档可逐项覆盖
  model: chatgpt/gpt-6-luna
  contexts: [agents-md, user-md]  # 上下文贡献 id，按顺序
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
| `thinking` | `off` / `minimal` / `low` / `medium` / `high` / `xhigh` / `max` |
| `level` 或 `capabilities` | 安全级别或显式能力列表（05 §2），二选一 |
| `plugins` | 用哪些插件的工具与钩子 |
| `tools` | `{ offer: [glob…], search: [glob…] }`。`offer`：工具定义常驻在请求里；`search`：通过按需搜索加载（07 §4）。都要先通过能力过滤 |
| `contexts` | 上下文贡献 id，按顺序 |
| `instructions` | 追加在系统提示词最后 |
| `env` | 工具在哪个执行环境运行；默认是工作区所在环境 |
| `limits` | 覆盖运行上限（07 §5） |

未写的字段取 `defaults`，再取内核默认。

## 4. 预设与临时会话

预设是不属于任何 agent 的配置档，放在 `<home>/presets/<id>.yaml`，或由插件贡献（04 §3.7）。字段同 §3，另加必填的 `description`（一句话，会出现在 `task.run` 工具说明里）。

- 内核工具 `task.run({ preset, task })`：用预设开一个 `task` 会话，把 `task` 作为输入，运行结束后把最终回复作为工具结果返回，会话关闭。基于 pi-durable 的子会话所有权，发起方中止时子会话一并中止。
- 子会话的能力 = 预设能力 ∩ 发起方能力。**禁止**借预设提权。
- 外部调用方经由渠道插件，用 `sessions.open({ preset })` 使用预设，能力取该渠道绑定所指定的配置档与预设的交集。

## 5. 提示词组装

### 5.1 三个位置

| 位置 | 放什么 | 规则 |
|---|---|---|
| system | 依次：① 框架段 ② `SYSTEM.md` ③ `placement: system` 的上下文贡献（按 `contexts` 顺序） ④ 配置档 `instructions` | **必须**是确定性的：同样的配置、同样的文件内容，渲染结果逐字相同（不放时间、不放随机内容），以命中提示缓存 |
| 本轮输入 | 依次：① 内核的 `<turn>` 块 ② `placement: turn` 的上下文贡献 ③ 消息正文 | 随用户消息一起写入转录，可审计，不再改写 |
| tools | 只放工具定义 | 不在工具定义里塞上下文 |

### 5.2 框架段

内核写死、agent 不能改的一小段，只说明：运行在 Yonder Harness、自己的 agent id 与当前配置档、回复规则（06 §4）、`message.send` 与 `task.run` 的用途。用英文书写，**应当**控制在 200 词以内。

### 5.3 `<turn>` 块

每个唤醒运行的入站事件都带一个：

```
<turn time="2026-10-18T14:03:00+08:00" channel="qq-main" kind="group" conv="conv:qq-main:g:7788">
from: 阿明 (acct:qq-main:10001, known: person:aming)
</turn>
```

以 `wake: write` 写入的消息只带 `from` 一行，不带时间以外的环境信息。

### 5.4 SYSTEM.md 模板

初始化 agent 时内核写入一份模板：只含标题与空的段落提示（身份、职责、边界），不含虚构的人设或示例对话。
