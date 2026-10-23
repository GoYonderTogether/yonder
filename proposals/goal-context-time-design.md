# Goals, context maintenance, and time presentation: design proposal

Status: proposal for maintainer review; not a new runtime contract. This document is public technical design only and contains no user-specific conversation, usage, or account data.

## Scope and evidence

The current implementation already has several relevant pieces:

- `packages/core/src/prompt/content.ts` provides the shared instructions and now asks multi-step work to keep a checkable goal, scope, budget, and stop when a fit-for-purpose check passes.
- `docs/spec/07-runtime.md` documents native `pi-durable` compaction and the `compaction.backgroundAtTokens` absolute threshold. `packages/pi-durable/src/harness/generation.ts` starts automatic compaction at the earlier of the blocking threshold and that configured absolute threshold. The current default policy enables background compaction, but does not set `backgroundAtTokens`.
- `/compact` and session status are already shared commands. A manual compaction is a task, not a model run; compaction writes at an idle boundary when needed.
- Runtime reminders (`maxTurns`, `maxMinutes`, `maxTokens`) are soft notices. They do not end work or decide whether a goal is complete.
- The runtime clock currently includes an ISO UTC instant and the resolved host timezone in the prepared turn. Cron schedules already require an explicit IANA timezone; memory also has its own explicit timezone.

This is a proposal, not evidence that every proposed behavior has been implemented or tested end to end.

### Public implementation references

- [Default compaction policy](https://github.com/GoYonderTogether/yonder-harness/blob/0a7ce8f/packages/pi-durable/src/harness/agent.ts)
- [Automatic compaction threshold](https://github.com/GoYonderTogether/yonder-harness/blob/0a7ce8f/packages/pi-durable/src/harness/generation.ts)
- [Runtime limits and compaction configuration](https://github.com/GoYonderTogether/yonder-harness/blob/0a7ce8f/docs/spec/07-runtime.md)
- [Runtime clock prompt assembly](https://github.com/GoYonderTogether/yonder-harness/blob/0a7ce8f/packages/core/src/prompt/index.ts)
- [Cron timezone validation](https://github.com/GoYonderTogether/yonder-harness/blob/0a7ce8f/plugins/cron/src/schedule.ts)

## Prompt changes

The shared prompt change in this branch is deliberately small: consolidate genuinely related incoming work into an existing goal; keep the finish condition and scope observable; treat budgets as steering reminders; do not impose formal plans on simple requests; do not repeat a passing check without new evidence; continue independent authorized work around a blocker.

For Jarvis-style agents, prefer these principles in the shared instructions over another private checklist. The preset template should add only role-specific accountabilities, not duplicate the common goal and stop rules. Do not edit a resident owner's `SOUL.md` or `AGENTS.md` as part of publishing a template change. In particular, the private Jarvis workspace is not a template repository.

## Compression and quiet-session maintenance

### Recommendation

Use two stages rather than adding another always-on model loop.

1. **Bounded automatic context use:** set a default absolute background-compaction threshold of 200,000 tokens using the existing `backgroundAtTokens` capability, while preserving native model-window thresholds. The effective start must remain the earlier of this threshold and the model's blocking threshold (`contextWindow - reserveTokens`). Smaller-window models therefore compact earlier; 200k is not a guarantee that every model can hold 200k. Keep model-provided context windows authoritative. Retain explicit `/compact` for the owner and never compact away an active run's uncommitted turn.
2. **Idle housekeeping as a separate, opt-in design:** after a session has remained quiet for 30 minutes, consider compaction/review only if there is meaningful new context to reduce and no active foreground run. Reuse the existing idle boundary and native compaction task. Do not run a new model call for an empty or already compact session. A session with active background work is not idle merely because the main loop is quiet. The first release should compact only; any retrospective review or skill editing must be a separate, bounded opt-in operation, with its own artifact and provenance.

A quiet-trigger must be restart-safe, coalesce repeated timers, cancel when new input arrives, and re-check the session/task state at execution time. It must not interrupt running tools, cancel tasks, or treat `checkpoint.phase=interrupted` by itself as proof of a stuck task. Compaction and a post-conversation review are distinct actions: summarizing does not itself authorize edits to memory or skills.

### Summary contract

Whether compaction is automatic or manual, preserve enough to resume without replaying finished work:

- current goal, scope, acceptance condition, and budget (if any);
- decisions made and their source/authority;
- completed work and verification evidence, including failures and skipped checks;
- open work, actual blockers, and a concrete next step;
- active task/process IDs and their last observed state, not inferred state;
- external side effects (messages, writes, sends, installs, merges) with confirmed/unknown status;
- relevant artifact paths and the intended audience/privacy boundary.

The compression test should assert semantic preservation of these fields, while ensuring obsolete tool chatter and repeated status updates are not carried forward. It should not claim exact-token savings without measuring the actual serialized model request.

## Goal and acceptance mechanism

### Recommendation

Begin with prompt-level behavior and existing soft reminders, not a mandatory `goal_set` tool or a gate on side effects. For multi-step work, express the goal and one observable finish condition in the working record or task handoff; for ordinary one-step work, do not require a separate artifact. Continue using existing task IDs and `task_continue` for genuine asynchronous work. No new goal database or tool is justified until an evaluation shows that existing prompts and task records fail.

A hard gate would add a second permission/approval layer, could obstruct safe small actions, and would conflict with the documented invariant that the model determines when work is complete. A new lightweight goal tool is a possible later experiment only if the runtime can expose its state without requiring a model call or changing tool authorization.

### Evaluation before escalation

Run a paired, same-model, same-tool, same-input evaluation on a small fixed set of cases: (a) routine reversible task that can be executed without asking; (b) genuinely human-only authorization boundary; (c) one blocked substep with independent work remaining; (d) small task susceptible to scope growth; (e) a tool output that already verifies success; (f) a pending long task with an accepted continuation. Compare the existing prompt and candidate prompt. Score correct execution/asking, finish-condition attainment, unnecessary checks/turns, scope drift, and truthful status. Use at least one comparatively high-cost/long-context model, because model behavior may differ by model. Do not use a model-generated self-rating as the only result; record raw task outcomes, tool calls and cost in a private test artifact, and publish only aggregate technical conclusions.

## Time and locale

The proposed default is Chinese (`zh-CN`) and `Asia/Shanghai`; no such global Harness preference exists today. Add it as explicit instance configuration, not by changing `TZ`, the machine locale, or cron's per-job timezone. Keep three facts distinct:

- **Clock instant:** an absolute UTC instant supplied by the host runtime. A display timezone cannot repair a host clock that is itself wrong.
- **Presentation timezone:** configured Harness default, proposed `Asia/Shanghai`, for human-facing current/local date and time.
- **Schedule timezone:** each cron job's explicit timezone; never silently reinterpret existing jobs when the presentation default changes.

Proposed configuration would default new homes to `locale: zh-CN` and `timezone: Asia/Shanghai`, allow an explicit override, and emit both an unambiguous UTC instant and the configured zone/offset in runtime context. Migrations should preserve explicitly configured user values, avoid rewriting system time, and not change existing cron/memory-specific timezones. Tests should cover DST/offset formatting, UTC ISO round-trip, host timezone different from configured zone, invalid IANA values, and existing schedules. This configuration and migration need a focused implementation PR; this branch does not change runtime timezone behavior.

## Out of scope

This proposal does not change production configuration, private workspaces, credentials, branch cleanup, or runtime timezone behavior. Those require separate implementation and verification.