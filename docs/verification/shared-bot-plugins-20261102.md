# 插件私有存储与统一 tick：阶段 6 验证

本页保留当时的命令、原始计数、失败原因与真实短摘录；原始日志与机器转储已按最终清理要求移除。

2026-11-02，阶段 5 提交 e352e4e6。本阶段完成SDK能力与本机接线、真实PG后端及官方插件迁移；worker组合、inactive Bot的PG定时唤醒与资源预算留阶段8，不据此宣称云端已运行。

## 实现与数据保护

- PluginStorage.open(root?) 返回 PluginFiles；默认沿用原 api.paths.data，FS根与PG的tenant/Bot/plugin/root均固定绑定。接口支持read/write/append/list/stat/mkdir/remove/transaction，只有FS给localRoot。SDK纯入口只导出类型，Node实现是独立子路径。PG plugin_files复合键与查询隔离全部范围。
- FS保留原文件名/格式、Windows原子替换重试及锁。tasks事件与派生投影的多文件提交使用命名空间undo journal；失败或残留journal恢复旧值，若发现之后的用户编辑则保留并报告冲突，不覆盖用户内容。没有通用恢复平台。
- memory保留本机config.root、rg与原有inbox watcher；共享读写、日志、清单、检索与虚拟文本inbox使用文件能力。没有环境的转换/微信采集明确不可用，不启动云端子进程。
- tasks首次真实调用只读导入旧tasks.sqlite完整事件，经过replay校验后同事务写入历史与标记，保留旧库。正常读取独立projection.json；get只读目标任务history，写入增量applyEvent，不每次重放全历史。rebuild/backfill以导入后新增的history优先，不拿旧SQLite截断新事件。
- TriggerIO增加真实宿主startedAt与schedule(at|undefined)，Trigger可实现tick(now)。cron、market、tasks moments、memory周期工作与card映射同步由一个宿主scheduler调度；保留真实资源触发器生命周期。scheduler停止先通知trigger取消活跃工作，再等待其完成。
- setup与storage.open不创建数据或迁移写入；迁移/初始化在start或真实调用。没有操作主人实际记忆库或SQLite，所有验证只用临时目录。

## 原始检查记录

所有数字是独立检查，存在重叠，不可相加。下表保留开发期实际计数与输出摘录。

| 检查 | 原始结果 | 证据 |
|---|---|---|
| 开发typecheck首两轮 | 3个TS诊断；随后1个TS诊断；均已修复 | 摘录：> tsc -b --force |
| 定向首轮 | 文件32通过/6失败/1跳过；151通过/7失败/6跳过 | 摘录：Test Files  6 failed \| 32 passed \| 1 skipped (39) / Tests  7 failed \| 151 passed \| 6 skipped (164) |
| 定向第二轮 | 文件36通过/2失败/1跳过；156通过/2失败/6跳过 | 摘录：Test Files  2 failed \| 36 passed \| 1 skipped (39) / Tests  2 failed \| 156 passed \| 6 skipped (164) |
| FS/PG/memory/生命周期独立集合 | 55通过/0失败/2跳过，15文件通过 | 摘录：Test Files  15 passed (15) / Tests  55 passed \| 2 skipped (57) |
| 真实旧SQLite导入与原子保护 | 10通过/0失败/0跳过，2文件 | 摘录：Test Files  2 passed (2) / Tests  10 passed (10) |
| 最终阶段定向合集 | 文件40通过/1失败/1跳过；176通过/1失败/6跳过 | 摘录：Test Files  1 failed \| 40 passed \| 1 skipped (42) / Tests  1 failed \| 176 passed \| 6 skipped (183) |
| 唯一失败修正后该文件重跑 | 7通过/0失败/1跳过；其余已过集复用 | 摘录：Test Files  1 passed (1) / Tests  7 passed \| 1 skipped (8) |
| 最终typecheck/Biome/size/layers/diff | 通过；定向Biome155文件234warnings/5infos；size589、layers271，无违规 | 相关退出码与扫描计数见本行 |
| root完整build/typecheck/lint | 均退出0 | 摘录：Found 1273 warnings. / Found 33 infos. |
| root完整默认测试 | 2686通过/0失败/112跳过；500文件通过/0失败/67跳过；117.19秒 | 摘录：Test Files  500 passed \| 67 skipped (567) / Tests  2686 passed \| 112 skipped (2798) |

定向开发失败包括memory接口夹具/路径适配、旧SQL新数组与ledger内部数组可变性差异；历史返回副本修复共享根因。review发现tasks测试移植曾缩减仍适用的断言，已恢复原tasks6项、constraints4项和projection原5项及回滚检查，保留done证据、身份边界、多次render/重开、contract/lightweight、批次原子性及正常读不扫历史/无N+1。cron已迁移的低层原子替换断言归SDK/node-storage.test，未删除对应保护。

最后唯一失败是user-wait moment结果已落账后，异步prompt渲染可再追加真实wake。按真实顺序精确选择该moment最后一条moment-result，完整核对真实session.input.id/session，保留3条输入、无message.out及不重复投递断言；没有伪造或重排生产事件。

## 验收范围

真实PG覆盖插件/tenant/Bot/root隔离、并发事务与失败回滚、官方memory的虚拟读写和检索。真实旧SQLite覆盖完整历史导入、重开/续号、失败不留marker或history、导入后追加再丢投影并两次重开。FS覆盖用户后续编辑冲突保护、journal恢复、Windows替换失败保留旧receipt、并发读取与临时文件清理；这些是临时文件/故障注入验证，不冒称生产崩溃验收。全部临时PG/Pool关闭。

没有运行真实模型、worker、云端端到端、生产、部署、push或桌面操作。112个默认跳过不算通过；完整gate相对固定基线没有新增失败。A5插件存储层已有证据，完整多租户worker和A12仍待阶段8。
