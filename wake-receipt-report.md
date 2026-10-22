# Login wake receipt closure

Implemented a private Runtime `queryLoginWakeReceipt(session, requestId)` backed only by the durable submission index (`submissionByRequest`), scoped to that exact conversation/request pair. It is not registered as an SDK tool or exposed through cross-session RPC. Kernel recovery passes the exact stable key `login:<operationId>` to this query. A durable matching submission (including queued/placed/done lifecycle records) proves runtime admission; arbitrary activity in a session is not inspected or accepted as proof.

The login outbox drain now scans permanently claimed rows on each pass. Exact positive proof acknowledges the row; absent or mismatched proof leaves it claimed/unknown and never resends. Fresh wake delivery retains the runtime's existing request-ID idempotency.

Crash boundary: a process crash after runtime enqueue/admission but before querying/acknowledging is recoverable through the durable request index. A crash after the outbox claim but before runtime enqueue leaves no receipt; it remains unknown forever and is not automatically retried. This conservative residual cannot be closed atomically without a cross-database transaction; no payload or auth material is added to receipts.

Verification: service tests include temporary SQLite restart reconciliation, negative (wrong proof) staying claimed and exact positive proof ack. No real login, production state, auth, or push was used.
