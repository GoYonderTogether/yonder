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
