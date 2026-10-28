# CH-06 投递复核切片（2026-10-28）

启用 social 的源会话回复在 send、重试和流的每个输出前检查当前渠道范围及社交策略；静默、quiet、拒绝或取消授权后停止继续发送。热重载原位更新 agents Map，已有会话继续使用固定 profile。已交给渠道的内容无法撤回；没有来源事件的主动发送不在本切片内。

定向验证：`npx vitest run packages/core/src/delivery/delivery.test.ts`：1 文件通过，33 测试通过、0 失败、0 跳过，含静默、流中撤权和重试测试。`npx biome check` 检查本切片 4 个 TypeScript 文件退出 0，24 warnings。`node scripts/check-file-size.mjs` 失败：并行修改的 routing/index.ts 522 行，新超限；本切片 delivery/index.ts 未超基线。`npx tsc -b` 失败：kernel/index.ts 引用缺失的 projectRulesFor，code-intel/diagnostic-mark.ts 两处 string | undefined；均非本切片修改。

整卡未完成：social_inspect/update/resume、策略更新与持久化、控制面、可信 actor/sourceEvent 审计、权限矩阵、真实模型和真实渠道均未实现或未验证。上述测试为进程内渠道测试，不是实际平台证据。
