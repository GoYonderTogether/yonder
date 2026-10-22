# Login child runner terminal safety

Scope: synthetic login-child runner only; no auth material, production login, or push activity was accessed.

## Changes

- Default spawn path now requires `stdin`, `stdout`, and `stderr` all to be TTYs before spawning. Non-interactive/daemon invocation fails closed with a static error before child creation. The explicit injected `spawnTerminal` remains the controlled adapter seam; its fixture uses ignored stdio and synthetic output.
- Runner `start()` now remains pending until child terminal state and the host-side `finish()` attempt complete. This prevents treating terminal launch/open as login completion.
- Replaced `finish(...).finally(resolve)` with fulfillment/rejection handlers that both settle the runner promise, avoiding an unhandled rejected promise and keeping the operation lifecycle bounded. No underlying finish rejection details are exposed.
- Removed fixed 100ms test sleep; timeout test now awaits `vi.waitFor` on the resulting finish event. Cancellation/exit is checked for exactly-once settlement.

## Verification

- `npx vitest run packages/core/src/runtime/login-child-runner.test.ts --maxWorkers=4`: passed (2 tests).
- `npx tsc --noEmit -p packages/core/tsconfig.json`: passed.
- `npx biome check --write ...` formatted the two touched files; rerun check is included in subsequent verification.
- No full suite was run.

## Explicit limitations

No production terminal adapter was implemented or opened. The synthetic injected adapter test is not human terminal acceptance and does not establish an actual login UX. The default TTY gate permits direct inherited stdio only when all three streams are verified TTYs. A supported LaunchServices/CLI terminal adapter with a distinct child-session completion signal remains future work; this report does not claim one exists or was tested.
