# Bounded observer adapter

Implemented `src/bounded-adapter.ts` as an isolated model adapter. It accepts only a projected task snapshot (executor, acceptance, delivery, quiet/rate metadata and pending evidence IDs); labels, identifiers, seen/history records, and chat text are not included in model input. The adapter selects the explicitly configured model, calls `models.completeSimple` without tools, caps output at 256 tokens, and aborts/falls back after 8 seconds. Output must parse as JSON and pass the existing `verifyDecision`; malformed, timed-out, ask, stale/unknown evidence, and otherwise invalid decisions return `safeFallback`.

No tick/trigger wiring, real model call, delivery, production/auth, or other module changes were made.

## Verification

- `npx tsc -p plugins/progress-observer/tsconfig.json --noEmit` — passed
- `npx vitest run plugins/progress-observer/test/bounded-adapter.test.ts` — passed (5 tests)
- `npx biome check plugins/progress-observer/src/bounded-adapter.ts plugins/progress-observer/test/bounded-adapter.test.ts` — passed
