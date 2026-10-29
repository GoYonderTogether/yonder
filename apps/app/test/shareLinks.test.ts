import { describe, expect, it } from "vitest";
import {
	forgetToken,
	MAX_SHARE_LINKS_PER_TARGET,
	parseShareLinkRegistry,
	rememberToken,
	shareLinkKey,
	shareLinkUrl,
	shareLinkView,
	shortToken,
} from "../src/lib/shareLinks";

const NOW = Date.parse("2026-10-29T12:00:00.000Z");
const inDays = (days: number) => new Date(NOW + days * 86_400_000).toISOString();

const base = {
	token: "abcdefghijklmnop",
	usedCount: 3,
	maxUses: 50,
	expiresAt: inDays(7),
	revokedAt: null,
};

describe("shareLinkView", () => {
	it("renders an active link with usage, remaining days and a short token", () => {
		expect(shareLinkView(base, NOW)).toEqual({
			state: "active",
			stateText: "可用",
			daysLeft: 7,
			expiryText: "还剩 7 天",
			shortToken: "abcdef…",
			usageText: "3 / 50",
			usable: true,
		});
	});

	it("rounds partial days up and never reports 0 days while still valid", () => {
		const view = shareLinkView({ ...base, expiresAt: new Date(NOW + 3_600_000).toISOString() }, NOW);
		expect(view.daysLeft).toBe(1);
		expect(view.expiryText).toBe("还剩 1 天");
		expect(view.usable).toBe(true);
	});

	it("marks a used-up quota as exhausted", () => {
		const view = shareLinkView({ ...base, usedCount: 50 }, NOW);
		expect(view.state).toBe("share_exhausted");
		expect(view.stateText).toBe("名额已用完，请重新生成");
		expect(view.usable).toBe(false);
	});

	it("marks expired links, including links that expire exactly now", () => {
		for (const expiresAt of [inDays(-1), new Date(NOW).toISOString()])
			expect(shareLinkView({ ...base, expiresAt }, NOW)).toMatchObject({
				state: "share_expired",
				stateText: "已过期，请重新生成",
				daysLeft: 0,
				expiryText: "",
				usable: false,
			});
	});

	it("treats unparseable expiry times as expired instead of permanent", () => {
		expect(shareLinkView({ ...base, expiresAt: "not a date" }, NOW)).toMatchObject({
			state: "share_expired",
			usable: false,
		});
	});

	it("marks a revoked link even when it is still within its window", () => {
		const view = shareLinkView({ ...base, revokedAt: inDays(-1) }, NOW);
		expect(view.state).toBe("share_revoked");
		expect(view.stateText).toBe("已撤销，请重新生成");
		expect(view.usable).toBe(false);
	});

	it("lets revocation win over expiry and exhaustion", () => {
		const view = shareLinkView({ ...base, usedCount: 99, expiresAt: inDays(-2), revokedAt: inDays(-1) }, NOW);
		expect(view.state).toBe("share_revoked");
	});
});

describe("shortToken", () => {
	it("keeps short tokens intact and truncates long ones", () => {
		expect(shortToken("abc")).toBe("abc");
		expect(shortToken("abcdef")).toBe("abcdef");
		expect(shortToken("abcdefg")).toBe("abcdef…");
		expect(shortToken("  spaced-token  ")).toBe("spaced…");
	});
});

describe("shareLinkUrl", () => {
	const link = { token: "tok/en", url: "https://card.example/?share=tok%2Fen" };

	it("keeps the target path and appends the server token as ?share", () => {
		expect(shareLinkUrl(link, "/u/abc123", "https://card.example")).toBe(
			"https://card.example/u/abc123?share=tok%2Fen",
		);
		expect(shareLinkUrl(link, "/g/token", "https://card.example")).toBe("https://card.example/g/token?share=tok%2Fen");
	});

	it("falls back to the link token when the server url is missing or unparseable", () => {
		expect(shareLinkUrl({ token: "local" }, "/u/a", "https://card.example")).toBe(
			"https://card.example/u/a?share=local",
		);
		expect(shareLinkUrl({ token: "local", url: "http://[bad" }, "/u/a", "https://card.example")).toBe(
			"https://card.example/u/a?share=local",
		);
	});
});

describe("share link registry", () => {
	it("keys links by kind and target", () => {
		expect(shareLinkKey("card", "c1")).toBe("card:c1");
		expect(shareLinkKey("group", "g1")).toBe("group:g1");
	});

	it("parses stored registries defensively", () => {
		expect(parseShareLinkRegistry(null)).toEqual({});
		expect(parseShareLinkRegistry("")).toEqual({});
		expect(parseShareLinkRegistry("not json")).toEqual({});
		expect(parseShareLinkRegistry("[1,2]")).toEqual({});
		expect(parseShareLinkRegistry('{"card:c1":["a","a",3,null,""],"card:c2":"x","group:g1":[]}')).toEqual({
			"card:c1": ["a"],
		});
	});

	it("caps stored tokens per target", () => {
		const many = Array.from({ length: MAX_SHARE_LINKS_PER_TARGET + 3 }, (_, i) => `t${i}`);
		expect(parseShareLinkRegistry(JSON.stringify({ "card:c1": many }))["card:c1"]).toHaveLength(
			MAX_SHARE_LINKS_PER_TARGET,
		);
	});

	it("puts the newest token first, dedupes, and keeps a bounded history", () => {
		let registry = rememberToken({}, "card:c1", "a");
		registry = rememberToken(registry, "card:c1", "b");
		registry = rememberToken(registry, "card:c1", "a");
		expect(registry["card:c1"]).toEqual(["a", "b"]);
		registry = rememberToken(registry, "card:c1", "c", 2);
		expect(registry["card:c1"]).toEqual(["c", "a"]);
	});

	it("ignores blank tokens and leaves the input untouched", () => {
		const registry = { "card:c1": ["a"] };
		expect(rememberToken(registry, "card:c1", "   ")).toBe(registry);
	});

	it("forgets a token and drops empty targets", () => {
		const registry = { "card:c1": ["a", "b"] };
		expect(forgetToken(registry, "card:c1", "a")).toEqual({ "card:c1": ["b"] });
		expect(forgetToken({ "card:c1": ["b"] }, "card:c1", "b")).toEqual({});
		expect(forgetToken({}, "card:c1", "a")).toEqual({});
	});
});
