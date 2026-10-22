# Exclusive progress-observer ledger

`Ledger.open()` acquires a `proper-lockfile` directory lease before reading `tasks.json`; the lease excludes a second process. `Ledger.close()` waits for pending writes and releases it. The plugin trigger releases on stop. Lease heartbeat uses the configured library options (`stale: 30_000`, `update: 10_000`); after a process crash recovery is governed by proper-lockfile heartbeat/stale detection, not PID inspection. This is a same-UID advisory coordination mechanism, not protection against a malicious same-user process: such a process can alter/remove files and defeat or disrupt the lease. Do not manually remove the lock directory while an owner may be alive. No stale-recovery test was run here.

## Validation

- Added `plugins/progress-observer/test/ledger-process.test.ts`. It spawns independent Node processes that import the built `plugins/progress-observer/dist/ledger.js`. A opens a fresh temporary directory and reports `READY`; B is denied while A owns the lease; A receives a line-based `release`, closes, and exits; a fresh process then opens successfully. Bounded output/exit waits and `finally` cleanup terminate owned child processes and remove only the test temp directory. No fixed sleeps or lock-directory deletion are used.
- `npx vitest run plugins/progress-observer/test/ledger-process.test.ts plugins/progress-observer/test/ledger.test.ts`: **2 files, 4 tests passed** (including real cross-process acquisition).
- `npx tsc -b plugins/progress-observer/tsconfig.json --pretty false`: passed.
- `npx biome check plugins/progress-observer/test/ledger-process.test.ts`: passed.
- A controlled `onCompromised` fail-closed test was not added/run; therefore this report makes no new claim that heartbeat compromise was experimentally triggered. The implementation callback marks the ledger compromised, and `markSending`/write paths check that state through `assertWritable`.
