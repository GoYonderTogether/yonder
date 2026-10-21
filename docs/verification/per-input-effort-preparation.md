# Per-input effort preparation — 2026-10-21

Scope: internal pure resolver and proposal only. **Input transport, permission provenance, runtime wiring, native isolation and external adaptive routing are not implemented.** Frozen specs/SDK unchanged; no installed/production changes.

- Fresh task worktree from aaf23e3; `npm ci --ignore-scripts --no-audit --no-fund`: passed (309 packages; node-domexception deprecation warning).
- `npm run build`: passed.
- `npm test -- packages/core/src/runtime/effort.test.ts`: 12 passed, 0 failed, 0 skipped. Uses actual built-in catalog metadata; no inference calls, fake provider or credentials. Checks default resolution, fail-closed authority before validation, invalid strings, supported/unsupported levels, model immutability and no leakage between calls.
- `npm run typecheck`: passed.
- `npm run lint`: exit 0, 127 warnings and 1 info in existing files; changed effort files were separately formatted/checked cleanly. No unrelated warning fixes applied.
- Full default suite: 52 files passed, 10 skipped; 200 tests passed, 19 skipped, 0 failed (219 total). Model-dependent tests remain skipped under the default offline run.
- Real inference/decision, queue isolation, restart and channel UX: not tested for this new option, not yet wired. No credentials copied or provider requests made.

Review design: `docs/proposals/per-input-effort.md`. In particular, native final boundaries may combine a steer and follow-up even with one-at-a-time settings; host-side followUp alone cannot guarantee input isolation.

## Native queue characterization follow-up

- Initial queue-test attempt failed: chord background context was imported from the wrong export; typecheck also caught `.ts` import suffixes and a nonexistent public Tx.submission method. Fixed to documented context export, pinned built module imports, and Tx.submissionByRequest. No product code failure was hidden.
- Corrected queue test: 1 passed, 0 failed/skipped; typecheck passed. Real native SQLite admission/inbox functions preserve request entry metadata over close/reopen, and final boundary co-places one steer and one follow-up. No model calls, no simulated answer and no vendored changes.
- Full suite counts above belong to the preceding commit; only targeted queue/resolver tests are rerun for this test-only follow-up. This does not verify model execution or enable the feature.
