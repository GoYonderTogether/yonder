# 19 · 一次设备授权的工作台

2026-10-30 主人明确批准：Yonder 是一个产品，设备授权统一包含消息与工作访问；网页不再要求第二次 Gateway 地址/令牌登录。本节替代本轮先前“单独授权工作台”的产品行为，不改变普通社交消息的权限。

## 1. 身份与权限

- 复用 16 §1 已有设备绑定：网页 human 账号、devices.owner_id、设备 origin 绑定的 deviceToken 及 /ws/device。已绑定设备不再新增确认、密码或第二份长期凭据。
- 网页浏览器只使用既有云账号 HttpOnly 会话；deviceToken、Gateway token 不进入网页。云端逐次验证当前 web session、设备所有权及设备会话仍有效。
- 设备端将已认证控制帧的 ownerId 与本实例已核实的主人关联再次核对。账号与任何相关 Agent 的配置 owner 冲突时拒绝，不因“某一个 Agent 匹配”获得整个实例控制权。
- 工作控制只经专用控制帧进入现有 registry，固定 read/write/owner；admin 与 local:true 继续禁止。普通 DM、群消息及非主人账号不得进入此路径，客户端不得指定 principal 或 scope。
- 此版本信任已部署的云端经 TLS 转交主人请求，云端技术上可读控制正文；不宣称端到端加密。沿用现有撤销和真实设备连接，不另建授权平台。

## 2. 网页接口与设备状态

- GET /api/devices 继续返回原有设备字段，增量可选 workProtocol: 1；仅当前有效设备连接主动宣告支持 v1 时存在。online 不等于支持工作台。旧设备仍可消息连接，并提示更新。
- GET /api/devices/:id/agents：仅设备主人可读取已绑定设备未退役的 `{key, actor}` 映射，actor 与联系人使用同一账号资料；其他账号和解绑设备返回 404，设备凭据不能访问。
- POST /api/devices/:id/work/rpc/:method：现有 human 会话，正文为 registry 原 params；响应沿用网关 {ok:true,result} 或 {ok:false,error:{code,message}}。方法/参数仍由设备 registry 校验。
- WS /ws/work?device=<UUID>：只允许本站 Origin 与有效 human 会话。浏览器帧沿用已有 Gateway sub/unsub/ping 与 ready/ev/end/pong，不新增第二套前端流协议。
- 不属于当前账号的目标返回不泄露存在性的拒绝；离线为 device_offline；在线但无 v1 为 work_unsupported；未核实设备主人为 forbidden。HTTP 失败状态与 JSON 错误保持一致。
- 控制请求超时为 outcome_unknown，不伪装为已执行或未执行，不自动重发副作用；正常用户主动重试沿原 requestId 幂等语义。

## 3. 设备通道

- 设备 hello 增量宣告 workProtocol:1；未准备好控制宿主或主人核对失败时不宣告。
- 设备令牌调用既有 GET /api/session 时，响应在 actor 外增量返回 deviceId；网页会话形状不变。插件据此固定本连接的设备身份，拒绝控制帧中的不同 deviceId，不从社交发送者或任意客户端输入推断设备归属。
- 云端为工作连接生成不可由客户端选择的 channelId，RPC 生成 requestId，分别绑定浏览器 session、ownerId、deviceId 与具体设备 WebSocket。一个设备有多个连接时只固定一个支持 v1 的实际 peer；不广播控制请求。
- RPC 下行 work.request 携带 requestId/ownerId/deviceId/method/params；上行 work.response 只接纳原 peer 与待处理请求，携带 requestId、ok、result 或 error。断开后的迟到回复不跨连接投递。
- 流下行 work.open / work.frame / work.close 携带 channelId 与已核实 ownerId/deviceId；frame 为原 Gateway 客户端帧。上行 work.event 携带 channelId/frame，frame 为原服务端帧。云端不允许设备向任意浏览器指定目标。
- 初版工作桥每次重新订阅从真实当前快照开始，ready.gap=true；不承诺持久游标补收，不建立新转录副本。会话内容、运行和事件仍属于原内核，复用已有网关快照/流适配逻辑。
- 每个连接的订阅和在途操作绑定 AbortSignal；网页退出、设备断线、注销、解绑取消订阅并关闭通道。取消传输不等于撤销已提交的模型任务；真正中止仍调用 sessions.abort。
- 云端请求和事件转发前复核会话和所有权；空闲连接最多 5 秒复核一次到期/撤销。显式解绑通过当前 Hub 主动断开，不声称跨进程无延迟失效。

## 4. 宿主与 SDK

- ChannelIO 增量可选 control 接口，仅已获宿主支持的 channel-card 实例可用；插件不可 import core 或 Gateway 内部包。
- control 仅接纳所属 channel 的账号 ref、method/params、AbortSignal 和事件回调；principal/scopes 不可由插件帧或模型填写。core 负责核对账号身份与实例主人并创建固定权限主体，复用 registry.prepareCall/call。
- 实际最小 SDK 形状为 ready(ownerId):Promise<boolean>、request(ownerId,method,params,signal)、open(ownerId,send,signal)；ownerId 是该设备会话 /api/session 校验的云账号 UUID，由 core 构造所属实例各 Agent 的 acct ref 并逐一核验。ready 也必须做此核验，所有未归档 Agent 的 owner 均须非空且一致；无可核验 Agent 不宣告工作能力。流的每个输入帧及输出事件重新核验，失权终止。
- HostCtx 在内核启动返回后才完备，采用内部延迟注册控制宿主；准备前返回不可用且不宣告 workProtocol。不得伪造 release/awake 等宿主事实。
- Gateway 共享的快照/流适配在宿主层复用；不在插件复制第二套运行时，不为桥改变本机和原直连 Gateway 权限。

## 5. 统一入口与撤销

- 工作列表局部标题区的设备筛选始终列出账号已绑定的真实设备及“全部设备”；离线设备仍可见并标明状态，不展示尚无事实的云环境。全部设备按设备分别查询真实工作和 Bot，失败、离线与不支持分别显示；选择一条会话后只连接其所属设备。列表不显示更多菜单；会话更多菜单固定在会话内容区右上角，仅包含当前会话操作。工作全局设置归个人设置，旧工作设置链接跳转统一设置入口；面板收放和返回操作保持可达。
- 云端会话路由、草稿、布局和查询隔离使用账号、设备和会话的复合身份；不同设备的同号会话不能相互覆盖。详情与副作用只由选中会话的设备处理，设备切换先取消旧订阅并清理旧设备查询。
- 工作区左侧列表与右侧信息栏均有收起和恢复入口，包括设置、缺失会话及既有独显状态。按账号、设备、会话保存面板意图；断点只推导可见布局，不改写用户意图。设备选择只显示当前设备名的菜单按钮，移除布局下拉，更多菜单提供恢复默认视图及真实次要操作。桌面最多三列、平板最多两列、手机一列；自动布局中有内容的右栏优先，用户手动展开列表时右栏暂时让位。点击当前列表项也进入正文。
- 右栏数据区分加载、错误、确认空和有内容：加载或错误不清除已选右栏，确认空时自动布局不占位；用户可主动打开技术信息。异步内容不得抢走已手动选择或正在输入的正文。渠道及子会话面板是右栏内容，共享列数限制；独显右栏时浮窗仍可访问。设置等非会话页面不自动显示会话右栏。
- /work 默认读取当前云账号真实设备列表；有一个可用设备时可直接进入，有多个时按 deviceId 选择。选择和缓存按账号及设备隔离，切换取消旧流、清旧查询，不串会话及草稿。
- 无设备复用现有 /connect 与 /get；离线显示真实离线；老版本显示更新要求。移除主流程中的地址、令牌和“单独授权”表单。底部四栏和 QQ 式全屏个人页保留。
- 已确认退役的 Bot 与已解绑设备的 Bot 不出现在联系人、私人 DM、工作普通列表及群当前成员/可选 Bot；离线或手动停用不是删除，群本身与历史消息、作者资料保留。设备离线期间发生的本地删除须等下次设备同步才能确认。
- DELETE /api/devices/:id 仅设备主人可用，撤销设备 sessions、停止该设备控制连接，停用其 Agent。保留设备/账号/消息历史，不以删除历史记录实现解绑。后续旧 token 和旧工作连接立即被拒；重新连接沿现有邀请码流程。
- 验收必须包含：一次绑定后直接访问真实工作会话；跨账号拒绝；消息连接不受工作订阅影响；断线不重放 mutation；解绑后的 HTTP/WS 访问拒绝；scope/local 禁止；旧客户端未宣告时可用消息但工作不可用。
