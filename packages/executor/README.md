# @yonder/executor (W1 source)

Execution-only device authority and command ledger. It does not import a model runtime or create an Agent. W0 integration owns the package manifest, root workspace wiring, lockfile and public exports; this work package only supplies `src/` and `test/`.

## Integration contract

- `src/backend-provider.ts` is the W5 provider boundary. A provider reports real `describe`, `apps` and `snapshot` data and registers actions with capabilities, `mutatesDevice`, argument validation, canonical resource paths for path-based actions, and an abortable `execute`. Providers do not authenticate peers or manage grants, sessions, command records or the device writer lock. An aborted action must settle only after its driver or subprocess has stopped.
- `src/store.ts` owns the per-home Ed25519 device identity, offline two-ended pairing records, local grants, durable command/request state and the single-daemon lock. `ControllerPairing` stores the controller key and device trust record in a separate private home. Card chat tokens are never accepted as execution authority.
- `src/executor.ts` is the one signed RPC handler for direct and relay callers. `listenLoopback()` exposes only `127.0.0.1` for integration and local testing; a non-loopback direct endpoint requires a TLS adapter that verifies the endpoint certificate fingerprint during pairing. W5 supplies the actual GUI provider. W4 service wiring must use this store/lock and must not create another executor ledger or writer lock.
- Suggested manifest production dependencies: `@yonder/execution-protocol@0.2.26102510` and `typebox@1.3.27`. Export `src/executor.ts`, `src/store.ts` and `src/backend-provider.ts` after compilation. A temporary manifest outside this repository was used to verify offline packing; it is not the project manifest.

The controller must persist the original `commandBase64` before first network send, then reuse the bytes for any retry. A stale session can query with `commands.status` using current read grant. The executor persists `accepted` and then `running` before calling a provider. A restarted `running` command becomes `unknown` and is never dispatched again. Checkpoint restore is unsupported. A paired disk clone is outside v1 support.

## W1 verification scope

Tests use temporary private homes and real loopback HTTP, signed envelopes, durable files and a killed child process. The test provider writes to a temporary file only; it is evidence for orchestration and does not stand in for a GUI backend. No permanent user pairing or credentials are created. Full installation, TLS listener wiring, GUI behavior and Card integration remain integration/W5 work.
