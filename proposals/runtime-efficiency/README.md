# 运行时效率与状态面：根因分析与架构方案

状态：提案，供维护者评审。不是运行时契约，不改 `docs/spec/`。
文中数字均为 2026-10-27 本机实测，来自运行中的服务与其 home 目录。

## 1. 结论先说

现在看到的六个症状——状态栏每 2 秒派生进程、CPU 长期偏高、内存 2 GB 以上、
`state.db` 1.08 GB、每次启动 1.1 万条 error 日志、8453 个后台日志目录——
不是六个独立 bug，是**四个架构决定**的必然结果：

| 架构决定 | 直接后果 |
|---|---|
| 读状态靠"派生进程 + 全量重放" | 状态栏 2 秒一次 spawn Node；账本每次从头 replay |
| 事件日志既当事实源又当读模型 | 读一次 = 全表扫 + 全量 `JSON.parse` + 全量 replay |
| 大对象与生命周期无关 | 6.3 MB 的工具结果内联进账本；后台结果永不回收 |
| 只有一种信号级别 | 预期内状态（历史提交无回执）与真实故障同记 error |

所以方案不是逐个修，而是**把"事实"和"读"分开、把"大对象"和"生命周期"补上、
把"状态"收成一个出口、把"信号"分级**。四件事做完，六个症状同时消失。

## 2. 实测证据

### 2.1 状态栏每 2 秒派生一个 Node 进程

`packages/macos/YonderStatus.swift:54`：

```swift
endpointTimer = Timer.scheduledTimer(withTimeInterval: 2, repeats: true) {
    [weak self] _ in self?.refreshEndpoint(); self?.refreshActivity()
}
```

`refreshActivity()` 走 `run(["service", "info", "--home", home])`，`run()` 用
`Process` 起 `~/.yonder-harness/bin/yonder service info --json`。

实测 10 秒内出现 6 个不同的 `service info` 进程（≈0.6 次/秒）。
每次 spawn 要付：Node 启动 + 整棵模块图加载 + 打开 control socket + 退出。

同一文件里 `refreshEndpoint()` 只读一个 `desktop.json`，代价可忽略——说明
"读文件"和"派生进程"的成本差是数量级的。

### 2.2 任务账本每次读都全量重放

`plugins/tasks/src/store.ts:88` 的 `use()`：

1. 每次调用 `mkdirSync` + `new DatabaseSync(path)` + `chmodSync`
2. 每次调用执行 `CREATE TABLE IF NOT EXISTS`
3. `events()` 执行 `SELECT * FROM events ORDER BY seq`——整本账，无 LIMIT
4. 每行 `JSON.parse(row.data)`
5. `current()` 从第一条事件 replay 到最后一条

`list()`、`get()`、`view=activity` 全部走这条路。源码里写着
`// ponytail: replay the local ledger; index only if measured ledger size requires it.`
——现在是时候了。

当前 `tasks.sqlite`：956 KB / 3635 条事件。看着不大，但这是**每 2 秒一次**的
全量 parse + replay，且随账本线性增长。

三条路径叠加，代价不是一个常数：

| 路径 | 触发 | 每次重放次数 |
|---|---|---|
| `view=activity` | 状态栏 2 秒一次 | 1 |
| `view=panel` | 打开面板 / 面板刷新 | **N + 1**（`service.ts:88` 对每个可见任务各调一次 `get()`，每次都是全本重放） |
| `tasks-moments` 触发器 | 每 60 秒 | 1 |

`view=panel` 的 N+1 是最坏的一处：任务越多越慢，且随账本总量增长。

### 2.3 启动恢复是逐会话全量扫描，并把预期状态记成 error

`packages/core/src/runtime/index.ts:1410` 的 `recover()`：

```
for (conversation of 全部会话)          // 602 个
    scanDocuments(..., MAX_SAFE_INTEGER)
    scanSubmissions(..., MAX_SAFE_INTEGER)
    for (record of 该会话全部提交)      // 每条都判
        if (!covered) onReport(new Error("历史 submission N 无原生回执…"))
```

`packages/core/src/kernel/index.ts:51`：

```ts
const report = (error: unknown) => log("error", message(error));
```

**所有 `onReport` 都是 error**。实测单次启动产生 11,726 条这类 error。

### 2.4 大对象内联，生命周期缺失

`state.db` = 1.08 GB（282,581 页 × 4 KB）。按 `dbstat` 分解：

| 表 | 占用 | 行数 | 单行特征 |
|---|---|---|---|
| `pi_tasks` | 487 MB | 51,409 | `yonder.background` 16,371 条终态，均值 25.4 KB，**最大 6,297 KB** |
| `pi_entries` | 475 MB | 46,578 | 最大单条 **6,294 KB**（`toolResult`） |
| `pi_document_revisions` | 106 MB | 72,768 | 历史版本 |
| `y_events` | 15 MB | 8,525 | 正常 |

`yonder.background` 一类就占 406 MB，全是终态、永不回收。
同时 `.yonder/background/` 还有 8,453 个日志目录 / 103 MB——同一份结果存了两遍。

### 2.5 配置类失败按事件刷屏

`harness.log` 里 `QQ transport stopped` 367 条，全部是同一个
`invalid appid or secret`；飞书历史回补每次启动报同一组缺 scope。
没有渠道健康状态，失败即记一条。

### 2.6 文件规模

13 个源文件超过 500 行（不含测试与 vendored）：

```
1821  packages/core/src/runtime/index.ts
1058  packages/cli/src/index.ts
 938  packages/core/src/release/index.ts
 894  packages/cli/src/terminal.ts
 877  plugins/channel-feishu/src/channel.ts
 659  packages/core/src/delivery/index.ts
 616  packages/core/src/kernel/index.ts
 599  plugins/channel-feishu/src/task-card.ts
 571  plugins/native-automation/src/index.ts
 542  plugins/channel-wechat-ilink/src/channel.ts
 530  plugins/cron/src/index.ts
 524  packages/core/src/tools/index.ts
 522  packages/device/src/executor.ts
```

`Runtime` 一个类挂了约 40 个方法，覆盖会话、模型、压缩、提交、任务、恢复、
结果、服务、活动、命令——是典型的上帝对象。

## 3. 约束（方案必须遵守）

1. **架构不变量第 1 条**：事件只追加。投影只能是派生索引，不能改写事件。
2. **架构不变量第 4 条**：会话状态只归 pi-durable 管，Yonder 不复制转录。
   所以读模型做的是**索引与聚合**，不是副本。
3. **`packages/pi-durable` 是 vendored fork**，不能直接改源码；
   `pi_*` 表与迁移都归它。涉及它的改动必须先在
   `GoYonderTogether/pi` 的 `yonder/1.3` 实现，再用 `scripts/sync-pi-durable.mjs` 同步。
4. **不引第二套存储或运行系统**，不新增外部依赖。
5. **不写假数据**，验收用真实 home 与真实模型。

第 3 条决定了方案必须分两条轨道：**Yonder 侧**与**pi-durable 上游侧**。

## 4. 设计总纲

```
                    ┌──────────────────────────────┐
   渠道 / CLI ─────▶ │  事实源：事件日志（只追加）    │
                    └──────────────┬───────────────┘
                                   │ 同事务增量更新
                    ┌──────────────▼───────────────┐
                    │  读模型：投影表（可重建）      │
                    └──────────────┬───────────────┘
                                   │ O(可见行)
        ┌──────────────────────────┼──────────────────────────┐
        ▼                          ▼                          ▼
  状态面 StatusSurface       看板 / 活动摘要            恢复水位
  （脏标记 + 合并窗口）       （只查投影）              （只补增量）
        │
        ▼ control.sock 推送（已有 observeControl）
   状态栏（长连接，不派生进程）
```

四条原则：

1. **写路径只有一条**：事件追加，投影在同一事务内跟着更新，不会读到半截状态。
2. **读路径不 replay**：所有读走投影表，代价与"要显示多少行"成正比，与账本总量无关。
3. **状态只有一个出口**：任何 UI 想显示"现在怎么样"，只订一条流，不查库、不派生进程。
4. **大对象有独立生命周期**：正文与索引分开存，索引永远小，正文按策略回收。

## 5. 模块设计

### 5.1 状态面（StatusSurface）— 解决 2.1

**职责**：维护唯一 `StatusSnapshot`，按订阅推送差分。

```
packages/core/src/status/
  index.ts        # 公开面：createStatusSurface() ≤ 60 行
  snapshot.ts     # StatusSnapshot 类型与版本号 ≤ 120 行
  aggregate.ts    # 从各来源汇总（服务、渠道、任务计数）≤ 200 行
  publish.ts      # 脏标记 + 250ms 合并窗口 + 订阅者分发 ≤ 180 行
```

**机制**：

- 各子系统（渠道、运行、任务）发生变化时只调 `status.markDirty("channels")`。
- 合并窗口内多次脏标记合成一次重算。
- 重算后与上一版比对，只推变化的 section，附单调 `revision`。
- 复用现有 `serveControl` / `observeControl`（`packages/core/src/control/index.ts`
  已有持久订阅流），不新增协议、不新增端口。

**状态栏改动**（`packages/macos/YonderStatus.swift`）：

- 去掉 2 秒 `Timer`。
- 建立一条 control socket 长连接订阅 `status.observe`，收到就更新菜单。
- 断线按 1s→2s→4s→…→30s 退避重连，重连后先取一次全量快照。
- `refreshEndpoint()` 的 `desktop.json` 读取保留（本地文件，无成本）。

**收益**：进程 spawn 从 0.6 次/秒降到 0；状态延迟从"最多 2 秒"降到合并窗口内。

**验收**：`ps` 中 `service info` 在空闲 5 分钟内出现 0 次；菜单状态变化在 500ms 内可见；
杀掉服务后状态栏 1 秒内显示"已断开"，服务恢复后自动回来。

### 5.2 读模型（ReadModel）— 解决 2.2、2.3

**职责**：把"要显示什么"从"重放整本账"里拆出来。

分两处，互不依赖：

**(a) tasks 插件自己的账本**（Yonder 侧，可立即做）

```
plugins/tasks/src/
  store/
    index.ts      # Store 公开面，一个长连接 ≤ 80 行
    schema.ts     # 建表与迁移（含投影表）≤ 120 行
    append.ts     # 追加事件 + 同事务更新投影 ≤ 150 行
    project.ts    # 投影更新函数（open/update/wake/done）≤ 200 行
    query.ts      # 只读查询（list/get/activity）≤ 180 行
```

- `Store` 持有**一个常驻 `DatabaseSync`**，不再每次 `new` + `CREATE TABLE` + `chmod`。
- 新增 `task_current` 投影表：每个任务一行当前态（id、title、state、owner、parent、revision）。
- `append()` 在同一事务里写 `events` 并更新 `task_current`。
- `list()` / `view=activity` 只 `SELECT ... FROM task_current`，带 `LIMIT`。
- 首次升级时若投影表为空而事件非空，一次性回填；`verify` 命令可随时重建。

**(b) pi-durable 的恢复扫描**（上游侧）

现状是 `recover()` 对 602 个会话各做一次 `MAX_SAFE_INTEGER` 扫描。
上游需要提供两个能力：

- `scanSubmissionsSince(watermark)`：全局按 `id > watermark` 增量扫，一次跨会话。
- 恢复水位：`recovery_watermark` 表，记录已处理的全局 `id`。

Yonder 侧改为：

```
recover():
  wm = await storage.recoveryWatermark()
  for (page of storage.scanSubmissionsSince(wm))   // 一次全局扫描
      project(page)
      await storage.advanceWatermark(page.lastId)
```

投影结果（哪些提交缺回执）**聚合成一条 warn**，不是每条一个 error。

**收益**：启动从 O(会话 × 提交) 降到 O(新增提交)；常态启动接近 0 扫描。

### 5.3 内容存储（BlobStore）— 解决 2.4 的一半（上游侧）

**问题**：`toolResult` 6.3 MB、`yonder.background` 6.1 MB 内联在 `record` JSON 里。

**方案**：内容寻址存储。

```
<home>/.yonder/blobs/
  ab/cd/abcdef…            # sha256 分片目录，正文
  index.sqlite             # 引用计数、长度、首存时间（小表）
```

`record` 里改为：

```json
{ "blob": { "sha256": "…", "bytes": 6294528, "preview": "前 2KB 或前 200 行" } }
```

**为什么放上游**：`pi_entries` / `pi_tasks` 的写入在 pi-durable 内部，
必须由它调用 blob 写入。需要上游新增 `BlobStore` 注入点与读写包装。

**收益（按当前数据估算）**：

| 项 | 现在 | 之后 |
|---|---|---|
| `pi_entries` | 475 MB | 约 25–40 MB（索引 + 短正文） |
| `pi_tasks` | 487 MB | 约 30 MB |
| `blobs/` | — | 约 500 MB（正文，可压缩、可回收） |
| `state.db` | 1.08 GB | 约 150 MB |

DB 变小还有连锁好处：恢复扫描、备份、`VACUUM` 都快，内存里页缓存压力小。

### 5.4 保留策略（Retention）— 解决 2.4 的另一半、2.5

**职责**：一个地方定义"什么留多久"，一个地方执行，有预算、可审计。

```
packages/core/src/retention/
  index.ts       # createRetention() ≤ 60 行
  policy.ts      # 策略表（类型 + 天数 + 上限）≤ 120 行
  sweep.ts       # 单轮执行，带字节预算 ≤ 180 行
  report.ts      # 本轮删了什么、跳过了什么 ≤ 100 行
```

**默认策略（建议值，待维护者定）**：

| 对象 | 保留 | 说明 |
|---|---|---|
| `yonder.background` 终态记录 | 7 天 | 超期删正文，保留计数与校验 |
| `pi_entries` 中 `toolResult` 正文 | 30 天 | 超期正文进 blobs，再超期只留摘要 |
| `pi_document_revisions` | 30 天 | 每文档保留最近 5 版 |
| `.yonder/background/*.log` | 7 天 | 合并为滚动文件后按大小轮转 |
| `harness.log` | 10 MB × 3 | 大小轮转，不再无限追加 |
| `blobs/` 无引用正文 | 立即 | 引用计数为 0 即回收 |

**执行方式**：

- 服务内低频（每 30 分钟）跑一轮，单轮最多处理 50 MB，避免长事务。
- 每轮结果记一条 info（删了多少、跳了多少），不逐文件记。
- 提供 `yonder doctor --retention` 只读预览：会删什么、能省多少。

**为什么不能只靠 cron**：`pi_tasks` / `pi_entries` 归 pi-durable，
删除必须经它的 API（见 5.3 的上游改动）。

### 5.5 信号分级（Signals）— 解决 2.3 的日志、2.5

**职责**：把"发生了什么"和"要不要人管"分开。

```
packages/core/src/signals/
  index.ts      # report(level, code, detail) ≤ 60 行
  codes.ts      # 稳定错误码表（可枚举、可文档化）≤ 120 行
  dedupe.ts     # 同类聚合：首次全量、之后计数、周期汇总 ≤ 150 行
```

**规则**：

- `error`：需要人处理，每类首条带完整上下文，之后计数。
- `warn`：已降级但能继续（如"历史提交无回执，已跳过 N 条"）。
- `info`：预期内状态，正常不打，除非开了诊断。

**对现有 `onReport` 的处理**：

- 保留签名，内部按 `code` 映射级别；无法识别的默认 `warn` 而不是 `error`。
- `recover()` 的"无回执"从 11,726 条 error 变成 **1 条 warn**：
  `历史提交 11726 条无原生回执，已跳过（首个 id=10）`。

### 5.6 渠道健康（ChannelHealth）— 解决 2.5

**职责**：每个渠道实例一个状态机，只在**状态变化**时记日志。

```
plugins/channel-*/src/health.ts   # 各插件复用，≤ 120 行（放 sdk）
```

```
healthy ──失败──▶ degraded ──连续 N 次──▶ backoff(1s,2s,…300s) ──▶ failed
   ▲                                                              │
   └────────────────── 一次成功 ◀────────────────────────────────┘
```

- 进入 `failed` 记 **1 条** warn，带原因与重试计划。
- `failed` 期间不再逐次记日志，只在状态面板显示。
- 恢复时记 1 条 info。
- 状态进入 `StatusSnapshot.channels`，状态栏和 `doctor` 都能看到。

**效果**：QQ 的 367 条变 2 条；飞书缺 scope 从每次启动一组变首次一组。

### 5.7 文件预算（FileBudget）— 解决 2.6

**机制**：

- 新增 `scripts/check-file-size.mjs`，扫描 `packages/` 与 `plugins/`（排除测试、`dist`、
  vendored `pi-durable`）。
- 超过 500 行即失败，除非在 `scripts/file-size-baseline.json` 里登记且写明理由。
- 基线只减不增：改小一个文件就从基线里删掉它，防止回退。
- 接进 `npm run lint` 之后，本地与 CI 一致。

**拆分目标**（按职责，不按行数硬切）：

| 现状 | 目标 | 上限 |
|---|---|---|
| `core/src/runtime/index.ts` 1821 | `runtime/index.ts`（组合与公开面）<br>`runtime/session.ts`（创建/配置/状态/关闭）<br>`runtime/submit.ts`（提交/排队/中止）<br>`runtime/tasks.ts`（runTask/后台工作判定）<br>`runtime/recovery.ts`（recover/resume/水位）<br>`runtime/observe.ts`（observe/transcript/usage/activity）<br>`runtime/compaction.ts` | 各 ≤ 400 |
| `cli/src/index.ts` 1058 | `cli/index.ts`（注册）<br>`cli/commands/{service,channel,login,task,doctor}.ts` | 各 ≤ 350 |
| `core/src/release/index.ts` 938 | `release/{plan,apply,verify}.ts` | 各 ≤ 350 |
| `cli/src/terminal.ts` 894 | `terminal/{render,keys,layout}.ts` | 各 ≤ 350 |
| `plugins/channel-feishu/src/channel.ts` 877 | `channel/{inbound,outbound,lifecycle}.ts` | 各 ≤ 350 |
| `core/src/delivery/index.ts` 659 | `delivery/{plan,send,receipt}.ts` | 各 ≤ 300 |
| `core/src/kernel/index.ts` 616 | `kernel/{index,wire,lifecycle}.ts` | 各 ≤ 300 |
| 其余 6 个 500–600 行 | 各拆 2 个文件 | 各 ≤ 350 |

**拆分原则**：

- 一个文件一个职责，能一句话说清它做什么。
- 公开面收在 `index.ts`，只导出接口，不导出实现细节。
- 拆完不留转发壳子（不做 `export * from "./a.js"` 的一行文件）。
- 每拆一个文件，对应的测试文件同批调整。

## 6. 不变量核对

| 不变量 | 本方案如何满足 |
|---|---|
| 1 事件只追加 | 投影表是派生数据，随时可从事件重建；`append()` 不改旧行 |
| 2 agent 只经绑定唤醒 | 不改路由与绑定 |
| 3 插件提供能力 | 不变 |
| 4 会话状态只归 pi-durable | 投影只存索引与聚合，不存转录正文 |
| 5 安全只有一层 | 不变 |
| 6 完成定义交给模型 | 不变 |
| 7 耗时可观察 | 不变 |
| 8 工作区经执行环境 | blob 在 home 下，属内核自有数据，不经工作区接口 |
| 9 配置热重载 | 保留策略表走同一套校验 |
| 10 不写假数据 | 验收用真实 home；性能测试用真实账本 |

## 7. 落地顺序

每阶段独立可验收、可回滚，前三个阶段不依赖上游。

### 阶段 0：信号分级 + 文件预算（1–2 天）
- `signals/` 模块；`report` 改为分级 + 聚合。
- `check-file-size.mjs` + 基线（先登记现状 13 个文件，只减不增）。
- **验收**：启动日志 error 从 11,726 条降到个位数；`npm run lint` 含文件预算检查。

### 阶段 1：状态面（2–3 天）
- `status/` 模块 + `status.observe` 走现有 control socket。
- `YonderStatus.swift` 去掉 2 秒 Timer，改长连接 + 退避重连。
- **验收**：空闲 5 分钟 `service info` spawn 0 次；状态变化 500ms 内可见。

### 阶段 2：tasks 读模型（2–3 天）
- `store/` 拆文件，常驻连接，`task_current` 投影，`view=activity` 只查投影。
- 提供 `verify` / `rebuild` 子命令。
- **验收**：3635 条账本下 `view=activity` 单次 < 2 ms；CPU 空闲降到 5% 以下。

### 阶段 3：保留策略（2 天，Yonder 侧部分）
- `retention/` 模块；先做 `.yonder/background/` 合并与轮转、`harness.log` 轮转。
- `doctor --retention` 只读预览。
- **验收**：`background/` 从 8453 目录降到 1 个滚动文件；日志有上限。

### 阶段 4：pi-durable 上游（需上游先合并，再同步）
- 上游：`scanSubmissionsSince` + `recovery_watermark`。
- 上游：`BlobStore` 注入点 + `pi_entries` / `pi_tasks` 大对象外置 + 保留 API。
- 同步后：Yonder 侧 `recover()` 改增量；`retention` 接上账本清理。
- **验收**：启动扫描量与新增提交数成正比；`state.db` 从 1.08 GB 降到 200 MB 以内；
  `VACUUM` 后继续下降。

### 阶段 5：文件拆分（随各阶段顺带，不单独排期）
- 每动到一个超 500 行的文件，先拆再改，避免在巨型文件上继续叠加。

## 8. 不做的事

- 不引入新数据库、新消息队列、新缓存服务。
- 不复制转录（不变量 4）。
- 不为了降 CPU 降低功能（不删观测、不关渠道）。
- 不改 `docs/spec/` 的行为语义；本方案只改实现结构与生命周期。
- 不直接改 `packages/pi-durable` 源码。

## 9. 需要维护者决定

1. **保留天数**：后台结果 7 天、工具结果正文 30 天、文档版本 30 天/保留 5 版——
   这组默认值可以吗？
2. **阶段 4 的上游改动**：`GoYonderTogether/pi` 的 `yonder/1.3` 要不要我提？
   还是由你在上游先落？
3. **状态推送频率**：合并窗口 250 ms 是否够用，还是希望 100 ms？
4. **文件预算是否阻断 CI**：先设成警告一段时间，还是直接失败？
5. **是否先做阶段 0+1**（收益最大、风险最低），再评估后面？
