# Progress observer stall-window verification

Worktree: `/tmp/yonder-progress-stall-20261022/worktree`  
Base commit before this continuation: `a4bc69fe516c880b374105bcd1c896b8e77ac5a7`.

## Root cause of the withdrawn fake-clock attempt

`tick.test.ts` fakes global timers/time while the plugin's `Ledger` holds a `proper-lockfile` lease. That lease's heartbeat/compromise lifecycle depends on real timer/time behavior, so moving fake time can perturb lease freshness and lock ownership. Disabling or weakening lease safeguards, or removing existing assertions, would hide the conflict and was not done. The targeted event→scheduled tick→sender proof added here instead uses a backdated executor event and the real scheduler/lease; it takes about 1.2 seconds.

## Changes and test evidence

- Factored stall threshold eligibility into `isStallEligible(task, now, threshold)`; boundary test covers just-before/at-threshold, fresh/stale active runs, done, newer milestone, and unbound session.
- An aged active run is eligible based solely on the age of its latest recorded input/milestone. Fresh active input resets the evidence window; notification wording explicitly avoids saying dead/interrupted. This avoids suppressing every genuinely stale long-running task while preventing a false alert for recent activity.
- Added a real-time scheduled integration test from executor `run.end` event through ledger evidence/tick to an allowlisted fake sender. It checks one delivery and the durable stall candidate.
- No changes to ledger lease semantics; historical failed fake-clock attempt remains documented in `report.md` and is not represented as passing.

Verified locally:
- `npx vitest run plugins/progress-observer/test`: 9 files / 26 tests passed.
- `npx tsc -b --pretty false`: passed.
- `git diff --check`: passed.
- Scoped Biome command exited 0, but reports the pre-existing `useOptionalChain` warning in `index.ts` plus explicit-any advisories in the new test. Treat lint as warnings, not clean.

## Acceptance gaps; do not open PR or claim complete

The new integration proof does not yet cover threshold-window reset/deduplication across restart, quiet suppression and both allowlist rejection in the stall-specific event→tick path, or the done-but-unaccepted/no-new-milestone case. The threshold helper is a pure business-clock unit test, not a full fake-clock scheduler test. Full requested acceptance is therefore **not complete**; no push, PR, exact CI, merge, production, auth/model, or real-message action was performed. The user-requested historical failed fake-clock attempt is still a failure and remains a failure.
