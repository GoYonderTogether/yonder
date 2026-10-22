# Login outbox reconciliation

The login operation is persisted independently of its wake notification. `login_status` is a read-only tool scoped to the caller's exact Yonder session and returns only the fixed operation state (`pending`, `succeeded`, `failed`, `cancelled`, `interrupted`, `expired`) and delivery state (`pending`, `unknown`, `confirmed`). A missing operation (including a cross-session ID) returns a generic not-found error. It returns no capability, provider output, error detail, or credential material.

The wake path currently submits with stable request ID `login:<operationId>`. The runtime exposes a `submissionByRequest(conversationId, requestId)` lookup, but this login service adapter is not passed a trusted conversation-ID mapping / scoped receipt query. Accordingly a claimed outbox row is deliberately not replayed or acknowledged after restart: its status is `unknown`. No successful receipt reconciliation is claimed. A future safe reconciliation requires a trusted, session-scoped runtime receipt API proving acceptance/completion for that exact request ID; absence of a receipt must remain unknown, never mean not delivered. `confirmed` currently means the delivery adapter returned success and the outbox was acknowledged, not proof that the user read the notification.

Expiry is only a terminal operation outcome; it is not login success. A successful credential operation can be reported as succeeded even while its wake delivery is unknown.

Verification: typecheck and focused tests are recorded below after execution. No full suite, production runtime, authentication, or push was run.

- `npm run typecheck -- --pretty false`: passed.
- Focused login operation/service/integration tests: 14 passed; after adding session-isolation/status coverage, service tests: 7 passed.
- Biome on changed service files passes; including `runtime/index.ts` reports existing non-null assertion warnings and formatting error(s) in the pre-existing file. No repository-wide lint or full suite was run.
- The requested stronger receipt-based reconciliation / requestId evidence comparison remains unimplemented: the runtime lookup exists in durable storage, but no safe exact context bridge is available in this adapter. Thus claimed rows remain unknown and are never resent.
