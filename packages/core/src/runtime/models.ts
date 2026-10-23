// Model merging derived from pi coding-agent 1.3.0, MIT; see THIRD_PARTY_NOTICES.md.
import {
	type AnyModel,
	type Api,
	type CredentialStore,
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

export function buildModels(credentials: CredentialStore, configs: Record<string, unknown> = {}) {
	const models = createModels({ credentials });
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
	return models;
}
