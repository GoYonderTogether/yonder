# Porting record: hermes-experience → plugin-learning

Basis: `proposals/unified-client/design.md` §2.4 (main-repo copy wins, rename to
`plugin-learning`, port external-only changes item by item, never overwrite
wholesale) and §11 phase 3 acceptance item 4 (all existing tests kept).

Sources compared:

- main repo `plugins/hermes-experience` at `697407a` (0.2.26102705), now this directory;
- external `/Users/zoran/Documents/yonder-hermes-extensions` at `84def0e` (0.1.1), read-only.

## Normalized comparison

Method: copy the seven external `packages/hermes-experience/*.mjs` into a temporary
directory inside this repo, run `npx -y @biomejs/biome@2.5.15 check --write` with the
repo `biome.json` (lint safe fixes + tab formatting), then `diff` against `src/*.mjs`.
Plain `biome format` is not enough (it keeps single quotes and compact statements), and
biome skips files outside the repo `files.includes`, so the copy must sit in the repo.

Result: after normalization the main copy is a superset of 0.1.1. Remaining
differences are only:

| File | External 0.1.1 | Main | Meaning |
|---|---|---|---|
| `review-prompts.mjs` | notice at `../../licenses/Hermes-MIT.txt` | `../assets/Hermes-MIT.txt` | license file location |
| `index.mjs` | `configSchema` `required: ["scopes"]` | not required; `api.config ?? { scopes: [] }` | official `checkPlugin`/`plugins add` load with no scope |
| `index.mjs` | `./assets/behavior.md` | `../assets/behavior.md` | `dist/` build layout |
| store, skill-store, review, guidance, recipe | — | — | biome safe fixes only (template literals, `??=`, loops) |

Assets `behavior.md`, `Hermes-MIT.txt` and `skills/hermes-yonder/SKILL.md` are
byte-identical; `SOURCES.md` differs only in path wording.

## Item-by-item

| Item (external) | Decision | Reason |
|---|---|---|
| 7 source modules | already present | main copy is the normalized superset; nothing to patch in |
| `required: ["scopes"]` | skipped | main relaxation is intentional for official discovery |
| `assets/`, `skills/hermes-yonder`, `NOTICE` | already present | identical content |
| tests `helpers/plugin/store/learning-store/review/skills` | already present | every case exists in the Vitest suite |
| `plugin.test.mjs` hermes-workspace preview case | skipped | design §2.4: hermes-workspace folds into `yonder migrate`, not this plugin |
| `test/provision.test.mjs` (3 cases) | skipped | standalone repo provisioner, not plugin behavior |
| `test/version.test.mjs`, `compat.mjs` | skipped | replaced by official manifest/version/asset contract tests |
| `packages/hermes-workspace` | skipped | design §2.4: becomes the `hermes` step of `yonder migrate` |
| `scripts/accept-learning-controlled.mjs` | already present | main version is the extended copy |
| `scripts/provision.mjs`, `accept-provision.mjs`, `prepare-connect.mjs` | skipped | operator tooling of the standalone repo |
| `scripts/accept-real.mjs`, `accept-learning-real.mjs`, `accept-frontmatter-real.mjs`, `accept-skills.mjs`, `integration.mjs` | skipped | standalone-repo harness wiring; plugin coverage is the controlled acceptance plus `scripts/accept-hermes-official.mjs` |
| `docs/learning-runtime.md`, `docs/learning-store-api.md` | already present | main versions are the rewritten official docs |
| `docs/{architecture,index,release-0.1.1,learning-*-evidence}.md`, `evidence/` | skipped | standalone release history, not shipped plugin docs |
| CHANGELOG 0.1.1 entries (legacy frontmatter repair hint, leading YAML validation, duplicate headers, schema clarity, YAML 2.9.1) | already present | implemented and tested in `src/skill-store.mjs` / `test/skills.test.mjs` |

## Rename changes in this package

- npm `@yonder/plugin-learning`, plugin id `learning`, tools `learning_*`.
- Tool prefix, preset `plugins`, review tool list, guidance and review prompt text
  derive from `api.id`; `recipe.mjs` takes an optional id (default `learning`). This
  lets `plugins/hermes-experience` stay a thin alias under its old id.
- Unchanged ids: contexts `hermes-memory`/`hermes-core`/`hermes-behavior`, skill
  `hermes-yonder`, presets `hermes-study`/`hermes-learning-review`, data names
  `.hermes-pending`, `.hermes-skill-archive`, `.hermes-provenance.json`,
  `learning-state.json` (design does not rename them; changing them would break
  configs `yonder migrate` does not cover yet).
- Skill provenance owner: new skills record `learning`; the legacy owner
  `hermes-experience` is still accepted for edit/archive/restore.
- Tests: the 54 existing cases moved from `plugins/hermes-experience/test` unchanged
  in number; one case added for the legacy owner. Alias has its own 3 cases.
