# N07 BrowserSkill 默认插件与就绪引导

**状态**：已批准，待实施；先完成 N00 对齐与冻结。

**负责人**：Yonder maintainer；Codex 检查安装与权限阻塞。

**依赖**：N03。未连接时可用系统打开 URL 引导，不要求先通过 N06。

**功能依据**：11 §4。完整条款见 [10](../../spec/10-local-maintenance.md)、[11](../../spec/11-official-plugins.md)，本任务不定义新功能。

## 允许路径

- plugins/browser-skill/
- 根 workspace/锁文件接线、THIRD_PARTY_NOTICES.md
- 安装 home 的默认插件/profile/skill 选择
- 本任务 BrowserSkill 会话与获准引导，不变更无关浏览器设置

本任务文件、任务总表和必要 CHANGELOG 记录可更新；冻结功能文档仅 N00 的设计方可按批准修改。

## 实现安排

移植上游适配单元，接实际 bsk；实现 readiness、服务启动和扩展连接引导，使 BrowserSkill 成为默认浏览器能力。按 10 §2.1 安装并启用后再做 Yonder 真实调用。

## 验证与交付

真实诊断→必要服务启动→用户扩展连接→Agent Window 导航/观察/交互/截图→释放；记录未连接分支，不卸载已有扩展制造场景。

记录实际命令、event/session/model、commit/PR 与失败/跳过；Yonder 和 Codex 的贡献分开归属。

## 问题

待实现时记录。当前没有运行通过的声明。

## 结果

尚未开始。

