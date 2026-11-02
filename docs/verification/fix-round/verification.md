# Shared Bot fix-round verification — 2026-11-03

本轮只操作两个 shared-core worktree；不 push、不部署、不访问 zeth-root，不输出模型 key。源码与默认检查、真实 PG/Redis、真实 GLM、transport 故障注入、RSS 负载分别记录。根 REFACTOR-REPORT.md 保持未提交。

## Main 合入

采用 merge。第一次 990bef27 合入 ae197ecb；关闭收尾 6dc3fa3a 后，31215dd2 合入最新 4e58ceb8（包括 e423078f D3 Pi 来源）。75 条 main 提交逐项内容保留见 [审计表](main-content-audit.md)、[详细审计](main-content-audit.json)、[新增两条审计](main-refresh-audit.json)，原始 git log --stat 见 main-log-stat.txt / main-refresh-log-stat.txt。Cloud main 仍为原基线 52692f5，没有新增需搬移的 main 提交。

## 完整 gate 的原始结果

| 轮次 | 实际结果 | 原始证据 |
|---|---|---|
| 初轮默认 gate | build/typecheck 2，lint 1；Vitest 2780 pass / 4 fail / 112 skip，520 files pass / 2 fail / 67 skip，179.14s；Node 83/0/0/0 | yonder-first-{build,typecheck,lint,tests,node-tests}.log；yonder-gate-first.json |
| 夹具与 imports 修后默认 gate | build/typecheck 0；lint 1（两个新验收 JSON 格式）；Vitest 2785 pass / 1 fail / 112 skip，522 files pass / 1 fail / 67 skip，141.83s；Node 83/0/0/0 | yonder-final-{build,typecheck,lint,tests,node-tests}.log；yonder-gate-final.json |
| shutdown 修复及 D3 合入后 | build/typecheck/lint 0；Vitest 2763 pass / 0 fail / 113 skip，518 files pass / 67 skip，137.17s；Node 83/0/0/0 | yonder-complete-{build,typecheck,lint,tests,node-tests}.log；yonder-gate-complete.json |

初轮三项 remote-search 失败是移除 wrapper 后未显式注入已有真实实现，281772c2 修 fixture，断言保留。另一次 gateway ready poll 失败未归因，两次 focused 均通过，没有改 gateway 或 timeout。第二轮唯一失败为 console 结束后 rm 报 channel-card 目录 ENOTEMPTY；已接纳的 run.end observer 尚在写文件。6dc3fa3a 在共享 Runtime 存储关闭前 join 最终投递与插件观察，并用真实延迟 remove 的负对照证明原实现会失败，没有给 rm 加重试。后一次完整 Vitest 使用已有 --maxWorkers=4 参数跑全部用例，未删测试或放宽断言。D3 main 明确删除五个上游 hashline 测试文件，导致文件/用例总数变化；真实 Luna 未启用及平台跳过按原样保留。

Cloud 在最新源码上重新执行根/server build/typecheck、真实 PG/Redis 全 server tests、deploy、market、SSR：208/0/0/0、19/0/0/0、13/0/0/0、3/0/0/0，全退出 0。无 lint script，不冒称执行。跨仓证据位于 ../yonder-cloud-shared-core/docs/verification/fix-round/cloud-complete-{web-build,web-typecheck,server-build,server-typecheck,server-tests,deploy-tests,market-tests,render-tests}.log 及 cloud-gate-complete.json（路径相对两个 worktree 的共同父目录）。

## 实际模型与错误路径（内存缓存修复前的源码快照）

命令、退出码、耗时见 [模型与错误检查](final-model-errors-gate.json)。真实 GLM A6 / A8 / A9 均退出 0：两租户 PG SOUL 事实进入 provider 并在回复出现；卡片两个按钮分别 /connect、/download；临时本机设备的官方 memory 经既有 work bridge / program ToolTask 读取，离线下一轮目录为空。验收日志 final-A6-live.log、final-A8-live.log、final-A9-live.log。没有将临时设备往返称为生产/物理硬件验收。

A7 使用真实 PG/Redis/server/worker 与明确的本机 HTTP transport 故障端，不冒称让真实上游产生 503。final-A7-{timeout,503,empty,503-reflect,send-then-503,reply-none,interrupt}.log 全退出 0；唯一结果、后续 provider prompt 不含 error、反射凭据在转录前脱敏、在途/排队中断收尾均有断言。final-A8-loopback.log 另验证卡片已准备后失败只投递 error、不预发卡、下一轮不复用卡片。

## A12 与生命周期

[本轮资源检查](final-load-lifecycle-gate.json)：100 Bot 各 500 条 durable 历史，共 50,000 条（每条至少 4096 字节）及每 Bot 10 个 rewindable 文档 delta；归档会话不塞进当前新 turn。首次完整负载所有 100 Bot 已回复，但 idle RSS 141,131,776 B、peak 361,267,200 B，超过 350 MB，退出 1。原始 final-A12-load.log 保留，不能记为通过，也未以手动 GC、降低负载或提高预算掩盖。正在定位 PG modelsFor 的重复 Models 分配；最终资源结果另补。

final-lifecycle.log / final-load-lifecycle-gate.json 中最新生命周期退出 0（76.63s）：真实 PG advisory 锁阻塞租户 A 时 B 先完成；未满 LRU 的两个实例空闲超时后释放，再激活成功，completed=3/pending=0。此前开发失败与修复见 [生命周期原始记录](../review-worker-lifecycle.md)。

## 保留的开发失败

- PG/storage 首轮 47/3、次轮 44/6、第三轮 50/0；扩展组合 54/1 后修 tasks storage guard，最终 artifact/guard 16/0：../review-storage-focused-{first,2,3,4}.log、../review-artifact-focused-final-2.log。没有把中间版本的成功冒充最终源码。
- 移动 core 测试初轮 778/2/61，修共享 speech 的 anchor-updated 兼容及 vendored pi-durable 版本误改，保留原断言：local-host-migration.log；main 重点迁移 focused-main-migration-2.log，speech-regression-3.log，layer-tests.log。
- 新 PG before/order 回归初轮 fixture 缺 name 为 8/1，修后 2/0，typecheck 0：../review-events-focused.log、../review-events-focused-2.log、../review-events-typecheck.log。
- 关闭收尾负对照与最终定向在 [main 审计](main-content-audit.md) 中引用：../review-shutdown-negative-control.log、../review-shutdown-focused-final.log、../review-shutdown-build-final.log。

只保留本总账或其他已提交 verification 文档明确引用的原始日志；纯格式检查、重复中间构建等 scratch 清单由 scratch-log-audit.json / .md 记录，最终验证完成后刷新并清理。JSON 内容格式调整不改原始退出码或计数。
