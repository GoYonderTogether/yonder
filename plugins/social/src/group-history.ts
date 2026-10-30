import type { PluginAPI, Ref, YEvent } from "@yonder/sdk";
/** Public ledger only. Native message IDs deduplicate trusted Card fanout, never guessed QQ aliases. */
export async function* groupEvents(api: PluginAPI, type: string, conv?: Ref) {
	let after: string | undefined;
	do {
		const page = await api.events.query({ type, ...(conv ? { conv } : {}), limit: 1000, ...(after ? { after } : {}) });
		for (const event of page.events) yield event;
		after = page.next;
	} while (after);
}
export async function publicEvents(api: PluginAPI, convs: Set<Ref>, limit = 100) {
	const events: YEvent[] = [];
	const seen = new Set<string>();
	for (const conv of convs)
		for (const type of ["message.in", "message.out"])
			for await (const event of groupEvents(api, type, conv)) {
				const data = event.data as { msgId?: string; social?: { room?: string }; delivery?: { ok?: boolean } };
				if (type === "message.out" && !data.delivery?.ok) continue;
				const key =
					type === "message.in" && data.social?.room && data.msgId ? `${data.social.room}:${data.msgId}` : event.id;
				if (!seen.has(key)) {
					seen.add(key);
					events.push(event);
				}
			}
	return events.sort((a, b) => a.id.localeCompare(b.id)).slice(-limit);
}
export function publicMessage(e: YEvent) {
	const d = e.data as Record<string, unknown>;
	return {
		id: e.id,
		at: e.ts,
		from: e.from,
		conv: e.conv,
		type: e.type,
		text: d.text,
		name: d.name,
		mentions: d.mentions,
		mentioned: d.mentioned,
		replyTo: d.replyTo,
		senderIsBot: d.senderIsBot,
	};
}
export async function publicHistory(api: PluginAPI, convs: Set<Ref>) {
	return (await publicEvents(api, convs, 30)).map(publicMessage);
}

export interface GroupPause {
	source: string;
	actor?: Ref;
	scope: "interaction" | "group";
}
/** Restore observations and authorized pause facts, never old speaking grants. */
export async function restoreGroupState(
	api: PluginAPI,
	reads: Map<string, string>,
	pauses: Map<string, GroupPause>,
	counters: Map<string, number>,
) {
	for await (const event of groupEvents(api, "social.rule-match")) {
		const d = event.data as { agent?: string; counter?: number };
		if (event.conv && d.agent) counters.set(`${d.agent}\0${event.conv}`, d.counter ?? 0);
	}

	for (const type of ["social.batch-read", "channel-qq.group-read"])
		for await (const event of groupEvents(api, type)) {
			const data = event.data as { agent?: string; through?: string };
			if (!event.conv || !data.through) continue;
			const agents = data.agent
				? [data.agent]
				: ((await api.events.query({ id: data.through })).events[0]?.routes
						?.filter((r) => !r.dropped)
						.map((r) => r.agent) ?? []);
			for (const agent of agents) {
				const key = `${agent}\0${event.conv}`;
				if (data.through > (reads.get(key) ?? "")) reads.set(key, data.through);
			}
		}
	for await (const event of groupEvents(api, "social.policy-change")) {
		const data = event.data as {
			agent?: string;
			result?: string;
			after?: { pause?: GroupPause | null };
			kind?: string;
		};
		if (data.kind !== "group-pause" || data.result !== "applied" || !data.agent || !event.conv) continue;
		const key = `${data.agent}\0${event.conv}`;
		if (data.after?.pause) pauses.set(key, data.after.pause);
		else pauses.delete(key);
	}
}
