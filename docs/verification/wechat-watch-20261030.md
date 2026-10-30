# 微信只读监听工具闭环验收

日期：2026-10-30。范围：复用现有归档、绑定、身份及投递能力，完成监听创建、采集、提醒、暂停恢复、规则回退，发版更新本机。不做主动提问或自动选群。

## 发布与安装

- 正式版：[v0.3.26103014](https://github.com/GoYonderTogether/yonder/releases/tag/v0.3.26103014)，tag commit `87b6674b07460badf6629c99cf6ce5d587f768c8`。
- 验证源码为 tag 的直接父提交 `074d35ce9d8daf2b42ac3755de6c2d068245cb02`，基于正式版 13，只择入监听四个提交，排除并行 UI 改动。与主分支 `caaf0b3` 的 core、SDK、wechat-archive 及根微信测试比较无差异。
- Release [41055177944](https://github.com/GoYonderTogether/yonder/actions/runs/41055177944) 已完成 tag、附件、SHA256SUMS 和 Release；最后自动合回 main 因文档冲突失败。已以 `9008587b708b355bec7ad1eb7676827708f3e8a7` 仅同步版本元数据和发布日志，保留未发布 UI 项并正常推送，未修改并行源码。
- 本机 `yonder update --to 0.3.26103014 --json` 返回 updated/verified，service.info 的 version/commit 与 tag 一致、ready=true；验收后 active=0。
- 停服务后完整备份：`~/.local/share/yonder-backups/wechat-watch-2026-10-30T12-25-26Z`，home.tar 为 5,914,937,856 字节，目录 0700、文件 0600，含校验、清单及归档 SQLite 变更前后备份。

## 工具与实际验证

新增 `wechat-archive_watch_configure`、`watch_inspect`、`watch_control`、`watch_test`。订阅属于当前 Bot，使用已有授权来源、私有持续会话和已校验主人私聊；规则命中才唤醒 Bot，Bot 可沉默。规则回退只改规则，保持权限、收件人及游标。暂停不撤回已接受的运行；恢复显式选择处理暂停积累或跳至当前。

临时 home 经真实内核和正式工具上下文运行 `openai/gpt-6-luna` 共 14 次，均为 done。真实资料来自已授权 p2p 的少量记录，分段回放，不是向微信制造新消息，也不是模拟模型。验证：创建两订阅、测试不消费游标或唤醒、同源订阅独立暂停、排除规则不触发、NO_REPLY、paused/now 两种恢复、回退不倒退游标或重放、重启保留状态、错误目标被拒而正确主人 acct 成功投递，以及普通 main 会话不受监听发送限制影响。

首轮单批模型发送两条提醒；修正提示词中 purpose 具体约定与通用来源说明的优先级，合并一次 message_send，复测为一次，未另建去重队列。inspect 真实结果区分已处理但沉默的 0 投递与已处理且实际投递的 1 投递；不把平台回执当作主人已读。

本机上游因旧三次错误停留在暂停状态；当前真实同步成功补采 4,315 条，保留旧状态备份后恢复既有后台调度，重复同步新增 0，后续又采到实际新记录。没有重签微信、覆盖历史或改上游源码，未声称根治旧行号回退原因。

Yonder home 迁移曾改变按路径生成的 consumer，导致旧 cursor 没有新 consumer 的 issued 记录。现将 consumer 固定存入原 SQLite meta；维护仅补入已核对的旧身份，不重置历史、seed、cursor 或 ack。安装后私库由 3 条追到 50 条，补齐 47 条，使用原 consumer；生产监听数为 0。

只在 main.owner 选择 archive 插件，沿用 search:* 按需发现四工具，不增加常驻 schema，不向群 profile 暴露私密归档。正式 Bot 经真实主人控制输入调用工具并向既有飞书主人私聊发送一条标注验收消息，message.out 平台返回 ok=true。此次正式 Bot 使用现有 `workbuddy/deepseek-v4.1-flash`，没有改模型配置，也没有重复发送探针。平台成功不表示主人已读。

## 检查原始计数

- 发布固定源码的 npm ci、build、typecheck、lint 通过；lint 有 885 warnings、31 infos，行数基线未扩大。
- 完整 `npm test -- --maxWorkers=4`：402 文件通过、2 失败、62 跳过；2210 测试通过、3 失败、102 跳过。失败为 CLI 超时/临时目录清理及 gateway ready 等待；当时本机负载约 51–60。不改断言或超时，原样串行复跑两个文件：9 通过、1 跳过，6.46 秒。保留完整失败计数，不写成全量零失败。
- 实现初轮：2197 通过、17 失败、101 跳过；loader 急读服务及微信内部调用方/工具数问题已修复。含并行 UI 的 caaf0b3 全量为 2147 通过、68 失败、102 跳过，另 11 errors；UI 旧 select 测试已独立归因，本轮改用仅含监听的正式版基线，未回滚主目录的 UI。
- 真模型验收脚本的初始数据选择、语法、persistent submit 入口误用，以及正式探针查询未限定时间导致取旧页的脚本错误，分别保留；均未以重发真实消息制造通过。

完整原始过程、日志路径、模型/回执摘要及安装记录在本机 `/Users/zoran/Documents/yonder-review-artifacts/wechat-watch-release-20261030.md` 和同目录 `wechat-watch-*` 验收文件。真实正文不放 Git。

## 边界

唯一已授权真实来源为 p2p 私聊；真实微信群未实测，没有擅自开新群监听或全库发现。新来源须先经主人授权进入既有来源范围。没有验证全部手机历史、真人阅读、长期运行或提醒质量的全面准确率。主动提问不在本轮。
