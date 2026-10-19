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

候选0.1.2026101806；独立安装/真实飞书主会话、命令、合并积压、客户端贴纸/条件引用仍待本轮后续实际验证，不能用源码和125项测试替代。未知离线新私聊无法从群列表枚举，仅覆盖已知私聊；平台不可见、撤回/过期/无权历史不能承诺恢复。完整TUI/媒体播放/模板/回调/真实注销登录等按原矩阵分别记录，不预先标完成。
