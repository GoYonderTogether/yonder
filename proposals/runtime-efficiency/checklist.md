# 运行时效率修复清单

标准一次定死，后续不再改。每项有编号、验收口径与状态。

## 0. 数据处置标准（不可再改）

判定只看一个问题：**这份数据能不能从别处无损还原？**

| 类别 | 包含 | 处置 |
|---|---|---|
| **语义事实** | 事件日志 `y_events`、会话转录 `pi_entries`、任务笔记与交付物、文档当前版 | 永不删除。只做无损优化（去重、外置、压缩） |
| **派生物** | `yonder.background` 的 `state.outcome` 正文（已验证在 `pi_entries` 有副本）、旧文档版本、缓存 | 保留索引与摘要（长度、sha256、首尾片段），正文按保留期回收 |
| **运行产物** | `.yonder/background/*.log`、`harness.log`、`status.log`、`dist/` | 大小或天数轮转，保留 3 份 |

保留期：派生物 **30 天**；运行产物 **10 MB × 3 份** 或 **7 天**，先到者生效。

已验证依据：`pi_tasks.id=129205` 的 `state.outcome` 6,444,722 字节，
其中一段 60 字符探针在 `pi_entries` 命中 2 条——正文确在转录中。

## 1. 问题清单

| # | 问题 | 现状实测 | 目标 | 风险 |
|---|---|---|---|---|
| 1 | 状态栏每 2 秒派生 Node 进程 | 0.6 次/秒 | 0 次，改长连接推送 | 中 |
| 2 | 任务账本每次读全量重放 | `SELECT *` + 全量 `JSON.parse` + replay | 只查投影表 | 中 |
| 3 | 面板视图 N+1 次重放 | 每任务一次 `get()` | 一次查询 | 中 |
| 4 | 启动 1.1 万条 error | 全部 `onReport` 记 error | 聚合为 1 条 warn | 低 |
| 5 | 渠道失败按次刷屏 | QQ 367 条同一错误 | 状态机，状态变化才记 | 低 |
| 6 | `state.db` 1.08 GB | `pi_tasks` 487 MB / `pi_entries` 475 MB | 回收派生物正文 | 中 |
| 7 | 8453 个后台日志目录 | 103 MB | 合并为滚动文件 | 低 |
| 8 | 日志无轮转 | `harness.log` 6 MB 只增 | 10 MB × 3 | 低 |
| 9 | 13 个文件超 500 行 | 最大 1821 行 | 门禁 + 拆分 | 低 |

## 2. 执行项

### S1 信号分级（问题 4、5）
- 新增 `packages/core/src/signals/`：`index.ts`、`codes.ts`、`dedupe.ts`。
- `report()` 改为按 code 分级；同类首次全量、之后计数、周期汇总。
- 新增 `plugins/channel-*/` 共用的健康状态机（放 `packages/sdk`）。
- 验收：启动 error 从 11,726 降到个位数；QQ 同类失败 ≤ 2 条。

### S2 状态面（问题 1）
- 新增 `packages/core/src/status/`：`index.ts`、`snapshot.ts`、`aggregate.ts`、`publish.ts`。
- 走现有 `control.sock` 的 `observeControl`，不新增端口。
- `YonderStatus.swift` 去掉 2 秒 Timer，改长连接 + 退避重连。
- 验收：空闲 5 分钟 `service info` spawn 0 次。

### S3 任务读模型（问题 2、3）
- `plugins/tasks/src/store.ts` 拆为 `store/`：`index.ts`、`schema.ts`、`append.ts`、`project.ts`、`query.ts`。
- 常驻连接；新增 `task_current` 投影表；`list`/`get`/`activity`/`panel` 只查投影。
- 提供 `rebuild` 重建投影。
- 验收：`view=activity` 单次 < 2 ms；`view=panel` 不再 N+1。

### S4 保留与日志（问题 6、7、8）
- 新增 `packages/core/src/retention/`：`index.ts`、`policy.ts`、`sweep.ts`、`report.ts`。
- 后台目录合并为 `background.log` 滚动文件。
- `harness.log` / `status.log` 按大小轮转。
- 派生物正文回收：只对 `yonder.background` 终态超 30 天的记录剥离 `state.outcome`，
  保留 `status` + 长度 + sha256 + 首尾片段。
- 验收：`background/` 从 8453 目录降到 1 个文件；`state.db` 明显下降。

### S5 文件预算（问题 9）
- `scripts/check-file-size.mjs` + `scripts/file-size-baseline.json`。
- 超 500 行失败，基线只减不增。
- 验收：`npm run lint` 含该项；基线登记现有 13 个文件。

## 3. 上游 pi（单独轨道）

不在本轮改：`yonder/1.3` 已从 `45014f2a` 前进到 `55e9146`，直接同步会引入未验证变更。
需要的能力（增量恢复水位、blob 外置、账本保留 API）先在本仓库侧留出调用点，
等上游确认后一次同步。

## 4. 本轮不做

- 不删任何语义事实数据。
- 不新增数据库或外部依赖。
- 不改 `docs/spec/` 的行为语义。
- 不动 `packages/pi-durable` 源码。
