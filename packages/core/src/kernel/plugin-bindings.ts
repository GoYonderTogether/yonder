import { isDeepStrictEqual } from "node:util";
import type { AgentBindingRequest, AgentBindingRoute, Capability, ExecutionOwner, ToolContext } from "@yonder/sdk";
import { type AgentConfig, type Binding, resolveProfile, type YonderConfig } from "../config/index.js";
import { consoleAllowed } from "../delivery/console.js";
import type { RuntimeSessionConfig } from "../runtime/types.js";

/** Private plugin inputs still enter resident Agents through ordinary, persisted bindings. */
export function createPluginBindings(options: {
	config: YonderConfig;
	agents: Map<string, AgentConfig>;
	assert(ctx: ToolContext): void;
	resolve(owner: ExecutionOwner): Promise<RuntimeSessionConfig>;
	owner(agent: string, account: string): Promise<boolean>;
	target(request: { to: string; via: string }, agent: string, config: RuntimeSessionConfig): Promise<string>;
	hasSend(config: RuntimeSessionConfig): boolean;
	update(agent: string, binding: Binding): Promise<unknown>;
}) {
	const check = async (request: AgentBindingRequest, pluginId: string, owner: ExecutionOwner) => {
		const current = await options.resolve(owner);
		if (
			!owner.agent ||
			!["read", "write", "admin"].every((cap) => current.resolved.capabilities.includes(cap as Capability))
		)
			throw new Error("Private binding requires a resident admin/write execution owner");
		const agent = options.agents.get(owner.agent);
		if (!agent || agent.archivedAt) throw new Error("Agent unavailable");
		if (
			!/^[a-z0-9][a-z0-9-]*$/.test(request.id) ||
			!request.eventType.startsWith(`${pluginId}.`) ||
			!request.conv.startsWith(`conv:${pluginId}:`) ||
			/\s/.test(request.conv)
		)
			throw new Error("Binding must use its actual plugin namespace");
		const profile = agent.profiles[request.profile];
		if (!profile) throw new Error("Unknown binding profile");
		const entry = options.config.agents?.find((item) => item.id === agent.id);
		const resolved = resolveProfile(profile, agent.defaults, entry?.env, options.config.defaultModel);
		const config: RuntimeSessionConfig = {
			agent: agent.id,
			profile: request.profile,
			owner: agent.owner,
			cwd: "",
			resolved,
		};
		if (
			!resolved.plugins.includes(pluginId) ||
			!["read", "admin", "message"].every((cap) => resolved.capabilities.includes(cap as Capability)) ||
			!options.hasSend(config)
		)
			throw new Error("Binding profile must already select the plugin and provide read/admin/message and message_send");
		for (const binding of agent.bindings) {
			if ((binding.profile ?? agent.defaultProfile) !== request.profile) continue;
			if (binding.match.type && binding.match.type !== "message.in" && !binding.match.type.includes("*")) continue;
			const from = [binding.match.from ?? []].flat();
			const channels = [binding.match.channel ?? []].flat();
			const kinds = [binding.match.kind ?? []].flat();
			if (
				channels.length === 1 &&
				channels[0] === "agent" &&
				kinds.length > 0 &&
				kinds.every((kind) => kind === "agent" || kind === "parent-request") &&
				from.length > 0 &&
				from.every((ref) => {
					const peer = ref.startsWith("acct:agent:") ? options.agents.get(ref.slice("acct:agent:".length)) : undefined;
					return peer && !peer.archivedAt && peer.owner === agent.owner;
				})
			)
				continue;

			if (
				![binding.match.kind].flat().every((kind) => kind === "dm") ||
				!from.length ||
				!(
					await Promise.all(from.map((ref) => ref === "owner" || ref === agent.owner || options.owner(agent.id, ref)))
				).every(Boolean)
			)
				throw new Error("Binding profile is also used by a group or visitor route");
		}
		const target = await options.target(request.notification, agent.id, config);
		if (!target.startsWith("acct:") || !consoleAllowed(target, {}) || !(await options.owner(agent.id, target)))
			throw new Error("Notification target must be the Agent owner's linked private account");
		// The configuring execution's captured scope remains a ceiling after reload/restart.
		await options.target({ to: target, via: request.notification.via }, agent.id, current);
		const binding: Binding = {
			id: `${pluginId}:${request.id}`,
			match: { type: request.eventType, conv: request.conv },
			session: { mode: "persistent", per: "conv" },
			profile: request.profile,
			wake: "run",
			reply: "none",
		};
		const route: AgentBindingRoute = {
			binding: binding.id,
			profile: request.profile,
			conv: request.conv,
			notification: { to: target, via: request.notification.via },
			owner,
		};
		return { agent, binding, route };
	};
	return {
		async configureBinding(request: AgentBindingRequest, pluginId: string, ctx: ToolContext) {
			options.assert(ctx);
			if (
				!ctx.agent ||
				!["admin", "write"].every((cap) => ctx.capabilities.includes(cap as Capability)) ||
				ctx.event?.type !== "message.in" ||
				(ctx.event.data as { kind?: string }).kind !== "dm" ||
				!ctx.event.from ||
				!(await options.owner(ctx.agent, ctx.event.from))
			)
				throw new Error("An owner direct message and admin/write tool context are required");
			const owner = { session: ctx.session, agent: ctx.agent, profile: ctx.profile };
			const { agent, binding, route } = await check(request, pluginId, owner);
			await options.update(agent.id, binding);
			return route;
		},
		async inspectBinding(request: AgentBindingRequest, pluginId: string, owner: ExecutionOwner) {
			const { agent, binding, route } = await check(request, pluginId, owner);
			const actual = agent.bindings.find((item) => item.id === binding.id);
			if (!actual || !isDeepStrictEqual(actual, binding)) throw new Error("Private binding changed or removed");
			return route;
		},
	};
}
