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

2026-10-18 主 agent 源码审查已完成；本任务的当前评估、实现缺口及设计问题见 [第一轮源码审查](review-first-pass.md)。保持原验收状态；以下为第一轮原记录，不代表审查后全部问题已解决。

- 第一轮不执行实际安装、git tag 发布或 launchd 操作；临时双 tag 安装／升级／失败保留／回滚／版本清理和 macOS 服务 install/status/stop/start/restart/uninstall 全部保留第二轮。
- wrapper 已生成固定 node 绝对路径、安装 bin/node 目录与安装时 PATH；本轮只检查真实临时文件的 shell 语法和 plist 语法，尚未在安装后的后台 agent 中实际运行 yonder/docs/node/npm/git。
- 更新构建成功后、服务 doctor 失败时保留已构建目标目录但不切换 current；服务重启在 current 切换之后，重启失败时报告失败，未自行引入自动回滚。
- 服务管理仅实现 macOS launchd；Linux 未实现，命令给出明确原因。无指定或可推导 home 的源码 update 无法枚举所有运行 home，仅对可推导 home 的控制 socket 检查并提示手动重启。
- T11 已记录的 stop 后离线控制连接 ENOENT 问题未在本任务修复；更新的进程探测未调用该路径。


## 结果

第一轮：已实现（待验收）。本轮到 T14 停止，不代表已发布、安装或完整验收。

- `packages/core/src/release/index.ts`：version 读取 CLI 包版本（根 package.json 只存 repository）；docs 在当前源码／安装版本的 docs 目录内读取与列举，按真实路径拒绝越界；changelog 按 (from,to] 选择已发布版本，默认上一个版本。
- update 实现 semver release 标签选择、当前版本无操作、浅克隆临时目录／npm ci／build／改名、服务 home 的新版本 doctor、临时符号链接 rename 原子切换、服务重启或可推导运行 home 的手动重启提示，以及保留 3 版且保护当前／上一版。构建失败删除临时目录，未切换 current。已有完整安装版本可复用作回滚。
- 首次更新生成 bin/yonder shell wrapper，固定安装时 Node 绝对路径，PATH 包含安装 bin、Node 目录与当时 PATH；wrapper 仅保存 PATH 与 YONDER_INSTALL，不保存凭据。
- launchd 实现 install/uninstall/start/stop/restart/status，遵守 bootstrap、bootout、kickstart 和 print；plist 仅保存 PATH/YONDER_INSTALL/YONDER_HOME，日志路径为 home/.yonder/logs/harness.log；status 仅输出状态／pid，不转储环境。
- CLI 接入 version/changelog/docs/update/service，与各自 --help、--json、无需已有 home 的调用；移除帮助里的任务标签。根 repository 设为已确认的 HTTPS 地址。core/index.ts 仅增加 release 必要导出。
- 新增授权的登录展示：auth_url、device_code、info、progress 以人可读文本写 stderr，产品名为 Yonder Harness，保留原始 URL／验证码；已知依赖端口冲突提示中的其他客户端名称仅在展示层改为其他登录进程，未改 OAuth client ID、scope、URL 或 node_modules。
- 版本通知沿用 T08 已实现的固定 notice 行与会话 version 比较，更新后真实恢复及只出现一次的端到端验收留第二轮。
- 实际检查：`npm run build` 通过；`npx vitest run packages/core/src/release/release.test.ts` 为 1 文件通过、1 测试通过。检查 semver 与 changelog 解析、当前实际包版本、实际 docs 读取／越界拒绝，以及临时 wrapper 的 /bin/sh -n 和 macOS plutil -lint；未执行 wrapper、更新或服务操作。`npx biome check --write packages/core/src/release packages/cli/src/index.ts packages/core/src/index.ts package.json` 通过，无警告。
- README 与根 CHANGELOG／总表由主 agent 统一维护。准确源码入口：先 npm ci && npm run build，再 node packages/cli/dist/index.js <command>；首次安装为 node packages/cli/dist/index.js update --to <已审核的 vX.Y.Z 标签>，YONDER_INSTALL 可改安装目录，安装后将 <install>/bin 加入 PATH。

- 主 agent 最终检查：`npm run build && npm run typecheck` 通过；在无 home 的 /tmp 下运行 version/docs --list/changelog，以及开发 home 的 skills，四条 --json 输出均可 JSON.parse；version=0.1.0。`git diff --check` 通过，锁定设计文件自工序 0 后无改动。README 中的安装入口已与实际命令核对。
