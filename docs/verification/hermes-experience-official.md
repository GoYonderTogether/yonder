# Hermes experience official workspace migration

2026-10-25, Asia/Shanghai. Local candidate only; no push, release, installation,
production config update or service restart in this task.

## Source and boundaries

- Official remote: `https://github.com/GoYonderTogether/yonder-harness.git`.
- Fresh independent clone: `/Users/zoran/.local/share/yonder-harness/home/development/yonder-hermes-official-20261025`.
- Branch: `feat/hermes-learning-official-20261025`.
- Remote main checked before clone; base OID: `1d4836e6da4a5ead0424864c4955ca22a81714ed`.
- Experience source: `/Users/zoran/.local/share/yonder-harness/home/development/hermes-parity-20261025`, clean `feat/hermes-learning-parity-20261025` at `cf40886c8160f16a42698fb8bfd22327ad87aac6`, experience 0.1.1.
- Upstream Hermes policy pin `4dcef215cfe41bd2d02c2d1dad6e257a18101216`; earlier behavior pin `0eb4f62a8b35ff3b0454a8dbdbd3a7b55a6849b0`. MIT text and exact symbols retained in the package; new adapter contributions follow Apache-2.0.

Only `plugins/hermes-experience` and required root workspace/lock/project-reference,
changelog, plugin inventory and license documentation changed. The external root,
workspace audit/provision plugin, historical fixtures/evidence, credentials and
backups are not imported. No core/routing changes; the separately owned slash
routing change remains an integration dependency for attended channel `/refine`.
No shared dirty checkout, source deployment path, production home or installed
version was modified. Native build output is confined to this clone's own dist and
.build trees (the normal build also uses its existing Swift module cache).

## Build and runtime wiring

The official workspace/package name is `@yonder/plugin-hermes-experience`, following
the Harness release version. Its stable runtime id remains `hermes-experience`.
The maintainable JS modules stay in `src/*.mjs`. A normal TypeScript project
reference with `allowJs: true` emits `dist/*.mjs`, `.d.mts` and maps; no language-only
rewrite or bespoke runtime/compiler was added. Root `npm run build` discovers it
through the normal project references. YAML 2.9.1 is the existing locked dependency,
not another library. Manifest/exports point to the emitted entry. Assets and native
teaching skills remain package-root resources; the behavior URL accounts for dist.

Official add/discovery can register with an empty scope; this confers no Agent
access. All existing scoped configuration objects and runtime mutation/disable
semantics remain unchanged. Eight tools, three contexts, two presets, the hook and
trigger, teaching skill, guidance, review policy and pending support are retained.
The internal three-tool grant is still based on actual plugin-created sessions,
not model-supplied identity, parent metadata or preset name.

## Checks and actual results

All logs/artifacts below are in this clone's ignored
`.yonder/hermes-official-evidence/` unless an absolute path is shown.

| Check | Actual result |
|---|---|
| Independent dependency install | `npm install --package-lock-only --ignore-scripts && npm ci --ignore-scripts`, exit 0; clone-local node_modules, no borrowed dependency tree. npm reports 4 dependency advisories; no unrelated audit fix attempted. |
| Full normal build | `npm run build`, exit 0 (`build.log`), including local Swift/helper/UI artifacts. Held `/tmp/yonder-heavy-test.lock` via atomic mkdir and released it via exit trap. No helper installed/launched. |
| Final typecheck / JS emit | `npm run typecheck`, exit 0 (`typecheck-final.log`). This rebuilt the final runtime sources after Biome-compatible syntax adaptation. JS is not claimed to have strict checkJs coverage; SDK registration, real store regressions and native artifact execution are separate verification. |
| First migrated tests | 38 pass / 16 fail / 0 skip, 6 files (`regression-first.log`). New tmpdir fixture used macOS's symlinked `/var` path; skill store correctly refused `canonical_parent_required`. Fixed only the test fixture with realpath, without weakening product canonical-scope checks. |
| Final plugin regression | `npm test -- plugins/hermes-experience --maxWorkers=1`: **54 pass / 0 fail / 0 skip**, 6 files (`regression-final.log`). |
| Default root discovery | `npx vitest list --exclude '**/dist/**' --json`, exit 0 (`test-discovery.json`); all **54** plugin tests are found by default root discovery, not a separate Node runner hidden from CI. |
| Full repository lint | `npm run lint`, exit 0 (`lint.log`); 385 existing warnings / 14 infos, no errors. New plugin paths pass without diagnostics after formatting and equivalent expression cleanup. |
| Official CLI add/show/inspect | Built CLI `plugins add @yonder/plugin-hermes-experience --home <isolated home>` exit 0. The initial harness incorrectly JSON-parsed human output and exited 1 **after successful add**, retained in `native-install-interface.log`. State was read back before any retry; no duplicate add. `plugins show`/`inspect --json` subsequently exit 0 (`native-install-readback.log`). Main's plugin selection remains context-files/agent-presets and all experience tools show plugin-not-selected. |
| Native packed artifact | Actual `npm pack`, extract, then `YONDER_TEST_HERMES_PLUGIN=<extracted package> node plugins/hermes-experience/scripts/accept-learning-controlled.mjs`, exit 0 (`native-packed-controlled.log`). Held/released shared heavy-test lock. |

The source 57 tests split as follows: all **52 experience** store/review/skill/scope
regressions migrate unchanged in intent; one workspace-preview and three external
provision tests are outside this module, so they do not bring that plugin/root into
the official tree. The old standalone peer/version test is replaced by two official
package/version/assets/default-scope contracts (54 total). Review clocks/hooks and
cleanup use Vitest's native APIs instead of node:test, without subprocess pass-count
hiding. Test data is isolated canonical tmpdir data only.

### Fresh actual native artifact evidence

`/private/tmp/hermes-learning-controlled-WsPfPv/home/evidence/result.json`

- `status: passed`, exit 0; core version 0.2.26102404 loaded from this clone.
- Loaded pluginDir is this clone's **extracted npm tarball**, not the external source.
- 10 real channel-cli `message.in` user runs; no early review; automatic review
  starts after **15018 ms** of quiet, reads/adds memory, refuses legacy full-metadata
  body, repairs through the actual dedicated skill tool and creates valid single
  frontmatter plus `references/checks.md`.
- Same live kernel, different resident session sees the native skill index, uses
  native `skill_view` for body and support file, and returns the prescribed order.
- Parent transcript unchanged; no review message.out or source delivery.
- Ordinary child provider delta 0 despite same preset/parent; dedicated review's
  17th request is cancelled, exactly 16 provider requests admitted.
- Kernel, local HTTP server and sockets closed by the script. This is a
  **controlled protocol/authorization/artifact test**, not real Sol judgment.

The fresh native-tested tarball and pack manifest are retained at the evidence
root. Final API docs were then clarified (no runtime edits). Final distributable:

`.yonder/hermes-official-evidence/final-artifact/yonder-plugin-hermes-experience-0.2.26102404.tgz`

SHA256: `c0a813b83c19ec69e15be7c736cb5402729f2be7b824ad0db52ec21e6e481f5f`.
`final-artifact/runtime-parity.json` verifies every dist/asset/skill file and the
manifest are **byte-identical** to the actually native-tested extracted package;
only the two API Markdown documents changed. The pack list includes dist modules,
guidance/recipe/review preset implementation, behavior and MIT assets, teaching
skill, NOTICE, README and API docs; no src/test/fixture/credential/.dev payload.

## Integration and remaining verification

The main integrator should cherry-pick the candidate commit, combine the separately
owned slash-routing fix and run the full suite once in its exclusive verification
queue. **This task did not run the full repository suite**, a fresh real-model
learning judgment test or owner Feishu `/refine` E2E. Existing external Sol evidence
is not represented as a new official artifact run. Publication, installed runtime
activation and owner-channel acceptance remain the main integrator's work.

For the existing Hermes mapping, replace only its existing global plugin `use`
path with `@yonder/plugin-hermes-experience`; keep config.scopes and all profile ids,
context/tool/preset/skill names, original memoryDir/skillDir and plugin data id.
Do not load both source and official entries (duplicate id). No data migration or
new profile grant is required. Existing malformed learned files are not silently
rewritten. Native skills remain independently selected: a profile's existing `*`
skill pattern can discover the teaching description, but does not grant plugin
scope or tools. No other Agent/profile is explicitly selected by this change.
