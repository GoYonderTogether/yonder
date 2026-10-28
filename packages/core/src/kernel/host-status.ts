import type { HostStatus, Models, PluginAPI, ToolContext } from "@yonder/sdk";
import { shippedChannelsFor } from "../bundles.js";
import { gatewaySettings } from "../config/gateway.js";
import type { YonderConfig } from "../config/index.js";
import type { LoadedPlugins } from "../plugins/index.js";

export async function hostStatus(
	home: string,
	config: YonderConfig,
	plugins: LoadedPlugins,
	models: Models,
	sessionModel: string,
	credentials: Array<{ provider: string; slot: string; configured: boolean }>,
): Promise<HostStatus> {
	const configured = plugins.info ?? [];
	const provider = sessionModel.slice(0, sessionModel.indexOf("/"));
	const gateway = await gatewaySettings(home);
	return {
		model: {
			...(config.defaultModel ? { default: config.defaultModel } : {}),
			session: sessionModel,
			known: !!models.getModel(provider, sessionModel.slice(provider.length + 1)),
			authConfigured: !!(await models.checkAuth(provider).catch(() => undefined)),
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
	};
}
