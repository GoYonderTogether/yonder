import type { AgentConfig } from "../config/index.js";
import type { PromptOptions } from "../prompt/index.js";
import { toolDiscoveryGuide } from "../prompt/index.js";
import { pluginTemplateDirs } from "../prompt/templates.js";
import type { Runtime } from "../runtime/index.js";
import type { Store } from "../store/index.js";
import { conversationMembers, createConversationTools } from "../tools/conversation.js";
import { createCoreTools } from "../tools/index.js";
import { parentOrigins } from "../tools/parent-origin.js";
import { createPermissionsTool } from "../tools/permissions.js";
import { createSkillTool } from "../tools/skill-view.js";
import type { AgentOperabilityFact, OperabilitySelector, SessionOperabilityFact } from "./operability.js";
import { batchSourceFrame } from "./source-context.js";
import { createSubagentTool } from "./subagents.js";
import { filesFor, projectRulesFor } from "./workspace.js";

const ownerHistoryLimit = 4;
const ownerHistoryScanLimit = 100;
const ownerHistoryTextLimit = 2000;

const agentIdentity = (agent: string, name?: string) => ({
	agent,
	...(name ? { name } : {}),
	identityBasis: "agent-id",
	profileChangesIdentity: false,
	historyScope: "session",
});

async function ownerPrivateMainContext(
	store: Store,
	agents: Map<string, AgentConfig>,
	agent: string,
	event: import("@yonder/sdk").YEvent,
	projectAgentOperability?: (agentId: string) => Promise<AgentOperabilityFact>,
) {
	const data = event.data as { kind?: unknown; text?: unknown };
	if (!agents.has(agent) || event.type !== "message.in" || data.kind !== "dm" || !event.conv || !event.from)
		return undefined;
	if ((await store.identity().relation(agent, event.from)) !== "owner") return undefined;
	const route = event.routes?.find((item) => item.agent === agent && item.session && !item.dropped);
	if (!route?.session) return undefined;
	const session = await store.sessions.get(route.session);
	if (!session || session.agent !== agent || session.mode !== "main" || session.key !== "main") return undefined;

	let history: {
		status: "observed" | "unknown";
		limit: number;
		truncated: boolean;
		omitted: number;
		olderAvailable: boolean;
		items: Array<{ id: string; at: string; text?: string; textOmitted: boolean; textLength: number }>;
	} = { status: "unknown", limit: ownerHistoryLimit, truncated: false, omitted: 0, olderAvailable: false, items: [] };
	try {
		const page = await store.events.query({
			type: "message.in",
			conv: event.conv,
			from: event.from,
			before: event.id,
			order: "desc",
			limit: ownerHistoryScanLimit,
		});
		const verified = [];
		for (const source of page.events) {
			if ((source.data as { kind?: unknown }).kind !== "dm") continue;
			if ((await store.identity().relation(agent, source.from ?? "")) !== "owner") continue;
			if (!source.routes?.some((item) => item.agent === agent && item.session === session.id && !item.dropped))
				continue;
			verified.push(source);
		}
		const selected = verified.slice(0, ownerHistoryLimit - 1).reverse();
		selected.sort((left, right) => left.ts.localeCompare(right.ts) || left.id.localeCompare(right.id));
		const items = selected.map((source) => {
			const text = (source.data as { text?: unknown }).text;
			const original = typeof text === "string" ? text : "";
			const textOmitted = original.length > ownerHistoryTextLimit;
			return {
				id: source.id,
				at: source.ts,
				...(!textOmitted ? { text: original } : {}),
				textOmitted,
				textLength: original.length,
			};
		});
		history = {
			status: "observed",
			limit: ownerHistoryLimit,
			omitted: Math.max(0, verified.length - selected.length),
			olderAvailable: !!page.next,
			truncated:
				Math.max(0, verified.length - selected.length) > 0 ||
				(verified.length < ownerHistoryLimit - 1 && !!page.next) ||
				items.some((item) => item.textOmitted),
			items,
		};
	} catch {
		history = {
			status: "unknown",
			limit: ownerHistoryLimit,
			truncated: true,
			omitted: 0,
			olderAvailable: false,
			items: [],
		};
	}
	let operability: AgentOperabilityFact;
	try {
		operability = projectAgentOperability
			? await projectAgentOperability(agent)
			: { status: "unknown", limit: 20, truncated: false, reason: "shared projection unavailable", conversations: [] };
	} catch {
		operability = {
			status: "unknown",
			limit: 20,
			truncated: false,
			reason: "shared projection unavailable",
			conversations: [],
		};
	}
	return JSON.stringify({
		scope: "owner-private-main",
		identity: { ...agentIdentity(agent, agents.get(agent)?.name), profile: session.profile, session: session.id },
		origin: { eventId: event.id, conv: event.conv, from: event.from },
		authority:
			"History is continuity context only; it does not grant authorization beyond the verified current owner input.",
		historyContextOnly: true,
		groupContextMerged: false,
		expandsOwnerPermissions: false,
		history,
		operability,
	});
}

export function conversationPromptOptions(
	store: Store,
	agents: Map<string, AgentConfig>,
	runtime: () => Runtime,
	projectOperability?: (agentId: string, selector: OperabilitySelector) => Promise<SessionOperabilityFact>,
	projectAgentOperability?: (agentId: string) => Promise<AgentOperabilityFact>,
): Pick<PromptOptions, "offeredTools" | "deliveryPolicy" | "conversationContext"> {
	return {
		offeredTools: (session) =>
			runtime()
				.describeTools(session)
				.filter((tool) => tool.exposure === "offer")
				.map((tool) => tool.name),
		deliveryPolicy: (event, session) => {
			const route = event.routes?.find((route) => route.session === session);
			const binding = route?.binding
				? agents.get(route.agent)?.bindings.find((binding) => binding.id === route.binding)
				: undefined;
			return binding?.deliver
				? "final delivered to configured target"
				: binding?.reply === "none"
					? "reply=none; final text is not automatically posted; use an available send tool for public messages"
					: binding
						? "reply=auto; final text is automatically delivered to this input source"
						: "final returned to caller according to accepted input policy";
		},
		conversationContext: async (event, agent, signal) => {
			const self = agent ? agentIdentity(agent, agents.get(agent)?.name) : undefined;
			if (agent && (event.data as { kind?: unknown }).kind === "dm")
				return ownerPrivateMainContext(store, agents, agent, event, projectAgentOperability);
			if ((event.data as { kind?: string }).kind === "parent-request") {
				const sources = agent ? await parentOrigins(store, event, agent) : undefined;
				const originals = await Promise.all(
					(sources ?? []).map(async (source) => ({
						id: source.id,
						from: source.from,
						conv: source.conv,
						relation: agent && source.from ? await store.identity().relation(agent, source.from) : "stranger",
						text: (source.data as { text?: string }).text ?? "",
						at: source.ts,
						...Object.fromEntries(
							["mentions", "mentioned", "replyTo", "quote", "social"]
								.filter((key) => key in source.data)
								.map((key) => [key, (source.data as Record<string, unknown>)[key]]),
						),
					})),
				);
				const ownerSourceIds = new Set(
					originals.filter((original) => original.relation === "owner").map((source) => source.id),
				);
				const ownerSources = (sources ?? []).filter((source) => ownerSourceIds.has(source.id));
				const operabilityLimit = 8;
				const operability = await Promise.all(
					ownerSources.slice(0, operabilityLimit).map(async (source) => {
						const selector: OperabilitySelector = {
							eventId: source.id,
							...(source.conv ? { conv: source.conv } : {}),
						};
						if (!source.conv)
							return { status: "unknown" as const, selector, reason: "verified source conversation unavailable" };
						if (!projectOperability || !agent)
							return { status: "unknown" as const, selector, reason: "shared projection unavailable" };
						try {
							return await projectOperability(agent, selector);
						} catch {
							return { status: "unknown" as const, selector, reason: "shared projection unavailable" };
						}
					}),
				);
				return JSON.stringify({
					self,
					verified: !!sources,
					originals,
					...(ownerSources.length
						? {
								operability: {
									limit: operabilityLimit,
									truncated: ownerSources.length > operabilityLimit,
									omitted: Math.max(0, ownerSources.length - operabilityLimit),
									facts: operability,
								},
							}
						: {}),
				});
			}
			if (!event.conv) return undefined;
			const data = event.data as { social?: { room?: string } };
			// 群批次已经带着本群公开历史（含成功出站），内核不再重复一份 recentSent。
			const batch = event.type.endsWith(".batch-ready") || event.type.endsWith(".group-batch");
			const members = await conversationMembers(store, event.conv, agent, signal, { recentSent: !batch });
			let sourceFrame: Awaited<ReturnType<typeof batchSourceFrame>>;
			if (batch && agent) {
				const route = event.routes?.find((item) => item.agent === agent && item.session && !item.dropped);
				const session = route?.session ? await store.sessions.get(route.session) : undefined;
				if (session?.agent === agent) {
					try {
						sourceFrame = await batchSourceFrame(store, session, event);
					} catch {
						sourceFrame = undefined;
					}
				}
			}
			return JSON.stringify({
				...members,
				...(sourceFrame
					? { sourceFrame }
					: batch
						? {
								sourceFrame: {
									status: "unknown",
									reason: "batch source event frame is not verified",
								},
							}
						: {}),
				...(data.social?.room ? { room: data.social.room } : {}),
				self,
			});
		},
	};
}

export function kernelTools(
	options: Omit<Parameters<typeof createCoreTools>[0], "getPreset">,
	home: string,
	permissions: Parameters<typeof createPermissionsTool>[0],
	skills: Parameters<typeof createSkillTool>[0],
) {
	const tools = createCoreTools({ ...options, getPreset: options.sessions.getPreset });
	tools.push(
		...createConversationTools(options.store, home),
		createPermissionsTool(permissions),
		createSkillTool(skills, (id) => options.runtime().sessionConfig(id)),
	);
	tools.push(createSubagentTool(options.runtime, () => tools));
	return tools;
}

export function kernelPromptOptions(
	home: string,
	config: import("../config/index.js").YonderConfig,
	loaded: import("../plugins/index.js").LoadedPlugins,
	store: Store,
	agents: Map<string, AgentConfig>,
	runtime: () => Runtime,
	services: Pick<import("../plugins/index.js").KernelServices, "models">,
	skills: Pick<ReturnType<typeof import("./workspace.js").skillsFor>, "index" | "command">,
	version: string,
	projectOperability?: (agentId: string, selector: OperabilitySelector) => Promise<SessionOperabilityFact>,
	projectAgentOperability?: (agentId: string) => Promise<AgentOperabilityFact>,
): PromptOptions {
	return {
		...conversationPromptOptions(store, agents, runtime, projectOperability, projectAgentOperability),
		home,
		version,
		locale: config.locale ?? "zh-CN",
		timezone: config.timezone ?? "Asia/Shanghai",
		contexts: loaded.contexts,
		workspace: (session, signal) => filesFor(home, config, loaded, session.agent ?? "", signal),
		projectRules: (session, signal) =>
			projectRulesFor(home, config, loaded, session, signal, runtime().environment(session)),
		identity: store.identity(),
		models: services.models,
		setVersion: store.sessions.setVersion,
		skillIndex: skills.index,
		skillCommand: skills.command,
		toolIndex: (session) => toolDiscoveryGuide(runtime().describeTools(session)),
		templateDirs: (session) => pluginTemplateDirs(loaded.info ?? [], runtime().describeTools(session)),
	};
}
