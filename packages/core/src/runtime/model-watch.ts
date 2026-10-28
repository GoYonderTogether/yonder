import type { Models } from "@yonder/sdk";
import {
	type ChainEntry,
	chainKey,
	chainRef,
	DEFAULT_MODEL_HOLD_SECONDS,
	DEFAULT_MODEL_PROBE_SECONDS,
	holdSeconds,
	modelChain,
	probeSeconds,
	refKey,
} from "./model-chain.js";
import type { ModelGate, QuotaStops } from "./model-gate.js";
import type { ModelHealth } from "./model-health.js";
import type { ModelQuota } from "./model-quota.js";
import type { RuntimeRun, RuntimeSessionConfig } from "./types.js";

export interface ModelWatchOptions {
	health: ModelHealth;
	quota: ModelQuota;
	gate: ModelGate;
	/** A throwaway model collection bound to one credential selection, used only by the probe. */
	models(selection: Readonly<Record<string, string>>): Models;
	/** Index of the chain entry that produced a settled run, when the live run still reports it. */
	liveIndex(session: string): Promise<number | undefined>;
	onHealth?(event: { key: string; state: "held" | "recovered"; reason?: string; until?: number }): void;
	onReport?(error: unknown): void;
}
/**
 * Runtime side of model selection health: it orders a chain around failure holds and exhausted quota
 * windows, records the outcome of a run, and probes held entries in the background (07 §6.1).
 * Everything here is bookkeeping; the run itself stays in the runtime.
 */
export class ModelWatch {
	private timer: NodeJS.Timeout | undefined;
	private probing = false;
	/** Hold and probe window last used by `record`, so a failed probe extends the hold it was given (07 §6.1). */
	private holdWindow = DEFAULT_MODEL_HOLD_SECONDS;
	private probeWindow = DEFAULT_MODEL_PROBE_SECONDS;
	constructor(private readonly options: ModelWatchOptions) {}

	order(chain: readonly ChainEntry[], stops: QuotaStops | undefined): ChainEntry[] {
		return this.options.gate.order(chain, stops);
	}
	start(): void {
		this.timer ??= setInterval(() => void this.probe(), 15000);
		this.timer.unref?.();
	}
	stop(): void {
		if (this.timer) clearInterval(this.timer);
		this.timer = undefined;
	}
	/** Which chain entry answered this run: pi's index first, then the answered model. */
	async chainIndex(session: string, config: RuntimeSessionConfig, run: RuntimeRun): Promise<number> {
		const recorded = await this.options.liveIndex(session);
		if (typeof recorded === "number") return recorded;
		if (!run.model) return 0;
		const chain = modelChain(config.resolved.model, config.resolved.fallback, config.resolved.credentialSlots);
		const direct = chain.findIndex((entry) => chainRef(entry) === run.model);
		if (direct >= 0) return direct;
		try {
			return Math.max(
				0,
				chain.findIndex((entry) => chainKey(entry) === refKey(run.model!, config.resolved.credentialSlots)),
			);
		} catch {
			return 0;
		}
	}
	/**
	 * A run that finished on a later chain entry proves the earlier entries unusable; a run that failed the whole
	 * chain proves all of them.
	 */
	async record(config: RuntimeSessionConfig, run: RuntimeRun, index: number): Promise<void> {
		const { health } = this.options;
		const fallback = config.resolved.fallback;
		const chain = modelChain(config.resolved.model, fallback, config.resolved.credentialSlots);
		if (!chain.length) return;
		const keys = chain.map(chainKey);
		const hold = holdSeconds(fallback);
		const probe = probeSeconds(fallback);
		const failed = run.status === "error" && /^(model_error|no_model)\b/.test(run.reason ?? "");
		if (failed) {
			await health.hold(keys, run.reason ?? "model_error", hold, probe);
			for (const key of keys)
				this.options.onHealth?.({
					key,
					state: "held",
					reason: run.reason ?? "model_error",
					until: Date.now() + hold * 1000,
				});
			return;
		}
		if (index <= 0) {
			await health.clear([keys[0]!]);
			return;
		}
		// Only the first run that falls back judges the entries before it: re-holding an entry that is still held
		// would push its `until` forward on every run and never let it back into the chain (G1 F4).
		const unused = keys.slice(0, index).filter((key) => !health.held(key));
		if (!unused.length) return;
		this.holdWindow = hold;
		this.probeWindow = probe;
		await health.hold(unused, "fallback-used", hold, probe);
		for (const key of unused)
			this.options.onHealth?.({ key, state: "held", reason: "fallback-used", until: Date.now() + hold * 1000 });
	}
	/** Minimal request to a held entry: no tools, no transcript, no usage. Success ends the hold immediately. */
	private async probe(): Promise<void> {
		if (this.probing) return;
		this.probing = true;
		try {
			for (const key of this.options.health.due()) await this.probeOne(key);
		} catch (error) {
			this.options.onReport?.(error);
		} finally {
			this.probing = false;
		}
	}
	private async probeOne(key: string): Promise<void> {
		const { health } = this.options;
		const at = key.lastIndexOf("@");
		const rest = at > 0 ? key.slice(0, at) : "";
		const slash = rest.indexOf("/");
		if (at <= 0 || slash <= 0) {
			await health.clear([key]);
			return;
		}
		const provider = rest.slice(0, slash);
		const modelId = rest.slice(slash + 1);
		const selection = { [provider]: key.slice(at + 1) };
		let outcome: "ok" | "throttled" | "broken" = "broken";
		const controller = new AbortController();
		const timer = setTimeout(() => controller.abort(), 30000);
		try {
			const models = this.options.models(selection);
			const model = models.getModel(provider, modelId);
			if (!model) {
				await health.clear([key]);
				return;
			}
			const message = await models
				.streamSimple(
					model,
					{ messages: [{ role: "user", content: [{ type: "text", text: "ping" }], timestamp: Date.now() }] },
					// Reasoning models spend the budget thinking before any visible text: a tiny cap makes
					// every probe an empty completion, so a healthy key can never clear its hold. 07 §6.1.
					{ maxTokens: 512, signal: controller.signal },
				)
				.result();
			// A throttled model answered: it is reachable, so it is not broken (G1 F5).
			outcome =
				message.stopReason !== "error"
					? "ok"
					: /rate.?limit|too many requests|\b429\b|overloaded|quota/i.test(message.errorMessage ?? "")
						? "throttled"
						: "broken";
		} catch {
			outcome = "broken";
		} finally {
			clearTimeout(timer);
		}
		if (outcome === "ok") {
			await health.clear([key]);
			this.options.onHealth?.({ key, state: "recovered" });
			return;
		}
		if (outcome === "throttled") {
			await health.probed([key], this.probeWindow);
			return;
		}
		// A failed probe extends the hold instead of only rescheduling the next probe (07 §6.1).
		await health.hold([key], health.snapshot()[key]?.reason ?? "probe-failed", this.holdWindow, this.probeWindow);
	}
}
