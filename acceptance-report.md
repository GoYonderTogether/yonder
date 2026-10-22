# Login lifecycle acceptance status

## Scope and result

This worktree is `96775f8e43b8ec9059db57a7575db452c67344e8` before this local commit. No production enablement, push, real provider authentication, or real Terminal was used. A single real `/bin/bash` wrapper child was exercised against a synthetic node executable.

**Status: focused service/adapter/outbox integration path passed; not full Runtime E2E.** Added `packages/core/src/runtime/login-service-integration.test.ts`, composing the service handler, real child-runner, temporary SQLite completion/outbox, and injected bound-session wake receipt around a synthetic wrapper/CLI exit-0 path. This does not cover Runtime registration/model behavior or the broader failure/security matrix. See `service-integration-proof.md`.

## Checks added and performed

- Added a test of the actual CLI `parseGlobal` parser using wrapper-form argv `login openai --home <path containing spaces and single quotes>`. It proves `--home` is parsed globally and not left as an unknown positional arg.
- Extended wrapper child test to record and assert the exact argument vector, including the quoted home path. The shell executes only the fake node child; no login CLI/auth is invoked.
- Targeted tests: 4 files, 13 tests passed (wrapper, parser, operation service, child runner).
- `npm run typecheck`: passed.
- `npm run build`: passed (includes macOS helper build/signing step).
- `npm run lint -- ...`: failed because the command invokes repository-wide Biome and detected 2 errors plus 230 warnings across 259 files; this is not a clean lint result. Targeted Biome formatting was applied to changed tests; index still reports existing lint warnings.

## Still required for full acceptance

Broader acceptance remains outside this task: Runtime tool registration/model behavior, nonzero/timeout/security matrix, and human Terminal/provider acceptance have not been established. Do not enable the opt-in in production on the basis of this focused service integration test.
