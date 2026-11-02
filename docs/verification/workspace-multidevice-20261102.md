# 工作台多端实现与验收（进行中）

## 原始目标与授权

2026-11-02 主人要求完整实现工作区页面和基本多端组合，并授权本机、Linux VM、本人云服务器、GitHub 与线上环境验收及发版，真实模型用 GPT Luna。主 Agent 负责规范、协调、验收，代码交子 Agent，主分支同目录开发，不创建 worktree。

确认行为：运行位置与工作区两个资源按钮；工作区多设备、多目录、仅设备、未指定；模型来源仅云服务和运行宿主本机，不开放跨设备模型代理；供应商/模型/effort 单按钮；加号文件图片及拖放；主人工作台默认 bypass，readonly 与用户自定义权限复用既有体系，其他渠道不提权。详见 spec/19 §7。

## 实现分工

- core/gateway/SDK/CLI/设备：结构化目录、会话覆盖、运行快照、附件、实际资源执行和远程文件/进程。
- apps/app：真实工作台入口、菜单与草稿/会话范围、附件、浏览器验收。
- Cloud：真实云端 Runtime 登记与部署、模型连接/密钥/代理、多人/多目标中继。

## 验收矩阵

| ID | 必须证明的行为 | 当前证据 |
|---|---|---|
| W01 | 新会话运行位置真实，已有会话不暗中迁移 | 待实现验证 |
| W02 | 未指定/设备/多目录/多设备选择在运行中生效 | 待实现验证 |
| W03 | 宿主模型与云模型真实调用，其他设备模型不可选 | 待实现验证 |
| W04 | effort按模型能力展示、下一运行生效并恢复 | 待实现验证 |
| W05 | 主人默认bypass、readonly和自定义，渠道隔离 | 待实现验证 |
| W06 | 文件/图片/拖拽通过真实宿主附件进入模型 | 待实现验证 |
| W07 | 设备失联、撤销、重复命令无重复副作用 | 待实现验证 |
| W08 | 桌面/窄屏真实页面可操作并有截图 | 待实现验证 |
| W09 | Linux完整内核和execution-only实际安装 | 待实现验证 |
| W10 | Luna实际本机/云端与远程设备链 | 待实现验证 |
| W11 | 完整build/typecheck/test/lint及发布版本 | 待实现验证 |
| W12 | 线上静态/后端/本机安装状态分别核对 | 待实现验证 |

## 初始事实与边界

主仓实际目录 /Users/zoran/Documents/yonder，yonder-harness为软链接，main。既有其他任务修改 release、桌面壳、规范及状态文件，不覆盖。源码已有执行器和中继，旧spec18/architecture仍写W0待实现，本轮修正状态而不伪造运行证据。Cloud当前 /work 控制的是设备内核，云Bot账号不等于云Runtime。

本轮 limactl list 未发现本机Lima实例；其他Linux宿主待核对，不能把命令可用当VM存在。云端Agent初查目标服务器有Docker，既有dev后端active而正式service failed；本轮未造成该初态，也不盲切failed prod。本机没有旧card-web自动同步worker，修改源码不会自动部署该后端；正式部署前仍检查实际进程与入口。

目录资源选择约束文件工具和执行目标，不宣称任意shell被cwd隔离；云端凭据受信服务能在调用时解密。设备保留最小命令账本，会话权威仍在所属Harness的pi-durable。

## 检查、失败与未完成

实现进行中。此文档不是验收通过报告。每次实际运行结果随后记录，不以源码存在代替真实多端、模型、生产验证。

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
