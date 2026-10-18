# 本机自维护与官方插件实施计划（合并版）

**状态：待用户审核。** 本轮合并 MCP、自维护、真实安装、版本管理、BrowserSkill、Computer Use、grep/Bash/Web、Tavily、GitHub 与飞书全部要求。正式任务目录见 [next/README.md](next/README.md)。

功能仅以 [10 本机运行与项目自维护](../spec/10-local-maintenance.md) 和 [11 官方插件与常规工具](../spec/11-official-plugins.md) 为准；批准后记录冻结 commit。plan 和任务只安排实现，不另写一份功能规格。

## 执行顺序与交付

1. **N00–N01｜设计锁定、基础运行。** Codex 完成规格对齐、运行配置固定与终止边界修复。
2. **N02–N03｜MCP、真实安装。** Codex 接通控制入口、安装版与 maintainer/operator，验证 Luna 的真实运行。
3. **N04–N05｜第一次自主修复、运行恢复。** Yonder 通过 MCP 执行，Codex 审查和介入阻塞。
4. **N06–N08｜桌面、浏览器、检索与 Web。** Codex 先解决本机连接；Yonder 完成插件和工具适配，分别跑通 hosted search 与 Tavily。
5. **N09–N11｜Sol 测试、GitHub、发布更新。** Yonder 执行，Codex 审查合并；验证安装版更新。
6. **N12–N13｜飞书开发与客户端验收。** Yonder 读上游、出方案、实现；Codex 审查并通过 Computer Use 验证真实飞书。
7. **N14｜整条链收尾。** 从真实安装版完成 issue→修复→PR→Codex 合并→发布→更新，完成剩余 T12 与常规任务验收。

## 实现方式

- 官方插件采用主仓库独立 workspace 包，接口只经 SDK；同一次任务允许修改自身包、必要构建清单、该任务检查与记录。
- N02 之前由 Codex 建基础；N03 以后大多数源码工作交给真实 Yonder。Codex 子 agent 的工作不算 Yonder 自主实现。
- 同一源码路径只有一个写入者。无冲突的纯阅读和检查可并行；不为并行增加调度平台。
- 按任务提交，实际验证写回对应结果；Codex 当前负责 PR 审查与合并。普通实现选择沿用已批授权，实质改变功能再提交精确文档变更。
- 已安装版本、运行 home 和开发源码分开；正式安装路径的操作属于 N03/N11/N14，不能以开发目录运行代替。
- 使用最新参考材料前更新仓库，再固定实际 commit；上游变化不自动修改已经冻结的功能。

## 当前进度

- 🟢 第一轮源码审查与局部修复已有记录，见 [审查报告](review-first-pass.md)。
- 🟢 本轮功能草案、N00–N14 实施计划已合并。
- 🟢 参考仓库已更新并记录固定快照；[来源与本机探测](next/reference-sources.md) 明确区分已读、待核验与未运行。
- ⚪ N00–N14 尚未开始实现；真实安装、新增插件、GitHub/飞书授权与部署未执行。
