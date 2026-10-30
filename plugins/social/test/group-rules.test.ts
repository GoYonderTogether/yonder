import type { SocialPolicy } from "@yonder/sdk";
import { expect, test } from "vitest";
import { GroupRules, type OwnRules, ruleMatch, validateRules } from "../src/group-rules.js";
import { groupFixture, mainConv } from "./group-fixture.js";

test("hard rules use normalized keywords, standard regex, literal exclusions and length bounds", () => {
	const policy: SocialPolicy = {
		keywords: ["café"],
		triggers: { regex: ["^(设计|界面).{0,20}$"], exclude: ["(广告).*"], minLength: 2, maxLength: 24 },
	};
	expect(ruleMatch("cafe\u0301", policy)).toEqual({ eligible: true, match: true });
	expect(ruleMatch("设计方案", policy)).toEqual({ eligible: true, match: true });
	expect(ruleMatch("界面 (广告).*", policy)).toEqual({ eligible: false, match: false });
	// Exclusions are literal words, not a second regex family.
	expect(ruleMatch("设计广告", policy)).toEqual({ eligible: true, match: true });
	expect(ruleMatch("设计图", { triggers: { regex: ["设计"], minLength: 3, maxLength: 3 } })).toEqual({
		eligible: true,
		match: true,
	});
	for (const text of ["", "   ", "设", "设计".repeat(13)])
		expect(ruleMatch(text, policy)).toEqual({ eligible: false, match: false });
	expect(ruleMatch("普通聊天", policy)).toEqual({ eligible: true, match: false });
	expect(ruleMatch("设计", {})).toEqual({ eligible: true, match: false });
	expect(ruleMatch(`${"a".repeat(2048)}设计`, { keywords: ["设计"] })).toEqual({ eligible: true, match: false });
});

test("pathological regex is skipped within a bounded execution window and later rules still run", () => {
	const pattern = "^(a+)+$";
	const text = `${"a".repeat(160)}!`;
	const errors: string[] = [];
	const started = performance.now();
	expect(ruleMatch(text, { triggers: { regex: [pattern, "!$"] } }, (value) => errors.push(value))).toEqual({
		eligible: true,
		match: true,
	});
	expect(performance.now() - started).toBeLessThan(200);
	expect(errors).toEqual([pattern]);
});

test("own trigger rules validate standard regex and reject policy changes outside their narrow fields", () => {
	expect(() =>
		validateRules({
			keywords: ["设计"],
			count: 20,
			triggers: { regex: ["^(设计|界面).{0,20}$"], exclude: ["(广告).*"], minLength: 1, maxLength: 2048 },
		}),
	).not.toThrow();
	for (const rules of [
		{ count: 0 },
		{ count: 101 },
		{ count: 1.5 },
		{ keywords: [""] },
		{ keywords: Array(33).fill("设计") },
		{ triggers: { minLength: 20, maxLength: 10 } },
		{ triggers: { maxLength: 2049 } },
		{ triggers: { regex: ["["] } },
		{ triggers: { regex: Array(17).fill("设计") } },
		{ triggers: { regex: ["x".repeat(257)] } },
		{ triggers: { exclude: [""] } },
		{ mode: "direct" },
		{ plugin: "another-plugin" },
		{ triggers: { unknown: true } },
	])
		expect(() => validateRules(rules as OwnRules), JSON.stringify(rules)).toThrow();
});

test("effective own rules retain owner boundaries and use a twenty-message default count", async () => {
	const fixture = await groupFixture();
	try {
		const rules = new GroupRules(fixture.probe.api, (conv) => conv === mainConv);
		const base: SocialPolicy = {
			plugin: "social",
			mode: "batch",
			keywords: ["主人话题"],
			batch: { count: 20, delaySeconds: 3 },
			minIntervalSeconds: 60,
			quiet: { timezone: "Asia/Shanghai", start: "23:00", end: "07:00" },
			triggers: { exclude: ["广告"], minLength: 5, maxLength: 50 },
		};
		const snapshot = structuredClone(base);
		const effective = rules.effective("main", mainConv, base, "owner-revision", {
			keywords: ["设计", "主人话题"],
			count: 1,
			triggers: { regex: ["界面"], exclude: ["推广"], minLength: 1, maxLength: 2048 },
		});
		expect(base).toEqual(snapshot);
		expect(effective).toEqual({
			...base,
			keywords: ["主人话题", "设计"],
			triggers: { regex: ["界面"], exclude: ["广告", "推广"], minLength: 5, maxLength: 50 },
		});
		expect(rules.effective("main", mainConv, {}, "owner-revision", {}).batch?.count).toBe(20);
		expect(rules.effective("main", mainConv, base, "owner-revision", { count: 30 }).batch?.count).toBe(30);
		expect(
			rules.effective("main", mainConv, { ...base, batch: { count: 40 } }, "owner-revision", { count: 20 }).batch
				?.count,
		).toBe(40);
		expect(await fixture.kernel.events.query({ type: "social.rules-change" })).toMatchObject({ events: [] });
		expect(fixture.probe.sent).toEqual([]);
	} finally {
		await fixture.close();
	}
});
