# T1 Clipboard Vault verification (2026-10-22)

Scope: isolated takeover worktree `yonder/clipboard-vault-t1-takeover`; no production home or system authorization changes. Original dirty tree evidence and patch snapshots are preserved under `/tmp/yonder-t1-takeover-20261022/` (restricted permissions). The original tree was not edited by this worker.

## Evidence

- `npm ci`: passed (313 packages added; audit reported 0 vulnerabilities).
- `npm run build`: passed.
- `npm run typecheck`: passed.
- Focused clipboard + delivery suite after build: **17 passed / 0 failed / 4 skipped** across 5 files. The 3 Keychain integration tests and 1 real-model test were skipped in this invocation because their opt-in flags were unset.
- Focused Keychain integration (`YONDER_TEST_KEYCHAIN=1 npx vitest run plugins/clipboard/test/keychain.test.ts`): **3 passed / 0 failed / 0 skipped**. This exercised actual macOS Keychain binary round-trip, capture ticket one-use/scope/expiry, and PTY hidden capture using generated synthetic values; output verified correctness without logging those values.
- `npm run build` and `npm run typecheck` both pass on the isolated checkout.
- An initial targeted run before workspace build failed to resolve built `@yonder/sdk` entries, and its HTTPS fixture was not yet built. No plugin tests could run reliably before the documented build prerequisite. After `npm run build`, the focused suite passed. Preserve this initial failed attempt; do not count it as a pass.

## Not run / not verified

- Real-model Luna clipboard test: **not run**. `YONDER_TEST_AUTH` was unset and the isolated checkout's default `.yonder/auth.json` was absent; no credentials were opened or copied. The test requires `YONDER_TEST_REAL=1` and `YONDER_TEST_KEYCHAIN=1`. Therefore the 40k-character exact-byte/model-tool-arguments acceptance remains unverified by a real model.
- After rebasing onto current `origin/main`, `npm run build` and `npm run typecheck`: passed.
- Full repository test suite after rebase (`npm test -- --maxWorkers=4` with exclusive `/tmp/yonder-heavy-test.lock`): **261 passed / 0 failed / 30 skipped (291 total)**, 58 files passed / 15 skipped. The lock was acquired with `mkdir` and removed by the run's exit trap. Real-model test remains skipped for missing credentials.
- Earlier full run before rebase: **255 passed / 0 failed / 30 skipped (285 total)**; retained here as earlier evidence, not superseded as a failure (there were no failures).
- `npm run lint` after rebase: exit 0; **0 errors, 218 warnings, 1 info** (repository-wide; warnings include existing source/tests).
- CI: not yet observed for a PR.
- Browser/Feishu secret capture, signing/update ACL behavior, lock-screen behavior and cross-platform support remain explicitly blocked or unverified as stated in D53/spec.

No test wrote or printed real secrets. The actual Keychain tests only generated synthetic random values and removed their own test items.
