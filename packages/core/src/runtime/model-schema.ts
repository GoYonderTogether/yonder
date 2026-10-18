// Schema derived from pi coding-agent 1.3.0, MIT; see THIRD_PARTY_NOTICES.md.
import { ProviderCompatSchema } from "@earendil-works/pi-ai/providers/compat-schema";
import {
	ModelCostSchema,
	ModelInputLimitsSchema,
	ModelInputModalitySchema,
	ModelPromptCacheSchema,
	ThinkingLevelMapSchema,
} from "@earendil-works/pi-ai/providers/model-schema";
import { Type } from "typebox";

const SamplingParamsSchema = Type.Record(Type.String(), Type.Unknown());
const SamplingParamsByThinkingLevelSchema = Type.Object({
	off: Type.Optional(SamplingParamsSchema),
	minimal: Type.Optional(SamplingParamsSchema),
	low: Type.Optional(SamplingParamsSchema),
	medium: Type.Optional(SamplingParamsSchema),
	high: Type.Optional(SamplingParamsSchema),
	xhigh: Type.Optional(SamplingParamsSchema),
	max: Type.Optional(SamplingParamsSchema),
});

const PositiveTokenCountSchema = Type.Number({ exclusiveMinimum: 0 });

const ModelDefinitionSchema = Type.Object({
	id: Type.String({ minLength: 1 }),
	name: Type.Optional(Type.String({ minLength: 1 })),
	api: Type.Optional(Type.String({ minLength: 1 })),
	baseUrl: Type.Optional(Type.String({ minLength: 1 })),
	reasoning: Type.Optional(Type.Boolean()),
	thinkingLevelMap: Type.Optional(ThinkingLevelMapSchema),
	input: Type.Optional(Type.Array(ModelInputModalitySchema)),
	inputLimits: Type.Optional(ModelInputLimitsSchema),
	cost: Type.Optional(ModelCostSchema),
	promptCache: Type.Optional(ModelPromptCacheSchema),
	contextWindow: Type.Optional(PositiveTokenCountSchema),
	maxTokens: Type.Optional(PositiveTokenCountSchema),
	samplingParams: Type.Optional(SamplingParamsSchema),
	samplingParamsByThinkingLevel: Type.Optional(SamplingParamsByThinkingLevelSchema),
	headers: Type.Optional(Type.Record(Type.String(), Type.String())),
	compat: Type.Optional(ProviderCompatSchema),
});

const ModelOverrideSchema = Type.Object({
	name: Type.Optional(Type.String({ minLength: 1 })),
	reasoning: Type.Optional(Type.Boolean()),
	thinkingLevelMap: Type.Optional(ThinkingLevelMapSchema),
	input: Type.Optional(Type.Array(ModelInputModalitySchema)),
	inputLimits: Type.Optional(ModelInputLimitsSchema),
	cost: Type.Optional(Type.Partial(ModelCostSchema)),
	promptCache: Type.Optional(ModelPromptCacheSchema),
	contextWindow: Type.Optional(PositiveTokenCountSchema),
	maxTokens: Type.Optional(PositiveTokenCountSchema),
	samplingParams: Type.Optional(SamplingParamsSchema),
	samplingParamsByThinkingLevel: Type.Optional(SamplingParamsByThinkingLevelSchema),
	headers: Type.Optional(Type.Record(Type.String(), Type.String())),
	compat: Type.Optional(ProviderCompatSchema),
});

export const ProviderConfigSchema = Type.Object({
	name: Type.Optional(Type.String({ minLength: 1 })),
	baseUrl: Type.Optional(Type.String({ minLength: 1 })),
	api: Type.Optional(Type.String({ minLength: 1 })),
	headers: Type.Optional(Type.Record(Type.String(), Type.String())),
	compat: Type.Optional(ProviderCompatSchema),
	authHeader: Type.Optional(Type.Boolean()),
	models: Type.Optional(Type.Array(ModelDefinitionSchema)),
	modelOverrides: Type.Optional(Type.Record(Type.String(), ModelOverrideSchema)),
});
