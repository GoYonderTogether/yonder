import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
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
