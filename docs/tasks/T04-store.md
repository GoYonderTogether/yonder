# T04 存储：事件、会话元数据、身份

**依据**
- `docs/spec/01-events.md`（全文）
- `docs/spec/02-sessions.md`（`y_sessions` 字段）、`98-113`（§3 路由结果）、`114-165`（§4 身份）
- `docs/spec/07-runtime.md`（§2 存储）

**路径**：`packages/core/src/store/`、`packages/core/src/runtime/db.ts`

**必须**
- `runtime/db.ts`：`openDatabase(path)` 用 pi-durable 的 `openNodeSqliteDatabase` 打开 `state.db`，导出 Yonder 自己的 `Db` 接口（`exec / run / get / all / transaction`），并把同一个连接交给 T05 的 pi 存储（07 §2）。存储层只接收 `Db`，不直接打开文件。
- 表 `y_events`、`y_sessions`、`y_accounts`、`y_persons`，字段与规范一一对应，不多不少；索引按 `01-events.md:89-109`。
- 事件写入：分配可排序 id（ULID）与时间，只追加；`routes` 随事件一起写入。
- 查询：完整实现 `EventQuery`/`EventPage`（`01-events.md:89-109`）。
- 账号自动登记（首次出现、最近出现、显示名）；`IdentityAPI`（02 §4.4）全部方法；关联与解除时同时写 `identity.link` 事件；`relation` 按 02 §4.2 计算。
- `lookup(ref)` 的三类结果按 `02-sessions.md:135-144` 由事件表与会话表计算；工具层的能力过滤不在本任务（T09）。

**禁止**：存储转录、工具调用或模型逐轮内容（架构不变量 4）；关系表（关系由事件计算）。

**验收**：`EventQuery` 每个条件一个测试（含 `prefix.*`、`agent`、翻页）；`lookup` 能回答"这个账号在哪些会话出现过、和哪些 agent 有过会话"；`relation` 三种结果；进程重启后数据仍在；与 pi 共用连接时 pi 的提交不影响 `y_` 表（用 T00 的方式验证）。

## 问题

（无）
