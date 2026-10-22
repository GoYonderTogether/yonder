# Producer relation verification

Implemented a deterministic unit-level verification seam in `Runtime`: `exportTaskLink(ctx, childSession)` projects the trusted parent session and source event from the invocation ToolContext. `runTask` records this projection immediately after child creation and before `initialize`, so initializer data cannot override the relationship and initialization failure does not prevent the relation from being recorded.

Verification run: `npx vitest run packages/core/src/runtime/runtime.test.ts` passed (2 existing tests); `npx tsc -b packages/core --pretty false` passed; Biome formatting/check completed with 14 warnings (non-null assertions in runtime, mostly existing). This does **not** claim the requested relationship cases were tested: this pass did not add assertions for projection, concurrent child identity, or initialize failure, and did not drive `Runtime.runTask`. It is not model E2E. No model/production/auth/push activity. Full suite not run.
