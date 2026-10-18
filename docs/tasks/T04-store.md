# T04 存储：事件、会话元数据、身份

**依据**
- `docs/spec/01-events.md:1-112`（全文）
- `docs/spec/02-sessions.md:3-17`（`y_sessions` 字段）、`86-101`（§3 路由结果）、`102-134`（§4 身份）
- `docs/spec/07-runtime.md:13-17`（§2 存储）

**路径**：`packages/core/src/store/`、`packages/core/src/runtime/db.ts`

**必须**
- 表 `y_events`、`y_sessions`、`y_accounts`、`y_persons`，字段与规范一一对应，不多不少；索引按 `01-events.md:87-107`。
- `runtime/db.ts`：`openDatabase(path)` 用 pi-durable 的 `openNodeSqliteDatabase` 打开 `state.db`，导出 Yonder 自己的 `Db` 接口（`exec / run / get / all / transaction`），并把同一个连接交给 T05 的 pi 存储（07 §2）。
- 存储层只接收 `Db`，不直接打开文件。
- 事件写入：分配可排序 id 与时间，只追加。
- 查询：按 `type`（含 `prefix.*`）、`from`、`conv`、时间区间、路由 agent 过滤，分页。
- 账号自动登记（首次出现、最近出现、显示名）；人的增删；关联与解除时同时写 `identity.link` 事件。
- `IdentityAPI`（02 §4.4）；`lookup(ref)` 的三类结果按 `02-sessions.md:123-153` 由事件表与会话表计算。

**禁止**：存储转录、工具调用或模型逐轮内容（架构不变量 4）；关系表（关系由事件计算）。

**验收**：每个查询维度一个测试；`lookup` 能回答"这个账号在哪些会话出现过、和哪些 agent 有过会话"；进程重启后数据仍在。

## 问题

（无）
