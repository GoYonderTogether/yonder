// Adapted, not verbatim: fixed upstream prompt_builder.py symbols in SOURCES.md.
export function coreGuidance(s) {
	const out = ["# Hermes core practice (Yonder adaptation)"];
	if (s.memory !== false || s.user !== false)
		out.push(
			"Memory is the narrow exception: confirmed declarative facts useful across tasks, not procedures, transient progress or instructions. Never credentials. " +
				`Enabled targets: ${["memory", "user"].filter((t) => s[t] !== false).join(", ")}. Use hermes-experience_memory_read before any edit; respect its character budget. ` +
				(s.writeMode === "exclusive-yonder"
					? "Use hermes-experience_memory_edit with the returned revision; consolidate stale facts rather than silently dropping new information."
					: "Memory is readonly; do not attempt mutations."),
		);
	if (s.learning === true && s.skillDir)
		out.push(
			"Reusable procedures, pitfalls and task-specific corrections belong in skills, not memory. Read hermes-yonder and the selected skill-creator through native skill_view before authoring. After a verified nontrivial workflow, save a concise method with prerequisites, tested steps, verification evidence and limitations using hermes-experience_skill_store. Read its revision first; absent is for new names only. The store also supports precise patch, supporting text files, atomic batch and reversible owned-skill archive/restore; scripts are data, not executed. Use hermes-learned-* names. A successful save persists a native SKILL.md; a new context discovers its description, not its entire body. Read relevant skills on demand with skill_view before reuse. Reload an unavailable or compacted skill rather than acting from a placeholder. Saving text does not execute it or grant tool permissions.",
		);
	out.push(
		"Quiet learning: genuine user runs count toward memory review every 10 turns and skill review every 10 model iterations when that scope is enabled. A separate scoped task runs after 15 seconds of quiet; the next foreground request preempts it. No channel progress or result messages are sent. Unattended memory patch/remove stages a proposal, not a save: use the pending-management tool to list/read/apply/discard. A user message beginning /refine authorizes explicit attended review through hermes-experience_refine; the model cannot grant itself attended permission. Nothing to save is valid.",
	);
	out.push(
		"## Finishing the job\nFor build/run/verify requests, deliver a working artifact backed by actual tool evidence, not just a plan or stub. Exercise the result with tools actually offered. If capability or authorization blocks verification, report the blocker and unverified scope; never fabricate output or claim E2E. Keep scope, decisions, progress and next action explicit; no background continuation without a real trigger. No kanban or delegation tools are supplied by this recipe.",
	);
	out.push(
		"Context difference: memory is refreshed on system render, including later renders in the same session. It is not an upstream session-frozen prefix. Old prompt/transcript text is not rewritten or erased on save/disable. No durable frozen cache or Hermes compaction marker semantics are reproduced.",
	);
	return out.join("\n\n");
}
