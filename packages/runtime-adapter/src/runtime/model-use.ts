/** Only the two counters the owner's rule charges; any fuller usage record fits. */
export interface BilledTokens {
	input?: number;
	output?: number;
}

/**
 * Token quota for the platform model (docs/spec/16 §6, 2026-11-05 owner rules).
 *
 * What counts: the provider's billed input plus output. Cache hits never count, so the numbers are exactly the
 * `input` and `output` the installed openai-completions mapping reports — for DeepSeek that is
 * `prompt_cache_miss_tokens` plus `completion_tokens`, with `cacheRead`/`cacheWrite` ignored on purpose.
 *
 * Who decides the limit: the host. The runtime only asks before a request and charges after one, so a local Bot
 * that passes no port keeps working exactly as before.
 */
export interface ModelQuotaPort {
	/** Before a model call: the message the person must see when this subject may not call the model. */
	check(run: { session: string; run?: string }): Promise<string | undefined>;
	/** After a model call: charge the tokens it really consumed. */
	record(run: { session: string; run?: string }, tokens: { input: number; output: number }): Promise<void>;
}
export type ModelQuotaResolver = (session: string) => ModelQuotaPort | undefined;

const billed = (usage: BilledTokens | undefined) =>
	Math.max(0, Number(usage?.input) || 0) + Math.max(0, Number(usage?.output) || 0);

/**
 * Charges every generation attempt as it lands, then reconciles the rest when the run settles.
 *
 * Generation responses are the bulk of the spend, so they are charged one by one and a long run stops at the
 * exact request that crosses a limit. Everything else in the same run — compaction summaries above all — only
 * shows up in the settled usage, so settlement charges whatever is still outstanding. No token is charged twice
 * and none is dropped.
 */
export class ModelUse {
	private readonly charged = new Map<string, number>();
	private readonly settled = new Set<string>();
	constructor(private readonly resolve: ModelQuotaResolver | undefined) {}

	/** Resolves lazily: the host's ledger is per conversation, and a local host resolves nothing. */
	port(session: string): ModelQuotaPort | undefined {
		return this.resolve?.(session);
	}
	async check(session: string, run: string): Promise<string | undefined> {
		return this.port(session)?.check({ session, run });
	}
	/** One finished generation attempt. */
	async charge(session: string, run: string, usage: BilledTokens | undefined): Promise<void> {
		const port = this.port(session);
		const tokens = billed(usage);
		if (!port || tokens <= 0) return;
		this.charged.set(run, (this.charged.get(run) ?? 0) + tokens);
		await port.record(
			{ session, run },
			{ input: Math.max(0, usage?.input ?? 0), output: Math.max(0, usage?.output ?? 0) },
		);
	}
	/** The run's settled total, minus what its attempts already charged (compaction and similar). */
	async settle(session: string, run: string, usage: BilledTokens | undefined): Promise<void> {
		// Settlement is owed exactly once per run; a receipt replayed after a restart must not charge again.
		if (this.settled.has(run)) return;
		const total = billed(usage);
		const seen = this.charged.get(run) ?? 0;
		this.settled.add(run);
		this.charged.delete(run);
		const port = this.port(session);
		if (!port || total <= seen) return;
		await port.record({ session, run }, { input: total - seen, output: 0 });
	}
	/**
	 * A run that is already settled elsewhere (a replayed receipt, an abort before settlement): its per-attempt
	 * charges stay in the ledger, and settlement must not charge the same total again.
	 */
	forget(run: string): void {
		this.charged.delete(run);
		this.settled.add(run);
	}
}
