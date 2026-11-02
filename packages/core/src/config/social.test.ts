import { expect, test } from "vitest";
import { type Binding, parseAgentConfig, parseYonderConfig } from "./index.js";
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

test("finite exact-conv catchalls can shadow ordinary fallbacks without splitting effective key profiles", () => {
	const base = {
		schema: 1,
		id: "main",
		name: "Main",
		owner: "person:owner",
		defaultProfile: "observer",
		profiles: { observer: {}, group: {}, dm: {} },
	};
	const conv = "conv:feishu:room";
	const session = { mode: "persistent", per: "conv" } as const;
	const bindings: Binding[] = [
		{ id: "batch", match: { type: "social.batch-ready", conv }, session, profile: "group", reply: "none" },
		{ id: "exact", match: { conv }, session, profile: "group", wake: "write", reply: "none" },
		{
			id: "batch-fallback",
			match: { type: "social.batch-ready" },
			session,
			profile: "observer",
			wake: "run",
			reply: "none",
		},
		{ id: "observer", match: { channel: "feishu", kind: ["dm", "group"] }, session, profile: "observer" },
	];
	expect(() => parseAgentConfig(JSON.stringify({ ...base, bindings }))).not.toThrow();

	for (const selector of [
		{ conv, kind: "group" },
		{ conv, from: "owner" },
		{ conv, type: "custom.event" },
	]) {
		const narrow = [
			{ ...bindings[0], id: "batch", profile: "group" },
			{ ...bindings[1], id: "exact", match: selector },
			bindings[3],
		];
		expect(() => parseAgentConfig(JSON.stringify({ ...base, bindings: narrow }))).toThrow("同一会话键");
	}

	const wrongOrder = [{ ...bindings[3] }, { ...bindings[1], id: "exact" }];
	expect(() => parseAgentConfig(JSON.stringify({ ...base, bindings: wrongOrder }))).toThrow("同一会话键");

	const batchDifferentProfile: Binding[] = bindings.map((binding) =>
		binding.id === "batch" ? { ...binding, profile: "dm" } : { ...binding },
	);
	expect(() => parseAgentConfig(JSON.stringify({ ...base, bindings: batchDifferentProfile }))).toThrow("batch");

	const sameExactKeyDifferentKinds = [
		{ id: "group", match: { conv, kind: "group" }, session, profile: "group" },
		{ id: "dm", match: { conv, kind: "dm" }, session, profile: "dm" },
	];
	expect(() => parseAgentConfig(JSON.stringify({ ...base, bindings: sameExactKeyDifferentKinds }))).toThrow(
		"同一会话键",
	);

	const ordinaryKindPartitions = [
		{ id: "group", match: { channel: "feishu", kind: "group" }, session, profile: "group" },
		{ id: "dm", match: { channel: "feishu", kind: "dm" }, session, profile: "dm" },
	];
	expect(() => parseAgentConfig(JSON.stringify({ ...base, bindings: ordinaryKindPartitions }))).not.toThrow();
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
	const missingPlugin = socialReferenceErrors(config, new Map([["a", agent]]), new Set());
	expect(missingPlugin.join(" ")).toContain("participation plugin alternative is not loaded");
	expect(missingPlugin.join(" ")).toContain("load its actual package/source and restart");
	const mainProfile = agent.profiles.main;
	if (!mainProfile) throw new Error("main profile is missing");
	mainProfile.plugins = [];
	const missingSelection = socialReferenceErrors(config, new Map([["a", agent]]), new Set(["alternative"]));
	expect(missingSelection.join(" ")).toContain("no matching alternative.batch-ready binding");
	expect(missingSelection.join(" ")).toContain("yonder agents validate a --file <candidate.json>");
	expect(missingSelection.join(" ")).toContain("yonder inspect --agent a --conv <conversation>");
	expect(missingSelection.join(" ")).not.toContain("agents.inspect");
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

test("legacy QQ group batches cannot enter private main and keep their persistent conversation route", () => {
	const legacy = {
		id: "legacy-group-batch",
		match: { type: "channel-qq.group-batch", channel: "qq", conv: "conv:qq:group:work" },
		session: "main",
		reply: "none",
	};
	expect(() => parseAgentConfig(JSON.stringify({ ...base, bindings: [legacy] }))).toThrow(/旧 QQ 群批次.*私人 main/);
	expect(() =>
		parseAgentConfig(
			JSON.stringify({
				...base,
				bindings: [{ ...legacy, session: { mode: "persistent", per: "conv" }, wake: "write" }],
			}),
		),
	).not.toThrow();
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
	const missingSelection = socialReferenceErrors(config, new Map([["a", agent]]), new Set(["social"]));
	expect(missingSelection.join(" ")).toContain("participation plugin social is not selected by batch profile main");
	expect(missingSelection.join(" ")).toContain("run yonder agents validate/update");
	agent.profiles.main = { plugins: ["social"] };
	expect(socialReferenceErrors(config, new Map([["a", agent]]), new Set(["social"]))).toEqual([]);
	const missingPlugin = socialReferenceErrors(config, new Map([["a", agent]]), new Set());
	expect(missingPlugin.join(" ")).toContain("participation plugin social is not loaded");
	expect(missingPlugin.join(" ")).toContain("load its actual package/source and restart");
});

test("social batch scope repair points to global inspect, not an agents inspect command", () => {
	const agent = parseAgentConfig(
		JSON.stringify({
			...base,
			social: { enabled: true, defaults: { group: { plugin: "social", mode: "batch" } } },
		}),
	);
	const config = parseYonderConfig(JSON.stringify({ schema: 1 }), "yonder.yaml");
	const errors = socialReferenceErrors(config, new Map([[agent.id, agent]]), new Set(["social"]));
	expect(errors.join(" ")).toContain("yonder agents validate a --file <candidate.json>");
	expect(errors.join(" ")).toContain("yonder inspect --agent a --conv <conversation>");
	expect(errors.join(" ")).not.toContain("agents.inspect");
});

test("explicit group batch defaults require an exact profile consumer even outside social scope", () => {
	const agent = parseAgentConfig(`schema: 1
id: main
name: Main
owner: person:owner
defaultProfile: main
profiles:
  main: { plugins: [] }
  qq: { plugins: [social] }
social:
  enabled: true
  scope: ["conv:qq:other"]
  defaults:
    group: { plugin: social, mode: batch, batch: { run: true } }
bindings:
  - id: p1-source
    match: { type: message.in, channel: feishu, conv: "conv:feishu:p1" }
    session: { mode: persistent, per: conv }
    profile: main
    wake: write
    reply: none
  - id: feishu-observer
    match: { type: message.in, channel: feishu, kind: group }
    session: { mode: persistent, per: conv }
    profile: main
    wake: write
    reply: none
  - id: unrelated-qq-consumer
    match: { type: social.batch-ready, channel: qq, conv: "conv:qq:other" }
    session: { mode: persistent, per: conv }
    profile: qq
    wake: run
    reply: none
`);
	const config = parseYonderConfig(
		JSON.stringify({ schema: 1, channels: { qq: { type: "qq" }, feishu: { type: "feishu" } } }),
		"yonder.yaml",
	);
	const channels = new Map([["feishu", { id: "feishu", kinds: ["group"] } as never]]);
	const errors = socialReferenceErrors(config, new Map([["main", agent]]), new Set(["social"]), channels);
	// A Feishu conv can be a DM or a group; no kind on this exact source is not static proof of group traffic.
	expect(errors).toEqual([]);
	expect(
		socialReferenceErrors(config, new Map([["main", agent]]), new Set(["social"]), channels, {
			strictBatchConsumers: false,
		}),
	).toEqual([]);
	const knownGroup = structuredClone(agent);
	const source = knownGroup.bindings.find((binding) => binding.id === "p1-source");
	if (!source) throw new Error("source binding is missing");
	source.match.kind = "group";
	const strictErrors = socialReferenceErrors(config, new Map([["main", knownGroup]]), new Set(["social"]), channels);
	expect(strictErrors.join(" ")).toContain("p1-source");
	expect(strictErrors.join(" ")).toContain("source profile main must select social");
	expect(strictErrors.join(" ")).toContain("yonder agents validate main --file <candidate.json>");
	expect(strictErrors.join(" ")).toContain("yonder inspect --agent main --conv conv:feishu:p1");
	const repaired = structuredClone(knownGroup);
	repaired.profiles.main = { plugins: ["social"] };
	expect(socialReferenceErrors(config, new Map([["main", repaired]]), new Set(["social"]), channels)).toEqual([]);
	const directRun = structuredClone(knownGroup);
	const directSource = directRun.bindings.find((binding) => binding.id === "p1-source");
	if (!directSource) throw new Error("source binding is missing");
	directSource.wake = "run";
	expect(socialReferenceErrors(config, new Map([["main", directRun]]), new Set(["social"]), channels)).toEqual([]);
	const shadowed = structuredClone(directRun);
	const shadowedSocial = shadowed.social;
	if (!shadowedSocial) throw new Error("social config is missing");
	shadowedSocial.scope = ["conv:feishu:p1"];
	shadowed.profiles.main = { plugins: ["social"] };
	shadowed.bindings.push(
		{
			id: "invalid-first",
			match: { type: "social.batch-ready", channel: "feishu", conv: "conv:feishu:p1" },
			session: { mode: "persistent", per: "conv" },
			profile: "main",
			reply: "none",
			wake: "write",
		},
		{
			id: "valid-later",
			match: { type: "social.batch-ready", channel: "feishu", conv: "conv:feishu:p1" },
			session: { mode: "persistent", per: "conv" },
			profile: "main",
			reply: "none",
			wake: "run",
		},
	);
	expect(
		socialReferenceErrors(config, new Map([["main", shadowed]]), new Set(["social"]), channels).join(" "),
	).toContain("no matching social.batch-ready consumer");
});
