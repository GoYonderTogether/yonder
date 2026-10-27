import { randomUUID } from "node:crypto";
import { readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { accountKey, type ModelQuota, type QuotaWindow } from "./model-quota.js";

/**
 * Codex CLI client id: only tokens minted for it may read the ChatGPT backend usage endpoint.
 * A credential at `<authPath>.slots/<provider>/<slot>.auth.json` may use either the pi OAuth shape
 * (`{ openai: { type: "oauth", access, refresh, expires, accountId? } }`) or a Codex `auth.json`
 * (`{ tokens: { access_token, refresh_token, account_id } }`) converted from an existing install.
 * A converted Codex credential may also sit beside the slot as `<slot>.codex.auth.json`; it is read for
 * quota only, so the model credential in `<slot>.auth.json` stays untouched.
 * Codex credentials are refreshed in place through the Codex refresh protocol; pi OAuth credentials are not.
 */
const USAGE_URL = "https://chatgpt.com/backend-api/wham/usage";
const TOKEN_URL = "https://auth.openai.com/oauth/token";
const CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";
const REFRESH_WINDOW_MS = 60_000;
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
interface Credential {
	access: string;
	accountId: string;
	/** Set for Codex credentials, which are refreshed in place; pi OAuth credentials stay untouched. */
	path: string | undefined;
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
 * Codex credentials — a slot file holding `tokens` or a sibling `<slot>.codex.auth.json` — are refreshed
 * in place when the access token is expired or within 60 seconds of expiry, and once more when the usage
 * endpoint answers 401. pi OAuth credentials are never refreshed here: an expired one reads as unavailable
 * until the owning client renews it, and no token, header or response body ever enters a report.
 */
export class QuotaSource {
	private readonly refreshes = new Map<string, Promise<Credential | undefined>>();
	constructor(
		private readonly authPath: string,
		private readonly now: () => number = Date.now,
	) {}

	async reading(provider: string, slot: string): Promise<QuotaReading | undefined> {
		let credential = await this.credential(provider, slot);
		if (!credential) return undefined;
		let response = await this.usage(credential);
		if (response.status === 401 && credential.path) {
			const refreshed = await this.refresh(credential.path, true);
			if (!refreshed) return undefined;
			credential = refreshed;
			response = await this.usage(credential);
		}
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
	private usage(credential: Credential): Promise<Response> {
		return fetch(USAGE_URL, {
			headers: {
				Authorization: `Bearer ${credential.access}`,
				"ChatGPT-Account-ID": credential.accountId,
				originator: "codex_cli_rs",
				Accept: "application/json",
				"User-Agent": "yonder-harness",
			},
		});
	}
	private async credential(provider: string, slot: string): Promise<Credential | undefined> {
		const directory = join(`${this.authPath}.slots`, provider);
		if (slot !== "default") {
			const converted = await this.codexCredential(join(directory, `${slot}.codex.auth.json`));
			if (converted) return converted;
		}
		const path = slot === "default" ? this.authPath : join(directory, `${slot}.auth.json`);
		const data = await this.read(path);
		if (!data) return undefined;
		const stored = data[provider] as PiOAuthCredential | undefined;
		if (stored?.type === "oauth" && typeof stored.access === "string") {
			if (this.expired(stored.expires, stored.access)) return undefined;
			const accountId = (typeof stored.accountId === "string" && stored.accountId) || tokenAccountId(stored.access);
			return accountId ? { access: stored.access, accountId, path: undefined } : undefined;
		}
		return this.codexFile(path, data);
	}
	private async codexCredential(path: string): Promise<Credential | undefined> {
		const data = await this.read(path);
		return data ? this.codexFile(path, data) : undefined;
	}
	private async codexFile(path: string, data: Record<string, unknown>): Promise<Credential | undefined> {
		const tokens = (data as CodexAuthFile).tokens;
		if (!tokens || typeof tokens.access_token !== "string" || typeof tokens.account_id !== "string") return undefined;
		if (!this.stale(tokens.access_token)) return { access: tokens.access_token, accountId: tokens.account_id, path };
		return this.refresh(path, false);
	}
	private async read(path: string): Promise<Record<string, unknown> | undefined> {
		let data: unknown;
		try {
			data = JSON.parse(await readFile(path, "utf8"));
		} catch {
			return undefined;
		}
		return data && typeof data === "object" ? (data as Record<string, unknown>) : undefined;
	}
	/** Joins the in-flight refresh for a path so concurrent readers rotate the token once. */
	private refresh(path: string, forced: boolean): Promise<Credential | undefined> {
		const pending = this.refreshes.get(path);
		if (pending) return pending;
		const task = this.performRefresh(path, forced).finally(() => {
			if (this.refreshes.get(path) === task) this.refreshes.delete(path);
		});
		this.refreshes.set(path, task);
		return task;
	}
	private async performRefresh(path: string, forced: boolean): Promise<Credential | undefined> {
		const data = await this.read(path);
		const tokens = (data as CodexAuthFile | undefined)?.tokens;
		if (!data || !tokens || typeof tokens.access_token !== "string" || typeof tokens.account_id !== "string")
			return undefined;
		if (!forced && !this.stale(tokens.access_token))
			return { access: tokens.access_token, accountId: tokens.account_id, path };
		if (!tokens.refresh_token) return undefined;
		const refreshed = await this.exchange(tokens.refresh_token);
		const access = refreshed?.access_token;
		if (typeof access !== "string" || access.length === 0) return undefined;
		const refreshedId = typeof refreshed?.id_token === "string" ? refreshed.id_token : undefined;
		const accountId = tokenAccountId(refreshedId) ?? tokenAccountId(access) ?? tokens.account_id;
		const updated: CodexTokens = {
			...tokens,
			access_token: access,
			account_id: accountId,
			...(typeof refreshed?.refresh_token === "string" ? { refresh_token: refreshed.refresh_token } : {}),
			...(refreshedId ? { id_token: refreshedId } : {}),
		};
		const saved = { ...data, tokens: updated, last_refresh: new Date(this.now()).toISOString() };
		if (!(await this.write(path, saved))) return undefined;
		return { access, accountId, path };
	}
	private async exchange(refreshToken: string): Promise<Record<string, unknown> | undefined> {
		let response: Response;
		try {
			response = await fetch(TOKEN_URL, {
				method: "POST",
				headers: { "Content-Type": "application/json", Accept: "application/json" },
				body: JSON.stringify({
					client_id: CLIENT_ID,
					grant_type: "refresh_token",
					refresh_token: refreshToken,
					scope: "openid profile email",
				}),
			});
		} catch {
			return undefined;
		}
		if (!response.ok) return undefined;
		try {
			const body: unknown = await response.json();
			return body && typeof body === "object" ? (body as Record<string, unknown>) : undefined;
		} catch {
			return undefined;
		}
	}
	private async write(path: string, data: Record<string, unknown>): Promise<boolean> {
		const temporary = join(dirname(path), `${randomUUID()}.tmp`);
		try {
			await writeFile(temporary, JSON.stringify(data), { mode: 0o600 });
			await rename(temporary, path);
			return true;
		} catch {
			await unlink(temporary).catch(() => undefined);
			return false;
		}
	}
	private stale(access: string): boolean {
		const at = expiresAt(access);
		return at !== undefined && at - this.now() <= REFRESH_WINDOW_MS;
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
