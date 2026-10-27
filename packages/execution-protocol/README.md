# @yonder/execution-protocol

Model-free v1 device execution schemas and endpoint authentication helpers. Requires Node >=22.19 and the repository's pinned TypeBox; does not import SDK, core, pi or model providers.

The contract is in `docs/spec/18-device-execution.md`. This package has no daemon, ledger, pairing store, tool dispatcher or model/Agent creation API. Production pairing and the execution-only artifact remain separate work.

Requests and responses use standard Ed25519 signatures over exact payload bytes. Callers supply the already paired public key and expected device, principal, direction and request ID; messages do not establish their own trust. TLS/WSS is also required. The v1 Card relay can read payloads and is **not E2EE**.

Persist command bytes before sending. All transports must use the same executor ledger and device lock. Status lookup uses the current principal/device read authorization, never an expired session, and cannot dispatch. A restored `running` record becomes `unknown`; never replay it automatically. Checkpoint restore is unsupported in v1.

Export `schema/relay-v1.json` to Card with the reviewed source commit and SHA-256 in `contract.lock.json`; no published private npm package is assumed.
