# CI-MCP：REAL4 真实后端生命周期验收（2026-10-28）

- 副本：`yonder-verify/pool/real4`，提交 `44359c84f6a44a4e6d5179aa49c309d7cf307440`；隔离 HOME：`yonder-verify/homes/real4-r41358`。复用已有临时安装的 pi-lens 4.4.6，通过实际 `callLens` 和执行环境运行真实后端，无模拟 MCP 服务、无缩短空闲常量、无新增依赖。模型会话验收见 [P149](pt-p149.md) 和 [P153](pt-p153.md)，实际模型均为 `siliconflow/deepseek-ai/DeepSeek-V3.2`；下述故障注入由确定性验收程序执行。
- 执行中取消：50 个 C 文件的 `pilens_diagnostics` 请求开始后触发 abort。首次直接探测在 501ms 后返回取消；随后使用透明协议转发器连接真实 pi-lens 再验，记录到 UTC `18:01:59.687` 的 `tools/call`（id=3），以及 `18:01:59.957` 发往真实后端的 `notifications/cancelled`（requestId=3）。取消后同一连接的 `pilens_effective_config` 成功响应。不是调用前已取消，也不是只检验前端 Promise 拒绝。
- 崩溃后重连：仅向验收程序自己启动的 backend PID `72741` 发送 SIGKILL；原 bridge PID `72739` 退出。后续实际调用重建 bridge `76434`、backend `76436`，`pilens_effective_config` 成功返回。未结束主人或其他 Agent 的进程。
- 真实 10 分钟空闲回收：UTC `18:00:53.178` 最后一次响应后不再调用该连接；第 590 秒仍观察到 bridge/backend 存活，`18:10:53.155` 观察到两者自然退出（相对响应记录约 599977ms；服务端在响应记录之前已启动 600000ms 定时器）。`18:11:15.340` 再次确认已超过 10 分钟且两进程均消失，随后同一工作区实际请求成功，新建 bridge PID `97808`。未使用假时钟或测试用短超时。
- 生命周期场景计数：3 通过、0 失败、0 跳过；取消包含一次直接探测和一次协议复核，按一个场景计数。结束时调用 `stopLens` 清理本卡 bridge/backend。
- 原始探测另有 1 次初始 LSP 诊断返回 `inconclusive=1`（waitMs=10000），后续真实 analyze 才得到 `missing_name`；不计作诊断通过，保留在生命周期日志中。
- 本机证据：[生命周期日志](/Users/zoran/Documents/yonder-verify/homes/real4-r41358/evidence/mcp-lifecycle.jsonl)、[取消协议](/Users/zoran/Documents/yonder-verify/homes/real4-r41358/evidence/mcp-cancel-protocol.jsonl)、[取消结果](/Users/zoran/Documents/yonder-verify/homes/real4-r41358/evidence/mcp-cancel-result.json)、[可复核取消程序](/Users/zoran/Documents/yonder-verify/homes/real4-r41358/evidence/accept-mcp-cancel.mjs)。证据保留于本机，不含凭据。
- 生命周期驱动命令保留在 [mcp-lifecycle-repl-commands.js](/Users/zoran/Documents/yonder-verify/homes/real4-r41358/evidence/mcp-lifecycle-repl-commands.js)；主 Agent 独立核对了取消协议及回收、重连记录。本轮不包含真实外部渠道发送。
