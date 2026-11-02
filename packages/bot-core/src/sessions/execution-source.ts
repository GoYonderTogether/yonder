import type { AgentConfig } from "@yonder/bot-definition";
import type { Runtime } from "@yonder/runtime-adapter";
import type { ExecutionOwner, Input, SubmissionMetadata, ToolContext, YEvent } from "@yonder/sdk";
import type { Store } from "../store/contracts.js";
import { requestSources } from "../tools/parent-origin.js";

/** Re-read only captured native inputs and core-created submission links. No profile implies ownership. */
export async function executionSources(
	store: Store,
	agents: Map<string, AgentConfig>,
	owner: ExecutionOwner,
	seen = new Set<string>(),
): Promise<YEvent[] | undefined> {
	if (!owner.inputs?.length) return;
	const session = await store.sessions.get(owner.session);
	if (!session || session.agent !== owner.agent || session.profile !== owner.profile) return;
	const sources = new Map<string, YEvent>();
	for (const id of new Set(owner.inputs)) {
		if (seen.has(id)) return;
		const input = await store.events.get(id);
		if (!input) return;
		const path = new Set(seen).add(id);
		const data = input.data as { session?: string; executionOwner?: ExecutionOwner };
		if (input.type === "session.input" && data.session === session.id && data.executionOwner) {
			const inherited = await executionSources(store, agents, data.executionOwner, path);
			if (!inherited) return;
			for (const event of inherited) sources.set(event.id, event);
			continue;
		}
		if (!session.agent || !agents.has(session.agent)) return;
		const originals = await requestSources(store, session, [id]);
		if (!originals?.length) return;
		for (const event of originals) {
			if (
				(event.data as { kind?: string }).kind !== "dm" ||
				!event.from ||
				(await store.identity().relation(session.agent, event.from)) !== "owner"
			)
				return;
			sources.set(event.id, event);
		}
	}
	return sources.size ? [...sources.values()] : undefined;
}

/** Only the runtime's registered invocation can supply a creator's source set. */
export async function captureExecutionOwner(
	store: Store,
	agents: Map<string, AgentConfig>,
	runtime: Runtime,
	ctx: ToolContext,
): Promise<ExecutionOwner> {
	const actual = await runtime.invocationContext(ctx);
	const owner = { session: actual.session, agent: actual.agent, profile: actual.profile };
	const inputs = [...new Set((actual.events ?? []).map((event) => event.id))];
	return (await executionSources(store, agents, { ...owner, inputs })) ? { ...owner, inputs } : owner;
}

/** The only submission writer carries validated creator refs, never arbitrary model JSON. */
export async function recordSessionInput(
	store: Store,
	agents: Map<string, AgentConfig>,
	session: string,
	input: Input,
	waiting: boolean,
	busy: "followup" | "steer" | "interrupt" | undefined,
	from?: string,
	metadata?: SubmissionMetadata,
) {
	const requested = metadata?.executionOwner;
	const owner = requested
		? {
				session: requested.session,
				agent: requested.agent,
				profile: requested.profile,
				...((await executionSources(store, agents, requested)) ? { inputs: [...requested.inputs!] } : {}),
			}
		: undefined;
	return store.events.record({
		type: "session.input",
		...(from ? { from } : {}),
		data: {
			session,
			text: input.text,
			waiting,
			busy: busy ?? "steer",
			...(input.attachments ? { attachments: input.attachments } : {}),
			...(owner ? { executionOwner: owner } : {}),
			...(metadata?.resources ? { resources: structuredClone(metadata.resources) } : {}),
		},
	});
}
