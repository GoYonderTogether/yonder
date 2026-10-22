# Progress observer decision engine

Implemented the bounded pure orchestration layer. `runDecision` accepts injected `decide(snapshot)` and `send(boundTarget, text)` functions; it performs quiet/rate checks before deciding, validates unknown model output defensively, requires evidence from unconsumed pending facts, and durably claims evidence before invoking the sender. Only a confirmed `sent` receipt consumes claimed pending facts and records `lastSent`; `unknown` leaves them pending and blocks automatic re-decision/re-send. `skip` leaves pending facts intact. The ledger no longer truncates its persistent deduplication IDs, and its atomic snapshot writes are serialized to prevent stale concurrent renames.

The engine does not invoke a model, perform production delivery, or infer an owner for `ask`; the caller must supply an explicit bound target. Actual SDK wiring remains out of scope.

Validation: `npx vitest run plugins/progress-observer/test` passed (5 tests); `npx tsc -b plugins/progress-observer --pretty false` passed; targeted Biome check passed after formatting. Tests cover malformed output, quiet suppression, skip preservation, restart recovery, and unknown receipt non-retry. No full suite run.
