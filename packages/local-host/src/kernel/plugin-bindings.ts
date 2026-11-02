import type { DeliveryService } from "@yonder/bot-core/delivery/index";
import { createPluginBindings } from "@yonder/bot-core/kernel/plugin-bindings";
import { type AgentConfig, type Binding, resolveProfile, type YonderConfig } from "@yonder/local-host/config/index";
import { type ManagementState, manageObjects, type ObjectRequest } from "@yonder/local-host/kernel/management";
import { filesFor } from "@yonder/local-host/kernel/workspace";
import type { LoadedPlugins } from "@yonder/local-host/plugins/index";
import type { Runtime } from "@yonder/runtime-adapter/node";
import type { RuntimeSessionConfig } from "@yonder/runtime-adapter/types";
import type {
	AgentBindingRequest,
	AgentBindingRoute,
	Capability,
	ExecutionOwner,
	IdentityAPI,
	Preset,
	ToolContext,
} from "@yonder/sdk";

export { createPluginBindings } from "@yonder/bot-core/kernel/plugin-bindings";

/** Kernel wiring for the same config writer used by control-plane management. */
export function pluginAgentManagement(options: {
	home: string;
	config: YonderConfig;
	agents: Map<string, AgentConfig>;
	plugins: LoadedPlugins;
	presets: Map<string, Preset>;
	validate: ManagementState["validate"];
	scaffold: ManagementState["scaffold"];
	reload: () => Promise<void>;
	runtime: () => Runtime;
	resolve: (owner: ExecutionOwner) => Promise<RuntimeSessionConfig>;
	identity: IdentityAPI;
	delivery: DeliveryService;
	projectOperability?: ManagementState["projectOperability"];
}) {
	const { home, config, agents, plugins, runtime, resolve, identity, delivery } = options;
	const state: ManagementState = {
		config,
		agents,
		get presets() {
			return new Map([...plugins.presets, ...options.presets]);
		},
		files: (candidate, id) => filesFor(home, candidate, plugins, id),
		validate: options.validate,
		scaffold: options.scaffold,
		reload: options.reload,
		...(options.projectOperability ? { projectOperability: options.projectOperability } : {}),
	};
	let queue: Promise<unknown> = Promise.resolve();
	const manage = (request: ObjectRequest) => {
		const result = queue.then(() => manageObjects(home, request, state));
		queue = result.catch(() => {});
		return result;
	};
	const bindings = createPluginBindings({
		config: state.config,
		agents: state.agents,
		assert: (ctx) => runtime().assertToolContext(ctx),
		resolve,
		owner: async (agent, account) => (await identity.relation(agent, account)) === "owner",
		target: async (request, agent, config) => (await delivery.resolveTarget(request, agent, config)).target,
		hasSend: (config) =>
			runtime()
				.describeTools(config)
				.some((tool) => tool.name === "message_send" && ["offer", "search"].includes(tool.exposure)),
		update: (id, binding) =>
			manage({
				action: "agents.update",
				id,
				value: {
					bindings: [
						...state.agents.get(id)!.bindings.filter((item) => item.id !== "@console" && item.id !== binding.id),
						binding,
					],
				},
			}),
	});
	return { bindings, manage };
}
