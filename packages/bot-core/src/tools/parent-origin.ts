import type { SessionInfo, YEvent } from "@yonder/sdk";
import type { Store } from "../store/contracts.js";

/** Follow only kernel continuations belonging to this actual session and conversation. */
async function requestInput(store: Store, session: SessionInfo, id: string): Promise<YEvent | undefined> {
	let input = await store.events.get(id);
	const conv = input?.conv;
	const seen = new Set<string>();
	for (let hops = 0; input; hops++) {
		if (
			!conv ||
			input.conv !== conv ||
			seen.has(input.id) ||
			!input.routes?.some((r) => r.agent === session.agent && r.session === session.id && !r.dropped)
		)
			return;
		seen.add(input.id);
		if (!["runtime.tool-result", "runtime.continuation"].includes(input.type)) return input;
		if (
			input.from !== undefined ||
			(input.data as { session?: string }).session !== session.id ||
			!input.parent ||
			hops >= 64
		)
			return;
		input = await store.events.get(input.parent);
	}
}

/** Re-read actual inputs and their admitted source messages, never identity copies in model text. */
export async function parentSources(
	store: Store,
	session: SessionInfo,
	inputs: string[],
): Promise<YEvent[] | undefined> {
	const sources = new Map<string, YEvent>();
	let conv: string | undefined;
	for (const id of new Set(inputs)) {
		const input = await requestInput(store, session, id);
		if (!input?.conv) return;
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

/** All verified human inputs for a run, including same-Agent main handoffs and their continuations. */
export async function requestSources(
	store: Store,
	session: SessionInfo,
	inputs: string[],
): Promise<YEvent[] | undefined> {
	const sources = new Map<string, YEvent>();
	for (const id of new Set(inputs)) {
		const input = await requestInput(store, session, id);
		if (!input) return;
		const originals =
			(input.data as { kind?: string }).kind === "parent-request"
				? await parentOrigins(store, input, session.agent ?? "")
				: await parentSources(store, session, [input.id]);
		if (!originals) return;
		for (const original of originals) sources.set(original.id, original);
	}
	return sources.size ? [...sources.values()] : undefined;
}

/** One canonical group only when every verified source of the admitted input shares a conversation. */
export async function requestSourceGroup(
	store: Store,
	session: SessionInfo,
	eventId: string,
): Promise<string | undefined> {
	const sources = await requestSources(store, session, [eventId]);
	const conv = sources?.[0]?.conv;
	return conv && sources?.every((source) => source.conv === conv) ? conv : undefined;
}

export async function requestSourceGroupForSession(
	store: Store,
	sessionId: string,
	eventId: string,
): Promise<string | undefined> {
	const session = await store.sessions.get(sessionId);
	return session ? requestSourceGroup(store, session, eventId) : undefined;
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
