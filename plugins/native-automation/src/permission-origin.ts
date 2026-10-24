import type { PluginAPI, ToolContext, YEvent } from "@yonder/sdk";

/** Actual kernel inputs only: never quoted sources or model-supplied IDs. */
export async function requireOwnerOrigin(api: PluginAPI, ctx: ToolContext): Promise<void> {
	const inputs = ctx.events ?? (ctx.event ? [ctx.event] : []);
	if (!ctx.agent || !inputs.length) throw new Error("Permission actions require an owner input");
	const deny = () => new Error("Permission actions require exclusively owner inputs in this run");
	for (const input of inputs) {
		let event: YEvent = input;
		const seen = new Set<string>();
		let hops = 0;
		while (true) {
			ctx.signal.throwIfAborted();
			if (seen.has(event.id)) throw deny();
			seen.add(event.id);
			const internal = ["runtime.tool-result", "runtime.continuation"].includes(event.type);
			const session = (event.data as { session?: unknown }).session;
			// Direct inputs keep the existing identity rule. Every causal hop must
			// additionally stay on the actual input's conversation and route.
			if (internal || hops > 0) {
				if (
					event.conv !== input.conv ||
					!event.routes?.some(
						(route) => route.agent === ctx.agent && route.session === ctx.session && !route.dropped,
					) ||
					((session !== undefined || event.type === "session.input") && session !== ctx.session)
				)
					throw deny();
			}
			if (!internal) {
				if (
					!["message.in", "session.input"].includes(event.type) ||
					!event.from?.startsWith("acct:") ||
					event.from.startsWith("acct:agent:") ||
					(await api.identity.relation(ctx.agent, event.from)) !== "owner"
				)
					throw deny();
				ctx.signal.throwIfAborted();
				break;
			}
			// Kernel-generated continuations have no from; channels cannot emit
			// runtime.* (pluginEvent enforces their own namespace).
			if (event.from !== undefined || session !== ctx.session || !event.parent || hops >= 64) throw deny();
			const parent = event.parent;
			const page = await api.events.query({ id: parent, limit: 1 });
			ctx.signal.throwIfAborted();
			if (page.events.length !== 1 || page.events[0]?.id !== parent) throw deny();
			event = page.events[0];
			hops++;
		}
	}
}
