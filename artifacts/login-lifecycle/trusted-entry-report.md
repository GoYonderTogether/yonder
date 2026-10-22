# Trusted login handler 接入核查

## 基线与边界
- 仓库：`/tmp/yonder-login-lifecycle-20261022/worktree`；基线 HEAD `7a2afb5249279e735c193be609abda5f698e693b`，初始工作树 clean。
- 只在获授权 worktree 内检查/修改；没有搜索或修改 Documents，也没有启动真实登录、生产/auth 写入或 push。
- 同目录 service-report.md 与 api-report.md 表明现有 `LoginOperations` 是基础持久 API，尚未接入 Runtime/真实工具入口。

## 代码核查结论
- `packages/core/src/runtime/index.ts` 的 `adapter()` 是当前 Harness 工具实际入口。它由运行时从 Harness `Context` 构造 `ToolContext` 后调用 SDK tool handler；`ToolContext` 本身不是鉴权凭证，直接暴露 `LoginOperations.begin(ctx)` 仍允许调用者自行拼装上下文。
- `RuntimeOptions` 没有本地 login provider/子进程命令注册，也没有私有凭据 stdin、登录终态回调/outbox接口。现有 `loginWithType` 是模型提供商 OAuth/API key credential flow，不是用户要求的 provider login child-process launcher。
- `LoginOperations.finish()` 仅将 operation 行置为终态，没有与 outbox 共事务、唤醒原会话的安全内核 API，也没有恢复 dispatcher。直接调用 `sessions.submit` 或向 `onBackground` 交付会绕开原始 run 的事务/请求幂等语义；向模型可见工具结果、事件、argv 或普通日志传 capability 又是明令禁止。
- 因而在此仓库现有契约下，无法安全完成“实际工具 handler + 模型只见 operation ID + capability 私密传递 + terminal/outbox 同事务/重启幂等恢复”。任意新增回调/表或用 ToolContext 作信任边界只会制造看似完成但不可信的协议。需维护者先确认核心内部 API 契约（可信 handler 身份建立方式、outbox schema/dispatch/recovery/wake 的事务边界、provider runner 命令及 stdin payload 协议）；然后才能做真实接线和仿子进程测试。

## 实际完成与验证
- 修复目标文件三个已有 Biome style diagnostics：`login-operations.ts` 一个 optional-chain；对应 test 两处 non-null assertion。
- `npm test -- --maxWorkers=4 packages/core/src/runtime/login-operations.test.ts`：通过，4 tests。
- `npm run typecheck`：通过。
- 未改 Runtime handler、未测试 Harness runtime 联调、未执行全量测试/登录。

## 状态
本报告不声称真实工具入口或 end-to-end lifecycle 已实现。仅提交现有基础 API 的精确 lint 修复及本核查报告。后续阻塞点如上；不要把这个提交当作登录功能交付。
