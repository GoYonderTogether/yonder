# Login operation runtime wiring report

Scope: local worktree only; no provider was started and no real login/push was attempted.

## Wiring

- `Runtime` now optionally registers the internal `login_begin` SDK tool in the native `yonder.tools` adapter. Consequently the existing profile catalog/exposure and capability policy apply to dispatch; handler input validation rejects keys beyond `provider`, and operation ownership comes solely from trusted `ToolContext`.
- Login provider IDs are constrained to `builtinProviders()` registry names, never arbitrary provider strings.
- Runtime initialization creates/upgrades the login tables on the actual shared kernel SQLite DB, starts a periodic guarded outbox drain, and stops its timer during `Runtime.close()`.
- Kernel wake adapter submits an outcome to the stored session with a stable `login:<operationId>` `requestId`, `wake: run`; runtime submission storage performs request-ID deduplication. Delivery uncertainty remains permanently claimed by existing service behavior.
- Kernel integration is opt-in only through `YONDER_ENABLE_LOGIN_OPERATIONS=1` (off by default). The runner deliberately throws `Login runner unsupported until CLI integration`; no false pending success is possible. CLI/provider runner remains a separate next step.

## Verification

- `npm run typecheck -- --pretty false`: passed.
- Targeted Vitest: `login-operation-service.test.ts`, `kernel.test.ts`, `boundary.test.ts`: passed (12 passed, 2 skipped); rerun of service + kernel: 9 passed.
- Biome targeted check initially found formatting and existing unrelated `noNonNullAssertion` warnings/errors; formatter was applied. No full suite run (per instruction).
- Existing service tests exercise forged args, capability non-disclosure, durable unknown isolation, concurrency, and timeout. Kernel tests are regression coverage; they do not launch any provider. No end-to-end invocation through a model was done.

## Safety boundary

No auth, production runtime, real login, or push was used. Opt-in tool registration is intentionally disabled by default. CLI work must replace the unsupported runner before enabling it for normal use.
