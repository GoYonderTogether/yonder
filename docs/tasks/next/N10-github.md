# N10 GitHub issue 到 PR 与 Codex 合并

**状态**：已批准，待实施；先完成 N00 对齐与冻结。

**负责人**：Yonder maintainer 开发；Codex 授权接线、发 issue、审查合并。

**依赖**：N09。

**功能依据**：10 §1/5；11 §6。完整条款见 [10](../../spec/10-local-maintenance.md)、[11](../../spec/11-official-plugins.md)，本任务不定义新功能。

## 允许路径

- plugins/channel-github/
- 根 workspace/锁文件接线、THIRD_PARTY_NOTICES.md
- 安装 home 的 GitHub 实例和 maintainer 绑定
- 本项目任务分支、实际 issue/PR；不操作无关仓库

本任务文件、任务总表和必要 CHANGELOG 记录可更新；冻结功能文档仅 N00 的设计方可按批准修改。

## 实现安排

Yonder 开发 GitHub 插件，经用户浏览器授权，按 10 §2.1 安装启用后接真实 issue；完成一项真实维修和 PR，Codex 亲自审核后合并。浏览器授权可用 gh/系统打开 URL，不依赖 N06/N07。

## 验证与交付

保存 issue URL→输入事件→会话→方案→commit→检查→PR→Codex 审查/合并；去重、重启游标和自身评论不循环。

记录实际命令、event/session/model、commit/PR 与失败/跳过；Yonder 和 Codex 的贡献分开归属。

## 问题

待实现时记录。当前没有运行通过的声明。

## 结果

尚未开始。


### C4 源码交付（2026-10-18，Codex Sol）

- 新增独立 SDK 包 channel-github：gh REST 客户端、分页 issue/comments、显式仓库/账号/标签接纳、按 issue 的 persistent conv、原生 id/水位原子持久化、自己状态评论/PR-as-issue 防循环。
- 工具完整提供缓存状态、issue/全部评论、方案进度评论、仓库/分支资料、创建/复用 PR、PR 文件 diff/提交/检查/statuses。git 继续使用原执行环境，Codex 负责合并；无自动 push/merge/publish。
- 固定并阅读参考：OpenClaw cafa09e 的 scripts/pr-lib/github.mjs；Hermes 6660547 的 hermes_cli/github_api.py；OpenCode 2fa3363 的 cli/cmd/github.ts、github.handler.ts 入口/权限/issue-PR/评论与 PR 创建流程。参考边界、具体配置和维护操作见插件 README。
- 状态：实现未验收。没有新测试，没有修改/运行旧测试，没有网络/授权/发送/推送。工作树缺 node_modules/.bin/tsc，尚未构建；包的根 workspace/lock/项目引用由主 agent 统一接线。
- C1 主 agent 已确认：type+渠道实例 conv+data.msgId 统一原生接纳去重；本插件不另建队列或扫描核心私有数据库。

- 源码接收后补充：轮询水位取 GitHub 对象的真实 updated_at 并保留边界重叠，不取可能漂移的本机时间；稳定 msgId 继续由核心去重。此为实现修正，未做实际网络调用。
