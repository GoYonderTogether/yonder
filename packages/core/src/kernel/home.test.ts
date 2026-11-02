import type { SessionInfo } from "@yonder/sdk";
import { expect, test } from "vitest";
import { parseAgentConfig, parseYonderConfig } from "../config/index.js";
import { protectSessions } from "./home.js";

test("candidate binding profile changes cannot strand an open persistent session with an exact key selector", () => {
	const config = parseYonderConfig(
		JSON.stringify({ schema: 1, agents: [{ id: "main", workspace: "./agents/main" }] }),
		"yonder.yaml",
	);
	const cases = [
		{
			per: "conv",
			selector: { conv: "conv:qq:group:team", kind: "group" },
			key: "conv:conv:qq:group:team",
		},
		{ per: "from", selector: { from: "acct:qq:member" }, key: "from:acct:qq:member" },
		{ per: "person", selector: { from: "person:member" }, key: "person:person:member" },
	] as const;
	for (const [index, item] of cases.entries()) {
		const agent = parseAgentConfig(
			JSON.stringify({
				schema: 1,
				id: "main",
				name: "Main",
				owner: "person:owner",
				defaultProfile: "owner",
				profiles: { owner: {}, group: {} },
				bindings: [
					{
						id: "persistent",
						match: item.selector,
						session: { mode: "persistent", per: item.per },
						profile: "owner",
					},
				],
			}),
		);
		const candidate = structuredClone(agent);
		const nextBinding = candidate.bindings[0];
		if (!nextBinding) throw new Error("test binding is missing");
		nextBinding.profile = "group";
		const session: SessionInfo = {
			id: `session-${index}`,
			agent: "main",
			profile: "owner",
			mode: "persistent",
			key: item.key,
			version: "1",
			opened: new Date(0).toISOString(),
		};
		const errors: string[] = [];
		protectSessions(
			config,
			config,
			new Map([["main", agent]]),
			new Map([["main", candidate]]),
			new Map(),
			new Map(),
			[session],
			errors,
		);
		expect(errors.join(" "), item.per).toContain("close before changing binding profile owner to group");
		expect(errors.join(" "), item.per).toContain("agents validate/update");
	}
});

test("a new exact-conv catchall requires closing an existing session before changing its effective profile", () => {
	const config = parseYonderConfig(
		JSON.stringify({ schema: 1, agents: [{ id: "main", workspace: "./agents/main" }] }),
		"yonder.yaml",
	);
	const conv = "conv:feishu:room";
	const previous = parseAgentConfig(
		JSON.stringify({
			schema: 1,
			id: "main",
			name: "Main",
			owner: "person:owner",
			defaultProfile: "observer",
			profiles: { observer: {}, group: {} },
			bindings: [
				{
					id: "observer",
					match: { channel: "feishu", kind: ["dm", "group"] },
					session: { mode: "persistent", per: "conv" },
					profile: "observer",
				},
			],
		}),
	);
	const candidate = structuredClone(previous);
	candidate.bindings.unshift({
		id: "exact-group",
		match: { conv, type: "message.in" },
		session: { mode: "persistent", per: "conv" },
		profile: "group",
		wake: "write",
		reply: "none",
	});
	const session: SessionInfo = {
		id: "observer-session",
		agent: "main",
		profile: "observer",
		mode: "persistent",
		key: `conv:${conv}`,
		version: "1",
		opened: new Date(0).toISOString(),
	};
	const errors: string[] = [];
	protectSessions(
		config,
		config,
		new Map([["main", previous]]),
		new Map([["main", candidate]]),
		new Map(),
		new Map(),
		[session],
		errors,
	);
	expect(errors.join(" ")).toContain("session observer-session");
	expect(errors.join(" ")).toContain("yonder sessions close observer-session");
	expect(errors.join(" ")).toContain("agents validate/update");
});
