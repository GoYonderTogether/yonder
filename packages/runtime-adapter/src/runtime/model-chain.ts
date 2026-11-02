/**
 * Model fallback chain: primary model, then the same model on other credential slots, then other models.
 * Account entries use a read-only alias provider id `<provider>#<slot>`; the alias exists only inside one
 * run's chain and is never written to configuration (07 §6.1, §6.2).
 */
export interface FallbackChainConfig {
	models?: readonly string[];
	order?: "accounts-first" | "models-first";
	accounts?: Readonly<Record<string, readonly string[]>>;
	/** Per credential slot model substitution, e.g. a limited account runs the same role on a smaller model. */
	accountModels?: Readonly<Record<string, Readonly<Record<string, string>>>>;
	after?: number;
	hold?: number;
	probe?: number;
}
export interface ChainEntry {
	/** Provider as pi sees it: the real id, or the alias id for an account entry. */
	provider: string;
	modelId: string;
	/** Real provider id, the key for credentials and configuration. */
	base: string;
	slot: string;
	account: boolean;
}
export const DEFAULT_FALLBACK_AFTER = 3;
export const DEFAULT_MODEL_HOLD_SECONDS = 600;
export const DEFAULT_MODEL_PROBE_SECONDS = 60;
export const MIN_MODEL_PROBE_SECONDS = 15;

/** A configured provider's first model id; a bare `models.chain` entry means exactly this model. */
const firstModelId = (provider: unknown): string | undefined => {
	const models = (provider as { models?: unknown } | undefined)?.models;
	if (!Array.isArray(models)) return undefined;
	for (const entry of models) {
		const id = typeof entry === "string" ? entry : (entry as { id?: unknown } | undefined)?.id;
		if (typeof id === "string" && id.length) return id;
	}
	return undefined;
};

/**
 * `models.chain` (M2) as `provider/model` refs for the fallback chain. A bare provider means its first
 * configured model. Only configured providers take part (S2: a model can only come from a provider the home
 * already has), so a home without the chain's providers keeps its single model instead of failing on unknown
 * models. The primary model is dropped: the runtime already starts there.
 */
export function modelChainRefs(
	chain: readonly string[],
	providers: Readonly<Record<string, unknown>> | undefined,
	primary?: string,
): string[] {
	const refs: string[] = [];
	for (const entry of chain) {
		const slash = entry.indexOf("/");
		const provider = slash < 0 ? entry : entry.slice(0, slash);
		if (!providers || !(provider in providers)) continue;
		const modelId = slash < 0 ? firstModelId(providers[provider]) : entry.slice(slash + 1);
		if (!modelId) continue;
		const ref = `${provider}/${modelId}`;
		if (ref === primary || refs.includes(ref)) continue;
		refs.push(ref);
	}
	return refs;
}

export function splitModelRef(ref: string): { provider: string; modelId: string } {
	const at = ref.indexOf("/");
	if (at <= 0 || at === ref.length - 1) throw new Error(`Invalid model reference: ${ref}`);
	return { provider: ref.slice(0, at), modelId: ref.slice(at + 1) };
}
export function accountProvider(provider: string, slot: string): string {
	return `${provider}#${slot}`;
}
export function parseAccountProvider(provider: string): { provider: string; slot: string } | undefined {
	const at = provider.indexOf("#");
	if (at <= 0 || at === provider.length - 1) return undefined;
	return { provider: provider.slice(0, at), slot: provider.slice(at + 1) };
}
/** Selected slot for a real provider; `default` when nothing is selected. */
export function slotFor(selection: Readonly<Record<string, string>> | undefined, provider: string): string {
	return selection?.[provider] ?? "default";
}
/** Account aliases a run needs registered, keyed by alias provider id. */
export function fallbackAliases(
	fallback: FallbackChainConfig | undefined,
	selection: Readonly<Record<string, string>> = {},
	primary?: string,
): Record<string, { provider: string; slot: string }> {
	const aliases: Record<string, { provider: string; slot: string }> = {};
	if (!fallback?.accounts || !primary) return aliases;
	const { provider } = splitModelRef(primary);
	for (const slot of fallback.accounts[provider] ?? []) {
		if (slot === slotFor(selection, provider)) continue;
		aliases[accountProvider(provider, slot)] = { provider, slot };
	}
	return aliases;
}
/**
 * Expand configuration into the chain handed to pi. Duplicates collapse onto their first position so the
 * native failure count never burns twice on the same account and model.
 */
export function modelChain(
	model: string,
	fallback: FallbackChainConfig | undefined,
	selection: Readonly<Record<string, string>> = {},
): ChainEntry[] {
	const primary = splitModelRef(model);
	const substitute = (slot: string, provider: string, modelId: string): string => {
		const mapped = fallback?.accountModels?.[slot]?.[`${provider}/${modelId}`];
		if (!mapped) return modelId;
		const target = splitModelRef(mapped);
		// A substitution stays on the same provider: the entry already resolves that provider's credential slot.
		return target.provider === provider ? target.modelId : modelId;
	};
	const entries: ChainEntry[] = [
		{
			provider: primary.provider,
			modelId: substitute(slotFor(selection, primary.provider), primary.provider, primary.modelId),
			base: primary.provider,
			slot: slotFor(selection, primary.provider),
			account: false,
		},
	];
	const accountEntries: ChainEntry[] = [];
	for (const slot of fallback?.accounts?.[primary.provider] ?? []) {
		if (slot === entries[0]!.slot) continue;
		accountEntries.push({
			provider: accountProvider(primary.provider, slot),
			modelId: substitute(slot, primary.provider, primary.modelId),
			base: primary.provider,
			slot,
			account: true,
		});
	}
	const modelEntries: ChainEntry[] = [];
	for (const ref of fallback?.models ?? []) {
		if (ref === model) continue;
		const { provider, modelId } = splitModelRef(ref);
		const slot = slotFor(selection, provider);
		modelEntries.push({
			provider,
			modelId: substitute(slot, provider, modelId),
			base: provider,
			slot,
			account: false,
		});
	}
	if (fallback?.order === "accounts-first") entries.push(...accountEntries, ...modelEntries);
	else if (fallback?.order === "models-first") entries.push(...modelEntries, ...accountEntries);
	else entries.push(...modelEntries.slice(0, 1), ...accountEntries, ...modelEntries.slice(1));
	const seen = new Set<string>();
	return entries.filter((entry) => {
		const key = chainKey(entry);
		if (seen.has(key)) return false;
		seen.add(key);
		return true;
	});
}
/** Health key: model plus the account that would serve it. */
export function chainKey(entry: ChainEntry): string {
	return `${entry.base}/${entry.modelId}@${entry.slot}`;
}
export function refKey(ref: string, selection: Readonly<Record<string, string>> = {}): string {
	const { provider, modelId } = splitModelRef(ref);
	const alias = parseAccountProvider(provider);
	if (alias) return `${alias.provider}/${modelId}@${alias.slot}`;
	return `${provider}/${modelId}@${slotFor(selection, provider)}`;
}
export function chainRef(entry: ChainEntry): string {
	return `${entry.provider}/${entry.modelId}`;
}
export function holdSeconds(fallback: FallbackChainConfig | undefined): number {
	return fallback?.hold ?? DEFAULT_MODEL_HOLD_SECONDS;
}
export function probeSeconds(fallback: FallbackChainConfig | undefined): number {
	return Math.max(MIN_MODEL_PROBE_SECONDS, fallback?.probe ?? DEFAULT_MODEL_PROBE_SECONDS);
}

export type FallbackReason = "rate_limit" | "quota" | "unavailable" | "error";
/** The `model.fallback` reason (contracts §3.3) from the provider error that made the chain move on. */
export function fallbackReason(error: string | undefined): FallbackReason {
	const text = error ?? "";
	if (text.includes("upstream unavailable")) return "unavailable";
	if (/quota|insufficient.?(balance|credit)|billing|usage limit|exceeded your current/i.test(text)) return "quota";
	if (/rate.?limit|too many requests|\b429\b/i.test(text)) return "rate_limit";
	if (/\b5\d{2}\b|overloaded|unavailable|timed? out|timeout|no first token|ECONN|fetch failed|connection/i.test(text))
		return "unavailable";
	return "error";
}
