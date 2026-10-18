# 07 运行时：与 pi 的对接

## 1. 对接边界

- 依赖：`@earendil-works/pi-ai`、`@earendil-works/pi-durable`（及其要求的 `@earendil-works/chord`）。版本**锁定到精确版本**，升级单独成一个变更。
- 只有 `packages/core/src/runtime/` 可以 import 这些包。其他内核代码只用 runtime 目录导出的 Yonder 自己的类型。
- pi-durable 标注为实验性。runtime 目录的测试必须覆盖本文用到的每一个 pi 能力，升级 pi 时先跑这组测试。
- 不使用 pi 的 coding-agent（CLI、界面、它的会话文件和配置格式）。

## 2. 存储

- 一个 home 一个 SQLite 文件：`<home>/.yonder/state.db`。pi-durable 的表用前缀 `pi_`，Yonder 的表用前缀 `y_`。
- 若同一文件共享不可行（T00 验证），退回两个文件：`pi.db` 与 `yonder.db`，其余不变。
- 一个 home 同一时间只由一个 harness 进程打开（pi-durable 不做跨进程锁；Yonder 用 `<home>/.yonder/lock` 文件保证）。CLI 的其他命令通过本地控制接口（§8）与运行中的进程交互。

## 3. 映射

| Yonder | pi-durable |
|---|---|
| 一个 home | 一个 `Harness` |
| 会话 | 一个 conversation；Yonder 元数据存在 `y_sessions`，并在 conversation 的自定义文档 `yonder.session` 中存 `{ agent, profile }`，供提示词片段读取 |
| 配置档 | `conversation.configure({ model, thinkingLevel, extensions, tools, modelTools, instructions, cwd })` |
| 框架段、`SYSTEM.md`、上下文贡献 | 扩展 `yonder.core` 的 sections，按 03 §5.1 的顺序 |
| 插件工具 | 每个插件一个扩展 `plugin:<id>`，配置档选用的插件才进入 `extensions` |
| 安全钩子、上限钩子 | 扩展 `yonder.core` 的 hooks，最先执行 |
| `wake: run` | `submit({ type: 'input', content, entry: { kind: 'yonder.message', data: { event } }, whenBusy })` |
| `wake: write` | `submit({ type: 'write', entry: { kind: 'yonder.message', data, model: [用户消息] } })`，让模型之后能看到旁观到的消息；T00 验证 `model` 字段的写法 |
| `task.run` | pi-durable 子会话模式：在工具的 `api.commit` 里创建由该工具任务拥有的 conversation |
| 用量 | conversation 文档 `pi.usage`；`run.end` 记录本次运行的增量 |

## 4. 工具暴露

- 配置档 `tools.offer` → `modelTools`（定义常驻）；`tools.search` → 在 `tools` 中但不在 `modelTools` 中，由 pi-durable 的 tool-search 按需加载。
- 两者都先经过能力过滤（05 §3）。
- 弱模型或语音场景用少量 `offer`；工具多的常驻 agent 用 `search`；编码场景以 `bash` 为主、命令用法写进上下文。三种方式都只是配置，内核不区分场景。

## 5. 运行上限

运行上限内置在内核，因为"运行一定会结束"是框架的保证（架构不变量 7）。默认值宽松，按配置档可调；更细的防护（例如语义级的重复检测）写成钩子插件。

| 上限 | 默认 | 触发后 |
|---|---|---|
| 每次运行的模型轮数 | 100 | 结束运行，`run.end.status = limit` |
| 每次运行的墙钟时间 | 30 分钟 | 同上 |
| 连续相同的工具调用（同名且参数相同） | 第 3 次拦下并提示模型换方法；第 5 次结束运行 | 同上 |

- 结束运行时，若会话有 `origin`，向来源发一句说明停在了哪里，并记在 `run.end.data.reason`。
- 上下文：使用 pi-durable 的自动压缩，`yonder.yaml` 的 `compaction` 原样传给 pi-durable 的 settings，含按模型的 `modelOverrides`。供应商报"上下文过长"时由 pi-durable 压缩后重试。不设人为的小上下文上限。
- 单个工具结果过长时的截断使用 pi-durable 自带的截断。
- 供应商重试使用 pi-durable 的 `retry` 设置。
- 结束一次运行的具体手段（钩子返回值或 `conversation.abort()`）由 T00 确定后写回本节。

## 6. 模型、凭据与服务

### 6.1 模型

`yonder.yaml` 的 `models.providers` **原样**采用 pi 的 `models.json` 结构（`baseUrl`、`api`、`models[]`、`compat`、`headers`、`authHeader`），由 pi-ai 的 `createProvider` 构建。pi-ai 内置的供应商也可直接引用。任何 OpenAI 兼容、Anthropic 兼容的端点都只靠配置接入，**禁止**为单个供应商写适配代码。

模型引用写作 `provider/modelId`，例如 `chatgpt/gpt-6-luna`、`deepseek/deepseek-flash`。

### 6.2 凭据

- 凭据文件采用 pi 的 `auth.json` 格式（`{ <provider>: { type: 'api_key', key } | { type: 'oauth', … } }`），路径由 `yonder.yaml` 的 `credentials` 指定，默认 `<home>/.yonder/auth.json`。
- 实现 pi-ai 的 `CredentialStore`：读、列、`modify`（串行化读改写，含跨进程文件锁）、删。若 pi 已有可复用的文件实现，按 MIT 复制并在 `THIRD_PARTY_NOTICES` 记录。
- ChatGPT 订阅登录是唯一需要专门流程的情况，使用 pi-ai 自带的 OAuth 供应商；`yonder login <provider>` 调用 pi-ai 的 `login`。
- 注意：OAuth 刷新会轮换 refresh token。与其他程序（例如 AI-Being）共用一份登录时，必须指向**同一个**凭据文件并使用同一套锁，或各自单独登录；不能各自复制一份。

### 6.3 非对话服务

ASR、TTS、embedding、rerank 等不经过 pi-ai。`yonder.yaml` 的 `services` 列出端点：

```yaml
services:
  - id: siliconflow
    protocol: openai-compatible
    baseUrl: https://api.siliconflow.cn/v1
    credential: siliconflow          # auth.json 里的键
    capabilities:
      asr: { models: [FunAudioLLM/SenseVoiceSmall] }
      tts: { models: [FunAudioLLM/CosyVoice2-0.5B], voices: [alex] }
      embedding: { models: [Qwen/Qwen3-Embedding-8B] }
```

内核只负责存与解析（`api.services.resolve('asr')` 返回端点、模型与凭据），调用由插件完成。

## 7. 模型能看到的工具结果

pi-durable 的工具结果原样进入转录。Yonder 内置工具（`message.send`、`task.run`、`session.*`、`identity.*`）的结果必须简短、结构化，失败时给出可执行的原因。

## 8. 本地控制接口

运行中的 harness 在 `<home>/.yonder/control.sock`（Windows 用命名管道）提供本地接口，CLI 的会话、身份、事件查询类命令都经由它；没有运行中的进程时，CLI 以只读方式直接打开存储。
