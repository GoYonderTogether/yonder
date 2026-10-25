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

## 前轮提交时待定的维护者决定（历史）

交 main 决定是否将可保证契约明确收窄为：**至少一个 owner 存活；后代保持原进程组，或在脱组/丢失父链前主动登记并获得 owner 确认；不承诺未登记 daemon 化及双 owner 同杀。** 这会改变先前候选/Agent 自设的强验收假设，并非改变已核对的主人原始要求；当时本任务尚未收到维护者的契约决定，因此没有代为接受、实现登记系统或把反例改绿。如果仍要求当前允许的任意未登记 setsid 后代也必回收，薄宿主必须继续阻塞，另立能强制归属的架构决策；不能再次只调快轮询。

## 与最新 .06 的交接方式

本分支继承最新 .06，版本和正式接线均未变。准备提交只是独立复现基线；新增提交只是**失败验收与交接文档**，没有可宣称完成的产品修复。维护者可检出本分支复现，或在正式选定宿主候选后单独迁入新增红色测试；不得将准备提交当作完整宿主集成，更不得将其按成功修复发布。需要先决定上面的契约边界，之后由主 Agent/main 正规整合及必要生产验收。本任务没有 push、生产重启、安装/替换/重签已装 Helper，没有修改正式 home、launchd job、yonder.yaml、bot、snapshot approvedapp，也没有调用权限请求或采集敏感资源。


## 接续：受管契约已确定，但同组单 owner 死亡仍有独立红门

2026-10-25 16:46–16:52（上海时间）。本次从 `2a4241eaf5de794c8c9c744322e7a6aac035728e` 接续，分支及工作树与上文相同，起点 clean。维护者已确定常规受管契约：至少一个 owner 存活；后代保持根组，或在脱组/丢失父链前主动登记并获得 owner ACK；不承诺未登记 daemon 或双 owner 同杀。**不再待主人选择，也不再把强保证归为主人原要求。**

来源核对：只读读取 `agents/hermes/projects/yonder-harness/HOST-REQUIREMENTS-SOURCE.md`。主人原目标为主仓库最小原生窗口/系统对接宿主、插件承载窗口具体内容，权限申请和系统数据获取走主代码；任意未登记 setsid 必清理与双 owner 同杀零残留是先前 Agent 自设的强验收假设。上文归属已更正，原 setsid 红门、失败计数、反例和限制不变。

本轮已读项目 AGENTS、docs/index、architecture 全文、CONTRIBUTING、status，并只读核对两旧候选的实际 HEAD/干净状态及相关接线差异：`337b735c87e19ebb121c9a73cb61268311f1333e` 的 Helper @main、release service launcher/plist/status/restart、共享 installer；`428fbf500423c619ca163fd3b856ea4a2cff80b8` 的统一 permissions 增量。没有整树覆盖、没有修改两旧候选、没有倒退当前 .06 已发布 permissions API。

### 新反例属于已支持契约，不是原 setsid 强保证

新增独立红门 `scripts/test-service-host-managed-group.mjs`，直接编译现有真实 ServiceHost.swift；没有安装或使用测试 app 作为 TCC 证据。真实 C 根进程等待 30ms 后 fork，同组后代忽略 TERM，根退出 7。后代从未调用 setsid/setpgid。测试定点观察到根为 Helper 保持的 zombie 后，仅 SIGKILL Helper；launcher 此时仍存活。

实际执行（由原子 mkdir 取得锁，trap 只释放本任务取得的锁）：

```sh
if mkdir /tmp/yonder-heavy-test.lock; then
  trap 'rmdir /tmp/yonder-heavy-test.lock' EXIT
  node --test --test-concurrency=1 scripts/test-service-host-managed-group.mjs \
    > /tmp/yonder-managed-group-20261025.log 2>&1
fi
```

结果：**0 passed / 1 failed / 0 skipped**，约 4.9 秒，退出码 1；失败为 `Timeout: same-group descendant reclaimed by surviving launcher`，不是编译失败。Swift 保留已有 macOS 26 addchdir_np deprecation warning。

- 原始目录：`/tmp/yonder-managed-group-lAIXxj`，含 Main.swift、escape.c、编译产物、runner、result.json 和 cleanup.json。
- KILL 前：launcher `32991` 存活；Helper `32994` 存活；根 `32997` 为 `Z` 且父为 Helper；后代 `33004` 的 PPID 为 1、**PGID 为根 `32997`**。它始终留在根组，未进入任何 lease snapshot。
- Helper 被 KILL 后，launcher 应急 cleanup 收到的 members 只有根 `32997` 的真实起始时间（seconds `1792918218` / micros `981743`）。根随父死被系统回收；它不再是 `same()` 身份锚点。后代仍为 `33004 1 32997 .../escape .../child.pid`。launcher 返回 1 后后代仍存活。
- finally 仅对夹具自身记录的 child PID，在再次核对唯一可执行路径后 KILL。全部 4 个记录 PID 最终消失；没有全机扫描或按进程名杀进程。
- 已保存非敏感实测证据：[result.json](evidence/service-host-managed-group-20261025.json)、[cleanup.json](evidence/service-host-managed-group-cleanup-20261025.json)。日志和原目录仍保留于本机 /tmp（非持久交付路径）。

### 准确的架构缺口与停止位置

现有 `cleanup(pinnedGroup: true)` 的身份固定依赖 Helper 持有 waitable root；launcher 的 fallback 则只允许带起始时间的成员仍匹配、且仍在该组时发组信号。这两者在 Helper 死亡、根已退出时同时失效。去掉 `anchored()` 校验、仅按缓存 PGID 发信号会重新引入 PID/PGID 复用误杀，不能作为修复。更快 collect 仍不能消除该窗口。

**登记 ACK 本身不解决此反例**：同组后代按已批准契约无需主动登记，而它的父链在被轮询前已丢失。需要补齐能跨任一 owner 死亡继续存在的根组身份/接管锚点，或调整根进程父子/组生命周期；这不是再增加一条租约快照即可完成。此结果不证明已批准契约在所有架构下不可实现；只证明当前“Helper 持有 waitable root + launcher 身份快照应急清理”结构尚缺这一设计环节。按委派中遇真实架构阻塞先返回的要求，**没有自行引入新 guardian、daemon、进程容器或变更已批准契约**。

因这条受管基础路径已红，本轮没有启用产品 @main/release/install 接线，没有实现半套登记/ACK 后冒称完成，也没有把当前候选标成产品可构建或契约专项通过。原未登记 setsid 强门和本次支持契约红门分开保留；本轮没有重跑旧门、全量测试、真实 CLI/完整产品构建或注册竞态测试。

轻量检查：新增脚本 `node --check`、最终 Biome check、`git diff --check` 通过。首次 Biome check 报两个 JSON 证据文件的缩进/末尾换行格式错误，格式化后通过；格式化前后 JSON 数据深比较一致，原始结果未变。没有发版、push、正式安装、服务重启、重签批准 app、权限请求或敏感资源采集。

父级剩余事项：先补齐上述根组跨 owner 身份锚点设计，再继续受管登记的双方真实身份同步/ACK、失败与竞态测试、从旧候选定点迁入产品接线及完整构建。生产身份 TCC 验收仍须另做，不得由本生命周期结果推断授权继承。无需主人重选普通受管契约；此处返回的是明确的实现结构缺口。

## 接续：独立 group-anchor 最小修复（17:00，待产品接线）

按父级确定的方案增加同一 Helper 可执行的 `service-group-anchor` 模式：Helper 启动组 leader anchor，anchor 在真实起始时间/PGID/父链经 Helper 登记和 launcher 独立 native verifier 确认 ACK 后才启动业务根。业务根退出报告真实退出状态，anchor 不随根退出，忽略 TERM，并保持到最终身份重验后的组 KILL。Helper 与 launcher 均保留 anchor 身份；没有无身份的旧 PGID 重试。预启动 Helper 死亡时，未获 start 的 anchor 观察私有通道 EOF 自退，没有业务启动窗口。

首次实际验证（每项均持原子 heavy-test 锁，无并发 Swift 构建）：

- `node --test --test-concurrency=1 scripts/test-service-host-managed-group.mjs`：1/0/0，8.0 秒。`/tmp/yonder-managed-group-mmoAzA/result.json` 中根 `38874` 为 anchor `38869` 的 zombie，未观测子 `38881` 留在 anchor PGID；SIGKILL Helper 后 launcher 存活，子最终已消失。`cleanup.json` 记录 5 个 PID 全部回收。
- `node --test --test-concurrency=1 scripts/test-service-host.mjs`：13 通过/0 失败/1 跳过，105.3 秒。包括 Node/Helper/launcher 单点死亡、真实 exit 7、同组未观测子、短写与失败路径；13 中仍包含原未登记 setsid **负向边界**测试，不是该强门通过。CLI 产品场景尚未运行。原始目录 `/tmp/yonder-host-evidence-6tAicx`。
- `node --test --test-concurrency=1 scripts/test-service-host-startup.mjs`：7/0/0，27.6 秒。ACK 前取消、Helper 死、launcher EOF、anchor 死、错误身份 ACK、ACK 超时均没有执行业务代码，按测试记录有界结束并回收 anchor；另检验 stale identity verifier 拒绝且 cleanup 不信号无关进程。原始目录 `/tmp/yonder-anchor-startup-RIY07B`。

以上只是最小修复的进程专项，不是生产可用结论。原先真实失败证据保留；没有重跑上一轮已结束的 setsid 红门或调查。接续工作仍为脱组登记双方 ACK、产品接线/构建与权限入口专项，不触及真实 TCC。

### 脱组前双方登记 ACK

业务环境新增仅本次宿主私有的 `YONDER_SERVICE_REGISTRATION` Unix socket。协议是进程**自己**连接、发送一行 `{"register":true}`，保持原父链且不得脱组/让父链消失，等到收到 `{"registered":<真实 Member>}` 才继续。不能传 target PID。Helper 以 Darwin `LOCAL_PEERPID` / `getpeereid` 取得真实 sender，核对相同 uid、起始时间、完整后代父链（含各中间进程身份复验），将 Member 放入自己的清理表并推送 launcher。launcher 在自己的表中保存后，用 native verifier 再核对身份/祖先，回 memberAck；Helper 最终复验并登记后才给客户端 ACK。并发 admission/帧大小/写入/等待都有界。任一失败均不授权脱组；已捕获的候选身份仍在清理表中。

这是一份逐进程的协作生命周期协议，不是任意 PID 杀进程 API、OS 沙箱或任意新 session 容器。每个离开最初 anchor 组、或将失去可验证父链的进程都必须先完成自己的登记；登记某个 PID 不给其未来未登记 daemon 后代无限继承清理保证。至少一个 owner 存活的契约不变，未登记 daemon / 双 owner 同杀不保证；未登记 setsid 红门与原失败证据不改绿。

- 第一次 `scripts/test-service-host-registration.mjs`：2 通过/8 失败/0 跳过，135.5 秒。原因是新 C 测试夹具将所有带第三参数的 mode 错当恶意消息，合法 stay/hold 路径根本没有发合法登记，等待预期 detach/pending 超时。保留 `/tmp/yonder-registration-SVkTs8` 及原始日志；所有夹具的 finally 记录 remaining 为空。修正为明确比较 `bad`，未放松产品检验或断言。
- 修正后同命令：10 通过/0 失败/0 跳过，64.9 秒，原始目录 `/tmp/yonder-registration-3IlXzf`。实际覆盖双方 ACK 后 setsid + 忽略 TERM，再根 exit 7/根 SIGKILL/Helper SIGKILL/launcher SIGKILL；hold ACK 确认尚未 detach；错误身份 ACK、缺 ACK 超时、peer 提前退出、伪造 target PID、无关真实 peer 拒绝，以及 native verifier 对实际 identity 的 timestamp 篡改拒绝。各测试 result.json 记录 PID 与 remaining（全部空）。

随后补强了中间父链身份复验，最终产品回归另记，不以此前结果覆盖新源码的最终验证。
