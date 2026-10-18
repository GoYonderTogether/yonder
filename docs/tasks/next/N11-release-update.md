# N11 发布事件与 operator 更新

**状态**：已批准，待实施；先完成 N00 对齐与冻结。

**负责人**：Yonder maintainer 开发；operator 执行；Codex 审查发布。

**依赖**：N10。

**功能依据**：10 §2/6；11 §6；原 09/T14。完整条款见 [10](../../spec/10-local-maintenance.md)、[11](../../spec/11-official-plugins.md)，本任务不定义新功能。

## 允许路径

- plugins/channel-github/ 的发布事件与更新工具
- packages/core/src/release/、packages/cli/src/index.ts 的批准安装/一次性更新接线
- 安装 home 的 operator 绑定与发布策略
- 本任务独立更新 launchd 作业、安装目录、T14 结果

本任务文件、任务总表和必要 CHANGELOG 记录可更新；冻结功能文档仅 N00 的设计方可按批准修改。

## 实现安排

先由 Codex 按 10 §2.1 安装具备发布接收和更新工具的版本，再由 Codex 审核下一目标版本的发行提交、创建并推送对应标签，使用 gh 创建正式 GitHub Release。插件消费实际 Release，唤醒 operator；实现不随被更新服务退出的一次性更新和重启后的结果核对。完成真实更新后 operator 接手日常发布更新，不能依赖尚未安装的插件接收自己的首次发布。

## 验证与交付

真实审核版本的 GitHub Release URL→一次 release 事件→pi 实际输入含正确仓库/tag/版本→operator 更新→服务重启→版本/commit/路径确认；失败保留旧安装与真实原因；无用户渠道时不能记已通知。

记录实际命令、event/session/model、commit/PR 与失败/跳过；Yonder 和 Codex 的贡献分开归属。

## 问题

待实现时记录。当前没有运行通过的声明。

## 结果

尚未开始。


### C4 同包源码交付（2026-10-18，Codex Sol）

- 同包新增 Release REST 分页源，复用实例仓库/客户端；持久化实际 release id，仅接显式批准作者的正式 vX.Y.Z Release。事件完整保留 repository/releaseId/tag/version/sourceUrl/body/作者，稳定 msgId，草稿/预发布/未批准作者不唤醒。
- operator 默认 notify；显式 apply + install/home 配置后，调度工具重新读取同一原生 Release，以精确仓库/tag 创建服务外 launchd 一次性 Node 作业，使用现有 yonder update/version/service status CLI，无新 CLI flag/SDK/core 私接。现有核心 updater 负责回退。
- 工具：read_release {instance,releaseId?}、update_schedule {instance,releaseId}、update_status {instance,releaseId}。只调度返回 scheduled/verified:false；作业实际核对版本/origin commit/tag/仓库、源码路径、pid/home/install 并原子保存结果，重启轮询发合法 update-result 事件；没有用户渠道始终不记已通知。同发布不重复运行、未知结果不自动重试。
- 配置、operator 绑定、精确 argv、返回字段、边界、留存文件及原验收入口均在 plugins/channel-github/README.md。没有自行创建日用 home/launchd/安装目录。
- 实现未验收。未新增/修改/运行测试，未授权/调用 GitHub、模型、搜索、桌面、安装、launchd、推送或发布。仅借主仓库已装 tsc，以 /tmp/yonder-lane-a-typecheck.json 显式 SDK/typebox 路径对两个插件生产源码 strict/noEmit 类型检查；通过只证明此类型检查，不是发行组装/安装验收。首次临时 typebox 目录映射未解析，改为 package 声明的 build/index.d.mts 后通过。
- 根 workspace/锁文件/项目引用/许可接线交主 agent；真实 Release→operator pi 输入→更新→重启与用户通知仍未测。N10/C1 的统一原生 msgId 去重是接收窗口恢复的共享接纳契约。
