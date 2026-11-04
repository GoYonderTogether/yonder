// Model merging derived from pi coding-agent 1.3.0, MIT; see THIRD_PARTY_NOTICES.md.
import {
	type AnyModel,
	type Api,
	type AssistantMessageEventStream,
	type CredentialStore,
	createAssistantMessageEventStream,
	createModels,
	createProvider,
	envApiKeyAuth,
	isModelType,
	type Model,
	type Provider,
	type ProviderRequestOptions,
} from "@earendil-works/pi-ai";
import { Errors } from "typebox/value";
import { redactCredentials, withCredentialMark } from "./credential-failure.js";
import { applyModelOverride, type ModelsJsonModelOverride, mergeCompat } from "./model-overrides.js";
import { protocols } from "./model-protocols.js";
import { ProviderConfigSchema } from "./model-schema.js";

export type { ModelsJsonModelOverride } from "./model-overrides.js";
export type ModelsJsonModel = Partial<Model<Api>> & { id: string };
export interface ModelsJsonProvider {
	name?: string;
	baseUrl?: string;
	api?: Api;
	headers?: Record<string, string>;
	authHeader?: boolean;
	compat?: Model<Api>["compat"];
	models?: ModelsJsonModel[];
	modelOverrides?: Record<string, ModelsJsonModelOverride>;
}
type Compat = NonNullable<Model<Api>["compat"]> & { systemAsUser?: boolean };
/**
 * 已知供应商的请求整形默认值；provider 或 model 上显式写同一键时逐项覆盖（08 §2）。
 * SiliconFlow 拒绝 developer role；rightapi 的 glm 路由删掉开头的 system 消息，系统提示词到不了模型。
 */
const PROVIDER_COMPAT_DEFAULTS: Record<string, Compat> = {
	siliconflow: { supportsDeveloperRole: false },
	"rightapi-glm": { systemAsUser: true },
};

function modelFromJson(
	providerId: string,
	definition: ModelsJsonModel,
	providerConfig: ModelsJsonProvider,
	defaults: Model<Api> | undefined,
): Model<Api> {
	const siliconflowV32 = providerId === "siliconflow" && definition.id === "deepseek-ai/DeepSeek-V3.2";
	const api = definition.api ?? providerConfig.api ?? defaults?.api;
	if (!api) {
		throw new Error(
			`Provider ${providerId}, model ${definition.id}: no "api" specified. Set at provider or model level.`,
		);
	}
	const baseUrl = definition.baseUrl ?? providerConfig.baseUrl ?? defaults?.baseUrl;
	if (!baseUrl) throw new Error(`Provider ${providerId}: "baseUrl" is required when defining custom models.`);
	if (definition.contextWindow !== undefined && definition.contextWindow <= 0) {
		throw new Error(`Provider ${providerId}, model ${definition.id}: invalid contextWindow`);
	}
	if (definition.maxTokens !== undefined && definition.maxTokens <= 0) {
		throw new Error(`Provider ${providerId}, model ${definition.id}: invalid maxTokens`);
	}
	return {
		id: definition.id,
		name: definition.name ?? definition.id,
		api: api as Api,
		provider: providerId,
		baseUrl,
		reasoning: definition.reasoning ?? siliconflowV32,
		thinkingLevelMap: definition.thinkingLevelMap,
		input: (definition.input ?? ["text"]) as ("text" | "image")[],
		inputLimits: definition.inputLimits,
		cost: definition.cost ?? { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		promptCache: definition.promptCache,
		contextWindow: definition.contextWindow ?? 128000,
		maxTokens: definition.maxTokens ?? 16384,
		samplingParams: definition.samplingParams,
		samplingParamsByThinkingLevel: definition.samplingParamsByThinkingLevel,
		compat: mergeCompat(
			siliconflowV32
				? mergeCompat(
						{
							thinkingFormat: "qwen",
							supportsReasoningEffort: false,
							thinkingTokenBudgetField: "thinking_budget",
						},
						providerConfig.compat,
					)
				: providerConfig.compat,
			definition.compat,
		),
	} as Model<Api>;
}

function findModelDefaults(models: readonly AnyModel[], modelId: string, api?: Api): Model<Api> | undefined {
	const chatModels = models.filter((model) => isModelType(model, "chat"));
	return (
		chatModels.find((model) => model.id === modelId) ??
		(api ? chatModels.find((model) => model.api === api) : undefined) ??
		chatModels.find((model) => model.api === "openai-completions") ??
		chatModels[0]
	);
}

export interface ModelsTelemetry {
	/** Raw provider stream events, used to read the official quota the provider reports in a response. */
	onProviderEvent?(provider: string, data: unknown): void;
}
export interface ModelHost {
	providers?: readonly Provider[];
	env?(name: string): Promise<string | undefined>;
	fileExists?(path: string): Promise<boolean>;
	traceModel?(model: Model<Api>, apiKey?: string): void;
}

function requestCredentials(options?: Pick<ProviderRequestOptions, "apiKey" | "headers">): string[] {
	const sensitive = new Set([
		"authorization",
		"proxy-authorization",
		"x-api-key",
		"api-key",
		"cookie",
		"x-goog-api-key",
	]);
	return [
		options?.apiKey,
		...Object.entries(options?.headers ?? {})
			.filter(([name]) => sensitive.has(name.toLowerCase()))
			.map(([, value]) => value ?? undefined),
	].filter((value): value is string => typeof value === "string" && value.length > 0);
}

function safeProviderStream(
	stream: () => AssistantMessageEventStream,
	provider: string,
	options?: Pick<ProviderRequestOptions, "apiKey" | "headers">,
): AssistantMessageEventStream {
	const credentials = requestCredentials(options);
	try {
		return withCredentialMark(stream(), provider, credentials);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		const safe = redactCredentials(message, credentials);
		if (safe === message) throw error;
		const sanitized = new Error(safe);
		if (error instanceof Error) sanitized.name = error.name;
		throw sanitized;
	}
}
/**
 * Observe provider events without owning them: the caller's own callback still runs, and a failing
 * observer never breaks a request.
 */
function withTelemetry(provider: Provider, id: string, telemetry?: ModelsTelemetry): Provider {
	if (!telemetry?.onProviderEvent) return provider;
	const observe = telemetry.onProviderEvent;
	const wrap = <T extends { onProviderStreamEvent?: (data: unknown, model: Model<Api>) => void | Promise<void> }>(
		options: T | undefined,
	): T =>
		({
			...options,
			onProviderStreamEvent: (data: unknown, model: Model<Api>) => {
				try {
					observe(id, data);
				} catch {
					// Observation must never turn a working request into a failed one.
				}
				return options?.onProviderStreamEvent?.(data, model);
			},
		}) as T;
	return {
		...provider,
		stream: (model, context, options) => provider.stream(model, context, wrap(options)),
		streamSimple: (model, context, options) => provider.streamSimple(model, context, wrap(options)),
	};
}

/** Request guards from `yonder.yaml` `timeouts` (G1 §6.3). `0` or unset disables a guard. */
export interface ModelTimeouts {
	/** Abort a request that has produced no content (text, thinking or tool call) within this many ms. */
	firstTokenMs?: number;
	/** Abort a request that has not finished within this many ms, headers and every later stream chunk included. */
	totalMs?: number;
}
const CONTENT_EVENTS = new Set(["text_delta", "thinking_delta", "toolcall_start", "toolcall_delta"]);
/**
 * Fail a silent or stalled request instead of letting it hang until the SDK's 10-minute default. The stream is
 * aborted when no content arrives within `firstTokenMs` or the whole request outlives `totalMs`; the abort
 * surfaces as a retryable `error` (not `aborted`) so the chain retries or moves to the next model. A caller's own
 * abort still ends as `aborted`. Both timers are cleared on every exit path.
 */
export function requestGuard(
	start: (alive: () => void) => AssistantMessageEventStream,
	abort: () => void,
	{ firstTokenMs, totalMs }: ModelTimeouts,
) {
	const out = createAssistantMessageEventStream();
	let timedOut: string | undefined;
	const expire = (reason: string) => () => {
		timedOut ??= reason;
		abort();
	};
	const first = firstTokenMs ? setTimeout(expire(`no first token within ${firstTokenMs}ms`), firstTokenMs) : undefined;
	const total = totalMs ? setTimeout(expire(`exceeded ${totalMs}ms total`), totalMs) : undefined;
	// Raw provider events also count: a reasoning model may think silently for a long time while the
	// provider keeps streaming progress events, and that request is alive, not stuck.
	const stream = start(() => clearTimeout(first));
	void (async () => {
		try {
			for await (const event of stream) {
				if (CONTENT_EVENTS.has(event.type)) clearTimeout(first);
				if (timedOut && event.type === "error") {
					const error = {
						...event.error,
						stopReason: "error" as const,
						errorMessage: `Request timed out: ${timedOut}`,
					};
					out.push({ type: "error", reason: "error", error });
					continue;
				}
				out.push(event);
			}
			out.end();
		} catch (error) {
			out.end();
			throw error;
		} finally {
			clearTimeout(first);
			clearTimeout(total);
		}
	})();
	return out;
}
function withTimeouts(provider: Provider, timeouts: ModelTimeouts): Provider {
	if (!timeouts.firstTokenMs && !timeouts.totalMs) return provider;
	const guard = <T extends { signal?: AbortSignal } | undefined>(
		options: T,
		run: (options: T) => AssistantMessageEventStream,
	) => {
		const controller = new AbortController();
		const outer = options?.signal;
		const forward = () => controller.abort(outer?.reason);
		if (outer?.aborted) forward();
		else outer?.addEventListener("abort", forward, { once: true });
		const stream = requestGuard(
			(alive) =>
				run({
					...options,
					signal: controller.signal,
					onProviderStreamEvent: (data: unknown, model: Model<Api>) => {
						alive();
						return (
							options as { onProviderStreamEvent?: (data: unknown, model: Model<Api>) => unknown } | undefined
						)?.onProviderStreamEvent?.(data, model);
					},
				} as T),
			() => controller.abort(),
			timeouts,
		);
		// Completion, failure and cancel all end the stream; drop the caller-signal listener with it.
		void stream.result().finally(() => outer?.removeEventListener("abort", forward));
		return stream;
	};
	return {
		...provider,
		stream: (model, context, options) => guard(options, (o) => provider.stream(model, context, o)),
		streamSimple: (model, context, options) => guard(options, (o) => provider.streamSimple(model, context, o)),
	};
}

export function buildModels(
	credentials: CredentialStore,
	configs: Record<string, unknown> = {},
	credentialSlots: Readonly<Record<string, string>> = {},
	aliases: Readonly<Record<string, { provider: string; slot: string }>> = {},
	telemetry?: ModelsTelemetry,
	timeouts: ModelTimeouts = {},
	host: ModelHost = {},
) {
	const models = createModels({
		credentials,
		authContext: (provider) => ({
			...(credentialSlots[provider] && credentialSlots[provider] !== "default"
				? { credentialMode: "explicit" as const }
				: {}),
			env: host.env ?? (async () => undefined),
			fileExists: host.fileExists ?? (async () => false),
		}),
	});
	for (const base of host.providers ?? []) models.setProvider(base);
	for (const [id, raw] of Object.entries(configs)) {
		if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error(`Invalid provider ${id}`);
		const issues = Errors(ProviderConfigSchema, raw);
		if (issues.length)
			throw new Error(`Invalid provider ${id}: ${issues.map((e) => `${e.instancePath}: ${e.message}`).join("; ")}`);
		const input = raw as ModelsJsonProvider;
		const defaults = PROVIDER_COMPAT_DEFAULTS[id];
		const config = defaults ? { ...input, compat: mergeCompat(defaults, input.compat) } : input;
		const base = models.getProvider(id);
		const getModels = (): Model<Api>[] => {
			const values: Model<Api>[] = (base?.getModels() ?? []).map(
				(m) =>
					({ ...m, baseUrl: config.baseUrl ?? m.baseUrl, compat: mergeCompat(m.compat, config.compat) }) as Model<Api>,
			);
			for (const definition of config.models ?? []) {
				const value = modelFromJson(
					id,
					definition,
					config,
					findModelDefaults(values, definition.id, definition.api ?? config.api),
				);
				value.headers = { ...definition.headers };
				const index = values.findIndex((m) => m.id === value.id);
				if (index < 0) values.push(value);
				else values[index] = value;
			}
			return values.map((m) => {
				const override = config.modelOverrides?.[m.id];
				return override ? { ...applyModelOverride(m, override), headers: { ...m.headers, ...override.headers } } : m;
			});
		};
		const values = getModels();
		const api = Object.fromEntries(
			[...new Set(values.map((m) => m.api))]
				.map((name) => {
					const implementation = protocols[name];
					if (!implementation && !base?.getModels().some((m) => m.api === name))
						throw new Error(`Unsupported model protocol: ${name}`);
					return [name, implementation?.()];
				})
				.filter(([, value]) => value),
		);
		const auth = base?.auth ?? { apiKey: envApiKeyAuth(id, []) };
		const keyAuth = auth.apiKey,
			oauthAuth = auth.oauth;
		const provider: Provider = base ? { ...base, getModels } : createProvider({ id, models: values, api, auth });
		const mergedAuth = (result: import("@earendil-works/pi-ai").ModelAuth) => {
			if (config.authHeader && !result.apiKey) throw new Error(`Provider ${id}: authHeader requires API key`);
			return {
				...result,
				headers: {
					...result.headers,
					...config.headers,
					...(config.authHeader ? { Authorization: `Bearer ${result.apiKey}` } : {}),
				},
			};
		};
		models.setProvider({
			...provider,
			...(config.name ? { name: config.name } : {}),
			...(config.baseUrl ? { baseUrl: config.baseUrl } : {}),
			getModels,
			getAllModels: () => [...getModels(), ...(base?.getAllModels?.().filter((m) => !isModelType(m, "chat")) ?? [])],
			auth: {
				...(keyAuth
					? {
							apiKey: {
								...keyAuth,
								resolve: async (input) => {
									const result = await keyAuth?.resolve(input);
									return result ? { ...result, auth: mergedAuth(result.auth) } : undefined;
								},
							},
						}
					: {}),
				...(oauthAuth
					? { oauth: { ...oauthAuth, toAuth: async (credential) => mergedAuth(await oauthAuth.toAuth(credential)) } }
					: {}),
			},
			stream: (model, context, options) =>
				base?.getModels().some((m) => m.api === model.api)
					? base.stream(model, context, options)
					: api[model.api].stream(model, context, options),
			streamSimple: (model, context, options) =>
				base?.getModels().some((m) => m.api === model.api)
					? base.streamSimple(model, context, options)
					: api[model.api].streamSimple(model, context, options),
		});
	}
	// Account fallback: a read-only alias of a real provider that resolves the same models through another
	// credential slot. Aliases exist only inside one run's chain (07 §6.2).
	for (const [alias, target] of Object.entries(aliases)) {
		const base = models.getProvider(target.provider);
		if (!base) throw new Error(`Unknown model provider for account fallback: ${target.provider}`);
		const aliasModels = base.getModels().map((model) => ({ ...model, provider: alias }) as Model<Api>);
		models.setProvider(
			withTelemetry(
				{
					...base,
					id: alias,
					name: `${base.name} · ${target.slot}`,
					getModels: () => aliasModels,
					getAllModels: () => [...aliasModels],
					// The adapter picks provider-specific request shaping by `model.provider`; an alias must keep the
					// real id there or OpenAI rejects the shared-subscription request (07 §6.2).
					stream: (model, context, options) =>
						base.stream({ ...model, provider: target.provider } as Model<Api>, context, options),
					streamSimple: (model, context, options) =>
						base.streamSimple({ ...model, provider: target.provider } as Model<Api>, context, options),
				},
				alias,
				telemetry,
			),
		);
	}
	if (telemetry?.onProviderEvent)
		for (const [id, slot] of Object.entries(credentialSlots)) {
			if (slot === "default") continue;
			const provider = models.getProvider(id);
			if (provider) models.setProvider(withTelemetry(provider, id, telemetry));
		}
	if (host.traceModel)
		for (const provider of models.getProviders()) {
			models.setProvider({
				...provider,
				stream: (model, context, options) => {
					host.traceModel?.(model, options?.apiKey);
					return provider.stream(model, context, options);
				},
				streamSimple: (model, context, options) => {
					host.traceModel?.(model, options?.apiKey);
					return provider.streamSimple(model, context, options);
				},
			});
		}
	if (timeouts.firstTokenMs || timeouts.totalMs)
		for (const provider of models.getProviders()) models.setProvider(withTimeouts(provider, timeouts));
	// Provider options are the first shared point where the actual resolved API key and auth headers are present.
	for (const { id } of models.getProviders()) {
		const provider = models.getProvider(id);
		if (!provider) continue;
		models.setProvider({
			...provider,
			stream: (model, context, options) =>
				safeProviderStream(() => provider.stream(model, context, options), model.provider, options),
			streamSimple: (model, context, options) =>
				safeProviderStream(() => provider.streamSimple(model, context, options), model.provider, options),
		});
	}
	// Auth resolution runs in `models.stream*`, above every provider wrapper, so credential errors are marked here.
	for (const name of ["stream", "streamSimple"] as const) {
		const original = models[name].bind(models);
		models[name] = ((model: Model<Api>, context: never, options: never) =>
			withCredentialMark(original(model, context, options), model.provider)) as typeof models.stream;
	}
	return models;
}
