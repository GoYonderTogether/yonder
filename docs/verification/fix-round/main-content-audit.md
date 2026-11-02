# Main content preservation after merge

Merge commit: `990bef27`; initial main snapshot: `ae197ecbf97ab23da3262c63c607b15e4e259364`; refresh merge `31215dd2`, previous main: `4e58ceb85f52df472d19efbe59232caaf77b8703`; final cleanup merges `add9b951` and `061b284c`, current main `fe09dfaebb17e9b9df4bec634393a5165123e39c`. There are **79 commits** since `a6a6c0b5` (including merges).

For the prior 75 main commits, compare additions with latest main, excluding later superseded additions; compare exact final main blobs when possible, otherwise verify surviving additions as whitespace-normalized substrings in mapped real packages. Imports/re-exports are relocated and excluded from line-substring matching; fragments under 12 non-whitespace characters are ignored. Explicit async/plugin-package transformations are asserted separately. The table retains per-commit checks; raw machine dumps were removed at the maintainer’s request.

Later-main replacements (including versions and prompt iterations) are judged against final main, not an earlier superseded string. Only BRIEF-required environment wording, host/package adaptation and the explicit review fixes differ.

| Main commit | Subject | Content check / real targets |
|---|---|---|
| `7d5b2b7a` | fix(ci): reduce Windows test worker contention | 1 final main blob identical. `.github/workflows/ci.yml` |
| `92c30164` | chore(release): 0.3.26110208 | 8 surviving additions present; 34 final main blob identical. `CHANGELOG.md`; 44 mapped targets checked |
| `9e1281ca` | fix(android): expose the tauri script for the Gradle rust plugin | 1 final main blob identical. `apps/desktop/package.json` |
| `48d54ef9` | fix(app): hide effort for non-reasoning models | 1 surviving additions present; 2 final main blob identical. `CHANGELOG.md`, `apps/app/src/work/ui/SessionOptions.tsx`, `apps/app/test/sessionOptionsEffort.test.tsx` |
| `642485ce` | fix(app): show model and provider names in workbench | 1 surviving additions present; 2 final main blob identical. `CHANGELOG.md`, `apps/app/src/work/ui/SessionOptions.tsx`, `apps/app/test/sessionOptionsEffort.test.tsx` |
| `709368ab` | fix(android): make the release workflow self-sufficient on old tags | 1 final main blob identical. `.github/workflows/android-release.yml` |
| `558173a2` | docs: define shared conversation operability facts | 2 surviving additions present; 1 final main blob identical. `docs/decisions.md`, `docs/spec/08-config.md`, `docs/spec/13-observation-and-management.md` |
| `5a0c97f3` | fix(android): publish the APK download URL through GitHub | 2 final main blob identical. `scripts/release/android.mjs`, `scripts/release/android.test.mjs` |
| `c3d46ae7` | docs: record the real Android and desktop release outcomes | 1 final main blob identical; 1 surviving additions present. `docs/spec/09-cli-release.md`, `docs/status.md` |
| `c14b2313` | Add verified operability facts to parent context | 2 surviving additions present. `packages/bot-core/src/kernel/conversation.ts`, `packages/local-host/src/kernel/conversation.ts`, `packages/local-host/src/kernel/index.ts`; 4 mapped targets checked |
| `0a93b1f3` | Bound parent operability projection | 2 surviving additions present. `packages/bot-core/src/kernel/conversation.ts`, `packages/local-host/src/kernel/conversation.ts`, `packages/local-host/src/kernel/index.ts`; 4 mapped targets checked |
| `22cfcc09` | test(tasks): allow Windows PNG cold start | 1 explicit equivalent migration verified. `plugins/tasks/test/board.test.ts` |
| `fa3028a8` | fix(core): include parent operability types | 1 surviving additions present. `packages/bot-core/src/kernel/operability.ts` |
| `14cc0083` | docs: record the current main CI blocker | 1 surviving additions present. `docs/status.md` |
| `e124ba74` | Add shared session operability projection | 13 surviving additions present. `packages/cli/src/commands/config.test.ts`, `packages/cli/src/commands/config.ts`, `packages/local-host/src/kernel/config-watch.ts`; 15 mapped targets checked |
| `a6823f7b` | Fix social validation repair guidance | 1 final main blob identical; 3 surviving additions present. `packages/bot-definition/src/social-validation.ts`, `packages/local-host/src/config/social.test.ts`, `packages/local-host/src/kernel/operability.test.ts`; 4 mapped targets checked |
| `41cccfed` | docs: align native management with operability evidence | 3 final main blob identical; 1 surviving additions present. `docs/research/harness-configuration-chain-20261102.svg`, `docs/spec/08-config.md`, `docs/verification/harness-local-cloud-20261102.md`; 4 mapped targets checked |
| `dc45befd` | chore(release): 0.3.26110209 | 8 surviving additions present; 34 final main blob identical. `CHANGELOG.md`; 44 mapped targets checked |
| `f1637176` | docs(workbench): record v09 production and multi-device acceptance [skip ci] | 1 surviving additions present; 1 final main blob identical. `docs/status.md`, `docs/verification/workspace-multidevice-20261102.md` |
| `1b17ba68` | feat(release): build and upload the iOS app to TestFlight | 4 final main blob identical. `.github/workflows/ios-release.yml`, `.github/workflows/release.yml`, `apps/desktop/prepare-ios.mjs`; 4 mapped targets checked |
| `3bc3792a` | fix(release): allow a manual iOS build without a tag check | 1 final main blob identical. `.github/workflows/ios-release.yml` |
| `13a99ab8` | fix(release): keep iOS workflow log lines ASCII | 1 final main blob identical. `.github/workflows/ios-release.yml` |
| `16c2e2a7` | docs: preserve verified input origins in host context | 2 surviving additions present; 1 final main blob identical. `docs/decisions.md`, `docs/spec/01-events.md`, `docs/spec/08-config.md` |
| `f07b750d` | feat: add bounded descending event queries | 3 surviving additions present; 1 final main blob identical. `packages/local-host/src/store/index.test.ts`, `packages/local-host/src/store/index.ts`, `packages/bot-core/src/store/contracts.ts`; 5 mapped targets checked |
| `877029ef` | feat: project verified batch source context | 4 surviving additions present. `packages/local-host/src/kernel/index.ts`, `packages/bot-core/src/kernel/create-bot.ts`, `packages/bot-core/src/kernel/services-wiring.ts`; 6 mapped targets checked |
| `29ac2a77` | feat: add private main owner context | 4 surviving additions present. `packages/bot-core/src/kernel/conversation.ts`, `packages/local-host/src/kernel/conversation.ts`, `packages/local-host/src/kernel/index.ts`; 8 mapped targets checked |
| `59f8b9ee` | fix: sample latest event in long conversations | 2 surviving additions present. `packages/local-host/src/kernel/operability.test.ts`, `packages/bot-core/src/kernel/operability.ts` |
| `b2121e8a` | fix(release): check out the dispatched ref for manual iOS builds | 1 final main blob identical. `.github/workflows/ios-release.yml` |
| `faa2b202` | feat: state shared agent identity in context | 2 surviving additions present. `packages/bot-core/src/kernel/conversation.ts`, `packages/local-host/src/kernel/conversation.ts`, `packages/local-host/src/kernel/index.ts`; 4 mapped targets checked |
| `caf1b27d` | test: match shared self identity context | 1 surviving additions present. `packages/local-host/src/tools/parent-origin.test.ts` |
| `89c910a5` | fix(release): use an absolute archive path for the iOS export | 1 final main blob identical. `.github/workflows/ios-release.yml` |
| `0058fdb4` | docs: clarify shared agent identity and source continuity evidence | 3 surviving additions present; 3 final main blob identical. `docs/decisions.md`, `docs/research/harness-configuration-chain-20261102.svg`, `docs/spec/02-sessions.md`; 6 mapped targets checked |
| `2b4a2ef5` | fix(release): let altool find the API key in its default location | 1 final main blob identical. `.github/workflows/ios-release.yml` |
| `4f9fe488` | style: format iOS preparation script | 1 final main blob identical. `apps/desktop/prepare-ios.mjs` |
| `88e953b4` | chore(release): 0.3.26110210 | 8 surviving additions present; 34 final main blob identical. `CHANGELOG.md`; 44 mapped targets checked |
| `48282619` | docs: record the iOS release channel and TestFlight distribution | 1 surviving additions present; 1 final main blob identical. `docs/decisions.md`, `docs/spec/09-cli-release.md` |
| `a090f517` | Clarify same-agent session language | 4 surviving additions present. `packages/bot-core/src/prompt/content.ts`, `packages/local-host/src/prompt/index.test.ts`, `packages/bot-core/src/tools/index.ts`; 4 mapped targets checked |
| `82d82b25` | Restore configuration verification prompt detail | 2 surviving additions present. `packages/bot-core/src/prompt/content.ts`, `packages/local-host/src/prompt/index.test.ts` |
| `bd8f1df8` | Clarify session operability source facts | 4 surviving additions present. `packages/cli/src/commands/config.test.ts`, `packages/cli/src/commands/config.ts`, `packages/local-host/src/kernel/operability.test.ts`; 4 mapped targets checked |
| `9d6947a1` | chore(release): 0.3.26110211 | 8 surviving additions present; 34 final main blob identical. `CHANGELOG.md`; 44 mapped targets checked |
| `9fc8a784` | Clarify predicted participation summary | 2 surviving additions present. `packages/cli/src/commands/config.test.ts`, `packages/cli/src/commands/config.ts` |
| `2b413934` | Keep unknown operability predictions unknown | 2 surviving additions present. `packages/cli/src/commands/config.test.ts`, `packages/cli/src/commands/config.ts` |
| `85a1df5b` | docs: record v10 channel failures and source-aware diagnostics | 2 surviving additions present; 3 final main blob identical. `docs/decisions.md`, `docs/research/harness-configuration-chain-20261102.svg`, `docs/research/harness-self-configuration-20261101.md`; 5 mapped targets checked |
| `25b13bae` | Merge remote-tracking branch 'origin/main' | 8 surviving additions present; 34 final main blob identical. `CHANGELOG.md`; 44 mapped targets checked |
| `79ae89ca` | Preserve focused group candidates after peer replies | 2 final main blob identical. `plugins/social/src/groups.ts`, `plugins/social/test/group-attention.test.ts` |
| `11c492b8` | docs: preserve focused candidate consumption boundaries | 2 surviving additions present; 2 final main blob identical. `docs/decisions.md`, `docs/research/harness-configuration-chain-20261102.svg`, `docs/spec/11-official-plugins.md`; 4 mapped targets checked |
| `5e94c920` | chore(release): 0.3.26110212 | 8 surviving additions present; 34 final main blob identical. `CHANGELOG.md`; 44 mapped targets checked |
| `15add313` | Carry group attention into turn context | 4 final main blob identical; 1 surviving additions present. `plugins/social/src/group-context.ts`, `plugins/social/src/group-turns.ts`, `plugins/social/src/groups.ts`; 5 mapped targets checked |
| `f2790622` | Share compact operability summary with host context | 7 surviving additions present. `packages/cli/src/commands/config.test.ts`, `packages/cli/src/commands/config.ts`, `packages/local-host/src/index.ts`; 9 mapped targets checked |
| `4be4b38d` | docs: define scoped context and interaction continuity contracts | 3 surviving additions present; 2 final main blob identical. `docs/decisions.md`, `docs/research/harness-configuration-chain-20261102.svg`, `docs/spec/08-config.md`; 5 mapped targets checked |
| `2ddb5f11` | Merge remote-tracking branch 'origin/main' | 8 surviving additions present; 34 final main blob identical. `CHANGELOG.md`; 44 mapped targets checked |
| `f41f484f` | chore(release): 0.3.26110213 | 8 surviving additions present; 34 final main blob identical. `CHANGELOG.md`; 44 mapped targets checked |
| `f139c906` | Report QQ group receive scope as unknown | 4 final main blob identical. `plugins/channel-qq/README.md`, `plugins/channel-qq/src/index.ts`, `plugins/channel-qq/src/participation.ts`; 4 mapped targets checked |
| `db2facfd` | Close social update acceptance gaps | 3 surviving additions present; 1 final main blob identical. `packages/local-host/src/kernel/index.ts`, `packages/bot-core/src/kernel/create-bot.ts`, `packages/bot-core/src/kernel/services-wiring.ts`; 6 mapped targets checked |
| `314f59d5` | Clarify group participation wake semantics | 2 surviving additions present. `packages/bot-core/src/prompt/content.ts`, `packages/local-host/src/prompt/index.test.ts` |
| `04072660` | Preserve social policy siblings and YAML formatting | 2 surviving additions present. `packages/local-host/src/kernel/social.test.ts`, `packages/local-host/src/kernel/social.ts` |
| `79acd0be` | Clarify model participation across wake modes | 2 surviving additions present. `packages/bot-core/src/prompt/content.ts`, `packages/local-host/src/prompt/index.test.ts` |
| `b91b6059` | docs: define configuration readback and platform evidence boundaries | 3 surviving additions present; 2 final main blob identical. `docs/decisions.md`, `docs/research/harness-configuration-chain-20261102.svg`, `docs/spec/08-config.md`; 5 mapped targets checked |
| `e564ded0` | Merge remote-tracking branch 'origin/main' | 8 surviving additions present; 34 final main blob identical. `CHANGELOG.md`; 44 mapped targets checked |
| `358122c3` | Keep soft reminders from ending goals | 2 surviving additions present. `packages/bot-core/src/prompt/content.ts`, `packages/local-host/src/prompt/index.test.ts` |
| `5043338d` | docs: align soft-reminder evidence with runtime guarantees | 1 surviving additions present; 1 final main blob identical. `docs/decisions.md`, `docs/verification/harness-local-cloud-20261102.md` |
| `554ba68e` | chore(release): 0.3.26110214 | 5 surviving additions present; 34 final main blob identical; 3 explicit equivalent migration verified. `CHANGELOG.md`; 44 mapped targets checked |
| `b11b3373` | docs: separate processing, source execution and configuration evidence | 5 surviving additions present; 2 final main blob identical. `CONTRIBUTING.md`, `docs/decisions.md`, `docs/research/harness-configuration-chain-20261102.svg`; 7 mapped targets checked |
| `476b44fb` | fix social batch processing before speaking coordination | 1 surviving additions present; 3 final main blob identical. `CHANGELOG.md`, `plugins/social/src/group-attention.ts`, `plugins/social/src/groups.ts`; 4 mapped targets checked |
| `a472f925` | docs: align self-configuration plan with execution boundaries | 1 final main blob identical. `docs/research/harness-self-configuration-20261101.md` |
| `a80b6e51` | Preflight ordinary social batch configuration | 10 surviving additions present; 1 final main blob identical. `CHANGELOG.md`, `packages/bot-core/src/kernel/agent-operability.ts`, `packages/local-host/src/kernel/operability-adapters.ts`; 11 mapped targets checked |
| `095ca941` | clarify authorized plugin configuration in tool discovery | 3 surviving additions present. `CHANGELOG.md`, `packages/local-host/src/prompt/index.test.ts`, `packages/bot-core/src/prompt/index.ts`; 5 mapped targets checked |
| `e2577e3b` | Report ordinary batch preflight confidence | 4 surviving additions present; 1 final main blob identical. `packages/local-host/src/kernel/operability.test.ts`, `packages/local-host/src/kernel/social-preflight.ts`, `packages/local-host/src/kernel/social.test.ts`; 5 mapped targets checked |
| `46583e14` | Merge remote-tracking branch 'origin/main' | 5 surviving additions present; 34 final main blob identical; 3 explicit equivalent migration verified. `CHANGELOG.md`; 44 mapped targets checked |
| `4acb0ca7` | Preserve accepted group runtime profiles in preflight | 2 surviving additions present. `packages/local-host/src/kernel/operability.test.ts`, `packages/local-host/src/kernel/social.ts` |
| `bd63bc2c` | docs: record exact Pi provenance and batch activation checks | 3 surviving additions present; 1 final main blob identical. `CONTRIBUTING.md`, `THIRD_PARTY_NOTICES.md`, `docs/decisions.md`; 4 mapped targets checked |
| `6189a34e` | capture bounded social update failure evidence | 1 final main blob identical. `plugins/social/test/self-configuration-natural-live.test.ts` |
| `ae197ecb` | initialize conversation policy YAML mapping | 3 surviving additions present. `CHANGELOG.md`, `packages/local-host/src/kernel/social.test.ts`, `packages/local-host/src/kernel/social.ts` |
| `e423078f` | feat: bundle Yonder Pi durable D3 source | 11 surviving additions present; 9 final main blob identical; 1 D3 provenance and upstream anchor reconciliation preserved; retain authorized local program overlay; 5 main deletion preserved; final-source/package adaptations checked. |
| `4e58ceb8` | docs: record complete source candidate checks and Pi provenance | 3 surviving additions present; 2 final main blob identical; final-source/package adaptations checked. |
| `0fcaf613` | test: bound denied remote reads | `tests/workbench-remote.test.ts`: main’s added deadline is preserved with branch package/Runtime-storage adaptations; deny-grant fs.read call includes `signal: AbortSignal.timeout(20000)`. |
| `d7d86c8e` | chore(release): 0.3.26110215 | Preserve main CHANGELOG and root/apps/real workspace versions/lock data; old core’s release metadata mapped to real bot-definition/bot-core/local-host/runtime-adapter/cloud-host packages without reviving core. |
| `2d9b037a` | docs: define grounded channel identity and verified owner goals | New main owner-goal and exact-channel-identity paragraphs in docs/spec/02-sessions.md and11-official-plugins.md are retained; existing branch changes only relocate package references.04-plugins retains main describeConversation signature/bullets plus branch singleResult/shutdown/storage contracts; decisions retains both new main sections and branch decisions. |
| `fe09dfae` | Merge remote-tracking branch origin/main | Both parents preserved: release26110215 and grounded channel identity/owner-goal documentation. No main commit remains outside the branch. |

All entries have a checked final-main equivalent; no unresolved content mismatch. This is source/content evidence, separate from the full gate and runtime checks.

Targeted checks retained: main prompt edits 358122c3,314f59d5,79acd0be are in bot-core prompt/content.ts; operability/source-context/private-main behavior is in bot-core and local-host tests. Main iOS workflow, prepare-ios.mjs and SessionOptions effort test blobs match; package version now matches main0.3.26110215. PG before/order support is covered by the real110-entry owner-context regression.

D3 provenance remains91e8c7a9 in durable and matching pi-ai artifact; only the authorized native program overlay differs from main. Main-deleted five hashline tests remain deleted. Previous targeted checks: typecheck exit0; focused12pass/0fail/4skip; formatting exit0. Shutdown focused22/0, negative control1fail/7skip, targeted buildexit0. Negative control disabled observer drain, failed storage-close assertion and restored final code; the real excerpt is:

```text
AssertionError: expected false to be true // Object.is equality
```

First cleanup main delta: `git diff 4e58ceb8..0fcaf613 -- tests/workbench-remote.test.ts` only adds the existing deny-read test signal. Other differences in that test are the already required package import and Runtime storage mappings. Reproducible history command: `git log a6a6c0b5..main --stat`; no raw stat dump retained. Final default gate is recorded in [verification](verification.md), separately from the previous real GLM/A12 checks.

Final refresh checks compare the new main additions, rather than demanding whole-file identity for already relocated paths. All added main lines in docs/spec/02-sessions.md,11-official-plugins.md and CHANGELOG are present verbatim; workbench deny-read retains its new signal. iOS workflow,prepare-ios.mjs andSessionOptions effort test remain exact main blobs. The two conflict-resolved documents retain both required contracts.8e6b474d restores main’s27platform optional-peer metadata flags after offline lockfile regeneration; real workspace paths remain unchanged.
