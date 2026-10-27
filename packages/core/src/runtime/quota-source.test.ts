import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { accountKey, ModelQuota } from "./model-quota.js";
import { QuotaPoller, QuotaSource } from "./quota-source.js";

const roots: string[] = [];
afterEach(() => {
	vi.unstubAllGlobals();
	for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});
function root() {
	const dir = mkdtempSync(join(tmpdir(), "yonder-quota-source-"));
	roots.push(dir);
	return dir;
}
const now = 1_800_000_000_000;
const FIVE_HOURS_MS = 5 * 60 * 60 * 1000;
function token(expires: number, accountId?: string): string {
	const payload: Record<string, unknown> = { exp: Math.floor(expires / 1000) };
	if (accountId) payload["https://api.openai.com/auth"] = { chatgpt_account_id: accountId };
	return `header.${Buffer.from(JSON.stringify(payload)).toString("base64url")}.signature`;
}
function slot(root: string, provider: string, name: string, credential: unknown) {
	const directory = join(`${root}.slots`, provider);
	mkdirSync(directory, { recursive: true, mode: 0o700 });
	writeFileSync(join(directory, `${name}.auth.json`), JSON.stringify(credential), { mode: 0o600 });
}
function usage(rateLimit: unknown) {
	return {
		plan_type: "plus",
		rate_limit: rateLimit,
	};
}
function respond(body: unknown, status = 200) {
	const fetch = vi.fn(async () => new Response(JSON.stringify(body), { status }));
	vi.stubGlobal("fetch", fetch);
	return fetch;
}
const USAGE_URL = "https://chatgpt.com/backend-api/wham/usage";
const TOKEN_URL = "https://auth.openai.com/oauth/token";
function codexSlot(auth: string, provider: string, name: string, credential: unknown, suffix = ".auth.json") {
	const directory = join(`${auth}.slots`, provider);
	mkdirSync(directory, { recursive: true, mode: 0o700 });
	const path = join(directory, `${name}${suffix}`);
	writeFileSync(path, JSON.stringify(credential), { mode: 0o600 });
	return path;
}

describe("quota source", () => {
	it("prefers the five hour window over the weekly one", async () => {
		const auth = join(root(), "auth.json");
		slot(auth, "openai", "gpt2", {
			openai: { type: "oauth", access: token(now + 3_600_000, "account"), expires: now + 3_600_000 },
		});
		respond(
			usage({
				primary_window: { used_percent: 62.5, limit_window_seconds: 18_000, reset_at: now / 1000 + 3600 },
				secondary_window: { used_percent: 91, limit_window_seconds: 604_800, reset_at: now / 1000 + 604_800 },
			}),
		);
		const reading = await new QuotaSource(auth, () => now).reading("openai", "gpt2");
		expect(reading).toMatchObject({ planType: "plus" });
		expect(reading?.window).toMatchObject({
			usedPercent: 62.5,
			windowMinutes: 300,
			resetsAt: now + 3_600_000,
		});
	});
	it("falls back to the weekly window when no five hour window is reported", async () => {
		const auth = join(root(), "auth.json");
		slot(auth, "openai", "gpt2", {
			openai: { type: "oauth", access: token(now + 3_600_000, "account"), expires: now + 3_600_000 },
		});
		respond(usage({ secondary_window: { used_percent: 44, limit_window_seconds: 604_800 } }));
		const window = (await new QuotaSource(auth, () => now).reading("openai", "gpt2"))?.window;
		expect(window).toMatchObject({ usedPercent: 44, windowMinutes: 10_080 });
		expect(window?.resetsAt).toBe(now + 604_800_000);
	});
	it("derives the reset from the window length when the response omits it", async () => {
		const auth = join(root(), "auth.json");
		slot(auth, "openai", "gpt2", {
			openai: { type: "oauth", access: token(now + 3_600_000, "account"), expires: now + 3_600_000 },
		});
		respond(usage({ primary_window: { used_percent: 7, limit_window_seconds: 18_000 } }));
		const window = (await new QuotaSource(auth, () => now).reading("openai", "gpt2"))?.window;
		expect(window).toMatchObject({ usedPercent: 7, windowMinutes: 300, resetsAt: now + FIVE_HOURS_MS });
	});
	it("reads a converted Codex auth file and skips missing or rejected credentials", async () => {
		const auth = root();
		const source = new QuotaSource(auth, () => now);
		const fetch = respond(usage({ primary_window: { used_percent: 20, limit_window_seconds: 18_000 } }));
		expect(await source.reading("openai", "gpt2")).toBeUndefined();
		expect(fetch).not.toHaveBeenCalled();
		slot(auth, "openai", "gpt2", {
			tokens: { access_token: token(now + 3_600_000), account_id: "account" },
		});
		expect((await source.reading("openai", "gpt2"))?.window?.usedPercent).toBe(20);
		expect(fetch).toHaveBeenCalledTimes(1);
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => new Response("{}", { status: 401 })),
		);
		expect(await source.reading("openai", "gpt2")).toBeUndefined();
	});
	it("prefers a converted Codex credential beside the model slot", async () => {
		const auth = join(root(), "auth.json");
		const model = token(now + 3_600_000, "pi-account");
		const converted = token(now + 3_600_000, "codex-account");
		slot(auth, "openai", "gpt2", { openai: { type: "oauth", access: model, expires: now + 3_600_000 } });
		writeFileSync(
			join(`${auth}.slots`, "openai", "gpt2.codex.auth.json"),
			JSON.stringify({ tokens: { access_token: converted, account_id: "codex-account" } }),
			{ mode: 0o600 },
		);
		const fetch = vi.fn(
			async (_input: string | URL | Request, _init?: RequestInit) =>
				new Response(JSON.stringify(usage({ primary_window: { used_percent: 13, limit_window_seconds: 18_000 } })), {
					status: 200,
				}),
		);
		vi.stubGlobal("fetch", fetch);
		const reading = await new QuotaSource(auth, () => now).reading("openai", "gpt2");
		expect(reading?.window?.usedPercent).toBe(13);
		const headers = fetch.mock.calls[0]?.[1]?.headers as Record<string, string>;
		expect(headers.Authorization).toContain(converted);
		expect(headers["ChatGPT-Account-ID"]).toBe("codex-account");
	});
	it("refreshes an expired Codex credential beside the model slot and persists the rotated tokens", async () => {
		const auth = join(root(), "auth.json");
		const expired = token(now - 1_000, "old-account");
		const fresh = token(now + 600_000, "new-account");
		const path = codexSlot(
			auth,
			"openai",
			"gpt2",
			{
				tokens: {
					access_token: expired,
					refresh_token: "old-refresh",
					id_token: "old-id",
					account_id: "old-account",
				},
				last_refresh: "2026-01-01T00:00:00.000Z",
				unknown: { keep: true },
			},
			".codex.auth.json",
		);
		const fetch = vi.fn(async (input: string | URL | Request, _init?: RequestInit) => {
			if (String(input) === TOKEN_URL)
				return new Response(
					JSON.stringify({
						access_token: fresh,
						refresh_token: "new-refresh",
						id_token: "new-id",
						expires_in: 600,
						token_type: "Bearer",
					}),
					{ status: 200 },
				);
			return new Response(
				JSON.stringify(usage({ primary_window: { used_percent: 27, limit_window_seconds: 18_000 } })),
				{
					status: 200,
				},
			);
		});
		vi.stubGlobal("fetch", fetch);
		const reading = await new QuotaSource(auth, () => now).reading("openai", "gpt2");
		expect(reading?.window?.usedPercent).toBe(27);
		const refresh = fetch.mock.calls.find((call) => String(call[0]) === TOKEN_URL);
		expect(refresh?.[1]?.method).toBe("POST");
		expect(JSON.parse(String(refresh?.[1]?.body))).toEqual({
			client_id: "app_EMoamEEZ73f0CkXaXp7hrann",
			grant_type: "refresh_token",
			refresh_token: "old-refresh",
			scope: "openid profile email",
		});
		const usageCalls = fetch.mock.calls.filter((call) => String(call[0]) === USAGE_URL);
		expect(usageCalls).toHaveLength(1);
		const headers = usageCalls[0]?.[1]?.headers as Record<string, string>;
		expect(headers.Authorization).toBe(`Bearer ${fresh}`);
		expect(headers["ChatGPT-Account-ID"]).toBe("new-account");
		const saved = JSON.parse(readFileSync(path, "utf8"));
		expect(saved.tokens).toEqual({
			access_token: fresh,
			refresh_token: "new-refresh",
			id_token: "new-id",
			account_id: "new-account",
		});
		expect(saved.last_refresh).toBe(new Date(now).toISOString());
		expect(saved.unknown).toEqual({ keep: true });
		expect(statSync(path).mode & 0o777).toBe(0o600);
	});
	it("forces one refresh and retries the usage request after a 401", async () => {
		const auth = join(root(), "auth.json");
		const valid = token(now + 600_000, "account");
		const fresh = token(now + 900_000, "account");
		codexSlot(
			auth,
			"openai",
			"gpt2",
			{ tokens: { access_token: valid, refresh_token: "refresh", account_id: "account" } },
			".codex.auth.json",
		);
		let usages = 0;
		const fetch = vi.fn(async (input: string | URL | Request, _init?: RequestInit) => {
			if (String(input) === TOKEN_URL)
				return new Response(JSON.stringify({ access_token: fresh, refresh_token: "rotated" }), { status: 200 });
			usages += 1;
			if (usages === 1) return new Response("{}", { status: 401 });
			return new Response(
				JSON.stringify(usage({ primary_window: { used_percent: 41, limit_window_seconds: 18_000 } })),
				{
					status: 200,
				},
			);
		});
		vi.stubGlobal("fetch", fetch);
		const reading = await new QuotaSource(auth, () => now).reading("openai", "gpt2");
		expect(reading?.window?.usedPercent).toBe(41);
		expect(usages).toBe(2);
		expect(fetch.mock.calls.filter((call) => String(call[0]) === TOKEN_URL)).toHaveLength(1);
		const usageCalls = fetch.mock.calls.filter((call) => String(call[0]) === USAGE_URL);
		const retryHeaders = usageCalls[1]?.[1]?.headers as Record<string, string>;
		expect(retryHeaders.Authorization).toBe(`Bearer ${fresh}`);
	});
	it("leaves the credential untouched and reads as unavailable when refresh fails", async () => {
		const auth = join(root(), "auth.json");
		const expired = token(now - 1_000, "account");
		const credential = {
			tokens: { access_token: expired, refresh_token: "refresh", account_id: "account" },
			last_refresh: "2026-01-01T00:00:00.000Z",
		};
		const path = codexSlot(auth, "openai", "gpt2", credential, ".codex.auth.json");
		const original = JSON.stringify(credential);
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => new Response("{}", { status: 500 })),
		);
		expect(await new QuotaSource(auth, () => now).reading("openai", "gpt2")).toBeUndefined();
		expect(readFileSync(path, "utf8")).toBe(original);
	});
	it("refreshes only once when concurrent readers race on the same credential file", async () => {
		const auth = join(root(), "auth.json");
		const fresh = token(now + 600_000, "account");
		codexSlot(auth, "openai", "gpt2", {
			tokens: { access_token: token(now - 1_000, "account"), refresh_token: "refresh", account_id: "account" },
		});
		let refreshes = 0;
		const fetch = vi.fn(async (input: string | URL | Request, _init?: RequestInit) => {
			if (String(input) === TOKEN_URL) {
				refreshes += 1;
				await new Promise<void>((resolve) => setTimeout(() => resolve(), 5));
				return new Response(JSON.stringify({ access_token: fresh, refresh_token: "rotated" }), { status: 200 });
			}
			return new Response(
				JSON.stringify(usage({ primary_window: { used_percent: 18, limit_window_seconds: 18_000 } })),
				{
					status: 200,
				},
			);
		});
		vi.stubGlobal("fetch", fetch);
		const source = new QuotaSource(auth, () => now);
		const readings = await Promise.all([source.reading("openai", "gpt2"), source.reading("openai", "gpt2")]);
		expect(readings.map((reading) => reading?.window?.usedPercent)).toEqual([18, 18]);
		expect(refreshes).toBe(1);
		const saved = JSON.parse(readFileSync(join(`${auth}.slots`, "openai", "gpt2.auth.json"), "utf8"));
		expect(saved.tokens.access_token).toBe(fresh);
	});
	it("records the reading under the shared provider@slot key", async () => {
		const auth = join(root(), "auth.json");
		slot(auth, "openai", "gpt2", {
			openai: { type: "oauth", access: token(now + 3_600_000, "account"), expires: now + 3_600_000 },
		});
		respond(usage({ primary_window: { used_percent: 55, limit_window_seconds: 18_000 } }));
		const quota = new ModelQuota(join(root(), "model-quota.json"), () => now);
		const poller = new QuotaPoller(new QuotaSource(auth, () => now), quota);
		poller.watch([{ provider: "openai", slot: "gpt2" }]);
		await poller.poll();
		expect(quota.window(accountKey("openai", "gpt2"))?.usedPercent).toBe(55);
		expect(quota.window("openai#gpt2")).toBeUndefined();
	});
});
