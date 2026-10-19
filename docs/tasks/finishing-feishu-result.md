# P0/P1 飞书已有能力收尾结果（本轮结束，保留未测）

2026-10-19；依据 finishing-plan、D35/D36、spec/11。未改功能规范、正式绑定、安装或运行进程。

## P0 原生事实

- 正式服务只读确认：0.1.2026101902 / 65fa4db / PID19108 / ready=true。
- 新增只读审计 `plugins/channel-feishu/scripts/audit-native.py`，仅用 Python 标准库，以 SQLite mode=ro 查询原生ID、接纳、pi输入条目、run.end.inputs及message.out。只输出标识和状态，不输出正文或凭据。
- 实跑：`python3 plugins/channel-feishu/scripts/audit-native.py /Users/zoran/.local/share/yonder-harness/home om_x100b626cd100f8b8ce84dd36116e270`，报告 `/tmp/yonder-p0-native-audit.json`。原发送03:09:49Z，接纳04:15:16.835Z，原生ID仅1次接纳（01M595XWV3312YEK42QPESXSYJ），session2 raw1896、prepared1900指向1896，run1897唯一done，message.out 01M595Y5PB8AZ2NRCJ4WKP3TJR唯一成功投递，平台ID om_x100b626dd8cb48bcc04e363be2ca2a4。对上述1接纳、1raw、1prepared、1done及1成功投递执行5条断言通过。
- 通过现成受信程序 `/tmp/yonder-context-real.mjs` 重读真实来源历史：38990 UTF-8字节、2页、user/app两类参与者、原生旧输入及后续本机器人成功回复正文均在；待处理ID缺失0、平台读取无失败。实际覆盖2026-10-04T15:23:22.599Z至2026-10-19T04:15:28.746Z。背景内容保存在仅本机 `/tmp/yonder-context-real.txt`；这是平台→背景模块事实，未再提交模型或向飞书发送旧问候。
- 运行准备代码按 `yonder.prepared.target` 跳过已准备raw；背景模块不emit输入。每个新raw准备时取固定Date.now截止；如果稍后排队B已经存在平台，B会在A背景中仅标背景，B原始输入仍由pi inbox/steer负责。已消费A在B背景也仅标背景。旧prepared文本仍保留当时“本次待处理项”的历史轮措辞；目前没有证据认定其再次消费，不据此修改共享调度。
- 既有三次新session.input复制历史的Luna探查仍答问候，保留原失败；它们不能证明原生同ID重复接纳，也不能替代原生迟到/多参与者/steer验收。平台为何迟到65分钟仍未知。

## P1 已执行与保留失败

- `npx vitest run plugins/channel-feishu/test`：5文件48测试通过、0失败0跳过。协议fixture不是模型，也不冒充真实客户端验收。
- 真实平台群枚举成功，0群、has_more=false。按授权API新建专用私有验收群“Yonder P1渠道验收 2026-10-19”，chatId `oc_c75c3c6f6f9919f28c18750a3aaf96cf`，加入已核实owner测试账号。未更改生产群旁观绑定。
- 首次独立发送脚本未启动channel，前四项send返回stopped，普通卡片rawSend抛“Feishu instance is stopped”；没有向群发送任何消息。原脚本保留 `/tmp/yonder-p1-send-acceptance-failed.mjs`，不绕过private状态、不另开竞争正式bot的WS。改由主路协调现有运行实例中的真实工具发送。
- 媒体验收产物准备在 `/tmp/yonder-p1-artifacts`：实际插件README、2秒440Hz Ogg/Opus、2秒蓝色MP4+660Hz声音。图片使用安装自带skill-creator.png。未读取其他项目的个人音视频。
- 主路配置临时preset `p1-channel` 后，新增 `plugins/channel-feishu/scripts/submit-acceptance.mjs`，复用原control的sessions.open/submit；不直接调用模型、不注入飞书原生输入。资产按授权复制到正式home的 `.yonder/p1-acceptance/`。真实Luna独立task session1974 / input 01M59B9M3AXZGGAAEK5H8XAGRR / run1982，调用真实已运行channel实例的四种已有工具；终态01M59BB6YGKE7MQ3BZT5E4D9GG为done、replied=none，最终NO_REPLY，无自动重复气泡。会话已正常close；完整私有转录 `/tmp/yonder-p1-session1974.json`。

| session1974输出 | 真实插件/平台结果 |
|---|---|
| Markdown | message.out成功，om_x100b626eb8fe90b4df12fd11c5c88ae |
| 图片 | message.out成功，om_x100b626eb85098acdf0a677b0465647 |
| README文件 | message.out成功，om_x100b626eb9ddc080ddb186844968a23 |
| Ogg/Opus音频 | message.out成功，om_x100b626eb9b390b4df62bb4e1b36939 |
| MP4视频 | message.out成功，om_x100b626eb925d888de0a242d7a67d75 |
| 普通交互卡片 | channel-feishu_card成功，om_x100b626eb6803ca4de0b82a6db9ba4e；卡片包含“P1 回调验收”按钮，待客户端点击 |

真实status工具确认connected、botIdentityKnown=true、recovery complete、renderMode=markdown。以上是独立task经真实插件出站证据，不是原生飞书入站/steer证据；客户端逐项打开播放由主路串行观察，另补结果。

- 发送后对专群调用真实GET `/im/v1/messages` 失败：HTTP400 / code230027 / `need scope: im:message.group_msg`。保留该平台权限失败，不扩大应用权限。出站成功不证明群历史可读；当时群背景/恢复存在具体权限阻塞，不能套用私聊历史已通过证据。
- 用户随后明确授权补权限；主路在应用管理界面仅新增tenant `im:message.group_msg`；页面显示current changes published，未另建应用版本发布。使用全新FeishuApi实例获取新token后单次复验成功：专群历史返回11条。原权限失败保留，现群历史读取阻塞已解除；未读取或打印token。
- 主路原生发送：`P1-A`（意外仅短文本，原生ID om_x100b626eb96434b4b0e188c11107082）、完整不@ `P1-A2`（om_x100b626eb54ffcbcb05fdbe09782638）、真实@ `P1-B`（om_x100b626eb16f8488cf558868685c0fe）。平台历史三条均存在；账本此时仅B入站，event01M59BENRBHPYHSYVJ0R1EEW99 / mentioned=true / group / main绑定feishu-observer / session2017 / wake=write / busy=followup。B仅1接纳，pi中1条raw输入2024，无run.end和出站，符合旁观不唤醒；报告 `/tmp/yonder-p1-group-B-audit.json`。A/A2发送时权限/推送范围尚不同，未入账，不将它们冒充已接纳的不@旁观通过。
- 以真实B事件运行只读conversationContext：3320字节、仅1个“本次待处理项”，A/A2/B原生ID均出现，包含app/user；历史无失败。原未推送的群A/A2通过真实全参与者历史作为背景可见；私有证据 `/tmp/yonder-p1-group-context.txt`。本次只准备背景，不把B从write改成run，不提交模型。
- 权限生效后主路再次原生发送免艾特A3：原生ID om_x100b626f666458a8cfc8d6d095db300，接纳01M59C2Q50YKGWKPZSEGD9P3X5，mentioned=false，命中feishu-observer/session2017/wake=write/busy=followup。只读审计仅1接纳、pi raw2026，无run.end/出站。报告 `/tmp/yonder-p1-group-A3-audit.json`。真实群@与不@旁观均有原生接纳证据，不将旧A/A2漏推送原记录删除。
- 主路在客户端实际点击一次卡片按钮；收到WebSocket原生 `channel-feishu.card-action` 事件01M59C0170FT13WMBSN1FYDN38，关联卡片om_x100b626eb6803ca4de0b82a6db9ba4e、核实操作者acct、action.tag=button/value.acceptance=P1。三个agent均no-binding，没有自动授权或运行。卡片→真实点击→渠道回调链成立。
- 主路客户端观察回报：Markdown、普通卡片、README内容预览通过；音频2秒播放器从0:02进入0:00进度态后回到0:02。图片仅看见缩略图，未打开；视频仅见00:00缩略图，点击/双击未获得独立播放器实证。最后CUA报告user changed app，按用户验收反馈停止前台，不继续重复点击或发送。故图片打开、视频播放仍未完整验收，不能把API成功写成播放通过。

## 视频00:00的只读定位

实际本地MP4经ffprobe读取duration=2.000000。当前channel.ts上传视频使用file_type=mp4、发送msg_type=media；仅音频分支设置上传duration，视频分支没有设置，不是显式发送了duration=0。平台返回/客户端00:00与缺失上传duration相符，但尚不能证明这造成无法播放。

官方SDK 1.74.0的im.file.create类型将duration定义为可选；[官方发送文件示例](https://github.com/larksuite/oapi-sdk-python-demo/blob/main/composite_api/im/send_file.py)也明确为毫秒、选填。[上传文件接口](https://open.feishu.cn/document/server-docs/im-v1/file/create)是该元数据入口。因此省略duration在协议层允许；显示实际时长需要提供元数据，但现行附件契约没有duration字段。本轮不为未证实的播放问题增加MP4解析器、依赖或公共契约，不修改生产源码，保留视频播放未验收和00:00显示事实。

## 逐项矩阵（持续追加）

| 场景 | 当前证据 | 尚缺/边界 |
|---|---|---|
| 私聊与同main | 既有F原生/session、Luna真实run和上述迟到链 | 新版客户端完整复验 |
| 群不@、群@ | B mentioned=true、A3 false，均原生接纳→observer/session2017/write，无模型run；客户端气泡可见 | 运行型群绑定及多人组合仍未测 |
| Markdown/post | session1974真实插件message.out ok，主路客户端展示通过 | 无新增缺口 |
| 图片、文件、音频、视频 | 四项真实插件message.out ok；README预览、2秒音频播放有客户端观察 | 图片仅缩略图；视频仅00:00缩略图，实际打开/播放未验收 |
| 引用/线程、气泡穿插 | 现有协议/交互检查 | 原生多参与者实际间隙与客户端引用 |
| 四条命令 | 既有/session唯一command.result且无模型run | /help /skills /stop本轮原生复验；旁观拒绝 |
| Typing清除 | 既有真实增删和离线合并清理0；本轮48检查覆盖 | 新原生NO_REPLY/取消/错误客户端观察 |
| 普通卡片、按钮回调 | 真实card工具成功、客户端可见并点击、WebSocket card-action含操作者及原消息关联 | 模板卡片仍未测；未为无需求制造模板 |
| CardKit开始/更新/完成 | 协议与交互检查 | 真实运行API sequence/关闭及客户端观察 |
| CardKit取消/错误 | 自动检查覆盖 | 本轮真实API收尾及无重复气泡 |
| 断连恢复及原生同ID去重 | 既有真实离线双条合并及迟到单次消费 | 实际断网重连；禁止以正式服务重启冒充断网 |
| 工具间隙steer | 1903原生A/B同run2069、双inputs、一次最终投递；B在背景准备阶段接纳 | 精确工具执行中才发送B仍未通过；旧失败保留 |
| 多参与者背景 | 真实私聊和专群均含user/app；新权限后群背景A/A2/B可见 | 多个不同用户/其他bot原生输入仍待验 |

截至本节未发现需要修改飞书生产源码的已证实新根因；验收缺口保持未测，不写成全通过。

## 末轮原生steer实验（原始失败保留）

主路先后有两次验收观察脚本失败：第一回12秒A后误调用不存在的control `sessions.transcript`（实际为sessions.show），错过B；第二观察器在发送前启动45秒过期未等到A，A发出后重启正确观察器找到tool entry2049，未重发A。这些均不算steer通过。

最终原生DM实验的后台事实：

- A：原生om_x100b626f112058a8cfc20e3bb10036d，event01M59CXPEKYM32GGQGMNWXCZ55，接纳06:17:30.323Z，main/owner/session2/busy=steer。pi assistant2049调用一次bash `sleep 25; printf P1-final-boundary`；toolResult2051成功，timestamp06:18:01.122Z、duration25084ms，按工具回执推算执行开始06:17:36.038Z。
- B：原生om_x100b626f2dcedcf4ce578f097809c9c，event01M59CZ6T12EEZ9YGF0K2RT6HK，接纳06:18:19.841Z，比工具结果晚18.719秒。客户端观察“敲键盘反应仍在/2049存在”不能代替工具仍运行的原生时间证据。
- A run2045于06:18:21.802Z done，inputs仅A、replied=none；B独立run2057于06:18:29Z done，inputs仅B。唯一可见输出为B的 `P1-native-steer-ok`，message.out01M59CZKZCJ3C83ZFFCBEMMYFM，delivery.ok=true/native om_x100b626f2d07f480ddf279b3bb50b8f。没有A/B同run.inputs，不能因回复字符串写steer通过。
- 审计分别保存 `/tmp/yonder-p1-final-A-audit.json`、`/tmp/yonder-p1-final-B-audit.json`；每条原生消息各1次接纳。以上不是MCP复制输入。

本轮同时发现真实背景缺口：A原createdAt06:17:34.996Z高于准备时本机固定截止06:17:30.334Z；B原createdAt06:18:24.333Z高于准备截止06:18:21.808Z。两个prepared均页数0、`History start must not exceed end`，原输入保留但背景未读取。这是平台原时间与本机时钟差异下已证实的区间失败；不以问候语义/模型选择解释，也不擅自修改原时间或本机时钟。已报主路；下节另记1903实际修复及新原生验证，原失败保留。

## 1903安装后的原生同轮补充输入

主路在授权内以一行 `Math.max(Date.now(), ...times)` 修复固定截止，保留原发送时间；回归原1失败10通过，修复后11/11，实际4.5秒偏差重读2页无错误。主路已实际安装1903 / commit504b7fc / PID40703；本节只读核对，没有另发消息或修改代码。

- 主路在单次CUA调用连续发送A/B，两气泡3.31秒内可见。A原生om_x100b626fdaabb494cea3c1e0b6c3154，event01M59DQA9NWMSMBTSYF6ZXPGX5，接纳06:31:29.845Z；B原生om_x100b626fdab9688cb0f454f7a216301，event01M59DQBH0R1VH89510P6SN9QV，接纳06:31:31.104Z。各1接纳，main/owner/session2/busy=steer。
- A prepared2073与B prepared2080均读取2页、没有区间错误。B接纳在A背景准备阶段，早于A首个模型请求timestamp06:31:33.217Z；因此本次证明原生运行期间入队并在工具后同轮消费，不声称B在bash执行中才送达。
- assistant2075真实调用一次 `bash sleep 8; printf P1-live-boundary`，toolResult2077成功、duration8039ms，按回执推算工具从06:31:41.868Z至06:31:49.907Z。pi在工具结果后放置B raw2078、再准备B2080。
- 唯一run2069 / run.end01M59DR8WBEVHGE7ZHDXMDD8Y9于06:32:01.163Z done，inputs同时包含A/B、replied=source。唯一message.out01M59DRC6YD0EW290RS1NFE98X于06:32:04.574Z发送 `P1-live-merged`，delivery.ok=true，平台ID om_x100b626fd84c8cb4df0f589bb0fa4a6。没有B独立run或单独气泡。
- 本地reactions待清理0；真实平台分别查询A/B Typing表情均0、has_more=false。不能据此补写未观察的处理期间动画，但终结清理有实际API事实。
- 两份只读审计 `/tmp/yonder-p1-live-A-audit.json`、`/tmp/yonder-p1-live-B-audit.json`；针对各1接纳、同一唯一终态、双inputs、唯一成功投递及无B重复投递执行6条断言通过。

结论：原生A/B同一运行消费、一次最终投递、Typing终结清理已具证据；精确“工具执行间隙才发送B”场景仍没有通过证据，前次超时/错过间隙的失败全部保留。
