import { type Api, getSupportedThinkingLevels, type Model, type Models } from "@earendil-works/pi-ai";

/** Offline selection metadata. Unknown measurements stay null, never an invented zero. */
export interface ModelProfile {
	id: string;
	aliases: string[];
	catalog: {
		contextWindow: number | null;
		maxOutput: number | null;
		toolCall: boolean | null;
		input: string[];
		reasoning: { levels: string[] };
		deprecationDate: string | null;
		source: string;
		observedAt: string;
	};
	cost: {
		unit: "usd_per_mtok";
		input: number | null;
		output: number | null;
		cacheRead: number | null;
		cacheWrite: number | null;
		tiers: NonNullable<Model<Api>["cost"]["tiers"]>;
	};
	scores: {
		intelligence: { overall: number | null; byTask: Record<string, number>; source: string };
		preference: { byTask: Record<string, number>; source: string };
	};
	local: {
		samples: number;
		successRate: number | null;
		p50Ms: number | null;
		avgTokens: number | null;
		avgCost: number | null;
	};
	tags: string[];
	notes: string;
	pins: { prefer: string[]; avoid: string[] };
}

export function modelProfile(model: Pick<Model<Api>, "id" | "provider"> & Partial<Model<Api>>): ModelProfile {
	return {
		id: `${model.provider}/${model.id}`,
		aliases: [],
		catalog: {
			contextWindow: model.contextWindow ?? null,
			maxOutput: model.maxTokens ?? null,
			// pi's chat catalog does not declare tool-call support; do not infer it from a model name.
			toolCall: null,
			input: [...(model.input ?? [])],
			reasoning: { levels: model.reasoning === undefined ? [] : getSupportedThinkingLevels(model as Model<Api>) },
			deprecationDate: null,
			source: "configured/native catalog",
			observedAt: "",
		},
		cost: {
			unit: "usd_per_mtok",
			input: model.cost?.input ?? null,
			output: model.cost?.output ?? null,
			cacheRead: model.cost?.cacheRead ?? null,
			cacheWrite: model.cost?.cacheWrite ?? null,
			tiers: structuredClone(model.cost?.tiers ?? []),
		},
		scores: {
			intelligence: { overall: null, byTask: {}, source: "" },
			preference: { byTask: {}, source: "" },
		},
		local: { samples: 0, successRate: null, p50Ms: null, avgTokens: null, avgCost: null },
		tags: [],
		notes: "",
		pins: { prefer: [], avoid: [] },
	};
}

/** Reuse the same merged native + yonder.yaml provider catalog as `models list`. */
export async function modelProfiles(models: Models, signal?: AbortSignal): Promise<ModelProfile[]> {
	signal?.throwIfAborted();
	const available = await models.getAvailable(undefined, signal ? { signal } : undefined);
	signal?.throwIfAborted();
	return available.map(modelProfile);
}
