# CH-01 社交增量契约交接

本卡落位社交设计契约及可选 SDK、配置 schema 和部分静态校验；不运行社交渠道，不代表 CH-01 全部验收通过。旧配置和旧 Channel 不需要新增字段，未配置 social 时保留原行为。具体回归和 golden 结果以本卡提交报告为准。

后续仍需完成并验证：

- 动态 identity store 中 person 的存在性及动态 peer 引用存在性尚未校验；为避免拒绝真实动态身份，已移除静态 person 存在性误判。仍需覆盖无效引用、同级冲突及重载失败保留旧配置。
- `social.enabled` 时已校验 outbound target 是否属于 Agent defaults/defaultProfile 的 channelInstances，并有单测；其他 profile 的范围及实际运行尚未验证。仍需贯通 outbound 的 Agent 作用域并验证旧 home 与新初始化行为。
- CH-06 接入真实控制面 `social.inspect` / `social.update`，贯通现有错误码和可选错误详情，更新 registry/protocol golden；SDK `social.resume` 与插件运行实现同样待接线。
- 实现并验证实际 social 路由、批次、通知和渠道适配，检查事件、运行与投递关联；真实渠道尚未测试，不能把静态类型或 schema 检查作为平台验收。
