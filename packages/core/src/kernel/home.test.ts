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
