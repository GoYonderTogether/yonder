# Provenance and adaptation
Upstream: https://github.com/NousResearch/hermes-agent
Fixed commit: 0eb4f62a8b35ff3b0454a8dbdbd3a7b55a6849b0 (verified local Git).
Source: SOUL.md; identical DEFAULT_AGENT_IDENTITY in agent/prompt_builder.py.
License: MIT, Copyright (c) 2025 Nous Research; retained here as Hermes-MIT.txt.
behavior.md copies the response-style paragraph, removing “You are Hermes Agent,
built by Nous Research.” and adding a heading. No upstream execution-tool,
platform-media, skill_manage, kanban or session_search promises are copied.
Adapter clarification is appended by index.mjs, not attributed to upstream.
hermes-yonder SKILL.md and recipe.mjs are new Yonder adaptations, not upstream
skills/presets. No upstream skill corpus is vendored. This is not Nous affiliation.

## Slice 3: core practice (adapted, not full raw prompt)
Same fixed commit, verified at /Users/zoran/Documents/github/hermes-agent-latest;
read-only snapshot matches byte-for-byte. agent/prompt_builder.py SHA256:
f4500660b1ba9cbce98236dfe92dab3dd30f2152daac1f5750c8de26f21f7b3c.
New guidance.mjs paraphrases these MIT upstream symbols:
- build_memory_guidance (lines 192–231): narrow declarative cross-task facts,
  procedural knowledge routed into skills, budget and stale-fact maintenance.
- SKILLS_GUIDANCE / SKILL_SAFETY_HEADING (257–264): retain useful nontrivial
  methods, reload unavailable skill content before depending on it. We do NOT
  reproduce Hermes [SKILL_PRUNED] history/compaction implementation.
- TASK_COMPLETION_GUIDANCE (386–396): working artifact + actual tool output;
  honest blockers rather than invented execution evidence. No automatic fallback.

### Conditional dependencies / tool mapping
| Adapted feature | Condition in hermes-core renderer | Actual tool / limit |
|---|---|---|
| memory guidance | scoped Agent/profile, plugin enabled, >=1 memory target | memory_read; edit only exclusive-yonder, never disabled targets |
| skill acquisition/reuse | above scope plus learning:true and skillDir | native skill_view + skill-creator method; bounded hermes-experience_skill_store replaces skill_manage for private SKILL.md and text support files |
| task completion | selected hermes-core + valid enabled scope | tools actually offered; no promise of terminal/browser/kanban/delegation |
| off | recipe removes contexts/skills/tools offer and plugin selection | files retained, no selected index; old transcript not erased |

Native Yonder skill index/view is reused, not copied; selected skill-creator is
built-in and is NOT vendored or relicensed as Hermes. The teaching skill adapts its
workflow to the available text writer; its Python initialization/validation scripts
cannot be run by this recipe. Prerequisites must be checked, not assumed.
Not ported: upstream kanban task protocol, project worktree automation, delegated
agents, session_search/history retrieval, automatic skill assessments, conditional
platform/app dependency filtering, Hermes skill cache/snapshots, frozen session
prefix lifecycle, independent background curator/consolidation, external memory providers or Python.
Native profile/config selection remains the dependency contract; custom operators
must keep tools, skills, contexts and learning scope consistent. RenderContext in
2001 does not expose effective tools; renderer cannot infer arbitrary profile edits.

## Learning lifecycle (2026-10-25 adaptation)
Fixed upstream 4dcef215cfe41bd2d02c2d1dad6e257a18101216, MIT (retained license):
agent/background_review.py prompt blocks and fork/dispatch policy; turn_context.py
memory nudge; turn_iteration_prep.py skill cycles; turn_finalizer.py final-response
gate; review_idle_queue.py quiet/latest/expiry/requeue; tools/tool_executor.py
dispatch resets. See review-prompts.mjs and docs/learning-runtime.md in this package. Lifecycle implementation uses only public SDK .04 sessions/events/hooks.
Review tools fresh-read the validated parent scope without inventing a resident
identity for task sessions. Separate task cache, bounded text evidence and
fresh-render memory are intentional differences; Python fork/cache parity,
external providers and independent curator are not shipped.
