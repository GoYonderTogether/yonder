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
