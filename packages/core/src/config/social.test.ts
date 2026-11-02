import { expect, test } from "vitest";
import { parseAgentConfig, parseYonderConfig } from "./index.js";
import { socialReferenceErrors } from "./social-validation.js";

const base = {
	schema: 1,
	id: "a",
	name: "A",
	owner: "person:o",
	defaultProfile: "main",
	profiles: { main: {} },
	bindings: [],
};
const parse = (social: object) => parseAgentConfig(JSON.stringify({ ...base, social }));
test("social configuration is optional and validates bounds and quiet time", () => {
	expect(parseAgentConfig(JSON.stringify(base)).social).toBeUndefined();
	expect(
		parse({
			defaults: {
				group: { batch: { count: 100 }, quiet: { timezone: "Asia/Shanghai", start: "23:00", end: "07:00" } },
			},
		}).social,
	).toBeDefined();
	for (const social of [
		{ defaults: { group: { batch: { count: 101 } } } },
		{ defaults: { group: { quiet: { timezone: "Asia/Shanghai", start: "07:00", end: "07:00" } } } },
		{ defaults: { group: { quiet: { timezone: "invalid", start: "07:00", end: "08:00" } } } },
		{ mappings: [{ subject: "person:x", agent: "a", profile: "missing" }] },
		{ defaults: { dm: { mode: "batch" } } },
	])
		expect(() => parse(social)).toThrow();
	expect(
		parseYonderConfig(JSON.stringify({ schema: 1, notifications: { outbound: { maxItems: 5 } } }), "yonder.yaml")
			.notifications?.outbound?.maxItems,
	).toBe(5);
});

test("social trigger rules accept standard regex and literal exclusions, and reject invalid rules", () => {
	const triggers = {
		regex: [
			"^(设计|界面).{0,20}$",
			"[()+?{}*]",
			"\\(参考\\)\\+",
			"文.稿",
			"a*",
			"a+",
			"a?",
			"(?=设计)",
			"(a)\\1",
			"(?<name>a)\\k<name>",
		],
		exclude: ["[广告", "(链接).*"],
		minLength: 0,
		maxLength: 2048,
	};
	expect(parse({ defaults: { group: { triggers } } }).social?.defaults?.group?.triggers).toEqual(triggers);
	for (const triggers of [
		{ regex: ["["] },
		{ regex: ["(设计"] },
		{ regex: ["a**"] },
		{ regex: ["a\\1"] },
		{ regex: ["\\k<name>"] },
		{ regex: ["x".repeat(257)] },
		{ regex: Array(17).fill("设计") },
		{ minLength: -1 },
		{ maxLength: 1.5 },
		{ minLength: 20, maxLength: 10 },
		{ exclude: [""] },
	]) {
		expect(() => parse({ defaults: { group: { triggers } } }), JSON.stringify(triggers)).toThrow(/triggers/);
		expect(() => parse({ conversations: { "conv:test:group": { triggers } } }), JSON.stringify(triggers)).toThrow(
			/triggers/,
		);
	}
});

test("cross-file social references check agent, profile and channel scope", () => {
	const agent = parse({
		authorized: { accounts: ["acct:missing:123"] },
		mappings: [{ subject: "conv:missing:123", agent: "absent", profile: "main" }],
	});
	const config = parseYonderConfig(JSON.stringify({ schema: 1 }), "yonder.yaml");
	expect(socialReferenceErrors(config, new Map([["a", agent]]))).toHaveLength(3);
	expect(() => parse({ authorized: { accounts: ["acct:bad"] } })).toThrow();
	expect(() =>
		parseYonderConfig(
			JSON.stringify({
				schema: 1,
				notifications: { outbound: { quiet: { timezone: "UTC", start: "10:00", end: "10:00" } } },
			}),
			"yonder.yaml",
		),
	).toThrow();
});

test("enabled social cannot use an outbound target outside the default profile scope", () => {
	const agent = parseAgentConfig(
		JSON.stringify({ ...base, defaults: { channelInstances: [] }, social: { enabled: true } }),
	);
	const config = parseYonderConfig(
		JSON.stringify({
			schema: 1,
			channels: { qq: { type: "qq" } },
			notifications: { outbound: { target: { to: "acct:qq:123", via: "qq" } } },
		}),
		"yonder.yaml",
	);
	expect(socialReferenceErrors(config, new Map([["a", agent]]))).toHaveLength(1);
});

test("group batch bindings cannot collide with DM profiles or disjoint explicit conversations", () => {
	const base = {
		schema: 1,
		id: "main",
		name: "Main",
		owner: "person:owner",
		defaultProfile: "visitor",
		profiles: { visitor: {}, group: {} },
		bindings: [
			{
				id: "dm",
				match: { channel: "card", kind: "dm" },
				session: { mode: "persistent", per: "conv" },
				profile: "visitor",
			},
			{
				id: "batch",
				match: { type: "social.batch-ready", channel: "card", conv: "conv:card:main:group" },
				session: { mode: "persistent", per: "conv" },
				profile: "group",
				reply: "none",
			},
		],
	};
	expect(() => parseAgentConfig(JSON.stringify(base))).not.toThrow();
	const disjoint = {
		...base,
		bindings: [{ ...base.bindings[0], match: { channel: "card", conv: "conv:card:main:dm" } }, base.bindings[1]],
	};
	expect(() => parseAgentConfig(JSON.stringify(disjoint))).not.toThrow();
	const overlap = {
		...base,
		bindings: [{ ...base.bindings[0], match: { channel: "card", kind: "group" } }, base.bindings[1]],
	};
	expect(() => parseAgentConfig(JSON.stringify(overlap))).toThrow("同一会话");
});

test("participation plugin references require loading and the matching Bot profile selection", () => {
	const agent = parseAgentConfig(
		JSON.stringify({
			...base,
			profiles: { main: { plugins: ["alternative"] } },
			bindings: [
				{
					id: "batch",
					match: { type: "alternative.batch-ready" },
					session: { mode: "persistent", per: "conv" },
					reply: "none",
				},
			],
			social: { enabled: true, defaults: { group: { plugin: "alternative", mode: "batch" } } },
		}),
	);
	const config = parseYonderConfig(JSON.stringify({ schema: 1 }), "yonder.yaml");
	expect(socialReferenceErrors(config, new Map([["a", agent]]), new Set(["alternative"]))).toEqual([]);
	expect(socialReferenceErrors(config, new Map([["a", agent]]), new Set())).toContain(
		"a/social/group: participation plugin not loaded alternative",
	);
	agent.profiles.main!.plugins = [];
	expect(socialReferenceErrors(config, new Map([["a", agent]]), new Set(["alternative"]))).toContain(
		"a/social/group: participation plugin must be selected by a matching batch profile alternative",
	);
	expect(() => parse({ defaults: { group: { plugin: "plugin:not-an-id" } } })).toThrow();
});

test("reject unrunnable social group/main and batch shapes before publishing configuration", () => {
	const binding = {
		id: "group",
		match: { channel: "qq", kind: "group", conv: "conv:qq:group:work" },
		session: "main",
	};
	const candidate = { ...base, bindings: [binding], social: { enabled: true } };
	expect(() => parseAgentConfig(JSON.stringify(candidate))).toThrow(/group.*私人 main/);
	expect(() => parseAgentConfig(JSON.stringify({ ...candidate, social: { enabled: false } }))).not.toThrow();
	expect(() =>
		parseAgentConfig(
			JSON.stringify({
				...candidate,
				social: { enabled: true, scope: ["conv:qq:group:other"] },
			}),
		),
	).not.toThrow();
	expect(() =>
		parseAgentConfig(
			JSON.stringify({
				...base,
				bindings: [{ ...binding, match: { type: "social.batch-ready" }, reply: "none" }],
			}),
		),
	).toThrow(/参与批次/);
});

test("unrelated plugin batch-ready events keep their ordinary binding contract", () => {
	expect(() =>
		parseAgentConfig(
			JSON.stringify({
				...base,
				bindings: [
					{
						id: "custom",
						match: { type: "custom.batch-ready", kind: "dm" },
						session: "main",
					},
				],
			}),
		),
	).not.toThrow();
	expect(() =>
		parseAgentConfig(
			JSON.stringify({
				...base,
				profiles: { main: {}, other: {} },
				bindings: [
					{
						id: "custom",
						match: { type: "custom.batch-ready", conv: "conv:qq:shared" },
						session: { mode: "persistent", per: "conv" },
					},
					{
						id: "dm",
						match: { kind: "dm", conv: "conv:qq:shared" },
						session: { mode: "persistent", per: "conv" },
						profile: "other",
					},
				],
			}),
		),
	).toThrow("同一会话");
});

test("a selected group participation plugin keeps batch bindings separate from private sessions", () => {
	expect(() =>
		parseAgentConfig(
			JSON.stringify({
				...base,
				profiles: { group: { plugins: ["delivery-probe"] }, private: {} },
				defaultProfile: "group",
				social: { enabled: true, defaults: { group: { plugin: "delivery-probe", mode: "batch" } } },
				bindings: [
					{
						id: "group",
						match: { channel: "qq", kind: "group" },
						session: { mode: "persistent", per: "conv" },
						profile: "group",
					},
					{
						id: "group-batch",
						match: { type: "delivery-probe.batch-ready", channel: "qq" },
						session: { mode: "persistent", per: "conv" },
						profile: "group",
						reply: "none",
					},
					{
						id: "private",
						match: { channel: "qq", kind: "dm" },
						session: { mode: "persistent", per: "conv" },
						profile: "private",
					},
				],
			}),
		),
	).not.toThrow();
});

test("default social batch profiles need the same plugin admission checks as explicit plugins", () => {
	const agent = parseAgentConfig(
		JSON.stringify({
			...base,
			profiles: { main: { plugins: [] } },
			social: { enabled: true },
			bindings: [
				{
					id: "batch",
					match: { type: "social.batch-ready" },
					session: { mode: "persistent", per: "conv" },
					reply: "none",
				},
			],
		}),
	);
	const config = parseYonderConfig(JSON.stringify({ schema: 1 }), "yonder.yaml");
	expect(socialReferenceErrors(config, new Map([["a", agent]]), new Set(["social"]))).toContain(
		"a/batch: participation plugin must be selected by batch profile main: social",
	);
	agent.profiles.main = { plugins: ["social"] };
	expect(socialReferenceErrors(config, new Map([["a", agent]]), new Set(["social"]))).toEqual([]);
	expect(socialReferenceErrors(config, new Map([["a", agent]]), new Set())).toContain(
		"a/batch: participation plugin not loaded social",
	);
});
