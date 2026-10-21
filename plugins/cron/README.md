# cron

官方独立持久调度插件。工具 `cron_manage` 管理事件/preset，`cron_exec` 另要求 exec 才能管理命令/脚本。每项作业归创建者 Agent（预设作业归创建 session），无法通过另一个 Agent 查询或修改。

`action`: create/get/list/update/enable/disable/delete/run/history。create 的 job 必须有 name、schedule、payload。update 接收相同 job 字段，可用null清空delivery/start/end/maxRuns。调度必须明确 timezone；at 使用带 UTC offset 的 ISO 时间，every 使用 milliseconds（至少1000）与 anchor，cron 使用5或6字段 expression。可设 start/end（带 offset）、maxRuns、missed=coalesce|skip 和 enabled。立即运行计入次数，不改变周期锚点。

payload: event {type:"cron.…",target:"conv:…",data:{…}}；preset {preset,text}；command {command:string|string[],cwd?}；script {interpreter,path,args?,cwd?}。事件只能来自 plugin:cron，仍由内核绑定决定是否唤醒；原始事件可能命中其他Agent的管理员绑定，因此创建event作业要求admin，普通任务用按创建者能力收窄的preset。script 使用实际创建者执行环境，由明确 interpreter 执行路径，不把远程路径当作本机文件。

可选 delivery {to:"conv:…"或"acct:…",via?} 要求创建者 message 能力。投递使用真实执行结果；运行、投递和调度错误分别保留。每次运行重新核对创建者当前身份和能力，权限撤销即失败。

配置 concurrency 默认4，范围1..64。同一作业不重叠；容量满时等待空位，迟到周期合并。服务重启按 missed 合并补跑一次或跳过，已开始但未结束的运行标记 interrupted，未知副作用不自动重放。timer 与自有命令/隔离session在停止时取消。macOS休眠/关机期间不会运行。

插件data中的 jobs.json 为调度状态，runs/*.json 为持久运行记录。文件原子替换；不自动删除历史。运行中作业禁止修改/删除，先等待其结束。
