import { createSubagentTool } from "@yonder/bot-core/kernel/subagents";
import type { PromptOptions } from "@yonder/bot-core/prompt/index";
import { toolDiscoveryGuide } from "@yonder/bot-core/prompt/index";
import { pluginTemplateDirs } from "@yonder/bot-core/prompt/templates";
import type { Store } from "@yonder/bot-core/store/contracts";
import { conversationMembers, createConversationTools } from "@yonder/bot-core/tools/conversation";
import { createCoreTools } from "@yonder/bot-core/tools/index";
import { parentOrigins } from "@yonder/bot-core/tools/parent-origin";
import { createPermissionsTool } from "@yonder/bot-core/tools/permissions";
import { createSkillTool } from "@yonder/bot-core/tools/skill-view";
import type { AgentConfig } from "@yonder/bot-definition";
import type { BotSource } from "@yonder/bot-definition/source";
import type { Runtime } from "@yonder/runtime-adapter";

export function conversationPromptOptions(
	store: Store,
	agents: Map<string, AgentConfig>,
	runtime: () => Runtime,
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
			const self = agent ? { agent, name: agents.get(agent)?.name } : undefined;
			if ((event.data as { kind?: string }).kind === "parent-request") {
				const sources = agent ? await parentOrigins(store, event, agent) : undefined;
				return JSON.stringify({
					self,
					verified: !!sources,
					originals: await Promise.all(
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
					),
				});
			}
			if (!event.conv) return undefined;
			const data = event.data as { social?: { room?: string } };
			// 群批次已经带着本群公开历史（含成功出站），内核不再重复一份 recentSent。
			const batch = event.type.endsWith(".batch-ready") || event.type.endsWith(".group-batch");
			const members = await conversationMembers(store, event.conv, agent, signal, { recentSent: !batch });
			return JSON.stringify({
				...members,
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
	config: import("@yonder/bot-definition").YonderConfig,
	loaded: import("@yonder/bot-core/plugins/index").LoadedPlugins,
	store: Store,
	agents: Map<string, AgentConfig>,
	runtime: () => Runtime,
	services: Pick<import("@yonder/bot-core/plugins/index").KernelServices, "models">,
	skills: Pick<ReturnType<typeof import("@yonder/bot-core/skills/index").createSkills>, "index" | "command">,
	version: string,
	source: BotSource,
	host: Pick<PromptOptions, "hostFacts" | "projectRules" | "cacheAttachment" | "templateSources">,
): PromptOptions {
	return {
		...conversationPromptOptions(store, agents, runtime),
		home,
		...(source ? { source } : {}),
		version,
		...host,
		locale: config.locale ?? "zh-CN",
		timezone: config.timezone ?? "Asia/Shanghai",
		contexts: loaded.contexts,
		workspace: (session, signal) => {
			const entry = config.agents?.find((item) => item.id === session.agent);
			if (!entry) throw new Error(`Unknown agent: ${session.agent}`);
			return source.workspace(entry, signal);
		},
		identity: store.identity(),
		models: services.models,
		setVersion: store.sessions.setVersion,
		skillIndex: skills.index,
		skillCommand: skills.command,
		toolIndex: (session) => toolDiscoveryGuide(runtime().describeTools(session)),
	};
}
