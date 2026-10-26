# Devices controller — W2

W0 base: `0591eae69f45f6973259833e44386a421998b277`. This worktree implements the full-host controller logic under [device execution v1](../../docs/spec/18-device-execution.md). It does not implement W1 pairing/daemon/authorization, W3 relay, a second Agent runtime, a scheduler or an ExecutionEnv replacement.

The plugin contributes `devices_list`, `devices_describe`, `devices_apps`, `devices_open`, `devices_observe`, `devices_execute`, `devices_status`, `devices_cancel`, `devices_close` and the on-demand `devices` skill. It contributes no contexts, presets, hooks or triggers. Installation does not add tools or capabilities to any profile. Inventory is read on demand, never injected on each turn. `list` distinguishes the controller host from `ctx.env`; it never registers that host as an execution device. Cached descriptors remain explicitly cached and connectivity remains unknown until refreshed. Unsupported apps/UI/restore and execution states are preserved.

## Trusted integration boundary (pending W0/W1)

The frozen W0 contract defines signed RPC bytes, but does **not** define a full-host reader for W1 pairing records or the direct TLS / Card WSS connection interface. W2 does not invent a competing on-disk peer/credential format, endpoint path or pairing CLI. Consequently the default export registers the tools and skill with an empty registry. **The default package is not yet a connected-device product.** W0/W1 must supply the management adapter at integration before real devices can appear.

`createDevicesPlugin(registry)` is the integration entry. `registry: DeviceRegistry` returns the current trusted `RegisteredDevice[]` on each tool call. Each record contains a unique deviceId/name, the already-paired controller private `KeyObject`, the pinned device public `KeyObject`, current device grants, and direct/Card `exchange(envelope, signal)` functions. These are trusted program inputs, never model arguments, event text, Card account tokens or grants inferred from a public page. The adapter must consume W1's authoritative pairing/grant storage, not synthesize grants. W2 never generates or saves identity keys.

The exchange adapter owns authenticated TLS/WSS, verified endpoint fingerprints, Card route/frame validation and connection shutdown. It must honor AbortSignal and return the **inner signed envelope**. Card v1 can read the plaintext payload; signatures authenticate endpoints, they do not provide E2EE. W2 uses only the SDK's frozen `publicKeyId`, `signMessage`, `verifyMessage`, `encodeCommand`, `decodeCommand`, `commandDigest` and schemas. No new crypto or public protocol fields are introduced.

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

1. A W1-backed current registry reader plus authenticated direct/Card exchange adapters, wired into `createDevicesPlugin`. Freeze this management boundary centrally rather than duplicating peer stores in W2.
2. `plugins/devices/package.json`: name `@yonder/plugin-devices`, version matching W0, ESM/Node >=22.19, entry `./dist/index.js`, exports types/import from dist, files `dist` and `README.md`, dependencies `@yonder/sdk` at the shared version and already locked `typebox@1.3.27` (schema checking, as in existing plugins). Yonder apiVersion=1, id=`devices`, tools = the nine names above, skills=`["devices"]`.
3. `plugins/devices/tsconfig.json` extending `../../tsconfig.base.json` and referencing SDK; root workspace/lock/tsconfig and changelog wiring. Build must copy `src/skills` to `dist/skills` because TypeScript does not copy Markdown. The dedicated build helper below already does this for isolated verification.
4. Profile opt-in through existing plugin/tools.search/skills selection, without widening default tool permissions.
5. Real W1 direct integration, then W3 Card integration, plus legitimate real Agent model acceptance. Protocol-peer tests below do not establish those results.

## Reproducible isolated checks

From the repository root after the frozen dependencies are installed:

```sh
node plugins/devices/test/build.mjs
node_modules/.bin/vitest run plugins/devices/test/controller.test.ts
node_modules/.bin/biome check plugins/devices
```

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
- Ran the existing `node plugins/ui-companion/build.mjs` to generate only its ignored local static output (no source changes). Default-suite rerun: **758 passed / 1 failed / 40 skipped** (799), 118 files passed / 1 failed / 19 skipped (138), 20.47s. Remaining failure: `plugins/memory/test/wp7.test.ts:62`, hardcoded W43 versus current W44. `git diff --quiet 0591eae69f45f6973259833e44386a421998b277 -- plugins/memory` is exit 0; the same failure and baseline reproduction are already documented in W0-verification. No out-of-scope memory fix was made.
- Root lint: exit 0, 421 files, 0 errors / 495 warnings / 14 infos. W2-only Biome reports 0 errors / 13 warnings (test assertions), after formatting/import corrections in owned files.

Raw temporary evidence: `/tmp/yonder-w2-{build,typecheck,test,test-after-ui,lint,targeted-final,biome-final}.log`. Logs contain compiler/test output, not credentials; they are not shipped as product data. Original failed runs remain recorded above.

Real Agent acceptance is **untested: no authorized model credentials in this isolated home** (`.yonder/auth.json` absent); no fake model was used. The 40 root skips remain skips, not passes. W1/W3 integration is pending their real implementations and the management adapter above. Checkpoint restore remains unsupported.
