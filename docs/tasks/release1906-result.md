# 1906 发行与正式安装

日期：2026-10-19。用户明确批准本轮合入main、推送、正式发布、沿用update升级本机并去掉多余AI唤醒。

## 发行范围

- E0–E4事件程序消费、程序更新/通知、可升级信息turn上下文、原生session通知及CLI/TUI接线。
- 内置yonder-self-management技能；SiliconFlow图片与ASR插件随包交付，未配置服务/凭据时不宣称可直接生成。
- 贾维斯/main负责日常管家，哦鲸鲸/maintainer负责项目维护；operator历史原地归档保留。Agent热CRUD、cron、记忆和灵魂模板仍未实现，不混入本次发行。

## 发行前证据

- main由3cb27a2快进整合至1398046，未覆盖旧历史和用户未跟踪.claude目录。
- 统一所有workspace版本与@yonder依赖为0.1.2026101906，离线更新lock，无新依赖。
- 1906 build/typecheck通过；正式home用新代码doctor校验通过，原exec并非沙箱的警告保留。复用E轮47通过/1跳过、真实无模型脚本/通知/TUI以及媒体真实API原证据，不重跑全功能矩阵。
- 正式home迁移备份 `.yonder/backups/release1906-2026-10-19T15-34-25-646Z/`。先移除两条自动run绑定github-releases/github-update-results，保留日常权限/主会话；显式notifyUpdates=true及原通知目标、apply/updater策略不变。旧版全局配置不热加载，新版本doctor已接受。

## 发行前执行快照

本提交时发行和安装正在进行，结果在本文件后续补记；不能把上述构建/校验写成已安装或已投递。不可变发布标签将在版本提交后创建。更新使用现有updateRelease/versions/current/launchd流程，不在安装目录写开发源码。采用新CLI执行一次既有安装器，使本次升级也产生统一完成事件；不是第二个正式daemon。


## 最终结果：已发布、已安装、程序通知已送达

- main 发行提交 `3dab0d35ec346ee074a0ef9a51a19eedfb4680b0`；不可变标签 [v0.1.2026101906](https://github.com/zoran-xc/yonder-harness/releases/tag/v0.1.2026101906) 已推送，正式 Release 于 2026-10-19T15:36:35Z 发布。
- 使用新版 CLI 一次性执行既有 update 流程，从正式1905升级至1906。正式安装 `/Users/zoran/.yonder-harness`，运行源码位于其 `versions/0.1.2026101906`，home `/Users/zoran/.local/share/yonder-harness/home`；服务核对为 version=1906、commit=3dab0d35…、PID=6941、ready=true。没有从开发仓库启动第二个正式 daemon。
- 更新回执：updated=true、verified=true、status=verified、restartRequired=false；updateId=`2c760675-b8e8-4284-9faa-908aa4fdb9a2`，统一结果事件 `01M5ACZ5BZ1XB45FFKE1TWN242`。
- 贾维斯移除 github-releases/github-update-results 两条 run 绑定，GitHub notifyUpdates=true；原仓库、作者、升级策略和人生管家目标不变。新版上下文 channel-github.release-availability 与 yonder-self-management 白名单已迁移并通过 terminal.info 核对；哦鲸鲸保留原技能并增加自管理技能。原配置已备份，历史未删除。
- GitHub Release 事件 `01M5ACY0047D8SBCT8MEGNNPV6` 与更新结果事件均未绑定模型运行；2026-10-19T15:34:25Z 起查询 run.end 为空。
- `plugin:channel-github` 通过程序发送“Yonder 0.1.2026101906 已更新并核验。”；message.out=`01M5ACZ8YQK9145Z0X1HJJZSHE`，飞书 Delivery ok=true，消息 id=`om_x100b6257da9afca8de4b1de99f9be36`。这是平台确认接收，不冒充用户已阅读或客户端截图验收。
- 正式安装 doctor ok=true、errors=[]；版本和技能索引已核对。不重跑全功能矩阵。媒体插件随包但正式home未加载、services仍为空；cron、记忆、Agent热CRUD、灵魂模板不在本轮完成范围。

## 本轮证据入口

本机临时证据（不承诺长期保留）：`/tmp/yonder-1906-update-result.json`、`/tmp/yonder-1906-update-progress.log`、`/tmp/yonder-1906-installed-doctor.json`、`/tmp/yonder-1906-installed-skills.json`、`/tmp/yonder-1906-events.json`、`/tmp/yonder-1906-release-events.json`、`/tmp/yonder-1906-release-run-ends.json`、`/tmp/yonder-1906-program-notices.json`。持久回执位于正式home `.yonder/plugins/channel-github/github-project.notifications/2c760675-b8e8-4284-9faa-908aa4fdb9a2.json`，事件与发送结果保存在原事件账本。

E轮原检查保留为47通过/1跳过/0失败，跳过项为未开启的真实launchd回归；后续聚焦检查不重复累计。1906 build/typecheck和新正式配置doctor通过。此前Biome31条警告、媒体源码环境API证据、未执行的完整矩阵均保留原口径。全貌对比见 [product-capabilities-1906.md](product-capabilities-1906.md)。
