import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

export interface ModelHealthRecord {
	/** End of the hold; a new run may start from this entry again. */
	until: number;
	/** Next background probe; only meaningful while the hold is active. */
	probeAt: number;
	reason: string;
	failures: number;
}
interface HealthFile {
	version: 1;
	models: Record<string, ModelHealthRecord>;
}
/**
 * Cross-run model health (07 §6.1). Held entries are not the starting model of a new run; a background probe
 * clears the hold as soon as the model answers again. State is small, local and never part of the transcript.
 */
export class ModelHealth {
	private records = new Map<string, ModelHealthRecord>();
	private writing: Promise<void> = Promise.resolve();
	constructor(
		private readonly path: string,
		private readonly now: () => number = Date.now,
	) {}

	async load(): Promise<void> {
		let text: string;
		try {
			text = await readFile(this.path, "utf8");
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
			throw error;
		}
		let parsed: HealthFile;
		try {
			parsed = JSON.parse(text);
		} catch {
			return;
		}
		if (parsed?.version !== 1 || typeof parsed.models !== "object" || !parsed.models) return;
		for (const [key, value] of Object.entries(parsed.models)) {
			if (
				!value ||
				typeof value.until !== "number" ||
				typeof value.probeAt !== "number" ||
				typeof value.failures !== "number" ||
				typeof value.reason !== "string"
			)
				continue;
			this.records.set(key, value);
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
	async hold(keys: readonly string[], reason: string, seconds: number, probe: number, failures = 1): Promise<void> {
		if (seconds <= 0 || !keys.length) return;
		const at = this.now();
		for (const key of keys) {
			const prior = this.records.get(key);
			this.records.set(key, {
				until: at + seconds * 1000,
				probeAt: at + Math.max(1, probe) * 1000,
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
	/** Held entries whose next probe is due. */
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
		this.writing = this.writing
			.catch(() => {})
			.then(async () => {
				await mkdir(dirname(this.path), { recursive: true });
				const temp = `${this.path}.${process.pid}.tmp`;
				await writeFile(temp, JSON.stringify(payload), { mode: 0o600 });
				await rename(temp, this.path);
			});
		return this.writing;
	}
}
