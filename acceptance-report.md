# Login lifecycle acceptance status

## Scope and result

This worktree is `96775f8e43b8ec9059db57a7575db452c67344e8` before this local commit. No production enablement, push, real provider authentication, or real Terminal was used. A single real `/bin/bash` wrapper child was exercised against a synthetic node executable.

**Status: partial; not accepted as full synthetic E2E.** The full requested chain (runtime handler → real wrapper/monitor → SQLite finish/outbox → injected bound-session wake receipt), and its combined success/nonzero/timeout/security assertions, was not completed. Existing adjacent unit tests should not be represented as full chain acceptance.

## Checks added and performed

- Added a test of the actual CLI `parseGlobal` parser using wrapper-form argv `login openai --home <path containing spaces and single quotes>`. It proves `--home` is parsed globally and not left as an unknown positional arg.
- Extended wrapper child test to record and assert the exact argument vector, including the quoted home path. The shell executes only the fake node child; no login CLI/auth is invoked.
- Targeted tests: 4 files, 13 tests passed (wrapper, parser, operation service, child runner).
- `npm run typecheck`: passed.
- `npm run build`: passed (includes macOS helper build/signing step).
- `npm run lint -- ...`: failed because the command invokes repository-wide Biome and detected 2 errors plus 230 warnings across 259 files; this is not a clean lint result. Targeted Biome formatting was applied to changed tests; index still reports existing lint warnings.

## Still required for full acceptance

Build a focused synthetic runtime integration test using existing fixtures that traverses runtime tool registration/handler through wrapper/monitor and durable SQLite finish/outbox, injects bound-session delivery/wake receipt, and asserts success, nonzero, timeout, inability for source session to overwrite binding, unauthorized write/hostexec rejection, prompt pending return, and no secret in tool/error/event payloads. Until then, do not enable the opt-in in production.
