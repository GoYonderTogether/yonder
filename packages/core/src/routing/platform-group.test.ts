import type { Channel, YEvent } from "@yonder/sdk";
import { expect, test } from "vitest";
import { parseAgentConfig } from "../config/index.js";
import { membershipGroup, platformGroupBinding } from "./platform-group.js";
import { socialDecision } from "./social.js";

const channel = { id: "card", multiAgent: true, features: { groupParticipation: "membership" } } as Channel;
const event: YEvent = {
	id: "input",
	ts: new Date().toISOString(),
	type: "message.in",
	conv: "conv:card:main:new-group",
	from: "acct:card:main:member",
	data: { kind: "group", target: "main", mentioned: false, social: { mentions: { bot: false } } },
};
const agent = () =>
	parseAgentConfig(
		JSON.stringify({
			schema: 1,
			id: "main",
			name: "Main",
			owner: "person:owner",
			defaultProfile: "owner",
			defaults: { plugins: ["private"], contexts: ["memory-core"], skills: ["private"], tools: { offer: ["*"] } },
			profiles: { owner: { level: "bypass", cheap: "openai/gpt-6-luna" } },
			bindings: [],
		}),
	);

test("joined platform groups derive isolated visible defaults and do not grant owner tools", () => {
	const a = agent();
	expect(socialDecision(a, event, undefined, channel)).toMatchObject({ reason: "batch", run: false });
	const binding = platformGroupBinding(a, channel);
	expect(binding).toMatchObject({
		id: "@platform-group:card",
		session: { mode: "persistent", per: "conv" },
		reply: "none",
		wake: "mention",
	});
	expect(a.profiles[binding.profile!]).toMatchObject({
		capabilities: ["read"],
		plugins: ["social"],
		contexts: ["peer-workspace"],
		skills: [],
		cheap: "openai/gpt-6-luna",
		channelInstances: ["card"],
	});
	expect(a.profiles[binding.profile!]?.tools?.offer).not.toContain("bash");
	expect(platformGroupBinding(a, channel)).toBe(binding);
	expect(a.bindings).toHaveLength(1);
	expect(a.social).toBeUndefined();
});

test("membership defaults cover new groups only and preserve explicit denials and custom policies", () => {
	const social = {
		enabled: true,
		scope: ["conv:card:main:old"],
		authorized: { conversations: ["conv:card:main:old"] },
		defaults: { group: { plugin: "other", mode: "record" } },
	};
	const configured = (patch: object) =>
		parseAgentConfig(JSON.stringify({ ...agent(), social: { ...social, ...patch } }));
	expect(socialDecision(configured({}), event, undefined, channel)).toMatchObject({ reason: "record" });
	expect(
		socialDecision(configured({ defaults: { group: { mode: "batch" } } }), event, undefined, channel),
	).toMatchObject({ reason: "batch" });
	expect(socialDecision(configured({ denied: [event.conv] }), event, undefined, channel)).toMatchObject({
		reason: "denied",
	});
	expect(socialDecision(configured({ enabled: false }), event, undefined, channel)).toBeUndefined();
	const a = agent();
	expect(membershipGroup(a, { ...event, data: { kind: "group", target: "other" } }, channel)).toBe(false);
	expect(membershipGroup(a, { ...event, data: { kind: "dm", target: "main" } }, channel)).toBe(false);
	expect(membershipGroup(a, event, { ...channel, features: {} })).toBe(false);
});
