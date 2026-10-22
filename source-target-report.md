# Source/target provenance correction

- SDK reference semantics are implemented by `packages/sdk/src/index.ts:parseRef`; target validation now reuses it and persists only `acct`/`conv` refs. This accepts `conv:<instance>:<id>` and `acct:<instance>:<id>` under the SDK's exact rules, rejecting malformed values.
- Registration uses only `ctx.event` when it is `message.in` for source run/target provenance. It does not infer from historical `ctx.events` or model parameters (`to`). A valid message event with invalid conversation metadata retains its message event ID but has no target. Missing/non-message context gets neither provenance nor target. Ask remains rejected absent a trusted gate.
- Regression test covers real conv/account refs, absent source, non-message event, model-provided target, invalid ref, and historical-event spoofing.
- Validation: targeted Vitest passed; `npx tsc -b plugins/progress-observer --pretty false` passed; Biome passed with 11 pre-existing explicit-any warnings in plugin.test.ts.
- No production delivery/auth/push/full suite performed.
