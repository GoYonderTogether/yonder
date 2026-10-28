import type { HostStatus, Models, PluginAPI, ToolContext } from "@yonder/sdk";
import { shippedChannelsFor } from "../bundles.js";
import { gatewaySettings } from "../config/gateway.js";
import { type AgentConfig, resolveProfile, type YonderConfig } from "../config/index.js";
import type { LoadedPlugins } from "../plugins/index.js";

/** `provider/id`; a value without "/" has no model id, so it is never a known model. */
const splitModel = (model: string) => {
	const slash = model.indexOf("/");
	return slash < 0 ? { provider: model, id: "" } : { provider: model.slice(0, slash), id: model.slice(slash + 1) };
};
const authConfigured = async (models: Models, provider: string) =>
	!!(await Promise.resolve()
		.then(() => models.checkAuth(provider))
		.catch(() => undefined));

export async function hostStatus(
	home: string,
	config: YonderConfig,
	plugins: LoadedPlugins,
	models: Models,
	sessionModel: string,
	credentials: Array<{ provider: string; slot: string; configured: boolean }>,
): Promise<HostStatus> {
	const configured = plugins.info ?? [];
	const { provider, id } = splitModel(sessionModel);
	const gateway = await gatewaySettings(home);
	return {
		model: {
			...(config.defaultModel ? { default: config.defaultModel } : {}),
			session: sessionModel,
			known: !!id && !!models.getModel(provider, id),
			authConfigured: await authConfigured(models, provider),
		},
		channels: [...plugins.channels.keys()].map((instance) => ({
			instance,
			type: config.channels?.[instance]?.type ?? "",
			login: !!plugins.channels.get(instance)?.login,
		})),
		plugins: configured.map(({ id, use }) => ({ id, use })),
		shippedChannels: (await shippedChannelsFor(home, config)).map(({ type, plugin }) => ({ type, plugin })),
		gateway: { enabled: gateway.enabled, ...(gateway.port === undefined ? {} : { port: gateway.port }) },
		credentials: credentials.map(({ provider, slot, configured }) => ({ provider, slot, configured })),
	};
}

/** `api.host` for plugins: live host facts for an admin session (design §5.3 onboarding_probe). */
export function hostService(
	home: string,
	config: YonderConfig,
	deps: () => {
		runtime: {
			assertToolContext(ctx: ToolContext): void;
			sessionConfig(session: string): Promise<{ resolved: { capabilities: string[]; model: string } }>;
		};
		loaded: LoadedPlugins;
		agents: Map<string, AgentConfig>;
		services: { models: Models };
		manageCredentialSlots(home: string, action: "list"): Promise<unknown>;
	},
): PluginAPI["host"] {
	return {
		async status(ctx) {
			const { runtime, loaded, services, manageCredentialSlots } = deps();
			runtime.assertToolContext(ctx);
			const { resolved } = await runtime.sessionConfig(ctx.session);
			if (!resolved.capabilities.includes("admin")) throw new Error("Host status requires admin");
			const credentials = (await manageCredentialSlots(home, "list")) as HostStatus["credentials"];
			return hostStatus(home, config, loaded, services.models, resolved.model, credentials);
		},
		async modelReady(id) {
			const { agents, services } = deps();
			const agent = agents.get(id);
			const profile = agent?.profiles[agent.defaultProfile];
			if (!agent || !profile) return false;
			const { provider, id: model } = splitModel(
				resolveProfile(profile, agent.defaults, "local", config.defaultModel).model,
			);
			return !!model && (await authConfigured(services.models, provider));
		},
	};
}
