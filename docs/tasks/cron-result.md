# X1 cron 结果

状态：源码已实现，待主路整合运行验收。范围仅 plugins/cron/** 与本文件，无提交/切分支/推送。

## 实现

- 独立SDK插件，`cron_manage` / `cron_exec` 与 cron trigger；服务启动恢复，停止清timer并取消自有命令/隔离preset。事件交给既有绑定；event Agent运行归kernel管理，停服取消等待并记interrupted。
- cron-parser 5.4.0解析5/6字段、IANA时区/DST；at、every锚点、起止窗口、有限运行次数、启停/CRUD/立即运行/历史。同job不重叠、并发限制，容量释放再调度；过期合并一次或skip，不重放不确定副作用。
- jobs.json与runs/*.json原子替换；开始运行前持久记录并推进next，重启中断记录标interrupted。调度、运行与投递失败分别保留；失败输出同样尝试明确目标投递。
- 原始事件from固定plugin:cron，type限cron.*、target明确conv，需用户配置binding决定是否唤醒Agent，不保证仅目标Agent响应。禁止伪造message.in/admin等内核事件。preset使用真实submit RunResult与附件；command/script经共享execution.run使用创建者真实env，未import pi或假定本机。
- job归创建者Agent；独立preset创建者agent=null时归session。保存owner身份与capabilities而非整个ctx；每次运行resolve当前配置并取创建时能力交集。命令/脚本仅cron_exec可创建/修改/立即运行；投递另需message，撤销后失败。

## 依赖与共享接线

插件package已精确声明cron-parser 5.4.0、typebox 1.3.27与现有SDK版本。主路负责workspace/根lock/build引用与发行包含。共享API由主路实现：`execution.resolve(owner)`、`execution.run({owner,capabilities,command,cwd?,signal?})`。

## 实际检查

2026-10-19 `vitest run plugins/cron/src`：2文件、4测试通过，0失败/跳过。没有模型调用。

- 真实cron-parser：5/6字段、范围/列表/步长、纽约DST周末后UTC时刻改变、every锚点与窗口、at、非法时区/模糊时间。
- 真实临时文件系统与Node子进程：stdout真实完成、输出投递到文件、持久作业/历史、同job重叠拒绝、独立preset owner隔离、低权限管理工具不能run命令、执行权限撤销失败与失败投递、实际长子进程在stop后中断并持久记interrupted。
- 使用插件调度器事件适配测试：真实文件记录cron事件、from/conv、停服错过at后skip和coalesce、maxRuns关闭。此处事件/投递适配器为文件系统验收适配，不是实际kernel绑定或飞书渠道证据。

局部Biome已运行；TypeScript首次出现插件exactOptionalPropertyTypes错误已修。共享SDK适配完成后，`tsc -b plugins/cron`实际通过；主路仍需整仓build/typecheck。

## 未测与问题

- 未测：真实模型preset结果与真实Agent绑定运行、飞书渠道成功/失败投递、真实kernel执行环境重解析与权限撤销、远程环境、真实内核运行中停服的进程树清理、真正系统重启/DST实时时钟跳变。不能用当前测试替代这些证据。
- 不支持macOS休眠/关机期间执行。服务事件运行交给kernel，插件只取消等待，不另造路由/运行核心。
- 历史保存在插件data，不自动删除；运行中除disable外禁止修改/删除。更新可修改已声明字段，用null清空可选delivery/start/end/maxRuns。

## 复审修复：profile归属与有界历史（2026-10-19）

- Agent作业权限原先只比agent；现在同时匹配agent/profile，避免同Agent低权限profile启动/启用高权限profile作业。独立preset仍按原session归属。未新增admin特权或暗授exec。
- history顺序读取每条记录，仅保留最近limit条；排序临时数组最多limit+1条，不把全部历史完整output留在内存。仍用原runs文件，无新存储。按limit返回最新记录，最多100条。
- 先加回归后原实现真实失败：scheduler测试1通过1失败，低profile enable意外成功。修权限后，临时恢复旧history聚合实现验证另一回归：1通过1失败，实际同时排序7条，超过limit2对应上限3；测试结束已恢复修复版。
- 修复版聚焦：2文件5测试通过，0失败/跳过；覆盖低profile enable/run/list拒绝、同profile不同session允许、7条真实持久历史返回最新2条/1条、聚合暂存最多limit+1。
- `tsc -b plugins/cron --pretty false`通过；局部Biome通过。没有修改后台生产实现或重跑background测试。

## raw event admin门槛测试对齐（2026-10-19）

主路新增raw event必须admin，防止普通调用方通过任意Agent既有binding提升权限。冻结后本分路仅更新scheduler测试与本文，未改生产实现。

- 主路真实旧测试结果 `/tmp/yonder1907-cron-final.log`：3通过/2失败；两项失败为旧事件创建调用方未带admin。
- 只为实际创建raw event的调用角色提供admin：第一测试完成exec撤销检查后，才将该事件创建者切到read/write/message/admin；command阶段及后续long-process角色不因此获得admin。第二测试owner profile具有admin，lower profile仅read/write；execution.resolve适配按真实job owner身份/profile返回对应角色能力。
- 新增read+write且无admin创建raw event必须失败、无残留作业断言。原低profile无法run/enable高profile作业、历史有界回归保留。
- 修正后cron聚焦：2文件5测试通过，0失败/跳过；`tsc -b plugins/cron --pretty false`和scheduler测试局部Biome通过。未调用模型、未改其他生产字段。
