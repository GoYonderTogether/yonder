import type { EventInput, PluginAPI, YEvent } from "@yonder/sdk";
import type { State } from "./batches.js";

export async function recoverJudge(api: PluginAPI, end: YEvent, start: YEvent, entries: YEvent[], revision: string) {
	const data = start.data as { agent: string; through: string; session: string };
	if (!start.conv || (end.data as { status?: string }).status !== "done") return;
	const sourceEvents = entries.map((entry) => entry.id);
	if (!sourceEvents.length || sourceEvents.at(-1) !== data.through) return;
	const request = {
		agent: data.agent,
		conv: start.conv,
		through: data.through,
		sourceEvents,
		policyRevision: revision,
	};
	if (!(await api.social?.admitBatch(request))) return;
	const transcript = await api.sessions.transcript(data.session, { before: Number.MAX_SAFE_INTEGER, limit: 100 });
	const text = transcript.filter((item) => item.kind === "pi.assistant").at(-1)?.text;
	let output: { action?: unknown; sourceEvents?: unknown; reason?: unknown };
	try {
		output = JSON.parse(text ?? "");
	} catch {
		return;
	}
	if (
		!["ignore", "summarize", "participate"].includes(String(output.action)) ||
		!Array.isArray(output.sourceEvents) ||
		!output.sourceEvents.every((id) => typeof id === "string" && sourceEvents.includes(id)) ||
		typeof output.reason !== "string"
	)
		return;
	const msgId = `batch:${data.agent}:${start.conv}:${revision}:${data.through}`;
	const batch: EventInput = {
		type: "social.batch-ready",
		from: "plugin:social",
		conv: start.conv,
		data: { msgId, agent: data.agent, through: data.through, sourceEvents, policyRevision: revision },
	};
	return api.events.emit({
		type: "social.judge-result",
		from: "plugin:social",
		conv: start.conv,
		data: {
			msgId: `judge-result:${msgId}`,
			agent: data.agent,
			through: data.through,
			action: output.action,
			sourceEvents: output.sourceEvents,
			reason: output.reason,
			batch,
		},
	});
}

export async function recoverJudgment(
	api: PluginAPI,
	end: YEvent,
	start: YEvent,
	groups: Map<string, State>,
	judging: Map<string, YEvent>,
	read: Map<string, string>,
	readAt: Map<string, number>,
	schedule: (key: string, state: State) => void,
) {
	const { agent, through, session } = start.data as { agent: string; through: string; session: string };
	if (!start.conv) return;
	const key = `${agent}\0${start.conv}`;
	const state = groups.get(key);
	if (!state?.failed || state.failedThrough !== through) return;
	const entries = state.entries.filter((entry) => entry.source.id <= through);
	if (!entries.length || entries.some((entry) => entry.revision !== entries[0]!.revision)) return;
	const fact = await recoverJudge(
		api,
		end,
		start,
		entries.map((entry) => entry.source),
		entries[0]!.revision,
	);
	if (!fact) return;
	judging.delete(session);
	delete state.failed;
	delete state.failedThrough;
	const data = fact.data as { action: string; batch: EventInput };
	if (data.action === "participate") state.pending = data.batch;
	else {
		await api.events.emit({
			type: "social.batch-read",
			from: "plugin:social",
			conv: start.conv,
			parent: fact.id,
			data: { msgId: `judge-read:${fact.id}`, agent, through },
		});
		read.set(key, through);
		readAt.set(key, Date.now());
		state.entries = state.entries.filter((entry) => entry.source.id > through);
	}
	schedule(key, state);
}
