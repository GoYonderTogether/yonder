# Main content preservation after merge

Merge commit: `990bef27`; initial main snapshot: `ae197ecbf97ab23da3262c63c607b15e4e259364`; refresh merge `31215dd2`, current main and recheck: `4e58ceb85f52df472d19efbe59232caaf77b8703`. There are **75 commits** since `a6a6c0b5` (including merges).

For each of 75 main commits, compare additions with latest main, excluding later superseded additions; compare exact final main blobs when possible, otherwise verify surviving additions as whitespace-normalized substrings in mapped real packages. Imports/re-exports are relocated and excluded from line-substring matching; fragments under 12 non-whitespace characters are ignored. Explicit async/plugin-package transformations are asserted separately. Detailed source/target paths and counts retained per commit.

Later-main replacements (including versions and prompt iterations) are judged against final main, not an earlier superseded string. Only BRIEF-required environment wording, host/package adaptation and the explicit review fixes differ.

| Main commit | Subject | Content check / real targets |
|---|---|---|
| `7d5b2b7a` | fix(ci): reduce Windows test worker contention | 1 final main blob identical. `.github/workflows/ci.yml` |
| `92c30164` | chore(release): 0.3.26110208 | 8 surviving additions present; 34 final main blob identical. `CHANGELOG.md`; 44 target files in JSON entry 2 |
| `9e1281ca` | fix(android): expose the tauri script for the Gradle rust plugin | 1 final main blob identical. `apps/desktop/package.json` |
| `48d54ef9` | fix(app): hide effort for non-reasoning models | 1 surviving additions present; 2 final main blob identical. `CHANGELOG.md`, `apps/app/src/work/ui/SessionOptions.tsx`, `apps/app/test/sessionOptionsEffort.test.tsx` |
| `642485ce` | fix(app): show model and provider names in workbench | 1 surviving additions present; 2 final main blob identical. `CHANGELOG.md`, `apps/app/src/work/ui/SessionOptions.tsx`, `apps/app/test/sessionOptionsEffort.test.tsx` |
| `709368ab` | fix(android): make the release workflow self-sufficient on old tags | 1 final main blob identical. `.github/workflows/android-release.yml` |
| `558173a2` | docs: define shared conversation operability facts | 2 surviving additions present; 1 final main blob identical. `docs/decisions.md`, `docs/spec/08-config.md`, `docs/spec/13-observation-and-management.md` |
| `5a0c97f3` | fix(android): publish the APK download URL through GitHub | 2 final main blob identical. `scripts/release/android.mjs`, `scripts/release/android.test.mjs` |
| `c3d46ae7` | docs: record the real Android and desktop release outcomes | 1 final main blob identical; 1 surviving additions present. `docs/spec/09-cli-release.md`, `docs/status.md` |
| `c14b2313` | Add verified operability facts to parent context | 2 surviving additions present. `packages/bot-core/src/kernel/conversation.ts`, `packages/local-host/src/kernel/conversation.ts`, `packages/local-host/src/kernel/index.ts`; 4 target files in JSON entry 10 |
| `0a93b1f3` | Bound parent operability projection | 2 surviving additions present. `packages/bot-core/src/kernel/conversation.ts`, `packages/local-host/src/kernel/conversation.ts`, `packages/local-host/src/kernel/index.ts`; 4 target files in JSON entry 11 |
| `22cfcc09` | test(tasks): allow Windows PNG cold start | 1 explicit equivalent migration verified. `plugins/tasks/test/board.test.ts` |
| `fa3028a8` | fix(core): include parent operability types | 1 surviving additions present. `packages/bot-core/src/kernel/operability.ts` |
| `14cc0083` | docs: record the current main CI blocker | 1 surviving additions present. `docs/status.md` |
| `e124ba74` | Add shared session operability projection | 13 surviving additions present. `packages/cli/src/commands/config.test.ts`, `packages/cli/src/commands/config.ts`, `packages/local-host/src/kernel/config-watch.ts`; 15 target files in JSON entry 15 |
| `a6823f7b` | Fix social validation repair guidance | 1 final main blob identical; 3 surviving additions present. `packages/bot-definition/src/social-validation.ts`, `packages/local-host/src/config/social.test.ts`, `packages/local-host/src/kernel/operability.test.ts`; 4 target files in JSON entry 16 |
| `41cccfed` | docs: align native management with operability evidence | 3 final main blob identical; 1 surviving additions present. `docs/research/harness-configuration-chain-20261102.svg`, `docs/spec/08-config.md`, `docs/verification/harness-local-cloud-20261102.md`; 4 target files in JSON entry 17 |
| `dc45befd` | chore(release): 0.3.26110209 | 8 surviving additions present; 34 final main blob identical. `CHANGELOG.md`; 44 target files in JSON entry 18 |
| `f1637176` | docs(workbench): record v09 production and multi-device acceptance [skip ci] | 1 surviving additions present; 1 final main blob identical. `docs/status.md`, `docs/verification/workspace-multidevice-20261102.md` |
| `1b17ba68` | feat(release): build and upload the iOS app to TestFlight | 4 final main blob identical. `.github/workflows/ios-release.yml`, `.github/workflows/release.yml`, `apps/desktop/prepare-ios.mjs`; 4 target files in JSON entry 20 |
| `3bc3792a` | fix(release): allow a manual iOS build without a tag check | 1 final main blob identical. `.github/workflows/ios-release.yml` |
| `13a99ab8` | fix(release): keep iOS workflow log lines ASCII | 1 final main blob identical. `.github/workflows/ios-release.yml` |
| `16c2e2a7` | docs: preserve verified input origins in host context | 2 surviving additions present; 1 final main blob identical. `docs/decisions.md`, `docs/spec/01-events.md`, `docs/spec/08-config.md` |
| `f07b750d` | feat: add bounded descending event queries | 3 surviving additions present; 1 final main blob identical. `packages/local-host/src/store/index.test.ts`, `packages/local-host/src/store/index.ts`, `packages/bot-core/src/store/contracts.ts`; 5 target files in JSON entry 24 |
| `877029ef` | feat: project verified batch source context | 4 surviving additions present. `packages/local-host/src/kernel/index.ts`, `packages/bot-core/src/kernel/create-bot.ts`, `packages/bot-core/src/kernel/services-wiring.ts`; 6 target files in JSON entry 25 |
| `29ac2a77` | feat: add private main owner context | 4 surviving additions present. `packages/bot-core/src/kernel/conversation.ts`, `packages/local-host/src/kernel/conversation.ts`, `packages/local-host/src/kernel/index.ts`; 8 target files in JSON entry 26 |
| `59f8b9ee` | fix: sample latest event in long conversations | 2 surviving additions present. `packages/local-host/src/kernel/operability.test.ts`, `packages/bot-core/src/kernel/operability.ts` |
| `b2121e8a` | fix(release): check out the dispatched ref for manual iOS builds | 1 final main blob identical. `.github/workflows/ios-release.yml` |
| `faa2b202` | feat: state shared agent identity in context | 2 surviving additions present. `packages/bot-core/src/kernel/conversation.ts`, `packages/local-host/src/kernel/conversation.ts`, `packages/local-host/src/kernel/index.ts`; 4 target files in JSON entry 29 |
| `caf1b27d` | test: match shared self identity context | 1 surviving additions present. `packages/local-host/src/tools/parent-origin.test.ts` |
| `89c910a5` | fix(release): use an absolute archive path for the iOS export | 1 final main blob identical. `.github/workflows/ios-release.yml` |
| `0058fdb4` | docs: clarify shared agent identity and source continuity evidence | 3 surviving additions present; 3 final main blob identical. `docs/decisions.md`, `docs/research/harness-configuration-chain-20261102.svg`, `docs/spec/02-sessions.md`; 6 target files in JSON entry 32 |
| `2b4a2ef5` | fix(release): let altool find the API key in its default location | 1 final main blob identical. `.github/workflows/ios-release.yml` |
| `4f9fe488` | style: format iOS preparation script | 1 final main blob identical. `apps/desktop/prepare-ios.mjs` |
| `88e953b4` | chore(release): 0.3.26110210 | 8 surviving additions present; 34 final main blob identical. `CHANGELOG.md`; 44 target files in JSON entry 35 |
| `48282619` | docs: record the iOS release channel and TestFlight distribution | 1 surviving additions present; 1 final main blob identical. `docs/decisions.md`, `docs/spec/09-cli-release.md` |
| `a090f517` | Clarify same-agent session language | 4 surviving additions present. `packages/bot-core/src/prompt/content.ts`, `packages/local-host/src/prompt/index.test.ts`, `packages/bot-core/src/tools/index.ts`; 4 target files in JSON entry 37 |
| `82d82b25` | Restore configuration verification prompt detail | 2 surviving additions present. `packages/bot-core/src/prompt/content.ts`, `packages/local-host/src/prompt/index.test.ts` |
| `bd8f1df8` | Clarify session operability source facts | 4 surviving additions present. `packages/cli/src/commands/config.test.ts`, `packages/cli/src/commands/config.ts`, `packages/local-host/src/kernel/operability.test.ts`; 4 target files in JSON entry 39 |
| `9d6947a1` | chore(release): 0.3.26110211 | 8 surviving additions present; 34 final main blob identical. `CHANGELOG.md`; 44 target files in JSON entry 40 |
| `9fc8a784` | Clarify predicted participation summary | 2 surviving additions present. `packages/cli/src/commands/config.test.ts`, `packages/cli/src/commands/config.ts` |
| `2b413934` | Keep unknown operability predictions unknown | 2 surviving additions present. `packages/cli/src/commands/config.test.ts`, `packages/cli/src/commands/config.ts` |
| `85a1df5b` | docs: record v10 channel failures and source-aware diagnostics | 2 surviving additions present; 3 final main blob identical. `docs/decisions.md`, `docs/research/harness-configuration-chain-20261102.svg`, `docs/research/harness-self-configuration-20261101.md`; 5 target files in JSON entry 43 |
| `25b13bae` | Merge remote-tracking branch 'origin/main' | 8 surviving additions present; 34 final main blob identical. `CHANGELOG.md`; 44 target files in JSON entry 44 |
| `79ae89ca` | Preserve focused group candidates after peer replies | 2 final main blob identical. `plugins/social/src/groups.ts`, `plugins/social/test/group-attention.test.ts` |
| `11c492b8` | docs: preserve focused candidate consumption boundaries | 2 surviving additions present; 2 final main blob identical. `docs/decisions.md`, `docs/research/harness-configuration-chain-20261102.svg`, `docs/spec/11-official-plugins.md`; 4 target files in JSON entry 46 |
| `5e94c920` | chore(release): 0.3.26110212 | 8 surviving additions present; 34 final main blob identical. `CHANGELOG.md`; 44 target files in JSON entry 47 |
| `15add313` | Carry group attention into turn context | 4 final main blob identical; 1 surviving additions present. `plugins/social/src/group-context.ts`, `plugins/social/src/group-turns.ts`, `plugins/social/src/groups.ts`; 5 target files in JSON entry 48 |
| `f2790622` | Share compact operability summary with host context | 7 surviving additions present. `packages/cli/src/commands/config.test.ts`, `packages/cli/src/commands/config.ts`, `packages/local-host/src/index.ts`; 9 target files in JSON entry 49 |
| `4be4b38d` | docs: define scoped context and interaction continuity contracts | 3 surviving additions present; 2 final main blob identical. `docs/decisions.md`, `docs/research/harness-configuration-chain-20261102.svg`, `docs/spec/08-config.md`; 5 target files in JSON entry 50 |
| `2ddb5f11` | Merge remote-tracking branch 'origin/main' | 8 surviving additions present; 34 final main blob identical. `CHANGELOG.md`; 44 target files in JSON entry 51 |
| `f41f484f` | chore(release): 0.3.26110213 | 8 surviving additions present; 34 final main blob identical. `CHANGELOG.md`; 44 target files in JSON entry 52 |
| `f139c906` | Report QQ group receive scope as unknown | 4 final main blob identical. `plugins/channel-qq/README.md`, `plugins/channel-qq/src/index.ts`, `plugins/channel-qq/src/participation.ts`; 4 target files in JSON entry 53 |
| `db2facfd` | Close social update acceptance gaps | 3 surviving additions present; 1 final main blob identical. `packages/local-host/src/kernel/index.ts`, `packages/bot-core/src/kernel/create-bot.ts`, `packages/bot-core/src/kernel/services-wiring.ts`; 6 target files in JSON entry 54 |
| `314f59d5` | Clarify group participation wake semantics | 2 surviving additions present. `packages/bot-core/src/prompt/content.ts`, `packages/local-host/src/prompt/index.test.ts` |
| `04072660` | Preserve social policy siblings and YAML formatting | 2 surviving additions present. `packages/local-host/src/kernel/social.test.ts`, `packages/local-host/src/kernel/social.ts` |
| `79acd0be` | Clarify model participation across wake modes | 2 surviving additions present. `packages/bot-core/src/prompt/content.ts`, `packages/local-host/src/prompt/index.test.ts` |
| `b91b6059` | docs: define configuration readback and platform evidence boundaries | 3 surviving additions present; 2 final main blob identical. `docs/decisions.md`, `docs/research/harness-configuration-chain-20261102.svg`, `docs/spec/08-config.md`; 5 target files in JSON entry 58 |
| `e564ded0` | Merge remote-tracking branch 'origin/main' | 8 surviving additions present; 34 final main blob identical. `CHANGELOG.md`; 44 target files in JSON entry 59 |
| `358122c3` | Keep soft reminders from ending goals | 2 surviving additions present. `packages/bot-core/src/prompt/content.ts`, `packages/local-host/src/prompt/index.test.ts` |
| `5043338d` | docs: align soft-reminder evidence with runtime guarantees | 1 surviving additions present; 1 final main blob identical. `docs/decisions.md`, `docs/verification/harness-local-cloud-20261102.md` |
| `554ba68e` | chore(release): 0.3.26110214 | 5 surviving additions present; 34 final main blob identical; 3 explicit equivalent migration verified. `CHANGELOG.md`; 44 target files in JSON entry 62 |
| `b11b3373` | docs: separate processing, source execution and configuration evidence | 5 surviving additions present; 2 final main blob identical. `CONTRIBUTING.md`, `docs/decisions.md`, `docs/research/harness-configuration-chain-20261102.svg`; 7 target files in JSON entry 63 |
| `476b44fb` | fix social batch processing before speaking coordination | 1 surviving additions present; 3 final main blob identical. `CHANGELOG.md`, `plugins/social/src/group-attention.ts`, `plugins/social/src/groups.ts`; 4 target files in JSON entry 64 |
| `a472f925` | docs: align self-configuration plan with execution boundaries | 1 final main blob identical. `docs/research/harness-self-configuration-20261101.md` |
| `a80b6e51` | Preflight ordinary social batch configuration | 10 surviving additions present; 1 final main blob identical. `CHANGELOG.md`, `packages/bot-core/src/kernel/agent-operability.ts`, `packages/local-host/src/kernel/operability-adapters.ts`; 11 target files in JSON entry 66 |
| `095ca941` | clarify authorized plugin configuration in tool discovery | 3 surviving additions present. `CHANGELOG.md`, `packages/local-host/src/prompt/index.test.ts`, `packages/bot-core/src/prompt/index.ts`; 5 target files in JSON entry 67 |
| `e2577e3b` | Report ordinary batch preflight confidence | 4 surviving additions present; 1 final main blob identical. `packages/local-host/src/kernel/operability.test.ts`, `packages/local-host/src/kernel/social-preflight.ts`, `packages/local-host/src/kernel/social.test.ts`; 5 target files in JSON entry 68 |
| `46583e14` | Merge remote-tracking branch 'origin/main' | 5 surviving additions present; 34 final main blob identical; 3 explicit equivalent migration verified. `CHANGELOG.md`; 44 target files in JSON entry 69 |
| `4acb0ca7` | Preserve accepted group runtime profiles in preflight | 2 surviving additions present. `packages/local-host/src/kernel/operability.test.ts`, `packages/local-host/src/kernel/social.ts` |
| `bd63bc2c` | docs: record exact Pi provenance and batch activation checks | 3 surviving additions present; 1 final main blob identical. `CONTRIBUTING.md`, `THIRD_PARTY_NOTICES.md`, `docs/decisions.md`; 4 target files in JSON entry 71 |
| `6189a34e` | capture bounded social update failure evidence | 1 final main blob identical. `plugins/social/test/self-configuration-natural-live.test.ts` |
| `ae197ecb` | initialize conversation policy YAML mapping | 3 surviving additions present. `CHANGELOG.md`, `packages/local-host/src/kernel/social.test.ts`, `packages/local-host/src/kernel/social.ts` |

| `e423078f` | feat: bundle Yonder Pi durable D3 source | 11 surviving additions present; 9 final main blob identical; 1 D3 provenance and upstream anchor reconciliation preserved; retain authorized local program overlay; 5 main deletion preserved; full targets/adaptations in JSON. |
| `4e58ceb8` | docs: record complete source candidate checks and Pi provenance | 3 surviving additions present; 2 final main blob identical; full targets/adaptations in JSON. |

All entries have a checked final-main equivalent; no unresolved content mismatch. This is source/content evidence, separate from the full gate and runtime checks.

Targeted source checks are in `main-targeted-greps.txt`. Detailed checks and mapped paths for every changed file are in `main-content-audit.json`.

Refresh preserves D3 `91e8c7a9` in both provenance records and the matching bundled pi-ai artifact. The former anchor overlay is upstream in main; only the already authorized native program overlay remains. D3 source grouping now enters the one shared createBot, and its finishIdle helper is reused by both hosts. Main-deleted vendored hashline tests remain deleted.

Continuation verification (before the root full gate):

- [New main log/stat](main-refresh-log-stat.txt) and [new commit file checks](main-refresh-audit.json).
- [Targeted typecheck](main-refresh-typecheck.log): exit 0 for runtime-adapter, bot-core and local-host.
- [Focused tests](main-refresh-focused.log): 12 passed / 0 failed / 4 skipped; console, parent-origin and real-Luna input-queue suites (real Luna not enabled).
- [Safe formatting](main-refresh-format.log): exit 0, no unsafe fixes.
- Existing shutdown change: [22/0 focused proof](../review-shutdown-focused-final.log), [negative control 1 failed / 7 skipped](../review-shutdown-negative-control.log), and [targeted build exit 0](../review-shutdown-build-final.log). The negative control disables the new observer drain and fails the storage-close assertion, then restores the final code.

These are focused/source checks; the primary agent owns the final full gate, real GLM and extended A12 results.
