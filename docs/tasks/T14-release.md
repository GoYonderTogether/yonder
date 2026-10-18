# T14 安装、更新、服务与版本通知

**依据**：`docs/spec/09-cli-release.md`（全文）、`docs/spec/02-sessions.md`（会话的 `version`）、`docs/spec/03-agents.md`（`notice` 行）

**路径**：`packages/cli/`、`packages/core/src/release/`、根目录 `CHANGELOG.md`、根 `package.json`（`repository` 字段）、`README.md`、`README.zh-CN.md`

**必须**
- 09 §2 表中任务列为 T14 的命令：`version`、`changelog`、`docs`、`update`、`service`。
- `update`：严格按 09 §4 的七步，包括失败时不切换、保留 3 个版本、首次安装创建安装目录与 `bin/yonder`（写入安装时的 node 绝对路径）。
- `service`：09 §6 的 launchd 实现。
- 版本通知：确认 T08 已按 09 §4.1 生成 `notice` 行；本任务补上更新后的端到端测试。
- 整理 `CHANGELOG.md` 的 `## [Unreleased]`；根 `package.json` 加 `repository`（`https://github.com/zoran-xc/yonder-harness`）；两份 README 写明安装、初始化、登录、运行、更新和插件开发入口，不把第一轮实现称为完整验收。

**禁止**：在真实仓库上创建或推送标签；修改用户已有的 launchd 服务以外的系统设置。

**验收**
- 用一个临时 git 仓库（从本仓库克隆，在其中打两个本地标签）作 `--repo`，在临时安装目录里：首次安装、更新到第二个标签、`current` 切换、构建失败时不切换、保留数量、回滚。
- 版本通知：更新后某会话的下一次输入 `<turn>` 里有且只有一次 `notice` 行；`yonder changelog --from --to` 输出对应各节。
- `service install/status/restart/uninstall` 在本机手动跑一遍（用开发用 home，结束后卸载），记录在"结果"里。

## 问题

（无）
