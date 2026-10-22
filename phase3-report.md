# Progress observer phase 3 report

## Scope completed
- Removed unsafe `session.open` matching by `sourceRun`: one parent run can start multiple independent tasks, so this event alone is not a unique correlation. Unmatched task sessions and their later events are left unknown rather than attributed.
- Made `progress_task_register` reject additional properties. `label` remains bounded display data and is not interpreted as instructions.
- Updated plugin reconciliation coverage with two parallel tasks sharing a source run; replay remains idempotent and neither task receives the ambiguous child session/run facts.
- Existing ledger decision boundary remains evidence-checked and quiet-aware; `unknown` delivery fallback explicitly says it will not auto-retry. No external delivery was attempted.

## Validation
- `npx vitest run plugins/progress-observer/test`: passed (2 files, 3 tests).
- `npx tsc -b plugins/progress-observer --pretty false`: passed.
- Full suite attempted with `npm test -- --maxWorkers=4`: 268 passed, 1 failed, 30 skipped. The sole failure was the old plugin test asserting the now-removed ambiguous association; updated test passes in targeted run. Full suite has not yet been rerun after that test update.

## Remaining
- No authenticated one-to-one task correlation hook has been added. Until runtime support supplies a verifiable correlation, executor association must remain unknown. Cross-owner rejection and start-before-register correlation cases consequently remain unimplemented/unverified.
- No bounded model decision call or notifications were added; only the existing pure ledger decision/evidence guard is present. No real messages, production activation, or continuous monitoring.
