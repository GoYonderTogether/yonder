# Terminal login monitor work

- Added injectable `launchTerminalLogin`: launches Terminal with wrapper path as an argv item; launch completion is not login completion. Polls the private result and calls the capability callback once; timeout and launch failure return static statuses.
- Result reader uses `lstat`, rejects symlinks/non-files/oversized or extra-field/malformed JSON, and exposes only fixed status/code (never stderr or raw errors).
- Wrapper sets `umask 077` before creating `result.tmp`, then atomically renames it.
- Targeted verification: `npx vitest run packages/cli/src/login-terminal.test.ts packages/cli/src/login-wrapper.test.ts` — 6 passed; `npx tsc -b packages/cli --pretty false` passed; targeted Biome check passed.
- Not done: kernel/handler wiring deliberately deferred to next block. No real Terminal, real login, production auth, or push was used. Global CLI `--home` parser was not independently revalidated in this block.
