import type { Channel } from "@yonder/sdk";
import { parseRef } from "@yonder/sdk";
import type { AgentConfig } from "../config/index.js";
import { assertChannelInstance } from "../kernel/console.js";
import { socialDecision } from "../routing/social.js";
import type { Sessions } from "../sessions/index.js";
import type { Store } from "../store/index.js";

export function createReplyGuard({
	sessions,
	agents,
	store,
	channels,
}: {
	sessions: Sessions;
	agents: Map<string, AgentConfig>;
	store: Store;
	channels: Map<string, Channel>;
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
		const decision = socialDecision(agent, source, person, channels.get(instance));
		if (
			decision &&
			[
				"denied",
				"not-authorized",
				"mute",
				"quiet",
				"invalid-timezone",
				"channel-kind-mismatch",
				"unsupported-kind",
			].includes(decision.reason)
		)
			throw new Error(`Social delivery blocked: ${decision.reason}`);
	};
}

export async function* guardStream<T>(parts: AsyncIterable<T>, check: () => Promise<void>): AsyncIterable<T> {
	for await (const part of parts) {
		await check();
		yield part;
	}
}
