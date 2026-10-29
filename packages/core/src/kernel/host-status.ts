import type { HostStatus, Models, PluginAPI, ToolContext } from "@yonder/sdk";
import { shippedChannelsFor } from "../bundles.js";
import { gatewaySettings } from "../config/gateway.js";
import { type AgentConfig, resolveProfile, type YonderConfig } from "../config/index.js";
import type { LoadedPlugins } from "../plugins/index.js";
import { modelChainRefs } from "../tools/model-route.js";

/** `provider/id`; a value without "/" has no model id, so it is never a known model. */
const splitModel = (model: string) => {
	const slash = model.indexOf("/");
	return slash < 0 ? { provider: model, id: "" } : { provider: model.slice(0, slash), id: model.slice(slash + 1) };
};
const authConfigured = async (models: Models, provider: string) =>
	!!(await Promise.resolve()
		.then(() => models.checkAuth(provider))
		.catch(() => undefined));
/**
 * pi 的模型目录单价是 USD/百万 token，价格上限是元/百万 token（主人 23:40）。换算用固定参考汇率：
 * 宁可多报一个贵模型，也不放过一个超上限的。主 Agent 代批 10-29（docs/decisions.md）。
 */
const yuanPerUsd = 7.2;
const yuan = (usd: number) => Math.round(usd * yuanPerUsd * 100) / 100;

/**
 * Doctor 的兜底链检查（M1 改版、M2、Q1 作废）：链里出现 SiliconFlow 是错误（主人 10-28 23:40 明确不用），
 * 链上模型输入或输出单价超过 `models.priceCapPerMTokenYuan` 是告警。只查链上的模型，未配单价的模型不猜。
 */
export function modelChainIssues(config: YonderConfig, models: Models): { errors: string[]; warnings: string[] } {
	const chain = config.models?.chain ?? [];
	const cap = config.models?.priceCapPerMTokenYuan;
	const errors: string[] = [];
	const warnings: string[] = [];
	if (chain.some((entry) => entry === "siliconflow" || entry.startsWith("siliconflow/")))
		errors.push(
			"models.chain 里不能有 SiliconFlow：主人 10-28 23:40 明确不使用（成本太高），兜底链是 workbuddy → rightapi-glm/glm-5.3-flash。请从 yonder.yaml 的 models.chain 删掉 siliconflow 条目。",
		);
	if (cap === undefined) return { errors, warnings };
	for (const ref of modelChainRefs(chain, config.models?.providers, config.defaultModel)) {
		const { provider, id } = splitModel(ref);
		const cost = models.getModel(provider, id)?.cost;
		const input = cost?.input === null || cost?.input === undefined ? null : yuan(cost.input);
		const output = cost?.output === null || cost?.output === undefined ? null : yuan(cost.output);
		if ((input ?? 0) <= cap && (output ?? 0) <= cap) continue;
		warnings.push(
			`${ref}: 单价超过 models.priceCapPerMTokenYuan ${cap} 元/百万 token（输入 ${input === null ? "未知" : `${input} 元`}，输出 ${output === null ? "未知" : `${output} 元`}）；按量付费模型只接受输入、输出单价都不超过 ${cap} 元的。`,
		);
	}
	return { errors, warnings };
}
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
	},
): PluginAPI["host"] {
	return {
		async status(ctx) {
			const { runtime, loaded, services } = deps();
			// Lazy: index.ts imports this module.
			const { manageCredentialSlots } = await import("./index.js");
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
