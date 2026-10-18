# T05 pi 适配层

**依据**
- `docs/spec/07-runtime.md`（全文）
- `docs/spec/05-security.md`（判定点、内置工具能力、执行环境）
- `docs/spec/03-agents.md`（配置档、预设与子会话的能力交集）、`101-116`（`<turn>` 块与图片附件）
- `docs/spec/04-plugins.md`（SDK `Tool`）、`136-150`（SDK `Hook`）

**路径**：`packages/core/src/runtime/`（唯一 import pi 的目录）、根目录 `THIRD_PARTY_NOTICES.md`

**必须**
- 打开 pi-durable `Harness`，存储按 07 §2：在 T04 的 `openDatabase` 返回的同一连接上 `SqliteStorage.open(db, { prefix: 'pi_' })`。
- 模型：按 07 §6.1 组装供应商（内置供应商 + 配置叠加 / 新建，协议名 → `api/<api>.lazy` 一张表）；凭据：按 07 §6.2 复制 pi 的 `FileAuthStorageBackend` 实现 `CredentialStore`（`proper-lockfile`，在 `THIRD_PARTY_NOTICES.md` 登记），并提供只读的 `get(name)` 供 `api.credentials`。
- `services.resolve`（07 §6.3）。
- 会话：创建/取得 conversation、写入 `yonder.session` 文档、每次唤醒运行前按 07 §3 重新 `configure`（无变化不提交）、`submit`（input / write / 排队方式，input 支持文字块 + 图片块）、`abort`、读转录（转成 `TranscriptItem`）、读用量增量。
- 扩展 `yonder.core`：sections 的插槽（内容由 T08 提供）、安全钩子（05 §3 两个判定点、受保护文件）、上限钩子（07 §5 三项上限，`limits` 可按配置档覆盖）。
- 工具与钩子适配：SDK `Tool`/`Hook` → pi（07 §3 表"插件工具与钩子"一行）；按配置档的能力、`tools.offer`、`tools.search` 计算 `tools` 与 `modelTools`。
- 执行环境：内置 `local`（`HarnessOptions.env` 按会话的配置档选环境）；实现 T03 定义的工作区文件接口。
- 把 `watchEvents` 的事件转换为 06 §3 的 `OutputPart`。
- 对外只导出 Yonder 自己的类型。

**禁止**：在 runtime 目录外 import pi；为单个模型供应商写代码；自己实现模型循环或压缩。

**验收**（真实模型）
- 用 `openai/gpt-6-luna` 与一个 OpenAI 兼容配置（`deepseek`）各完成一次带工具调用的运行。
- 发送一张测试内生成的纯红色 PNG，模型答出颜色。
- `readonly` 配置档看不到 `write`/`bash`，强行调用被拦下并返回原因。
- 连续 5 次相同工具调用的运行以 `limit` 结束；`maxTurns` 覆盖生效。
- 改配置档后下一次运行使用新模型与新工具，未改时不产生新的 `pi.agent` 提交。
- 预设子会话的能力不超过发起方；用量增量与 `pi.usage` 一致。

## 问题

### 源码审查（2026-10-18）

统一 ~/ 凭据路径解析；修复 submit 与 run_start 的监听时序及完整消息块文本转换。真实 Luna + bash 流式检查经历 2 次失败后 1 次通过，工具 start/end 与文字均已观察到；build/typecheck 通过。尚未完成恢复主链、运行配置固定、子任务结果转换。maxTurns 与重复第 5 次执行问题部分源于规范指定手段，须先讨论设计 D3，不能只改实现冒充符合规范。

完整证据、未完成项和设计问题见 [第一轮源码审查](review-first-pass.md)。本节不替代原定验收；任务保持原状态。

### 第一轮原记录

- 第一轮未执行本任务全部真实模型验收：OpenAI 兼容端点、图片识别、只读强制调用、重复调用上限、热重载下一次运行、task 子会话与用量均留第二轮核验；最终默认 Luna 启动检查由主 agent 统一执行。
- pi 的 `beforeTool` 拦截不调用 `afterTool`；重复第 5 次不再 block，执行结果加 terminate。`maxTurns` 与被安全钩子／重复钩子拦截工具同时出现时的精确截止行为尚未验收，需第二轮核实。
- `onOutput` 输出 pi text/tool/error 片段；`NO_REPLY` 起始增量暂存、最终片段与只投递一次由 T09 组装。
- 插件环境实例的 cwd 隔离、运行中配置热重载时环境稳定性、steer 新附件的读取授权，尚未做组合验收。


## 结果

第一轮：已实现（待验收），不代表全部验收通过。

- `runtime/index.ts` 打开同一 Db 连接上的 `pi_` storage 和 Harness；持久化 `yonder.session`，提供 create/configure/submit/abort/transcript/usage、sessionState/setSessionState；使用 pi 模型循环、队列、转录与压缩。
- `credentials.ts` 复制 pi 1.3.0 异步锁及存取语义，提供 CredentialStore 与只读 get，OAuth 刷新由 pi 在 modify 锁内完成。`models.ts` 与 `model-schema.ts` 注册全部 builtin provider，按协议表支持配置供应商、字段缺省和模型叠加；保留 builtin OAuth。复制来源与 MIT 声明登记于 `THIRD_PARTY_NOTICES.md`。
- 内置 yonder.core 段插槽、安全／上限钩子；SDK 工具／钩子适配、能力过滤与 deferred tool search。内置 task_run 设 replay safe，经 ToolExecutionApi 创建 task-owned conversation，并以 task requestId 幂等驱动。
- `env.ts` 提供 localEnvironment 与 WorkspaceFiles 适配。services.resolve 每次读取当前凭据；login 使用每个 home 固定 device UUID。
- 实际检查：`npx tsc -b packages/core --pretty false` 在 runtime 完成时通过；并行 T07 接线后遇到 sessions/index.ts 的可选 attachments 类型错误，已交 T07 负责人修正。
- `npx vitest run packages/core/src/runtime/runtime.test.ts`：1 个文件通过、1 个测试通过。真实 SQLite 会话创建、配置、write 输入、转录、零用量、关闭与恢复；实际临时目录 IO；凭据并发锁与 0600；内置 OAuth 保留、modelOverrides 与兼容 provider 缺省字段。未发起模型请求。
- `npx biome check --write` 仅检查本任务 7 个源码／测试文件：通过，无警告。完整任务原验收条目全部保留第二轮。
