# Devices controller — W2

W0 base: `0591eae69f45f6973259833e44386a421998b277`. This worktree implements the full-host controller logic under [device execution v1](../../docs/spec/18-device-execution.md). It does not implement W1 pairing/daemon/authorization, the W3 relay service, a second Agent runtime, a scheduler or an ExecutionEnv replacement.

The plugin contributes `devices_list`, `devices_describe`, `devices_apps`, `devices_open`, `devices_observe`, `devices_execute`, `devices_status`, `devices_cancel`, `devices_close`, the on-demand `devices` skill, and a `devices-connections` lifecycle trigger that only closes owned sockets on shutdown. It contributes no contexts, presets or hooks. Installation does not add tools or capabilities to any profile. Inventory is read on demand, never injected on each turn. `list` distinguishes the controller host from `ctx.env`; it never registers that host as an execution device. It reports targets and effective capabilities per current grant, never a combined grant, and filters cached descriptor targets and their scoped support capabilities through current read grants. Cached descriptors remain explicitly cached and connectivity remains unknown until refreshed. Unsupported apps/UI/restore and execution states are preserved.

## Configured default plugin and W1 pairing records

The default export now reads the actual W1 `ControllerPairing` layout and connects through production direct/Card adapters. No injected registry is required. With no configuration it performs no discovery outside an explicitly selected pairing directory, creates no identity, registers no user device, and opens no network connection during setup.

Owner configuration fields (validated by the plugin schema):

| Field | Meaning |
| --- | --- |
| `pairingHome` | Explicit absolute W1 controller pairing directory. On demand, enumerate `device-<UUID>.json`, read `controller-key.pem` and each `{deviceId,publicKey,fingerprint,direct?}` record, verify Ed25519 identity/fingerprint binding, and use its paired direct route. W2 never writes these files. Unix identity files must be private. |
| `devices[].deviceId/name` | Label/configure an already paired device. Configuration without the matching W1 record is rejected. Unconfigured paired records are still discoverable with no read grant until the owner supplies its grant snapshot. |
| `devices[].grants` | Actual W0 `Grant[]` snapshots from the device operator's W1 `grants list --home` output. W1 does not include grants in controller trust records and W0 has no grant-discovery RPC, so this explicit configuration supplies the grant IDs needed by `sessions.open`. This is not a second grant authority or ledger: W1 independently checks current grants/revisions/revocations/resources on every operation. Never invent a grant ID or promote Card/public input to a grant. |
| `devices[].direct` | Optional `{url,tlsFingerprint}` with the paired HTTPS endpoint and certificate DER SHA-256 hex. Normally read from W1's record. A configured route conflicting with a recorded paired endpoint is rejected. |
| `devices[].card` | Optional `{baseUrl,credential,peerDeviceId}`. `baseUrl` is a Card HTTPS origin, `credential` references an existing explicit Card **device bearer** API-key credential via `PluginAPI.credentials`, and `peerDeviceId` is the peer's Card UUID (separate from W0 executor UUID). No token is accepted from model arguments or public messages. |
| `allowInsecureLoopback` | Default false. Explicit test-only HTTP/WS for literal `127.0.0.1` or `::1`; never permits cleartext remote endpoints. Direct HTTPS always requires the pinned fingerprint. |

Use W1's existing offline `pair start` / `pair connect --phase prepare` / `pair approve` / `pair connect --phase finish` management flow, with explicit homes and human-verified TLS/device/controller fingerprints. Supply the already-approved grant snapshot and optional Card credential reference to the plugin configuration, then select the plugin/tools/skill through existing profile settings. W2 does not mint credentials, approve pairing or modify the formal user home. The W1 runtime/CLI and plugin package must be wired by W0 as described below.

`createDevicesPlugin(registry)` remains a narrow trusted injection option for embedded hosts/tests; the normal default uses `configuredRegistry`. Both paths return the same `RegisteredDevice` records. Identity keys, grants and exchange functions are trusted program inputs, never tool arguments. W2 does not generate or save identity keys.

`directRoute` uses the W1 `/execution/v1` signed HTTP endpoint. HTTPS verifies the explicitly pinned certificate SHA-256 and hostname **before sending request bytes**, including a self-signed paired endpoint; HTTP exists only under the explicit loopback opt-in. `CardRoute` implements W3's single-use 60-second `/api/execution/ticket`, authenticated `/ws/execution`, peer-bound relay messages, route correlation, size limits, aborts and shutdown. It obtains a fresh ticket on connection, keeps one socket per peer, and never automatically reconnects or replays a frame. Both endpoints must connect to the same Card server process, and the execution endpoint must pass the received envelope to the existing W1 `DeviceExecutor.handle()` and send its signed response on the same routeId. W2 owns only the controller side of that connection.

Card v1 can read payload bytes; signatures authenticate endpoints, they do not provide E2EE. W2 uses only the SDK's frozen signature/command helpers and schemas. No new crypto or public protocol fields are introduced. Transport/query failures retain unknown/offline states; a healthy socket is not proof of a ready executor.

The controller validates result schemas and device/principal/request/command/session/target bindings. `open` selects one current target grant and intersects its capabilities with the actual ToolContext; it never unions multiple grants into one session. Origin comes from actual `ctx.agent/profile/session`. Readonly contexts cannot call execute/cancel through the proxy. Local session handles belong to that exact origin; old command status can be queried by a new model session under current read+network authorization without the old lease. W1 must still enforce backend action schemas/capabilities/resource roots, current grants at dequeue, result redaction, leases, command deduplication, daemon/device locks and cancellation termination. W2's local grant snapshot is not the final authorization authority.

## Command persistence and recovery

`execute` requires an explicit UUID `commandId` in the original tool call. The model picks it once for an intended action; the controller saves its identity, original base64 bytes, digest, target and real origin **before any submit**. Records live only in the plugin-private `api.paths.data`:

- `commands/<deviceId>/<principalId>/<commandId>.json`: immutable prepared bytes. Files are 0600 and newly created directories 0700; file and newly created directory ancestors are synced before sending. Atomic hard-link publication refuses replacement, including simultaneous controllers.
- `sessions/<deviceId>/<principalId>/<deviceSessionId>.json`: owned session authority and local closed marker.
- `observations/<deviceId>.json`: last signed describe result, treated as a cached observation, never current permission or connectivity.

An existing command ID only queries `commands.status`. A different payload under that ID conflicts. A prepared record with no executor record remains `COMMAND_NOT_FOUND`; it is never silently re-dispatched. A crash between local persistence and sending can therefore require explicit operator reconciliation. This deliberately preserves the no-duplicate-side-effect contract.

Only read RPCs can fall through from direct to Card. Submit/open/close/cancel are sent on one route without automatic resubmission. After an unconfirmed submit, the controller queries the original ID across available routes; failure returns `OUTCOME_UNKNOWN` and the same ID. Restart, lease expiry, `unknown`, a lost ACK or a changed route do not allocate a new ID. No command results are cached locally for disclosure under an obsolete grant. Closing invalidates the local handle before network IO; it does not prove an in-flight process terminated. Cancellation preserves the executor's actual receipt.

## Integration work owned by W0

No package manifests, root workspaces/references/lock, SDK, protocol, executor, Card or release/IPC files are changed here. Integration needs:

1. Retain W1's documented controller record fields and management CLI. W2 now supplies the reader and both transport adapters; no empty-registry adapter or new pairing format remains to implement.
2. `plugins/devices/package.json`: name `@yonder/plugin-devices`, version matching W0, ESM/Node >=22.19, entry `./dist/index.js`, exports types/import from dist, files `dist` and `README.md`; production dependencies `@yonder/sdk` at the shared version, already locked `typebox@1.3.27` and **`ws@8.22.0`**; build typing **`@types/ws@8.18.2`**. Yonder apiVersion=1, id=`devices`, tools = the nine names above, skills=`["devices"]`, triggers=`["devices-connections"]`. These versions already exist in the frozen lock via other official plugins; this worktree does not edit manifests/lock.
3. `plugins/devices/tsconfig.json` extending `../../tsconfig.base.json` and referencing SDK; root workspace/lock/tsconfig and changelog wiring. Build must copy `src/skills` to `dist/skills` because TypeScript does not copy Markdown. The dedicated build helper below already does this for isolated verification.
4. Profile opt-in through existing plugin/tools.search/skills selection, without widening default tool permissions.
5. Package/install and real Agent model acceptance. Actual W1 TLS + W3 relay component integration is now covered below; it does not establish installed product or model autonomy acceptance. The execution daemon still needs its own W3 socket binding using `DeviceExecutor.handle()`; the integration test supplies a thin transport binding, not a second ledger.

## Reproducible isolated checks

From the repository root after the frozen dependencies are installed:

```sh
node plugins/devices/test/build.mjs
node_modules/.bin/vitest run plugins/devices/test/controller.test.ts
node_modules/.bin/biome check plugins/devices
```

For real component integration, set `YONDER_W1_ROOT` and `YONDER_CARD_ROOT` to the corresponding implementation trees and run `vitest run plugins/devices/test`. This test uses W1's actual pairing/storage/executor/TLS listener, W3's actual HTTP ticket/WS/auth/DB routes, temporary PostgreSQL/Redis, and a real local Node child process. Card's original migration entry runs in its own subprocess with the correct working directory. No cross-tree source or manifest is edited. Without those explicit roots, that one integration test is skipped and must be reported as untested.

The build helper compiles SDK and W2 without changing shared manifests. The SDK contract test stages a temporary package with the proposed contribution metadata, compiled files and skill, then runs `checkPlugin`. It does not imply root packaging is already wired.

Tests create isolated temporary data directories and short-lived Ed25519 identities, bind only `127.0.0.1`, and use a real local Node child process through a signed protocol peer. The direct/Card routes share that peer's command identity. It is explicitly a protocol test peer, **not W1/W3 E2E or a model simulation**. No real user device, production Card, long-lived credentials, OAuth data, service installation, VM or OS permission setting is accessed. A sandbox blocking loopback needs execution permission; do not count that denial as product failure or replace networking with a fake model.

## Verification log — 2026-10-26

Worktree: `/Users/zoran/Documents/Codex/2026-10-26/task-5/yonder-devices-w2`; branch `codex/multidevice-w2-20261026`.

- Offline `npm ci --ignore-scripts --no-audit --no-fund`: exit 0, 335 dependencies.
- Initial manual compiler invocation used the old `typescript/bin/tsc.js` path and failed; the installed TypeScript 7 CLI is `.bin/tsc`. The second manual invocation required `--ignoreConfig`. Dedicated `test/build.mjs` then compiled successfully.
- First sandbox test: 1 passed / 12 failed / 0 skipped; all 12 failures were loopback `listen EPERM`, not assertions. Permission-reviewed loopback rerun: 13 passed / 0 failed / 0 skipped, including real child-process dispatch and SDK staged-package validation.
- Initial Biome check found format/import errors; `biome check --write plugins/devices` corrected only owned files.

- Final dedicated build after capability alignment: exit 0. Final W2 tests: **13 passed / 0 failed / 0 skipped** (828ms). Cancel is checked with exactly the frozen exec+network set; read+network cannot cancel.
- Root `npm run typecheck`: exit 0. It covers existing root references; W2 is separately compiled by the dedicated build because its manifest/reference is reserved to W0.
- Root build with temporary Clang/Swift caches and ad-hoc signing selected: exit 1. TypeScript and local macOS compilation reached SwiftPM, which failed with `sandbox-exec: sandbox_apply: Operation not permitted`. No privileged full-build retry, signing credential access, native service install or launch was attempted. This leaves the complete native build unverified in this worktree.
- First permission-reviewed default suite (`YONDER_TEST_REAL=0`): 744 passed / 15 failed / 40 skipped (799). Fourteen failures arose because the failed native build prevented the subsequent companion static asset build; the other failure was the known memory date fixture.
- Ran the existing `node plugins/interaction/build.mjs` to generate only its ignored local static output (no source changes). Default-suite rerun: **758 passed / 1 failed / 40 skipped** (799), 118 files passed / 1 failed / 19 skipped (138), 20.47s. Remaining failure: `plugins/memory/test/wp7.test.ts:62`, hardcoded W43 versus current W44. `git diff --quiet 0591eae69f45f6973259833e44386a421998b277 -- plugins/memory` is exit 0; the same failure and baseline reproduction are already documented in W0-verification. No out-of-scope memory fix was made.
- Root lint: exit 0, 421 files, 0 errors / 495 warnings / 14 infos. W2-only Biome reports 0 errors / 13 warnings (test assertions), after formatting/import corrections in owned files.

Raw temporary evidence: `/tmp/yonder-w2-{build,typecheck,test,test-after-ui,lint,targeted-final,biome-final}.log`. Logs contain compiler/test output, not credentials; they are not shipped as product data. Original failed runs remain recorded above.

## Connected-controller follow-up verification

The original controller commit `7b96663b558a2fc04fa0ac6dc9ef65b9bed3bd83` is retained. This follow-up adds the default W1 file reader, direct pinned HTTPS, Card ticket/WS adapters and socket lifecycle, and removes the earlier empty-registry integration gap. All changes remain inside `plugins/devices/**`; W1/W3 and shared manifests are read-only.

- First adapter compile: two errors (optional API-key value narrowing and Node 22 TLS typings without AbortSignal); fixed by checking the resolved key and explicitly wiring handshake abort to the TLS socket. Dedicated W2 build then passed.
- First real component run: **13 passed / 1 failed / 0 skipped**. The failure was Card's migration wrapper resolving `migrations/` relative to W2 cwd. Fixed only the W2 harness: invoke Card's original migration function in a subprocess with Card's server cwd.
- Second component run: **14 passed / 0 failed / 0 skipped**, 2.40s, while W1/W3 were completing their own commits. This intermediate result is not the final source baseline.
- Final real component run against clean committed sources: **14 passed / 0 failed / 0 skipped**, 2 files, 2.21s. W1=`ac29e39207cd1f23bc831d95cfdcf1fabff713f5`; W3=`269e75fede8a535d0ed9c117e6c2e67ed775ac8e`. Important source-file SHA-256 values are logged and asserted equal before/after the test. This verifies the default configured plugin's discovery → describe/apps → open/observe → real child-process action → status → close path, a wrong TLS pin rejection, and lost direct submit ACK → Card status with the original command ID and exactly one dispatch per intended action. W1's existing ledger remains the sole executor ledger. The executor-side WS binding in this harness is explicitly a thin transport binding to the real `handle()` method; no fake executor/model is used.
- Final dedicated build and root typecheck: exit 0. Root lint: exit 0, 424 files / 0 errors / 514 warnings / 15 infos. W2-only check: 0 errors / 32 warnings / 1 info (primarily test non-null assertions and runtime-schema casts).
- Final default suite without cross-tree opt-in: **758 passed / 1 failed / 41 skipped** (800), 118 files passed / 1 failed / 20 skipped (139), 18.70s. Same unchanged memory W43/W44 failure. The one additional skip is the explicit-roots component integration test, separately verified above; the original 40 skips remain unchanged. Native full-build sandbox limitation above is unchanged; no unrelated native build retry was performed.

Follow-up raw evidence: `/tmp/yonder-w2-connect-{tests,tests2,final,typecheck,lint,full-test,biome-final}.log`. No formal home/credentials, production Card, OAuth data, VM or OS security setting was used or modified. Temporary TLS certificates, controller/device identities, database device sessions and file effects were cleaned up by the test.

Real Agent acceptance is **untested: no authorized model credentials in this isolated home** (`.yonder/auth.json` absent); no fake model was used. The 40 root skips remain skips, not passes. W1/W3 component integration does not replace final installed-product/model acceptance. Checkpoint restore remains unsupported.

## Grant-scoped discovery follow-up

`devices_list` now reports current targets and effective capabilities **per read grant**, instead of presenting a cross-grant capability union. Both a fresh `devices_describe` response and a previously cached descriptor are projected through the current local read grants: target entries and support capabilities scoped to removed targets disappear. With an expired or revoked local grant, the cached descriptor is omitted. The single-grant `devices_open` selection is unchanged.

- The new regression caches a signed two-target descriptor, narrows to one target and read-only authority, and checks fresh discovery, cached output, refreshed description, expiration and revocation. It also checks the ToolContext capability intersection.
- Dedicated W2 build and strict TypeScript check of the modified test: exit 0. Biome on changed code/test files: exit 0 with pre-existing non-null test warnings.
- Ordinary sandbox test: 1 passed / 13 failed because loopback `listen` returned `EPERM`. Permission-reviewed isolated run: **14 passed / 0 failed**. Real component run with temporary W1 HTTPS, W3 Card, PostgreSQL and Redis: **15 passed / 0 failed**. W1 source at test time: `38969100122f7d847b8f8968d9a7bd2cbecd10bc` (separate CLI/Card changes were in progress); W3: `269e75fede8a535d0ed9c117e6c2e67ed775ac8e`.

`devices_list` is an offline view of the operator-supplied W1 grant snapshot. A revocation performed only on a remote executor cannot appear in this offline view until the controller configuration is updated; the executor still rejects subsequent unauthorized RPCs. W0 defines no grant-discovery RPC, so a live revocation feed requires a separate contract decision rather than an invented W2 endpoint.
