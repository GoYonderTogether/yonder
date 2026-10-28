# 18 设备执行契约 v1（W0）

2026-10-26 父会话接受准入审查后的 W0。这里只实现无模型契约和针对性检查；daemon、设备插件、relay、安装、真实配对及 VM 均待后续工作包。W0 通过不代表 A1–A12 产品验收通过。

## 1. 包与身份

`packages/protocol` / `@yonder/protocol` 是唯一源协议，版本 `0.2.26102510`，ESM，Node >=22.19，仅复用固定 `typebox@1.3.27` 与 Node 标准库，不依赖 SDK/core/pi/模型。SDK 重导出它的类型、schema 与协议 helper；full 插件只通过 `@yonder/sdk` 使用。执行端直接依赖 protocol，不生产依赖完整 SDK。现有 SDK 的模型依赖不在本次整体重构。

- deviceId：本地生成的 UUID，绑定执行端密钥；重启/正常升级保留。
- principalId：被明确配对的 full 控制宿主的 Ed25519 公钥 SPKI DER 的 SHA-256（小写 hex）。发送者消息身份、Card账号/deviceToken、设备名都不是执行主体。
- 每次模型工具调用的 `origin={agentId: string|null, profileId, modelSessionId}` 和 `capabilities` 由受信 full 宿主从实际 ToolContext 读取、签名；模型不能填写或扩大它们。执行端只信任本地配对的控制宿主，且再取本地 grant 交集。它不是独立模型审批系统。
- 沿用能力词表的执行子集：read/write/exec/network/message。不下发 admin/cross-agent 管理能力，不给轻量端 Agent 管理 API。

## 2. 配对、认证与 relay 可见性

采用 Node `crypto` 的标准 Ed25519 签名（RFC8032），传输使用校验端点的 TLS/WSS。只对原始 UTF-8 JSON 字节签名，不发明加密算法、KDF 或 JSON canonicalization。

离线双端配对流程：执行端本地管理命令创建一次性、有截止时间的 pairingId/code，并显示执行端公钥 fingerprint；控制端在私网连接前核对端点 TLS fingerprint 与执行端公钥 fingerprint，发送自己的公钥及签名挑战响应；执行端本地可信操作者核对控制端 fingerprint，确认目标/能力/资源/期限；双方分别持久保存对方公钥与身份绑定后才完成。code 单独不授予执行权；签名挑战证明持有私钥，未完成两端确认不能提交命令。配对全过程不依赖 Card、云账号、外部授权服务。

W0 只在内存生成短期测试密钥，验证签名/受众/时效/主体绑定。真正的配对存储和管理命令归 W1；真实持续身份/凭据配置须另行确认，不读写用户正式 home。未配对模板不包含长期私钥。

统一签名封套：`{algorithm:'Ed25519', keyId, payloadBase64, signatureBase64}`。payload 为 `RpcRequest` 或 `RpcResponse` 的原始 JSON bytes，包含协议版本、principalId、deviceId、requestId、issuedAt、expiresAt。verify 输入必须是调用方已信任的公钥及预期 principal/device/direction/requestId；不得从包内自报 key 自动建立信任。requestId 关联在途请求；接收者校验时间窗口。重复有效 submit 的效果由唯一持久 command 账本解决；其他有副作用方法需要 W1 持久 requestId 去重，不仅靠签名。

**v1 Card relay 是可见正文的中继。** 两跳 WSS 防止链路旁观，但 Card 可以解码 payloadBase64；不宣称 E2EE/opaque。端到端签名使 Card 无法修改/伪造已配对端点请求或结果，不能阻止其读取/延迟/丢包/重放。若需要中继不可读，须另行选用成熟端到端加密通道并升级契约；不是 v1 的已实现能力。中继上线前必须明确接受此可见性，纯私网不受影响。

Card 外层 `{protocol:'yonder.execution.relay',version:1,routeId,envelope}` 只负责路由；外层routeId不是权限。响应也由已配对执行端签名；控制端必须验证 deviceId/principalId/requestId 与本次目标匹配。

## 3. 数据结构与 RPC

所有 ID/时间/枚举、对象字段和大小边界的机器可读定义集中在 protocol 的 `src/schema.ts`；类型由同一 schema 推导，禁止两套 DTO。日期用 UTC ISO 字符串，签名时效用 epoch milliseconds；payloadBase64 保存确定的字节，不重新序列化后比签名。

核心结构：

```ts
type ExecutionCapability = 'read'|'write'|'exec'|'network'|'message';
type CommandState = 'accepted'|'running'|'succeeded'|'failed'|'cancelled'|'unknown';
type CommandIdentity = { deviceId: string; principalId: string; commandId: string };
type Origin = { agentId: string|null; profileId: string; modelSessionId: string };
type Grant = {
  grantId: string; deviceId: string; principalId: string; revision: number;
  capabilities: ExecutionCapability[]; targetIds: string[]; actions: string[];
  readRoots: string[]; writeRoots: string[];
  issuedAt: string; expiresAt: string; revokedAt: string|null;
};
type DeviceSession = {
  deviceSessionId: string; deviceId: string; principalId: string; targetId: string;
  grantId: string; grantRevision: number; leaseEpoch: number;
  capabilities: ExecutionCapability[]; origin: Origin; expiresAt: string;
};
type SubmitCommand = CommandIdentity & {
  deviceSessionId: string; leaseEpoch: number; action: string;
  arguments: Record<string, unknown>;
};
type CommandReceipt = CommandIdentity & {
  deviceSessionId: string; payloadSha256: string; state: CommandState;
  acceptedAt: string; updatedAt: string; result?: unknown; error?: ExecutionError;
};
type CommandLookup = { commandId: string }; // device/principal 来自认证消息
```

`action` 必须在本地可信后端注册表中存在，按注册表 schema 校验 arguments，并使用注册表声明的能力和 mutatesDevice。请求不能自报“这次是只读”来绕过写锁。

RPC 名称与 params：

| method | params | 返回 |
|---|---|---|
| `device.describe` | `{}` | DeviceDescriptor |
| `device.apps.list` | `{targetId}` | AppInventory |
| `device.ui.snapshot` | `{deviceSessionId}` | UiSnapshot |
| `device.sessions.open` | `{targetId,grantId,capabilities,origin}` | DeviceSession |
| `device.sessions.close` | `{deviceSessionId}` | `{closed:true}`，取消在途操作另有状态 |
| `commands.submit` | `{commandBase64}` | CommandReceipt；解码为 SubmitCommand |
| `commands.status` | `{commandId}` | CommandReceipt（只读，不 dispatch） |
| `commands.cancel` | `{commandId}` | CommandReceipt；未终止不能假称cancelled |
| `grants.revoke` | `{grantId}` | `{revoked:true}`，仅已配对主体撤销自己的grant；由管理CLI调用，不注册Agent工具 |

`RpcRequest`：`{protocol:'yonder.execution',version:1,kind:'request',requestId,principalId,deviceId,issuedAt,expiresAt,method,params}`。`RpcResponse`：相同身份/版本/关联字段，kind=response，再加 `ok:true,result` 或 `ok:false,error`。响应签名 key 属于 device；请求签名 key 属于 principal。由已配对记录校验，不能混用方向。

错误码冻结为：`INVALID_REQUEST, UNSUPPORTED_VERSION, UNPAIRED, UNAUTHORIZED, WRONG_TARGET, GRANT_EXPIRED, GRANT_REVOKED, LEASE_EXPIRED, LEASE_STALE, COMMAND_CONFLICT, COMMAND_NOT_FOUND, BUSY, UNSUPPORTED_OPERATION, OUTCOME_UNKNOWN, INTERNAL_ERROR`。unknown receipt 是事实，不自动转换为可重试错误。VM checkpoint restore 固定 unsupported，不注册 restore RPC。

DeviceDescriptor 包含 role、OS版本、host/process架构、runtime、targets、能力/支持状态、资源及各自采集时间、应用清单摘要、ready/busy/offline/degraded/unpaired、各 route 状态。AppInventory 区分 available/unsupported/denied/error，包含 observedAt、complete、items；UiSnapshot 明确 deviceSession、targetId、observedAt、结构化UI/可选小图。schema中的 `checkpointRestore:'unsupported'` 为首版固定值；不将 UI snapshot 当完整架构/应用清单。

## 4. 持久化、查询、互斥与恢复（W1 必须实现）

1. 控制宿主在第一次网络发送前持久保存 CommandIdentity、原始 commandBase64、请求摘要和发起模型会话。失败于持久化则不发送。route/requestId/timestamp/签名可以新建，原 command bytes 不能变化。
2. executor 唯一键为 `(deviceId,principalId,commandId)`；摘要是解码后原始 SubmitCommand bytes 的 SHA-256。`decodeCommand`必须接收已认证消息的principal/device并核对内层身份，不能只验证外层后信任内层自报目标。与原deviceSession绑定一并保存。相同键不同摘要拒绝。相同ID不得换新session变成第二次执行。
3. submit 仍需当前有效 session/lease；失效后使用 `commands.status`，绝不能用重新submit当查询。status由当前已配对principal及该device当前只读grant授权，**不依赖原session/lease**；只能读取同主体同device记录，不能触发创建、恢复执行或修改结果。当前read grant必须覆盖原target；若不覆盖原操作/资源，只返回状态元数据，不返回旧result正文。无当前read授权仍拒绝；可以新授read grant后查询旧命令。
4. 在任何后端副作用前原子持久accepted，再持久running，再dispatch。direct/relay/full本机入口共用同一账本和device写锁。新连接不重置锁。同一执行home第二daemon拒启；W4服务adapter必须调用W1锁，不再实现一把设备锁。
5. 收到/出队时检查本地grant/revision/期限和lease，取受信host权限与本地grant交集；排队时撤销仍能阻止执行。已运行操作先确认子进程/驱动停止，再释放写者；只失去网络或lease不代表停止。
6. 重启发现running一律unknown，不自动重放；accepted可在重新核权限、确认未dispatch后处理。unknown只可显式核验，不能自动failed→新ID重试。W0只给纯状态转换helper，不实现账本/调度器。
7. 首版不支持已配对guest checkpoint restore/clone，也不尝试恢复后沿用密钥/旧grant。后端报告unsupported。未配对无密钥模板可复制后独立生成身份配对；checkpoint恢复能力与未来明确防克隆机制另开设计，不建立外部epoch系统。Android 后续接入不得把 AVD 名称或 ADB serial 当作持久 deviceId：不同 guest 数据目录可复用相同显示名和 `emulator-5554`。注册必须绑定受控实例记录与其数据盘、执行端签名身份；应用清单缓存不得跨实例复用。本版尚无 Android native executor，以上仅是接入约束而非已通过的实现。

## 5. 模型工具和管理命令名称（后续实现）

插件 `@yonder/plugin-devices`，id=`devices`：`devices_list`, `devices_describe`, `devices_apps`, `devices_open`, `devices_observe`, `devices_execute`, `devices_status`, `devices_cancel`, `devices_close`。前三类/observe/status/close需要read（远端调用另需network）；open需要read+network并取真实ctx能力交集；execute静态声明exec/read/write/network/message，后端再依action声明限制；cancel需要exec+network。工具参数只有deviceId/session handle/action/arguments/commandId等业务字段，没有principal、grant创建、权限或签名密钥参数。

管理CLI属于executor包，不是Agent工具：`yonder-executor init`, `serve`, `pair start`, `pair approve`, `pair connect`, `peers list`, `grants list`, `grants revoke`。code/私钥通过私有文件/stdin，不放命令行或日志。full发行包含该管理组件，可作为controller/executor；execution-only没有模型或Agent管理路径。此处固定名字，W0不创建这些bin占位。

## 6. 跨仓共享与工作包所有权

protocol导出 `schema/execution-v1.json` 和只含外层信封的 `schema/relay-v1.json`；`npm run build -w @yonder/protocol`生成（可单独运行 `node packages/protocol/scripts/export-schema.mjs`）。Yonder是唯一源。Card W3只复制relay schema与`contract.lock.json`到`server/contracts/execution-v1/`，锁包含repository、精确W0 commit、schema SHA256、protocolVersion。复制由父会话从已审核本地W0导出，Card无需npm访问私有源仓或假设protocol已发布。Card校验外层并转发内层字节，不复制执行授权逻辑。

公共版本/根manifest/lock/SDK/schema更新只有W0/集成者串行修改。字段不兼容更改必须重新审阅，更新共同版本/摘要与对应测试，不各仓加临时别名。

| 包 | 允许编辑路径（相对所属repo） | 依赖与限制 |
|---|---|---|
| W0 | `packages/protocol/**`, `packages/sdk/src/{index,types}.ts`, `packages/sdk/{package,tsconfig}.json`, root `package*.json`, `tsconfig.json`, `docs/spec/18-device-execution.md`, `docs/{architecture,index,decisions,status}.md`, `CHANGELOG.md`, `proposals/multidevice/**` | 公共文件唯一写者；不写daemon实现 |
| W1 | Yonder `packages/device/src/**`，但排除`backends/**`和`platform/**`；`packages/device/test/**`但排除backends/platform；`packages/device/README.md` | 依赖W0；拥有身份/grant/session、持久账本、唯一daemon锁/写锁、BackendProvider接口；manifest申请回W0 |
| W2 | Yonder `plugins/devices/src/**`, `plugins/devices/test/**`, `plugins/devices/README.md` | 依赖W0；仅SDK，不动core/SDK/daemon；controller待发日志在插件私有数据目录；manifest回W0 |
| W3 | Card `server/src/execution-relay.ts`, `server/test/execution-relay.test.ts`, `server/contracts/execution-v1/**`, `server/src/{index,app,realtime}.ts`接线，`deploy/{site.conf.template,dev-remote.sh,test.mjs}` | W0锁定摘要后；只窄relay/持续连接scope，不做执行账本/锁，不改聊天正文协议；manifest/迁移先交集成者 |
| W4 | 父会话已单独分派的full平台包：现有 `packages/core/src/{release,control}/**`、平台service/IPC和构建脚本；具体以其任务白名单为准 | 同R独立树，可并行；不碰root manifest/lock、SDK、protocol、executor或Card；本W0不修改这些W4文件。executor平台adapter后续单独分配，只调用W1锁 |
| W5 | Yonder `packages/device/src/backends/**`, `packages/device/test/backends/**` | W1先固定BackendProvider接口；只实现Linux guest内provider/应用清单/UI；不写身份/账本/锁/manifest，不改旧lab，VM唯一执行者另派 |
| W6 | 集成树的验收记录与必要接线；共享文件仅集成者 | W1/W2纯私网通过后接W3；审查P0后父会话派实现 |

每包从R加W0本地提交分出新分支；Card从C加其协议锁定文档分出。W0 schema/SDK冻结前不派W1–W3产品实现。W4/W5可先只读调查；依赖关系不是授权他们启动VM。

## 7. 本轮检查与产品验收界限

W0针对性检查：schema拒绝错误字段/版本、status无需session、签名验证双端身份/方向/受众/过期与篡改、同command字节摘要稳定/冲突、running→unknown、restore unsupported、独立packed产物无模型依赖。SDK重导出兼容性和repo规定检查另记结果。W1的持久账本、进程kill、双daemon、真实配对/Agent/网络/六端安装仍未实现，不借W0测试宣布通过。

A9修正：首版仅inventory/UI；checkpoint restore明确unsupported，本产品不提供已配对镜像恢复/克隆后自动ready的入口。管理员在产品外手工复制完整已配对磁盘不属于本版支持范围，不能声称软件已经检测或阻止所有外部克隆。A6/A11补controller先持久、跨新session只读查旧command、同home双daemon拒启。A2最终仍需execution-only独立产物检查，W0仅证明protocol包闭包。
