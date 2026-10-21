import type { Models, Preset } from "@yonder/sdk";
import { type AgentConfig, resolveProfile, type YonderConfig } from "../config/index.js";
import type { LoadedPlugins } from "../plugins/index.js";
import type { Runtime } from "../runtime/index.js";
import type { createSessions } from "../sessions/index.js";
import type { createSkills } from "../skills/index.js";
import type { createStore } from "../store/index.js";

export function terminalApi(ctx: {
	home: string;
	config: YonderConfig;
	agents: Map<string, AgentConfig>;
	loaded: LoadedPlugins;
	homePresets: Map<string, Preset>;
	models: Models;
	sessions: ReturnType<typeof createSessions>;
	store: Awaited<ReturnType<typeof createStore>>;
	runtime: () => Runtime;
	skills: ReturnType<typeof createSkills>;
	observe: (
		id: string,
		send: (update: import("@yonder/sdk").SessionUpdate) => Promise<void>,
	) => Promise<() => Promise<void>>;
}) {
	const {
		home,
		config,
		agents,
		loaded,
		homePresets,
		models,
		sessions,
		store,
		runtime: realRuntime,
		skills,
		observe: observeSession,
	} = ctx;
	return {
		presets: () =>
			[...new Map([...loaded.presets, ...homePresets]).values()].map((preset) => {
				const profile = resolveProfile(preset),
					slash = profile.model.indexOf("/");
				const model = models.getModel(profile.model.slice(0, slash), profile.model.slice(slash + 1));
				return {
					id: preset.id,
					description: preset.description,
					...profile,
					...(model
						? {
								modelInfo: {
									id: model.id,
									provider: model.provider,
									contextWindow: model.contextWindow,
									reasoning: model.reasoning,
								},
							}
						: {}),
				};
			}),
		channels: () =>
			Object.entries(config.channels ?? {})
				.filter(([, channel]) => channel.type === "cli")
				.map(([id]) => ({
					id,
					agents: [...agents.values()].flatMap((agent) => {
						const bindings = agent.archivedAt
							? []
							: agent.bindings.filter(
									(binding) => !binding.match.channel || [binding.match.channel].flat().includes(id),
								);
						return bindings.length
							? [
									{
										id: agent.id,
										name: agent.name,
										work: agent.work,
										main: bindings.some((binding) => binding.session === "main"),
									},
								]
							: [];
					}),
				})),
		async list() {
			return Promise.all(
				(await sessions.api.list({})).map(async (session) => {
					const messages = await realRuntime().terminalHistory(session.id);
					const texts = messages.map((message) =>
						typeof message.content === "string"
							? message.content
							: message.content
									.filter((block) => block.type === "text")
									.map((block) => block.text)
									.join("\n"),
					);
					const state = await realRuntime().sessionState(session.id);
					return {
						...session,
						agentName: session.agent ? agents.get(session.agent)?.name : undefined,
						agentWork: session.agent ? agents.get(session.agent)?.work : undefined,
						cwd: state?.cwd ?? home,
						messageCount: messages.length,
						firstMessage: texts[0]?.replace(/^<turn\b[\s\S]*?<\/turn>\s*/, "") ?? "",
						allMessagesText: texts.join("\n"),
						modified: messages.at(-1)?.timestamp
							? new Date(messages.at(-1)?.timestamp ?? 0).toISOString()
							: session.opened,
					};
				}),
			);
		},
		submit: sessions.submitAccepted,
		async queued(id: string, withdraw = false) {
			return Promise.all(
				(await realRuntime().queued(id, withdraw)).map(async (item) => {
					const event = item.event ? await store.events.get(item.event) : undefined;
					const text = (event?.data as { text?: string } | undefined)?.text;
					return { ...item, text: text ?? item.text };
				}),
			);
		},
		async info(id: string) {
			const session = await sessions.api.get(id);
			if (!session) throw new Error(`Unknown session: ${id}`);
			const active = await realRuntime().sessionConfig(id),
				ref = active.resolved.model,
				slash = ref.indexOf("/");
			const model = models.getModel(ref.slice(0, slash), ref.slice(slash + 1));
			return {
				session,
				agentName: session.agent ? agents.get(session.agent)?.name : undefined,
				agentWork: session.agent ? agents.get(session.agent)?.work : undefined,
				config: active,
				model: model
					? {
							id: model.id,
							provider: model.provider,
							contextWindow: model.contextWindow,
							reasoning: model.reasoning,
						}
					: undefined,
				state: await realRuntime().sessionState(id),
				usage: await realRuntime().usage(id),
				skills: await skills.inspect(active),
			};
		},
		observe: observeSession,
	};
}
