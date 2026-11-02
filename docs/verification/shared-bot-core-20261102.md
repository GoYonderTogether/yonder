# 共享 Bot 核心重构：阶段 1 检查记录

日期：2026-11-02；Node v24.21.0；两个指定 worktree 均为 refactor/shared-bot-core。Yonder 初始 HEAD 为 a6a6c0b5。仅修改架构与规范文档，未修改产品代码、测试、构建脚本或安装/发布流程。BRIEF.md 原先即为未跟踪文件，保留原样。

## 安装

通过 agent-network 注入本次进程网络后执行：

- yonder 根目录 npm ci：成功，added 560 packages；审计 5 项（2 moderate、3 high）。
- yonder-cloud 根目录 npm ci：成功，added 238 packages；审计 0 项。
- yonder-cloud/server npm ci：成功，added 56 packages；审计 3 项 moderate。

未为这些既有依赖告警改依赖或扩展任务范围。

## 阶段 1 完整门槛

| 检查 | 实际结果 | 本机原始日志 |
|---|---|---|
| npm run build | 退出 1：TypeScript 与 dist 校验、devices 构建、状态栏/电源辅助检查完成后，SwiftPM manifest 编译被沙箱拒绝；完整 build 未通过 | shared-bot-core/stage-1-build.log |
| npm run typecheck | 退出 0 | shared-bot-core/stage-1-typecheck.log |
| npm run lint | 退出 0，1246 warnings、34 infos；size 扫描 551 个文件，无增长；layer 扫描 256 个文件，无上行依赖 | shared-bot-core/stage-1-lint.log |
| npm test（首轮） | 退出 1：2656 通过 / 4 失败 / 112 跳过；文件 490 通过 / 4 失败 / 67 跳过 | shared-bot-core/stage-1-test.log |
| npm test（构建产物就绪后顺序重跑） | 退出 1：2658 通过 / 2 失败 / 112 跳过；文件 492 通过 / 2 失败 / 67 跳过 | shared-bot-core/stage-1-test-after-build.log |

首轮由主 Agent 错误地并行启动 build、typecheck 和 test，其中两个 checkPlugin 用例读取尚未生成的 dist，不能作为有效的顺序构建后回归结论。保留这次失败；不会以定向通过覆盖它。后续完整测试在构建进程结束且 dist 就绪后重跑，不再并行重建产物。

## 失败定位与定向证据

委派 gpt-6-luna 只读定位、运行检查，未授权代码改动。

1. channel-card protocol 与 devices controller：原始错误分别为无法 import plugins/channel-card/dist/index.js，以及 staging 缺 dist/skills。构建产物就绪后定向运行两个文件，43 通过 / 0 失败 / 0 跳过，日志 shared-bot-core/stage-1-focused-tests.log。
2. memory wp4 与 native-automation image-size：定向运行 7 通过 / 2 失败 / 1 跳过，日志 shared-bot-core/stage-1-focused-platform.log。memory 仍报 Inbox watcher failed；子 Agent 在相同环境用 chokidar 最小复现得到 EMFILE: too many open files, watch。未修改吞错实现或断言来制造通过。
3. image-size 用系统壁纸文件生成 PNG，未截屏或驱动 UI。子 Agent 测得生成 PNG 为 3200×3200、136079 bytes，低于源码 512 KiB 的 ALREADY_SMALL 阈值，故按设计返回 PNG，测试却期望 JPEG。手动对同一输入调用 sips 得到 1600×1600、41917 bytes JPEG，证明该断言失败并非 sips 完全不可用。未扩展范围修改此既有测试。
4. build 原始边界错误：swift package --package-path packages/macos-helper resolve → sandbox-exec: sandbox_apply: Operation not permitted。尚未进入该包的 Swift build。scripts/build-permissions.mjs 没有不跳过检查且支持当前权限的配置入口；YONDER_HELPER_SIGN_IDENTITY 只控制签名。当前权限不允许提权，未关闭沙箱、修改脚本或跳过 native build。

顺序重跑仍失败的两项是 memory wp4 watcher 与 native-automation image-size；checkPlugin 的两项未再失败。没有进一步重跑全集。

## 补充验证

- npm run build:app：退出 0，日志 shared-bot-core/stage-1-app-build.log。这不能代替完整 build。
- yonder-cloud 根目录 npm run build && npm run typecheck：均退出 0。
- yonder-cloud/server npm run build && npm run typecheck：均退出 0。
- 文档与记录更新后最终 npm run lint：退出 0，1246 warnings / 34 infos，size/layer 通过，日志 shared-bot-core/stage-1-final-lint.log。
- git diff --check：通过。
- CodeGraph 未初始化，未重建索引，采用实时源码追踪。

原始 .log 文件按仓库既有规则被忽略，留在本机；本 Markdown 保留可提交的计数、失败原因和证据入口。没有运行真实模型、PG/Redis、多租户、端到端或负载测试。没有读取模型 key、连接生产、推送、部署或安装应用。未启动 PG、Redis 或 worker，故没有此类后台服务需要关闭。

## 推进结论

阶段 1 文档目标已写入，完整门槛未通过，未进入阶段 2。不能以只跑 TypeScript 或前端构建替代 BRIEF 要求的完整检查。本次是宿主验证权限阻塞，不是已证明 pi-durable 多实例/PG 不可行；没有尝试或放弃更轻运行循环，也不声称触发了 BRIEF 的那项架构停止条件。解除宿主限制后，从阶段 1 顺序完整检查续接。

## 提交阻塞

尝试 git add 明确文档清单及带 Co-Authored-By 的阶段提交时，Git 无法创建 `/Users/zoran/Documents/yonder/.git/worktrees/yonder-shared-core/index.lock`，返回 Operation not permitted。add/commit 均失败；没有暂存或提交。所有文档保持未提交，未修改主分支。

## 续接：原始提交基线（2026-11-02 21:30）

先将阶段 1 已跟踪文档 diff 保存为本机 patch 并临时恢复，确认 `git diff --exit-code` 为 0；HEAD 为 `a6a6c0b50d23bbd012d8373572bc0048c99bb55c`，产品代码、测试与脚本未改。测试在完整 build 成功后顺序运行。未跟踪 BRIEF、报告与文档不属于源码或测试；恢复阶段 1 文档后继续实施。

| 检查 | 结果 | 日志 |
|---|---|---|
| npm run build | 退出 0（含 SwiftPM、native 与 app） | shared-bot-core/baseline-build.log |
| npm test | 退出 0；2660 通过 / 0 失败 / 112 跳过；文件 494 通过 / 0 失败 / 67 跳过；89.74 秒 | shared-bot-core/baseline-test.log |
| npm run lint | 退出 0；size 扫描 551、layers 扫描 256，无违规 | shared-bot-core/baseline-lint.log |

此固定基线没有允许保留的失败。旧运行的 sandbox、EMFILE 与壁纸测试失败保留为历史记录，不作为本次最终基线失败。后续每阶段必须无新增失败，build/typecheck/lint 必须通过。

阶段 1 续接检查：仅文档改动，复用上述相同产品源码的完整 build/test 结果；恢复并更新文档后，npm run typecheck 退出 0（stage-1-resumed-typecheck.log），npm run lint 退出 0（stage-1-resumed-lint.log，size/layers 通过），git diff --check 通过。

## 阶段 2：HostFacts 与纯提示词装配

HostFacts 在本机组合根采集后必填注入；纯系统段装配位于 prompt/system.ts，原异步入口仍收集所选 contexts/skills，再交纯函数装配。正文、段落 key 和顺序不变；增加完整 parts JSON 的 SHA-256 golden 及显式宿主事实注入检查。附件缓存和模板 IO 留给后续宿主拆分。

| 检查 | 原始结果 | 证据 |
|---|---|---|
| 首轮定向测试（子 Agent） | 19 通过 / 1 失败，3 文件通过 / 1 文件失败；golden 临时期望未填，随后改为实际固定哈希 | 子 Agent 工具输出，未单独落日志 |
| 首轮 typecheck（子 Agent） | TS2379，exact optional 参数展开不匹配；修复后通过 | 子 Agent 工具输出，未单独落日志 |
| 最终原四文件定向测试 | 20 通过 / 0 失败 | 子 Agent 工具输出 |
| 首次完整 build/typecheck | 均退出 0 | shared-bot-core/stage-2-build.log、stage-2-typecheck.log |
| 首次完整默认测试 | 2660 通过 / 1 失败 / 112 跳过；文件 493 通过 / 1 失败 / 67 跳过；tasks 测试直接调用 prepareInput，缺 HostFacts | shared-bot-core/stage-2-test.log |
| 补齐 tasks 与 app 调用后定向测试 | 26 通过 / 0 失败，5 文件通过 | 子 Agent 工具输出 |
| 重跑完整 build/typecheck | 均退出 0 | shared-bot-core/stage-2-final-build.log、stage-2-final-typecheck.log |
| 重跑完整默认测试 | 2661 通过 / 0 失败 / 112 跳过；文件 494 通过 / 0 失败 / 67 跳过；96.08 秒 | shared-bot-core/stage-2-final-test.log |
| 完整 lint 首次 | 1 error（tasks 测试 import 排序），1246 warnings / 34 infos；随后仅调整 import 顺序 | shared-bot-core/stage-2-final-lint.log |
| import 排序后完整 lint（子 Agent） | 退出 0，Biome、size、layers 均通过；未重跑已通过的 build/typecheck/test | 子 Agent 工具输出 |

最终相对固定基线无新增失败，多 1 项 golden 测试。未运行真实模型或 PG；A2 的 fs/PG 来源一致性留到来源实现后验收。

## 云端原始提交补充基线

cloud worktree 保持 `52692f57835032cb3a71b476d421f158293b0c94`，未改源码。根目录 build/typecheck、server build/typecheck 均退出 0。server 默认测试使用仓库现有 services() 启动独立临时 PostgreSQL 与 Redis，并在每组结束关闭；197 通过 / 0 失败 / 0 取消 / 0 跳过 / 0 todo，22 suites，52.88 秒，退出 0。证据：shared-bot-core/cloud-baseline-build.log、cloud-baseline-typecheck.log、cloud-baseline-server-build.log、cloud-baseline-server-typecheck.log、cloud-baseline-server-test.log。没有调用模型或连接生产。

## 阶段 3：唯一 Bot 定义包

`@yonder/bot-definition` 承载原 config 的 schema、解析、profile/权限求值、默认值及纯校验；旧 config 路径只兼容导出，index 另保留宿主 load/reload。9 份 helper/schema 源文件与原提交逐字相同，index 仅删掉宿主导出；没有修改默认值、schema 或新加接口。新增 workspace/TS references/依赖及 npm 生成的 lock，未改安装/发版流程或新增外部依赖。

定向检查：配置 11 文件 / 55 项通过；prompt golden 1 项通过、同文件 14 项按名字过滤跳过；typecheck、改动文件 Biome、size/layer、diff check 通过。最初并行跑两条 Vitest 导致共享 .vitest-cache 的 ENOTEMPTY 启动错误，配置测试当次未完成；后改为顺序运行通过，不修改测试或断言。该初次启动错误只有子 Agent 工具输出，没有独立日志。

完整 gate：build/typecheck/lint 均退出 0；默认测试 2661 通过 / 0 失败 / 112 跳过，文件 494 通过 / 0 失败 / 67 跳过，259.67 秒。size 扫描 562、layers 扫描 257，无违规。证据：shared-bot-core/stage-3-{build,typecheck,test,lint}.log。相对固定基线无新增失败；本阶段没有运行模型。

## 实施顺序调整

阶段 3 后，阶段 4 在 yonder 实施；同时先在独立 cloud/server 实施阶段 9 的服务端渠道协议部分，使阶段 8 worker 可以对接真实 /ws/device 接口，而非临时协议。两边不共享源码写入，cloud 前端与 monorepo app 暂不改；阶段 9 界面与完整行为验收仍在 worker 后完成。cloud 服务端部分单独完成本仓根目录和 server 的 build/typecheck，以及全部真实 PG/Redis 后端测试后提交；Yonder 的各阶段完整 gate 保持。属于 BRIEF 允许的依赖顺序调整，没有删减阶段或验收。

## 阶段 4：fs/PG 定义来源与虚拟工作区

实现和定向原始证据见 [shared-bot-source-20261102.md](shared-bot-source-20261102.md)。初始加载、候选重载、工作区、presets/Markdown 子 Agent、模板展开与列举、skill 发现和读取均接入来源；PG 使用真实 bot_files，不建人设列。

- 首次完整 gate：build/typecheck/lint 退出 0；2665 通过 / 0 失败 / 112 跳过，文件 495 通过 / 0 失败 / 67 跳过，140.83 秒。日志 shared-bot-core/stage-4-{build,typecheck,test,lint}.log。
- 代码阅读发现未知 Agent 的 skill 查询原先会抛错，FS 来源迁移后静默只给 home/user 来源。恢复原 Unknown agent 失败语义，在既有 skills 测试加最小断言；不是额外防御。该补丁定向 7 通过 / 0 失败 / 0 跳过，Biome 与 diff check 通过；日志 stage-4-source-failure-{test,biome}.log。
- 最终完整 gate：build/typecheck/lint 退出 0；2666 通过 / 0 失败 / 112 跳过，文件 495 通过 / 0 失败 / 67 跳过，97.65 秒；size 573、layer 260，无违规。日志 shared-bot-core/stage-4-final-{build,typecheck,test,lint}.log。

相对固定基线无新增失败；A2 有真实 fs/PG 逐字对照证据。4 项 PG 测试只证明定义与文件来源，不证明 worker 的运行状态/插件隔离或端到端。没有模型调用，未启动 worker/Redis，临时 PG 已关闭。

## 阶段 9 服务端先行提交（cloud）

cloud 提交 `63b5a99`，详情在该 worktree 的 `docs/verification/shared-bot-server-20261102.md`。根/server build/typecheck 全通过；最终后端真实 PG/Redis/WS 测试 204 通过 / 0 失败 / 0 取消 / 0 跳过，22 suites，63.93 秒。日志 shared-bot-core/stage-9-server-final-{cloud-build,cloud-typecheck,build,typecheck,test}.log。首次完整测试为 199 通过 / 4 失败（203 total），4 处历史迁移预期未包含020；仅追加实际新迁移，不削弱历史/拒绝顺序断言；初次日志 stage-9-server-test.log 保留。

root 代码阅读修复了三处实际接线问题：dispatch 不得吞结果写入异常；旧 worker 清理 pending 完成前不得释放连接位（防误伤重连新输入）；quota 的 try 只包含 Redis 计数，写错误消息失败不能被误报为额度服务故障。另将已有 online/暂停开关接入云端 worker 状态。定向的原始 85/85、28/1、29/29、35/35 记录见 cloud 验证文件，只有子 Agent 工具输出，没有独立日志。没有真实 worker/模型或新 UI 验证；本提交只完成阶段 9 服务端部分，A7/A8 仍不能整体宣称通过。

## 阶段 5：SQLite/PG 运行状态

实现与开发/定向检查见 [shared-bot-state-20261102.md](shared-bot-state-20261102.md)。59 个 Runtime.open 调用方改为存储注入；本机仍以同一个 Db 连接构造 pi SQLite Storage，在线转录与父分叉读取使用 Storage，离线 SQL 查询保留。PG pi 提交为增量 JSON 日志＋持久 ID，复用现有校验/投影；领域 Store 使用静态 PG SQL 并按 Bot 锁定复合事务，额度与 run.end 原子结算。没有新运行循环。

最终完整 gate：build/typecheck/lint 均退出 0；默认测试 2672 通过 / 0 失败 / 112 跳过，文件 496 通过 / 0 失败 / 67 跳过，100.19 秒；size 581、layer 268，无违规。证据 shared-bot-core/stage-5-{build,typecheck,test,lint}.log。此前定向233通过/21跳过、真实PG6项及首轮Biome失败均在独立记录保留。

相对固定基线无新增失败。PG 覆盖两个作用域隔离、重开、持久 ID、真实约束失败原子性、重复去重/结算、转录/fork和投递恢复；尚不证明插件隔离、真实模型或 worker。未启动 worker/Redis或模型请求，临时 PG/Pool 已关闭。
