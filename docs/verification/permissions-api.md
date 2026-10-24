# Shared permissions API verification

Date: 2026-10-25 (Asia/Shanghai). Base: `1d4836e6da4a5ead0424864c4955ca22a81714ed`.
Scope: SDK/core shared facade, existing native-automation macOS permission driver, native common authority prompt. No service host, Windows driver, account authorization migration, media capture, memory changes, installation or release.

## Implementation evidence

- `packages/sdk/src/types.ts`: PermissionRequest, PermissionResponse, PermissionProvider, PermissionsAPI and required PluginAPI.permissions. Request has only provider/action/kind/optional timeout (seconds). Platform response retains the actual driver output rather than synthesizing a universal grant.
- `packages/sdk/src/testing.ts`: permissions joins the existing contribution collector and manifest comparison. Namespace, nonempty scope/kinds, duplicate kinds, callable invoke, undeclared/duplicate contributions are checked. Validation cannot invoke permission APIs.
- `packages/core/src/permissions.ts`: single registry, duplicate rejection, selected-plugin filtering, malformed/unknown provider/kind rejection, original request/context/signal forwarding and cancellation before/after awaits. No database or approval queue.
- `packages/core/src/kernel/index.ts`: creates that registry once, supplies it to plugin services and the core permissions tool. Checks exact active tool context, stored session identity/profile and active session configuration before resolving provider selection.
- `packages/core/src/runtime/index.ts`: assertToolContext uses the existing native tool invocation map, rejecting fabricated contexts even for a real stored session.
- `packages/core/src/tools/permissions.ts`, `tools/catalog.ts`: list/status/request/guide/watch tool with strict arguments; standard runtime catalog and deferred spec discovery use the normal adapter, not a separate tools path.
- `packages/core/src/plugins/index.ts`, `kernel/workspace.ts`: setup-only registration, no setup list/invoke, inspector registry cannot execute operations.
- `plugins/native-automation/src/index.ts`: registers native-automation with nine existing kinds. Shared permissionRun is used by the provider and old desktop actions; existing check/requireOwnerOrigin/causal continuation rules remain. Local execution and exec/read/write/message remain required. Only guide/watch accept timeout (0 < seconds <= 600). Non-macOS returns actual platform and unsupported, with no driver launch. Native result/identity/state are returned unchanged. No camera/microphone collection was added.
- `packages/core/src/prompt/content.ts`: the requested English paragraph is in common.authority; previous source authority, credential and blocked-route boundaries remain.

## Checks actually performed

All tests below are deterministic contracts with mock permission transport/providers or isolated temporary SQLite/files. They do not invoke a model, live Helper, OS permission dialog, real browser, Keychain or protected user directory.

| Batch | Files | Passed | Failed | Skipped |
| --- | ---: | ---: | ---: | ---: |
| Initial focused contracts | 7 | 161 | 0 | 0 |
| Added loader/validation/native manifest cases (SDK malformed-id/scope cases added) | 3 | 18 | 0 | 0 |
| Changed native cancellation/raw-state and catalog coverage | 2 | 99 | 0 | 0 |
| Active-context rejection on real isolated runtime/SQLite | 1 | 1 | 0 | 0 |

Batches overlap: **179 distinct test cases in 11 files**, not 279 distinct cases. Expanded files were rerun after their code/test changes; unchanged passing files were not repeatedly rerun. Full suite was not run.

Final per-file counts:

- packages/sdk/src/permissions.test.ts: 12
- packages/sdk/src/types.test.ts: 1
- packages/core/src/permissions.test.ts: 19
- packages/core/src/plugins/index.test.ts: 3
- packages/core/src/plugins/permissions.test.ts: 5
- packages/core/src/prompt/permissions.test.ts: 1
- packages/core/src/runtime/catalog.test.ts: 3
- packages/core/src/runtime/permission-context.test.ts: 1
- plugins/native-automation/test/permission-actions.test.ts: 96
- plugins/native-automation/test/permission-rpc.test.ts: 37
- plugins/native-automation/test/contract.test.ts: 1

Build/check results:

- `npm ci --ignore-scripts --cache <worktree>/.npm-cache`: passed. Existing lockfile/dependencies only, isolated cache subsequently removed. No dependencies added.
- `tsc -b`: passed (TypeScript build).
- `node plugins/ui-companion/build.mjs`: passed (existing UI bundle build; UI behavior was not changed or visually tested).
- Final `npm run typecheck` (`tsc -b --force`): passed.
- Final `npm run lint`: exit 0, 341 files, 385 warnings and 14 infos. No claim that the repository is warning-free; unrelated warnings were not cleaned up.
- `git diff --check`: passed before delivery.

Earlier failures, retained rather than hidden: first typecheck found missing permissions wiring in inspectionServices; this was fixed. The initial standard `npm run build` stopped in tsc because the new prompt test treated commonPrompt (string) as an array; fixed to use builtinPromptSections. No tests failed. Standard build did not reach its native packaging phase.

The complete `npm run build` was not repeated: its macOS phase executes a PowerHelper self-check and `build-permissions.mjs` queries signing identities with `security find-identity`. Those conflict with the explicit no-Helper/no-Keychain task boundary. TypeScript and UI build portions were verified separately; macOS packaging/signing is **not tested** here.

## Not verified / integration handoff

- No live macOS permission prompt, grant/denial/revocation, responsible-identity attribution, real Helper resource operation or update grant retention.
- The win32 unsupported assertion is a platform-contract test on macOS, not Windows execution, signing or device verification. No Windows native driver was implemented.
- No real-model end-to-end tool use; core tool → real registry → mock provider and plugin facade → same registry are covered. Active invocation rejection uses a real runtime without a model. Standard catalog offer/search selection is asserted; a model's deferred spec request is not exercised live.
- No service host changes; parent process relationships are not claimed as proof of OS authorization.
- No full suite, push, merge, release, install, restart, signing configuration change, secret access or memory implementation change.

Local logs are in the implementation worktree (`.targeted-tests.log`, `.added-tests.log`, `.changed-tests.log`, `.context-tests.log`, `.typecheck-context.log`, `.lint-final.log`, `.build-final.log`, `.ui-build.log`). They are ignored local artifacts, not release evidence from real devices.
