import { decideParticipation, socialBindingAllowed } from "@yonder/bot-core/routing/social";
import { parseAgentConfig } from "@yonder/local-host/config/index";
import { socialPluginHooks } from "@yonder/local-host/kernel/social-plugin.test-support";
import { expect, test } from "vitest";

// 每条用例都走真实插件：真实加载器加载官方 social 插件，调用它注册的 `participation`。
const hooks = await socialPluginHooks();
const agent = parseAgentConfig(
	JSON.stringify({
		schema: 1,
		id: "main",
		name: "main",
		owner: "person:owner",
		defaultProfile: "guest",
		profiles: { guest: {} },
		bindings: [],
		social: { enabled: true, authorized: { conversations: ["conv:chat:group"] }, denied: ["acct:chat:blocked"] },
	}),
);
const message = (kind: string, from = "acct:chat:user", conv = "conv:chat:group", data = {}) => ({
	id: "e",
	ts: "2026-01-01T00:00:00Z",
	type: "message.in",
	from,
	conv,
	data: { kind, ...data },
});
const decide = (target: typeof agent, event: ReturnType<typeof message>, person?: string) =>
	decideParticipation(target, event, person, undefined, hooks);

test("social scopes authorize independently and fail closed", () => {
	expect(decide(agent, message("dm", "acct:chat:owner", "conv:chat:owner"), "person:owner")?.run).toBe(true);
	expect(decide(agent, message("dm", "acct:chat:user", "conv:chat:private"))?.run).toBe(false);
	expect(decide(agent, message("group", "acct:chat:blocked", "conv:chat:group", { mentioned: true }))?.reason).toBe(
		"denied",
	);
	expect(decide(agent, message("group", "acct:chat:user", "conv:chat:group", { text: "@bot" }))?.run).toBe(false);
	expect(decide(agent, message("group", "acct:chat:user", "conv:chat:group", { mentioned: true }))?.run).toBe(true);
	expect(
		decide(
			agent,
			message("group", "acct:chat:user", "conv:chat:group", {
				mentioned: true,
				social: { mentions: { bot: false } },
			}),
		)?.reason,
	).toBe("mention-conflict");
	expect(decide(agent, message("unknown"), "person:owner")?.run).toBe(false);
	expect(socialBindingAllowed(agent, message("group"), "person:owner", { id: "x", match: {}, session: "main" })).toBe(
		false,
	);
});

test("owner mentions respect the configured signal without granting authorization", () => {
	const configured = {
		...agent,
		social: {
			...agent.social!,
			defaults: { group: { mode: "mention" as const, signals: { ownerMention: "respond" as const } } },
		},
	};
	const event = message("group", "acct:chat:user", "conv:chat:group", { social: { mentions: { owner: true } } });
	expect(decide(configured as unknown as typeof agent, event)?.reason).toBe("owner-mention");
	expect(decide(configured as unknown as typeof agent, { ...event, conv: "conv:chat:other" })?.reason).toBe(
		"not-authorized",
	);
});

test("an @all legacy mention is not a bot mention under social policy", () => {
	const event = message("group", "acct:chat:user", "conv:chat:group", {
		mentioned: true,
		social: { mentions: { bot: false, everyone: true } },
	});
	expect(decide(agent, event)).toMatchObject({ reason: "batch", run: false });
	const respond = {
		...agent,
		social: { ...agent.social, defaults: { group: { signals: { everyone: "respond" as const } } } },
	};
	expect(decide(respond as unknown as typeof agent, event)).toMatchObject({ reason: "everyone", run: true });
});

test("conversation batch and signal settings retain unspecified group defaults", () => {
	const configured = {
		...agent,
		social: {
			...agent.social,
			defaults: { group: { batch: { run: true, delaySeconds: 60 }, signals: { everyone: "respond" as const } } },
			conversations: { "conv:chat:group": { batch: { count: 5 }, signals: { keyword: "record" as const } } },
		},
	};
	const decision = decide(configured as unknown as typeof agent, message("group"));
	expect(decision?.policy?.batch).toEqual({ run: true, delaySeconds: 60, count: 5 });
	const everyone = message("group", "acct:chat:user", "conv:chat:group", { social: { mentions: { everyone: true } } });
	expect(decide(configured as unknown as typeof agent, everyone)?.reason).toBe("everyone");
});

test("scoped group social leaves private and other-group routing unchanged", () => {
	const scoped = { ...agent, social: { ...agent.social, scope: ["conv:chat:group"] } } as typeof agent;
	expect(decide(scoped, message("dm", "acct:chat:user", "conv:chat:private"))).toBeUndefined();
	expect(decide(scoped, message("group", "acct:chat:user", "conv:chat:other"))).toBeUndefined();
	expect(
		socialBindingAllowed(scoped, message("dm", "acct:chat:user", "conv:chat:private"), undefined, {
			id: "dm",
			match: {},
			session: "main",
		}),
	).toBe(true);
	expect(
		decide(scoped, message("group", "acct:chat:user", "conv:chat:group", { senderIsBot: true, mentioned: true })),
	).toMatchObject({ reason: "record", run: false });
});

test("the plugin computes the same revision the kernel records, and quiet hours stay deterministic", () => {
	const quiet = {
		...agent,
		social: {
			...agent.social!,
			defaults: { group: { quiet: { timezone: "Asia/Shanghai", start: "00:00", end: "23:59" } } },
		},
	};
	const event = { ...message("group", "acct:chat:user", "conv:chat:group", { mentioned: true }), ts: "now" };
	expect(decide(quiet as unknown as typeof agent, event)?.reason).toBe("quiet");
	const broken = {
		...agent,
		social: {
			...agent.social!,
			defaults: { group: { quiet: { timezone: "Not/AZone", start: "01:00", end: "02:00" } } },
		},
	};
	expect(decide(broken as unknown as typeof agent, event)?.reason).toBe("invalid-timezone");
});

test("an unavailable participation plugin fails closed: inbound records, outbound blocks", () => {
	const event = message("group", "acct:chat:user", "conv:chat:group", { mentioned: true });
	const warned: string[] = [];
	// 未加载：没有该插件注册的钩子。
	expect(
		decideParticipation(agent, event, undefined, undefined, new Map(), {
			onUnavailable: (plugin) => warned.push(plugin),
		}),
	).toMatchObject({ reason: "record", run: false });
	expect(warned).toEqual(["social"]);
	expect(() => decideParticipation(agent, event, undefined, undefined, new Map(), { outbound: true })).toThrow(
		"Social delivery blocked: participation-unavailable",
	);
});

test("a throwing plugin and an invalid reason are both treated as unavailable", () => {
	const event = message("group", "acct:chat:user", "conv:chat:group", { mentioned: true });
	for (const participation of [
		() => {
			throw new Error("policy exploded");
		},
		() => ({ reason: "invented-reason", run: true, revision: "x" }),
		() => ({ reason: "batch", run: "yes", revision: "x" }),
		() => ({ reason: "batch", run: false }),
		() => undefined,
	]) {
		const hooks = new Map([["social", [{ id: "social.test", participation }]]]) as unknown as Parameters<
			typeof decideParticipation
		>[4];
		expect(decideParticipation(agent, event, undefined, undefined, hooks)).toMatchObject({
			reason: "record",
			run: false,
		});
		expect(() => decideParticipation(agent, event, undefined, undefined, hooks, { outbound: true })).toThrow(
			"Social delivery blocked: participation-unavailable",
		);
	}
});

test("a custom participation plugin selected by SocialPolicy.plugin is the one called", () => {
	const configured = parseAgentConfig(
		JSON.stringify({
			...JSON.parse(JSON.stringify(agent)),
			social: {
				...agent.social,
				authorized: { conversations: ["conv:chat:group", "conv:chat:special"] },
				defaults: { group: { plugin: "alternative" } },
				conversations: { "conv:chat:special": { plugin: "social" } },
			},
		}),
	);
	const calls: string[] = [];
	const alternative = {
		id: "alternative.policy",
		participation: () => {
			calls.push("alternative");
			return { reason: "record" as const, run: false, revision: "alt" };
		},
	};
	const withAlternative = new Map([...hooks, ["alternative", [alternative]]]) as Parameters<
		typeof decideParticipation
	>[4];
	const event = message("group", "acct:chat:user", "conv:chat:group", { mentioned: true });
	// 自定义策略生效：它给出 record，官方的 @ 唤醒不会被借用。
	expect(decideParticipation(configured, event, undefined, undefined, withAlternative)).toMatchObject({
		reason: "record",
		run: false,
		revision: "alt",
	});
	expect(calls).toEqual(["alternative"]);
	// 精确会话覆盖回 social 时由官方插件判定（@ 唤醒），自定义插件不再被调用。
	expect(
		decideParticipation(configured, { ...event, conv: "conv:chat:special" }, undefined, undefined, withAlternative),
	).toMatchObject({ reason: "bot-mention", run: true });
	expect(calls).toEqual(["alternative"]);
});

test("policy is independent of profile plugin selection", () => {
	// 配置档没有选 social 也照常判定：参与策略不是 beforeSend 那样按 profile 生效的钩子。
	const unselected = parseAgentConfig(
		JSON.stringify({
			...JSON.parse(JSON.stringify(agent)),
			defaultProfile: "guest",
			profiles: { guest: { plugins: [] } },
		}),
	);
	expect(
		decideParticipation(
			unselected,
			message("group", "acct:chat:user", "conv:chat:group", { mentioned: true }),
			undefined,
			undefined,
			hooks,
		),
	).toMatchObject({ reason: "bot-mention", run: true });
});
