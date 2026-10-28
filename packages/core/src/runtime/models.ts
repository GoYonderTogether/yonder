import { access } from "node:fs/promises";
import { homedir } from "node:os";
import { resolve } from "node:path";

// Model merging derived from pi coding-agent 1.3.0, MIT; see THIRD_PARTY_NOTICES.md.
import {
	type AnyModel,
	type Api,
	type AssistantMessageEventStream,
	type AuthContext,
	type CredentialStore,
	createAssistantMessageEventStream,
	createModels,
	createProvider,
	envApiKeyAuth,
	isModelType,
	type Model,
	type Provider,
	type ProviderStreams,
} from "@earendil-works/pi-ai";
import { anthropicMessagesApi } from "@earendil-works/pi-ai/api/anthropic-messages.lazy";
import { azureOpenAIResponsesApi } from "@earendil-works/pi-ai/api/azure-openai-responses.lazy";
import { bedrockConverseStreamApi } from "@earendil-works/pi-ai/api/bedrock-converse-stream.lazy";
import { googleGenerativeAIApi } from "@earendil-works/pi-ai/api/google-generative-ai.lazy";
import { googleVertexApi } from "@earendil-works/pi-ai/api/google-vertex.lazy";
import { mistralConversationsApi } from "@earendil-works/pi-ai/api/mistral-conversations.lazy";
import { openAICodexResponsesApi } from "@earendil-works/pi-ai/api/openai-codex-responses.lazy";
import { openAICompletionsApi } from "@earendil-works/pi-ai/api/openai-completions.lazy";
import { openAIResponsesApi } from "@earendil-works/pi-ai/api/openai-responses.lazy";
import { piMessagesApi } from "@earendil-works/pi-ai/api/pi-messages.lazy";
import { builtinProviders } from "@earendil-works/pi-ai/providers/all";
import { Errors } from "typebox/value";
import { ProviderConfigSchema } from "./model-schema.js";

export type ModelsJsonModelOverride = Partial<Omit<Model<Api>, "cost">> & { cost?: Partial<Model<Api>["cost"]> };
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
const protocols: Record<string, () => ProviderStreams> = {
	"anthropic-messages": anthropicMessagesApi,
	"openai-completions": openAICompletionsApi,
	"openai-responses": openAIResponsesApi,
	"openai-codex-responses": openAICodexResponsesApi,
	"azure-openai-responses": azureOpenAIResponsesApi,
	"google-generative-ai": googleGenerativeAIApi,
	"google-vertex": googleVertexApi,
	"bedrock-converse-stream": bedrockConverseStreamApi,
	"mistral-conversations": mistralConversationsApi,
	"pi-messages": piMessagesApi,
};
function mergeCompat(
	base: Model<Api>["compat"],
	override: Model<Api>["compat"] | ModelsJsonModelOverride["compat"],
): Model<Api>["compat"] {
	if (!override) return base;
	const merged = { ...base, ...override } as NonNullable<Model<Api>["compat"]>;
	const baseNested = base as Record<string, unknown> | undefined;
	const overrideNested = override as Record<string, unknown>;
	const mergedNested = merged as Record<string, unknown>;
	for (const key of ["openRouterRouting", "vercelGatewayRouting", "chatTemplateKwargs", "chatTemplateArgs"] as const) {
		const baseValue = baseNested?.[key];
		const overrideValue = overrideNested[key];
		if (
			(typeof baseValue === "object" && baseValue !== null) ||
			(typeof overrideValue === "object" && overrideValue !== null)
		) {
			mergedNested[key] = { ...(baseValue as object | undefined), ...(overrideValue as object | undefined) };
		}
	}
	return merged;
}

function mergeInputLimits(
	base: Model<Api>["inputLimits"],
	override: ModelsJsonModelOverride["inputLimits"],
): Model<Api>["inputLimits"] {
	if (!override) return base;
	return {
		...base,
		...override,
		images: override.images
			? {
					...base?.images,
					...override.images,
					resize: override.images.resize
						? { ...base?.images?.resize, ...override.images.resize }
						: base?.images?.resize,
				}
			: base?.images,
	} as Model<Api>["inputLimits"];
}

function mergeSamplingParamsByThinkingLevel(
	base: Model<Api>["samplingParamsByThinkingLevel"],
	override: Model<Api>["samplingParamsByThinkingLevel"],
): Model<Api>["samplingParamsByThinkingLevel"] {
	if (!override) return base;
	const merged = { ...base };
	for (const level of ["off", "minimal", "low", "medium", "high", "xhigh", "max"] as const) {
		const params = override[level];
		if (params) merged[level] = { ...base?.[level], ...params };
	}
	return merged;
}

function applyModelOverride(model: Model<Api>, override: ModelsJsonModelOverride): Model<Api> {
	return {
		...model,
		name: override.name ?? model.name,
		reasoning: override.reasoning ?? model.reasoning,
		thinkingLevelMap: override.thinkingLevelMap
			? { ...model.thinkingLevelMap, ...override.thinkingLevelMap }
			: model.thinkingLevelMap,
		input: (override.input as ("text" | "image")[] | undefined) ?? model.input,
		inputLimits: mergeInputLimits(model.inputLimits, override.inputLimits),
		cost: override.cost
			? {
					input: override.cost.input ?? model.cost.input,
					output: override.cost.output ?? model.cost.output,
					cacheRead: override.cost.cacheRead ?? model.cost.cacheRead,
					cacheWrite: override.cost.cacheWrite ?? model.cost.cacheWrite,
					tiers: override.cost.tiers ?? model.cost.tiers,
				}
			: model.cost,
		promptCache: override.promptCache ? { ...model.promptCache, ...override.promptCache } : model.promptCache,
		contextWindow: override.contextWindow ?? model.contextWindow,
		maxTokens: override.maxTokens ?? model.maxTokens,
		samplingParams: override.samplingParams
			? { ...model.samplingParams, ...override.samplingParams }
			: model.samplingParams,
		samplingParamsByThinkingLevel: mergeSamplingParamsByThinkingLevel(
			model.samplingParamsByThinkingLevel,
			override.samplingParamsByThinkingLevel,
		),
		compat: mergeCompat(model.compat, override.compat),
	} as Model<Api>;
}

function modelFromJson(
	providerId: string,
	definition: ModelsJsonModel,
	providerConfig: ModelsJsonProvider,
	defaults: Model<Api> | undefined,
): Model<Api> {
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
		reasoning: definition.reasoning ?? false,
		thinkingLevelMap: definition.thinkingLevelMap,
		input: (definition.input ?? ["text"]) as ("text" | "image")[],
		inputLimits: definition.inputLimits,
		cost: definition.cost ?? { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		promptCache: definition.promptCache,
		contextWindow: definition.contextWindow ?? 128000,
		maxTokens: definition.maxTokens ?? 16384,
		samplingParams: definition.samplingParams,
		samplingParamsByThinkingLevel: definition.samplingParamsByThinkingLevel,
		compat: mergeCompat(providerConfig.compat, definition.compat),
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
) {
	const models = createModels({
		credentials,
		authContext: (provider) =>
			({
				...(credentialSlots[provider] && credentialSlots[provider] !== "default"
					? { credentialMode: "explicit" as const }
					: {}),
				env: async (name) => process.env[name],
				fileExists: async (path) => {
					try {
						await access(path.startsWith("~/") ? resolve(homedir(), path.slice(2)) : path);
						return true;
					} catch {
						return false;
					}
				},
			}) satisfies AuthContext,
	});
	for (const base of builtinProviders()) models.setProvider(base);
	for (const [id, raw] of Object.entries(configs)) {
		if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error(`Invalid provider ${id}`);
		const issues = Errors(ProviderConfigSchema, raw);
		if (issues.length)
			throw new Error(`Invalid provider ${id}: ${issues.map((e) => `${e.instancePath}: ${e.message}`).join("; ")}`);
		const config = raw as ModelsJsonProvider;
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
	if (timeouts.firstTokenMs || timeouts.totalMs)
		for (const provider of models.getProviders()) models.setProvider(withTimeouts(provider, timeouts));
	return models;
}
