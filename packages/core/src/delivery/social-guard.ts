import type { Channel } from "@yonder/sdk";
import { parseRef } from "@yonder/sdk";
import { assertChannelInstance } from "../config/console.js";
import type { AgentConfig } from "../config/index.js";
import { decideParticipation, type ParticipationHooks } from "../routing/social.js";
import type { Sessions } from "../sessions/index.js";
import type { Store } from "../store/index.js";

/** Reasons that block a reply (04 §3.6): the kernel keeps this table, the plugin only names the reason. */
const blocked = [
	"denied",
	"not-authorized",
	"mute",
	"quiet",
	"invalid-timezone",
	"channel-kind-mismatch",
	"unsupported-kind",
];

export function createReplyGuard({
	sessions,
	agents,
	store,
	channels,
	participationHooks,
}: {
	sessions: Sessions;
	agents: Map<string, AgentConfig>;
	store: Store;
	channels: Map<string, Channel>;
	participationHooks?: ParticipationHooks;
}) {
	return async (sessionId: string, target: string, parent?: string) => {
		const row = await store.sessions.get(sessionId);
		const agent = row?.agent ? agents.get(row.agent) : undefined;
		if (!agent?.social?.enabled) return;
		const current = await sessions.resolveSession(sessionId);
		const ref = parseRef(target);
		const instance = ref.kind === "acct" || ref.kind === "conv" ? ref.channel : "";
		assertChannelInstance(current.resolved, instance);
		if (!parent) return;
		const source = await store.events.get(parent);
		if (source?.type !== "message.in" || source.conv !== target) return;
		const person = source.from?.startsWith("acct:") ? (await store.identity().account(source.from))?.person : undefined;
		// An unavailable participation plugin throws here, so the reply is blocked and recorded like any other block.
		const decision = decideParticipation(agent, source, person, channels.get(instance), participationHooks, {
			outbound: true,
		});
		if (decision && blocked.includes(decision.reason)) throw new Error(`Social delivery blocked: ${decision.reason}`);
	};
}

export async function* guardStream<T>(parts: AsyncIterable<T>, check: () => Promise<void>): AsyncIterable<T> {
	for await (const part of parts) {
		await check();
		yield part;
	}
}
