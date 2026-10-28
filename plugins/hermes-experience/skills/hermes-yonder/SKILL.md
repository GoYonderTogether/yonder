---
name: hermes-yonder
description: Use Hermes-derived curated memory, private reusable skills and quiet learning on Yonder, including pending proposals and explicit /refine; explain the adapter’s actual runtime limits.
---
# Hermes on Yonder

This is a Yonder-native adapter, not the upstream Python runtime. Use the selected
tool schemas as the capability contract. Behavior derives from NousResearch/hermes-agent
(MIT, Nous Research 2025), pins 0eb4f62a8b35ff3b0454a8dbdbd3a7b55a6849b0
(behavior) and 4dcef215cfe41bd2d02c2d1dad6e257a18101216 (learning policy).

## Memory
Read `hermes-experience_memory_read` with target `memory` (durable environment
facts) or `user` (confirmed facts about the person). Keep one fact in one store;
procedures and task-specific style/workflow preferences belong in the relevant
skill. Never save credentials or transient progress.

Edit with the exact revision using add, patch or remove. Patch uses one unique
literal old_text and preserves surrounding whitespace; remove deletes the entire
matching entry. An `operations` batch checks its final budget and saves all or
nothing, so it can shorten old facts and add a new one together. Stale revisions
require rereading and reconsidering. Detailed failures contain repair hints;
`done:true` with a consolidation retry cap means stop retrying this turn.

Quiet unattended review adds save directly; destructive patch/remove or mixed
batches stage a proposal instead. `staged:true,saved:false` is NOT applied.
`hermes-experience_memory_pending` can list/read/apply/discard proposals. Applying
requires the original source version; stale proposals remain for inspection.
Foreground edits and explicitly attended review save directly without this
unattended exception. Pending proposals do not trigger channel notifications.

Memory is fresh on each native system render, including later renders in the same
session. A save never rewrites a previously built prompt or transcript. Disable
removes future selected tools/context/skills, not historical text. No upstream
session-frozen prefix or compaction checkpoint implementation is reproduced.

## Private skills
For authoring, read selected native `skill-creator` with `skill_view` when useful.
Use an existing relevant private skill first, then its topical support files, and
only then a new reusable class-level `hermes-learned-*` skill. Do not turn one-off
incidents, unresolved failures or temporary missing tools into permanent rules.

`hermes-experience_skill_store` supports:
- read the body or exact `file_path`, then save/edit/patch with that revision;
- create a new complete SKILL.md (or description/body), and write/remove text
  support files under references/, templates/ or scripts/;
- one atomic-planned batch of up to 20 create/patch/write_file/remove_file actions;
- list_archives, and archive/restore owned unpinned skills (not arbitrary deletion).

For a complete SKILL.md use `content` with exactly one valid YAML frontmatter
block. Legacy `description`/`body` remains valid, but `body` is Markdown only,
without frontmatter. Invalid or duplicate metadata is refused before writing;
correct the arguments using the returned repair hint. Legacy read/save is still valid. Existing files require an exact revision; new
files expect absence. Saved scripts are text data, never automatically executed.
Do not author into global home/skills or overwrite shared/builtin/external skills.
The native workspace index discovers saved descriptions under `hermes-learned-*`
selection. Later tasks load the body and linked resources with native `skill_view`
before relying on them; a description is not the whole method. Reload pruned or
unavailable content instead of pretending to remember it.

## Quiet learning and explicit refine
Genuine user runs count toward automatic memory review every 10 user inputs and
skill review after each eligible completed user run. Mutation dispatch resets its counter even
if the operation subsequently fails. Review starts after 15 seconds of quiet,
merges the latest completed evidence and expires after 30 minutes. A foreground
request revokes write authority before cancellation; an atomic write already
committed is not rolled back. Reviews never send channel progress/results.

For a user message **beginning `/refine`**, call `hermes-experience_refine` with an
optional focus memory, skills or combined. This queues a real attended review
following the current turn, not a full-privilege engineering `/review`. Do not
self-assert attended permission: the tool checks the real user input, not a tool
argument. Explicit reviews do not requeue after interruption. Nothing to save is
valid when evidence offers no durable signal.

Background tasks have no resident identity. Only the plugin's own active review
sessions receive scoped dedicated `review_memory_read`, `review_memory_edit` and
`review_skill_store` tools. Review overwrites need fresh reads of each exact file
through the dedicated store during that review; transcript quotes and native
`skill_view` do not establish those write marks. Ordinary tasks, even with the
same preset or parent, have no review grant. The readonly `hermes-study` preset is
separate and cannot save.

This uses a bounded cloned evidence snapshot and an independent native task, not
a byte/cache-identical upstream fork. No external Python memory provider,
independent seven-day curator, upstream session_search or kanban is supplied.
Operator installation/configuration is outside this skill; do not change global
configuration or borrow credentials to repair a missing capability.
