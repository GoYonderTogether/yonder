# Shared permissions API verification

## 0.2.26102506 API-only release checks (2026-10-25)

The release adds the shared SDK/core permissions facade and native-automation provider only. It does not add the thin service host, location, a new service entry point, or an OS authorization inheritance mechanism. Live TCC grant/denial/revocation, responsible identity, protected resources, update grant retention and model/Kernel/OS E2E remain **not verified**. Installation and service readiness are separate update-job facts, not established by these checks.

The remote baseline was official `v0.2.26102505` / main `7df082c5bc9d65e1a44a0e26121ff0e6a4fe92d9`; no active CI or competing release was observed at preparation. All Yonder workspace versions and internal dependencies are aligned to `0.2.26102506`; vendored pi-durable remains `1.3.0`.

Under the owned `/tmp/yonder-heavy-test.lock`, the **only local full-suite invocation** was `npm test -- --maxWorkers=4`: **662 passed / 1 failed / 39 skipped (702)**, with **109 files passed / 1 failed / 19 skipped (129)**, exit 1. Failure: the pre-existing `cleanup.mjs` direct setup fixture omitted the newly required `api.permissions.register`. The fixture and the two other direct native setup scripts now supply that setup-only registration service; no production fallback or permission bypass was added. Only `cleanup.test.ts` was rerun with `--maxWorkers=4`: **1 passed / 0 failed / 0 skipped**, exit 0. The full suite was not repeated locally; its original failure is retained, not reported as all green. The other two scripts received syntax checks only, not live browser/Helper execution.

Standard `npm run build` **passed**, including the normal macOS Swift packaging, PowerHelper self-check, existing local signing selection and UI build. `npm run typecheck`, `npm run lint`, and `node scripts/check-pi-durable-workspace.mjs` also passed. Lint retained **402 warnings / 14 infos**, 0 errors; the three fixture files passed focused Biome checks after their edit. No signing identity configuration was changed, no credentials exported, and the installed Helper/TCC were not operated on. Default skipped tests (including opt-in real-model checks) remain untested, not passes.

Raw logs, commands, UTC start/end times and exit codes: `/tmp/yonder-permissions-api-release-20261025-EVIDENCE/` (`build.log`, `typecheck.log`, `fullsuite.log`, `lint.log`, `workspace.log`, `cleanup-targeted.log`, `fixture-lint.log`). Final remote PR/CI/release and independent update-job facts are recorded in `/tmp/yonder-permissions-api-release-20261025.md`; the earlier integration evidence below is preserved as history.

## Initial API-only integration on the official .05 base (2026-10-25; historical pre-release stage)

Base: `7df082c5bc9d65e1a44a0e26121ff0e6a4fe92d9` (`0.2.26102505`). Worktree: `/tmp/yonder-permissions-api-final-20261025`, branch: `feat/permissions-api-final-20261025`.

**At this initial stage: implemented and locally verified on this branch; not released, not installed, and not live-TCC verified.** The installed .05 does not contain this API. This integration is independent of the unresolved thin service host: only `afebc8d` (SDK/core/native provider) and `f8905fe` (real adapter contract) were transplanted. No changes from `7469ec8` or `428fbf5`, no service launch/install changes, and no location interface or collection.

The only cherry-pick conflict was the insertion point in `packages/sdk/src/types.ts`: both .05's `ResolvedExecution` (including `channelInstances`) and the permission types are retained. The existing runtime adapter still registers the exact native ToolContext and deletes it in `finally`; registry calls use that context, stored session/profile, selected provider, and original cancellation signal. Native owner/capability/local-environment checks remain in the shared `permissionRun` used by both entries.

Checks performed under the owned `/tmp/yonder-heavy-test.lock`:

| Command / scope | Result |
| --- | --- |
| `npm ci --ignore-scripts` | exit 0; no dependency or lockfile changes; npm reported 2 moderate and 2 high vulnerabilities, not changed in this task |
| `node_modules/.bin/tsc -b` | exit 0 |
| `node plugins/ui-companion/build.mjs` | exit 0 |
| Targeted Vitest (`--maxWorkers=4`, explicit 12 files below) | 186 passed / 0 failed / 0 skipped; 12 files passed |
| `npm run typecheck` | exit 0 |
| `npm run lint` | exit 0; 368 files, 0 errors / 402 warnings / 14 infos; no fixes applied |

Targeted files: SDK permissions/types; core permissions, plugin loader/index and permissions, prompt permissions, runtime catalog, permission-context, permissions-integration; native-automation permission-actions, permission-rpc and contract. This is not a full-suite run. The adapter file's 7 cases execute the real registered Runtime adapter with a labelled provider/driver fixture and isolated SQLite, covering all four actions, selection/list rejection, provider error and abort/context expiry. They are not a model/Kernel bootstrap/OS E2E. Transport tests mock all Helper/OS operations; no permission request was executed.

Standard `npm run build` was deliberately not invoked: on macOS it unconditionally calls `build-permissions.mjs`, queries signing identities and signs the Helper. The TypeScript and UI build components above passed separately. Native packaging/signing remains untested in this integration, not a full standard-build pass. No native sources or scripts changed.

Raw current-run logs, commands, UTC start/end times and exit files: `/tmp/yonder-permissions-api-final-20261025-EVIDENCE/` (`npm-ci.log`, `typescript-build.log`, `ui-build.log`, `targeted-tests.log`, `typecheck.log`, `lint.log`). Exact final diff and merge/release handoff are recorded in `/tmp/yonder-permissions-api-final-20261025-RESULT.md`. The final full-suite/release budget remains with the parent; any release, installation, restart, live permission or protected-resource verification requires the separate authorized release/acceptance step. No such step was performed here.

## Historical implementation checks (not rerun evidence for .05)

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
