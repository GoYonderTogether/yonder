# Terminal monitor persistence fix

The production Terminal monitor now awaits the capability-bound completion callback. A rejected persistence attempt is caught, reported through a fixed generic diagnostic (no error/capability/result data), and leaves the operation pending/unknown rather than falsely treating it as complete. Production monitor promise rejection is also caught and logged generically. The monitor test confirms exactly one awaited completion attempt and safe handling of rejection.

Verification: `npx vitest run packages/cli/src/login-terminal.test.ts` passed (3 tests); `npx tsc -b --force` passed. Scoped Biome check reports formatter issues before formatting and existing warnings in untouched index.ts lines; rerun after formatting.

Scope note: this patch does **not** add the requested full CLI-host-adapter + real service/SQLite/outbox integration proof; the existing child-runner integration is not a substitute. Outbox blind-retry/unknown semantics were deliberately left unchanged per instruction. Real Terminal/auth/push were not used.
