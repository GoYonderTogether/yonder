# Progress observer decision wiring — checkpoint

Base: `e62a36b`.

Implemented in this checkpoint:
- Added a real concurrent `runDecision` regression test: two model decisions wait at a barrier, then race to claim the same evidence; at most one reaches `send`.
- `Ledger.decision` performs evidence validation and durable attempt claim synchronously before yielding to persistence, and returns a unique attempt ID.
- Delivery receipts now require that attempt ID; stale receipts cannot overwrite a later ledger state.
- Decision orchestration treats a stale/policy-invalid claim as a safe skip, re-reads quiet/rate policy immediately before crossing the send boundary, and records the receipt with compare-and-set semantics.

Verification: targeted Vitest (`decision-engine.test.ts`, `ledger.test.ts`): 5 tests passed; `npx tsc -b plugins/progress-observer --pretty false` passed.

Not implemented in this checkpoint: SDK trigger/tick and model/session wiring; trustworthy pending-fact policy and explicit owner-evidence requirement for asks; binding targets to an authenticated/registered source. No real delivery, production/authentication changes, or push performed. Any claim made before a late quiet/rate change is intentionally left unknown (never retried automatically), pending a dedicated safe cancellation/reconciliation design.
