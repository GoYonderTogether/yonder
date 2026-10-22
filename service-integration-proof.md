# Login service/adapter/outbox integration proof

Scope: focused service/adapter/outbox integration test; not full Runtime registration or model integration, and not provider authentication or human Terminal acceptance.

`packages/core/src/runtime/login-service-integration.test.ts` composes `createLoginOperationService` and `createLoginChildRunner` with a temporary real SQLite database. The injected terminal opener launches a real `/bin/bash` child running a temporary wrapper script; that wrapper execs only a synthetic shell CLI which exits 0. No auth CLI or credentials are involved.

The test invokes the service handler with a trusted synthetic context, asserts immediate `pending`, observes the durable operation state using Vitest's bounded polling (5s maximum; no fixed sleep), drains the persisted outbox, and asserts one delivery to `bound-session` with outcome `succeeded` and operation idempotency key. It also asserts outbox acknowledgement.

Verification performed:
- `npx vitest run packages/core/src/runtime/login-service-integration.test.ts`: 1 test passed.
- `npx tsc -b --pretty false`: passed.
- Scoped Biome check of integration test and adjacent service/runner files: clean.

This intentionally does not claim complete Runtime wiring, full acceptance coverage, a human terminal, real authentication, or production enablement.
