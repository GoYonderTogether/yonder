# ServiceHost owned-cleanup：真实反例复现与未关闭验收

2026-10-25（上海时间）。本任务在约 7 分钟内遇到技术保证边界，按委派要求停止，不消耗 40 分钟预算反复研究同一原因。**没有修复 setsid 缺口，没有上线就绪结论；不能把本提交作为已修复产品整合。**

## 起点与隔离

- cwd：`/Users/zoran/.local/share/yonder-harness/home/development/yonder-service-host-cleanup-20261025`
- branch：`fix/service-host-owned-cleanup-20261025`
- 实际 GitHub `main`：`78ae9de9b1b6624fedf228d6e10007ce238d726c`（开始与验后 `git ls-remote origin refs/heads/main` 一致），对应已发布 .06/API-only。该 main 的 `servicePlist()` 仍启动 `bin/yonder start`，没有薄宿主接线。
- 旧候选 `/tmp/yonder-helper-service-host-20261024` HEAD `337b735c87e19ebb121c9a73cb61268311f1333e`、集成候选 `/tmp/yonder-permissions-unified-integration-20261025` HEAD `428fbf500423c619ca163fd3b856ea4a2cff80b8` 均存在，开始及验后干净；没有编辑它们。
- 从候选本地 clone（`--no-hardlinks --no-checkout`），设真实 origin、fetch main，基于最新 main 新建指定分支。已读祖先及项目 AGENTS、docs/index、architecture 全文、CONTRIBUTING、status、两份指定旧证据及宿主/launcher/cleanup/当前 launchd 实现。
- 基线准备提交 `a474b94` 仅从 `337b735` 原样取 4 个文件：`ServiceHost.swift`、`yonder-service-host.mjs`、`yonder-helper-install.mjs`、`test-service-host.mjs`。**没有重盖版本 metadata、SDK、core service 安装、权限入口或 Swift @main 分流；正常产品入口并未启用此候选。** installer 仅因 launcher 的静态 import 存在，测试不调用它。

## 实际执行

每项实际 Swift 编译/测试使用原子 `mkdir /tmp/yonder-heavy-test.lock`，结束由本任务 trap 释放；没有移除他人的锁，没有全量构建/测试。专项无需 npm 安装依赖。Swift 是独立编译现有真实 `ServiceHost.swift`，不是替代实现；临时 App 是原专项创建并 ad-hoc 签名的普通测试包，**不是完整生产 Helper**。

### 原专项未改动重跑

```sh
node --test --test-concurrency=1 scripts/test-service-host.mjs
```

结果：**13 passed / 0 failed / 1 skipped**，约 95.6 秒。

- 原有正常启动、cwd/env/logs、TERM、重复拒绝、重启、Node/Helper/launcher 单点 SIGKILL、普通退出状态、同组未观测后代、回调抛错、租约前取消/不合作租约有界失败、socket 短写/背压、spawn 后发送失败收尾均通过。
- 13 个通过中包括原来的**确认已知反例存活**负向测试，不能计为无遗留验收成功。
- 跳过的是需要完整 app/已构建 CLI 的真实 CLI 场景，本任务未构建/运行；不能据此声称 .06 CLI 集成通过。
- 日志：`/tmp/yonder-service-host-owned-cleanup-baseline-20261025.log`。
- 原始目录：`/tmp/yonder-host-evidence-Hkpx9C`。
- `known-boundary-setsid.json`：child `22408`，`observed:false`、`survived:true`、launcher exit `7`，finally 已回收。

### 新增真实红色验收门（不是修复）

```sh
node --test --test-concurrency=1 scripts/test-service-host-owned-cleanup.mjs
```

该独立脚本使用与旧反例相同的最小 C 行为：根等待 30ms，fork；子 `setsid()`、忽略 TERM 并 pause；根写自有 child PID 后 `_exit(7)`。它要求未观测的脱组后代在宿主退出后消失，**不再把“预期存活”当作验收成功**。旧负向测试原样保留，没有删 escape、缩范围或通过扫描/按名称杀进程制造通过。

结果：**0 passed / 1 failed / 0 skipped**，约 9.8 秒，退出码 1。失败原因 `Timeout: owned setsid descendant reclaimed by host`，不是构建/环境错误。

- 原始目录：`/tmp/yonder-owned-cleanup-PIblH5`，含可单独查看的 `escape.c`、实际编译产物、runner、`result.json`、`cleanup.json`。
- 日志：`/tmp/yonder-service-host-owned-cleanup-red-20261025.log`。
- launcher `22509`、Helper `22510`、根 `22514`；根 exit `7` 原样传播。子 `22516` 未进入任何租约快照且仍存活。
- 宿主退出后的实际定点 ps：`22516 1 22516 /tmp/yonder-owned-cleanup-PIblH5/escape .../child.pid detach`。它已重归父到 1，PGID 为自身而非根 PID。
- finally 仅按此夹具写出的 PID、再次匹配唯一可执行路径后 KILL；4 个登记 PID 最终全部消失。未杀用户其他 Node/Python，未全机监视或扫描进程名。

两项目录中已记录的 40 个夹具 PID 最终全部不存在，定点检查结果：`/tmp/yonder-service-host-owned-cleanup-final-liveness-20261025.json`。此为本轮证据回收，不是全机无孤儿证明。检查未对存活未知 PID 发信号。

Swift 编译保留旧 `addchdir_np` 的 macOS 26 deprecation warning。新增脚本 `node --check`、Biome check、`git diff --check` 均通过。没有运行全仓 build/typecheck/test/lint，未做完整 Helper 签名构建、真实 launchd、TCC、发行升级回滚或生产验收。

## 准确的技术阻塞

现有所有权信息只有：waitable 根 PID/PGID（清理完成才 waitpid）和 `proc_listchildpids` 定时收集、带起始时间的已观测 PID。上面的子进程同时失去了这两条可证明归属的路径：它在下一次收集前重归父，且通过 setsid 脱离根 PGID。根未回收的身份固定不能固定已经变更的子进程组；对旧组 TERM/KILL 不会触及它。应急 cleanup 收到的仍是同一份遗漏快照，无法凭空获得该 PID。现有程序没有忽略一个可用且已登记的 PID；缺的是**脱组/重归父前不可丢失的归属记录及 owner-death 清理约束**。

本机文档/SDK 与已有固定源码证据交叉核对：

- `man 5 launchd.plist` 的 `AbandonProcessGroup` 只约束和 job **同 PGID**的成员；不是任意孙进程容器。现有 LaunchServices app/Node 独立组也不在 launcher 的 job 组中。单纯改为 launchd 直接起某根进程仍不关闭主动 setsid 的反例。
- `man 2 setsid` 明确建立新 session/group，负 PID 的 kill 只信号指定组。`waitid(...WNOWAIT)` 只固定直接子根的 waitable 身份。
- 本机 SDK `sys/event.h` 明确 `NOTE_TRACK/NOTE_TRACKERR/NOTE_CHILD` 从 10.5 起不支持，不能用 FreeBSD 自动跨 fork 跟踪作保证；更短扫描或 NOTE_FORK 后再查询仍存在同一信息丢失窗口。
- `libproc.h` 的 `proc_setpcontrol` 是资源饥饿时的本进程控制，不是 kill-on-owner-death。旧证据固定的 XNU `f6217f891ac0bb64f3d375211650a4c1ff8ca1ea` `sys_coalition.c` 显示 coalition terminate 不等于杀已有成员且 syscall 检查 privileged coalition；不把私有实现名称当成普通应用公开契约。

因此在本任务禁止全机监视、新 daemon、提权、改变进程模型的范围内，**没有可据以实现任意未登记脱组后代保证的受支持手段**。这里不声称证明了 macOS 所有潜在架构均不可能；结论限于当前薄宿主方案与授权范围。也不宣称通用恶意子树约束或 macOS 沙箱。

## 仅有的下一项维护者决定

交 main 决定是否将可保证契约明确收窄为：**至少一个 owner 存活；后代保持原进程组，或在脱组/丢失父链前主动登记并获得 owner 确认；不承诺未登记 daemon 化及双 owner 同杀。** 这会改变原要求，故本任务没有代为接受、实现登记系统或把反例改绿。如果仍要求当前允许的任意未登记 setsid 后代也必回收，薄宿主必须继续阻塞，另立能强制归属的架构决策；不能再次只调快轮询。

## 与最新 .06 的交接方式

本分支继承最新 .06，版本和正式接线均未变。准备提交只是独立复现基线；新增提交只是**失败验收与交接文档**，没有可宣称完成的产品修复。维护者可检出本分支复现，或在正式选定宿主候选后单独迁入新增红色测试；不得将准备提交当作完整宿主集成，更不得将其按成功修复发布。需要先决定上面的契约边界，之后由主 Agent/main 正规整合及必要生产验收。本任务没有 push、生产重启、安装/替换/重签已装 Helper，没有修改正式 home、launchd job、yonder.yaml、bot、snapshot approvedapp，也没有调用权限请求或采集敏感资源。
