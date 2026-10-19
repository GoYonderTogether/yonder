# 本机 Agent 命名与更新职责配置结果

日期：2026-10-19。用户明确批准配置，不等于批准整套 A0–A4 管理框架、发布或安装新代码。

## 结果

- 贾维斯：内部 ID main，日常管家，兼管正式版本关注、按已批准策略更新与通知。
- 哦鲸鲸：内部 ID maintainer，项目源码维护，保留真实 openai/gpt-6.1-sol 配置。
- operator：从 home/yonder.yaml 注册名单移除，原工作区增加 ARCHIVED.md；原配置、指令、会话和事件原地保留，不永久删除。
- main 新增 release-updater 配置档，复制原更新档及所需原 defaults（模型、contexts、plugins）；只提供 channel-github_status、channel-github_read_release、channel-github_update_schedule、channel-github_update_status、message_send 五个工具，search=[]。有工具实现所需 exec/admin 能力，但 bash 不被提供；不宣称是宿主安全沙箱。
- github-releases/github-update-results 两条绑定转到 main 的独立 persistent 会话，reply=none；日常主会话仍 owner，未切换其权限，也未复制 operator 转录。
- GitHub 插件配置、发布接收基线、独立更新作业、正式版本及通知目标未变；没有制造发布/更新事件，没有另发飞书测试通知。

## 修改位置与保留

正式 home：`/Users/zoran/.local/share/yonder-harness/home`。

修改 yonder.yaml 的 agents 注册；agents/main 的 agent.yaml、SYSTEM.md、AGENTS.md；agents/maintainer 的 agent.yaml、SYSTEM.md、AGENTS.md；新增 agents/operator/ARCHIVED.md。当前 schema 不支持 work 字段，因此工作写入真实职责文本；未添加不合法字段，不将未来管理界面声称已实现。

本次发现维护指令仍引用不存在的旧源码工作树、已结束 /tmp 任务及旧 PR base。改为真实仓库 `/Users/zoran/Documents/yonder-harness`，实际修改按任务新建/复用独立工作树，常规 PR base=main；保留上一任务已结束及不得重跑的事实。没有创建新开发任务或修改正式安装源码。

修改前的配置与指令备份在 `.yonder/backups/agent-roles-2026-10-19T14-47-25-782Z/`，私有目录/文件；不含凭据文件，不纳入源码仓库。operator 已关闭的 19、1600 会话及原转录保留。

## 实际检查

1. 修改前通过正式控制面的 sessions.watch 原生 snapshot，检查全部19个开放会话，无 running 或 inbox 待处理项。非模型测试，未构造任务。
2. 安装版 yonder doctor 通过，errors=[]；原有“本机 exec/CLI 不构成沙箱”警告保留。
3. 当前1905尚不支持注册热加载，本次明确关闭空闲 operator 会话19/1600，然后一次 service restart 生效。首次紧接 restart 查询 service info 返回 control.sock ENOENT，原始失败保留；后续查询已 ready，不把重启命令返回当作已就绪。
4. 实际服务仍为0.1.2026101905，commit 866717730180c1cffdc016870d2605b8233f9add，PID95189，home正确，ready=true；不是开发目录或新安装版本。
5. 正式 terminal.channels 返回 CLI 目标 main，name=贾维斯；重启后注册配置仅main/maintainer，名字分别贾维斯/哦鲸鲸。
6. main/release-updater inspect 显示原五工具 offer，bash=not-selected；仅context-files/channel-github被此档选用，运行模型仍Luna。inspect的配置投影不代替一次实际更新执行。
7. sessions.show 1600 仍可读取，52项转录与修改前逐项相同，新增 closed 时间；未迁移/覆盖历史。

未跑全功能矩阵、未新增模型测试、未实际发行或升级新版本。新角色下一次真实 Release 的完整自动更新/通知链尚待自然发生，不能用1905旧链结果替代本次移交后的实测。

## 用户询问：版本关注与那条飞书通知

当前没有依赖 cron 插件：channel-github 的原生轮询循环每轮完成后等待配置的 pollSeconds=30秒，再读取 GitHub；新正式 Release 必须属于 zoran-xc/yonder-harness、发布者获准、不是draft/prerelease且尚未接收。无新事件时不唤醒LLM。发布列表首次接入只记基线，不执行旧版本。

运行链：GitHub插件读取发布→channel-github.release事件→绑定唤醒受限更新档→AI调用read_release/update_schedule→插件创建一次性launchd作业→作业调用既有yonder update、核对版本/提交/服务并写result.json→插件读取回执发update-result→AI调用update_status并通过message_send发飞书。脚本负责实际升级和机器核对，AI负责工具选择、读回执与组织通知，飞书插件负责实际投递。

用户引用的1904→1905通知可定位原生会话1600：

- update-result事件 `01M59S68J6SJJHVPPRZ7MVW9WR`，version1905、verified=true，原路由operator/release-updater/1600。
- 转录2178：AI调用channel-github_update_status，instance=github-project、releaseId=417132621。
- 转录2180：工具返回真实更新前后与服务核验回执。
- 转录2182：AI调用message_send，其text与用户引用的中文通知完全相同，指定人生管家私聊。
- 转录2184：发送工具ok=true，飞书原生消息ID `om_x100b626aca1c48b8dd6d154bfe6d8e9`。
- 转录2186：AI最终回复已核验并通知。

因此这段中文不是脚本固定模板、不是Codex代发，是当时Yonder的operator AI通过工具发送。职责移交后相同事件由贾维斯处理，独立更新作业保持原实现。
