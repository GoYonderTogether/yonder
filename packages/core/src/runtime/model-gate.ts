import { type ChainEntry, chainKey } from "./model-chain.js";
import type { ModelHealth } from "./model-health.js";
import { accountKey, type ModelQuota } from "./model-quota.js";

/** Per-slot quota ceiling; an account at or above it is not chosen while its window lasts. */
export type QuotaStops = Readonly<Record<string, number>>;

/**
 * One place decides whether a chain entry may start a run: a failure hold (07 §6.1) or an exhausted
 * official quota window. Both only move the entry to the back of the chain, so the configured order and
 * the remaining entries are untouched.
 */
export class ModelGate {
	constructor(
		private readonly health: ModelHealth,
		private readonly quota: ModelQuota,
	) {}

	blocked(entry: ChainEntry, stops: QuotaStops | undefined): boolean {
		if (this.health.held(chainKey(entry))) return true;
		return this.quota.blocked(accountKey(entry.base, entry.slot), stops?.[entry.slot]);
	}
	order(chain: readonly ChainEntry[], stops: QuotaStops | undefined): ChainEntry[] {
		const open: ChainEntry[] = [];
		const blocked: ChainEntry[] = [];
		for (const entry of chain) (this.blocked(entry, stops) ? blocked : open).push(entry);
		return [...open, ...blocked];
	}
}
