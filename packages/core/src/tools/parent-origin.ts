import type { SessionInfo, YEvent } from "@yonder/sdk";
import type { Store } from "../store/index.js";

/** Re-read actual inputs and their admitted source messages, never identity copies in model text. */
export async function parentSources(
	store: Store,
	session: SessionInfo,
	inputs: string[],
): Promise<YEvent[] | undefined> {
	const sources = new Map<string, YEvent>();
	let conv: string | undefined;
	for (const id of new Set(inputs)) {
		const input = await store.events.get(id);
		if (!input?.conv || !input.routes?.some((r) => r.agent === session.agent && r.session === session.id && !r.dropped))
			return;
		conv ??= input.conv;
		if (conv !== input.conv) return;
		const ids = input.type === "message.in" ? [input.id] : (input.data as { sourceEvents?: unknown }).sourceEvents;
		if (!Array.isArray(ids) || !ids.length || ids.some((value) => typeof value !== "string")) return;
		for (const sourceId of ids) {
			const source = await store.events.get(sourceId);
			if (
				source?.type !== "message.in" ||
				source.conv !== conv ||
				!source.from?.startsWith("acct:") ||
				source.from.startsWith("acct:agent:") ||
				!source.routes?.some((r) => r.agent === session.agent && r.session === session.id && !r.dropped)
			)
				return;
			sources.set(source.id, source);
		}
	}
	return sources.size ? [...sources.values()] : undefined;
}

export async function parentOrigins(store: Store, event: YEvent, agent: string): Promise<YEvent[] | undefined> {
	const data = event.data as {
		kind?: string;
		target?: string;
		requestOrigin?: { session?: string; inputs?: string[]; events?: Array<{ id?: string }> };
	};
	if (
		event.type !== "message.in" ||
		data.kind !== "parent-request" ||
		data.target !== agent ||
		event.from !== `acct:agent:${agent}` ||
		event.conv !== `conv:agent:${agent}` ||
		!event.parent
	)
		return;
	const origin = data.requestOrigin;
	if (!origin || typeof origin.session !== "string") return;
	const session = await store.sessions.get(origin.session);
	if (!session || session.agent !== agent || session.mode === "main" || session.mode === "task") return;
	const inputs = origin.inputs ?? [event.parent];
	if (!Array.isArray(inputs) || !inputs.includes(event.parent) || inputs.some((id) => typeof id !== "string")) return;
	const sources = await parentSources(store, session, inputs);
	if (!sources) return;
	// Old requests only named originals; they must still belong to their actual parent's source set.
	if (!origin.inputs) {
		const ids = origin.events?.map((source) => source.id);
		if (
			!ids?.length ||
			new Set(ids).size !== sources.length ||
			ids.some((id) => !sources.some((source) => source.id === id))
		)
			return;
		return sources;
	}
	return sources;
}
