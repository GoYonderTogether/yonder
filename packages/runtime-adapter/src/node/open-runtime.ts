import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createNodePhotonImages } from "@earendil-works/pi-durable/images/node";
import type { ExecutionEnv, Models } from "@yonder/sdk";
import type { RuntimeServices } from "../contracts.js";
import { Runtime as SharedRuntime } from "../runtime/index.js";
import type { RuntimeInternals } from "../runtime/instance.js";
import { fallbackAliases, parseAccountProvider } from "../runtime/model-chain.js";
import { ModelGate } from "../runtime/model-gate.js";
import { ModelWatch } from "../runtime/model-watch.js";
import { modelTimeouts } from "../runtime/recovery.js";
import { readAttachment } from "./runtime/attachments.js";
import { createBackground } from "./runtime/background.js";
import { refreshRuntimeCloudModels, wrapCloudCredentials } from "./runtime/cloud-models.js";
import { CredentialSlotStore } from "./runtime/credential-slots.js";
import { credentialPath } from "./runtime/credentials.js";
import { localEnvironment } from "./runtime/env.js";
import { ModelHealth } from "./runtime/model-health.js";
import { accountKey, ModelQuota } from "./runtime/model-quota.js";
import { buildModels } from "./runtime/models.js";
import { processTool } from "./runtime/process.js";
import { QuotaPoller, QuotaSource } from "./runtime/quota-source.js";
import { remoteEnvironment } from "./runtime/remote-env.js";
import { remoteFind, remoteGrep } from "./runtime/remote-search.js";
import { executeCommand, login, resolveService } from "./runtime/services.js";
import { cacheSdkResult, toolOutputWriter } from "./runtime/tool-output-cache.js";
import type { RuntimeOptions } from "./runtime-options.js";

export async function openNodeRuntime(options: RuntimeOptions): Promise<SharedRuntime> {
	let runtime: RuntimeInternals | undefined;
	const authPath = credentialPath(options.home, options.config.credentials);
	const credentialSlots = new CredentialSlotStore(authPath);
	const credentials = credentialSlots.defaults;
	const health = new ModelHealth(join(options.home, ".yonder", "model-health.json"));
	const quota = new ModelQuota(join(options.home, ".yonder", "model-quota.json"), Date.now, options.onReport);
	const gate = new ModelGate(health, quota);
	const models = buildModels(credentials, options.config.models?.providers);
	const watch = new ModelWatch({
		health,
		quota,
		gate,
		models: (selection) =>
			buildModels(
				wrapCloudCredentials(credentialSlots.bind(selection), new Map(runtime?.cloud.apiKeys)),
				{ ...options.config.models?.providers, ...runtime?.cloud.providers },
				selection,
			),
		...(options.onModelHealth ? { onHealth: options.onModelHealth } : {}),
		...(options.onReport ? { onReport: options.onReport } : {}),
	});
	const quotaPoller = new QuotaPoller(new QuotaSource(authPath), quota, 60_000, options.onReport);
	const services = {} as RuntimeServices;
	const env = (config: import("../types.js").RuntimeSessionConfig): ExecutionEnv => {
		if (config.resolved.env.startsWith("device:"))
			return remoteEnvironment(runtime!, config, config.resolved.env.slice(7));
		if (config.resolved.env === "local") {
			if (options.envs?.has("local")) return options.envs.get("local")!;
			if (options.localEnvironment === true) return localEnvironment(config.cwd);
			if (typeof options.localEnvironment === "function") return options.localEnvironment(config.cwd);
			throw new Error("Local execution environment was not provided by this host");
		}
		const found = options.envs?.get(config.resolved.env);
		if (!found) throw new Error(`Unknown execution environment: ${config.resolved.env}`);
		return found;
	};
	Object.assign(services, {
		credentials,
		credentialSlots,
		health,
		quota,
		gate,
		watch,
		quotaPoller,
		models,
		modelsFor: (config: import("../types.js").RuntimeSessionConfig): Promise<Models> => {
			if (!runtime) throw new Error("Runtime host is not attached");
			let pending = runtime.boundModels.get(config);
			if (!pending) {
				pending = (async () => {
					const selection = Object.freeze({ ...config.resolved.credentialSlots });
					const aliases = fallbackAliases(config.resolved.fallback, selection, config.resolved.model);
					config.credentialGenerations ??= await credentialSlots.capture(selection, aliases);
					const bound = wrapCloudCredentials(
						credentialSlots.bind(selection, config.credentialGenerations, aliases),
						new Map(runtime!.cloud.apiKeys),
					);
					const value = buildModels(
						bound,
						{ ...runtime!.options.config.models?.providers, ...runtime!.cloud.providers },
						selection,
						aliases,
						{
							onProviderEvent: (provider, data) => {
								const alias = parseAccountProvider(provider);
								const account = alias
									? accountKey(alias.provider, alias.slot)
									: accountKey(provider, selection[provider] ?? "default");
								quota.record(account, data);
							},
						},
						modelTimeouts(runtime!.options.config.timeouts),
					);
					for (const [provider, slot] of Object.entries(selection)) {
						if (!value.getProvider(provider)) throw new Error(`Unknown model provider: ${provider}`);
						if (slot !== "default") await bound.read(provider);
					}
					for (const alias of Object.keys(aliases)) await bound.read(alias);
					return value;
				})();
				runtime.boundModels.set(config, pending);
			}
			return pending;
		},
		environment: env,
		readAttachment: (uri: string) => readAttachment(uri),
		imageProcessor: (() => {
			let value: ReturnType<typeof createNodePhotonImages> | undefined;
			return async () => (value ??= createNodePhotonImages());
		})(),
		toolHost: {
			createBackground,
			processTool,
			cacheSdkResult,
			toolOutputWriter,
			fileURLToPath,
			remoteFind,
			remoteGrep,
		},
		executeCommand: (
			config: import("../types.js").RuntimeSessionConfig,
			request: { command: string | string[]; cwd?: string; signal?: AbortSignal },
		) => executeCommand(runtime!, config, request),
		resolveService: (capability: string) => resolveService(runtime!, capability),
		login: (provider: string, type: "api_key" | "oauth", interaction: Parameters<Models["login"]>[2]) =>
			login(runtime!, provider, type, interaction),
		refreshModels: async () => {
			if (!runtime) throw new Error("Runtime host is not attached");
			await refreshRuntimeCloudModels(runtime);
		},
		attachRuntime: (rt: RuntimeInternals) => {
			runtime = rt;
		},
	});
	return SharedRuntime.open({ ...options, services });
}
