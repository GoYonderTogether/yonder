# 共享 Bot 定义来源：阶段 4 验证

本页保留当时的命令、原始计数、失败原因与真实短摘录；原始日志与机器转储已按最终清理要求移除。

日期：2026-11-02。阶段 3 提交为 `da8595fc`；本记录对应阶段 4 待提交改动，不代表完整重构或云端运行验收。

## 实现与边界

- `@yonder/bot-definition/source` 的 BotSource 复用 WorkspaceFiles，提供 home、工作区、模板与 skill 来源。公共加载、preset 和子 Agent Markdown 遍历使用同一解析器。
- 本机初始加载、工作区 scaffold、配置候选/状态/热重载、模板展开/列表和 skill 发现/读取实际接入 fs 来源，保留原有旧函数入口和远程 workspace 处理。
- `@yonder/cloud-host` 的 PostgreSQL 来源使用共享 Pool。`bot_files` 主键为 `(tenant_id, bot_id, path)`，查询始终带同一租户与 Bot 范围；WorkspaceFiles 为虚拟目录视图，禁止相对和绝对路径越界。关闭来源不关闭共享 Pool。
- 实际人格正文取已有 `plugins/agent-presets/prompts/default-agent/SOUL.md`、`AGENTS.md`，没有另写人设。PG 与 fs 来源的同一 agent.yaml/人格文件通过同一 systemPromptParts，结果逐段逐字相同。
- 本阶段仍保留本机兼容入口的 fs 依赖；宿主无关包边界与运行状态 PG 属于后续阶段，不能据此声称 A1、A3 或 worker 已完成。

## 已执行检查

| 检查 | 实际结果 | 当时输出摘录 |
|---|---|---|
| `npm install --ignore-scripts --package-lock-only --offline` | 成功；pg、@types/pg 均精确 8.23.1，使用已有缓存 | 摘录：up to date, audited 620 packages in 2s |
| `npm install --ignore-scripts --offline` | 成功，新增 16 个包，审计 0 vulnerabilities | 摘录：added 16 packages, and audited 620 packages in 851ms |
| 首次 `tsc -b --force`（接线尚在并行落盘） | 失败，13 个诊断：尚未落盘的 FS 来源/函数末参/source 类型，以及旧 WorkspaceFiles 导入；随后补齐 | 摘录：packages/cloud-host/src/source.test.ts(91,60): error TS2353: Object literal may only specify known properties, and 'source' does not exist in type 'CreateSkillsOptions'. |
| 接线完成后 `tsc -b --force` | 成功 | 无诊断输出；结果见本行 |
| 最终 `npm run typecheck` | 退出 0 | 摘录：> tsc -b --force |
| 定向 Vitest：cloud-host source、core config、templates、adversarial-template、skills、config-watch | 17 个文件通过；76 通过 / 0 失败 / 0 跳过；17.09 秒 | 摘录：Test Files  17 passed (17) / Tests  76 passed (76) |
| 最终相关路径 Biome | 退出 0，65 个文件，无修改，20 warnings | 摘录：Checked 65 files in 128ms. No fixes applied. / Found 20 warnings. |
| 文件大小检查（中间态） | 首次失败：kernel/index.ts 506 行；将来源初始化放到已有 config-sources 模块后解决 | 摘录：→ 拆分到 500 行以内；确需保留则登记到 scripts/file-size-baseline.json 并写明待拆理由 |
| 最终 `check-file-size.mjs` | 成功，573 个文件，基线 0；kernel/index.ts 498 行 | 命令输出 |
| 最终 `check-layers.mjs` | 成功，260 个文件，无上行依赖 | 命令输出 |
| `git diff --check` | 成功 | 命令输出 |

## 真实 PostgreSQL 证据

`packages/cloud-host/src/source.test.ts` 的 4 项测试均使用本机 PostgreSQL 17 真实进程与连接，未使用数据库 mock：

1. fs/PG 共用解析和 systemPromptParts，包含两个真实默认人格模板，输出完全一致。
2. 不同 tenant、不同 Bot 看不到另一范围的定义；工作区越界读写被拒绝；列举只返回当前目录。
3. PG preset、Markdown 子 Agent、模板展开/列表、skill 索引/读取与 skill 路径边界。
4. PG 配置热重载与 parse 失败前原文回调、失败回调。

测试结束关闭 Pool 和 PostgreSQL、删除临时目录；随后进程检查未见测试 PG 残留。未启动 Redis；本阶段来源测试不需要 Redis。未调用真实模型、启动 worker、连接云端 server、推送、部署或执行桌面操作。完整 build/test/lint gate 由主 Agent 在阶段提交前执行，本记录不代替完整 gate。
