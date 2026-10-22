# Sender adapter report

Implemented `plugins/progress-observer/src/sender.ts` as an isolated messages.send adapter; no tick/model/other-module integration was added. It validates references with the SDK `parseRef`, permits only `acct`/`conv`, and passes the complete original target and text to the SDK method. Receipt mapping: explicit uncertain wins as `unknown`; otherwise `ok:true` → `sent`, explicit `ok:false` → `failed`, malformed/undefined receipt and exceptions → `unknown`. Invalid references/kinds are rejected without sending.

Fake-SDK tests cover full target/text capture, success, explicit failure, uncertainty precedence, malformed receipt, invalid target and thrown send. No real send performed.

Checks passed:
- `npx vitest run plugins/progress-observer/test/sender.test.ts` (2 tests)
- `npx tsc -b plugins/progress-observer/tsconfig.json --pretty false`
- `npx biome check plugins/progress-observer/src/sender.ts plugins/progress-observer/test/sender.test.ts`

The pre-existing `plugins/clipboard/test/real-model.test.ts` modification and untracked `phase4-bind-report.md` were left untouched.
