# N12 Yonder 设计与开发飞书渠道

## 当前状态（2026-10-19）

飞书功能体已安装，部分私聊、命令与离线补收真实通过；完整矩阵未通过，见P0/P1。 依据：[当前证据](../current-status.md)、[R结果](../repair-main-result.md)、[F结果](../feishu-recovery-result.md)。本次仅整理状态，后续按[待审方案](../finishing-plan.md)。

## 历史任务与结果（原文保留）

以下状态、版本及执行要求按记录当时理解；不作为当前派工指令。

**状态**：C4 实现未验收；原真实矩阵留 N13 后轮。

**负责人**：Yonder maintainer（Sol）；Codex 架构/代码审查与阻塞介入。

**依赖**：N09。不等待 GitHub 发布更新或桌面能力；完整客户端验收另见 N13。

**功能依据**：11 §7；既有 01/02/04/05/06。完整条款见 [10](../../spec/10-local-maintenance.md)、[11](../../spec/11-official-plugins.md)，本任务不定义新功能。

## 允许路径

- plugins/channel-feishu/
- 根 workspace/锁文件接线、THIRD_PARTY_NOTICES.md
- 安装 home 的批准飞书实例、绑定和凭据引用
- 对应插件检查；不引入办公 API 平台或改内核消息模型

本任务文件、任务总表和必要 CHANGELOG 记录可更新；冻结功能文档仅 N00 的设计方可按批准修改。

## 实现安排

Yonder 完整阅读固定上游渠道链，设计后实现规范内全部消息/卡片/流式/多媒体能力；方案由 Codex 按已批规范审查。按 10 §2.1 进入安装版供 N13 使用，自动更新未接通时仍由 Codex 执行阶段安装。

## 验证与交付

插件契约与可执行检查、真实 API 接线；N13 逐项客户端验收。上游移植记录准确模块和必要依赖，不把源码存在当功能已通。

记录实际命令、event/session/model、commit/PR 与失败/跳过；Yonder 和 Codex 的贡献分开归属。

## 问题

- 当前不声称运行通过；本轮按 spec/13 禁止新增/运行测试与真实渠道调用。
- 官方 SDK 精确版本 1.74.0，根 workspace/锁/tsconfig/第三方总表由主 agent 接线安装。
- 消息工具需要主 agent 已确认的兼容字段 `PluginAPI.messages.send({signal})`；内核转交 Channel.send。入站 emit 与本地原生 receipt 落盘之间的崩溃窗口由共享内核按 type+渠道实例+data.msgId 幂等收口。
- 输出多媒体使用 file: URI，音频明确要求 Ogg/Opus、视频 MP4；其他格式需要先产生正确格式产物，不自动引入转码平台或静默降级。
- 飞书开发归属为 Codex；不把本轮源码称为 Yonder 自主开发。

## 结果

2026-10-18 C4：新增独立 SDK 包 `plugins/channel-feishu/`，实现 11 §7.1–7.3 的生产调用链：

- 飞书/Lark 多实例、secret 凭据引用、官方 SDK WebSocket 和原生重连/连接状态、机器人身份和 API 权限错误诊断；setup 不联网。
- 私聊/群聊、原生 @/引用/线程、白名单传输准入、屏蔽机器人/自身互刷；身份和 mention 唤醒复用内核绑定。text/post/image/audio/video/media/file/interactive 的文字/附件和明确类型提示，资源实际下载 MIME/名称/大小持久保留。
- 普通/Markdown/post/card 渲染、UTF-8 JSON 包络分块、图片/文件/音频/视频上传发送、真实消息 id、回复/线程和部分投递错误。普通工具发送走 api.messages.send/message.out。
- 原生自定义/模板卡片工具及 channel-feishu.card-sent 事件；认证 WebSocket 按钮回调保留操作者、原消息/会话，回调 token 只用 SHA-256 去重标识，不保存原 token。
- CardKit 创建、实体发送、累计内容、合并更新、严格递增 sequence；正常/错误/取消（含等待源输出）均 finally 刷新/关闭；关闭失败返回已可见 id，不重复发最终文本。
- 断线由官方 SDK 恢复；每实例原生 msgId 持久 receipts、同消息并发合并，配合主 agent 共享幂等接纳。

已按成熟调用链阅读固定 OpenClaw cafa09e50556e08c2a04a670f16ac815482c5489 与 Hermes 66605471e9f0b0832abbefaf625ce08e948ca540。来源、模块、MIT 许可见包 NOTICE.md 与 LICENSE.openclaw/LICENSE.hermes；不复制上游运行时、任务平台或跨渠道卡片 DSL。README 写明实际配置和调用方式。

未执行任何测试、模型/飞书/浏览器/桌面调用、安装、授权、外部发送、push 或发布。工作树无依赖，必要 build/typecheck 待主 agent 统一安装与 C6 接线后执行；N13 全部客户端矩阵保持未测，不据源码宣称可播放/可打开或端到端可用。


### C6 主仓组装记录

本包生产源码、必要既有资产已整合到主仓，根 workspace、锁文件与 TypeScript 引用已接线；全仓 `npm run build`、`npm run typecheck` 通过。上文工作树检查为历史证据，当前不再处于“待根组装”。本轮没有新增/运行测试、授权、模型、外部 API/消息/安装/发布调用；功能保持“实现未验收”，原真实验收和未完成项留后轮。贡献归实际实现者，不把 Codex 续写计为 Yonder 自主实现。
