# 任务生命周期与恢复验收

目标：恢复原委派、保留结果与真实失败原因，阶段汇报后有已接纳的工作，无需主人追问；通知在确定未发送的断网故障后自动补达。授权见 D46。

范围：spec/06、10、14、架构不变量6；core runtime/background、routing、tools、delivery、store；SDK 投递事实；飞书请求错误分类；提示词仅补任务衔接引导。pi fork 如需修改先在上游提交再同步。

验收：OAuth 包装网络故障/真实鉴权拒绝分类；原始错误跨父子传递；后台接纳失败自动补交；真实模型 agent_ask/task_run 跨进程重启且仅委派一次、原结果进入 prepared；task_continue 无新用户输入执行；断网重试及耗尽/取消；确定未发送的通知在线与重启补达，未知及部分成功不重复；默认/真实全套、干净克隆构建安装、CI、正式 Release 和本机自动升级。

## 结果

## 实现

- OAuth 刷新网络错误按原因分类，真实拒绝不重试；原生详情脱敏后传过 run/委派/停止通知。
- 内部委派以原生调用身份去重，重启重新接回原消息和子会话。后台结果持久接纳才确认 notified，失败在线退避补交；未交接结果和排队续办阻止临时会话提前关闭。
- 委派等待从“第一轮回答”改为“该输入因果链的最终原生回执且子会话无待办”；agent.result 只存引用，正文仍读 pi。task_continue 复用 followup，并拒绝已有后台等待时的重复安排。
- 发送账本保存原消息，只有明确未发送的瞬时错误可补达；每次补发先记 message.retry，期间崩溃转 unknown，避免沿旧安全失败重发。未知/部分成功/鉴权拒绝不重发。

## 原始验证记录

- 首轮默认：181 通过 / 2 失败 / 17 跳过；两项旧断言仅接受错误码，更新为检查保留具体错误后，默认复验185通过 / 0失败 / 19跳过（当时204项）。
- 首轮聚焦：29通过 / 1失败 / 5跳过；失败是原有1秒观察窗口不足以覆盖新增1秒接纳补交退避，改为5秒窗口，断言不变；聚焦复验7通过 / 0失败。
- 新跨进程用例前两次均2失败，原因分别为测试home错误地把preset放入yonder.yaml、preset缺少description；均在内核启动前失败。修正为既有presets目录和真实schema。
- 新跨进程用例第三次：1通过 / 1失败；agent_ask 已接回原结果，但续办JSON被模型当通知。补内核续办呈现与导航；agent_ask聚焦1通过 / 1跳过，task_run上一轮通过。
- 首轮含真实模型与launchd全套：204通过 / 1失败 / 0跳过；失败捕获模型在后台等待时过早续办并再次委派（真实副作用2次），新增共享入口约束，不削弱一次副作用断言。
- 修正后聚焦真实回归3通过；第二轮含真实模型/launchd全套205通过 / 0失败 / 0跳过（141.74秒）。
- 01阶段干净克隆 npm ci/build/typecheck/默认测试/lint 均退出0，默认186通过 / 19跳过 / 0失败；lint 0错误，126 warnings/1 info。独立安装移除.git后doctor通过，真实Luna/bash返回INSTALLED_RECOVERY_OK；无日用服务的阶段安装如实记录restart-required而非verified。路径 /tmp/yonder-recovery-clean-WFKJCn。
- 发布前收窄持久会话等待为原输入的因果链，其他独立输入不阻塞结果；原生后台驱动回归验证同会话相关/无关输入。该聚焦首次1失败是驱动未传source，补齐驱动参数后1通过；没有修改实现或削弱断言。01标签仅本地阶段安装，最终版本递增02，不移动已安装标签。
- 02全套203通过 / 2失败 / 0跳过：一项验收把阶段消息提及 RECOVERY_DONE 误认成最终消息，提前停止了仍在执行的续办；另一项模型把绝对输出路径改成了 agents/main/../parent。驱动改为严格匹配最终正文，并把实际路径与委派正文明确为精确工具参数，保留零待办、一次副作用、同一token和实际文件断言。
- 修正验收驱动后全套205通过 / 0失败 / 0跳过（166.88秒）。补上未显示流式消息的完整正文补达及已有卡片不重发，渠道/投递聚焦25通过；真实模型在实际TCP断连、HTTP503及重启后恢复聚焦1通过 / 4按名称过滤跳过（15.83秒），既有一次副作用和最终送达断言不变。
- 02干净克隆默认186通过 / 19跳过 / 0失败，ci/build/typecheck/lint退出0；lint 0错误、127 warnings/1 info。01代码CI39545967411成功，02独立安装成功且如实为restart-required。01/02仅本地阶段标签，不移动已安装标签。
- 最终03含真实模型/隔离launchd全套 **207通过 / 0失败 / 0跳过**（160.54秒，/tmp/yonder-recovery-full-final.log）；真实TCP断连聚焦另行通过，未改产品实现。
- 最终源码 e163f64b8452070bcf6c23ec888d8e1ea2876045。/tmp/yonder-recovery-clean-WFKJCn/repo-03 干净克隆 npm ci/build/typecheck/test/lint 全部退出0；默认188通过 / 19跳过 / 0失败，lint 0错误、127 warnings/1 info（均未放宽规则）。日志 /tmp/yonder-recovery-final-{ci,build,types,tests,lint}.log。
- 最终独立安装 /tmp/yonder-recovery-clean-WFKJCn/install：原update机制按固定03标签克隆构建、移除.git并切current；doctor通过，实际安装中的真实Luna调用bash返回INSTALLED_RECOVERY_03_OK，原生状态done；隔离内核已停止。安装身份与真实任务证据 installed-evidence-03.json，离线安装结果仍如实为restart-required，不冒称日用升级。
- macOS CI [39546986823](https://github.com/GoYonderTogether/yonder-harness/actions/runs/39546986823) 在准确源码e163f64上成功，含npm ci/typecheck/build/default tests/lint。

## 真实场景与证据边界

- agent_ask 与 task_run 均实际SIGKILL子进程，再由新进程恢复同一home；故障门控后重新代理真实Luna供应商，命令生成的随机token只产生一次，父实际write结果一致、prepared含新token、仅一条原用户输入、仅一次委派完成事件、仅一次续办、零queued/placed，最终通知只送达一次。最终样本 /tmp/yonder-task-recovery-agent_ask-G4RHNV/evidence.json 与 /tmp/yonder-task-recovery-task_run-18niOW/evidence.json；task_run注入18次HTTP故障后恢复。
- 连续两次委派回归保留同一Feishu来源msgId，子Agent允许阶段答复，最终新结果仍进入父prepared并执行下一步。
- 投递/飞书协议回归覆盖安全失败在线和重启补达、补发中崩溃转unknown、部分成功/鉴权拒绝不重发、流式未显示消息完整正文补达、已有可见卡片不重发；接纳回调故障后只确认一次交接。
- 跨进程回归的入口和渠道是隔离协议驱动，不连接日用飞书；模型、内核、SQLite、原生调度和工具真实。飞书新错误路径使用协议故障注入，本轮没有断开日用网络或向真实会话发送人工验收消息。实际日用自动升级及飞书程序通知另记下一节。

## 发布与日用验收

- [正式版 v0.2.26102103](https://github.com/GoYonderTogether/yonder-harness/releases/tag/v0.2.26102103)，发布者zoran-xc，非draft/非prerelease，2026-10-21T05:02:31Z发布；只推送03标签，01/02仍为本地阶段标签。
- 既有apply watcher于05:02:38Z接纳实际Release对象，自动升级04→03；没有手动覆盖日用安装或调用日用update命令。
- release.update-result `01M5EDF7DRA2B94BJA1NZNDMHX`，05:03:16.920Z，updateId `74c04da6-22f4-4a2e-8352-43df514d13ae`，verified=true；服务版本03、commit e163f64b8452070bcf6c23ec888d8e1ea2876045、PID9544、ready=true，home仍为 /Users/zoran/.local/share/yonder-harness/home。
- 飞书程序通知 message.out `01M5EDFBGJQB6AXH1BA0QAA364`，05:03:21.106Z，delivery.ok=true，平台消息 `om_x100b62b03729ecacc3c7f996f1a43b3`，正文“Yonder 0.2.26102103 已更新并核验。”。发布监听、更新、核验、通知不依赖额外模型。
- 本轮不重写旧账本、不复活已终结业务目标、不重放历史副作用。自动恢复的新委派由隔离真实回归验证；日用历史Hermes任务是否业务交付完成不由框架升级冒充。

凭据只由原有受信任运行时读取；故障注入是HTTP错误与渠道传输驱动，模型回复均来自真实Luna。测试home均与日用home隔离；没有重放日用已结束任务。
