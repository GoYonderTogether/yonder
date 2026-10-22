# Login lifecycle integration status

This is **not a completed end-to-end acceptance report**.

## Implemented in this work block

- `login_begin` remains opt-in via `YONDER_ENABLE_LOGIN_OPERATIONS=1`; default is off.
- `openKernel` now accepts an optional host adapter; the core does not import the CLI package. The kernel refuses to start the tool without an injected adapter.
- CLI start injects a host adapter. It builds a wrapper using `process.execPath` and the trusted `import.meta.url` entry path (not model arguments), invokes the existing Terminal monitor, and sends only fixed outcome/code to the capability-bound finish callback.
- Provider allowlist is fixed to anthropic/openai/google/openrouter in runtime. Wrapper also rejects unknown provider IDs.
- Runner now returns promptly after child startup rather than waiting for the full login; completion asynchronously calls `finish`, feeding existing DB/outbox delivery and bound session submit/wake logic.

## Verification actually performed

- Targeted Vitest: 14 passed across child runner, operation service, terminal monitor, and wrapper tests (`--maxWorkers=4`). These tests are synthetic; **no model participated**.
- `tsc -b packages/core packages/cli --pretty false` passed after wiring changes.
- Biome auto-format was run; its command emitted existing noNonNullAssertion warnings in touched large files, so a clean targeted lint result is not established.

## Not verified / remaining before acceptance

- No true runtime E2E test traversing kernel runtime handler → wrapper → result monitor → operation finish/outbox → bound-session wake was added.
- No parser fixture invoked the actual CLI parser to assert global `--home` placement. The wrapper currently emits `login <provider> --home <home>`; parser ordering still needs explicit fixture confirmation.
- Wrong profile, invalid monitor result, nonzero exit and timeout have not been exercised together through runtime E2E (some component-level tests cover individual monitor/wrapper conditions).
- No full suite, package build, or clean lint was run.

No Terminal was opened, no real login/auth/production credential or push was used. Do not treat this work as accepted or enable the opt-in in production until the missing checks pass.
