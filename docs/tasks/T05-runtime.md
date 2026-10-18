# T05 pi 适配层

**依据**
- `docs/spec/07-runtime.md:1-100`（全文）
- `docs/spec/05-security.md:33-56`（判定点、执行环境）
- `docs/spec/03-agents.md:59-84`（配置档、预设与子会话的能力交集）

**路径**：`packages/core/src/runtime/`（唯一 import pi 的目录）

**必须**
- 打开 pi-durable `Harness`，存储按 07 §2：在 T04 的 `openDatabase` 返回的同一连接上 `SqliteStorage.open(db, { prefix: 'pi_' })`。
- 模型：按 07 §6.1 组装供应商（内置供应商 + 配置叠加 / 新建，协议名 → `api/<api>.lazy` 一张表）；凭据：按 07 §6.2 复制 pi 的 `FileAuthStorageBackend` 实现 `CredentialStore`。
- `services.resolve`（07 §6.3）。
- 会话：创建/取得 conversation、按配置档 `configure`、写入 `yonder.session` 文档、`submit`（input / write / 排队方式）、`abort`、读转录、读用量增量。
- 扩展 `yonder.core`：sections 的插槽（内容由 T08 提供）、安全钩子（05 §3 两个判定点与受保护文件）、上限钩子（07 §5 三项上限）。
- 工具注册适配：插件工具 → 扩展 `plugin:<id>`；按配置档的能力、`tools.offer`、`tools.search` 计算 `tools` 与 `modelTools`。
- 执行环境：内置 `local`（`HarnessOptions.env` 按会话的配置档选环境，07 §3）；为 T03 提供工作区文件接口的实现。
- 把 `watchEvents` 的事件转换为 06 §3 的 `OutputPart`（07 §3）。
- 对外只导出 Yonder 自己的类型。

**禁止**：在 runtime 目录外 import pi；为单个模型供应商写代码；自己实现模型循环或压缩。

**验收**（真实模型）
- 用 `openai/gpt-6-luna` 与一个 OpenAI 兼容配置各完成一次带工具调用的运行。
- `readonly` 配置档看不到 `write`/`bash`，强行调用被拦下并返回原因。
- 连续 5 次相同工具调用的运行以 `limit` 结束。
- 预设子会话的能力不超过发起方。
- 用量增量与 pi 的统计一致。

## 问题

（无）
