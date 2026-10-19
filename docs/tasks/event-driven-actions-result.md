# E0–E4 事件程序消费与无模型通知：实现结果

日期：2026-10-19。用户批准“安排sub agent执行完成和提交”。范围为[event方案](event-driven-actions-proposal.md)，不并入单列的Agent热CRUD，不自动发布/替换正式安装。

## 交付判断

功能源码与接线完成，相关构建/类型/聚焦检查及真实隔离程序→session→TUI链通过。没有新增插件、依赖、工作流引擎、模型循环、通用脚本管理器或消费数据库；pi补丁未改。正式版仍1905，更新后的GitHub真实升级/飞书程序通知尚未安装验收，不用旧模型链的成功替代。

## 分工与实现

- 主路：E0规范冻结（5f18214、D40），core共用updateRelease结果、SDK/内核/CLI/TUI共享接线、配置迁移说明和整合提交。
- Sol event_actions：channel-github精确事件处理器直接调用共享scheduleUpdate，复核真实Release和授权，只自动升级严格高于宿主版本的Release；显式工具仍支持用户获准回滚。完成通知按独立notifyUpdates开关、目标及仓库/install/home过滤，直接messages.send，保存尝试和Delivery、unknown不重发。
- Sol release_context：首次基线及后续成功轮询核实最高正式版本，channel-github.release-availability仅从已核实缓存提供turn信息，聊天不联网、不含外部Release正文；host版本由SDK的实际version提供。
- Sol session_notifications：pi原生app-only write、requestId幂等、持久转录与实时/重连投影；没有user/assistant/model伪造消息，不进模型上下文、不启动运行。

三个分路记录保留：event-actions-result.md、release-context-result.md、session-notifications-result.md。

## 最小能力与入口

```text
原始事件账本
├─ Agent绑定 wake:run → 需要判断才调用模型
├─ Agent绑定 wake:write → 背景输入，不调用模型
└─ PluginAPI.events.on → 业务函数或明确授权的脚本
   ├─ messages.send → 外部渠道程序通知
   └─ sessions.notify(id,{event,text}) → 内部session程序通知
```

直接CLI和插件job调用同一updateRelease，写内核release.update-result；同版本no-op不造完成事实。事件包含真实尝试ID、版本/来源、核验或失败/待重启状态。在线走已有控制面，离线取得原home锁写既有账本，不建outbox；记录失败明确eventError，不重做安装。旧channel-github.update-result只保留历史兼容，不重复通知。

新CLI：`yonder sessions notify <session-id> --event <真实事件id> --text <正文>`。目标须真实开放、原事件存在，来源固定system:cli；插件入口来源由loader注入实际plugin身份。回执仅表示已记录，不宣称人已读。TUI沿用pi的CustomMessageComponent，程序标识和原生消息按entry顺序展示；JSON观察保留结构化notification，plain客户端显示真实程序来源。

## 实际检查与原始问题

- `npm run build` 通过，日志 `/tmp/yonder-e-build.log`。
- `npm run typecheck`（tsc -b --force）通过，日志 `/tmp/yonder-e-typecheck.log`；最后必要改动后增量编译通过 `/tmp/yonder-e-final-compile.log`。
- 相关11文件共47通过、1跳过、0失败；跳过的是需YONDER_TEST_LAUNCHD=1明确开启的真实launchd检查，不算通过。日志 `/tmp/yonder-e-final-focused.log`。包括SDK契约、原生通知/离线转录、kernel重载、Release消费/可升级信息、CLI展示/补全和更新记录。
- 之后结果输入校验/补全修改，聚焦2文件4通过；错误消息脱敏修改后更新结果2项再次通过，不把重复执行累计为新功能数。
- Biome检查27个受影响TS/JSON文件，最终0错误、31警告，未为清理警告修改无关实现；日志 `/tmp/yonder-e-lint-final.log`。最初一处本轮修改的repair fixture格式错误已修；警告完整保留。
- 早期类型检查出现notify回调可选pluginId签名、exactOptionalPropertyTypes下beforeVersion、更新返回union的restartRequired访问问题，均已修正。子路原始记录保留。
- 首次CLI/TUI集成将home放入macOS长临时路径，Unix socket listen EINVAL导致启动失败。原日志仍在 `/var/folders/hg/8kf929p12wz498k8q4r74kg00000gn/T/yonder-event-integration-llrd9h5y/service.log`；验收脚本改用短/tmp隔离路径后通过，没有把环境失败改成产品成功，也未扩展为路径管理系统。

## 真实无模型程序链与TUI预览

可复用脚本 `python3 scripts/check-event-notifications.py`（先build），仅用Python标准库、真实源码CLI/内核/SQLite/pi session，创建隔离home和验收插件/脚本，结束关闭自身子进程，不碰正式服务、不联网/调用模型。

实际线路：更改真实preset描述→watcher记录config.reload→插件精确订阅→Node子程序从stdin读完整原事件并产出正文→api.sessions.notify→原生通知→TUI观察。另用正式CLI源码的sessions notify验证独立program来源。

脚本最终真实输出：

- home `/tmp/ye-2x3lb6v1`，session `2`。
- 来源 `plugin:event-check`，原事件 `01M5ABQMQYXGSQA6DH2MS1T1V6`。
- CLI通知回执 entry=11、recorded=true；run.end数量为0。
- 实际PTY同时显示脚本和CLI两条程序通知，不显示为AI回复。原始终端记录 `tui-preview.ansi`、去控制码文本 `tui-preview.txt`、结果 `result.json`均在该隔离目录。该隔离服务已经退出，数据和证据保留。
- 原生单项检查另确认usage全零、通知重复异文不重复插入、关闭/不存在目标拒绝、未知原事件拒绝、实时与重连时序及在线/离线转录一致。

更新入口检查使用真实updateRelease与隔离安装根的预备构建产物，实际切换current、保留旧版本、记录待重启/no-op/真实本地git失败。该检查不是完整发布构建、不是macOS正式安装或launchd升级验收；没有虚构verified成功。

## 正式迁移与剩余验收

本轮未推送、打tag、发布、更新或改正式home。因此现有贾维斯/哦鲸鲸与1905更新链保持日用状态。安装含本功能的新版本之后，按plugins/channel-github/README的迁移节：

1. 保留获准apply/updater，显式启用notifyUpdates和原指定通知目标。
2. 移除自动执行同一动作的模型run绑定/旧更新任务指令；需要背景才配置write，需要判断才配置run。
3. 选用channel-github.release-availability。共同完成事件不属于github渠道，绑定其类型不能保留旧channel=github-project限定。
4. 通过既有正式版本update流程验收一次真实升级及飞书程序通知，不造多个版本重复升级。旧版CLI本身不具备新的完成事件逻辑，首次迁移不伪造历史补报。

剩余：真实GitHub API+launchd升级+飞书程序发送需后续正式发布/安装后验收；进程内订阅仍非持久任务队列，未承诺崩溃必送/exactly-once；未新增外部脚本订阅CLI、脚本配置平台或其他用户未要求的能力。
