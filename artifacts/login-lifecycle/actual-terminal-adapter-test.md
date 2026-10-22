# Login host adapter verification

Scope: replace the `start` command's inline login host with `createLoginHostAdapter`, which shares production wrapper creation and terminal result monitoring with the test seam. No database, runtime, real Terminal, authentication, or push behavior changed.

Test: `packages/cli/src/login-host-adapter.test.ts` runs the generated wrapper under real `bash` with a fake Node CLI gated by a file. Its fake launcher returns as soon as bash spawns (before the CLI can exit or write the result). The test asserts finish has not run; after creating the gate file, the wrapper writes its result and the production monitor calls finish exactly once with success/code 0.

Checks:
- `npx tsc -b packages/cli/tsconfig.json --pretty false` — passed.
- `npx vitest run packages/cli/src/login-host-adapter.test.ts packages/cli/src/login-terminal.test.ts` — 2 files, 4 tests passed.
- `npx biome check packages/cli/src/login-host-adapter.ts packages/cli/src/login-host-adapter.test.ts` — passed.

Note: an initial broader scoped Biome invocation including `index.ts` reported existing no-non-null-assertion diagnostics at lines 371, 540, and 579; these unrelated lines were left untouched.
