# Adaptive decision-routing modernization report

Date: 2026-10-22. Worktree: `/tmp/yonder-adaptive-routing-20261022/worktree`, cloned directly from official `https://github.com/GoYonderTogether/yonder-harness.git` `main`; starting HEAD `862d08f` (`test(progress-observer): synchronize ledger child processes`), the pure test PR #37 change. No old tree writes; no private source-audit prose copied. The audit at `/Users/zoran/.local/share/yonder-harness/home/agents/main/artifacts/effort-routing-source-audit-2026-10-21.md` was read-only. Old source tree was verified at user-specified `8177df15f81d10ac156d21ce372a935b1808e99b`, clean.

## What changed

- Reused the old committed `plugins/decision-routing/src/index.ts` as `src/advisory.ts` (only necessary implementation asset; existing 19 synthetic cases moved to plugin-local test). No second library or vendored external routing project.
- Modernized it as `@yonder/plugin-decision-routing`: `definePlugin`, SDK types/current version, package `yonder` manifest, root workspace/project reference and lockfile. Registered optional tool `decision-routing_recommend`, satisfying loader manifest validation. Default config is disabled/unapproved; the tool is always registered as required by loader manifest integrity, but fails closed on invocation until enabled, admin-approved and fully configured.
- Configuration includes classifier model and exact allowed classifier models/origins; target-model, agent and conversation allowlists; finite summary size/deadline; USD budget and classifier/per-route maximum cost bounds. The callable requires host `admin`+`network`. Caller supplies a short summary explicitly; the plugin has no transcript/history access. Classifier execution is one SDK call with retries disabled. Unknown/timeout does not retry or submit a target generation. Recommendation is a pure return; never mutates session/profile or dispatches the target.
- No core import/reverse SDK dependency. The target catalog's `reasoning` boolean is the only exposed capability used; package documents that this is *not* the full provider effort vocabulary or proof of execution. Request/result includes recommendation and requested/effective/reason fields, qualified as catalog-level advice, not actual run state.
- No admission hook, no production config, real model/auth/payment/message/push, or automatic routing acceptance.

## Validation

- `npm ci`: clean install in new worktree, 327 added, audit reported 0 vulnerabilities; no old node_modules symlink.
- `npx tsc -b --force`: PASS across root project graph including new plugin.
- `npx vitest run packages/cli/src/index.test.ts packages/core/src/plugins/index.test.ts plugins/decision-routing/test/advisory.test.ts`: PASS, 28 tests (19 migrated synthetic advisory tests; 4 loader/registration tests; CLI doctor validates the optional disabled manifest). No classifier invocation / credential use.
- An initial loader test exposed the required manifest/registration equality: fixed by registering the tool but keeping it disabled at execution until approval. Verified after adding project reference.
- No full test suite or doctor against the live owner home run (isolated CLI doctor integration passed). No deployment/install activation.

## Known limit / next block

This plugin is advisory only and is not automatic user-input routing acceptance. SDK catalog metadata cannot authoritatively resolve each target provider's legal effort levels. Core `resolveEffort` is internal and cannot be imported in reverse from an SDK plugin; output is expressly not claimed to be runtime effective/applied state. Next stage must be a separately reviewed kernel input-admission/run-creation contract that atomically selects and freezes the model/effort, uses core's actual resolver and persists requested/effective/reason, while preserving queued/busy/default semantics. Do not add the previously discussed frozen admission hook here; its separate design review remains outstanding.
