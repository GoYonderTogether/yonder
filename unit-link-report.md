# Task-link projection unit report

- Baseline: `9790bfa855b365f73711bd0c44d8aac4900bdeeb` in the requested worktree.
- Added four direct unit assertions in `packages/core/src/runtime/task-link.test.ts` for parent/source/child projection, same-context child isolation, absent-event fail-closed behavior, and the two-argument API (no initializer input).
- Made `Runtime.exportTaskLink` static so the function can be imported and tested without constructing a Runtime. The existing call site now invokes that static projection; no task execution behavior was otherwise changed.
- `npx vitest run packages/core/src/runtime/task-link.test.ts`: passed (4 tests).
- `npx tsc -b packages/core --pretty false`: passed.
- `npx biome check packages/core/src/runtime/task-link.test.ts`: passed.
- Scoped Biome including `runtime/index.ts` reports pre-existing lint issues in that large file (no-non-null assertions and related warnings); it also initially identified formatting/import ordering in the new test, which was corrected. No unrelated lint cleanup was made.
