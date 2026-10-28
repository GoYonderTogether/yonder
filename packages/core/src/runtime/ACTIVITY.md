# Owner-local execution presentation

`Runtime.activity(session)` keeps the compatibility `state` (`running`, `waiting`,
`idle`) and adds JSON-only `execution`. `kernel.terminal.activity()` exposes it on
both each open session row (`agents[].tasks[]`) and the aggregated agent row.
These rows describe runtime sessions, not task-ledger tasks.

- `running`: native run, queued runnable input, active tool/background work or
  compaction. It does not claim a task-ledger item is active.
- `retrying`: current `pi.live` generation/fallback backoff, or compaction backoff
  with no simultaneous normal execution. `retryAt` is the native retry deadline.
  Error text is never projected. A resumed request immediately becomes `running`.
- `waiting-input`: only the existing pure `interaction_result` interaction wait.
- `blocked`: no current execution and a tracked terminal `activityIssue` exists.
  Its legacy `state` stays `idle`, not `waiting`.
- `idle`: none of the above.

The existing `yonder.session` document stores `activityRunId` and `activityIssue`.
`beforeAgent` records the actual run (first native input ID), clears the previous
issue, and does not run for admission alone. The existing receipt observer writes
an issue only when that cursor still matches and no native automatic work remains.
It runs before `onRun`, including during existing recovery of unfinished settlement
projection. No new scheduler, history scan or retry policy is introduced.

`issue` contains only `{code, since, runId}`. `since` is the first core observation
of that terminal issue, retained on repeated observation. Codes are `model_error`,
`no_model`, `faulted`, `orphaned`, `execution_error` (core input/execution guard),
`runtime_limit` (core stop reason), or the stable catch-all `execution_failed`.
They are not parsed from error text. Neither retry/fallback nor old interruption
notices create an issue. Successful settlement, genuinely live recovery/new run,
or explicit cancellation clears it. Cancellation also invalidates the cursor, so
replaying an old receipt cannot refill the issue. An upgraded database without a
cursor never adopts historical failures.

Agent aggregation orders normal running > retrying > current input wait > blocked
> idle. All contributing session rows remain available for secondary labels.
Closed sessions and archived agents are excluded. Identity-less task sessions are
not attributed by preset or cwd; their existing native parent tool/background
ownership continues to provide the parent's actual busy state. Manual compaction
without a run has no run receipt and does not invent a run-scoped terminal issue.
