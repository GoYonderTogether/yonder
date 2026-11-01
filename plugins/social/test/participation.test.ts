import type { ParticipationInput, SocialConfig, YEvent } from "@yonder/sdk";
import { createRegistrationCollector } from "@yonder/sdk/testing";
import { expect, test } from "vitest";
import plugin from "../src/index.js";

// 官方 social 注册的真实参与判定钩子（04 §3.6）：由插件自己 setup，不经过内核。
const collector = createRegistrationCollector();
await plugin.setup({ ...collector.api, config: {} } as never);
const hooks = collector.registrations.hooks;
const registered = hooks
	.map((hook) => hook.participation)
	.find((participation): participation is NonNullable<typeof participation> => typeof participation === "function");
if (!registered) throw new Error("The official social plugin did not register participation");

const base: SocialConfig = {
	enabled: true,
	authorized: { conversations: ["conv:chat:group"] },
	denied: ["acct:chat:blocked"],
	defaults: { group: { batch: { count: 5 } } },
};
const event = (data: object, conv = "conv:chat:group", from = "acct:chat:user"): YEvent => ({
	id: "e",
	ts: "2026-01-01T00:00:00Z",
	type: "message.in",
	from,
	conv,
	data: { kind: "group", ...data },
});
const decide = (social: SocialConfig | undefined, input: Partial<ParticipationInput> = {}) =>
	registered({
		agent: { id: "main", owner: "person:owner", ...(social ? { social } : {}) },
		event: event({}),
		facts: { member: false, bound: false, officialDefault: false, custom: false },
		now: "2026-01-01T12:00:00Z",
		...input,
	});

test("the official policy keeps its reasons, run results and revision", () => {
	const decision = decide(base, { event: event({ mentioned: true }) });
	expect(decision).toMatchObject({ reason: "bot-mention", run: true });
	expect(decision?.revision).toMatch(/^[0-9a-f]{64}$/);
	// 无 social 配置时不代内核判断。
	expect(decide(undefined)).toBeUndefined();
	expect(decide(base)).toMatchObject({ reason: "batch", run: false });
	expect(decide(base, { event: event({}, "conv:chat:other") })).toMatchObject({ reason: "not-authorized" });
	expect(decide(base, { event: event({}, "conv:chat:group", "acct:chat:blocked") })).toMatchObject({
		reason: "denied",
	});
});

test("kernel facts authorize without a hand-written list, and the plugin cannot overturn a denial", () => {
	// 官方群绑定接纳就是该群的授权（08）：facts.bound 足够。
	const official: SocialConfig = { enabled: true };
	expect(
		decide(official, { facts: { member: false, bound: true, officialDefault: false, custom: false } }),
	).toMatchObject({ reason: "batch", run: false });
	expect(decide(base, { event: event({}, "conv:chat:other") })).not.toHaveProperty("run", true);
	// 派生默认范围（facts.officialDefault）在没有显式配置时也参与判定。
	expect(
		decide(undefined, { facts: { member: false, bound: false, officialDefault: true, custom: false } }),
	).toBeUndefined();
	expect(
		registered({
			agent: { id: "main" },
			event: event({}),
			facts: { member: true, bound: true, officialDefault: false, custom: false },
			now: "2026-01-01T12:00:00Z",
		}),
	).toBeUndefined();
});

test("quiet hours use the injected time and signal handling keeps its defaults", () => {
	const quiet: SocialConfig = {
		...base,
		defaults: { group: { quiet: { timezone: "UTC", start: "09:00", end: "17:00" } } },
	};
	expect(decide(quiet, { now: "2026-01-01T12:00:00Z" })).toMatchObject({ reason: "quiet" });
	expect(decide(quiet, { now: "2026-01-01T20:00:00Z" })).toMatchObject({ reason: "batch" });
	const broken: SocialConfig = {
		...base,
		defaults: { group: { quiet: { timezone: "Not/AZone", start: "09:00", end: "17:00" } } },
	};
	expect(decide(broken, { now: "2026-01-01T12:00:00Z" })).toMatchObject({ reason: "invalid-timezone" });
	// 默认 botMention=respond，其余信号只 consider。
	expect(decide(base, { event: event({ social: { mentions: { owner: true } } }) })).toMatchObject({
		reason: "batch",
		run: false,
	});
	expect(
		decide(
			{ ...base, defaults: { group: { signals: { ownerMention: "respond" } } } },
			{ event: event({ social: { mentions: { owner: true } } }) },
		),
	).toMatchObject({ reason: "owner-mention", run: true });
});

test("folds retain their effective policy snapshot and bot senders only record", () => {
	// 每个 kind 的 defaults 是整块替换，未写的字段取内置行为。
	expect(
		decide({
			...base,
			defaults: { group: { mode: "folded", foldedEverySeconds: 300, batch: { count: 5 } } },
		}),
	).toMatchObject({
		reason: "folded",
		policy: { mode: "folded", foldedEverySeconds: 300, batch: { count: 5 } },
	});
	expect(decide(base, { event: event({ senderIsBot: true, mentioned: true }) })).toMatchObject({
		reason: "record",
		run: false,
	});
});
