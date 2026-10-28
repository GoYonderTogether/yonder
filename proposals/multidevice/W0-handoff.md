# W0 handoff — 接口与工作包

Yonder worktree：`/Users/zoran/Documents/Codex/2026-10-26/task/worktrees/yonder-multidevice-w0`，基线`7a5ccf5434da04d9a7f08f6eb2c20ef945728b0d`。

Card worktree：`/Users/zoran/Documents/Codex/2026-10-26/task/worktrees/yonder-card-multidevice-w0`，基线`a6d828653c0c73051c6fb1e467676378f4d4d800`。两仓分支均`codex/multidevice-w0-20261026`，创建时clean，没复制活动目录dirty内容。原Card在准备期间另有并发改动，因此其diff fingerprint改变，不把该fingerprint冒称未变证明；本任务对原目录仅调用只读Git与worktree add的Git元数据操作。

规范：[18](../../docs/spec/18-device-execution.md)。机器真相：[schema.ts](../../packages/protocol/src/schema.ts)，helper：[index.ts](../../packages/protocol/src/index.ts)，测试：[index.test.ts](../../packages/protocol/src/index.test.ts)。package=`@yonder/protocol`，SDK仅重导出，没有整体拆pi。检查见[verification](W0-verification.md)。

## 可分派输入

- 核心DTO：Origin、Grant、DeviceSession、SubmitCommand、CommandLookup、CommandReceipt、DeviceDescriptor、AppInventory、UiSnapshot、RpcRequest/Response、SignedEnvelope、RelayFrame；精确字段由schema.ts单源导出类型。
- 8个执行/查询RPC：device.describe、device.apps.list、device.ui.snapshot、device.sessions.open/close、commands.submit/status/cancel；另有管理CLI专用grants.revoke（主体只能撤销自己的grant）。没有createAgent/模型运行/restore入口。
- stable key=(deviceId,principalId,commandId)。commandBase64首次发送前持久化；摘要对原bytes计算；内层主体/设备须与已认证信封相同。submit受session/lease约束，status凭当前主体/设备read授权查询旧ID，不需要旧session，不能重启dispatch。
- direct/relay共享同一executor账本及device写锁，第二daemon拒启，running重启=>unknown。W0只有这些语义与纯helper，真正的账本/排队/互斥实现由W1独占。
- Node标准Ed25519，配对记录决定信任公钥；公开网页/消息/Card旧token不建grant。Card v1 relay可看正文，签名提供端到端认证，不能称E2EE。
- 首版inventory/UI；checkpoint restore固定unsupported；不建外部epoch，不实现已配对镜像恢复后继续用旧身份。

## 路径所有权

W0/集成者唯一写root package*.json/tsconfig.json、packages/protocol/**、必要SDK exports/manifests与规范。各包manifest变更提回W0串行合并。

W1：packages/device/src/**，但排除backends/**和platform/**；同规则test/**。独占identity/authority/session/ledger/daemon锁/device写锁。先写packages/device/src/backend-provider.ts接口供W5，后端不得自己做授权/账本/锁。

W2：plugins/devices/src/**、test/**、README.md；仅SDK和Node标准库/已批准依赖，不改SDK/core/executor。实现devices_list/describe/apps/open/observe/execute/status/cancel/close，controller待发记录由插件私有data目录持久保存。

W3：Card server/src/execution-relay.ts、server/test/execution-relay.test.ts、server/contracts/execution-v1/**及index/app/realtime接线；deploy/site.conf.template、dev-remote.sh、test.mjs的路由fixture；不改聊天message/ACK协议，不加另一执行账本/锁。初始contract vendor由W0提供：只relay schema+锁，W3更改需与W0同步。

W4：父会话既定独立任务拥有现有release/service/IPC和平台构建脚本，以及packages/core/src/index.ts的最小IPC导出。W0/W1/W2不碰这些文件；W4不碰root manifest/lock、protocol、SDK、executor或Card。executor安装adapter另按W1的锁接口集成。

W5：仅packages/device/src/backends/**与test/backends/**，等W1 BackendProvider接口稳定再编码。只做Linux guest provider/应用清单/UI，不改原lab配置、不实现身份/锁。VM生命周期唯一执行者另派。

所有Yonder实现包从R+本W0提交的精确SHA分支；Card从C+本地协议vendor提交分支。父会话P0复核通过后，W1、W2、W3可分别并行；W1/W2先验私网，随后接W3。W4已独立进行，不覆盖其工作。
