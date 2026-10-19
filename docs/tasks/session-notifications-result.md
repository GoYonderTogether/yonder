# E4：指定内部 session 的无模型程序通知

日期：2026-10-19。状态：原生保存、观察投影与聚焦检查已实现；实际 TUI 展示由主路接线验收。未使用正式 home、未安装、发布或发送外部消息。

## 原生边界

- pi-durable 1.3.0 `Conversation.submit({type:"write",entry:{kind,data}}, context)` 已提供程序注记入口。`harness/types.d.ts` 的 Conversation.submit 与 `harness/inbox.js` 的 isDisplayOnly 明确：不含 model/head/edits 的写入立即追加，即使会话正在运行也不改变模型上下文。
- 原生 `Submission.wait` 返回持久化 entry ID；同一 conversation 的 requestId 重复返回原 submission。以真实 from/event 组成 requestId，目标 session 由原生 conversation 自然隔离。重复事件携带不同正文时返回第一次 entry，不追加、不替换旧正文。
- 原生 `watchEvents` 同时在 snapshot.entries 与 entry_appended 提供注记。原来的 Yonder 投影只读取 entry.model，因而不会展示这种注记。

## 实现

- runtime/notifications.ts 只写 `yonder.notification` 应用 entry，data 保存真实 from、原始 event ID、正文；不含 user/assistant/model 消息。
- sessions.notifyFrom 验证目标存在且未关闭、原始 event 存在及非空正文；来源由可信调用方参数注入，覆盖输入中的任何同名字段。内核自身 notify 的来源是 system:yonder；插件/CLI 来源由主路 wrapper 注入。
- 记录回执为 `{session,event,entry,recorded:true}`。它证明已持久化，不声称用户已阅读或终端已确认展示。
- transcript 同时用于在线和离线读取，保留正文、来源和 event；未建立第二张转录表。
- terminal 实时发独立 notification 更新；重连 snapshot.items 按原生 entry 顺序交错投影普通消息与通知，保留原 messages 兼容字段。

## 实际验证

`npx vitest run packages/core/src/runtime/notifications.test.ts packages/core/src/runtime/offline.test.ts`：2 项通过、0 失败、0 跳过。使用临时真实 SQLite、真实原生 session 与原生 watch，不使用模型或模拟模型。

覆盖：通知保存一次、重复事件异文不重复、原生记录无 model 字段、即时通知观察、没有 run 开始、重启观察顺序、离线/在线转录一致、用量全零、未知事件/会话及已关闭会话拒绝。

首次 `npx tsc -b packages/core --pretty false` 发现主路正在接线的 kernel notify wrapper 必填 pluginId 参数与公共两参数签名不兼容，已反馈主路；本路 runtime/sessions 未报告类型错误。最终整合类型检查与 TUI 真实显示以主路总结果为准。

## 问题与未测

无原生能力缺口，无需 patch pi。当前没有增加模型运行、外部投递、消费数据库或通知重试系统。通知记录不等于外部送达或用户已读；实际 TUI 预览尚待主路验收。
