# 下一阶段实施任务

**状态：待审核，尚未开工。** 全部目标和功能固定在 [10](../../spec/10-local-maintenance.md)、[11](../../spec/11-official-plugins.md)。这里不定义功能。原 T00–T14 保留，N 任务引用其原验收，不能用新编号清掉历史失败或跳过。

参考更新和本机只读状态见 [reference-sources.md](reference-sources.md)。它记录证据，不新增需求。

## 任务清单

- ⚪ [N00](N00-contracts.md) 设计锁定与旧规范对齐｜Codex｜无依赖。
- ⚪ [N01](N01-runtime-foundation.md) 配置一致性与运行终止｜Codex｜N00。
- ⚪ [N02](N02-mcp.md) MCP 控制插件｜Codex｜N01。
- ⚪ [N03](N03-install-agents.md) 独立安装、常驻服务、两个真实 agent｜Codex｜N02。
- ⚪ [N04](N04-first-repair.md) Luna 完成首个真实修复｜Yonder，Codex 审查｜N03。
- ⚪ [N05](N05-recovery.md) 持久输入、运行恢复和投递归属｜Yonder，Codex 主持架构｜N04。
- ⚪ [N06](N06-codex-tools.md) Computer Use 与 hosted search 本机连接｜Codex 连接，Yonder 插件实现｜N05。
- ⚪ [N07](N07-browser.md) BrowserSkill 默认插件与安装引导｜Yonder｜N06。
- ⚪ [N08](N08-coding-web.md) grep/Bash、Tavily、Web Fetch｜Yonder｜N07。
- ⚪ [N09](N09-sol-tests.md) Sol 接入、补测试与原契约缺陷修复｜Yonder｜N08。
- ⚪ [N10](N10-github.md) issue→设计→commit→PR→Codex 合并｜Yonder｜N09。
- ⚪ [N11](N11-release-update.md) 发布事件与 operator 安装更新｜Yonder｜N10。
- ⚪ [N12](N12-feishu.md) 飞书完整渠道开发｜Yonder｜N11。
- ⚪ [N13](N13-feishu-live.md) Computer Use 验证真实飞书矩阵｜Yonder 执行，Codex 观察｜N12。
- ⚪ [N14](N14-acceptance.md) 整条自维护链与全部剩余验收｜Yonder + Codex｜N13。

## 执行与检查

1. 用户审核 10/11 和本清单后，N00 记录冻结 commit；后续实现者不能修改功能规范。
2. 每项读取其功能依据、现有源码、相关调用者与失败路径，再实现；涉及参考项目时记录固定 commit/模块。
3. Codex 经 MCP 下发允许路径和验收；Yonder 的事件、会话、转录、模型、diff、commit、PR 形成任务证据。没有这条证据链的部分归实际执行者。
4. 不同包的独立阅读与检查可并行；跨 SDK/core 或同路径修改顺序执行。默认不另开 Codex 子 agent 实现任务。
5. 相关检查通过后结束该任务；全套原验收集中由 N09 实现检查、N14 完成执行，不每步重复全仓审查。
6. 发现问题立即写当前任务“问题”；实现缺陷按冻结契约修，设计变更交用户审核。Yonder 阻塞由 Codex 介入，并如实记录。
7. 一个任务一个提交边界；涉及旧 T 任务修复时保持按原领域拆提交。当前 PR 由 Codex 审核合并，发布/更新按已批任务范围执行。

## 任务记录格式

每项已列负责人、依赖、规范、允许路径和验证入口。实现结束追加：变化、实际命令/结果、event/session/model/commit/PR、未完成项。原始失败和跳过计数不删除。
