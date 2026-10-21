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
