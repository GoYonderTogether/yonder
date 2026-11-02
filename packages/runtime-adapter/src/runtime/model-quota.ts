/** Official account quota, as reported by a provider or its usage endpoint. */
export interface QuotaWindow {
	usedPercent: number;
	windowMinutes: number;
	resetsAt: number;
	updatedAt: number;
}

export interface ModelQuotaStore {
	load(): Promise<unknown>;
	save(value: { version: 1; accounts: Record<string, QuotaWindow> }): Promise<void>;
}

interface QuotaFile {
	version: 1;
	accounts: Record<string, QuotaWindow>;
}

export const QUOTA_WINDOW_MINUTES = 300;
export const accountKey = (provider: string, slot: string) => `${provider}@${slot}`;

function finite(value: unknown): number | undefined {
	return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function resetAt(value: unknown, fallback: number): number {
	const seconds = finite(value);
	if (seconds !== undefined) return seconds > 1e12 ? seconds : seconds * 1000;
	if (typeof value === "string") {
		const parsed = Date.parse(value);
		if (!Number.isNaN(parsed)) return parsed;
	}
	return fallback;
}

/** Pick the rolling five-hour window out of a provider payload; other windows are ignored. */
export function parseRateLimits(data: unknown, now = Date.now()): QuotaWindow | undefined {
	let limits: unknown;
	const visit = (value: unknown, depth: number) => {
		if (limits !== undefined || depth > 4 || !value || typeof value !== "object") return;
		for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
			if (key === "rate_limits" && entry && typeof entry === "object") limits = entry;
			else visit(entry, depth + 1);
		}
	};
	visit(data, 0);
	if (!limits || typeof limits !== "object") return undefined;
	const windows = Object.values(limits as Record<string, unknown>)
		.filter((entry): entry is Record<string, unknown> => !!entry && typeof entry === "object")
		.map((entry) => ({
			usedPercent: finite(entry.used_percent ?? entry.usedPercent),
			windowMinutes: finite(entry.window_minutes ?? entry.windowMinutes),
			resetsAt: resetAt(entry.resets_at ?? entry.resetsAt, Number.NaN),
		}))
		.filter(
			(entry): entry is { usedPercent: number; windowMinutes: number; resetsAt: number } =>
				entry.usedPercent !== undefined,
		);
	if (!windows.length) return undefined;
	const pick = windows.reduce((best, entry) =>
		Math.abs((entry.windowMinutes ?? QUOTA_WINDOW_MINUTES) - QUOTA_WINDOW_MINUTES) <
		Math.abs((best.windowMinutes ?? QUOTA_WINDOW_MINUTES) - QUOTA_WINDOW_MINUTES)
			? entry
			: best,
	);
	const windowMinutes = pick.windowMinutes ?? QUOTA_WINDOW_MINUTES;
	return {
		usedPercent: Math.max(0, Math.min(100, pick.usedPercent)),
		windowMinutes,
		resetsAt: Number.isNaN(pick.resetsAt) ? now + windowMinutes * 60000 : pick.resetsAt,
		updatedAt: now,
	};
}

/** Quota policy shared by filesystem and PostgreSQL-backed hosts. */
export class ModelQuota {
	private accounts = new Map<string, QuotaWindow>();
	private writing: Promise<void> = Promise.resolve();
	constructor(
		private readonly store?: ModelQuotaStore,
		private readonly now: () => number = Date.now,
		private readonly report?: (error: unknown) => void,
	) {}

	async load(): Promise<void> {
		const value = await this.store?.load();
		if (!value || typeof value !== "object") return;
		const parsed = value as Partial<QuotaFile>;
		if (parsed.version !== 1 || typeof parsed.accounts !== "object" || !parsed.accounts) return;
		for (const [account, window] of Object.entries(parsed.accounts))
			if (window && Number.isFinite(window.usedPercent)) this.accounts.set(account, window);
	}
	window(account: string): QuotaWindow | undefined {
		const value = this.accounts.get(account);
		return value && { ...value };
	}
	blocked(account: string, stopPercent: number | undefined, at = this.now()): boolean {
		if (stopPercent === undefined || stopPercent <= 0) return false;
		const window = this.accounts.get(account);
		return !!window && window.usedPercent >= stopPercent && window.resetsAt > at;
	}
	record(account: string, data: unknown): void {
		const window = parseRateLimits(data, this.now());
		if (window) this.recordWindow(account, window);
	}
	recordWindow(account: string, window: QuotaWindow): void {
		const prior = this.accounts.get(account);
		if (prior && window.updatedAt < prior.updatedAt) return;
		this.accounts.set(account, { ...window });
		void this.persist();
	}
	async flush(): Promise<void> {
		await this.writing;
	}
	snapshot(): Record<string, QuotaWindow> {
		return Object.fromEntries([...this.accounts.entries()].map(([key, value]) => [key, { ...value }]));
	}
	private persist(): Promise<void> {
		const payload: QuotaFile = { version: 1, accounts: this.snapshot() };
		this.writing = this.writing
			.catch(() => {})
			.then(() => this.store?.save(payload))
			.catch((error) => this.report?.(error));
		return this.writing;
	}
}
