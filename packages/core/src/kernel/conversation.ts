import type { AgentConfig } from "../config/index.js";
import type { PromptOptions } from "../prompt/index.js";
import { toolDiscoveryGuide } from "../prompt/index.js";
import { pluginTemplateDirs } from "../prompt/templates.js";
import type { Runtime } from "../runtime/index.js";
import type { Store } from "../store/index.js";
import { conversationMembers, createConversationTools } from "../tools/conversation.js";
import { createCoreTools } from "../tools/index.js";
import { createPermissionsTool } from "../tools/permissions.js";
import { createSkillTool } from "../tools/skill-view.js";
import { createSubagentTool } from "./subagents.js";
import { filesFor, projectRulesFor } from "./workspace.js";

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
		conversationContext: async (event, agent, signal) =>
			event.conv ? JSON.stringify(await conversationMembers(store, event.conv, agent, signal)) : undefined,
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
): PromptOptions {
	return {
		...conversationPromptOptions(store, agents, runtime),
		home,
		version,
		locale: config.locale ?? "zh-CN",
		timezone: config.timezone ?? "Asia/Shanghai",
		contexts: loaded.contexts,
		workspace: (session, signal) => filesFor(home, config, loaded, session.agent ?? "", signal),
		projectRules: (session, signal) => projectRulesFor(home, config, loaded, session, signal),
		identity: store.identity(),
		models: services.models,
		setVersion: store.sessions.setVersion,
		skillIndex: skills.index,
		skillCommand: skills.command,
		toolIndex: (session) => toolDiscoveryGuide(runtime().describeTools(session)),
		templateDirs: (session) => pluginTemplateDirs(loaded.info ?? [], runtime().describeTools(session)),
	};
}
