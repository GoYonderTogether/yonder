# ServiceHost owned-cleanup：锚点/登记实现与未关闭产品验收

最新状态：独立 group-anchor、双方登记 ACK、最小产品入口及默认 bash 的每任务 command-anchor 已接线。bash 在原组完成 prepare ACK，再 setpgid、完成 ready ACK 才执行，能力由原生宿主私有继承描述符注入。验证批次、仍保留的反例/时序夹具失败与生产验收边界见末节。以下前轮失败记录按历史保留。

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

## 最终候选验证与产品接线（17:20–17:24，未生产验收）

本轮实现提交 `efbdd4c`（独立 anchor）和 `c851fe5`（双方登记 ACK）之后，定点迁入旧候选的服务接线：

- `YonderHelper.swift` 的 @main 在任何 AppKit / permission probe 初始化前分流 5 个生命周期模式；原 .06 RPC / permissions 分支未覆盖。
- core release 新增 `yonder-service` wrapper / hosted plist，安装时根据当前 artifact 是否带 host 选择新链，旧 artifact 回滚仍走旧链；restart 先 bootout 并等待再 bootstrap。status 以当前 lease 的真实 Node PID 区分 launcher。
- `yonder-permissions.mjs` 仅提取既有 app 安装逻辑到同一个 `installHelper`，保留 .06 `permissionCommand` / RPC / owner 和取消路径。没有迁入两旧候选的旧 kernel/SDK/runtime/provider 文件。
- 正常 `build-macos.mjs` 已导入 `build-permissions.mjs`，Swift Package 自动包含 ServiceHost.swift，构建接线无需重复新增。

### 完整构建、真实调用链与专项结果

执行命令均在本 checkout，Swift 和重型专项持有原子 `mkdir /tmp/yonder-heavy-test.lock`，由取得锁的同一 shell trap 释放；最终锁已释放，没有删除他人锁。

```sh
npm ci --ignore-scripts
node_modules/.bin/tsc -b packages/core packages/cli plugins/ui-companion plugins/native-automation
YONDER_HELPER_SIGN_IDENTITY=- node scripts/build-permissions.mjs
node plugins/ui-companion/build.mjs
```

以上通过。完整 Helper Swift Package 构建约 19.8 秒，包含 PermissionFlow 资源与同一 @main，产物在 `packages/macos-helper/dist/Yonder Helper.app`；仅对此 checkout 新构建产物 ad-hoc 签名，`codesign --verify --strict` 通过。不是已批准/正式安装 app 的签名或生产授权验证，没有替换、重签已装 app。没有全仓 build/test；TypeScript 只构建上述目标及必要 references。

先用完整产物临时副本运行原生命周期批次：

```sh
YONDER_HOST_TEST_APP="$PWD/packages/macos-helper/dist/Yonder Helper.app" \
YONDER_HOST_TEST_CLI="$PWD/packages/cli/dist/index.js" \
node --test --test-concurrency=1 scripts/test-service-host.mjs
```

**13 通过 / 1 失败 / 0 跳过**（114.2 秒），不能写成整批全绿。13 个受管场景（含实际 CLI、单 owner 崩溃、普通 exit、启动/transport 失败）通过。失败是保留的旧 `known boundary: unobserved setsid...` 负向夹具在本次完整 app 时序下实际被轮询观测到，`observed === false` 的反例前置断言失败；这不证明未登记 setsid 已修复，也不能把它改成成功。本轮没有修改该负向测试体、原 `test-service-host-owned-cleanup.mjs` 红门、原失败证据，未重启上一轮反例调查。原始目录 `/tmp/yonder-host-evidence-0YKa5D`，日志 `/Users/zoran/.local/share/yonder-harness/home/.yonder/background/97423.log`。

最终受管锚点/登记专项（已包含中间父链复验和新增竞态）：

```sh
node --test --test-concurrency=1 \
  scripts/test-service-host-managed-group.mjs \
  scripts/test-service-host-startup.mjs \
  scripts/test-service-host-registration.mjs
```

**22 通过 / 0 失败 / 0 跳过**（123.7 秒）：

- 同组业务根先为 zombie，再分别 SIGKILL Helper、launcher；未进入任何快照的 TERM-resistant 后代均最终回收，真实 ps 快照和 cleanup.json 保留。
- ACK 前取消、单 owner EOF/死亡、anchor 预启动死亡、错误 ACK、缺 ACK 有界失败；业务代码均未越过双方 ACK 启动门。
- anchor 在业务已启动后被 SIGKILL：有界返回错误且测试中的已知根/成员全部收尾。此项不是任意 anchor 失效后所有未观测后代的额外保证；anchor 身份丢失后不按旧 PGID 重试。
- 已登记 setsid 后代在业务根 exit 7、业务根 SIGKILL、Helper/launcher 单点死亡后回收；member ACK hold/错误/缺失/peer 先退出、ACK 间 owner 死亡均有界失败且无未授权 detach。
- `LOCAL_PEERPID`、start time、完整父链、非后代/任意 target PID 拒绝、stale identity 不信号无关进程。

最终又定点运行加入真实父链断言的 CLI 场景（不是重跑失败的旧反例）：

```sh
YONDER_HOST_TEST_APP="$PWD/packages/macos-helper/dist/Yonder Helper.app" \
YONDER_HOST_TEST_CLI="$PWD/packages/cli/dist/index.js" \
node --test --test-concurrency=1 --test-name-pattern='full Helper LaunchServices' \
  scripts/test-service-host.mjs
```

**1 通过 / 0 失败 / 0 跳过**（7.4 秒，其他用例按名称未执行）。临时 app 经 LaunchServices 起原生 Helper `50954`（PPID 1），其 anchor `50956` 的 PPID 是 `50954`，真实已构建 CLI Node `50964` 的 PPID/PGID 是 `50956`。`service info` ready 为真且 pid 为 `50964`，控制面 stop 后实际退出 0；全部已知成员消失。证据 `/tmp/yonder-host-evidence-Bc6KtN`。持久证据只保留三行原生/业务父链，不保留 launcher argv 中夹具携带的继承环境；测试后续采集改用 `comm` 而非 `command`，父链断言不变。

最后的受管专项、CLI 及以下 Vitest 命令完整日志：`/Users/zoran/.local/share/yonder-harness/home/.yonder/background/97488.log`。

```sh
node_modules/.bin/vitest run --maxWorkers=4 \
  packages/core/src/release/release.test.ts \
  packages/core/src/release/service-host.test.ts \
  packages/sdk/src/permissions.test.ts \
  packages/core/src/permissions.test.ts \
  packages/core/src/plugins/permissions.test.ts \
  packages/core/src/runtime/permission-context.test.ts \
  packages/core/src/runtime/permissions-integration.test.ts \
  packages/core/src/runtime/catalog.test.ts \
  plugins/native-automation/test/permission-actions.test.ts \
  plugins/native-automation/test/permission-rpc.test.ts
```

**10 文件，182 通过 / 0 失败 / 1 跳过**。跳过的是未开启的真实 launchd unload 场景；service-host.test.ts 是明确标注的 launchctl 命令合同夹具，不是实际安装/重启。permissions-integration 的 7 项使用真实 Runtime.adapter / registry / active ToolContext 和 fixture provider；native permission actions 的 96 项使用 mock transport，没有发 OS prompt。不得当作模型/Kernel/OS TCC E2E。

权限接线核对：相对起点 `7a2e11b`，SDK types、core permissions registry、kernel、runtime、tools/permissions、plugins loader 及 native-automation provider 源码均**无 diff**。真实路径仍为 core tool → 活动 ToolContext 校验 → 同一 registry → 已选择 provider → native `permissionRun`（desktop 兼容入口也复用它）→ 原权限 RPC/Helper。新生命周期入口本身不执行权限探针/资源操作，没有第二份 grants 或绕过 registry 的新工具入口。

轻量最终 `node --check`（launcher/permissions/installer）、变更 JS/TS/JSON 的 Biome check、`git diff --check` 通过；保留旧 addchdir_np 的 macOS 26 deprecation warning。没有全量测试、真实模型请求、正式 launchd 安装/重启、push/发布或敏感资源采集。

### 夹具回收与持久证据

[最终锚点/ACK 实测摘要](evidence/service-host-anchor-ack-final-20261025.json) 保存实际源码 SHA-256、两组同组反例的 ps / snapshots / cleanup、12 项登记结果与 8 项启动结果、真实 CLI 父链/info，以及本轮所有 11 个已知证据根的定点 liveness 检查。**297 个唯一已记录 PID 全部已不存在，remaining 为空**，包含首次失败夹具、完整 app 负向夹具和最终回归；没有按进程名或全机扫描杀进程。这是夹具记录范围内的回收，不是全机无孤儿证明。

### 明确未闭合的产品边界 / 父级后续

1. 锚点、逐进程登记协议及最小产品入口已实现并通过上述受管专项，但**不是生产就绪结论**。真实已批准 app 身份/TCC、grant 保留、launchd 安装升级回滚和真实机器使用验收未做。
2. 代码接线核对发现既有 `packages/core/src/runtime/process.ts:38` 的 bash 仍是直接 `spawn(..., detached: true)`，没有使用新登记协议。原 Node/Helper 轮询能回收已观测的稳定进程，不等于它已满足“脱组前双方 ACK”。因此本候选不能宣称所有常规 bash 的任意快速脱组后代已经强受管。新协议不会事后把这个窗口变成已登记。
3. 如果父级要求该默认 bash 路径也纳入新保证，需在其原生脱组前提供启动门，并为该子组保留跨业务根退出的身份锚点；仅登记 shell PID 后让 Node 立即 wait/reap，仍会重现同类子组身份丢失。此涉及每任务子组/退出码与取消的接线，超出本轮所选“顶层 Helper -> group-anchor -> Node + 协作逐进程登记”的最小结构。本轮没有自行引入每任务 guardian 或改掉 bash 的取消语义，交父级定范围后继续；不是用缩短轮询掩盖。
4. 双 owner 同死、未登记 daemon 化仍不保证，原 setsid 强门/失败证据保留。不把这些 Agent 旧假设重新归为主人原始要求。

## 接续：默认 bash 的受管 command-anchor（17:27 起）

起点 `fb847be0294c1b7d1a70fc66afe0b30c3abbb4dc`，原分支/唯一写入 checkout 不变。父级明确批准补齐默认 bash；前节“交父级定范围”的第 2、3 项缺口由本轮实施，不再待用户授权。未迁入旧 permissions、未更改 .06 registry/ToolContext/provider 路径。

### 实际产品路径与两阶段门

`processTool()` 仍是默认 bash 的唯一启动适配点，后台任务/15 秒返回/持久回执/日志/软提醒沿原 `background.ts`，没有第二个后台任务系统。只有 macOS 且原生宿主提供能力时，Node 以 `detached:false` 启动同一个已安装 Helper 的 `service-command-anchor` 模式。该门最初仍在服务根组，不先脱组。

顶层原生 anchor 给 Node 继承一个私有 socket 描述符（fd 4），内容由宿主写入真实 Helper 可执行路径和本次登记 endpoint，随后关闭写端。`YONDER_SERVICE_COMMAND_FD=4` 只是固定描述符标记，不是可执行文件路径设置；core 不接受环境/用户配置中的任意 helper path，不从进程参数猜安装目录。首次 bash 读取并关闭该描述符，缓存能力或失败。缺少/损坏 fd、endpoint 不符、登记/ACK 失败均报错；没有 hosted → 未登记 detached 的静默回退。明确无宿主和非 macOS 仍用原路径（本机实测无宿主兼容，非 macOS 只有条件分支审查，未跨机实测）。

每任务两阶段复用现有 peer 身份登记、完整父链复验和 launcher native verifier：

1. 门发送 `register:true,group:true`。Helper 用真实 peer PID/start identity 验证原组及父链，把身份同时放入 members 和 commandGroups，再发布 `groupStage:prepare`；launcher 保存状态并独立核对身份、父链及仍在原组后 ACK。Helper 最后复验原组，才返回 `prepared`。
2. 门获 prepare ACK 后才 `setpgid(0,0)`。转换前两 owner 已保留同一个真实身份；转换间仍在原组则原组可回收，已经成为 leader 则按该身份+PGID 可回收，不存在只缓存裸 PGID 的窗口。随后发送 `groupReady:true`，双方再次验证真实 group leader，ready ACK 返回 `registered` 后才 spawn `/bin/bash -c`。任何阶段失败都不执行命令。
3. bash 继承真实 cwd/env 和 fd 0/1/2，原日志串行写入和 pause/resume 背压不变；fd 3 为 Node↔门的私有控制/结果通道，不泄漏给 bash。Node 取消只关闭该任务通道，绝不对服务根组发负 PID 信号。门执行任务组 TERM→1 秒 KILL。shell 结束也先清理任务组；shell 以 WNOWAIT 保留真实退出码/信号，anchor 留到最终 group KILL，Node 从独立结果帧取真实 shell 状态，不把 anchor 的 SIGKILL 冒充命令信号。stdio 随最终组回收关闭，Node 才回收门。
4. 两 owner 的清理状态都包含子组锚点身份，每次组信号前重新验证 start identity 和 PGID。一个 owner 死亡后另一方仍能清理子组。完成/reap 后丢弃失效身份，避免常驻服务的 lease 由已结束命令无限增长。取消期间迟到 ACK 不影响其他任务；但仍 pending 的同 PID 错误起始时间 ACK 是协议损坏，不能被误当迟到取消。并发 native verifier 使用独立状态文件，不会互相覆盖后 ACK 了未验证的身份。

这不是新 daemon、提权或全机扫描。原未登记 setsid 强保证仍不承诺；双 owner 同杀仍不承诺。锚点被外部 SIGKILL 后不再用失去身份的旧 PGID 重试。shell 自行产生的未登记 daemon 不会因本次子组登记自动取得无限后代归属。

### 其它 detached 调用的真实归属（未做插件迁移）

- `packages/core/src/runtime/process.ts`：本轮默认 bash；hosted 使用门，无宿主保留 detached 分支。
- `packages/pi-durable/src/env/node.ts` 的 `exec`：仍为 `detached: process.platform !== "win32"`，由 NodeExecutionEnv 统一执行/取消；core 的 `createGrepTool()`（rg）及 `Runtime.executeCommand()` → kernel `services.execution.run` → cron 程序作业会走此路径。它不是默认 bash 的必经点，且 vendored 源须走 pi fork 同步流程，未在本范围迁移，不能宣称所有 SDK exec/cron 快速脱组后代都已登记。
- 同文件另一个 `detached:true` 只在 Windows 的 `taskkill /F /T` 清理分支，不是 macOS 产品启动路径。
- `scripts/test-service-host.mjs` 的 detached Node 是已有真实生命周期夹具；registration 测试的 `detached` 是证据字段；`background.ts` 的 detached 是后台任务回执状态，不是 OS spawn。
- 当前 plugins 没有另一个显式 `spawn(...detached:true)`；browser-skill 的 `child.unref()` 是自身 pipe/drain 收尾，其他插件同组 spawn 由现有祖先/原组合同管理。本轮没有无边界改写插件启动器。

### 验证过程中的失败（不可被末次通过覆盖）

- 第一次完整 Helper 构建失败：新 shellPid/anchor 混合字典错误地调用 Encodable 泛型，Swift 报 Any → Int32；改为现有 JSONSerialization 帧后完整构建成功。日志 `97683.log` → `97705.log`（均在本 home `.yonder/background/`）。
- 新脚本首次 0/3：direct 模式误传 .app 目录而非内部 executable，EACCES，根本未启动业务；修正夹具调用，不改产品门。证据 `/tmp/yonder-command-71WzZI`，日志 `97735.log`。同次 Biome 新增三项错误（赋值表达式、escape 命名）随后修正。
- 新脚本第二次 2/1：实际 cwd 为 macOS `/private/tmp`，夹具错误比较 `/tmp` 文本；改为 realpath 比较，仍验证真实 cwd。证据 `/tmp/yonder-command-icjXV7`，日志 `97771.log`。
- 修正后新门/命令 11/0/0，102.5 秒：`/tmp/yonder-command-gate-MzrRxl`、`/tmp/yonder-command-RC0G1f`，日志 `97825.log`。其后又补非阻塞 connect、失效身份淘汰、迟到 ACK 与并发 verifier 文件隔离；不能仅以此轮结果代表最终源码。
- 一次最终命令前的目标 tsc 被新增测试的 `result.output` 可空类型拦住，重型批次尚未执行；修正测试明确检查 text 结果后 tsc 和该 2 项测试通过。日志 `97911.log`、`97983.log`。Biome 又检出测试 optional chaining 后直接取值，已改为明确的结果类型检查。
- 受管回归批次实际 **31 通过 / 2 失败 / 0 跳过**（230.95 秒，日志 `97929.log`）。新 command/gate 11 项全通过；旧 managed-group/helper-death 的夹具子 `58844` 实际被轮询观测，`observed === false` 前置断言失败，**但其 survived=false 且全部 5 个已记录 PID 回收**。原结果 `/tmp/yonder-managed-group-EUmpaJ` 与测试体不改；另一个 launcher-death 场景通过（`/tmp/yonder-managed-group-GvfSgn`）。另一个失败是错误 ACK 被过宽的“迟到 ACK 忽略”改动吞掉，原测试要求 host exit 1，实际 exit 11（未授权 detach=false、remaining=[]）；已恢复 pending PID 的错误 start identity 为协议错误，保留原测试断言，不改成绿。原目录 `/tmp/yonder-registration-mQXjvG`、`/tmp/yonder-anchor-startup-OXFNdN`。
- 旧完整 Helper 的未登记 setsid 负向夹具前置失败、原 setsid 红门及历史证据仍按前节保留。本轮没有删掉反例、改 unconditional skip 或反复重试到观测时序碰巧合适；将支持合同的定点门与这种时序前置分开报告。新增 `quick-helper-death` / `quick-launcher-death` 用实际 bash `exec` C 根快速退出，先核实真实后代 PPID=1、PGID 等于登记 command anchor，再杀指定单 owner，避免依赖“必须没被轮询看到”的前置条件。

### 最终源码的定点结果（17:52，非生产验收）

最终保留并修正了 pending PID 错误 identity 的 fail-closed 校验、prepare 时双方独立原组验证。最终完整 Helper 构建与验证在同一原子 heavy-test 锁内顺序执行，取得锁的 shell 已释放锁；没有删除别人的锁。JS 最多 `--maxWorkers=4`。

```sh
node_modules/.bin/tsc -b packages/core packages/cli
YONDER_HELPER_SIGN_IDENTITY=- node scripts/build-permissions.mjs
node --test --test-concurrency=1 \
  scripts/test-service-host-startup.mjs \
  scripts/test-service-host-registration.mjs \
  scripts/test-service-host-command.mjs \
  scripts/test-service-host-command-gate.mjs
YONDER_HOST_TEST_APP="$PWD/packages/macos-helper/dist/Yonder Helper.app" \
YONDER_HOST_TEST_CLI="$PWD/packages/cli/dist/index.js" \
node --test --test-concurrency=1 --test-name-pattern='full Helper LaunchServices' \
  scripts/test-service-host.mjs
```

- tsc 目标构建、完整 Swift Package Helper 构建（1.64 秒）和本 checkout 产物 ad-hoc 签名、`codesign --verify --strict` 通过。
- 最终支持合同批次 **33 通过 / 0 失败 / 0 跳过**（216.29 秒）：command/gate 13 项、现有 registration 12 项、startup 8 项。原始目录 `/tmp/yonder-command-13ksKo`、`/tmp/yonder-command-gate-8Arh55`、`/tmp/yonder-registration-m9iCiA`、`/tmp/yonder-anchor-startup-uVYrrs`。不是重跑原时序夹具“直到变绿”，最终命令明确不包含保留的 `test-service-host-managed-group.mjs`；其本轮 1 过/1 前置失败仍在上节，旧 setsid 负向/红门同样不混入此计数。
- 真实 bash ToolRegistration 的正常 stdout/stderr、exit 7、exit 0、SIGTERM（exitCode=null/signal=SIGTERM）、stdin 分次 write/eof、默认 stdin 关闭兼容、cwd/env、262144 字节输出/65536 尾窗/完整日志背压、软 timeout、并发取消一任务而另一任务输出成功、快速根退出后的同组 TERM-resistant 后代回收均通过。两阶段分别 hold、取消、错误 ACK、无 ACK、Helper 单点死亡均不执行业务代码；实际产品 launcher 的 Helper/launcher 单点死亡与两个 quick-owner-death 均通过。取消抗 TERM 的任务实测等待至少 900ms 才结束。新直接 ToolRegistration 夹具不是模型/Kernel E2E；共享后台边界另由原 Runtime 合同实测。
- 完整 app 临时副本经真实 LaunchServices 启动已构建 CLI 并由控制面 stop：**1/0/0**（7.51 秒），按名称未执行其他场景。原生 Helper `61471`（PPID 1）→ 顶层 anchor `61475` → Node CLI `61481`，Node PPID/PGID=`61475`；service info ready=true、pid=`61481`，最终退出 0。原目录 `/tmp/yonder-host-evidence-K0qs8C`。没有正式安装或 launchd 服务重启。
- 上面完整构建、33 项、CLI 的日志：本 home `.yonder/background/98048.log`。

```sh
node_modules/.bin/vitest run --maxWorkers=4 \
  packages/core/src/runtime/process.test.ts \
  packages/core/src/runtime/background.test.ts \
  packages/core/src/release/service-host.test.ts \
  packages/sdk/src/permissions.test.ts \
  packages/core/src/permissions.test.ts \
  packages/core/src/plugins/permissions.test.ts \
  packages/core/src/runtime/permission-context.test.ts \
  packages/core/src/runtime/permissions-integration.test.ts \
  plugins/native-automation/test/permission-actions.test.ts \
  plugins/native-automation/test/permission-rpc.test.ts
```

该批 **10 文件，181 通过 / 0 失败 / 0 跳过**（18.12 秒，日志 `97936.log`）。真实 Runtime background 合同验证原 15 秒返回、background:true、process.write/eof、结果投递和取消归属；运行在明确无宿主模式，不能冒充 hosted Runtime+模型整链。permissions 的实测层级同前节：真实 adapter/registry/context 与 mock native transport 分开，不发 OS prompt。process 新测试修正可空值检查后另定点 **2/0/0**，目标 tsc 再通过（`97983.log`）。最终 Biome check 无 error（保留 process 原有/新增 non-null 及测试 optional-chain 风格 warnings），相关脚本 `node --check`、`git diff --check` 通过；Swift 保留既有 addchdir_np deprecation warning。

[最终 command-anchor 实测摘要](evidence/service-host-command-final-20261025.json) 保存最终源码/完整 Helper SHA-256、13 项 command/gate 真实状态、shell 退出与日志 hash、两种 quick-owner-death 的实际 ps、CLI 父链/info，以及本轮全部 15 个已知证据根的定点回收结果。**384 个唯一已记录 PID 全部已不存在，remaining=[]**，包括早期失败夹具、31/2 回归和最终验证。只读取夹具记录中的 PID，不做全机扫描、不对未知存活 PID 发信号；这不是全机无孤儿证明。没有后台开发服务器/未关闭 watcher，heavy-test 锁已释放。

### 交付边界

默认 bash 的必要子组接线已闭合，仍不是生产上线结论。剩余需另做：已批准 app 真实身份/TCC、现有 grant 保留、生产 launchd 安装/升级/回滚及真人系统功能验收。没有全量测试、push/发布、正式安装/替换/重启、重签已批准 app 或敏感资源采集。未登记 setsid 强门和它的历史失败、旧完整 Helper 负向夹具前置失败、本轮同组夹具时序前置失败全部保留，未无条件 skip。SDK env.exec/cron 的其它 detached 路径如上准确列出，未被本轮默认 bash 保证覆盖。
