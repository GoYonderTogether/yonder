import {
	type Api,
	clampThinkingLevel,
	getSupportedThinkingLevels,
	type Model,
	type ModelThinkingLevel,
} from "@earendil-works/pi-ai";
import { ModelThinkingLevelSchema } from "@earendil-works/pi-ai/providers/model-schema";
import { Check } from "typebox/value";

/** Internal resolution only. Callers must establish authority from trusted admission facts, never input text. */
export interface EffortResolution {
	requested?: string;
	effective: ModelThinkingLevel;
	fallbackReason?: "invalid-level" | "unsupported-level" | "unsupported-default";
}

/** Pure, per-input resolution. Does not configure a conversation or grant override authority. */
export function resolveEffort(
	model: Model<Api>,
	defaultLevel: ModelThinkingLevel,
	requested?: string,
	authorized = false,
): EffortResolution {
	// Check authority before validation: malformed requests must not bypass admission through fallback.
	if (requested !== undefined && !authorized) throw new Error("Effort override is not authorized");
	if (!getSupportedThinkingLevels(model).length) throw new Error("Model declares no supported effort level");
	const fallback = clampThinkingLevel(model, defaultLevel);
	if (requested === undefined)
		return { effective: fallback, ...(fallback !== defaultLevel ? { fallbackReason: "unsupported-default" } : {}) };
	if (!Check(ModelThinkingLevelSchema, requested))
		return { requested, effective: fallback, fallbackReason: "invalid-level" };
	const effective = clampThinkingLevel(model, requested as ModelThinkingLevel);
	return { requested, effective, ...(effective !== requested ? { fallbackReason: "unsupported-level" } : {}) };
}
