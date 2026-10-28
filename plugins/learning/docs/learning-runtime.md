# Learning runtime

Implementation: `plugins/learning/src/{index,review,review-prompts}.mjs`.
Storage signatures/transaction limits: [Learning store API](learning-store-api.md).
Upstream policy: NousResearch/hermes-agent at
`4dcef215cfe41bd2d02c2d1dad6e257a18101216`, MIT, Copyright (c) 2025 Nous Research;
NOTICE and `../assets/Hermes-MIT.txt` retain attribution/permission.

This is a **Yonder-native adaptation**, not a Python runtime or byte/cache-identical
fork. It uses the public SDK from this Harness workspace; plugins import no core
internals. The source experience 0.1.1 implementation was validated against SDK
`0.2.26102404` and migrated without changing its authorization or data layout.

## Actual chain and authority

1. Selected foreground `beforeRequest(messages, ToolContext)` sees the actual
   native run inputs (`ctx.events`, fallback `ctx.event`). New input IDs immediately
   advance the parent generation, revoke any old grant, then abort its task with a
   maximum 2-second foreground wait. This revocation precedes session/filesystem
   lookups. Queued jobs are paused during foreground work.
2. Real `sessions.get(parent)` supplies Agent/profile/mode/closed facts, and trusted
   plugin scope configuration supplies the memory directory and sibling native
   workspace skill root. No model identity/path/scope/attended arguments are used.
3. Genuine human-channel `message.in` events (not the internal agent channel) count
   once on `run.end`, based on its actual input IDs, default memory interval 10.
   Each foreground `beforeRequest` iteration in a genuine user run counts once
   toward the skill interval 10. Task input, internal-agent input, continuation and
   tool-completion-only runs are excluded. A normal identity-less child never
   qualifies as a parent, regardless of preset name or parent metadata.
4. A mutation entering the native `beforeTool` dispatch hook resets its parent
   counter **before** storage validation/success. A foreground memory dispatch also
   persists the actual input IDs it consumed so later `run.end`/restart does not
   count those same inputs back into the counter. Reads do not reset. Nudge
   scheduling consumes due counters independently, so a Nothing-to-save review
   does not repeat every following turn.
5. A matching `run.end` queries the public transcript projection. It requires a
   terminal `pi.assistant` entry with nonempty text and no tool calls, after a
   matching placed input. `aborted` and `limit` mean interrupted. `done` alone is
   insufficient; `error` with a real terminal answer is not arbitrarily excluded.
   A generation/key mismatch discards a late capture rather than using the next
   turn's final/material. No raw DB access or presumed RunEndData.text field.
6. Queue the due focus: memory, skills or combined. Wait 15 seconds of parent quiet,
   merge the latest completed evidence while retaining earliest queue time, expire
   at 30 minutes. Interrupted automatic work can requeue at most three times;
   explicitly attended work cannot. Closing/off clears queued jobs.
7. Open native `sessions.open({preset:'hermes-learning-review',parent,
   capabilities:['read','write'],close:'manual'})`. Opening is not authority.
   Recheck generation after open, then register the unique review grant **before**
   `submit({text}, {wait:true})`. The asynchronous submit result returns to the
   plugin, not a source conversation. Event observers never await a whole LLM run.
8. Dedicated tool wrappers resolve real `ctx.session` to that grant. Ordinary task
   sessions, expired/restarted grants, forged model scope fields and unauthorized
   focus fail. Storage receives trusted `review`, `turnState`, `readMarks` and
   `isActive`; the latter rechecks live generation plus actual parent scope/closed
   state at the storage commit admission point. No fabricated `ctx.agent`.
9. Completion, close, foreground generation change and trigger.stop revoke first.
   Abort/close follow revocation; an admitted/committed atomic transaction is not
   retrospectively undone. Transient grants are never restored after restart.

`api.paths.data/learning-state.json` atomically persists counters, handled native
run IDs, handled human input IDs and dispatch-consumed memory input IDs. It stores
no transcript or grant. Queue/evidence/grants are intentionally process-local and
best effort, not durable exactly-once review jobs. Invalid existing state is not
silently overwritten. Store error details (`done`, `success`, budget/current-entry,
conflict/rollback fields) survive tool JSON serialization, not only message text.

## SDK .04 mapping and deliberate limits

| Public contract | Use | Important qualification |
|---|---|---|
| Hook.beforeRequest(messages,ctx) | clone materials; skill iterations; preempt | before model request, not raw input admission; system/tools/cache-prefix are not an exposed fork contract |
| ToolContext.events/event | trusted current run input provenance | no historical transcript text is promoted to attended authority |
| Hook.beforeTool(call,ctx) | hard whitelist/focus; dispatch resets | native pre-dispatch hook, not a post-success counter |
| events.on('run.end') / RunEndData.inputs,runId,status | user counter, dedup, final gate, queue | no invented final text/interrupted/cutoff fields |
| SessionsAPI.transcript(from,limit) | paged tool/result/final projection | no stopReason, toolCallId or lossless multimedia; `pi.assistant` is the installed .04 projection kind |
| sessions.get/open/submit/abort/close | actual parent scope and task lifecycle | task Agent stays null; opening same preset is not a grant |
| events.on('session.close') | revoke parent/child grant | not the post-turn nudge trigger |
| triggers.start/stop | lifecycle initialization/revocation | config is startup-selected, not a new live-config subscription framework |
| paths.data | private counters/dedup | no global session DB reads |
| existing native workspace skills index/view | later-session discovery/read | no custom scanner/cache or copied upstream index |

The raw beforeRequest messages and public transcript projection are structured
cloned, including available tool arguments/results, corrections and verification.
Review input is a bounded JSON text snapshot, explicitly labeled non-lossless.
For exceptionally long histories it retains both ends (latest verification stays)
and labels the omitted middle; large binary data payloads are not copied. It does
not mutate the parent's messages/transcript. The public SDK supplies no immutable
as-of-run transcript API, so generation checks refuse races rather than pretending
to have an exact fork. Existing private skills named in prior skill/tool evidence
can be fresh-read; tasks do not inherit a parent's workspace or an unexposed full
parent system skill index. No second discovery scanner is introduced.

The review preset is fixed Sol/high, only read/write capabilities and its three
scoped tools, no shell, generic file writer, message, tool search or delegation.
Its `maxTurns:16` native limit is soft; the plugin additionally enforces a **hard
16-request ceiling** in beforeRequest. It does not claim an upstream aggregate
input-token budget or parent cache/billing identity. On .04, beforeRequest exceptions
are reported nonfatal; throwing alone is NOT a request veto. The plugin revokes,
starts public sessions.abort outside the current hook's self-join, and holds the
hook until its genuine ctx.signal is cancelled before returning. The native
protocol test confirms 0 unauthorized-child requests and no seventeenth review
request. Focus is also enforced by beforeTool and each tool wrapper, not just
prompt instructions.

## Foreground / review tools

- `learning_memory_read/edit`: compatible legacy shapes plus atomic
  operations batch/new_text alias, detailed terminal/error fields.
- `learning_memory_pending`: list/read/apply/discard actual proposals.
  Applying requires the proposal's exact source version; stale/error records stay.
- `learning_skill_store`: read/save/create/edit/patch, support files,
  batch, list_archives/archive/restore. Existing files retain CAS; native scripts
  are only text, not executed. Archive ownership/pinned limits are enforced by store.
- `learning_refine`: a real callable attended entry. The current trusted
  human input must begin `/refine`; model arguments contain only optional focus.
  It queues after this turn and does not requeue after interruption. Explicit
  focus replaces any queued automatic focus rather than expanding permission.
- Internal `learning_review_memory_read/edit` and
  `learning_review_skill_store`: use the same storage with trusted grant
  options. Exact-file fresh reads use this skill store, not native task skill_view.

Unattended memory add saves automatically; destructive patch/remove/mixed batches
stage silently (`saved:false`). Foreground and trusted attended refine save
normally. Pending is not an additional approval layer for all writes and never
sends Feishu. Review results/progress never call a channel/message API. New native
skills are written into configured workspace/skills with existing profile
`hermes-learned-*` selection; no separate index or cache.

Recipe/manifest/guidance/teaching skill now expose these actual features. Full off
removes plugin/context/skill selection; `enabled:false` refuses tools and schedules
no work or IO. Native skills remain native files, so boolean-off alone does not
remove independently selected skill descriptions. Removing scopes/profile mapping
or actual session close denies further grants; plugin stop revokes all running
ones. There is no new per-review approval or extra operator setting.

## Prompt policy and non-goals

The source prompt blocks were read directly, not inferred from product marketing.
The adapted memory/skills/combined prompts allow **Nothing to save**, route one fact
to one store, prioritize modifying a relevant existing private skill, then umbrella
support files, then a reusable class-level skill. They preserve correction and
verified-method signals, exact-file fresh reads, topical resources, fixing wrong
sentences in place, and avoiding transient/unresolved failures as standing rules.
Unlike upstream's broader skill edits, shared/builtin/external skills remain outside
this plugin's private writer scope. Independent curator, external provider flush,
Python tools, Hermes frozen-session cache, lossless multimedia/cache forks and
compaction markers are not implemented or claimed.

## Verification

`../test/review.test.mjs` uses real SDK registration, actual registered hooks/events,
real storage IO and a controlled session API/clock. It is not just source-string
assertions and not a model test. The 52 experience store/registration/learning regressions are native Vitest tests
in the root `npm test` discovery, plus official package contract tests. External
workspace preview/provision tests are not this plugin’s responsibility.
`../scripts/accept-learning-controlled.mjs` separately exercises the actual built
package in real openKernel with a controlled local HTTP protocol fixture, including
native later-session skill discovery and reuse. See the official migration
verification document in the main repository for fresh artifact evidence.
Controlled protocol tests do not establish real Sol judgment or production E2E.

## Channel qualification

Direct registered-hook refine tests do not establish channel routing. The original external 0.1.1
native CLI probe found Harness .04 consumes `/refine` as an unknown channel
command before model admission. See the original external release handoff for exact
evidence and responsible core functions. Automatic reviews and scoped storage are
separately verified; owner-channel attended refine is blocked until main fixes
native routing. Do not claim production/channel completeness from unit tests.
