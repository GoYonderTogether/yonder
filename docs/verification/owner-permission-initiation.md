# Owner permission initiation: release preparation

Date: 2026-10-24 (Asia/Shanghai). Worktree: `/tmp/yonder-owner-permission-20261024`. Branch: `fix/owner-permission-initiation-20261024`. Tested implementation: `1f66e7a44acce8a935430ede7d207ca35e1d2e2e` (base `382ea5a`).

## Scope

The main conversation had already minimally checked the implementation. This run did not re-review or redesign it. Under the owner's explicit authorization, only the conflicting human-only initiation passages in `docs/spec/14-execution-capabilities.md` §5.1 (the actual filename) and `docs/decisions.md` D55 were updated in place. Owner-origin input plus existing tool capabilities may explicitly initiate one request/guide/watch; OS approval remains human-only and status remains non-prompting. Added the short Unreleased changelog entry. No implementation files changed in this run.

## Raw local results

Node `v24.21.0`, npm `11.19.0`. A genuine `npm ci --cache .release-prep/npm-cache` installed into this worktree's own non-symlink root `node_modules`; no other checkout's dependencies or model credentials were copied. The npm cache was subsequently moved under the ignored `.yonder/release-prep/` directory.

| Command | Exit | Original result |
| --- | --- | --- |
| `npm ci --cache .release-prep/npm-cache` | 0 | 118.8 s; added 330 packages, audited 355; 4 vulnerabilities (2 moderate, 2 high) |
| `npm run build` | 0 | 30.4 s; TypeScript, macOS bundles and UI built; Power helper build self-check reported 64 repeated calls with descriptors 3 → 3; permission Helper built/signed ad-hoc, not installed or launched |
| `npm run typecheck` | 0 | 1.9 s |
| `npm run lint` | 0 | 1.3 s; checked 328 files; 367 warnings, 14 infos; no fixes applied |
| `npm test -- --maxWorkers=4 --cache=false` | 1 | Vitest duration 32.08 s (wrapper 33.8 s); files: 83 passed, 4 failed, 19 skipped (106); tests: 449 passed, 7 failed, 39 skipped (495) |

The full suite ran **once**, after acquiring `/tmp/yonder-heavy-test.lock` using atomic `mkdir`. This run released only its own lock afterward. npm ci and the full suite each had a 600-second command cap; neither timed out. No retries or later successful results overwrite the failure above.

Build/check/test HOME, TMPDIR and caches were redirected under this worktree's ignored `.yonder/release-prep/` directory to avoid modifying the shared checkout or installed environment. The test run explicitly removed `YONDER_TEST_REAL` and `YONDER_TEST_AUTH` from its environment. This isolation affected at least socket tests: the observed failing socket path was 112 bytes, beyond macOS Unix-domain socket path capacity. This is a test-environment problem introduced by this run's long TMPDIR, not evidence of a permission-initiation regression. The four originally failing files were later rerun once with short isolated temporary paths; see the recheck below.

The permission-specific suites passed within that one full run:

- `plugins/native-automation/test/permission-actions.test.ts`: 47 tests passed.
- `plugins/native-automation/test/permission-rpc.test.ts`: 29 tests passed. Launcher/filesystem/process I/O is mocked; importing the launcher under those mocks does not invoke the real CLI or Helper.

## Targeted recheck of the four failed files

After the full-suite run, only those four files were rerun, once, under the shared `/tmp/yonder-heavy-test.lock` lock and a 600-second timeout. The lock was newly acquired and released by this run. No full-suite rerun or unrelated repair was performed. The test process used these isolated paths (retained for traceability):

- `TMPDIR=/tmp/yp-t.qSjCmw`
- `HOME=/tmp/yp-h.VcFjLS` (not the real HOME; no credentials copied or read)
- cache: `/tmp/yp-c.EV1Pea`
- raw log: `/tmp/yonder-owner-permission-20261024-recheck-vitest.log`

Command: `node_modules/.bin/vitest run plugins/channel-cli/test/channel.test.ts plugins/memory/test/wp3.test.ts plugins/memory/test/wp4.test.ts packages/core/src/release/result.test.ts --maxWorkers=4 --cache=false`, with a 600-second timeout.

Result: exit 0; **4 files passed; 18 tests passed, 1 skipped, 0 failed** (19 total). The previously failing channel socket, memory search assertions, and release result tests passed in this targeted run. This confirms the requested four-file recheck only; it does not erase or replace the original full-suite result of 449 passed, 7 failed, 39 skipped. The skip is within `wp4.test.ts`.

The original seven failures, retained as the initial full-suite record, were:

1. `plugins/channel-cli/test/channel.test.ts`: `passes plugin contracts and exchanges messages over its Unix socket` timed out at 20,000 ms.
2. `plugins/memory/test/wp3.test.ts`: `filters origin/date by record including continuations, private mixtures and cross-year headings` expected one file, received none.
3. `plugins/memory/test/wp3.test.ts`: `keeps registered sources byte/mtime identical and uses configured origin and namespaced paths` expected a namespaced Chinese-path result, received undefined.
4. `plugins/memory/test/wp4.test.ts`: `moves text originals byte-for-byte, indexes origin by path and archives duplicates without another capture` expected one search result, received zero.
5. `packages/core/src/release/result.test.ts`: `offline update completion uses the existing ledger once and leaves no model runs` failed with `connect EINVAL` on the 112-byte isolated `control.sock` path.
6. Same file: `real isolated update of a prepared artifact records restart-required, no-op emits nothing, and failure stays failed` expected two recorded statuses, received none.
7. Same file: `a starting kernel's fresh lock is never taken over, a long-dead lock is` expected `ELOCKED`, received `EINVAL` on the isolated socket path.

No unrelated code fixes were attempted. The memory search fixture visibility explanation was only a hypothesis before the retest; the retest establishes that these tests pass in the corrected environment, not a root cause beyond that.

## Untested and warnings

- Real-model tests: not tested; no real-model credentials supplied/copied or enabled for this run. Other skipped cases include opt-in live/recovery tests, Keychain tests and the card real-backend prerequisites. Preserve the total of 39 skipped tests above rather than treating them as passes.
- No actual permission request, live guide/watch, permission Helper probe/self-check, OS approval, desktop input, TCC access or protected-directory acceptance. No standalone invocation of `scripts/yonder-permissions.mjs` or the live `plugins/native-automation/test/permissions.mjs` diagnostic.
- No installed Helper update/launch, service restart/update/install, version bump, release or tag. The repository's normal build compiled/signed the checkout bundle only.
- npm reported three dependency install scripts not yet covered by allowScripts (`@google/genai`, `fsevents`, `protobufjs`) and deprecated `node-domexception`; no approval/configuration or dependency changes were made.
- Raw command logs and JSON results remain locally under ignored `.yonder/release-prep/` (`build.log`, `typecheck.log`, `lint.log`, `test.log`, `checks.json`, `test.json`).

## Release gate

PR #68 was merged into `main` at `c0b7d8a91f24a745ccdd08e10b75ab3417167749`; its GitHub CI completed successfully. The release-version metadata change does not rerun the local full suite.

The four-file targeted verification gate passed. The original full-suite evidence remains exactly **449 passed, 7 failed, 39 skipped**; it must not be represented as a clean full-suite pass. Permission-specific `permission-actions` (47 tests) and `permission-rpc` (29 tests) had already passed in that original run, for 76 passed permission tests. Real-device authorization and installation were not tested (see above).
