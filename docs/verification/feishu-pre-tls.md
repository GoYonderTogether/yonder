# 飞书 TLS 建连前断连分类回归

2026-10-21，跟踪日用实例的委派恢复时，05:32:36Z 一条阶段消息因
`ECONNRESET: Client network socket disconnected before secure TLS connection was established`
记为 `message.unknown`，未补达。模型仍继续执行；不能将此当作委派卡住。
观察时日用构建为本地微信验收候选 `ee3168c`，不是新增修复已部署的证据。

## 根因与修复

`FeishuApi.raw` 共用的传输分类只认 DNS、拒绝连接与连接超时，漏掉 Node
明确指出 TLS 未建立的 ECONNRESET。此时 HTTPS 请求还不能发送，应返回
`uncertain=false, retryable=true`，复用既有普通发送和未显示流式消息的账本补达。

仅匹配 ECONNRESET 与明确的 TLS 前阶段信息，不将一般 `read ECONNRESET`
当作安全重试；已显示卡片、部分发送、真正未知仍沿原规则。无新增队列、配置或依赖，
不修改历史 unknown，不重跑模型或业务操作。

## 验证

- 使用真实本地 TCP 监听器在 TLS 握手前结束连接，由 Node fetch 产生实际异常。
  协议测试将该异常交给发送 POST 和流式创建路径，鉴权响应为测试协议夹具，
  不连接真实飞书或调用模型；同时确认不带明确阶段的一般 ECONNRESET 保持未知。
- 初版回归调用未启动的 channel.send，触发 stopped 保护；改为直接验证共用
  POST 路径。最终回归在旧实现上 **17 通过 / 1 失败**，断言准确显示旧结果为
  `retryable=false, uncertain=true`；修复后定向 **18 通过 / 0 失败**。
- `npm ci --ignore-scripts`、build、typecheck：通过。
- 全仓默认测试：**196 通过 / 20 跳过 / 0 失败**，52 文件通过、10 文件跳过。
  未启用真实模型及 opt-in 外部验收，跳过不算通过。
- lint：通过，保留 **183 warnings / 1 info**；diff check：通过。

随后将补丁从微信候选分支拆到正式 `main` 基线 `aaf23e3`，避免合入未发布的
微信功能。重新 `npm ci --offline --ignore-scripts`、build、typecheck、默认测试、
lint 均通过：**189 通过 / 19 跳过 / 0 失败**，51 文件通过、10 文件跳过；
lint **127 warnings / 1 info**。前面的候选基线结果保留，不以新计数覆盖。

本轮不覆盖正在使用的微信候选、不重启服务，不宣称 Hermes 已接通或此修复已实机生效。
源码合入和后续正式发布应继续保留上述部署边界。
