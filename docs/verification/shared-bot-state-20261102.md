# 共享运行状态存储：阶段 5 验证

日期：2026-11-02。阶段 4 提交 `079435ce`；本记录对应阶段 5 待提交状态，不代表 worker、宿主包边界或模型端到端已完成。

## 实现

- RuntimeOptions 接收 pi 已有的 `Storage`，运行生命周期不再构造 SQLite。`openRuntimeStorage(db)` 在本机边界把现有单一 Db 连接交给 `SqliteStorage.open`，保留 `pi_` 表与 Yonder `y_` 表同连接，不额外打开同一文件。
- Runtime 内部持久类型统一为 Storage；运行中 fork 父关系和 prepared 转录关联改从 Storage/Conversation 读取。离线 `readTranscript(Db)` 保留本机 SQL 路径。
- PostgreSQL pi 实现在当前唯一运行适配目录 `core/src/runtime/postgres-storage.ts`。提交复用 MemoryStorage.prepareCommit：验证/分离 writes → PostgreSQL 原子增量写入与 ID 高水位更新 → apply。日志使用原生 JSON；每次仅新增本批 writes，不按轮覆盖快照。
- ID 由 PostgreSQL 持久分配；即使只 mint 而没有提交，也不会在重开后重用。来源按 tenant_id、bot_id 复合键隔离，关闭 Storage 不关闭 worker 共享 Pool。
- PG 领域 Store 实现同一个事件、会话、身份和额度契约；SQL 直接使用 PG JSON/JSONB 与参数，不在运行时翻译 SQLite SQL。复合操作用同一个 Bot 的事务锁保留本机串行事务语义。
- 原 Store.events.recordRun 的 DbExecutor 结算回调收窄成现有 QuotaStore。SQLite/PG 均在记录 run.end 的同一事务绑定额度能力；结算失败无用量或 run.end 半批，重复结算不再收费。

当前明确上限：PG 激活时回放**一个 Bot**的日志到内存，活跃读取使用 pi 已有索引。不是全租户加载或每轮快照；长历史的 RSS 必须在 worker 阶段实测，超预算再改持久记录索引。prepared 投影采用一次向前分页扫描，保留关联与 fork 语义；长未 prepared 尾部的扫描开销属于已标注的实现上限。

## 已执行验证

| 检查 | 实际结果 | 本机原始日志 |
|---|---|---|
| 离线 lock 更新 | 成功，core 对 pg/@types/pg 的依赖精确 8.23.1 | shared-bot-core/stage-5-development-lock.log |
| 首次开发 Biome | 失败：新 PG findInput 的未标注 let 隐式 any；补 QueryResult<EventRow> 后解决 | shared-bot-core/stage-5-development-biome.log |
| 首次统一 `npm run typecheck` | 退出 0 | shared-bot-core/stage-5-development-typecheck.log |
| 定向 Vitest：PG 状态、全部 runtime、store、quota、quota-wire、app preparedTranscript | 文件 57 通过 / 0 失败 / 10 跳过；测试 233 通过 / 0 失败 / 21 跳过；21.29 秒 | shared-bot-core/stage-5-focused-test.log |
| 日志列最终改原生 JSON 后真实 PG 定向 | 文件 1 通过；6 通过 / 0 失败 / 0 跳过；1.36 秒 | shared-bot-core/stage-5-focused-pg-verified.log |
| 相关持久化/额度/PG 测试路径 Biome | 退出 0，22 文件；18 warnings / 2 infos，含既有断言及警告；随后删去本次两个无用 import，三个相关文件复核仍成功 | shared-bot-core/stage-5-focused-biome-verified.log、stage-5-focused-final-files-biome.log |
| 文件大小 | 通过，581 文件、基线 0 | 命令输出 |
| 层级 | 通过，268 文件，无上行依赖 | 命令输出 |
| git diff --check | 通过 | 命令输出 |

跳过的 10 个文件 / 21 项为该定向集合的默认真实模型开关路径；本阶段没有启用模型请求，不将跳过项算通过。

## 真实 PG 检查内容

`packages/cloud-host/src/state.test.ts` 的 6 项测试使用本机 PostgreSQL 17 真实进程：

1. 同一个 Runtime 完成只写输入、转录、fork、SessionDoc 和重开后读取；没有另写 PG 专用运行循环。
2. tenant、Bot 双维隔离；持久未提交 ID；Storage.close 后共享 Pool 仍能查询。
3. 非法批次被 pi 验证拒绝；另以真实 PG CHECK 约束使提交失败，确认内存状态、日志、ID 高水位均无半批；测试移除约束。
4. 领域 Store 并发输入去重、waiting route、账号/提及名字、身份关系、会话元数据及隔离。
5. 额度与 run.end 原子失败/重试、并发重复只结算一次，保持访客原有含 NUL 的复合键语义。
6. 投递 attempt/receipt/retry 恢复、首输入查询、结果关联、事件分页和重新构造 Store 后读取。

所有 PG 测试正常关闭 Pool、PG 并删除临时目录，进程检查无测试 PG 残留。未启动 Redis、worker、云端 server 或真实模型；未读取真实模型密钥、连接生产、部署、push 或操作桌面。完整 build/test/lint gate 由主 Agent 提交前执行；上述定向证据不能替代完整 gate。
