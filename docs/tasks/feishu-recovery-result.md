# F 轮实施记录

依据：F0冻结ff129af、D35及用户后续追加。用户已确认状态栏菜单正常；保留R轮未测与失败事实。主agent亲自审阅接收/持久/恢复/路由/投递调用链后整合，未使用额外审核循环。

## F0–F3 源码

- Sol A：client/connection及独立检查；官方SDK唯一重连，bot/info不阻断建连；保留安全cause code/平台msg。首次4项检查失败因collector缺credentials，修fixture后4/4；泛型返回类型编译问题按官方request类型推断修复。
- Sol B：history/channel/index/protocol、工具打包声明及历史检查。安装基线、已知会话/水位、固定截止、群旧根话题扫描、64KiB输入、原生ID/事件账本恢复。主agent查出并要求修复恢复期间实时回调抢先逐条唤醒、历史源chat校验两处缺口；补回归后8/8历史检查通过。
- Sol A追加：interaction及7项协议检查，Typing、条件引用、终结清理、持久反应ID及竞态处理。主agent接入事件观察、普通/流式发送与stop，观察不等待网络反应请求以免阻塞后续消息观测。
- Luna：SDK共享CLI命令清单；当前四条命令及真实store/sessions路由检查。初始测试4失败因fixture非数值session ID，修为1后通过；后续补齐类型fixture的schema/name/SkillsReport，无unknown断言绕过。
- 主agent：core已授权绑定后的非模型命令执行（尝试/结果为真实事件，不伪造run.end、不重放已尝试命令）；自动sourceMessageId与显式replyTo分开，恢复批次取最后原始消息。真正文字出现前不开空流式卡片，不为工具片段或NO_REPLY生成可见气泡。服务日志沿用api.log，增加ISO时间，后台--json输出JSONL，无新依赖/队列/守护进程或pi补丁。

## 检查事实

- 首次整仓：33 files / 123 passed / 0 failed / 0 skipped（真实Luna/Sol与launchd）。后续增加跨渠道同主会话、旁观隔离及普通/流式呈现回归并修接线后，最终整仓33 files / 125 passed / 0 failed / 0 skipped；/tmp/yonder-f-full-tests.log。未用mock模型。
- build/typecheck通过。整仓lint为0 errors / 55 warnings / 1 info，/tmp/yonder-f-lint.log；未禁用规则/放松断言。后续仅后台plist加--json，原生launchd/生成plist聚焦2/2通过，保留原断言。
- 真实生产API前置：群列表成功（当前0群）、历史分页成功（has_more=true）；对获准历史验收消息添加Typing再删除均成功。仅证明API能力，不代替模型/客户端交互验收。结果/tmp/yonder-f-platform-check.json，无secret或原文日志。

## 配置与安装待验收

用户批准的生产配置已按原生CLI关联已核实飞书账号到person:owner。main/owner与CLI共用，busy=steer；其他群/私聊readonly persistent、wake=write/reply=none，移除生产channel的旧指定chat接收白名单。旧profile及session1748历史保留，不升级旧会话。原operator/maintainer权限和发布白名单不改。配置文件先备份，doctor通过；身份同时记录原生identity.link事实，不仅修改YAML期待已存在person被重建。

候选0.1.2026101807；独立安装/真实飞书主会话、命令、合并积压、客户端贴纸/条件引用仍待本轮后续实际验证，不能用源码和125项测试替代。未知离线新私聊无法从群列表枚举，仅覆盖已知私聊；平台不可见、撤回/过期/无权历史不能承诺恢复。完整TUI/媒体播放/模板/回调/真实注销登录等按原矩阵分别记录，不预先标完成。

打包记录：候选06提交时漏纳入其余官方插件的版本清单，发行前检查发现；06仅有源码tag，未安装/未创建正式Release。保留该tag不移动，07统一所有workspace清单和锁文件；没有改产品功能或放宽检查。

## F5 独立安装现场（继续）

07已从GitHub tag干净独立安装，实际PID6400/ready=true、commit99891a1、home一致。Yonder自己status确认connected/botIdentityKnown=true、history complete/covered1/count0。真实/session事件01M595279MMZQJY90YM1YX1ZMF通过feishu-owner命中session2，command.result 01M5952AXCXQ2RSG1H7FDC5T0X/status done/delivery ok/原生消息om_x100b626d13e670a0ddeec1496c8468e。命令未调用模型；主人正常输入随后真实Luna run1871也在session2完成。CUA session1820实际发送/session，后续观察未及时看到回复；另次复用app变量失败app is not defined（工具环境按run重建），如实停止，未反复按Return。API送达不能代替截图通过。

现场发现升级间隙03:58:19的原生用户消息om_x100b626d1b79f130b4bda5e491ec655存在平台历史却未入账。根因是07首次创建history.json时错误给已有账本会话采用当前baseline，且把complete水位推进到消息之后。用户后续新输入已正常处理；旧消息不能被假装不存在。Sol补迁移回归先1失败9通过，修复后10/10；旧安装按最后已完成原始时间续接、已有正确水位/全新安装规则保留。恢复正文追加真实原发送时间/ID/引用，避免晚到历史在上下文里冒充新发送。条件引用同时观察历史中已seen的较新用户气泡。

另确认已有服务plist不会因普通update重写ProgramArguments，故07运行仍旧普通日志；新安装模板--json已实现，当前服务将用原service install刷新，不宣称旧plist已迁移。SDK EventDispatcher默认console已接入同一安全logger。上述均为本轮真实现场缺口修复，不新增补丁/恢复平台。新候选1901统一全workspace版本。

1901最终整仓：33文件/129测试通过、0失败0跳过，含真实模型/launchd；build/typecheck通过，lint0错误/55warnings/1info。后续安装接线用既有manageService install替代仅kickstart，更新时刷新原生plist和状态栏模板，避免旧服务永远保留无JSON参数；不创建迁移器或第二服务管理器。对应原生launchd聚焦检查及实际新安装另记。
