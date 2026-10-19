# P0–P5执行与交付记录

## 批准与边界

2026-10-19用户批准P0–P5，先打磨已有功能与真实验收闭环，不新增插件；cron与记忆后置。Sol/Luna并行，主agent负责核心和共享。先查事实再最小修复，不增加额外机制，保留原始失败和未测。用户批准可多测试群并行，采用固定短脚本/隔离原生会话，避免长期占用主会话。源码起点bc4b872；独立正式安装1902/65fa4db，数据与开发隔离。

## 分工与路径

- 飞书Sol：P0/P1，plugins/channel-feishu/；[分路结果](finishing-feishu-result.md)。
- 工具Sol：P3，plugins/browser-skill/、plugins/codex-tools/、plugins/web-tools/；[分路结果](finishing-tools-result.md)。
- 日用Luna：P2与P4证据核对，packages/cli/、既有skill说明/资源；[分路结果](finishing-daily-result.md)。
- 主agent：packages/core/、packages/sdk/、共享构建/安装接线、P4/P5和结果汇总；不改冻结功能规范。

## 当前状态

P0–P5本轮执行已交付，待用户审核；已通过、上游限制和未测分开。按用户追加要求停止扩大验证，不重复运行已通过检查。P1/P2/P3完整矩阵仍有下列保留项，不能统称全部功能验收完成。完整原验收映射在收尾前记录。所有“未测”保持可见，不以接口/源码/自动检查替代真实场景。

## 原始检查与问题

- 新增原生多CLI渠道验收首次1失败：guest只读配置首先命中能力拒绝（capability-denied），脚本误期望level-denied；前三路真实输入与同主会话回投已过。按实际能力优先契约修正期望，不放松拒绝断言。原日志 /tmp/yonder-p5-native-first.log；继续原脚本剩余场景。
- 飞书群历史真实HTTP400/code230027，缺im:message.group_msg；用户已单独批准补齐及必要应用配置发布。
- 原生多渠道验收第二次1失败：agent_ask已得到helper真实答复，但脚本误将包含no-binding的routes第一条当目标；按事件账本契约同时断言main被忽略及helper实际唤醒。原日志 /tmp/yonder-p5-native-second.log。
- 第一次build/typecheck因新增验收脚本读取可选route.session报TS2345；补实际session存在断言后继续，不放宽产品类型。原日志 /tmp/yonder-p5-build.log、/tmp/yonder-p5-typecheck.log。
- 更多分路原始失败见对应结果，不覆盖既有R/F失败。

## P0 实现修复：平台与本机时钟偏差

原生P1-final-A/B发现平台createdAt比准备时本机Date.now快约4.5秒，导致两次History start must not exceed end、0页背景；原输入和投递未丢失。负责点是conversationContext组装自动查询区间，不能放宽historyPage对用户非法区间的拒绝。

最小修复：固定cutoff取Math.max(Date.now(), ...有效原输入时间)，批量输入同时覆盖最晚已接纳时间，后续分页仍用同一截止；不加时钟同步、重试、等待或丢弃输入。已追全部historyPage调用：显式history工具保留参数校验；catchup水位由本机截止推进，并非这次start来自平台createdAt的根因，不改无实证路径。

回归先于修复失败：1失败/10通过（/tmp/yonder-p0-clock-before.log）；一行修复后11/11通过（/tmp/yonder-p0-clock-after.log）。真实原生失败保留在飞书分路记录。

## 最终源码、安装与检查

- 功能版本 `0.1.2026101903`，源码/固定tag `504b7fc27443a7322b36b0b69c636fd91e64f01d`；未移动1902标签，未创建1903 GitHub Release。任务分提交：P0 `5c5b51b`、P3 `e679aeb`、P2 `4d07d73`、验收脚本/原生检查 `68d42ad`。
- 经原更新器从GitHub tag独立clone/npm ci/build/doctor/current切换/服务刷新完成；日志 `/tmp/yonder-p5-install.log`。真实服务 version1903/commit504b7fc、home不变、PID40703、ready=true，进程核对仅一个正式backend，程序不从开发仓库运行。
- 最终build/typecheck通过（`/tmp/yonder-p5-release-build.log`、`/tmp/yonder-p5-release-typecheck.log`）；真实模型与launchd开关均开启的整仓检查：**35文件 / 145通过 / 0失败 / 0跳过**，46.08秒（`/tmp/yonder-p5-release-tests.log`）。此前144通过是时钟回归加入之前，不覆盖新修复。
- 全仓lint首次8错误/60警告/1信息；修正本轮新mjs脚本格式后，最终**7错误/60警告/1信息**（`/tmp/yonder-p5-lint-final.log`），错误均在Git忽略的范围外 `bp/` 演示资料（4个回调return规则、3个格式错误）。没有修改它或屏蔽规则。`biome check packages plugins scripts` 为**0错误/59警告/1信息**（`/tmp/yonder-p5-product-lint.log`）；不能把它冒充全仓lint通过。
- 1903实际安装模块读取原生event `01M59CXPEKYM32GGQGMNWXCZ55`，在独立只读进程复现原4.5秒本机落后条件，真实飞书API返回2页/23009字节、原始ID可见、无区间错误；报告 `/tmp/yonder-p0-clock-real-result.json`。这是真实API+原事件的区间回归，不冒充新原生输入。随后新版原生A/B准备均2页无错误，见下节。
- 更新后原迟到消息只读复审仍为1接纳/1终结/1投递（`/tmp/yonder-p0-after-update-audit.json`），未重放旧历史。

## 原生飞书新增实证

- 群历史缺权限的原始HTTP400/code230027保留；用户当次批准后只增加tenant `im:message.group_msg`，页面显示Added/current changes published，未另建应用版本或增加include_bot。原有user-token权限未动。新token读取群历史成功；截图 `/tmp/yonder-p1-group-scope.png`。
- 专群真实@与免@均进入observer/session2017、wake=write，无模型运行。按钮点击收到认证原生card-action，未据按钮授权唤醒agent；逐项ID见飞书分路记录。
- **新版原生同轮A/B通过**：A `01M59DQA9NWMSMBTSYF6ZXPGX5`、B `01M59DQBH0R1VH89510P6SN9QV` 各一次接纳；唯一run2069/end `01M59DR8WBEVHGE7ZHDXMDD8Y9` 的inputs包含两者，唯一message.out `01M59DRC6YD0EW290RS1NFE98X` 成功送达 `P1-live-merged`。Typing本地和平台均0。
- 时序边界：B在A背景准备期间接纳，早于模型请求；pi在bash结果后放置B，完成同轮消费。没有证明“B在bash执行中才发送”的更窄条件。早先两轮人工调度错过时机、误用control方法和观察器超时全部保留，不因最新成功删除。
- 四条命令真实原生输入 `/help`、`/skills`、`/session`、`/stop` 分别事件 `01M59DTXN7YEP8VTQ6GQXGYBVW`、`01M59DTY6H8CJA21BBS39CWN30`、`01M59DTZAQBWY1XA9Q3M5Y2V2T`、`01M59DV052H2PMKWDYMZJ9RZZA`；每条均有唯一command.result/done/delivery.ok，没有相应run.end。stop在空闲时执行，不能抵扣运行中停止场景；真实终端取消已有P2证据。
- 用户反馈“验收没问题感觉”记为使用者人工反馈，不扩大成未打开图片/视频/断网场景通过。

## T12/N09/N13/N14/U04对照收口

| 原条目 | 本轮已有结果 | 保留边界 |
|---|---|---|
| T12-1 CLI主会话与重启 | 1903独立更新保留main2；P2真实PTY续聊、退出重连 | 系统注销/登录未测 |
| T12-2 owner/stranger | 新真实三CLI实例检查共享主会话与访客独立只读配置 | 非完整多人/渠道权限笛卡尔积 |
| T12-3 两渠道回投 | 同一隔离home两个实际Unix socket并发输入，共main且分别收到指定回复 | 本次两实例均CLI，不冒称两个不同供应商 |
| T12-4 主动跨渠道发送 | 真实message_send将消息送达另一实际CLI socket | 飞书发送另有session1974实证 |
| T12-5 task_run | 复用已有真实父子/产物/取消及本轮145项对应检查 | 不重复创建无实际需求产物 |
| T12-6 agent_ask | 原生内部agent渠道只唤醒helper，真实Luna答案返回 | 不添加产品agent/插件；隔离home清理 |
| T12-7 新技能下轮读取 | 模型真实write创建skill，下轮索引发现、skill_view读取并照做 | creator Python依赖仍需PyYAML，未装成产品依赖 |
| T12-8 重复调用上限 | 既有真实limits检查验证阈值前拒绝副作用，本轮重跑通过 | 配置2的回归不冒称默认5次逐字场景新验收 |
| T12-9 身份交互查询 | 复用身份/存储检查；三来源真实路由有记录 | 未补模型identity_lookup查询两个账号这一原完整步骤 |
| T12-10 无效配置保旧并恢复 | 既有真实kernel热重载文件/配置失败保旧检查本轮通过 | 不污染正式agent.yaml制造故障 |
| T12-11 版本升级与通知 | 原1805正式Release链保留；本轮1903真实更新路径通过 | 1903无GitHub Release，未重发更新通知；旧v0.1.0发行步骤不重开 |
| N09 | 核心/协议/模型/launchd本轮145通过，原始失败保留 | 缺少的真实组合不由测试总数抵扣 |
| N13 | 群旁观、媒体出站、卡片回调、同轮消费与背景有实证 | 完整飞书矩阵仍按分路结果保留 |
| N14 | 复用已成功维护/更新链；完成1903独立更新和功能修复 | 不造新插件/issue/Release验证工作流 |
| U04 | 原生TUI真实工具、续聊、取消、退出重连通过 | fish缺失、完整视觉/登录组合未测 |

P5新检查脚本在 `packages/core/src/kernel/acceptance.test.ts`，固定真实提示词、真实Luna、实际socket/内核/原生回执；没有模拟模型、新插件或新测试平台。成功凭证 `/tmp/yonder-p5-native-receipt.json` 含各输入ID、来源、routes与工具名；临时home已清理，不把它当正式历史会话。

## 未关闭项，交用户审核

- P1：图片完整打开/视频播放、模板卡片、线程/@实际提醒的完整组合、多用户/其他bot、真实断网重连、运行中发送B的更窄场景、CardKit取消/错误实际客户端全过程。
- P2：陌生用户首次OAuth、过期重登录、真实注销/登录自启及fish加载；不能通过复制/撤销生产凭据或改系统登录来制造通过。creator辅助Python脚本需要PyYAML，说明已补。
- P3：BrowserSkill上传被上游拒绝（需用户配置扩展本地文件权限）；实际扩展断开/重新连接、CUA菜单入口及窗口丢失未重现部分。未加驱动/回退或延长产品超时。
- P4：没有新的真实插件需求，不造占位插件；取消/失败维护与更新场景没有新的真实外部实证，保留已成功E06/E07与对应自动检查。
- P5：范围外bp lint错误未修；T12具体仍缺项见上表，因此T12/N13/N14不改为全部完成。

## 清理与停止

临时p1-channel preset已移除，session1974已关闭；保留测试群、消息、媒体资产及事件历史，未删主人数据。后台浏览器自有会话与隔离PTY服务均停止。未新增插件/依赖/调度/记忆/队列，未修改冻结规范。用户要求停止验证扩张后，只整理结果、提交和交付；本轮到此停止，后续项待审核，不自动展开下一轮。
