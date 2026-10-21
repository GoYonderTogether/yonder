# QQ 官方渠道与群持续参与验收

2026-10-21，任务分支 `zoran/qq-channel`，基于 main `aaf23e3` / 0.2.26102103。使用独立临时 home、独立模型 OAuth 和用户绑定的真实 QQ 机器人；未安装、替换或重启日用正式版。源码、协议入口和 QQ 平台证据分开记录。

## 已确认的产品流程

1. 配置命令输出腾讯官方链接和终端二维码，可打开官方网页。用户自行登录、选择/创建机器人并绑定；本机命令保存独立凭据引用、渠道与绑定，不展示密钥。
2. 用户真实完成扫码绑定和独立模型授权。私聊与群 @ 均经过官方 WebSocket、内核绑定、真实 Luna 和官方发送 API，用户确认两个客户端场景收到回复。原始事件见 status 的首轮记录。
3. 全量接收由**群主在具体群聊内管理这个机器人**，将“机器人可获取的群聊消息范围”设为全部消息。机器人资料页、开发者页不能代替；每群、每机器人分别配置。“主动在群聊内发言”另行开启。用户找到并完成了该设置。
4. SDK 查询真实 bot_state：设置前 recv_msg_setting 为空；设置后 recv_msg_setting=all、member_role=member、allow_proactive_msg=true。证明该测试机器人无需群管理员身份即可接收全量文字；不外推所有应用的查询接口白名单资格。

官方依据：[群全量事件](https://bot.q.qq.com/wiki/develop/api-v2/autogen/event/group_message_create.html)、[FAQ 与设置入口](https://bot.q.qq.com/wiki/bot_FAQ/#q-在群里-机器人不回复-但私聊可以-机器人在群中主动发送消息失败)、[bot_state](https://bot.q.qq.com/wiki/develop/api-v2/autogen/api/v2_groups_group_openid_bot_state.get.html)。

## 真实普通群消息

用户连续发送三条未 @ 文字，均 mentioned=false、wake=write、session=56；入站本身没有逐条启动模型：

- `01M5EGM3Q2DCKYRGN5GTMCSQYP`：第一条测试消息。
- `01M5EGM5HKR1RE84Z7KWYRRN14`：第二条。
- `01M5EGMG4ST00X0PV375HVV9K1`：读取 memory/qq-verification.txt、请求主会话核对并回复。

60 秒窗口产生一个批次 `01M5EGNYA6FGRTFKKMA3HNE7N1`，count=3，group run=86。分身实际 read 该共享文件，parent_ask 进入独立 main session=2 / run=108；主会话当时没有公开文件的明确授权，拒绝披露。请求和真实拒绝结果均完整返回，没有声称已核验。群处理完成后生成 group-read `01M5EGQAVKCBKK5RF4SWME5G1A`。两个 run 均为 openai/gpt-6-luna、done。

本批原始失败：模型用消息头的 turn id 定向回复，工具只接受原生 QQ msgId，两次发送均在内核拒绝，未触发 QQ 投递。根因修复为：message_send.replyTo 接受目标会话真实 message.in 的 turn id 或原生 ID，先核实会话再转换给渠道；batch id、伪造 ID、其他群 ID 仍拒绝。仅修改提示词不足以消除这类标识歧义。

这份无凭据的测试记录随后获得明确的隔离测试公开授权；不放宽其他文件或生产主会话授权。修复后用户再次发送五条未 @ 文字，末条为明确的读取/核验/引用请求：

- 批次 `01M5EHC9D21RD31P2CWFAS9205`，count=5，06:11:34.946Z 启动，距离本批首条约 60 秒；busy=steer。
- main session=2 / run=171 实际 read 测试文件，返回“核验通过”；超过 15 秒沿原生后台工具结果回到群分身。
- 群 session=56 / run=147，包含原批次与后台完成输入，Luna done。发送记录 `01M5EHE02DFFS8G1ZFANZ3PRV1` 与 `01M5EHECXRC63TEWT8J4MH0GK3` 均 delivery.ok=true 且返回不同的 QQ 原生消息 ID，两条 replyTo 均为末条真实请求的原生 ID；第二条明确更新“主会话已核验通过”。
- 最终 group-read `01M5EHENA4TNK3K77TWQ1AZRTH`，覆盖这五条消息。没有将首次失败当作已投递。
- 本批两次 run.end 的 usage 合计 input=54939、output=617、cacheRead=129536，运行时估计 cost=0.00709776；首条到第一个回执约 116 秒，到核验更新约 129 秒。包含时间桶、读文件、主会话与工具轮次，不是每条消息的固定延迟或长时间水群成本结论。

上述平台闭环使用了消息 ID 转换后的代码；最后新增的 parent_ask 显式完成字段随后通过完整真实 Luna 协议检查。用户随后确认“两条已收到，引用正常”，完成真实客户端收取与指定消息引用验收。最终代码已在同一隔离 home 重启；正式安装与日用 home 不变。

## 源码与真实模型检查

- 新增 store 回归：namespaced events.ask 的 waiting route 必须被 waitingInputs 覆盖；否则群批次运行虽完成，插件等待无法结束。这是共享查询缺口，沿现有路由/账本修复。
- 腾讯 SDK 协议事件、扫码配置和预取消检查通过；事件驱动使用协议输入，不冒充平台真实消息。
- 真实 Luna 的 participation-live 用本机协议收发入口，实际运行内核、原生 conversation、文件工具、parent_ask 和投递。验证两条合批、共享文件读取、main 读取公开校验记录、完成结果回到群分身、一个定向投递、跨群发送与无效引用拒绝；第二群可选择安静；两个群 session 独立；已处理批次重启后不重复调用模型。该测试不证明 QQ API 或 QQ 客户端效果。
- 原始真实模型专项连续四次失败：第一次没有发送记录；第二次缺少主会话公开授权；第三次群分身仍保留私密边界，虽后台结果返回但没有公开；第四次主会话返回了公开校验结果，群分身使用 turn id 被原生 ID 校验拦截。没有削弱隐私/跨群断言；补全公开测试授权、修复标识转换后，第五次 1 通过 / 0 失败 / 0 跳过。
- 首轮扩展构建失败于 exactOptionalPropertyTypes 与可空来源；修复后通过。首轮聚焦检查 7 通过 / 1 失败，原因是 doctor 内部 agent 渠道没有声明 parent-request；修复后 12 通过 / 0 失败。
- 默认全仓测试 193 通过 / 0 失败 / 20 跳过，52 文件通过 / 11 跳过。构建、typecheck、lint 通过；lint 保留 127 个既存警告和 1 info，QQ 新文件无诊断。默认跳过的真实模型/系统服务检查不计为通过。

- 补充忙时检查：第三条真实协议输入在第一批模型运行期间到达，第一批只覆盖前两条，第二批覆盖第三条。首次扩展检查 0 通过 / 1 失败：游标分离正确，但模型拿到主会话裸文本后仍声称结果未完成，定向消息缺少第二校验值。将 parent_ask 的结果补成实际 status/session/text 后，扩展真实 Luna 检查 1 通过 / 0 失败 / 0 跳过（82.12 秒）；同时覆盖 main 请求超过 15 秒时的真实后台结果返回、后续桶、第二群安静与重启不重复。未改动权限或发送成功断言。

## 范围与未测

- 当前支持官方机器人私聊、群 @、全量普通文字；尚未实现媒体内容解析/发送、频道与 Webhook。全量接收不等于媒体已经理解。
- 单批最多 100 条，剩余保持未读；空桶不唤醒。@ 可提前结束等待，工具循环、后台续办和拆批会增加模型请求，60 秒不是每小时 60 次请求的硬上限。尚无长时间水群成本基线。
- 已处理后的重启检查与活跃运行中强制崩溃不同。未以本插件完成活跃批次强杀、平台断网及离线回放演练；原生运行恢复和腾讯连接恢复仍沿已有契约。
- 当前分支未发布、未替换日用安装。QQ 向导显式配置普通私聊与群批次 busy=steer，内部主会话请求保持 followup 等待。

## 对齐共享运行时

完成客户端验收后，将 QQ 任务分支对齐本机 main `3591a37`（包含共享修复 `df5ebc4` 与原生 fork `5bba5aedf7cbc57a83e437a491c80cffc2c4f50d`）。保留 main 的默认 steer、steeringMode/followUpMode=all、显式 interrupt 与 D49；QQ 的 D47/D48/D50、受限 main 请求、定向消息校验独立保留。没有重启日用或 QQ 隔离服务，因此原平台验收仍对应上节已注明的运行代码。

首轮构建因本 worktree 未安装 main 新增的 silk-wasm 失败；按既有锁文件 npm install --ignore-scripts 补齐三项依赖后，构建、typecheck、默认全仓与 lint 通过。全仓为 200 通过 / 0 失败 / 24 跳过（53 文件通过 / 12 跳过）；lint 184 个警告、1 info、0 错误。锁文件与已提交配置无额外变动。

对齐后再次显式启用真实 Luna：participation-live 1 通过 / 0 失败 / 0 跳过，74.06 秒；重新覆盖合批、忙时新输入留到下一批、只读记忆、main 实际结果返回、跨群/无效引用拒绝、第二群静默和已处理重启不重复。该次没有重新要求用户向 QQ 发消息，不能称为新运行时的二次 QQ 平台验收。
