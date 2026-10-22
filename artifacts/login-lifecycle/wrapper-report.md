# Login wrapper implementation report

- Scope: isolated generator and synthetic tests only; no runtime wiring, Terminal opening, auth reads, or push.
- Added `packages/cli/src/login-wrapper.ts`: provider allowlist, shell-safe single-quoted args, mode 0700 temp directory and executable wrapper. Wrapper invokes only the supplied Node executable/CLI entry `login <provider> --home <home>`, inherits terminal streams, and atomically renames a mode 0600 result containing fixed status and exit code only.
- Added four synthetic tests covering allowlist, wrapper permissions, quoted paths/injection resistance, result permissions/content and exit codes 0/7.
- Verification: focused Vitest 4/4 passed; `npm run typecheck` passed; Biome on both changed files passed.
- No service/runtime changes. No auth access. No push.
