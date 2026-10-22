# Runtime task-link test proof

Added `packages/core/src/runtime/run-task-link.test.ts`. These tests call `Runtime.prototype.runTask.call(...)` on an object created from `Runtime.prototype`; they do not merely exercise `Runtime.exportTaskLink`.

The test-only harness injects a `WeakMap<ToolContext, { api, context }>` for active invocations and a fake `api.commit` transaction whose scan/create/doc methods return controlled child IDs. `recordEvent` captures emitted Yonder events. The initialize callback deliberately rejects after linkage, before conversation submission/provider work. The test verifies the rejection and exact parent session, child session, and trusted source event for two distinct contexts/children, demonstrating no cross-invocation mix-up. A separate test verifies an invocation absent from the map rejects without recording an event.

Validation performed:

- `npx vitest run packages/core/src/runtime/run-task-link.test.ts` — 2 tests passed.
- `npx tsc -b packages/core/tsconfig.json --pretty false` — passed.
- `npx biome check packages/core/src/runtime/run-task-link.test.ts` — passed.

Scope: this is a method-level integration/unit test with a mocked transaction, not a complete Runtime, durable storage, provider, or end-to-end test. No real model, authentication, message delivery, production runtime, or push was involved. No production interface or permission was changed.
