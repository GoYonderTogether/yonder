# 工作台多端实现与阶段验收（2026-11-02）

## 原始目标与授权

2026-11-02 主人要求完整实现工作区页面和基本多端组合，并授权本机、Linux VM、本人云服务器、GitHub 与线上环境验收及发版，真实模型用 GPT Luna。主 Agent 负责规范、协调、验收，代码交子 Agent，主分支同目录开发，不创建 worktree。

确认行为：运行位置与工作区两个资源按钮；工作区多设备、多目录、仅设备、未指定；模型来源仅云服务和运行宿主本机，不开放跨设备模型代理；供应商/模型/effort 单按钮；加号文件图片及拖放；主人工作台默认 bypass，readonly 与用户自定义权限复用既有体系，其他渠道不提权。详见 spec/19 §7。

## 实现分工

- core/gateway/SDK/CLI/设备：结构化目录、会话覆盖、运行快照、附件、实际资源执行和远程文件/进程。
- apps/app：真实工作台入口、菜单与草稿/会话范围、附件、浏览器验收。
- Cloud：真实云端 Runtime 登记与部署、模型连接/密钥/代理、多人/多目标中继。

## 实体、动作与生命周期

| 实体 | 用户管理动作 | 归属与失效语义 |
|---|---|---|
| Runtime（完整Harness） | 选择运行位置；云端创建、启动、停止 | 是实际运行Agent和保存session的宿主；停机不搬迁、不删除历史 |
| Bot与session | 在选定Runtime新建会话；设模型/effort/权限/资源；提交/中止 | Bot配置与会话覆盖分开；在途运行使用冻结快照，已有会话不暗迁宿主 |
| 执行设备与控制器配对 | 安装轻量executor；核对双方指纹；批准grant；连接/撤销 | 执行设备不需模型；完整Runtime也可同时提供执行能力，多个控制器共享一个设备账本 |
| 工作区资源 | 多选设备/目录；仅选设备；清空为未指定 | 属于会话执行资源，受Bot原授权与device grant共同限制；不把离线状态当撤销 |
| 云模型连接 | 配置供应商/API endpoint/key/模型；启停或编辑连接 | 账号拥有密文凭据，Runtime仅拿授权目录与调用入口；本机模型仍只属于本机Runtime |
| 设备命令 | 提交、查询原commandId、取消 | accepted→running→完成/取消；崩溃可能unknown，重连先查账，不自动重放副作用 |

实际操作入口：工作台底部显示会话运行位置，并管理资源、权限和模型；新建时选择运行宿主，设置页管理云运行位置及云模型连接。本机CLI可用 `yonder rpc models.list '{}' --home <运行目录>`、`yonder rpc workspaces.list '{}' --home <运行目录>` 查询同一控制面，`sessions.options.get/set` 使用实际会话id。轻量端的双向配对、grant、TLS与多Card配置见 `packages/device/README.md`，不把名片登录token当作设备执行授权。

云端运行→本机工具的闭环是：云Runtime保存输入与运行记录→按所选模型调用云网关→模型工具请求带执行身份与资源限制经中继送达设备→设备核验签名/grant并记账执行→结果返回同一云session。设备断开只影响依赖该设备的工具；会话仍属于云Runtime。Linux沙箱是可选执行宿主，可在其内运行同一个executor；组网本身不等于沙箱。

## 验收矩阵

| ID | 必须证明的行为 | 当前证据 |
|---|---|---|
| W01 | 新会话运行位置真实，已有会话不暗中迁移 | 本机真实新会话、云登录导航和草稿保留通过；生产UI在实际cloud Runtime创建session113，资源/模型/权限回读匹配，历史不迁移 |
| W02 | 未指定/设备/多目录/多设备选择在运行中生效 | 浏览器设备与两目录、双TLS executor及完整kernel远程调用通过；混合本机资源回归已补 |
| W03 | 宿主模型与云模型真实调用，其他设备模型不可选 | 本机Luna、云proxy DeepSeek、本机及云端完整Runtime真实DeepSeek会话均成功 |
| W04 | effort按模型能力展示、下一运行生效并恢复 | API/本机Luna及菜单通过；v09生产复验实际off-only云模型隐藏存量medium，真实模型名和provider展示名正确，支持effort的既有行为保留 |
| W05 | 主人默认bypass、readonly和自定义，渠道隔离 | owner真实Luna运行快照、访客伪造及steer隔离、child权限边界通过 |
| W06 | 文件/图片/拖拽通过真实宿主附件进入模型 | 真实上传、拖放、Luna读原PNG、刷新持久化、授权下载逐字节核对通过 |
| W07 | 设备失联、撤销、重复命令无重复副作用 | controller20例，双真实TLS取消、重启账本去重，多Card同账本真实4/4；续办中物理云→Mac离线明确unknown、重连原commandId副作用仅一次通过 |
| W08 | 桌面/窄屏真实页面可操作并有截图 | 本机与生产v09桌面1440/手机390真实页面通过，无pageerror/横向溢出，已保存最终截图 |
| W09 | Linux完整内核和execution-only实际安装 | Linux ARM64裸容器离线四包execution-only通过；Linux amd64完整Harness实际安装且online/workProtocol=1 |
| W10 | 真实模型本机/云端与远程设备链 | 本机Luna双TLS executor、完整kernel、owner隔离通过；云DeepSeek真实session通过。续办物理云Linux→Mac模型read/bash及回读通过，见下文 |
| W11 | 完整build/typecheck/test/lint及发布版本 | 最新联合源码41cccfed全平台CI41467977328成功；正式v0.3.26110209已公开，tagdc45befd、41个核心附件；原始失败/跳过另记 |
| W12 | 线上静态/后端/本机安装状态分别核对 | 网页v09/dc45befd、后端52692f5、云Runtime8f620a0、本机v09/dc45befd分别确认；本机原始verified+真实云模型、生产浏览器闭环及按钮复验通过 |

## 初始事实与边界

主仓实际目录 /Users/zoran/Documents/yonder，yonder-harness为软链接，main。既有其他任务修改 release、桌面壳、规范及状态文件，不覆盖。源码已有执行器和中继，旧spec18/architecture仍写W0待实现，本轮修正状态而不伪造运行证据。Cloud当前 /work 控制的是设备内核，云Bot账号不等于云Runtime。

本轮 limactl list 未发现本机Lima实例；其他Linux宿主待核对，不能把命令可用当VM存在。云端Agent初查目标服务器有Docker，既有dev后端active而正式service failed；本轮未造成该初态，也不盲切failed prod。本机没有旧card-web自动同步worker，修改源码不会自动部署该后端；正式部署前仍检查实际进程与入口。

目录资源选择约束文件工具和执行目标，不宣称任意shell被cwd隔离；云端凭据受信服务能在调用时解密。设备保留最小命令账本，会话权威仍在所属Harness的pi-durable。

## 当前交付与发行后检查

本轮工作台基本组合、物理多端闭环、正式发版、网页上线与本机升级已落地。最终正式版 **v0.3.26110209** / `dc45befdc126e2c4fc5acfcca18b02c819b21522`，网页和本机实际匹配；云后端与云Runtime来源保持独立记录。v08验收发现的两处模型按钮显示问题已随v09发布并通过生产桌面/窄屏定向复验。临时执行设备和网页登录均已撤销，用户数据与云会话历史保留。

原阶段清单的完成情况：

1. 已完成：联合源码 `41cccfed` 全平台发布前CI成功，未绕过门禁。
2. 已完成：正式v09公开；Cloud Deploy web `41470908882` success，线上build-version精确匹配v09/完整dc45befd提交。
3. 已完成：检测并等待已有正常v09更新进程，避免重复安装。原始回执verified=true，正式服务PID88649、ready=true、active0，真实云模型返回 `CLOUD_V09_CONFIRMED`。
4. 已完成：v08实际UI创建cloud/local资源会话113，真实DeepSeek读取上传附件，刷新/下载SHA一致；v09只读复验两个按钮显示修复，桌面及390px无溢出/pageerror。各次临时登录已logout204、原cookie查询session为null，私有profile/token/helper已清理。
5. 物理Mac工具回合已在主人授权校时后完成，断线与原命令重连不重放通过；保留云session41历史，临时设备和配对已撤销。不放宽签名、不把同机测试充当物理多机成功。

发行后追加检查最后快照：tag CI `41470708514` 的Linux/macOS/x64成功，ARM64仍在全量测试，尚无失败；Windows安装CI `41470713008` 两架构全成功；Desktop `41470723544` 和Android `41470717706` 构建及上传作业成功。构建不代表真实GUI/安卓设备安装验收；这些状态不覆盖先前失败记录。

2026-11-02用户要求避免无关耗时、子Agent改Terra/Luna；本轮按此执行。没有发送跨聊天协调消息。WorkBuddy验收模型依赖Mac在线，独立云上游应由用户明确配置BYOK；官方模型订阅/支付仍是后续方向。设备持久接入按实际配对授权管理，不把已清理的临时Mac测试授权当作生产授权。

## 首批实现与定向检查

- `e6073a09`：设备通用文件/进程后端。子 Agent 实测 macOS 文件读写/rename/truncate/flush、目录列表、symlink与断链越界、大文件上限、真实exec非零/stderr、大输出spill、取消后不再写入；连既有Linux provider/CLI合计13/13，device TypeScript通过。该结果不是Linux/Windows安装验收。
- 前端第一批受影响既有测试13/13。后续整组首轮750通过/1失败：新对话框静态import使旧测试入口缺wsUrl；按需加载修复后该用例单独通过，未削弱断言。最终整组与浏览器结果待记录。
- Cloud首批真实临时PostgreSQL/Redis新功能集成4/4，typecheck/build通过。全server suite初现group生命周期2项与迁移表清单1项失败；表清单已按新增迁移更新，后续完整结果和既有失败比较待记录。
- 本机测试auth的Luna是OAuth；未复制到云端。云端API-key来源正在精确核对。无模型API测试和源码存在不能代替云Luna验收。

## 集成门禁与云端基线漂移

- 主 Agent 实跑 lint:layers：251个TS文件、0基线，上行依赖检查通过。
- 首次 lint:size：失败，sessions/index.ts 506、kernel/index.ts 504、sdk/types.ts 502超过500行；已交实现者将新增内容移入工作台模块，不新增豁免。最终结果待记录。
- Cloud新增接口/认证/relay真实临时PG/Redis定向25/25。两项group断言在原HEAD `4afb357` 的独立验证目录同样复现（card-start 4通过/2失败），保留基线证据；未改变群聊契约。
- 云端准备部署期间发现origin/main已前进，含生产后端修复与active-backend部署脚本；已停止切换，先正常合并并重新核对迁移及目标SHA。旧构建仅暂存，尚未据此迁移/改env/重启。

## 用户追加模型验收授权

用户回复允许使用其他模型（DeepSeek/GLM），也允许将本机WorkBuddy网关向云端反向映射。继续本机Luna验收；云端改用已有可达连接或明确依赖Mac在线的受保护测试通道，不复制OAuth，不将反向映射宣称独立云端服务。运维例外限定owner/固定loopback地址，普通用户模型API不得扩大私网访问。

## 真实双设备与 Luna

- 子Agent报告双真实TLS executor定向2/2通过：两设备读写及原生RemoteEnv、readonly读取与拒绝write/exec、symlink和未选设备拒绝、controller重启后同commandId只append一次、真实进程取消后不再写入。
- 本机真实Luna（引用原OAuth来源，无复制）跨两TLS设备并读取用户本轮原始截图通过；与上述无模型用例合计3/3，用时197.53s，原始日志`/tmp/yonder-luna-remote.log`。这证明本机runtime实际模型+远程工具+图像链，不等于云端模型验收。
- 首次定向曾因测试TLS证书缺SAN、装配deviceId不匹配而失败；修正测试装配后通过，未修改后端来绕过身份或证书核验。owner/child/附件完整定向最终计数待回报。

## 云端后端与实际模型

- 已部署云后端`61d719fb20386b5b76020915809ee8a389da0095`至`/opt/yonder-card/backend/releases/20261102T105651Z-61d719fb2038`；最新完整服务端测试197/197，typecheck/build通过。兼容019迁移、18051及HTTPS会话/登录能力通过；未切旧18050或静态指针。
- 回滚旧后端pointer：`/opt/yonder-card/backend/releases/20261101T145747Z-f2a0014938d9`；迁移前备份`/opt/yonder-card/backups/before-active-20261102T105651Z-61d719fb2038.F2012d`，不自动回删数据库/env。
- 真实owner实例create201且Docker running，stop200/stopped、start200/running；原Mac online/workProtocol1保持。旧Oct28容器内核未宣告workProtocol，不能据此算新云工作区通过，待新Linux产物替换。
- 已复用既有WorkBuddy受鉴权反向映射：服务器仅127.0.0.1:13001监听，未鉴权401，实际目录含DeepSeek/GLM。云proxy实际deepseek-v4.1-flash响应200并返回指定验证文本，usage79 tokens、finish=stop。首次max_tokens64不足未得到目标文本，调到1024后验证；没有换假响应。该连接依赖本机在线。
- 前端`89d14e2f`已提交。真实txt/用户PNG单附件实时显示与刷新保留、设备+两目录、390px无溢出通过。截图位于`/Users/zoran/Documents/yonder-review-artifacts/workbench-20261102/`。新静态生产发布与已登录云端管理验收尚待记录。

## 完整内核与多控制宿主

- 主人真实Luna回归1/1（24.62s）：附件式真实package文件可读；owner bypass运行中改readonly仍使用原快照；访客伪造ownerWorkbench且steer只进入后排独立readonly运行，未生成目标写入。child/API权限与上传回归1/1；controller既有20项通过。最终定向合计30/30。
- 完整kernel真实Luna主链1/1（39.05s）：owner console bots.send经绑定进入Bot会话，远程资源、task-general context读取远端AGENTS，默认read/bash实际在executor执行，返回真实规则/包名/shell输出。最初Jarvis未启用task-general时规则断言不命中，补启用真实已有context后验证，不把上下文未选误报为远程失败。
- attachments.get真实上传/持久化/取回逐字节一致与跨session拒绝1/1；网页图片查看/文件取回最终验收待记录。
- `b9dacdec`多Card连接：两个真实controller经PG/Redis/WS同时访问同一executor/ledger，第二路查询第一路结果且副作用只一次；连CLI HTTPS配对生命周期4/4，device tsc通过。首次错误匹配.cache旧副本缺dist导致失败，排除验证副本后当前源码通过。

## 干净提交门禁与前端最终附件验收

- 在批准的一批实现后的固定提交验证目录 `yonder-review-artifacts/workbench-20261102/verify-19eb6451` 检出 `19eb6451`，独立 npm ci、完整 build、typecheck 均通过。没有包含主工作区其他任务的未提交代码。
- 首次全量 Vitest：485文件通过、2失败、67跳过；2630测试通过、2失败、112跳过，用时233.81s。失败分别为新控制方法未登记到契约文档、SDK ToolContext拆分后golden解析仍查旧文件；修复契约/解析，不降低断言。
- Node测试65/65。首次完整lint有2个error：附件列表使用index key、remote-search测试import排序；其余warning不当作error，两处已交实现者修正。最终门禁另记。
- `19eb6451`真实浏览器验证图片820×121、下载PNG SHA256与用户原附件相同，txt逐字匹配；刷新后可查看。390×844无横向溢出、无pageerror；截图为 `attachments-preview-download-desktop.png` 与 `attachments-preview-download-mobile.png`。
- 云端发布前预览仅覆盖真实新静态，API/WS仍为生产真实服务：owner模型连接GET与名称PUT200后恢复，key输入始终为空，实例页真实展示“工作台未就绪”。这不是新静态已上线或云模型浏览器回合验收。
- Docker Hub的amd64镜像首轮拉取未完整，报缺layer，尚未进入Linux构建；正在使用已验证Linux工具链准备替代构建路径，不混用Mac原生产物。

## 完整门禁复验与本机云模型

- 固定 `8f620a0a` 的完整build/typecheck/test/test:node/lint最终均通过。Vitest：488文件通过、67跳过；2633测试通过、112跳过，566.47s；Node65/65。lint零error，1247 warning/35 info；大小及分层检查均零基线。默认跳过的真实模型用例另有前述实际运行证据，不把跳过计为通过。
- 后续 `49b08716` 保留显式配置的macOS服务标准代理环境，安装与重装优先保留已有值，不继承其他shell秘密、不写本机地址为产品默认。实现者3文件6例通过；主Agent干净检出 `28610177` 后build/typecheck/lint与2文件3个匹配回归通过。
- 本机真实Runtime经正式账号目录、cloud provider凭据wrapper、session.submit，实际DeepSeek返回完成及 `CLOUD_RUNTIME_CONFIRMED`；日志 `/tmp/yonder-runtime-cloud-real.log`。目录为1个cloud provider、issues为空。首次裸fetch/临时网络失败已记录；显式Node环境代理路径成功。安装服务原来没有代理环境，本轮已备份plist并设置进程级网络，待正式update后验证常驻服务，不修改系统Clash。
- `28610177` CI的Linux和macOS通过；Windows x64首次2614通过、1失败、131跳过，失败为remote-search完整路径断言使用本地反斜杠而输出统一正斜杠。正在修正跨平台预期，保留真实路径和anchor断言；Windows ARM64尚未完成。
- Linux ARM64、Node24.22.2裸容器 `--network none`：独立安装device/protocol/typebox/ws四包，真实TLS双向配对、默认provider读写、重复commandId append仅一次、真实process stdout/exit7、只读写拒绝及授权根外读取拒绝均通过。未启动Agent/model、未复制Mac原生库；临时容器/配对材料已清理。证据 `yonder-review-artifacts/workbench-20261102/LINUX-EXECUTION-ONLY.md` 与同目录日志。
- Linux amd64完整构建：镜像回传过慢后改用服务器独立Docker，限制1CPU、1536MiB RAM/1792MiB含swap。npm ci成功565包/53秒；首轮原生TypeScript编译器被cgroup OOM终止，只有构建容器受影响，前后线上健康。下一次保持硬限制，按已证实的Go编译器内存问题设置GOMEMLIMIT/GOGC再验证，不提高生产资源配额。

## 初轮云端完成项与物理多端未通过项

- 在原硬限制下，Go编译器内存参数修正后Linux amd64完整build、prune、打包成功。实际包 `yonder-0.3.26110207-8f620a0.tar.gz`，SHA256 `532dd55737427d97fb54dba27ebbd245cc667e5b46c61b1787400f037e096f0d`，Node24.21.0；原服务前后健康。已安装到云Runtime，running/online/workProtocol=1，owner HTTPS work bridge查询bots/models/workspaces成功。
- 云Linux真实session2使用cloud DeepSeek，返回done和 `ATTACHMENT_RECEIVED`；95,381字节真实PNG经HTTPS工作桥上传、提交、取回，字节长度与SHA256一致。证明附件传输及模型接受，不声称视觉识别质量。会话宿主是Linux容器 `/home/node/harness`。
- 云仓 `52692f57835032cb3a71b476d421f158293b0c94` 已推送并部署至 `/opt/yonder-card/backend/releases/20261102T121305Z-52692f578350`；模型代理与其nginx路径单独32MiB，其他入口限制不变。构建/类型检查、实际HTTP边界2/2、nginx校验通过。公网11MiB模型请求到应用鉴权、33MiB为413，附件11MiB与普通API2MiB仍413。部署后真实DeepSeek chat/completions为200且返回验证标记。回滚与备份见外部证据 `CLOUD-FINAL.md`。
- 真实云Linux Controller私钥在云生成，Mac签批临时grant；两端公网Card relay连接成功，云端未配置direct route。HTTPS资源预检先超30秒；原生control socket的一次长deadline尝试返回 `Device session expired; start a new operation`。Mac实测落后标准时钟约10.34秒，云NTP正常；没有调整系统时钟、签名容差或伪造时间。**物理云Linux→Mac模型工具回合，以及此拓扑的断线/重连验收未通过**，不把同机双TLS测试冒充物理两机成功。
- 按用户“不钻牛角尖、减少无关耗时”要求停止深入时钟排查。Mac临时executor、Card设备、云配对/auth slot与本机临时材料已清理；正式云Runtime、模型连接、原WorkBuddy通道与会话保留。临时owner网页登录待正式网页验收后显式撤销。
- 用户要求子Agent改用Terra/Luna后，原实现Agent停止工作并交接；剩余云部署由Terra完成，发布故障的有限定位由Luna执行。既有成功用例未重新扩大运行。

## 初轮发布阻塞与清理

- 共享主分支随后合入群聊路由及桌面分发改动。最近核对CI为 `41443608695`，源码 `84c1833e`：群聊 `admit-batch.test.ts`、`participation-plugin.test.ts`、`plugins/social/test/ledger.golden.test.ts` 各1项失败；lint为social batches507行、kernel home504行、kernel index501行。Windows已编译成功，但托盘smoke缺产物 `YonderStatus.dll`。这是本轮正式发布的当前前置阻塞，不改断言或关闭门禁绕过。
- 之前Windows尾逗号、Disposable/Timer/构造可见性与品牌资源引用已作最小修复；ARM SDK bootstrap曾崩溃，主分支已改用runner预装SDK。上述修复不等于最新整仓CI通过；后续由对应改动收敛后重新核验。
- 临时owner登录已logout204，原cookie再查 `/api/session` 为null；本机与服务器的私有storageState、上下文和临时凭据已删除。正式Runtime、模型连接、原WorkBuddy tunnel、云session及业务进程保留。

## 已知实现边界

远程完整读文件当前上限512 KiB；超限明确报错或在搜索结果报告跳过数。只读远程grep/find使用受限文件API与JS正则、基础ignore语义（非本机rg/fd完全等价），正则worker超时1秒，扫描上限10000项。远程进程不支持stdin；输出在进程完成时返回，大输出溢写文件。权限目录限定不等于shell沙箱。云端WorkBuddy测试连接依赖Mac在线，正式独立云模型需使用云端可达供应商API连接。

## 续办记录（2026-11-02）

- 共享主分支已补 `b69d1483` 群聊测试契约、`dd0236c7` Windows产物和 `a9082d43` 文件行数修复。`a9082d43` 的CI `41446131473` 中Linux与macOS通过，Windows x64失败为PowerShell未等待GUI进程、未取到退出码，实际self-check随后打印PASS；不能将它直接算门禁通过。
- `110b03bc` 将两处托盘smoke改为等待实际进程并检查ExitCode，未关闭检查；新CI为 `41447029296`。正式发版、网页部署和本机升级继续走原门禁，结果另记。
- `110b03bc` 的Windows x64全量测试通过，lint为3 errors/1246 warnings/34 infos，诊断上限未显示3项具体路径。`7221d095` 排除确定属于构建中间产物的Windows status obj目录，并在Windows lint失败时单独输出error，不修改失败门禁；本机模拟obj验证被忽略，但不据此认定原3项错误来源。该提交的x64随后因既有真实PNG渲染20秒超时失败：488文件通过/1失败/69跳过，2628测试通过/1失败/131跳过；上一CI同项通过。未调超时或削弱断言，后续当前main的CI结果单独记录。
- 远端main随后前进 `a6a6c0b5`，其CI `41450183041` attempt2的Windows x64为2636通过/5失败/131跳过，5项均为20秒超时，分布于gateway/tasks/wechat/core，未到lint；整套371秒，前轮约270秒。资源争用是待验证假设，不认定五个模块各有业务缺陷。`7d5b2b7a` 仅将Windows全量测试并发从4降至2，原测试、断言与20秒不变，新CI `41452545670` 验证；没有无变化重跑同配置或扩大业务修改。
- `7d5b2b7a` 的CI `41452545670` 最终全平台success，包括Linux、macOS、Windows x64与ARM64实际测试、lint及设备RPC。Auto release `41455066053` success，正常正式Release `41455103019` 自动执行；未手工绕过CI或复用旧tag。正式版本、附件、线上静态与本机安装结果另记。
- 正式Release `41455103019` 已公开 `v0.3.26110208`，tag commit `92c30164fef621b82fe7a79ec41a6b42c5a67a9d`，41个核心附件。发布源为已全绿的 `7d5b2b7a`，Release commit另含正常版本与CHANGELOG更新。静态和本机更新独立验收，不以Release公开代替上线或安装。
- 最新成功计数：`7d5b2b7a` Windows x64、ARM64各492文件通过/0失败/69跳过，2641测试通过/0失败/131跳过。Linux四分片分别654/746/613/630测试通过、20/45/35/29跳过，均0失败（共2643通过/129跳过）；macOS任务成功。原失败和跳过仍保留，不以此覆盖固定8f620a0a或早期CI的计数。
- 本机正常update切换前旧PID21468、ready=true、active0、四个Agent idle。更新至v08/92c30164后首次回执 `6f1c3216-ee75-4817-a000-acc6aadb90e8` 为failed-or-unknown，具体错误为重启期间control.sock ECONNREFUSED。按既有verifyRelease重验，新回执 `a258d755-dddd-42a1-afd5-741fafcb08fb` verified=true，事件 `01M6E84ENTMS7VS990KPTD48TZ`，PID83640、ready=true、active0；未篡改原回执。正式服务models.list显示云模型available、issues=[]，新session188452以readonly实际调用DeepSeek返回 `CLOUD_INSTALLED_CONFIRMED`，running=false，验收session正常关闭。外部证据 `RELEASE-CONTINUE.md`。
- Cloud正常Deploy web `41455429274` success。真实隔离Chrome读取 `/build-version.json` HTTP200、版本0.3.26110208/完整commit92c30164；`/api/version` HTTP200、后端commit52692f5。真实cloud Runtime仍为原已验证8f620a0，running/online/workProtocol1；浏览器可查看保留session41，模型目录为cloud来源。没有将这三种部署身份混淆，生产交互验收结果另记。
- 发行后追加任务快照：精确tag CI `41455287342` 仍运行，Linux/macOS成功、Windows尚无失败；Windows安装CI `41455291727` x64成功/ARM64运行中；桌面构建 `41455300016` 两平台作业成功。Android `41455296088` 在签名APK构建步骤失败，属于并发原生分发任务，本轮未扩大修复范围，不将它记为成功；这不影响已核对的网页静态与本机核心安装。
- v08生产浏览器闭环：真实human owner、cloud Runtime在线且workProtocol1；保留session41只读历史可见；新cloud/local资源会话真实DeepSeek读取上传文本并返回确认，刷新后附件仍可预览/下载且SHA一致，真实WebSocket、pageerror0，390px无横向溢出。截图 `web-production-desktop.png`、`web-production-mobile-390.png`；临时登录logout204、原cookie查询session为null，私有profile/token/脚本目录已删。使用管理员临时验收登录，不声称普通OTP登录流程已验收。初轮脚本定位Portal失败发生在sessions.open之前，注销后修脚本再验，没有修改应用绕过流程。
- 生产视觉复查发现：目录标记reasoning=false/off-only的DeepSeek在运行后显示配置fallback medium，且云供应商原始UUID前缀挤掉模型名。实际运行配置已有按模型能力clamp，修复限于Footer/NewTask共用的SessionOptions：`48d54ef9` 对已知非推理模型隐藏effort，`642485ce` 模型名优先、真实provider.name单独限宽显示及完整title，模型API ID不改。真实cloud目录组件回归先失败后通过1/1、app typecheck及主Agent针对两文件Biome error级检查通过。待正常新CI/正式发版后只复验此视觉项；原v08其他生产证据继续有效。
- 后续共享main连续前进，`642485ce`、`709368ab`、`5a0c97f3` 的未完成Windows作业被新push取消；没有把取消记成功或重跑旧源。`c3d46ae7` x64再次仅PNG冷启动超时：492文件通过/1失败/69跳过、2641测试通过/1失败/131跳过，477.57秒；相位日志fixture177ms、native PNG约750ms开始、29267ms进入cleanup，定位在真实Resvg冷启动而非fixture。20秒来自通用Vitest预算，规范没有PNG20秒性能契约。
- `22cfcc09` 仅为这一个真实PNG测试设置Windows60秒预算，其他平台仍20秒，真实Resvg与PNG字节断言保留，不改业务渲染/不全局加时/不skip。最初本机前后各2通过/14跳过包含.cache副本；排除.cache后当前源码为1文件通过、1测试通过/7跳过，Biome error级通过。该提交按主人明确main并行规约正常推送，包含并发Agent已经提交的parent operability改动，未推送任何dirty草稿；联合tip仍须完整CI通过后才能正式发行。
- 联合tip构建检出前置parent operability提交漏交 `operability.ts`：两处已提交调用仅type-import，完整runtime实现仍在另一任务工作区编辑且超过500行。`fa3028a8` 以Git部分暂存只补齐现成两种类型（69行），保留工作区完整实现与其他dirty，不纳入未完成runtime函数或新设计。固定提交独立目录 `npm ci/build/typecheck` 全通过后正常推送；实际远端包含随后并发文档提交 `14cc0083`，按联合精确tip继续CI，未将先前缺依赖的失败算通过。

## 最终v09发布与生产复验

- 联合源码 `41cccfed` 的[发布前全平台CI41467977328](https://github.com/GoYonderTogether/yonder/actions/runs/41467977328) success，包含并发任务最终合入的完整operability实现。Windows x64/ARM64各494文件通过/0失败/69跳过、2646测试通过/0失败/131跳过；Linux四分片655/747/616/630测试通过，20/45/35/29跳过，合计2648通过/0失败/129跳过。macOS、build/typecheck/Node检查/lint均通过；原始失败/取消保留在前文。
- 正常[Release41470496669](https://github.com/GoYonderTogether/yonder/actions/runs/41470496669)公开[v0.3.26110209](https://github.com/GoYonderTogether/yonder/releases/tag/v0.3.26110209)，完整tag提交 `dc45befdc126e2c4fc5acfcca18b02c819b21522`，41个核心附件。没有跳过CI、伪造tag或把源码预览当正式版本。
- 本机已有正常同版本更新进程，未并发启动第二次安装。原始事件 `01M6EDRJK7TTHVN7W6J1T593XC` 直接verified=true；正式服务v09/dc45befd、PID88649、ready=true、active0。本机main安全ff-only至正式提交，其他dirty保留。正式服务云目录issues=[]、DeepSeek available=true；readonly session188853实际返回 `CLOUD_V09_CONFIRMED`，已正常关闭。
- 正常Cloud [Deploy web41470908882](https://github.com/GoYonderTogether/yonder-cloud/actions/runs/41470908882) success。真实后台Chrome读取线上build-version为v09/完整dc45befd；后端仍52692f5，Cloud Runtime仍已验收8f620a0且未因本次静态发布重建/重启。三种版本身份分别记录。
- 只读打开云端生产附件历史session113，options仍有存量medium，而真实目录reasoning=false、effortLevels仅off。v09桌面与390px均显示 `DeepSeek V4.1 Flash (WorkBuddy free)` 和实际provider展示名 `WorkBuddy 反向映射（依赖本机在线，验收） · workbuddy`，完整provider title存在，按钮不显示内部cloud UUID或无效medium。侧栏筛选实际Cloud数据，pageerror0；clientWidth/scrollWidth分别1440/1440与390/390。没有重复模型回合或修改会话选项来制造显示通过。
- 主Agent独立查看最终真实截图：`web-production-model-fix-desktop.png`、`web-production-model-fix-mobile-390.png`，位于 `/Users/zoran/Documents/yonder-review-artifacts/workbench-20261102/`；v08前态截图保留供比较。临时管理员验收登录logout204，同cookie再查session为null，浏览器关闭/清cookie，私有token/helper目录删除。普通OTP登录未作为本轮验收结论。
- 发行后检查由主Agent通过GitHub连接器另取快照：Windows两架构正式一行安装、重复运行不重建、实际产品启动/控制状态/停止/重启均success；Android签名APK构建/验证/上传GitHub与OSS、清签名材料success；Desktop macOS dmg与Windows nsis构建/上传success。精确tag追加CI仅ARM64全量回归仍运行，其余平台success，未发现新失败。Windows真实桌面外观、干净GUI安装与安卓真机安装/更新不在本轮宣称通过的范围。
- 物理链新增诊断：Mac比标准时间慢约10.36秒。每次云侧请求都按当时云时钟重新签名，因此在调用前先等待15秒不能消除下一次请求的未来时间；现有验签逐次等待，消耗路由预算。不能据此断言前次租期过期的唯一根因，也未改时钟或放宽签名。Mac校时需要管理员权限，当前进程无免交互权限；已提示主人在系统设置同步，物理工具及重连验收仍未完成。外部证据 `DEVICE-CONTINUE.md` 保留这项边界。
- 本机CLI健康检查曾返回TLS错误curl35，但独立后台浏览器真实打开生产 `/work` 登录页，说明浏览器路径可用；不把CLI路径失败推断为整个站点不可用。新版静态上线前不把旧登录页计作本轮前端验收。
- 主人随后明确授权用命令行弹管理员认证设置自动校时。系统认证成功后，`systemsetup` 确认 Network Time On、服务器 `time.apple.com`；`sntp -sS` 成功样本偏差0.024秒，独立复测成功样本0.158秒（中间有NTP超时）。主人也确认同步完成；物理链按新环境重新验收，不再把旧10秒偏差当当前阻塞。
- 正式云Runtime保留已验证的 `8f620a0` Linux构建来源；现有管理入口只有创建、启停和状态，无按tag升级。本轮不为源码版本对齐新增管理接口或手工重建运行中容器；线上静态、后端和Runtime来源分别记录。
- 物理链续验通过：云Runtime session41使用真实DeepSeek，read得到Mac的darwin/arm64与验证文本；bash在Mac写入 `CLOUD_MAC_EXEC_OK`，exitCode0，模型随后read及Mac本地读回一致。停executor后返回UnconfirmedRequest/OUTCOME_UNKNOWN，云历史保留；恢复后以原commandId再次执行追加操作，文件仍恰好1字节X。临时设备DELETE204、网页登录logout204且原cookie查session为null，临时配对/控制器/目录/进程清理，云配置恢复、实例running；session41及既有业务历史保留。外部证据 `DEVICE-CONTINUE.md`。
- 本次物理联调首次重启云Runtime前未查活跃run，是操作遗漏；清理重启前后实际running0/waiting0、旧session2已完成和session20为idle，但缺少首次重启前快照，不能确认当时完全无影响。已记录，不以清理后健康覆盖此前未知。
