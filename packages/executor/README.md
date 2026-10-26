# @yonder/executor (W1 source)

Execution-only device authority and command ledger. It does not import a model runtime or create an Agent. W0 integration owns the package manifest, root workspace wiring, lockfile and public exports; this work package only supplies `src/` and `test/`.

Integration now exposes the `yonder-executor` bin. On Linux, `serve --home <isolated-home>` selects the bundled `createBackendProvider({ home })` bridge and the local Linux desktop provider; `--provider <module>` remains an explicit test/advanced override. Other operating systems require a separately reviewed provider. The `agent-device` driver is optional and must be installed at exactly `0.21.31` in the executor's Node resolution tree before GUI controls can be reported available. It is absent from the default execution-only dependency closure. The compiled `dist/backends/agent-device-worker.js` is included in this package. A headless Linux VM may correctly report GUI operations as unsupported; this is not GUI acceptance.

## Integration contract

- `src/backend-provider.ts` is the W5 provider boundary. A provider reports real `describe`, `apps` and `snapshot` data and registers actions with capabilities, `mutatesDevice`, argument validation, canonical resource paths for path-based actions, and an abortable `execute`. Providers do not authenticate peers or manage grants, sessions, command records or the device writer lock. An aborted action must settle only after its driver or subprocess has stopped.
- `src/store.ts` owns the per-home Ed25519 device identity, offline two-ended pairing records, local grants, durable command/request state and the single-daemon lock. `ControllerPairing` stores the controller key and device trust record in a separate private home. Card chat tokens are never accepted as execution authority.
- `src/executor.ts` is the one signed RPC handler for direct and relay callers. `listenLoopback()` exposes `127.0.0.1` for local integration; `listenDirect()` accepts a private-network IP only with a TLS key/certificate and uses the same signed RPC handler. The controller must verify the certificate fingerprint during pairing and every connection. W5 supplies the actual GUI provider. W4 service wiring must use this store/lock and must not create another executor ledger or writer lock.
- Suggested manifest production dependencies: `@yonder/execution-protocol@0.2.26102510` and `typebox@1.3.27`. Export `src/executor.ts`, `src/store.ts` and `src/backend-provider.ts` after compilation. A temporary manifest outside this repository was used to verify offline packing; it is not the project manifest.

The controller must persist the original `commandBase64` before first network send, then reuse the bytes for any retry. A stale session can query with `commands.status` using current read grant. The executor persists `accepted` and then `running` before calling a provider. A restarted `running` command becomes `unknown` and is never dispatched again. Checkpoint restore is unsupported. A paired disk clone is outside v1 support.

## W1 verification scope

Tests use temporary private homes and real loopback HTTP, signed envelopes, durable files and a killed child process. The test provider writes to a temporary file only; it is evidence for orchestration and does not stand in for a GUI backend. No permanent user pairing or credentials are created. Real GUI behavior and Card integration remain W5/W3 work; the executor CLI/HTTPS listener are tested only with isolated temporary identities.


## CLI, provider module and controller record

The integration manifest must map `yonder-executor` to compiled `dist/cli.js` (which carries a Node shebang). Every command requires `--home`; no user home is inferred. `serve --home <device-home> --provider /absolute/provider.js --host <IP> --port <port> --tls-key <PEM> --tls-cert <PEM>` loads only the named provider module's `createBackendProvider({home})`, listens on HTTPS, and prints `{deviceId,url,tlsFingerprint}`. Loopback HTTP is available for local tests only. The provider module contract is compatible with W5's `BackendProvider` interface. The CLI registers no shell action or Agent creation path.

Offline pairing uses JSON on stdin/stdout:

1. Device `init --home <device-home>` and `pair start --home <device-home> --tls-cert <PEM>` produce identity and short-lived offer/code.
2. Controller `pair connect --phase prepare --home <controller-home>` reads `{offer,code,deviceFingerprint,tlsFingerprint}` and prints a signed proof. The operator must compare the endpoint TLS fingerprint and device key fingerprint before this step.
3. Device `pair approve --home <device-home>` reads `{proof,code,grants}` and prints a signed confirmation. The device operator must verify the controller fingerprint and grant before approval.
4. Controller `pair connect --phase finish --home <controller-home>` reads `{pairingId,confirmation,direct:{url,tlsFingerprint}}` and saves trust.

W2 reads `<controller-home>/device-<deviceId>.json` using `readDeviceTrust(home,deviceId)`. Its format is `{deviceId,publicKey,fingerprint,direct:{url,tlsFingerprint}}`: `publicKey` is SPKI DER base64, both fingerprints are lowercase SHA-256 hex, and `direct.url` is HTTPS. W2 validates the TLS certificate fingerprint on every direct connection and verifies response signatures against `publicKey`. It separately persists original `commandBase64` before first send. Card relay calls `DeviceExecutor.handle()`; it does not get a second ledger or lock. `pending-<pairingId>.json` exists in the controller home only until finish.
