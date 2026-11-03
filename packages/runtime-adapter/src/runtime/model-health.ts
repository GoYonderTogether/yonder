export interface ModelHealthRecord {
	until: number;
	probeAt: number;
	reason: string;
	failures: number;
	resetUntil?: number;
}
export interface ModelHealthStore {
	load(): Promise<unknown>;
	save(value: { version: 1; models: Record<string, ModelHealthRecord> }): Promise<void>;
}
type HealthFile = { version: 1; models: Record<string, ModelHealthRecord> };

/** Persisted model health policy. Storage is supplied by the host; ordering and failure rules stay shared. */
export class ModelHealth {
	private records = new Map<string, ModelHealthRecord>();
	private writing: Promise<void> = Promise.resolve();
	constructor(
		private readonly store?: ModelHealthStore,
		private readonly now: () => number = Date.now,
	) {}

	async load(): Promise<void> {
		const value = await this.store?.load();
		if (!value || typeof value !== "object") return;
		const parsed = value as Partial<HealthFile>;
		if (parsed.version !== 1 || typeof parsed.models !== "object" || !parsed.models) return;
		for (const [key, record] of Object.entries(parsed.models)) {
			if (
				!record ||
				typeof record.until !== "number" ||
				typeof record.probeAt !== "number" ||
				typeof record.failures !== "number" ||
				typeof record.reason !== "string"
			)
				continue;
			this.records.set(key, record);
		}
	}
	held(key: string): boolean {
		const record = this.records.get(key);
		return record !== undefined && record.until > this.now();
	}
	/** Stable partition: healthy entries keep their order, held entries follow in their own order. */
	order<T>(entries: readonly T[], key: (entry: T) => string): T[] {
		const healthy: T[] = [];
		const held: T[] = [];
		for (const entry of entries) (this.held(key(entry)) ? held : healthy).push(entry);
		return [...healthy, ...held];
	}
	async hold(
		keys: readonly string[],
		reason: string,
		seconds: number,
		probe: number,
		failures = 1,
		resetUntil?: number,
	): Promise<void> {
		if (seconds <= 0 || !keys.length) return;
		const at = this.now();
		for (const key of keys) {
			const prior = this.records.get(key);
			this.records.set(key, {
				until: at + seconds * 1000,
				probeAt: resetUntil ?? at + Math.max(1, probe) * 1000,
				...(resetUntil ? { resetUntil } : {}),
				reason,
				failures: (prior?.failures ?? 0) + failures,
			});
		}
		await this.persist();
	}
	async clear(keys: readonly string[]): Promise<void> {
		let changed = false;
		for (const key of keys) changed = this.records.delete(key) || changed;
		if (changed) await this.persist();
	}
	due(at = this.now()): string[] {
		return [...this.records.entries()]
			.filter(([, record]) => record.until > at && record.probeAt <= at)
			.map(([key]) => key);
	}
	async probed(keys: readonly string[], probe: number): Promise<void> {
		if (!keys.length) return;
		const at = this.now();
		for (const key of keys) {
			const record = this.records.get(key);
			if (!record) continue;
			this.records.set(key, { ...record, probeAt: at + Math.max(1, probe) * 1000 });
		}
		await this.persist();
	}
	snapshot(): Record<string, ModelHealthRecord> {
		return Object.fromEntries([...this.records.entries()].map(([key, value]) => [key, { ...value }]));
	}
	private persist(): Promise<void> {
		const payload: HealthFile = { version: 1, models: this.snapshot() };
		this.writing = this.writing.catch(() => {}).then(() => this.store?.save(payload));
		return this.writing;
	}
}
