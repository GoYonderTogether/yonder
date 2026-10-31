# CH-05 主动通知交接

2026-10-28：CH-05 尚未实现主动通知汇总。X01 `proposals/agent-ux/channels-social.md` 第 12 节记录 CH-01 契约尚待维护者评审；现行 spec 和 contracts 未定义 outbound 配置、通知意图或目标权限变更的发送时重检。不能将提案字段当作已批准接口，也不能复制第二套投递账本。

现有提交 `41f398c` 停止 tasks 的不安全 user-wait 主动催答并记录 deferred；它不是通知汇总。interaction 现有测试覆盖等待中止保持 pending、会话关闭为 cancelled。旧配置的 tailDigest 仍按原语义运行，等待新模式切换契约。

后续：CH-01 明确通知意图、outbound 配置及目标权限契约后，接入现有 delivery ledger，迁移 tasks 和心跳，完成 quiet、撤权取消、重启去重、unknown 不重发及 console 可见性；补齐时长与时区格式和真实渠道验收。真实渠道未测，计时及通知零 token 路径未验收。
