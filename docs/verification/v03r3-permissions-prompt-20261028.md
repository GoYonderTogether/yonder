# V03r3 权限提示词验证

- 原始记录：发布基线 `c81bbf02d4b99ee96a39ba6e6c7053e14733bfbe` 的 `packages/core/src/prompt/permissions.test.ts` 断言失败（任务报告；原始运行的完整输出和计数未提供）。基线源码中的 `common.authority` 缺少测试要求的主动权限引导。
- 修复候选 `2271925c0fd4d3b92a1b242c3886e612491be310` 已包含在 main，恢复了该引导及权限边界。
- 当前工作区执行 `npx vitest run packages/core/src/prompt/permissions.test.ts`：1 个测试文件通过，1 个测试通过，0 失败，0 跳过。该静态断言不证明真实模型或系统权限交互已经验收。
- 未执行 `migrate --apply`。
