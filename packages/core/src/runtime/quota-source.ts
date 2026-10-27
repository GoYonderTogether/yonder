import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { accountKey, type ModelQuota, type QuotaWindow } from "./model-quota.js";

/**
 * Codex CLI client id: only tokens minted for it may read the ChatGPT backend usage endpoint.
 * A credential at `<authPath>.slots/<provider>/<slot>.auth.json` may use either the pi OAuth shape
 * (`{ openai: { type: "oauth", access, refresh, expires, accountId? } }`) or a Codex `auth.json`
 * (`{ tokens: { access_token, refresh_token, account_id } }`) converted from an existing install.
 */
const USAGE_URL = "https://chatgpt.com/backend-api/wham/usage";
const FIVE_HOURS = 5 * 60 * 60;
const SEVEN_DAYS = 7 * 24 * 60 * 60;
interface CodexTokens {
	access_token?: string;
	refresh_token?: string;
	account_id?: string;
	id_token?: string;
}
interface CodexAuthFile {
	tokens?: CodexTokens;
	last_refresh?: string;
}
interface PiOAuthCredential {
	type?: string;
	access?: string;
	refresh?: string;
	expires?: number;
	accountId?: string;
}
export interface QuotaReading {
	planType?: string | undefined;
	window?: QuotaWindow | undefined;
}
export interface QuotaAccount {
	provider: string;
	slot: string;
}
function finite(value: unknown): number | undefined {
	return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}
function claims(token: string | undefined): Record<string, unknown> | undefined {
	if (!token) return undefined;
	const payload = token.split(".")[1];
	if (!payload) return undefined;
	try {
		const value: unknown = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
		return value && typeof value === "object" ? (value as Record<string, unknown>) : undefined;
	} catch {
		return undefined;
	}
}
function claim(token: string | undefined, key: string): string | undefined {
	const info = claims(token);
	const auth = info?.["https://api.openai.com/auth"];
	const scoped = auth && typeof auth === "object" ? (auth as Record<string, unknown>)[key] : undefined;
	const value = scoped ?? info?.[key];
	return typeof value === "string" && value.length > 0 ? value : undefined;
}
function expiresAt(token: string | undefined): number | undefined {
	const value = claims(token)?.exp;
	return typeof value === "number" && Number.isFinite(value) ? value * 1000 : undefined;
}
function tokenAccountId(token: string | undefined): string | undefined {
	return claim(token, "chatgpt_account_id");
}
/** The window that actually limits an account: five hours when reported, otherwise the weekly one. */
function pickWindow(rateLimit: Record<string, unknown> | undefined, now: number): QuotaWindow | undefined {
	if (!rateLimit) return undefined;
	const windows = ["primary_window", "secondary_window"]
		.map((key) => rateLimit[key])
		.filter((value): value is Record<string, unknown> => !!value && typeof value === "object")
		.map((value) => ({
			usedPercent: finite(value.used_percent),
			seconds: finite(value.limit_window_seconds),
			resetsAt: finite(value.reset_at),
		}))
		.filter(
			(value): value is { usedPercent: number; seconds: number | undefined; resetsAt: number | undefined } =>
				value.usedPercent !== undefined && value.usedPercent >= 0,
		);
	const fiveHour = windows.find((value) => value.seconds !== undefined && Math.abs(value.seconds - FIVE_HOURS) < 60);
	const weekly = windows.find((value) => value.seconds !== undefined && Math.abs(value.seconds - SEVEN_DAYS) < 60);
	const picked = fiveHour ?? weekly ?? windows[0];
	if (!picked) return undefined;
	const seconds = picked.seconds ?? FIVE_HOURS;
	return {
		usedPercent: Math.max(0, Math.min(100, picked.usedPercent)),
		windowMinutes: Math.round(seconds / 60),
		resetsAt:
			picked.resetsAt === undefined
				? now + seconds * 1000
				: picked.resetsAt > 1e12
					? picked.resetsAt
					: picked.resetsAt * 1000,
		updatedAt: now,
	};
}
/**
 * Official quota for one account, read through the credential slot store the runtime already uses.
 * Tokens are never refreshed or copied here: an expired credential reads as unavailable until the owning
 * client renews it, and no token, header or response body ever enters a report.
 */
export class QuotaSource {
	constructor(
		private readonly authPath: string,
		private readonly now: () => number = Date.now,
	) {}

	async reading(provider: string, slot: string): Promise<QuotaReading | undefined> {
		const credential = await this.credential(provider, slot);
		if (!credential) return undefined;
		const response = await fetch(USAGE_URL, {
			headers: {
				Authorization: `Bearer ${credential.access}`,
				"ChatGPT-Account-ID": credential.accountId,
				originator: "codex_cli_rs",
				Accept: "application/json",
				"User-Agent": "yonder-harness",
			},
		});
		if (!response.ok) return undefined;
		const body: unknown = await response.json();
		if (!body || typeof body !== "object") return undefined;
		const payload = body as Record<string, unknown>;
		const rateLimit =
			payload.rate_limit && typeof payload.rate_limit === "object"
				? (payload.rate_limit as Record<string, unknown>)
				: undefined;
		return {
			planType: typeof payload.plan_type === "string" ? payload.plan_type : undefined,
			window: pickWindow(rateLimit, this.now()),
		};
	}
	private async credential(provider: string, slot: string): Promise<{ access: string; accountId: string } | undefined> {
		const path = slot === "default" ? this.authPath : join(`${this.authPath}.slots`, provider, `${slot}.auth.json`);
		let data: unknown;
		try {
			data = JSON.parse(await readFile(path, "utf8"));
		} catch {
			return undefined;
		}
		if (!data || typeof data !== "object") return undefined;
		const root = data as Record<string, unknown>;
		const stored = root[provider] as PiOAuthCredential | undefined;
		if (stored?.type === "oauth" && typeof stored.access === "string") {
			if (this.expired(stored.expires, stored.access)) return undefined;
			const accountId = (typeof stored.accountId === "string" && stored.accountId) || tokenAccountId(stored.access);
			return accountId ? { access: stored.access, accountId } : undefined;
		}
		const tokens = (root as CodexAuthFile).tokens;
		if (!tokens || typeof tokens.access_token !== "string" || typeof tokens.account_id !== "string") return undefined;
		if (this.expired(undefined, tokens.access_token)) return undefined;
		return { access: tokens.access_token, accountId: tokens.account_id };
	}
	private expired(expires: number | undefined, access: string): boolean {
		const at = finite(expires) ?? expiresAt(access);
		return at !== undefined && at <= this.now();
	}
}
/**
 * Keeps official quota fresh for accounts that have a configured stop line. One request per account per
 * interval; nothing runs until the runtime has seen such a configuration.
 */
export class QuotaPoller {
	private readonly targets = new Map<string, QuotaAccount>();
	private timer: NodeJS.Timeout | undefined;
	private polling = false;
	constructor(
		private readonly source: QuotaSource,
		private readonly quota: ModelQuota,
		private readonly intervalMs = 60_000,
		private readonly onReport?: (error: unknown) => void,
	) {}

	watch(accounts: Iterable<QuotaAccount>): void {
		for (const account of accounts) this.targets.set(accountKey(account.provider, account.slot), account);
	}
	start(): void {
		if (this.timer || this.targets.size === 0) return;
		this.timer = setInterval(() => void this.poll(), this.intervalMs);
		this.timer.unref();
		void this.poll();
	}
	stop(): void {
		if (this.timer) clearInterval(this.timer);
		this.timer = undefined;
	}
	async poll(): Promise<void> {
		if (this.polling) return;
		this.polling = true;
		try {
			for (const { provider, slot } of this.targets.values()) {
				try {
					const reading = await this.source.reading(provider, slot);
					if (reading?.window) this.quota.recordWindow(accountKey(provider, slot), reading.window);
				} catch (error) {
					this.onReport?.(error);
				}
			}
		} finally {
			this.polling = false;
		}
	}
}
