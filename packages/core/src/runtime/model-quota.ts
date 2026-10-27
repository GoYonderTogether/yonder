import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

/**
 * Official account quota, as reported by the provider inside a normal response (`rate_limits`).
 * The 5-hour window is what limits a shared ChatGPT subscription; once it is spent every request is
 * refused, so a chain must stop choosing that account before it gets there (07 §6.1).
 */
export interface QuotaWindow {
	/** Percent of the window already used, 0-100. */
	usedPercent: number;
	windowMinutes: number;
	/** When the window resets; a gate is lifted then without another request. */
	resetsAt: number;
	updatedAt: number;
}
interface QuotaFile {
	version: 1;
	accounts: Record<string, QuotaWindow>;
}
export const QUOTA_WINDOW_MINUTES = 300;

export function accountKey(provider: string, slot: string): string {
	return `${provider}@${slot}`;
}
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
/** Pick the rolling 5-hour window out of a provider payload; other windows (weekly) are ignored. */
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
/**
 * Last official quota per account. Written whenever a response carries it, so an account in active use is
 * always up to date; nothing here spends a request on its own.
 */
export class ModelQuota {
	private accounts = new Map<string, QuotaWindow>();
	private writing: Promise<void> = Promise.resolve();
	constructor(
		private readonly path: string,
		private readonly now: () => number = Date.now,
		private readonly report?: (error: unknown) => void,
	) {}

	async load(): Promise<void> {
		let text: string;
		try {
			text = await readFile(this.path, "utf8");
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
			throw error;
		}
		let parsed: QuotaFile;
		try {
			parsed = JSON.parse(text);
		} catch {
			return;
		}
		if (parsed?.version !== 1 || typeof parsed.accounts !== "object" || !parsed.accounts) return;
		for (const [account, window] of Object.entries(parsed.accounts))
			if (window && Number.isFinite(window.usedPercent)) this.accounts.set(account, window);
	}
	window(account: string): QuotaWindow | undefined {
		return this.accounts.get(account);
	}
	/** True while the account is past `stopPercent` and its window has not reset yet. */
	blocked(account: string, stopPercent: number | undefined, at = this.now()): boolean {
		if (stopPercent === undefined || stopPercent <= 0) return false;
		const window = this.accounts.get(account);
		if (!window || window.usedPercent < stopPercent) return false;
		return window.resetsAt > at;
	}
	record(account: string, data: unknown): void {
		const window = parseRateLimits(data, this.now());
		if (!window) return;
		const prior = this.accounts.get(account);
		if (prior && window.updatedAt < prior.updatedAt) return;
		this.accounts.set(account, window);
		void this.persist();
	}
	snapshot(): Record<string, QuotaWindow> {
		return Object.fromEntries([...this.accounts.entries()].map(([key, value]) => [key, { ...value }]));
	}
	private persist(): Promise<void> {
		const payload: QuotaFile = { version: 1, accounts: this.snapshot() };
		this.writing = this.writing
			.catch(() => {})
			.then(async () => {
				await mkdir(dirname(this.path), { recursive: true });
				const temp = `${this.path}.${process.pid}.tmp`;
				await writeFile(temp, JSON.stringify(payload), { mode: 0o600 });
				await rename(temp, this.path);
			})
			.catch((error) => this.report?.(error));
		return this.writing;
	}
}
