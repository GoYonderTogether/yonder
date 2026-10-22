# Progress observer stall-window final verification

Date: 2026-10-22  
Worktree: `/tmp/yonder-progress-stall-20261022/worktree`  
Branch: `yonder/progress-stall-window-20261022`  
Starting branch HEAD: `16ba44c4385c8eb11702fb0c08a52fb07d52d387`  
Merged `origin/main`: `81048b506144263355eae9ecb066d81fa0983328` (`0.2.26102205`)

## Implemented

- The scheduler creates stable candidate IDs from task identity plus the latest executor/milestone evidence timestamps. After a candidate has been consumed, later ticks—including after trigger stop/reopen against the same data path—do not fall through to older pending evidence and notify again.
- Quiet windows and both exact source-conversation and agent allowlists are checked before model invocation and delivery.
- A `done` executor with `accepted !== "accepted"` is not reported immediately. Once the latest real executor/milestone evidence crosses the configured threshold, the observer reports only missing progress; it does not claim completion. An accepted `done` task remains ineligible.
- The latest milestone or resumed `session.input` timestamp defines the next evidence window. Each new window can produce one notification, not one per tick.
- Added a changelog entry. No ledger lease behavior was weakened.

## Verification

- Targeted progress-observer suite: **9 files, 29 passed, 0 failed, 0 skipped** (`npx vitest run plugins/progress-observer/test`).
- Full test suite (`npm test -- --maxWorkers=4`): **93 files passed, 17 skipped; 381 tests passed, 34 skipped, 0 failed**. Skips are existing opt-in/live tests; no real model or external message delivery was invoked.
- TypeScript: `npx tsc -b --force --pretty false` passed.
- Scoped Biome on the changed plugin source/tests: exit 0 with one existing `useOptionalChain` advisory in the untouched task-session validation at `src/index.ts:122`; changed tests are formatted and have no lint advisories. The advisory was not changed because unrelated to this task.
- `git diff --check` passed.
- Stall integration tests use the real interval scheduler and real lease acquisition/release with bounded waits (1–5 seconds); no 40-minute sleep and no global fake timers in the new event→tick/restart proof.

## Regression findings during this continuation

- The first restart test run found repeat sends caused by older pending `run.end` evidence after the same stall candidate was already sent. Fixed by recognizing a consumed candidate for the current evidence window; the real restart/reopen test then passed.
- A subsequent milestone-window test run showed that done-but-unaccepted pending evidence could emit immediately after a recent milestone. Fixed by gating unaccepted `done` notifications on actual stall eligibility; milestone reset and threshold behavior then passed.
- These exploratory failures are recorded here rather than being represented as passing. The pre-existing historical fake-clock failure and rationale are preserved in `stall-verification.md` and were not rewritten or suppressed.

## Explicit scope / not verified

- No owner inactivity, missing executor, or `ask` flow is claimed complete by this report.
- No production monitor, real model, real user/channel message, auth action, merge, release, or production rollout was run.
- PR #34 is open. Its exact required GitHub check (`macOS typecheck, build, test, lint`) was pending when this report was written; this local report is not a substitute for that CI.
