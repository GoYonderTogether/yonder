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

## 执行状态

本提交时发行和安装正在进行，结果在本文件后续补记；不能把上述构建/校验写成已安装或已投递。不可变发布标签将在版本提交后创建。更新使用现有updateRelease/versions/current/launchd流程，不在安装目录写开发源码。采用新CLI执行一次既有安装器，使本次升级也产生统一完成事件；不是第二个正式daemon。
