# Progress observer tick integration

## Implemented

- Added plugin config schema: `enabled` defaults false, `intervalMs` defaults to 20 minutes, and `minTasks` defaults to 4. Invalid runtime values fall back to defaults.
- The existing reconcile trigger starts an owned interval only when enabled and clears it at stop; stop also awaits queued tick work. Ticks are serialized.
- Each tick reads the durable ledger, applies the configured minimum task-count threshold, skips tasks without a previously-bound source target, and routes decisions through `runDecision` using `safeFallback` and the existing `sendProgress` adapter. Existing claim, receipt, quiet, rate-limit and unknown-delivery behavior is retained.
- This does **not** connect an LLM decision-maker or assert any owner/approval gate.

## Verification

- Targeted observer suite: 5 files, 11 tests passed (`tick`, `plugin`, `decision-engine`, `ledger`, `sender`).
- Plugin TypeScript build/typecheck: passed (`npx tsc -b plugins/progress-observer/tsconfig.json --pretty false`).
- Targeted Biome check: exit 0. It reports existing optional-chain advice in `src/index.ts` and `noExplicitAny` warnings in the new fake-SDK test; no errors.
- Fake SDK tests cover default-disabled no-send, enabled exception/unknown one-send with restart no-replay, no-target no-send, and timer cleanup. No real channel was used.
- Full suite, production/auth/push, and model integration were not run.
