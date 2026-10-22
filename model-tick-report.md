# Progress observer model tick implementation

- Wired optional admin-selected `model: { provider, modelId }` into enabled ticks through the bounded decider. Without a configured model, the existing safe fallback remains in use; observer remains disabled by default.
- Tick filtering still occurs in orchestration before the decision callback (quiet period, minimum interval, unknown delivery, minimum task count); tasks without a bound source target are skipped before model use and delivery.
- Kept model input limited to the observer snapshot. Model-authored prose is discarded; outgoing status is rendered from durable executor/acceptance facts. Model `ask` remains rejected.
- Bounded adapter enforces an 8-second Promise.race timeout as well as abort, so an uncooperative provider cannot hold the tick open; late completion cannot initiate a send.
- Added synthetic SDK-style tick→bounded model→sender test. It proves model is called for configured model, and fabricated completion prose / private label are not delivered.

## Verification

- `npm test -- --maxWorkers=4 plugins/progress-observer`: 6 files, 17 tests passed, 0 failed, 0 skipped.
- `npm run typecheck`: passed.
- `npm run build`: passed (includes macOS helper build/signing).
- Targeted Biome check: no errors; 3 pre-existing/style warnings remain (two `any` in tick test harness and optional-chain suggestion in existing session validation).
- No real model request or external delivery performed. This is synthetic-only validation.

## Scope and commit

Committed only progress-observer source/test and this report. Existing `plugins/clipboard/test/real-model.test.ts` modification and `phase4-bind-report.md` remain uncommitted and untouched.
