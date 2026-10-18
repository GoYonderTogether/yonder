# T05 pi 适配层

**依据**
- `docs/spec/07-runtime.md:1-107`（全文）
- `docs/spec/05-security.md:33-69`（判定点、内置工具能力、执行环境）
- `docs/spec/03-agents.md:60-86`（配置档、预设与子会话的能力交集）、`101-116`（`<turn>` 块与图片附件）
- `docs/spec/04-plugins.md:68-97`（SDK `Tool`）、`136-150`（SDK `Hook`）

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

（无）
