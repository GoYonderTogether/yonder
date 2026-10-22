# Task-link observer binding completion

- Worktree HEAD before work: `4faca5a434e21ee20ca3e05c9e8a6db2388db27f`.
- Runtime producer keeps `task.linked` provenance (`from: system:runtime`) and now derives `sourceEvent` only from the actual `ctx.event` or latest `ctx.events` entry of type `session.input` / `message.in`. If no such event exists it remains absent (unknown), rather than borrowing an unrelated first event.
- Observer binding now queries durable `task.linked` events, requires runtime provenance plus matching parent session, child session, and source event; it separately verifies the child via `sessions.get` as a task session with matching parent. An owner/context mismatch is rejected. It no longer relies on the fictional `session.open.parent` correlation.
- `task.linked` consumption itself deliberately records no `executor.active`: child initialization can still fail. Executor activity remains sourced only by actual child input events.
- Tests cover two distinct task/child bindings from a shared source input, durable evidence replay queried after observer startup and task registration, mismatched source/owner/provenance rejection, and missing source evidence remaining unknown. Existing bind partial remains present.
- Verification: `npx vitest run plugins/progress-observer/test/plugin.test.ts packages/core/src/runtime/task-link.test.ts` passed (5 tests); `npx tsc --noEmit -p tsconfig.json` passed. Biome format was applied to changed implementation/tests; lint reports existing `any` warnings in the observer test and unrelated existing runtime non-null assertions.
- No full suite, production/auth change, external delivery, or push was performed.
