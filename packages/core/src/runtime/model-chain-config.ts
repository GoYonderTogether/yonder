import type { ResolvedProfile } from "../config/index.js";
import { modelChainRefs } from "../tools/model-route.js";

/**
 * `models.chain` (M2) as an effective fallback chain. A profile that declares fallback models or accounts of its
 * own keeps them; otherwise the home-wide chain fills in, restricted to providers the home already configured
 * (S2), so a home without them keeps its single model instead of failing on an unknown model.
 */
export function chainFallback(
	profile: ResolvedProfile,
	models: { chain?: readonly string[]; providers?: Readonly<Record<string, unknown>> } | undefined,
): ResolvedProfile["fallback"] {
	const fallback = profile.fallback;
	if (fallback?.models?.length || Object.keys(fallback?.accounts ?? {}).length) return fallback;
	const refs = modelChainRefs(models?.chain ?? [], models?.providers, profile.model);
	return refs.length ? { ...fallback, models: refs } : fallback;
}
