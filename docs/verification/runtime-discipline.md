# 运行纪律与主人可见性：并入当前主线的移植验收（2026-10-27）

移植来源：`yonder/runtime-discipline` 提交 `58a9850`（原决策 D57，基线 `d3537b2`）。本文件记录的是**在当前 main（`0211948`，0.2.26102705）上重新落地的结果**，不是原分支的验收记录。仅 `/Users/zoran/Documents/yonder-harness-consolidate`（分支 `integration/consolidate-20261027`）；主工作树 `/Users/zoran/Documents/yonder-harness` 的未提交改动全程未读入、未改动。未提交、未推送、未安装或操作日用服务。

## 已移植（与当前代码对齐后的实现）

- 任务回报契约：`packages/core/src/runtime/results.ts` 新增 `taskReport`，空文本与 `NO_REPLY` 归一为 `STATUS: unknown (no report)`；`packages/core/src/sessions/index.ts` 的调用方结果与 `packages/core/src/runtime/index.ts` 的 `task_run` 回执都经过它，原生 status、reason 与转录不变，没有新增 outcome 字段。
- 六要素简述：`packages/core/src/tools/index.ts` 的 `agent_ask` 与 `task_run` 描述要求目标、材料/路径、边界/禁止、完成标准、遇阻停止条件、STATUS 与证据，并说明 `status: done` 只表示运行结束。未增加 schema 字段或委派子系统。
- 后台完成兜底：`packages/core/src/delivery/visibility.ts`（新模块）在续办收尾后核对可见事实，无成功消息或成功卡片锚点时发一条短模板；标题取主人原请求前 40 个码点、换行压平，不调用模型。`run.end` 保存通知意图，重启只补尚未尝试的通知；已尝试但不确定的交付不补发。`outputSince` / `completionNotices` 查询在 `packages/core/src/store/index.ts`。
- 静默心跳：复用 `RunLimits` 的软提醒 timer（`packages/core/src/runtime/limits.ts` 的 `arm` 现在把下一次延时交给 `onTick` 决定），生产 300000ms、每轮最多 6 次，可见输出重置静默时间，不调用模型、不截断运行。`packages/sdk/src/types.ts` 仅新增可选 `Channel.edit`；飞书 text/post 用 PUT、卡片用 PATCH（`plugins/channel-feishu/src/protocol.ts` 的 `editMessage`）。`plugins/channel-feishu/src/task-card.ts` 的卡片更新事件带 `delivery.ok=true`，因此卡片更新算可见输出。
- 模型条件纪律段：`packages/core/src/prompt/content.ts` 新增 `modelDiscipline`，以真实可选的 section id `runtime.discipline` 进入 `runtimeSections`；`packages/core/src/prompt/index.ts` 的 `systemSections` 只在 modelId 完整匹配 `^gpt-\d+(?:\.\d+)?-(?:luna|sol)$` 时保留它。不按 provider 或子串猜测，`gpt-6-luna-preview` 不匹配。

## 与分支的差异（有意偏离）

- 纪律段改为可选 section，而不是 `systemSections` 末尾无条件追加：这样 `prompt.sections: []` 仍为空、显式 section 列表逐字生效、SOUL.md/AGENTS.md 贡献仍在最后。分支的实现会让 `packages/core/src/prompt/official-prompts.test.ts` 的 `sections.slice(-2)` 与两处单 section 断言失效，需要改写既有测试；本移植改为不改这些测试。
- 心跳装配抽到 `packages/core/src/kernel/tick.ts`（`ticks(store, delivery, test)`），`openKernel` 只多一行展开；`tickIntervalMs` 与 `onTick` 仍来自同一份 `RuntimeOptions`。原因是 `scripts/check-file-size.mjs` 的“基线只减不增”门禁不允许 `packages/core/src/kernel/index.ts` 继续增长。
- 新增的可见性代码抽到 `packages/core/src/delivery/visibility.ts` 与 `packages/core/src/delivery/ledger.ts`（后者收 `record` / `attempt` / `unknown`），`packages/core/src/delivery/index.ts` 由 844 行回落到 627 行（基线 659）。行为不变。
- 飞书 `edit` 的协议测试放在 `plugins/channel-feishu/test/protocol.test.ts`（该文件已持有 `api()` 与 FeishuChannel 线级用例），分支放在 `contract.test.ts`。
- 工具描述沿用当前 main 的英文措辞补入六要素与 STATUS 含义，没有整段替换为分支的中文文本。
- 决策编号：分支的 D57 与 main 的 D57（群分桶参与）冲突，main 的 D58–D67 也已占用。按 `docs/decisions.md` 现行惯例（D67 之后改为带日期的标题）新增 `## 2026-10-27 任务回报与确定性运行可见性（维护者批准）`，未新造编号。

## 跳过的部分

- 分支 `58a9850` 中依赖其旧基线的 `docs/status.md` 版本号与计数（0.2.26102201、292 通过）未沿用，改用本轮真实计数。
- 分支对 `packages/core/src/runtime/process.ts` 的改动本就不存在（原记录亦声明未改），本次不涉及。
- 分支的 `packages/core/src/delivery/delivery.test.ts` 结构基于旧 setup；本次只移植行为断言（后台兜底表、可见性表、重启幂等、心跳上限与编辑、确定失败 vs 不确定、静默心跳），setup 按当前 main 的 `createStore(db, () => "person:owner")` + owner 身份重写。

## 实际命令与原始计数

| 命令 | 结果 | 日志 |
|---|---|---|
| `npm ci` | 通过；审计出 4 个既有依赖告警（2 moderate / 2 high），与本轮改动无关 | 终端 |
| `npx tsc -b --force`（移植过程中多次） | 最终退出 0 | 终端 |
| `npx vitest run packages/core/src/delivery` | 3 文件通过，35 通过 / 0 失败 | 终端 |
| `npx vitest run packages/core/src/prompt` | 4 文件通过 / 1 跳过，13 通过 / 1 跳过 | 终端 |
| `npx vitest run packages/core/src/kernel/kernel.test.ts plugins/channel-feishu` | 12 文件通过，120 通过 / 0 失败 | 终端 |
| `node scripts/check-file-size.mjs` | 通过（13 个文件在基线内且未增长） | 终端 |
| `npm run build && npm run typecheck && npm test && npm run lint` | 见下节最终计数 | `/tmp/port-c-check2.log` |

## 真实模型

**未测。** 本轮环境未设置 `YONDER_TEST_REAL` / `YONDER_TEST_AUTH`，按仓库约定不擅自指向主工作树的 `.yonder/auth.json`。新增的 `packages/core/src/kernel/runtime-discipline.test.ts` 默认跳过（`YONDER_TEST_REAL !== "1"` 或凭据文件不存在），它覆盖：task 子会话首行 `STATUS: done` 与实际文件证据、后台完成只发一条兜底且重启不重复、`openKernel({ test: { heartbeatIntervalMs: 2500 } })` 下真实前台命令期间 1–6 条心跳且结束后不再新增。原分支的真实验收记录见其自身文档，不构成本移植的验收。

## 取舍、风险与未测

- 已尝试但结果未知的交付可能其实已可见，兜底因此保守抑制：极端崩溃时主人可能收不到通知。不把不确定当成功、不自动重发，也不承诺 exactly-once。
- 无 `edit` 能力的渠道，每个活跃运行最多新增 6 条心跳；后台每次完成最多一条兜底。会增加噪声，但不写虚构进展。`STATUS: done` 是模型自述，兜底不是独立验收系统。
- 启动扫描已有通知意图是线性查询；没有新表或调度子系统。历史量大时的开销未测。
- 飞书 `edit` 只过了本地协议测试；真实飞书权限、模板卡编辑、QQ/微信 iLink/card platform 的端到端显示、用户实际已读、断电恢复全过程 **未测**。

## 修改文件

文档：`CHANGELOG.md`、`docs/decisions.md`、`docs/spec/03-agents.md`、`docs/spec/06-delivery.md`、`docs/spec/07-runtime.md`、`docs/spec/10-runtime-guarantees.md`、`docs/status.md`、本文件。

内核：`packages/core/src/prompt/{content.ts,index.ts,index.test.ts}`、`packages/core/src/tools/index.ts`、`packages/core/src/runtime/{docs.ts,index.ts,limits.ts,types.ts,results.ts,offline.test.ts}`、`packages/core/src/sessions/index.ts`、`packages/core/src/delivery/{index.ts,visibility.ts,ledger.ts,delivery.test.ts}`、`packages/core/src/store/index.ts`、`packages/core/src/kernel/{index.ts,tick.ts,runtime-discipline.test.ts}`。

渠道接口与飞书：`packages/sdk/src/types.ts`、`plugins/channel-feishu/src/{channel.ts,protocol.ts,task-card.ts}`、`plugins/channel-feishu/test/protocol.test.ts`。
