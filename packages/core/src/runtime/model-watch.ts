import { BACKGROUND_CONTEXT as C } from "@earendil-works/chord/context";
import type { EntryId } from "@earendil-works/pi-durable";
import type { SqliteStorage } from "@earendil-works/pi-durable/storage/sqlite";
import type { Models } from "@yonder/sdk";
import { cid } from "./docs.js";
import {
	type ChainEntry,
	chainKey,
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
	onHealth?(event: { key: string; state: "held" | "recovered"; reason?: string; until?: number }): void;
	onReport?(error: unknown): void;
}
/**
 * A failure that never reached the model: no answer and no provider status. Dropped sockets, refused connections,
 * DNS failures and request timeouts say nothing about a candidate's health, so they must not hold it — otherwise a
 * host that was asleep or offline keeps a healthy model out of the chain after the network returns (07 §6.1).
 */
export function transportFailure(error: string | undefined): boolean {
	const text = error ?? "";
	if (!text) return false;
	if (
		/\b(?:4\d\d|5\d\d)\b|quota|billing|insufficient|rate.?limit|too many requests|unauthoriz|forbidden|authentication|invalid.api.key|model.not.found|context|schema|abort|repeatStop/i.test(
			text,
		)
	)
		return false;
	return /ECONNREFUSED|ECONNRESET|ECONNABORTED|EPIPE|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|ENETUNREACH|EHOSTUNREACH|socket hang up|other side closed|fetch failed|terminated|network error|connection (?:error|reset|refused|closed|aborted)|timed? out|no first token|ended without|premature close/i.test(
		text,
	);
}
/** Reset headers and provider error body are interpreted only for 429 responses. */
export function rateLimitReset(error: string, now = Date.now()): number | undefined {
	if (!/\b429\b|rate.?limit|too many requests/i.test(error)) return undefined;
	const headers = error.match(/rate_limit_headers: (\{[^\n]+\})/i)?.[1];
	let values: Record<string, string> = {};
	try {
		if (headers) values = JSON.parse(headers);
	} catch {
		/* malformed provider response */
	}
	const retryMsValue = values["retry-after-ms"] ?? error.match(/"retry_after_ms"\s*:\s*"?([\d.]+)/i)?.[1];
	const retryMs = Number(retryMsValue);
	if (retryMsValue && Number.isFinite(retryMs) && retryMs > 0) return now + retryMs;
	const retry = values["retry-after"] ?? error.match(/"retry_after"\s*:\s*"?([\d.]+)/i)?.[1];
	if (retry) {
		const seconds = Number(retry);
		const at = Number.isFinite(seconds) ? now + seconds * 1000 : Date.parse(retry);
		if (at > now) return at;
	}
	const raw = values["x-ratelimit-reset"] ?? error.match(/"(?:reset_at|resets_at|resetAt)"\s*:\s*"?([\w:.-]+)/i)?.[1];
	if (!raw) return undefined;
	const n = Number(raw);
	const at = Number.isFinite(n) ? (n > 1e12 ? n : n > 1e9 ? n * 1000 : now + n * 1000) : Date.parse(raw);
	return at > now ? at : undefined;
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
	/** Record each failed candidate independently, using the model that pi actually attempted. */
	async record(config: RuntimeSessionConfig, run: RuntimeRun, attempts: readonly unknown[]): Promise<void> {
		const { health } = this.options;
		const fallback = config.resolved.fallback;
		const chain = modelChain(config.resolved.model, fallback, config.resolved.credentialSlots);
		const hold = holdSeconds(fallback);
		const probe = probeSeconds(fallback);
		this.holdWindow = hold;
		this.probeWindow = probe;
		for (const value of attempts) {
			const attempt = value as { model?: { provider?: string; modelId?: string }; action?: string; error?: string };
			if (
				attempt.action !== "fallback" &&
				!(
					attempt.action === "stop" &&
					(/fallback chain exhausted/i.test(attempt.error ?? "") || rateLimitReset(attempt.error ?? "") !== undefined)
				)
			)
				continue;
			const entry = chain.find(
				(item) => item.provider === attempt.model?.provider && item.modelId === attempt.model?.modelId,
			);
			if (!entry) continue;
			const key = chainKey(entry);
			const reason = attempt.error ?? "model_error";
			const resetUntil = rateLimitReset(reason);
			if (!resetUntil && transportFailure(reason)) continue;
			const previous = health.snapshot()[key];
			if (health.held(key) && (!resetUntil || (previous?.resetUntil ?? 0) >= resetUntil)) continue;
			if (hold <= 0 && !resetUntil) continue;
			const seconds = resetUntil
				? (resetUntil - Date.now()) / 1000
				: /\b(?:401|403|404)\b|unauthorized|forbidden|authentication|invalid.api.key|model.not.found|quota|billing|insufficient.(?:balance|credit)/i.test(
							reason,
						)
					? Math.max(hold, 86400)
					: hold;
			await health.hold([key], reason, seconds, probe, 1, resetUntil);
			this.options.onHealth?.({ key, state: "held", reason, until: Date.now() + seconds * 1000 });
		}
		if (run.status === "done" && run.model) {
			const matching = chain.filter((entry) => `${entry.base}/${entry.modelId}` === run.model);
			// An alias provider reports its base provider on success; do not clear a different account's hold.
			if (matching.length <= 1) await health.clear([refKey(run.model, config.resolved.credentialSlots)]);
		}
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
		let failure: string | undefined;
		let resetUntil: number | undefined;
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
					{
						maxTokens: 512,
						signal: controller.signal,
						onResponse: (response) => {
							if (response.status === 429)
								resetUntil = rateLimitReset(`429 rate_limit_headers: ${JSON.stringify(response.headers)}`);
						},
					},
				)
				.result();
			resetUntil ??= rateLimitReset(message.errorMessage ?? "");
			// A throttled model answered: it is reachable, so it is not broken (G1 F5).
			outcome =
				message.stopReason !== "error"
					? "ok"
					: /rate.?limit|too many requests|\b429\b|overloaded|quota/i.test(message.errorMessage ?? "")
						? "throttled"
						: "broken";
			failure = message.errorMessage ?? "";
		} catch (error) {
			outcome = "broken";
			failure = error instanceof Error ? error.message : String(error);
		} finally {
			clearTimeout(timer);
		}
		if (outcome === "ok") {
			await health.clear([key]);
			this.options.onHealth?.({ key, state: "recovered" });
			return;
		}
		if (outcome === "throttled") {
			if (resetUntil)
				await health.hold([key], "429", (resetUntil - Date.now()) / 1000, this.probeWindow, 1, resetUntil);
			else await health.probed([key], this.probeWindow);
			return;
		}
		// A host that is still offline is no evidence against the candidate: reschedule the probe, add no hold.
		if (transportFailure(failure)) {
			await health.probed([key], this.probeWindow);
			return;
		}
		// A failed probe extends the hold instead of only rescheduling the next probe (07 §6.1).
		const previous = health.snapshot()[key];
		if (previous && previous.until > Date.now() + this.holdWindow * 1000) await health.probed([key], this.probeWindow);
		else await health.hold([key], previous?.reason ?? "probe-failed", this.holdWindow, this.probeWindow);
	}
}

/** Read only attempts belonging to this receipt, stopping at the next run's user entry. */
export async function runAttempts(
	storage: SqliteStorage,
	session: string,
	placed: EntryId[],
	answer?: EntryId,
): Promise<unknown[]> {
	if (!placed.length) return [];
	const history = await storage.scanEntries(
		{
			conversationId: cid(session),
			minEntryId: Math.min(...placed) as EntryId,
			...(answer === undefined ? {} : { maxEntryId: answer }),
		},
		Number.MAX_SAFE_INTEGER,
		undefined,
		C,
	);
	const attempts: unknown[] = [];
	for (const entry of history.items) {
		if (entry.model?.some((message) => message.role === "user") && !placed.includes(entry.id)) break;
		if (entry.kind === "pi.model-attempt") attempts.push(entry.data);
	}
	return attempts;
}
