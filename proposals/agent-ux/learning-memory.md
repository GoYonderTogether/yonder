# O49：学习与记忆

## 依据与边界

主人要求复刻 Hermes Agent 的学习和记忆。这里的学习是将经验整理为可复用的记忆或技能，并非训练模型。以下是方案和第一步范围，不代表已完成的运行验收。

## 参考

- [Hermes persistent memory](https://hermes-agent.nousresearch.com/docs/user-guide/features/memory/)：分别维护有预算的 `MEMORY.md` 和 `USER.md`，会话开始注入快照；模型通过工具维护，后台复盘也可提出记忆或技能变更。
- [Hermes skills](https://github.com/NousResearch/hermes-agent/blob/main/website/docs/user-guide/features/skills.md)：技能先发现名称和描述，相关时加载正文；模型可通过工具创建、修改技能。
- [Hermes curator](https://hermes-agent.nousresearch.com/docs/user-guide/features/curator)：对 agent 创建的技能按使用情况标记、归档，归档可恢复；不自动删除，默认不管理 Hub 安装技能。
- [pi-hermes-memory](https://github.com/chandra447/pi-hermes-memory) 是第三方 Pi 扩展，不是 Pi 本体或 Hermes 官方包：提供 Markdown 与 SQLite 检索、后台 review 和技能管理；默认按需检索而非注入全部记忆。后台 review 与技能管理的策略不等同于 Hermes 本体。
- npm 还存在 `@youkale/pi-hermes-memory`、`@monkey-harness/pi-hermes-memory` 和 `pi-hermes-memory-trilium`；它们是不同包或扩展，不能假定与上游功能一致。调研未安装或运行这些包。

## Yonder 现状与方向

- 保留 `plugins/learning` 的授权 scope、精选记忆、原生技能索引、后台受限 review、抢占撤权及 pending；保留 `plugins/memory` 的个人资料库采集、检索和整理职责，不合并数据或自动导入个人资料。
- 借鉴 Hermes 的会话后反思、记忆和技能分别沉淀、技能按描述发现并按需加载；已有原生能力优先复用，不引入第二套运行时或 SQLite 索引。
- 默认包加载和 profile 选入不等于获权：没有 scope 时不能读取或学习。只有明确配置的 Agent/profile 和目录才可读；写入还要求 `exclusive-yonder`，技能学习要求 `learning: true` 与指定技能目录。不得自动扩大到主人个人资料。
- 状态应区分未加载、未选入、未配置 scope、只读、可学习，以及待处理提案和最近复盘结果；不能仅展示“已安装”。状态展示应基于实际权限和运行事实，不推断成功。

## 第一闭环与后续

第一步在已有授权范围内完成结束后复盘、持久化经验或技能，后续相关任务通过现有记忆注入或原生技能发现/读取召回；无可保存内容时允许不写入。复盘是模型工作，可能失败，不能把触发视为成功沉淀。测试应覆盖跨会话、取消与授权边界，并以隔离 HOME 和真实模型验证。

后续：完善可见状态及失败原因；评估按需检索和技能整理、归档恢复；验证长期质量、成本和多渠道行为。这些不应改变现有权限或默默迁移用户数据。
