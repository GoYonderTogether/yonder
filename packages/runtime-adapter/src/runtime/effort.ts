import {
	type Api,
	clampThinkingLevel,
	getSupportedThinkingLevels,
	type Model,
	type ModelThinkingLevel,
} from "@earendil-works/pi-ai";
import { ModelThinkingLevelSchema } from "@earendil-works/pi-ai/providers/model-schema";
import type { YEvent } from "@yonder/sdk";
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

const ranks = ["off", "minimal", "low", "medium", "high", "xhigh", "max"];

/**
 * Effort requested by kernel-written delegations only: agent_ask messages on the internal agent channel and task_run
 * inputs. Channel and plugin events never carry authority for this field. Several inputs placed into one run resolve
 * to the highest valid request (a run never gets less than a caller asked for); invalid-only requests pass through so
 * the resolver can record the fallback.
 */
export function requestedEffort(events: YEvent[]): { requested: string; inputs: string[] } | undefined {
	const asked = events
		.filter(
			(event) =>
				(event.type === "message.in" &&
					event.conv?.startsWith("conv:agent:") &&
					event.from?.startsWith("acct:agent:")) ||
				(event.type === "session.input" &&
					event.from?.startsWith("agent:") &&
					(event.data as { taskOwned?: boolean }).taskOwned === true),
		)
		.flatMap((event) => {
			const effort = (event.data as { effort?: unknown }).effort;
			return typeof effort === "string" ? [{ id: event.id, effort }] : [];
		});
	if (!asked.length) return undefined;
	const valid = asked.filter((item) => ranks.includes(item.effort));
	const pick = (
		valid.length ? [...valid].sort((a, b) => ranks.indexOf(b.effort) - ranks.indexOf(a.effort)) : asked
	)[0]!;
	return { requested: pick.effort, inputs: asked.map((item) => item.id) };
}
