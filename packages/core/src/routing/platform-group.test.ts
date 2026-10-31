import type { Channel, YEvent } from "@yonder/sdk";
import { expect, test } from "vitest";
import { parseAgentConfig } from "../config/index.js";
import {
	batchReadyBinding,
	legacyGroupChain,
	membershipGroup,
	officialGroupBinding,
	officialGroupDefault,
	platformGroupBinding,
} from "./platform-group.js";
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

const qqChannel = { id: "qq-main", kinds: ["dm", "group"] } as Channel;
const qqEvent = (extra: object = {}): YEvent => ({
	id: "input",
	ts: new Date().toISOString(),
	type: "message.in",
	conv: "conv:qq-main:group:GROUP",
	from: "acct:qq-main:member",
	data: { kind: "group", text: "hello", mentioned: false, ...extra },
});
const official = (extra: object = {}) =>
	parseAgentConfig(
		JSON.stringify({
			schema: 1,
			id: "main",
			name: "Main",
			owner: "person:owner",
			defaultProfile: "qq-main-group",
			profiles: { "qq-main-group": { plugins: ["social"], capabilities: ["read"] } },
			bindings: [
				{
					id: "qq-main-group",
					match: { channel: "qq-main", kind: "group" },
					session: { mode: "persistent", per: "conv" },
					profile: "qq-main-group",
					wake: "write",
					reply: "none",
				},
				{
					id: "qq-main-batch",
					match: { type: "social.batch-ready", channel: "qq-main" },
					session: { mode: "persistent", per: "conv" },
					profile: "qq-main-group",
					reply: "none",
				},
			],
			...extra,
		}),
	);

test("official QQ group bindings derive a restricted default range without rewriting config", () => {
	const agent = official();
	expect(officialGroupBinding(agent, qqEvent(), qqChannel)).toBe(true);
	expect(officialGroupDefault(agent, qqEvent(), qqChannel)).toBe(true);
	expect(batchReadyBinding(agent, "qq-main", "social")).toBe(true);
	expect(legacyGroupChain(agent, qqEvent())).toBe(false);
	// 没有 social 配置时默认范围只做硬触发：普通消息只记录，不运行。
	expect(socialDecision(agent, qqEvent(), undefined, qqChannel)).toMatchObject({ reason: "batch", run: false });
	expect(socialDecision(agent, qqEvent({ mentioned: true }), undefined, qqChannel)).toMatchObject({ run: true });
	// 派生是解析期默认，不写进配置。
	expect(agent.social).toBeUndefined();
});

test("explicit denied, record, custom plugin and custom bindings keep priority over the derived default", () => {
	const event = qqEvent({ mentioned: true });
	expect(
		socialDecision(official({ social: { enabled: true, denied: [event.conv] } }), event, undefined, qqChannel),
	).toMatchObject({ reason: "denied" });
	expect(
		socialDecision(
			official({ social: { enabled: true, defaults: { group: { mode: "record" } } } }),
			event,
			undefined,
			qqChannel,
		),
	).toMatchObject({ reason: "record" });
	expect(
		socialDecision(
			official({ social: { enabled: true, defaults: { group: { plugin: "other", mode: "record" } } } }),
			event,
			undefined,
			qqChannel,
		),
	).toMatchObject({ reason: "record" });
	expect(socialDecision(official({ social: { enabled: false } }), event, undefined, qqChannel)).toBeUndefined();
	// 自定义参与插件优先：派生范围不替它判断，也不把普通消息升级为运行。
	const customPlugin = official({
		social: { enabled: true, defaults: { group: { plugin: "alternative", mode: "batch", batch: { run: false } } } },
	});
	expect(socialDecision(customPlugin, qqEvent(), undefined, qqChannel)).toMatchObject({ reason: "batch", run: false });
	// 自定义绑定：不是官方 write 形态，就没有派生范围。
	const custom = parseAgentConfig(
		JSON.stringify({
			schema: 1,
			id: "main",
			name: "Main",
			owner: "person:owner",
			defaultProfile: "group",
			profiles: { group: {} },
			bindings: [
				{
					id: "custom",
					match: { channel: "qq-main", kind: "group" },
					session: { mode: "persistent", per: "conv" },
					wake: "mention",
					reply: "none",
				},
			],
		}),
	);
	expect(officialGroupDefault(custom, event, qqChannel)).toBe(false);
	expect(socialDecision(custom, event, undefined, qqChannel)).toBeUndefined();
});

test("an un-migrated home keeps the deprecated chain and does not also derive the default range", () => {
	const agent = official({
		bindings: [
			{
				id: "qq-main-group",
				match: { channel: "qq-main", kind: "group" },
				session: { mode: "persistent", per: "conv" },
				profile: "qq-main-group",
				wake: "write",
				reply: "none",
			},
			{
				id: "qq-main-batch",
				match: { type: "channel-qq.group-batch", channel: "qq-main" },
				session: { mode: "persistent", per: "conv" },
				profile: "qq-main-group",
				reply: "none",
			},
		],
	});
	expect(legacyGroupChain(agent, qqEvent())).toBe(true);
	expect(officialGroupDefault(agent, qqEvent(), qqChannel)).toBe(false);
	expect(batchReadyBinding(agent, "qq-main", "social")).toBe(false);
	expect(socialDecision(agent, qqEvent({ mentioned: true }), undefined, qqChannel)).toBeUndefined();
});

test("private chats and other instances never get the official group default", () => {
	const agent = official();
	expect(
		officialGroupDefault(agent, { ...qqEvent(), conv: "conv:qq-main:c2c:USER", data: { kind: "dm" } }, qqChannel),
	).toBe(false);
	expect(officialGroupDefault(agent, qqEvent(), { ...qqChannel, kinds: ["dm"] } as Channel)).toBe(false);
	expect(officialGroupDefault(agent, { ...qqEvent(), conv: "conv:qq-other:group:GROUP" }, qqChannel)).toBe(false);
	expect(officialGroupDefault(agent, { ...qqEvent(), type: "message.out" }, qqChannel)).toBe(false);
});
