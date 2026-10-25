# Official Hermes integration acceptance — 2026-10-25

Local integration and release preparation only. No push, tag, Release, upgrade,
service installation/restart, production configuration change or owner-channel
input. Publication and activation belong to main after independent review.

## Provenance and scope

- Exclusive independent clone: `/Users/zoran/.local/share/yonder-harness/home/development/yonder-hermes-integration-20261025`.
- Branch: `integrate/hermes-official-20261025`.
- Real official origin: `https://github.com/GoYonderTogether/yonder-harness.git`.
- Latest remote main and latest remote release tag checked before integration and
  again after acceptance: `bb19a5d36fe1e64a47379417ce5f609c0118f87d`, `v0.2.26102501`.
- Candidate independently read at
  `/Users/zoran/.local/share/yonder-harness/home/development/yonder-hermes-official-20261025`,
  clean commit `33dc9c16b47686f3a787f2f4935e0d6838fdb023`.
  Fetched that local commit and cherry-picked onto official latest main. Only
  CHANGELOG conflicted; retained the released routing entry and added Hermes above it.
- No core/CLI/routing runtime edits. The latest main slash routing and other
  upstream changes remain byte-identical. No external `cf40886c` ancestry imported.
- Changes: official `plugins/hermes-experience`, necessary root workspace/project
  reference/lock wiring, inventory/license/changelog, synchronized official
  package release metadata, this evidence and `scripts/accept-hermes-official.mjs`.
- Existing candidate checkout and other people's checkouts were read, not edited.

## Release preparation

`docs/spec/09-cli-release.md` §5 specifies `0.<minor>.<YYMMDDNN>` and synchronized
official package versions. With remote latest `v0.2.26102501` and no `02` tag,
prepared **0.2.26102502** locally for all official packages and their `@yonder/*`
dependencies, root manifest and lock. Vendored pi-durable remains 1.3.0.
Changelog keeps an empty Unreleased section and the proposed dated release section.
No local tag was created. Recheck the remote before publishing to avoid races.

There is no repository release/publish helper or release workflow in this baseline;
`.github/workflows/ci.yml` is the existing CI. The documented publication route is
push the reviewed commit/tag and create a formal GitHub Release with `gh` (not
executed here). Existing build entrypoints are root `npm run build` (TypeScript,
`scripts/build-macos.mjs`, UI build), `typecheck`, `lint` and `test`. Existing
`scripts/accept-plugin-slash-routing.mjs` remains unchanged and uses the external
historical candidate; the new official acceptance below uses the packed artifact.
The discovered `/private/tmp/release-run.sh` is an old, hard-coded npm-ci wrapper
for 26102107, not a reusable publication script; it was not executed or modified.

## Checks actually executed

Logs under this clone's ignored `.yonder/hermes-integration-evidence/`.

| Check | Actual exit and result |
|---|---|
| `npm install --package-lock-only --ignore-scripts` then `npm ci --ignore-scripts` | 0 / 0. Independent node_modules; 4 existing dependency advisories (2 moderate, 2 high), no audit fix. |
| `npm run build` | **0**, normal TypeScript + local macOS/Swift/helper/UI build. No helper installed or started. |
| `npm run typecheck` | **0**, normal forced project build. Migrated mjs retains allowJs, not claimed strict checkJs coverage. |
| `npm run lint` | **0**, 385 warnings / 14 infos / 0 errors. Final rerun after adding official acceptance script also **0**, 354 files checked, same warnings/infos. |
| `env -u YONDER_TEST_REAL -u YONDER_TEST_AUTH npm test -- --maxWorkers=4` | **0**, full root suite exactly once: **590 passed / 0 failed / 39 skipped**, 629 cases; 99 files passed / 19 skipped, 118 files total, 31.83 s. All 54 Hermes cases discovered and passed in the root runner. |
| `node scripts/check-pi-durable-workspace.mjs` | **0**, core and SDK resolve this clone's own vendored workspace. |

Build/typecheck/lint/full tests held `/tmp/yonder-heavy-test.lock`, acquired with
atomic mkdir, owner metadata and an EXIT trap; only this run's lock was removed.
The same protocol guarded each short native run. No occupied lock was removed.
Full suite was not rerun. Default-suite real-model and privileged cases remain
skipped; the explicit real Sol test below is separate, not disguised as suite coverage.

## Integrated official npm pack, actual native Sol

Artifact:
`.yonder/hermes-integration-evidence/artifact/yonder-plugin-hermes-experience-0.2.26102502.tgz`

SHA256: `2a7a8ee9bdc1a39673d10ac7ff1cfef96f7184f65233ec52c093a4de77c26de7`.
Pack manifest and `artifact/runtime-parity.json` establish all **38** packed files
are byte-identical to this clone's final package/runtime files. Loaded directory
is `artifact/extracted/package`, not external Hermes or the source plugin path.

The new script adapts the existing native routing acceptance without changing it.
Run after build and extracting npm pack:

```sh
HERMES_PACKED_ROOT=<extracted package> YONDER_TEST_AUTH=<native configured credential file> \
  node scripts/accept-hermes-official.mjs
```

The test launcher references only the configured native credential path via the
configuration facility. It does not open, print, export or copy secret contents.
No synthetic provider, model replacement or production fixture import is used.
Fixture identity is explicitly isolated, not a forged production owner input.

- **First native run exit 1**, retained at
  `/tmp/yonder-official-refine-2gqaLY/evidence/result.json`.
  Real foreground Sol and real quiet review both completed; parent before/after
  matched and review had no delivery. The harness's final packet assertion counted
  the preceding `/help` response (2 messages instead of 1). Read events back before
  retrying. Fixed only the test assertion to attribute `/help` and `/refine` replies
  to their actual parent event, expecting two total packets. No product changes.
- **Corrected short native run exit 0**, retained at
  `/tmp/yonder-official-refine-4UKrIK/evidence/result.json`.
- Native `/help` admitted no model run; unbound CLI `/refine` dropped by binding.
- Allowed native CLI `/refine skills` kept original text/from/conv/routes at the
  real beforeTool hook. Exactly one actual `hermes-experience_refine` call returned
  `{success:true, queued:true, attended:true}` in resident session **2**, profile
  **source**, scope **main/source** with memory/skill paths inside this isolated home.
- Foreground `run.end` and private review `run.end` both report actual
  **openai/gpt-6.1-sol / high**, status done. Review session **24** is task mode,
  agent null, parent 2, profile hermes-learning-review. It opened 15007 ms after
  foreground completion, completed, and was closed.
- Review privately returned **Nothing to save.** No review tool calls or skill
  writes were needed. Skill directory is empty; MEMORY.md and USER.md remain
  zero bytes. This verifies reachability/isolation/no-save judgment, not new
  skill generation, learning quality, scope-write attacks, a 10-turn threshold
  rerun, or production Feishu/owner E2E. Existing 54 regressions cover scoped tools;
  historical controlled protocol evidence is not relabeled as fresh real Sol.
- Review has replied=caller, targets=[], **0 review message.out**. Only `/help`
  and foreground `/refine` replies are present on the fixture channel.
- Parent transcript before/after SHA256 both:
  `52697cf5da42a3eb715715ef75252964e464f30924fe949776ca84bc8a87b63e`.

## Cleanup and handoff

Both native runs close their kernel and destroy sockets. After exit, the final
allowed/unbound socket files are absent; no acceptance processes or heavy-test
lock remain. No dev server/watcher/service/helper was installed or left running.
The independent clone/node_modules/build outputs, packed artifact and the two
isolated `/tmp/yonder-official-refine-*` homes remain as evidence, not active resources.
Machine-readable checkpoints and original-evidence hashes are in the adjacent
`hermes-official-integration-20261025.json`.

All requested bounded checks passed after the documented harness assertion fix.
Suggested next release is 0.2.26102502, subject to main's independent review and
fresh remote tag check. No publication, upgrade or formal-home activation occurred.
