# Stalled-state follow-up

Implemented the narrow terminal-status mapping in `plugins/progress-observer/src/ledger.ts`: `run.end` statuses `aborted`, `error`, `limit`, and `interrupted` now set executor state to `interrupted`, making the existing safe fallback eligible; `done` remains `done` and does not imply acceptance. Added ledger coverage proving `aborted` does not claim acceptance and normal `done` remains distinct.

Validation passed: targeted Vitest (ledger + plugin; 4 tests), `npx tsc -b --force --pretty false`, targeted Biome check, and `git diff --check`.

**Not fully addressed:** this does not produce a session-missing state, nor does it reconcile live run status through `sessions.get`. The installed SDK's `SessionInfo` schema exposes `close` (`run-end`/`manual`) but no active run status; `sessions.get` throws `Unknown session: <id>` for absent sessions, while other failures can also throw. Therefore this patch deliberately does not treat age or generic lookup errors as proof of death/missing, and no event→tick→send integration test was added. The requested full blocker remains open pending a reliable SDK/runtime status source and scoped end-to-end test. No real delivery/model/production/auth/push was used.
