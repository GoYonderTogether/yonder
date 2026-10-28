# Memory store hardening 与 G0 收尾

日期：2026-10-22；仓库：`yonder-memory`，分支 `zoran/memory-plugin`。只针对合成临时目录测试；未访问真实记忆、Obsidian 库、生产服务或凭据，未 push。

## 原始要求与已核对事项

- 用户要求继续 G0 converter 评估及三项 spec gap 核对，并继续安全 store 加固：优先复用成熟持久化方案，核对跨进程写入、崩溃及恶意 symlink 边界，新增定向合成测试；禁止将 owner 字符串校验视为授权，授权须由 verified identity 推导。
- `proposals/memory/g0-report.md` 已有 markitdown 0.1.9 / docling 对比及补测记录：推荐 markitdown，docling 重量较大；中文文档转换结果已记录。此轮没有重新下载或运行转换器，沿用现有记录，不将其说成本轮复测。
- 三项规范空白的原核对结论见 G0 §1（steer 合并时 `ToolContext.event` 是首个输入）、§1（`events.on` 不保证早于运行启动）、末尾空白 1–3。对照当前 `docs/spec/15-memory.md`：前两项分别在 §5 写清首输入及确认约束、采集写入可能尚未完成；converter 的无 shell 命令/stdout/非零与超时约定在 §10。当前规范已处理这三项，按现有明确行为执行，不伪造维护者另行批准。
- 确认/授权边界：调用者字符串不构成授权。G0 中核实的插件 API 为 `identity.account(acct)?.person` 与配置 owner 比较；工具写权限还依赖 SDK `ToolContext` 能力（read/write、admin）。本次 store 锁本身不作身份授权，必须由插件工具入口完成检查。没有把 `config.owner` 的字符串格式验证当作身份认证。
- G0 明确记录的唯一文档缺项仍是 cron README 的 payload 速记漏 `kind: "event"`；runbook WP7 规定 README 示例要含完整字段。当前任务没有修改 cron 插件 README。

## Store 实现

- 复用仓库既有 `proper-lockfile@4.1.2`（已由 core 使用），未另造基于 JSONL 的锁协议，也未迁移存储格式；为同文件写入保留进程内串行队列，并对变更、追加及日志文件增加跨进程文件锁。
- 锁临界区再次做路径检查；对目标符号链接显式拒绝。RMW 仍使用 `write-file-atomic`，并保留 mtime 冲突重试，以免静默覆盖不遵守插件锁的用户编辑。
- 定向合成测试使用两个独立 Node 子进程并发追加，每进程 20 条；实际验证 40 条均保留。

## 安全边界 / 未宣称解决

- Node 路径 API 的路径检查与后续文件系统操作之间仍有 TOCTOU 窗口：若攻击者能在同一时刻改写根目录中的目录项，可尝试检查后换 symlink。`lstat` 再检查缩小窗口，但不是基于 `openat`/目录句柄的原子抗竞态保证。插件应运行于可信、私有权限的记忆根目录；要承诺抵抗同 UID 恶意并发改链，需引入平台级目录句柄实现或改变存储布局，当前不能声称已完全封闭该边界。
- `proper-lockfile` 的 stale 恢复依赖定时更新与陈旧锁判定；此次只实测双进程并发，无进程强杀/崩溃恢复实验。不得称 crash-recovery 验收通过。
- 锁仅协调使用此插件协议的写入者；不锁定 Obsidian/用户直接编辑。mtime 冲突检测是保留保护，但恶意/高频直接编辑不等同协作锁。
- `proper-lockfile` 已在 memory 工作树 package.json 中作为现有依赖记录；此次没有新增运行时依赖。package manifest/lock 当前也有其他未提交改动，见提交说明。

## 验证与交付状态

- `npm run typecheck -- --pretty false`：通过。
- `npm run build`：通过。
- `npx vitest run --maxWorkers=4 plugins/memory/test/wp2.test.ts plugins/memory/test/wp3.test.ts plugins/memory/test/wp4.test.ts plugins/memory/test/wp5.test.ts plugins/memory/test/store-hardening.test.ts`：5 files passed；26 passed / 1 skipped。额外的子进程并发测试通过。
- 完整 suite `npx vitest run --maxWorkers=4`：修正后 110 files：88 passed / 22 skipped，310 passed / 47 skipped，0 failed。首轮曾 109 files：83 passed / 4 failed，291 passed / 15 failed / 46 skipped；其失败暴露了锁代码预创建目标文件的问题。已修正锁载体位置并重跑相关 WP 与完整 suite，最终 suite 通过。
- `npm run build`：通过；`npm run typecheck -- --pretty false`：通过。`npx biome check` 对源码/测试：通过。`plugins/memory/test/wp1.test.ts`：5 passed，契约测试调用 `checkPlugin` 且断言无 errors。
- 本地 commit `41374ae`：只包含本次 `store.ts`、定向合成测试与本报告；未纳入并行工作的其它 memory 文件或其它未提交改动。无远端操作。

## 原始要求 / 已解决 / 剩余

| 项目 | 状态 |
|---|---|
| converter 与三项 spec gap | 已依据仓库 G0 报告及当前规范完成核对；本轮未重复转换实验；cron README 缺项保留 |
| 同文件跨进程并发写 | 已引入复用的文件锁并有双独立进程合成测试 |
| 崩溃/陈旧锁恢复 | 实现依赖 proper-lockfile stale 行为；未做强杀测试，剩余 |
| 恶意 symlink | 已复查路径并拒绝 symlink；同 UID 竞态替换仍是明确剩余边界 |
| owner/工具授权 | 必须由 verified identity 与 SDK capability 决定；不以 owner 字符串验证替代。此次未改工具入口授权逻辑 |
| 完整 suite、lint、checkPlugin、commit | suite / checkPlugin / 定向 lint 均已通过；完整仓库 lint 未运行；本地 commit 已完成 |

无新增必须由维护者决定的功能目标问题。唯一需要后续独立裁定的是：若产品目标要求抵御同 UID 恶意 symlink 竞态，是否接受改为平台特定的目录句柄/文件打开实现；本次只交付与现有 spec 兼容的最小补强，不声称该强保证。
