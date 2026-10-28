import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { type ChainEntry, chainKey } from "./model-chain.js";
import { ModelGate } from "./model-gate.js";
import { ModelHealth } from "./model-health.js";
import { accountKey, ModelQuota, parseRateLimits } from "./model-quota.js";

const roots: string[] = [];
afterEach(() => {
	for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});
function root() {
	const dir = mkdtempSync(join(tmpdir(), "yonder-quota-"));
	roots.push(dir);
	return dir;
}
const now = 1_800_000_000_000;

describe("official quota", () => {
	it("reads the five hour window and ignores the weekly one", () => {
		const window = parseRateLimits(
			{
				type: "response.completed",
				rate_limits: {
					primary: { used_percent: 62.5, window_minutes: 300, resets_at: 1_800_003_600 },
					secondary: { used_percent: 11, window_minutes: 10080, resets_at: 1_800_600_000 },
				},
			},
			now,
		);
		expect(window).toMatchObject({ usedPercent: 62.5, windowMinutes: 300, resetsAt: 1_800_003_600_000 });
	});
	it("accepts ISO reset times and nested payloads", () => {
		const window = parseRateLimits(
			{ data: { event: { rate_limits: { primary: { used_percent: 5, resets_at: "2027-01-15T12:00:00Z" } } } } },
			now,
		);
		expect(window?.resetsAt).toBe(Date.parse("2027-01-15T12:00:00Z"));
		expect(window?.windowMinutes).toBe(300);
	});
	it("ignores payloads without quota information", () => {
		expect(parseRateLimits({ type: "response.output_text.delta", delta: "hi" }, now)).toBeUndefined();
		expect(parseRateLimits(null, now)).toBeUndefined();
	});
	it("blocks an account at the ceiling and frees it after the reset", async () => {
		const path = join(root(), "model-quota.json");
		const quota = new ModelQuota(path, () => now);
		quota.record(accountKey("openai", "gpt2"), {
			rate_limits: { primary: { used_percent: 50, window_minutes: 300, resets_at: now / 1000 + 3600 } },
		});
		expect(quota.blocked(accountKey("openai", "gpt2"), 50)).toBe(true);
		expect(quota.blocked(accountKey("openai", "gpt2"), 51)).toBe(false);
		expect(quota.blocked(accountKey("openai", "gpt2"), undefined)).toBe(false);
		expect(quota.blocked(accountKey("openai", "gpt1"), 50)).toBe(false);
		const later = new ModelQuota(path, () => now + 3_600_000);
		await later.load();
		expect(later.blocked(accountKey("openai", "gpt2"), 50)).toBe(false);
	});
	it("keeps the newest reading", async () => {
		const path = join(root(), "model-quota.json");
		let clock = now;
		const quota = new ModelQuota(path, () => clock);
		quota.record(accountKey("openai", "gpt2"), { rate_limits: { primary: { used_percent: 10 } } });
		clock += 1000;
		quota.record(accountKey("openai", "gpt2"), { rate_limits: { primary: { used_percent: 70 } } });
		await quota.flush();
		const reopened = new ModelQuota(path, () => clock);
		await reopened.load();
		expect(reopened.window(accountKey("openai", "gpt2"))?.usedPercent).toBe(70);
	});
});

describe("model gate", () => {
	const entry = (slot: string, modelId: string): ChainEntry => ({
		provider: slot === "default" ? "openai" : `openai#${slot}`,
		modelId,
		base: "openai",
		slot,
		account: slot !== "default",
	});
	it("moves held and over-quota entries behind the open ones, keeping their order", async () => {
		const dir = root();
		const health = new ModelHealth(join(dir, "model-health.json"), () => now);
		const quota = new ModelQuota(join(dir, "model-quota.json"), () => now);
		await health.hold([chainKey(entry("default", "gpt-6.1-sol"))], "quota", 600, 60);
		quota.record(accountKey("openai", "gpt2"), {
			rate_limits: { primary: { used_percent: 80, window_minutes: 300, resets_at: now / 1000 + 3600 } },
		});
		const gate = new ModelGate(health, quota);
		const chain = [entry("default", "gpt-6.1-sol"), entry("gpt2", "gpt-6-luna"), entry("gpt3", "gpt-6-luna")];
		expect(gate.order(chain, { gpt2: 50 }).map((item) => item.slot)).toEqual(["gpt3", "default", "gpt2"]);
		expect(gate.order(chain, undefined).map((item) => item.slot)).toEqual(["gpt2", "gpt3", "default"]);
	});
});
